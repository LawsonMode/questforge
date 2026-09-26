// Final quality pass, game bucket: regression tests on a real Session (arena
// rooms, every entity behaviour registered) for the fixes of that pass - pegs
// rising under the hero, the whole-room unstick and warp fallbacks, a boss kill
// kept by Save & Quit, unknown item ids, the room-entry spawn vs mid-room
// reveals, walkers placed in walls, the dash bonk at a closed room edge, the
// crystal's single prize message, boss music after the boss, dialogue sides,
// the playtest pause options and SOUND panel, reserved world ids and the
// dungeon map's paper grid.
import { describe, expect, it, vi } from 'vitest';
import type { AudioApi, Button, DebugFlags, InputState, Renderer } from '../src/game/api';
import type { Dir, MusicId, Project, SaveData, SfxId, WarpTarget } from '../src/core/types';
import type { Vec } from '../src/core/math';
import { STEP } from '../src/core/constants';
import { T } from '../src/content/ids';
import { type ArenaEntity, type ArenaOptions, buildArenaProject } from '../src/dev/arena';
import { DEFAULT_HERO_NAME, newSave } from '../src/game/state';
import { Session, type SessionHost } from '../src/game/session';
import { SPAWN_UNSTICK } from '../src/game/entities/enemies/common';
import '../src/game/entities/index';

/** A pad whose buttons change between ticks (pressed/released last exactly one tick). */
class Pad implements InputState {
  private readonly down = new Set<Button>();
  private prev = new Set<Button>();
  private now = new Set<Button>();
  hold(...bs: Button[]): void { for (const b of bs) this.down.add(b); }
  release(...bs: Button[]): void { for (const b of bs) this.down.delete(b); }
  step(): void {
    this.prev = this.now;
    this.now = new Set(this.down);
  }
  held(b: Button): boolean { return this.now.has(b); }
  pressed(b: Button): boolean { return this.now.has(b) && !this.prev.has(b); }
  released(b: Button): boolean { return !this.now.has(b) && this.prev.has(b); }
  heldTime(b: Button): number { return this.now.has(b) ? 1 : 0; }
  dir(): Vec {
    return {
      x: (this.now.has('right') ? 1 : 0) - (this.now.has('left') ? 1 : 0),
      y: (this.now.has('down') ? 1 : 0) - (this.now.has('up') ? 1 : 0),
    };
  }
  anyPressed(): boolean { return [...this.now].some((b) => !this.prev.has(b)); }
  typed(): string { return ''; }
}

class FakeAudio implements AudioApi {
  readonly log: SfxId[] = [];
  readonly musicLog: (MusicId | 'none')[] = [];
  readonly volumes: { music?: number; sfx?: number }[] = [];
  currentMusic: MusicId | 'none' = 'none';
  sfx(id: SfxId): void { this.log.push(id); }
  music(id: MusicId | 'none'): void {
    this.currentMusic = id;
    this.musicLog.push(id);
  }
  duck(): void {}
  setVolumes(v: { music?: number; sfx?: number }): void { this.volumes.push(v); }
  unlock(): void {}
  setMuted(): void {}
}

interface Rig {
  s: Session;
  pad: Pad;
  audio: FakeAudio;
  project: Project;
  persisted: SaveData[];
  exited: () => boolean;
}

function rig(opts: ArenaOptions, extra: { mode?: 'play' | 'playtest'; edit?: (p: Project) => void; flags?: string[] } = {}): Rig {
  const project = buildArenaProject(opts);
  extra.edit?.(project);
  const pad = new Pad();
  const audio = new FakeAudio();
  const debug: DebugFlags = { hitboxes: false, invincible: false, noclip: false, fps: false };
  const save = newSave(project, 0, DEFAULT_HERO_NAME);
  for (const f of extra.flags ?? []) save.flags[f] = true;
  save.respawn = { ...project.start };
  const persisted: SaveData[] = [];
  let exited = false;
  const host: SessionHost = {
    mode: extra.mode ?? 'playtest',
    persist: async (sv) => { persisted.push(structuredClone(sv)); },
    exit: () => { exited = true; },
  };
  const s = new Session(host, project, pad, audio, save, debug, project.start);
  return { s, pad, audio, project, persisted, exited: () => exited };
}

