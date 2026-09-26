// Session (the GameServices implementation) and the hero's state machine, driven
// tick by tick on the engine test project with a fake pad and audio: scrolls,
// edge clamps, ledge hops, pits, warps, spawn rules, contact damage, item sfx.
import { describe, expect, it, vi } from 'vitest';
import type { AudioApi, Button, DebugFlags, InputState, Renderer } from '../src/game/api';
import type { EntityInstance, MusicId, Project, SfxId, WarpTarget } from '../src/core/types';
import type { Vec } from '../src/core/math';
import { STEP } from '../src/core/constants';
import { findRoom } from '../src/core/project';
import { T } from '../src/content/ids';
import { createTestProject } from '../src/content/testProject';
import { newSave } from '../src/game/state';
import { Entity } from '../src/game/entity';
import type { GameServices } from '../src/game/api';
import { registerEntity } from '../src/game/registry';
import { Session } from '../src/game/session';

class FakeInput implements InputState {
  vec: Vec = { x: 0, y: 0 };
  /** Buttons reported as pressed on the next tick only (cleared by the tick helpers). */
  readonly taps = new Set<Button>();
  held(b: Button): boolean {
    return (b === 'left' && this.vec.x < 0) || (b === 'right' && this.vec.x > 0)
      || (b === 'up' && this.vec.y < 0) || (b === 'down' && this.vec.y > 0);
  }
  pressed(b: Button): boolean { return this.taps.has(b); }
  released(): boolean { return false; }
  heldTime(): number { return 0; }
  dir(): Vec { return this.vec; }
  anyPressed(): boolean { return false; }
  typed(): string { return ''; }
}

class FakeAudio implements AudioApi {
  readonly sfxLog: SfxId[] = [];
  currentMusic: MusicId | 'none' = 'none';
  ducked = 0;
  sfx(id: SfxId): void { this.sfxLog.push(id); }
  music(id: MusicId | 'none'): void { this.currentMusic = id; }
  duck(seconds: number): void { this.ducked = seconds; }
  setVolumes(): void {}
  unlock(): void {}
  setMuted(): void {}
}

/** Enemy-team stand-in: contact damage 1, counts for 'enemiesCleared'. */
class Dummy extends Entity {
  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'test.dummy');
    this.team = 'enemy';
    this.contactDamage = 1;
    this.countsForClear = true;
  }
}

registerEntity('test.dummy', (g, i) => new Dummy(g, i));
// A real persistDefeat type from the catalog, backed by the dummy.
registerEntity('boss.worm', (g, i) => new Dummy(g, i));

interface Rig {
  s: Session;
  input: FakeInput;
  audio: FakeAudio;
  project: Project;
  debug: DebugFlags;
}

function rig(start: Partial<WarpTarget> = {}, edit?: (p: Project) => void): Rig {
  const project = createTestProject();
  edit?.(project);
  const input = new FakeInput();
  const audio = new FakeAudio();
  const debug: DebugFlags = { hitboxes: false, invincible: false, noclip: false, fps: false };
  const save = newSave(project, 0, 'TEST');
  save.respawn = { ...project.start };
  const host = { mode: 'playtest' as const, persist: async () => {}, exit: () => {} };
  const s = new Session(host, project, input, audio, save, debug, { ...project.start, ...start });
  return { s, input, audio, project, debug };
}

/** Tick for up to `seconds`, stopping early once `until` holds. */
function run(s: Session, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    s.tick(STEP);
    if (until?.()) return;
  }
}

/** Report `b` as pressed for exactly one tick. */
function tap(r: Rig, b: Button): void {
  r.input.taps.add(b);
  r.s.tick(STEP);
  r.input.taps.clear();
}

function hold(r: Rig, dir: Vec, seconds: number, until?: () => boolean): void {
  r.input.vec = dir;
  run(r.s, seconds, until);
  r.input.vec = { x: 0, y: 0 };
}

const RIGHT = { x: 1, y: 0 };
const DOWN = { x: 0, y: 1 };
const UP = { x: 0, y: -1 };

function fill(p: Project, roomId: string, layer: 'bg' | 'fg', x: number, y: number, w: number, h: number, id: number): void {
  const room = findRoom(p, 'ow', roomId)!;
  const cols = room.gw * 16;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) room.layers[layer][ty * cols + tx] = id;
}

