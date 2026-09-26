// Release follow-ups: defence in depth against broken (hand-edited / imported)
// data in the engine, and small cross-area consistency rules.
import { describe, expect, it } from 'vitest';
import type { AudioApi, DebugFlags, Hit, InputState } from '../src/game/api';
import type { LayerName, MusicId, Project, SfxId, Trigger } from '../src/core/types';
import { buildArenaProject } from '../src/dev/arena';
import { DEFAULT_HERO_NAME, healSave, newSave } from '../src/game/state';
import { Session } from '../src/game/session';
import { ActiveRoom } from '../src/game/world';
import { STEP } from '../src/core/constants';
import { T } from '../src/content/ids';
import { PREVIEW_NAME } from '../src/editor/dialogue/dialogueModel';
import { safeColour } from '../src/editor/art/paletteEditor';
import { snapHex } from '../src/gfx/palette';

class StillPad implements InputState {
  held(): boolean { return false; }
  pressed(): boolean { return false; }
  released(): boolean { return false; }
  heldTime(): number { return 0; }
  dir() { return { x: 0, y: 0 }; }
  anyPressed(): boolean { return false; }
  typed(): string { return ''; }
}

class QuietAudio implements AudioApi {
  currentMusic: MusicId | 'none' = 'none';
  sfx(_id: SfxId): void {}
  music(_id: MusicId | 'none'): void {}
  duck(): void {}
  setVolumes(): void {}
  unlock(): void {}
  setMuted(): void {}
}

function session(project: Project = buildArenaProject({ theme: 'grass' })): Session {
  const debug: DebugFlags = { hitboxes: false, invincible: false, noclip: false, fps: false };
  const host = { mode: 'playtest' as const, persist: async () => {}, exit: () => {} };
  return new Session(host, project, new StillPad(), new QuietAudio(), newSave(project, 0, 'T'), debug, project.start);
}

function hit(extra: Partial<Hit>): Hit {
  return { damage: 0, kind: 'contact', source: null, dx: 1, dy: 0, ...extra };
}

describe('hero name', () => {
  it('the dialogue preview substitutes the same {name} playtests use', () => {
    expect(PREVIEW_NAME).toBe(DEFAULT_HERO_NAME);
  });
});

describe('non-finite amounts are ignored', () => {
  it('healSave', () => {
    const p = buildArenaProject({ theme: 'grass' });
    const save = newSave(p, 0, 'T');
    save.hp = 3;
    for (const bad of [NaN, Infinity, -Infinity]) healSave(save, bad);
    expect(save.hp).toBe(3);
    healSave(save, 2);
    expect(save.hp).toBe(5);
  });

  it('Player.heal and the hero\'s hit rules (damage, stun, knockback)', () => {
    const s = session();
    const hero = s.player;
    s.save.hp = 4;
    hero.heal(NaN);
    hero.heal(Infinity);
    expect(s.save.hp).toBe(4);
    const x = hero.x;
    const y = hero.y;
    expect(hero.hurt(hit({ damage: Infinity }))).toBe(true);
    expect(s.save.hp).toBe(4);
    expect(hero.hurt(hit({ damage: NaN, stun: Infinity, knockback: NaN }))).toBe(true);
    for (let i = 0; i < 30; i++) s.tick(STEP);
    expect(s.save.hp).toBe(4);
    expect(Number.isFinite(hero.x) && Number.isFinite(hero.y)).toBe(true);
    expect(Math.hypot(hero.x - x, hero.y - y)).toBeLessThanOrEqual(2 * 16 + 1); // at most two default knockbacks
    expect(hero.stun).toBeLessThan(1);
    expect(hero.state).not.toBe('dead');
  });
});

describe('room tile layers', () => {
  const p = buildArenaProject({ theme: 'grass' });
  const world = p.worlds[0]!;
  const roomDef = world.rooms[0]!;

  it('ignore layer names that are not layers ("__proto__", "constructor") without touching Object', () => {
    const flags: Record<string, boolean> = {};
    const room = new ActiveRoom(p, world, roomDef, flags);
    for (const bad of ['__proto__', 'constructor', 'toString', 'nope'] as unknown as LayerName[]) {
      expect(room.tile(bad, 1, 1)).toBe(0);
      expect(() => room.setTile(bad, 1, 1, 5, true)).not.toThrow();
    }
    expect(Object.keys(flags)).toEqual([]);
    expect(({} as Record<string, unknown>)['1']).toBeUndefined();
  });

  it('ignore fractional cells and ids that are not whole numbers >= 0', () => {
    const room = new ActiveRoom(p, world, roomDef, {});
    const before = room.tile('fg', 2, 2);
    room.setTile('fg', 2.5, 2, T.BUSH!);
    room.setTile('fg', 2, 2, NaN);
    room.setTile('fg', 2, 2, -1);
    room.setTile('fg', 2, 2, 1.5);
    expect(room.tile('fg', 2, 2)).toBe(before);
    expect(room.tile('fg', 2.5, 2)).toBe(0);
    room.setTile('fg', 2, 2, T.BUSH!);
    expect(room.tile('fg', 2, 2)).toBe(T.BUSH);
  });

  it('a setTile trigger action with a bad layer or tile is skipped with a warning', () => {
    const project = buildArenaProject({ theme: 'grass' });
    const trig: Trigger = {
      id: 't_bad', name: 'Bad tiles', on: 'auto', conditions: [], once: true,
      actions: [
        { kind: 'setTile', layer: '__proto__' as unknown as LayerName, tx: 1, ty: 1, tile: 5 },
        { kind: 'setTile', layer: 'fg', tx: 1.5, ty: 1, tile: 5 },
        { kind: 'setTile', layer: 'fg', tx: 1, ty: 1, tile: NaN },
        { kind: 'setTile', layer: 'fg', tx: 3, ty: 3, tile: T.BUSH! },
      ],
    };
    project.worlds[0]!.rooms[0]!.triggers.push(trig);
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
    try {
      const s = session(project);
      for (let i = 0; i < 5; i++) s.tick(STEP);
      expect(s.room.tile('fg', 3, 3)).toBe(T.BUSH);
      expect(s.room.tile('fg', 1, 1)).not.toBe(5);
      expect(Object.keys(s.save.flags).filter((k) => k.includes('__proto__') || k.includes('NaN'))).toEqual([]);
    } finally {
      console.warn = warn;
    }
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe('art editor colours', () => {
  it('pass through the palette sanitiser (never a CSS value) and snap to the SNES gamut', () => {
    expect(safeColour('url(https://example.invalid/x.png)')).toBe('#000000');
    expect(safeColour('red; background: url(x)')).toBe('#000000');
    expect(safeColour(' #ABC ')).toBe(snapHex('#aabbcc'));
    expect(safeColour('ff0080')).toBe(snapHex('#ff0080'));
    expect(safeColour('#ffffff')).toBe('#ffffff');
  });
});