function run(r: Rig, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.pad.step();
    r.s.tick(STEP);
    if (until?.()) return;
  }
}

function tap(r: Rig, b: Button): void {
  r.pad.hold(b);
  run(r, STEP);
  r.pad.release(b);
  run(r, STEP);
}

function holdFor(r: Rig, b: Button, seconds: number): void {
  r.pad.hold(b);
  run(r, seconds);
  r.pad.release(b);
  run(r, STEP);
}

const blocked = (r: Rig): boolean => r.s.player.isBlockedAt(r.s.player.x, r.s.player.y);

function pegField(tx0: number, ty0: number, w: number, h: number, color: 'red' | 'blue'): ArenaEntity[] {
  const out: ArenaEntity[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.push({ type: 'obj.peg', id: `peg_${x}_${y}`, x: (tx0 + x) * 16 + 8, y: (ty0 + y) * 16 + 8, props: { color } });
  }
  return out;
}

/** The dialogue box's current request (private UI state, read-only here). */
function shownBox(s: Session): { position: string; text: string } | null {
  const db = (s as unknown as { dialogueBox: { current: { position: string; boxes: { text: string }[] } | null; boxIndex: number } })
    .dialogueBox;
  return db.current ? { position: db.current.position, text: db.current.boxes[db.boxIndex]!.text } : null;
}