/** A renderer whose every method is a no-op (for exercising Session.draw). */
function fakeRenderer(): Renderer {
  const noop = (): void => {};
  const ctx = new Proxy({}, { get: () => noop }) as unknown as CanvasRenderingContext2D;
  const target: Record<string | symbol, unknown> = { width: 256, height: 224, ctx, camX: 0, camY: 0, time: 0 };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : noop) }) as unknown as Renderer;
}

describe('Session: room edges and scrolls', () => {
  it('scrolls into the neighbour and carries the hero 16 px inside', () => {
    const r = rig({ x: 240, y: 110, dir: 'right' });
    hold(r, RIGHT, 1, () => r.s.mode === 'transition');
    expect(r.s.mode).toBe('transition');
    expect(r.s.room.def.id).toBe('ow_lake');
    run(r.s, 0.7);
    expect(r.s.mode).toBe('playing');
    expect(r.s.player.x).toBe(16);
    expect(r.s.player.y).toBeCloseTo(110, 0);
  });

  it('never lands the hero inside a wall on the far side of an edge', () => {
    const r = rig({ x: 240, y: 110, dir: 'right' }, (p) => fill(p, 'ow_lake', 'fg', 0, 4, 2, 6, T.MOUNTAIN_ROCK!));
    hold(r, RIGHT, 1, () => r.s.mode === 'transition');
    run(r.s, 0.7);
    const p = r.s.player;
    expect(r.s.room.def.id).toBe('ow_lake');
    expect(p.isBlockedAt(p.x, p.y)).toBe(false);
    const x0 = p.x;
    hold(r, RIGHT, 0.3);
    expect(p.x).toBeGreaterThan(x0 + 10);
  });

  it('clamps the hero at an edge with no neighbour', () => {
    const r = rig({ x: 128, y: 20 });
    r.debug.noclip = true;
    hold(r, UP, 1);
    expect(r.s.room.def.id).toBe('ow_meadow');
    expect(r.s.player.y).toBe(6);
    expect(r.s.mode).toBe('playing');
  });

  it('moves warp targets that sit inside walls to the nearest free spot', () => {
    const r = rig();
    r.s.warpNow({ world: 'ow', room: 'ow_meadow', x: 136, y: 72 });
    const p = r.s.player;
    expect(p.isBlockedAt(p.x, p.y)).toBe(false);
    expect(Math.abs(p.y - 72)).toBe(14);
  });

  it('warns and falls back to the project start for a missing warp target', () => {
    const r = rig({ room: 'ow_lake', x: 60, y: 150 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.s.warpNow({ world: 'ow', room: 'nowhere', x: 1, y: 1 });
    expect(r.s.room.def.id).toBe('ow_meadow');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nowhere'));
    warn.mockRestore();
  });

  it('queues a warp requested while a transition runs', () => {
    const r = rig();
    r.s.warp({ world: 'dg', room: 'dg_entry', x: 128, y: 184, dir: 'up' });
    run(r.s, 0.1);
    expect(r.s.mode).toBe('transition');
    r.s.warp({ world: 'ow', room: 'ow_cross', x: 56, y: 170, dir: 'down' });
    run(r.s, 2);
    expect(r.s.mode).toBe('playing');
    expect(r.s.room.def.id).toBe('ow_cross');
  });
});

describe('Session: ledges and pits', () => {
  it('hops the ledge band onto the ground past it', () => {
    const r = rig({ room: 'ow_ledges', x: 72, y: 92, dir: 'down' });
    hold(r, DOWN, 1, () => r.s.player.state === 'hop');
    expect(r.s.player.state).toBe('hop');
    run(r.s, 0.5);
    expect(r.s.player.state).toBe('normal');
    expect(r.s.player.y).toBeGreaterThanOrEqual(143.5);
  });

  it('does not hop through a wall right below the ledge', () => {
    const r = rig({ room: 'ow_ledges', x: 72, y: 92, dir: 'down' }, (p) => fill(p, 'ow_ledges', 'fg', 1, 8, 10, 1, T.STONE_WALL!));
    let hopped = false;
    hold(r, DOWN, 1.2, () => {
      hopped ||= r.s.player.state === 'hop';
      return false;
    });
    expect(hopped).toBe(false);
    expect(r.s.player.y).toBeLessThanOrEqual(106);
  });

  it('pit without a pitTarget: one heart, back at the entry point, camera snapped', () => {
    const r = rig({ room: 'ow_field', x: 40, y: 168, dir: 'right' });
    const p = r.s.player;
    p.place(262, 168, 'right');
    run(r.s, 1);
    expect(r.s.camera.x).toBeGreaterThan(100);
    hold(r, RIGHT, 1, () => p.state === 'fall');
    expect(p.state).toBe('fall');
    run(r.s, 3, () => p.state === 'normal');
    expect(r.s.save.hp).toBe(4);
    expect([p.x, p.y]).toEqual([40, 168]);
    expect(r.s.camera.x).toBe(0);
  });

  it('pit with a pitTarget warps there without damage', () => {
    const r = rig({ x: 160, y: 152, dir: 'right' }, (p) => {
      findRoom(p, 'ow', 'ow_meadow')!.pitTarget = { world: 'dg', room: 'dg_entry', x: 128, y: 120, dir: 'down' };
    });
    hold(r, RIGHT, 1, () => r.s.player.state === 'fall');
    run(r.s, 3, () => r.s.room.def.id === 'dg_entry' && r.s.mode === 'playing');
    expect(r.s.room.def.id).toBe('dg_entry');
    expect(r.s.save.hp).toBe(6);
  });

  it('knockback over a hole drops the hero in instead of sliding across', () => {
    const r = rig({ x: 168, y: 152 });
    const p = r.s.player;
    p.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 1, dy: 0, knockback: 40 });
    run(r.s, 0.3, () => p.state === 'fall');
    expect(p.state).toBe('fall');
    expect(p.x).toBeLessThan(192);
  });
});