/** A renderer whose methods are no-ops, counting calls per method. */
function countingRenderer(): { r: Renderer; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const noop = (): void => {};
  const ctx = new Proxy({}, { get: () => noop }) as unknown as CanvasRenderingContext2D;
  const target: Record<string | symbol, unknown> = { width: 256, height: 224, ctx, camX: 0, camY: 0, time: 0 };
  const r = new Proxy(target, {
    get: (t, k) => {
      if (k in t) return t[k];
      return (): number => {
        calls.set(String(k), (calls.get(String(k)) ?? 0) + 1);
        return 0;
      };
    },
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as Renderer;
  return { r, calls };
}

describe('pegs rising under the hero (peg-field-traps-hero)', () => {
  for (const [w, h] of [[2, 2], [3, 3], [5, 3], [5, 5]] as const) {
    it(`a ${w}x${h} field rising under the hero never traps him: he walks off across the tops`, () => {
      const cx = (6 + w / 2) * 16;
      const cy = (5 + h / 2) * 16;
      const r = rig({
        theme: 'dungeon', player: { x: cx, y: cy, dir: 'up' },
        entities: [...pegField(6, 5, w, h, 'red'), { type: 'obj.crystalSwitch', id: 'cs', x: 40, y: 40 }],
      }, { flags: ['pegs:arena'] });
      run(r, 0.2);
      expect(blocked(r)).toBe(false);
      // A late arrow strikes the far switch: every red peg rises, the ones under the hero too.
      r.s.findEntity('cs')!.hurt({ kind: 'arrow', damage: 1, dx: 0, dy: -1, source: null });
      run(r, 0.1);
      const pegs = r.s.entities.filter((e) => e.type === 'obj.peg');
      expect(pegs.every((p) => p.solid)).toBe(true);
      const start = { x: r.s.player.x, y: r.s.player.y };
      // Walking out to the left crosses the tops, then the field blocks again from outside.
      holdFor(r, 'left', 1.2);
      const p = r.s.player;
      expect(p.x).toBeLessThan(start.x - 20);
      expect(blocked(r)).toBe(false);
      expect(p.right).toBeLessThanOrEqual(6 * 16 + 0.001);
      holdFor(r, 'right', 0.5);
      expect(p.right).toBeLessThanOrEqual(6 * 16 + 0.001);
    });
  }

  it('a raised peg the hero stands on draws on the ground layer (he shows on top of it)', () => {
    const r = rig({
      theme: 'dungeon', player: { x: 7 * 16 + 8, y: 6 * 16 + 8, dir: 'up' },
      entities: [...pegField(6, 5, 3, 3, 'red'), { type: 'obj.crystalSwitch', id: 'cs', x: 40, y: 40 }],
    }, { flags: ['pegs:arena'] });
    run(r, 0.1);
    r.s.togglePegs();
    run(r, 0.1);
    const under = r.s.findEntity('peg_1_1')!;
    const corner = r.s.findEntity('peg_0_0')!;
    expect(under.solid).toBe(true);
    expect(under.drawLayer).toBe('ground');
    expect(corner.drawLayer).toBe('normal');
  });
});

describe('unstick and warp fallbacks (freespot-radius-embeds-hero, unstick-search-every-tick)', () => {
  it('a hero entombed by blocks far wider than the nudge radius is moved to the nearest free tile, with a poof', () => {
    const r = rig({ theme: 'dungeon', gw: 2, gh: 2, player: { x: 256, y: 224, dir: 'up' } });
    run(r, 0.1);
    const spawnBlock = (x: number, y: number): void => {
      r.project.worlds[0]!.rooms[0]!.entities.push({ id: `b_${x}_${y}`, type: 'obj.block', x, y, props: {} });
      r.s.showEntity(`b_${x}_${y}`);
    };
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) spawnBlock(256 + x * 16, 224 + y * 16);
    expect(blocked(r)).toBe(true);
    const poofs = vi.spyOn(r.s, 'effect');
    run(r, STEP * 2);
    expect(blocked(r)).toBe(false);
    const p = r.s.player;
    expect(Math.max(Math.abs(p.x - 256), Math.abs(p.y - 224))).toBeGreaterThan(24);
    expect(poofs).toHaveBeenCalledWith('fx.poof', 'play', p.x, p.y);
  });

  it('with nowhere free at all, the failed search is not repeated every tick', () => {
    // A 1x1 dungeon whose whole floor is wall: the hero can stand nowhere.
    const r = rig({ theme: 'dungeon', tiles: [{ tx: 1, ty: 1, w: 14, h: 12, tile: 'DWALL_TOP' }] });
    const spy = vi.spyOn(r.s.player, 'isBlockedAt');
    run(r, STEP);
    expect(spy.mock.calls.length).toBeGreaterThan(100);
    spy.mockClear();
    run(r, 0.25);
    const perTick = spy.mock.calls.length / 15;
    expect(perTick).toBeLessThan(5);
    expect(blocked(r)).toBe(true);
  });

  it('a warp target deep inside a wall block lands the hero on the nearest free floor', () => {
    const r = rig({ theme: 'dungeon', player: { x: 40, y: 200, dir: 'up' } });
    const room = r.project.worlds[0]!.rooms[0]!;
    const cols = 16;
    for (let ty = 1; ty <= 11; ty++) for (let tx = 1; tx <= 14; tx++) room.layers.fg[ty * cols + tx] = T.DWALL_TOP!;
    const target: WarpTarget = { world: 'arena', room: 'arena_room', x: 128, y: 100, dir: 'down' };
    r.s.warpNow(target);
    expect(blocked(r)).toBe(false);
    const x0 = r.s.player.x;
    const y0 = r.s.player.y;
    holdFor(r, 'left', 0.3);
    holdFor(r, 'right', 0.3);
    expect(r.s.player.x !== x0 || r.s.player.y !== y0 || !blocked(r)).toBe(true);
  });
});

describe('Save & Quit during a boss death (boss-kill-lost-on-save-quit)', () => {
  for (const type of ['boss.knight', 'boss.worm']) {
    it(`${type}: quitting mid death-bursts keeps the kill`, async () => {
      const r = rig({ theme: 'dungeon', gw: 1, gh: 1, entities: [{ type, id: 'bb', x: 128, y: 80, props: { hp: 1 } }] }, { mode: 'play' });
      run(r, 1.2);
      r.s.findEntity('bb')!.die();
      run(r, 0.25);
      expect(r.s.findEntity('bb')).toBeDefined();
      tap(r, 'start');
      expect(r.s.mode).toBe('paused');
      // No equippable items: the cursor starts on RESUME; up twice is SAVE & QUIT.
      tap(r, 'up');
      tap(r, 'up');
      tap(r, 'a');
      await Promise.resolve();
      expect(r.persisted).toHaveLength(1);
      expect(r.persisted[0]!.flags['defeated:bb']).toBe(true);
    });
  }
});

describe('unknown item ids (giveitem-unknown-id-crash)', () => {
  it('giveItem with an unknown id gives nothing, warns once and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = rig({ theme: 'dungeon' });
    const before = JSON.stringify(r.s.save);
    expect(() => r.s.giveItem('bogus' as never, 1, { fanfare: true })).not.toThrow();
    expect(() => r.s.giveItem('bogus' as never, 1, { fanfare: true })).not.toThrow();
    expect(JSON.stringify(r.s.save)).toBe(before);
    expect(r.s.mode).toBe('playing');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a room trigger giving an unknown item carries on and the game keeps running', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = rig({
      theme: 'dungeon',
      triggers: [{
        id: 't', name: 'bad gift', on: 'enter', once: false, conditions: [],
        actions: [
          { kind: 'setFlag', flag: 'before', value: true },
          { kind: 'giveItem', item: 'bogus' as never, amount: 1 },
          { kind: 'setFlag', flag: 'after', value: true },
        ],
      }],
    });
    run(r, 0.1);
    expect(r.s.flag('before')).toBe(true);
    expect(r.s.flag('after')).toBe(true);
    const x0 = r.s.player.x;
    holdFor(r, 'right', 0.3);
    expect(r.s.player.x).toBeGreaterThan(x0);
    warn.mockRestore();
  });
});

describe('room-entry spawns vs reveals (dash-charge-entry-fake-reveal)', () => {
  it('entering a room mid-charge (anim clock running) spawns its pickup quietly, on the ground', () => {
    const r = rig({ theme: 'dungeon', entities: [{ type: 'obj.pickup', id: 'rup', x: 128, y: 60, props: { item: 'rupees', amount: 5 } }] });
    const p = r.s.player as unknown as { st: string; animT: number; facing: Dir };
    // What Player.place keeps for a charge carried through an edge scroll.
    p.st = 'charge';
    p.animT = 0.5;
    r.audio.log.length = 0;
    r.s.warpNow({ world: 'arena', room: 'arena_room', x: 128, y: 160 });
    const pickup = r.s.findEntity('rup')!;
    expect(pickup.z).toBe(0);
    expect(r.audio.log).not.toContain('secret');
  });

  it('something shown mid-room still drops in with the reveal jingle', () => {
    const r = rig({ theme: 'dungeon', entities: [{ type: 'obj.pickup', id: 'rup', x: 128, y: 60, props: { item: 'rupees', amount: 5, hidden: true } }] });
    run(r, 0.3);
    r.audio.log.length = 0;
    r.s.showEntity('rup');
    expect(r.s.findEntity('rup')!.z).toBeGreaterThan(20);
    expect(r.audio.log).toContain('secret');
  });
});

describe('walkers placed overlapping a wall (enemy-wall-overlap-frozen)', () => {
  for (const type of ['enemy.soldier', 'enemy.archer', 'enemy.spitter', 'enemy.skeleton', 'enemy.slime', 'enemy.goblin', 'enemy.snake']) {
    it(`${type} steps out of the wall on its first tick and then moves`, () => {
      const r = rig({
        theme: 'dungeon', player: { x: 128, y: 190, dir: 'up' },
        entities: [{ type, id: 'foe', x: 64, y: 20, props: { behavior: 'chase', drop: 'none' } }],
      });
      const foe = r.s.findEntity('foe')!;
      expect(foe.isBlockedAt(foe.x, foe.y)).toBe(true);
      run(r, STEP);
      expect(foe.isBlockedAt(foe.x, foe.y)).toBe(false);
      expect(Math.hypot(foe.x - 64, foe.y - 20)).toBeLessThanOrEqual(SPAWN_UNSTICK * Math.SQRT2);
      const at = { x: foe.x, y: foe.y };
      run(r, 4);
      expect(foe.x !== at.x || foe.y !== at.y).toBe(true);
    });
  }

  it('an eye statue stays exactly where it was placed', () => {
    const r = rig({ theme: 'dungeon', entities: [{ type: 'enemy.eye', id: 'eye', x: 64, y: 12 }] });
    run(r, 0.5);
    const eye = r.s.findEntity('eye')!;
    expect([eye.x, eye.y]).toEqual([64, 12]);
  });
});