describe('Session: services', () => {
  it('maps giveItem sounds and shows the fanfare pose', () => {
    const r = rig();
    r.s.giveItem('rupees', 5);
    r.s.giveItem('heart');
    r.s.giveItem('heartPiece');
    r.s.giveItem('bombs', 4);
    expect(r.audio.sfxLog).toEqual(['rupee', 'heart', 'heart', 'item']);
    r.s.giveItem('bow', 1, { fanfare: true });
    expect(r.audio.sfxLog.at(-1)).toBe('fanfare');
    expect(r.audio.ducked).toBe(2);
    expect(r.s.player.state).toBe('itemGet');
    expect(r.s.hasItem('bow')).toBe(true);
  });

  it('applies the placed-instance skip rules and persists defeats', () => {
    const r = rig({}, (p) => {
      findRoom(p, 'ow', 'ow_meadow')!.entities.push(
        { id: 'd_hidden', type: 'test.dummy', x: 40, y: 60, props: { hidden: true } },
        { id: 'd_plain', type: 'test.dummy', x: 60, y: 60, props: {} },
        { id: 'd_flagged', type: 'test.dummy', x: 80, y: 60, props: {} },
        { id: 'd_boss', type: 'boss.worm', x: 200, y: 60, props: {} },
      );
    });
    r.s.setFlag('hidden:d_flagged');
    const back = () => r.s.warpNow({ world: 'ow', room: 'ow_meadow', x: 128, y: 150 });
    back();
    const has = (id: string) => r.s.findEntity(id) !== undefined;
    expect([has('d_hidden'), has('d_plain'), has('d_flagged'), has('d_boss')]).toEqual([false, true, false, true]);
    r.s.showEntity('d_hidden');
    r.s.hideEntity('d_plain');
    r.s.findEntity('d_boss')!.die();
    run(r.s, 0.05);
    expect([has('d_hidden'), has('d_plain'), has('d_boss')]).toEqual([true, false, false]);
    back();
    expect([has('d_hidden'), has('d_plain'), has('d_boss')]).toEqual([true, false, false]);
  });

  it('deals contact damage with a 16 px knockback and i-frames; tracks enemiesCleared', () => {
    const r = rig({ x: 128, y: 150 });
    const p = r.s.player;
    expect(r.s.enemiesCleared()).toBe(true);
    const d = r.s.spawn(new Dummy(r.s, null));
    d.x = 138;
    d.y = 150;
    expect(r.s.enemiesRemaining()).toBe(1);
    run(r.s, 1 / 60);
    expect(r.s.save.hp).toBe(5);
    expect(r.audio.sfxLog).toContain('hurt');
    run(r.s, 0.3);
    expect(p.x).toBeCloseTo(112, 6);
    expect(p.invuln).toBeGreaterThan(0.5);
    expect(p.state).toBe('normal');
    d.hurt({ damage: 9, kind: 'sword', source: p, dx: 1, dy: 0 });
    expect(r.s.enemiesCleared()).toBe(true);
  });

  it('draws the steady camera while gameplay is frozen, and restores the hero after scroll drawing', () => {
    const r = rig({ x: 240, y: 110, dir: 'right' });
    const gfx = fakeRenderer();
    r.s.camera.shake(2, 3);
    let jittered = false;
    run(r.s, 1, () => {
      r.s.draw(gfx, 60);
      jittered ||= gfx.camX !== r.s.camera.x || gfx.camY !== r.s.camera.y;
      return jittered;
    });
    expect(jittered).toBe(true);
    hold(r, RIGHT, 1, () => r.s.mode === 'transition');
    run(r.s, 0.2);
    const { x, y } = r.s.player;
    r.s.draw(gfx, 60);
    expect([gfx.camX, gfx.camY]).toEqual([r.s.camera.x, r.s.camera.y]);
    expect([r.s.player.x, r.s.player.y]).toEqual([x, y]);
  });

  it('keeps the hero visible through a scroll even when frozen in a hidden i-frame flicker phase', () => {
    const r = rig({ x: 240, y: 110, dir: 'right' });
    hold(r, RIGHT, 1, () => r.s.mode === 'transition');
    const p = r.s.player;
    p.invuln = 0.54; // floor(0.54 * 30) is even: Entity.draw skips this flicker phase
    const drawn: string[] = [];
    const base = fakeRenderer();
    const gfx = new Proxy(base, {
      get: (t, k) => (k === 'drawSpriteAnim' ? (id: string) => { drawn.push(id); } : Reflect.get(t, k)),
    });
    r.s.draw(gfx, 60);
    expect(drawn).toContain('hero');
    expect(p.invuln).toBe(0.54);
  });
});