describe('dash into a closed room edge (dash-open-edge-no-bonk)', () => {
  it('a dash into an edge with no neighbour bonks like a wall', () => {
    const r = rig({ theme: 'grass', items: { boots: 1 }, player: { x: 180, y: 112, dir: 'right' } });
    const states = new Set<string>();
    r.pad.hold('a');
    run(r, 2, () => {
      states.add(r.s.player.state);
      return false;
    });
    r.pad.release('a');
    expect(states.has('dash')).toBe(true);
    expect(states.has('hurt')).toBe(true);
    expect(r.audio.log).toContain('hit');
    expect(r.s.player.right).toBeLessThanOrEqual(256);
  });
});

describe('the crystal and the boss theme (crystal-double-message, boss-music-after-defeat)', () => {
  it('a dungeon crystal shows exactly one message, naming the world prize', () => {
    const r = rig({ theme: 'dungeon' }, { edit: (p) => { p.worlds[0]!.prizeName = 'Sun Crystal'; } });
    run(r, 0.1);
    r.s.giveItem('crystal', 1, { fanfare: true });
    const texts: string[] = [];
    for (let i = 0; i < 20 && r.s.mode === 'dialogue'; i++) {
      const box = shownBox(r.s);
      if (box && texts.at(-1) !== box.text) texts.push(box.text);
      run(r, 0.5);
      tap(r, 'a');
    }
    expect(texts).toEqual(['You got the Sun Crystal!']);
  });

  it('without a prize name the message says "<world> Crystal", and a quiet grant still shows it', () => {
    const r = rig({ theme: 'dungeon' });
    run(r, 0.1);
    r.s.giveItem('crystal', 1);
    expect(shownBox(r.s)?.text).toBe('You got the Arena Crystal!');
  });

  it('the boss theme stops when the boss falls, and a cleared lair plays the world music on re-entry', () => {
    const r = rig({ theme: 'dungeon', entities: [{ type: 'boss.knight', id: 'bb', x: 128, y: 80, props: { hp: 1, dropHeart: false } }] }, {
      edit: (p) => {
        p.worlds[0]!.music = 'dungeon';
        p.worlds[0]!.rooms[0]!.music = 'boss';
      },
    });
    expect(r.audio.currentMusic).toBe('boss');
    run(r, 1.2);
    r.s.findEntity('bb')!.die();
    run(r, 4);
    expect(r.s.flag('defeated:bb')).toBe(true);
    expect(r.audio.currentMusic).toBe('dungeon');
    r.s.warpNow(r.project.start);
    expect(r.audio.currentMusic).toBe('dungeon');
  });
});

describe('dialogue sides (dialogue-hides-speaker-below)', () => {
  const npc = (y: number): ArenaEntity => ({ type: 'npc.person', id: 'tom', x: 128, y, props: { facing: 'up', dialogue: 'd1', name: 'Tom' } });
  const dialogues = [{ id: 'd1', name: 'D1', pages: [{ text: 'Hello there.' }] }];

  it('a speaker just below the hero moves the box to the top', () => {
    const r = rig({ theme: 'grass', dialogues, player: { x: 128, y: 136, dir: 'down' }, entities: [npc(152)] });
    run(r, 0.5);
    tap(r, 'a');
    expect(shownBox(r.s)?.position).toBe('top');
  });

  it('with the hero and the speaker high on the screen the box stays at the bottom', () => {
    const r = rig({ theme: 'grass', dialogues, player: { x: 128, y: 60, dir: 'down' }, entities: [npc(76)] });
    run(r, 0.5);
    tap(r, 'a');
    expect(shownBox(r.s)?.position).toBe('bottom');
  });

  it('a hero whose feet would be under the bottom box gets the box at the top', () => {
    const r = rig({ theme: 'grass', player: { x: 128, y: 140, dir: 'up' } });
    run(r, 0.1);
    void r.s.dialogue('Just text.');
    expect(shownBox(r.s)?.position).toBe('top');
  });
});

describe('pause menu options (playtest-fake-saved, no-audio-controls)', () => {
  const options = (s: Session): string[] =>
    (s as unknown as { pauseMenu: { options: (readonly [string, string])[] } }).pauseMenu.options.map((o) => o[0]);

  it('play mode offers SAVE / SAVE & QUIT / SOUND / RESUME; a playtest has no SAVE', () => {
    expect(options(rig({ theme: 'dungeon' }, { mode: 'play' }).s)).toEqual(['SAVE', 'SAVE & QUIT', 'SOUND', 'RESUME']);
    expect(options(rig({ theme: 'dungeon' }).s)).toEqual(['QUIT', 'SOUND', 'RESUME']);
  });

  it('QUIT in a playtest leaves without claiming a save', async () => {
    const r = rig({ theme: 'dungeon' });
    run(r, 0.1);
    tap(r, 'start');
    tap(r, 'up');
    tap(r, 'up');
    tap(r, 'a');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.exited()).toBe(true);
  });

  it('the SOUND panel changes the music and effect volumes, and B goes back to the options', () => {
    const r = rig({ theme: 'dungeon' });
    run(r, 0.1);
    tap(r, 'start');
    tap(r, 'up'); // SOUND
    tap(r, 'a');
    const menu = (r.s as unknown as { pauseMenu: { soundRow: number } }).pauseMenu;
    expect(menu.soundRow).toBe(0);
    tap(r, 'left');
    expect(r.audio.volumes.at(-1)!.music).toBeCloseTo(0.7 * 3 / 4);
    tap(r, 'down');
    tap(r, 'left');
    tap(r, 'left');
    expect(r.audio.volumes.at(-1)!.sfx).toBeCloseTo(0.9 * 2 / 4);
    tap(r, 'b');
    expect(menu.soundRow).toBe(-1);
    expect(r.s.mode).toBe('paused');
  });
});

describe('reserved world ids (dungeon-reserved-world-id)', () => {
  for (const id of ['__proto__', 'constructor']) {
    it(`a dungeon world called "${id}" plays`, () => {
      const r = rig({ theme: 'dungeon' }, {
        edit: (p) => {
          p.worlds[0]!.id = id;
          p.start = { ...p.start, world: id };
        },
      });
      expect(r.s.dungeon?.visited).toEqual(['arena_room']);
      expect(Object.getPrototypeOf(r.s.save.dungeons)).toBe(Object.prototype);
      r.s.setFlag('__proto__');
      expect(r.s.flag('__proto__')).toBe(true);
      expect(r.s.flag('constructor')).toBe(false);
    });
  }
});

describe('dungeon map paper grid (pause-map-grid-per-frame)', () => {
  it('rooms far apart do not make the map page draw millions of grid cells', () => {
    const r = rig({ theme: 'dungeon' }, {
      edit: (p) => {
        const room = structuredClone(p.worlds[0]!.rooms[0]!);
        room.id = 'far';
        room.gx = 12000;
        room.gy = 12000;
        p.worlds[0]!.rooms.push(room);
      },
    });
    r.s.dungeon!.map = true;
    run(r, 0.1);
    tap(r, 'select');
    expect(r.s.mode).toBe('paused');
    run(r, 0.3);
    const { r: renderer, calls } = countingRenderer();
    const started = performance.now();
    r.s.draw(renderer, 60);
    expect(performance.now() - started).toBeLessThan(200);
    expect(calls.get('strokeRect') ?? 0).toBeLessThan(500);
  });
});