describe('Player state machine', () => {
  it('ignores hits during i-frames, except falls', () => {
    const r = rig();
    const p = r.s.player;
    p.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 1, dy: 0 });
    p.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 1, dy: 0 });
    expect(r.s.save.hp).toBe(5);
    p.hurtPlayer({ damage: 2, kind: 'fall', source: null, dx: 0, dy: 0, knockback: 0 });
    expect(r.s.save.hp).toBe(3);
  });

  it('takes damage but no knockback in mid-hop', () => {
    const r = rig({ room: 'ow_ledges', x: 72, y: 92, dir: 'down' });
    const p = r.s.player;
    hold(r, DOWN, 1, () => p.state === 'hop');
    run(r.s, 0.1);
    p.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: -1 });
    expect(r.s.save.hp).toBe(5);
    expect(p.state).toBe('hop');
    run(r.s, 0.5);
    expect(p.y).toBeGreaterThanOrEqual(143.5);
  });

  it('die() runs the death sequence instead of freezing the game', () => {
    const r = rig({ room: 'ow_lake', x: 60, y: 150 });
    const p = r.s.player;
    p.die();
    expect(p.state).toBe('dead');
    expect(p.dead).toBe(false);
    expect(r.s.save.hp).toBe(0);
    run(r.s, 6, () => r.s.save.deaths === 1 && r.s.mode === 'gameOver');
    expect(r.s.mode).toBe('gameOver');
    // The game-over screen waits for input: one press skips the build-up, the next picks CONTINUE.
    run(r.s, 1.2);
    tap(r, 'a');
    run(r.s, 0.5);
    tap(r, 'a');
    run(r.s, 1, () => r.s.mode === 'playing');
    expect(r.s.save.deaths).toBe(1);
    expect(r.s.room.def.id).toBe('ow_meadow');
    expect(p.state).toBe('normal');
    expect(r.s.save.hp).toBe(6);
  });

  it('swims in deep water with flippers and climbs out onto the shallows', () => {
    const r = rig();
    r.s.giveItem('flippers');
    r.s.warpNow({ world: 'ow', room: 'ow_lake', x: 104, y: 104, dir: 'right' });
    hold(r, RIGHT, 0.7);
    expect(r.s.player.state).toBe('swim');
    expect(r.s.player.x).toBeGreaterThan(130);
    hold(r, DOWN, 0.7);
    expect(r.s.player.state).toBe('normal');
  });

  it('spikes push the hero back against the way they walked', () => {
    const r = rig({ world: 'dg', room: 'dg_dark', x: 184, y: 128, dir: 'down' });
    const p = r.s.player;
    hold(r, { x: 1, y: 1 }, 1, () => p.state === 'hurt');
    expect(p.state).toBe('hurt');
    expect(p.facing).toBe('down');
    expect(p.kbx).toBeLessThan(0);
    expect(p.kby).toBeLessThan(0);
  });
});
