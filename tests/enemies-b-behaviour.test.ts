// Enemies group B: pure line-up / view-cone / fade math, plus behaviour checks
// for all six enemies ticked against a mock GameServices on a real ActiveRoom
// (so tile collision and line of sight use the engine's rules).
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, PropValue, Room, TileDef, World } from '../src/core/types';
import type { GameEvent, GameServices, Hit, PlayerApi } from '../src/game/api';
import { rectsOverlap } from '../src/core/math';
import { STEP, TILE } from '../src/core/constants';
import { defaultProps } from '../src/core/catalog';
import { Entity } from '../src/game/entity';
import { ActiveRoom } from '../src/game/world';
import { isRegistered } from '../src/game/registry';
import { strike } from '../src/game/projectiles/targets';
import { EnemyProjectile, rowColumnDir } from '../src/game/entities/enemies/common';
import { EYE_DIRS, EyeStatue, eyeStart, eyeVec, hashString, inViewCone, muzzleDistance } from '../src/game/entities/enemies/eye';
import { BladeTrap } from '../src/game/entities/enemies/bladeTrap';
import { Goblin } from '../src/game/entities/enemies/goblin';
import { Snake } from '../src/game/entities/enemies/snake';
import { Beetle, roomHasDrop } from '../src/game/entities/enemies/beetle';
import { Ghost, ghostAlphaAt, ghostPhaseAt } from '../src/game/entities/enemies/ghost';

const DEG = Math.PI / 180;

describe('eye view cone', () => {
  it('eyeVec walks the eight directions clockwise from north', () => {
    const r = (i: number) => { const v = eyeVec(i); return [Math.round(v.x * 100) / 100 + 0, Math.round(v.y * 100) / 100 + 0]; };
    expect(r(0)).toEqual([0, -1]);
    expect(r(1)).toEqual([0.71, -0.71]);
    expect(r(2)).toEqual([1, 0]);
    expect(r(4)).toEqual([0, 1]);
    expect(r(6)).toEqual([-1, 0]);
    expect(r(-1)).toEqual(r(7));
    expect(r(9)).toEqual(r(1));
    expect(EYE_DIRS[4]).toBe('s');
  });

  it('inViewCone accepts targets inside the half-angle and range only', () => {
    const o = { x: 100, y: 100 };
    const at = (deg: number, d: number) => ({ x: o.x + Math.sin(deg * DEG) * d, y: o.y - Math.cos(deg * DEG) * d });
    // Eye looking east (index 2 = 90 degrees).
    expect(inViewCone(o, 2, at(90, 60), 26 * DEG, 160)).toBe(true);
    expect(inViewCone(o, 2, at(110, 60), 26 * DEG, 160)).toBe(true);
    expect(inViewCone(o, 2, at(120, 60), 26 * DEG, 160)).toBe(false);
    expect(inViewCone(o, 2, at(90, 170), 26 * DEG, 160)).toBe(false);
    expect(inViewCone(o, 2, at(270, 20), 26 * DEG, 160)).toBe(false);
    // Diagonal north-east.
    expect(inViewCone(o, 1, at(45, 100), 26 * DEG, 160)).toBe(true);
    expect(inViewCone(o, 1, o, 26 * DEG, 160)).toBe(true);
  });

  it('eight cones of 26 degrees cover every bearing', () => {
    const o = { x: 0, y: 0 };
    for (let deg = 0; deg < 360; deg += 3) {
      const p = { x: Math.sin(deg * DEG) * 50, y: -Math.cos(deg * DEG) * 50 };
      expect(EYE_DIRS.some((_, i) => inViewCone(o, i, p, 26 * DEG, 160))).toBe(true);
    }
  });
});

describe('rowColumnDir', () => {
  const o = { x: 100, y: 100 };
  it('finds the row/column direction within tolerance and range', () => {
    expect(rowColumnDir(o, { x: 160, y: 106 }, 'both', 96, 8)).toBe('right');
    expect(rowColumnDir(o, { x: 40, y: 94 }, 'both', 96, 8)).toBe('left');
    expect(rowColumnDir(o, { x: 104, y: 20 }, 'both', 96, 8)).toBe('up');
    expect(rowColumnDir(o, { x: 96, y: 150 }, 'both', 96, 8)).toBe('down');
    expect(rowColumnDir(o, { x: 160, y: 110 }, 'both', 96, 8)).toBeNull();
    expect(rowColumnDir(o, { x: 200, y: 100 }, 'both', 96, 8)).toBeNull();
    expect(rowColumnDir(o, o, 'both', 96, 8)).toBeNull();
  });

  it('honours the allowed axis', () => {
    expect(rowColumnDir(o, { x: 160, y: 100 }, 'vertical', 96, 8)).toBeNull();
    expect(rowColumnDir(o, { x: 100, y: 160 }, 'horizontal', 96, 8)).toBeNull();
    expect(rowColumnDir(o, { x: 100, y: 160 }, 'vertical', 96, 8)).toBe('down');
  });

  it('prefers the longer offset when lined up on both axes', () => {
    expect(rowColumnDir(o, { x: 106, y: 103 }, 'both', 96, 8)).toBe('right');
    expect(rowColumnDir(o, { x: 103, y: 94 }, 'both', 96, 8)).toBe('up');
  });
});

describe('ghost fade cycle', () => {
  it('cycles visible 2.5 s -> fade -> invisible 1.5 s -> fade', () => {
    expect(ghostPhaseAt(0)).toBe('visible');
    expect(ghostAlphaAt(0)).toBe(1);
    expect(ghostPhaseAt(2.4)).toBe('visible');
    expect(ghostPhaseAt(2.75)).toBe('fadeOut');
    expect(ghostAlphaAt(2.75)).toBeCloseTo(0.575);
    expect(ghostPhaseAt(3.5)).toBe('invisible');
    expect(ghostAlphaAt(3.5)).toBe(0.15);
    expect(ghostPhaseAt(4.75)).toBe('fadeIn');
    expect(ghostPhaseAt(5.1)).toBe('visible');
    expect(ghostAlphaAt(5.1)).toBe(1);
    expect(ghostPhaseAt(-0.1)).toBe('fadeIn');
  });
});

describe('eye muzzle', () => {
  it('starts a beam just clear of the statue in every direction', () => {
    const statue = { x: -8, y: -8, w: 16, h: 16 };
    for (let deg = 0; deg < 360; deg += 5) {
      const aim = { x: Math.sin(deg * DEG), y: -Math.cos(deg * DEG) };
      const d = muzzleDistance(aim, 16, 16, 6, 0.5);
      const beam = { x: aim.x * d - 3, y: aim.y * d - 3, w: 6, h: 6 };
      expect(rectsOverlap(beam, statue)).toBe(false);
      expect(d).toBeLessThanOrEqual(Math.SQRT2 * 11.5 + 1e-9);
    }
    expect(muzzleDistance({ x: 0, y: 1 }, 16, 16, 6, 0.5)).toBe(11.5);
  });
});

// ---------------------------------------------------------------- mock world

const TILES: TileDef[] = (['floor', 'solid', 'pit', 'deep', 'ledge'] as const).map((collision, i) => ({
  id: i + 1, key: collision, name: collision, palette: 'p', frames: [], collision, tags: [],
  ...(collision === 'ledge' ? { ledgeDir: 'down' as const } : {}),
}));
const CHAR_TILE: Record<string, number> = { '.': 1, '#': 2, o: 3, '~': 4, '=': 5 };

/** Stand-in hero: records hits, shield optional. */
class Hero extends Entity {
  state: PlayerApi['state'] = 'normal';
  readonly hits: Hit[] = [];
  shield = false;
  hurtPlayer(hit: Hit): 'hit' | 'blocked' | 'ignored' {
    this.hits.push(hit);
    return this.shield && hit.source?.blockable ? 'blocked' : 'hit';
  }
}

/** Stand-in solid object (a block or chest). */
class Crate extends Entity {
  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst);
    this.solid = true;
  }
}

interface Rig {
  game: GameServices;
  hero: Hero;
  list: Entity[];
  events: GameEvent[];
  sfx: string[];
  drops: { x: number; y: number; kind: string }[];
  add<T extends Entity>(make: (g: GameServices, inst: EntityInstance) => T, type: string, tx: number, ty: number, props?: Record<string, PropValue>): T;
  run(seconds: number, until?: () => boolean): number;
}

/** A 16x14 room from a char grid ('.' floor, '#' wall, 'o' pit, '~' deep water, '=' ledge); missing rows/cols are floor. */
function rig(grid: string[], hero: { tx: number; ty: number }): Rig {
  const cols = 16;
  const rows = 14;
  const bg: number[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) bg.push(CHAR_TILE[grid[y]?.[x] ?? '.'] ?? 1);
  const def: Room = {
    id: 'r', name: 'R', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, entities: [], triggers: [],
    layers: { bg, fg: new Array<number>(bg.length).fill(0), over: new Array<number>(bg.length).fill(0) },
  };
  const world: World = { id: 'w', name: 'W', kind: 'dungeon', music: 'none', rooms: [def] };
  const room = new ActiveRoom({ tiles: TILES }, world, def);
  const list: Entity[] = [];
  const events: GameEvent[] = [];
  const sfx: string[] = [];
  const drops: Rig['drops'] = [];
  let time = 0;
  const game = {
    project: { sprites: [] } as unknown as Project,
    room,
    entities: list,
    get time() { return time; },
    audio: { sfx: (id: string) => sfx.push(id) },
    spawn: <T extends Entity>(e: T) => { list.push(e); return e; },
    solidEntityAt: (r: { x: number; y: number; w: number; h: number }, self: Entity | null) =>
      list.find((e) => e.solid && e !== self && !e.dead && rectsOverlap(e.hitbox(), r)) ?? null,
    emit: (e: GameEvent) => events.push(e),
    effect: () => {},
    dropLoot: (x: number, y: number, kind = 'random') => drops.push({ x, y, kind }),
    setFlag: () => {},
    flag: () => false,
  } as unknown as GameServices & { player: PlayerApi };
  const h = new Hero(game, null, 'player');
  h.team = 'player';
  h.mover = 'player';
  h.x = hero.tx * TILE + 8;
  h.y = hero.ty * TILE + 8;
  (game as { player: PlayerApi }).player = h as unknown as PlayerApi;
  list.push(h);
  let n = 0;
  return {
    game, hero: h, list, events, sfx, drops,
    add(make, type, tx, ty, props = {}) {
      const inst: EntityInstance = { id: `${type}_${n++}`, type, x: tx * TILE + 8, y: ty * TILE + 8, props: { ...defaultProps(type), ...props } };
      return game.spawn(make(game, inst));
    },
    run(seconds, until) {
      let t = 0;
      while (t < seconds - 1e-9) {
        for (const e of [...list]) {
          if (e.dead || e === h) continue;
          e.tickCommon(STEP);
          if (e.stun <= 0 || e.ignoresStun) e.update(STEP);
        }
        for (let i = list.length - 1; i >= 0; i--) if (list[i]!.dead) list.splice(i, 1);
        t += STEP;
        time += STEP;
        if (until?.()) break;
      }
      return t;
    },
  };
}

const shots = (list: Entity[]) => list.filter((e): e is EnemyProjectile => e instanceof EnemyProjectile);

describe('registration', () => {
  it('each module registers its catalog type at import', () => {
    for (const t of ['enemy.goblin', 'enemy.beetle', 'enemy.eye', 'enemy.snake', 'enemy.bladeTrap', 'enemy.ghost']) {
      expect(isRegistered(t)).toBe(true);
    }
  });
});

describe('eye statue', () => {
  /** Statues looking south from the start (the 'facing' prop), for deterministic timing. */
  const SOUTH = { facing: 'down' };

  it('starts along its facing prop, else in a direction seeded from its id', () => {
    expect(eyeStart('up', 0)).toEqual({ dirIndex: EYE_DIRS.indexOf('n'), sweepT: 0 });
    expect(eyeStart('left', 12345).dirIndex).toBe(EYE_DIRS.indexOf('w'));
    expect(eyeStart('toString', 3).dirIndex).toBe(3);
    const starts = Array.from({ length: 16 }, (_, i) => eyeStart(undefined, hashString(`kp_r9_eye_${i}`)));
    expect(new Set(starts.map((s) => s.dirIndex)).size).toBeGreaterThanOrEqual(4);
    for (const s of starts) {
      expect(s.dirIndex).toBeGreaterThanOrEqual(0);
      expect(s.dirIndex).toBeLessThan(8);
      expect(s.sweepT).toBeGreaterThanOrEqual(0);
      expect(s.sweepT).toBeLessThan(0.45);
    }
    expect(hashString('eye')).toBe(hashString('eye'));
  });

  it('statues in one room do not sweep in lockstep', () => {
    const r = rig([], { tx: 1, ty: 12 });
    const eyes = [0, 1, 2, 3].map((i) => r.add((g, inst) => new EyeStatue(g, { ...inst, id: `kp_r9_eye_${i}` }), 'enemy.eye', 3 + 3 * i, 4));
    const traces = eyes.map(() => [] as string[]);
    for (let i = 0; i < 40; i++) {
      r.run(0.1);
      eyes.forEach((e, k) => traces[k]!.push(e.eyeDir));
    }
    expect(new Set(traces.map((t) => t.join())).size).toBeGreaterThan(1);
  });

  it('gives a hero it faces a moment after waking before it locks on', () => {
    const r = rig([], { tx: 8, ty: 10 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 4, SOUTH);
    r.run(0.4 + 0.2);
    expect(eye.isCharging).toBe(false);
    r.run(0.2);
    expect(eye.isCharging).toBe(true);
    expect(eye.eyeDir).toBe('s');
  });

  it('fires an unblockable beam at a hero inside its cone with clear sight', () => {
    const r = rig([], { tx: 8, ty: 10 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 4, SOUTH);
    expect(eye.eyeDir).toBe('s');
    expect(eye.solid).toBe(true);
    r.run(2, () => eye.isCharging);
    expect(eye.isCharging).toBe(true);
    r.run(1, () => shots(r.list).length > 0);
    const [beam] = shots(r.list);
    expect(beam).toBeDefined();
    expect(beam!.sprite).toBe('proj.beam');
    expect(beam!.blockable).toBe(false);
    expect(beam!.kind).toBe('beam');
    expect(beam!.vy).toBeGreaterThan(150);
    expect(Math.abs(beam!.vx)).toBeLessThan(1);
    r.run(1, () => r.hero.hits.length > 0);
    expect(r.hero.hits[0]?.damage).toBe(2);
  });

  it('never fires through a wall, and waits out its cooldown between shots', () => {
    const blocked = rig(['', '', '', '', '', '', '################'], { tx: 8, ty: 10 });
    blocked.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 4);
    blocked.run(5);
    expect(shots(blocked.list)).toHaveLength(0);

    const open = rig([], { tx: 8, ty: 7 });
    open.hero.shield = true;
    const eye = open.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 4, { ...SOUTH, cooldown: 3 });
    const fired: number[] = [];
    let t = 0;
    let seen = 0;
    while (t < 6) {
      t += open.run(STEP);
      const count = open.sfx.filter((s) => s === 'magic').length;
      if (count > seen) fired.push(t);
      seen = count;
    }
    expect(eye.eyeDir).toBeDefined();
    expect(fired.length).toBeGreaterThanOrEqual(2);
    expect(fired[1]! - fired[0]!).toBeGreaterThanOrEqual(3);
  });

  it('sweeps round to a hero standing behind it', () => {
    const r = rig([], { tx: 8, ty: 1 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 6, SOUTH);
    r.run(1.5);
    expect(eye.isCharging).toBe(false);
    r.run(4, () => eye.isCharging);
    expect(eye.isCharging).toBe(true);
    expect(eye.eyeDir).toBe('n');
  });

  it('locks its aim when the charge starts, so a sidestep dodges the beam', () => {
    const r = rig([], { tx: 8, ty: 10 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 4, SOUTH);
    r.run(2, () => eye.isCharging);
    r.hero.x += 40;
    r.run(1, () => shots(r.list).length > 0);
    const [beam] = shots(r.list);
    expect(Math.abs(beam!.vx)).toBeLessThan(1);
    expect(beam!.vy).toBeGreaterThan(150);
    r.run(1.5);
    expect(r.hero.hits).toHaveLength(0);
  });

  it('fires diagonal beams that clear its own body', () => {
    const r = rig([], { tx: 12, ty: 10 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 6, SOUTH);
    r.run(5, () => shots(r.list).length > 0);
    const [beam] = shots(r.list);
    expect(beam).toBeDefined();
    expect(eye.eyeDir).toBe('se');
    expect(beam!.vx).toBeGreaterThan(100);
    expect(beam!.vy).toBeGreaterThan(100);
    r.run(1, () => r.hero.hits.length > 0);
    expect(r.hero.hits).toHaveLength(1);
  });

  it('shrugs off weapons', () => {
    const r = rig([], { tx: 2, ty: 2 });
    const eye = r.add((g, i) => new EyeStatue(g, i), 'enemy.eye', 8, 6);
    expect(eye.hurt({ damage: 4, kind: 'sword', source: null, dx: 1, dy: 0 })).toBe(false);
    expect(r.sfx).toContain('swordTink');
    expect(eye.dead).toBe(false);
  });
});

describe('blade trap', () => {
  const corridor = ['################', '#..............#', '################'];

  it('slides at a lined-up hero until the wall, then retracts home', () => {
    const r = rig(corridor, { tx: 9, ty: 1 });
    const trap = r.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 1, 1, { range: 32 });
    r.run(1, () => trap.phase === 'slide');
    expect(trap.facing).toBe('right');
    r.hero.x = -100; // step aside so the slide isn't about the hero
    r.run(2, () => trap.phase === 'hold');
    expect(trap.right).toBe(15 * TILE);
    r.run(0.5, () => trap.phase === 'retract');
    const t = r.run(10, () => trap.phase === 'idle');
    expect(t).toBeGreaterThan(4);
    expect(trap.x).toBe(24);
    expect(trap.y).toBe(24);
  });

  it('stops at its range and at other traps, ignoring pits', () => {
    const r = rig(['################', '#...oo.........#', '################'], { tx: 6, ty: 1 });
    const trap = r.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 1, 1, { range: 6 });
    r.run(1, () => trap.phase === 'slide');
    r.hero.x = -100;
    r.run(3, () => trap.phase === 'hold');
    expect(trap.x).toBe(24 + 6 * TILE);

    const two = rig(corridor, { tx: 7, ty: 1 });
    const a = two.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 1, 1, { range: 32 });
    const b = two.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 14, 1, { range: 32 });
    two.run(1, () => a.phase === 'slide' && b.phase === 'slide');
    two.hero.x = -100;
    two.run(2, () => a.phase !== 'slide' && b.phase !== 'slide');
    expect(a.right).toBe(b.left);
  });

  it('stays put, without clanking, when a solid object sits right in front of it', () => {
    const r = rig(corridor, { tx: 9, ty: 1 });
    const trap = r.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 1, 1, { range: 32 });
    const crate = r.add((g, i) => new Crate(g, i), 'obj.block', 2, 1);
    expect(crate.solid).toBe(true);
    r.run(2);
    expect(trap.phase).toBe('idle');
    expect(trap.x).toBe(24);
    expect(r.sfx).not.toContain('swordTink');
  });

  it('a solid object moved into its lane holds the retract until the way clears', () => {
    const r = rig(corridor, { tx: 9, ty: 1 });
    const trap = r.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 1, 1, { range: 32 });
    r.run(1, () => trap.phase === 'slide');
    r.hero.x = -100;
    r.run(2, () => trap.phase === 'retract');
    const crate = r.add((g, i) => new Crate(g, i), 'obj.block', 5, 1);
    r.run(8);
    expect(trap.phase).toBe('retract');
    expect(trap.left).toBe(crate.right);
    crate.dead = true;
    r.run(8, () => trap.phase === 'idle');
    expect(trap.phase).toBe('idle');
    expect(trap.x).toBe(24);
  });

  it('only triggers on its axis and is invulnerable', () => {
    const r = rig([], { tx: 8, ty: 9 });
    const trap = r.add((g, i) => new BladeTrap(g, i), 'enemy.bladeTrap', 8, 3, { axis: 'horizontal' });
    r.run(1);
    expect(trap.phase).toBe('idle');
    expect(trap.hurt({ damage: 2, kind: 'sword', source: null, dx: 0, dy: 1 })).toBe(false);
    expect(trap.countsForClear).toBe(false);
    expect(trap.contactDamage).toBe(2);
  });
});

describe('snake', () => {
  it('dashes straight at a lined-up hero and stops at the wall', () => {
    const r = rig(['', '', '', '', '', '################'], { tx: 8, ty: 1 });
    const snake = r.add((g, i) => new Snake(g, i), 'enemy.snake', 8, 4);
    r.run(1, () => snake.phase === 'dash');
    expect(snake.phase).toBe('dash');
    expect(snake.facing).toBe('up');
    r.hero.x = -100;
    const x0 = snake.x;
    r.run(1, () => snake.phase === 'rest');
    expect(snake.top).toBe(0);
    expect(snake.x).toBe(x0);
  });

  it('slithers for a moment before it can dash again', () => {
    const r = rig([], { tx: 8, ty: 9 });
    const snake = r.add((g, i) => new Snake(g, i), 'enemy.snake', 8, 4);
    r.run(1, () => snake.phase === 'dash');
    expect(snake.facing).toBe('down');
    r.run(2, () => snake.phase === 'rest');
    expect(snake.phase).toBe('rest');
    // Keep the hero lined up two tiles away the whole time.
    const wait = r.run(3, () => {
      r.hero.x = snake.x;
      r.hero.y = snake.y - 2 * TILE;
      return snake.phase === 'dash';
    });
    expect(snake.phase).toBe('dash');
    expect(wait).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('ignores a hero out of line or behind a wall', () => {
    const r = rig(['', '', '', '################'], { tx: 8, ty: 1 });
    const snake = r.add((g, i) => new Snake(g, i), 'enemy.snake', 8, 6);
    let dashed = false;
    r.run(3, () => { dashed ||= snake.phase === 'dash'; return false; });
    expect(dashed).toBe(false);
  });
});

describe('goblin', () => {
  it('plants its feet and throws a blockable spear when lined up', () => {
    const r = rig([], { tx: 12, ty: 5 });
    const gob = r.add((g, i) => new Goblin(g, i), 'enemy.goblin', 7, 5);
    expect(gob.hp).toBe(4);
    r.run(2, () => gob.phase === 'aim');
    expect(gob.facing).toBe('right');
    expect(gob.anim).toBe('throw_right');
    const x = gob.x;
    r.run(1, () => shots(r.list).length > 0);
    expect(gob.x).toBe(x);
    const [spear] = shots(r.list);
    expect(spear!.sprite).toBe('proj.spear');
    expect(spear!.anim).toBe('right');
    expect(spear!.blockable).toBe(true);
    r.hero.shield = true;
    r.run(1, () => r.hero.hits.length > 0);
    expect(spear!.isDeflected).toBe(true);
  });

  it('holds a standing pose after the throw, the spear leaving from fist height', () => {
    const r = rig([], { tx: 12, ty: 5 });
    const gob = r.add((g, i) => new Goblin(g, i), 'enemy.goblin', 7, 5);
    r.run(2, () => shots(r.list).length > 0);
    expect(gob.phase).toBe('recover');
    expect(gob.anim).toBe('walk_right');
    expect(shots(r.list)[0]!.z).toBeGreaterThan(8);
  });

  it('a hit while aiming breaks the stance and delays the next throw', () => {
    const r = rig([], { tx: 12, ty: 5 });
    const gob = r.add((g, i) => new Goblin(g, i), 'enemy.goblin', 7, 5);
    r.run(2, () => gob.phase === 'aim');
    expect(gob.hurt({ damage: 1, kind: 'sword', source: null, dx: -1, dy: 0 })).toBe(true);
    expect(gob.phase).toBe('walk');
    expect(gob.anim).toBe('walk_right');
    r.run(0.75);
    expect(shots(r.list)).toHaveLength(0);
    // Line the hero up again (it may have wandered off the row): it throws once the stagger is over.
    r.hero.x = gob.x + 48;
    r.hero.y = gob.y;
    r.run(1, () => shots(r.list).length > 0);
    expect(shots(r.list)).toHaveLength(1);
  });

  it('takes four sword hits', () => {
    const r = rig([], { tx: 1, ty: 1 });
    const gob = r.add((g, i) => new Goblin(g, i), 'enemy.goblin', 8, 8);
    for (let i = 0; i < 3; i++) {
      gob.hurt({ damage: 1, kind: 'sword', source: null, dx: 1, dy: 0 });
      r.run(0.5);
    }
    expect(gob.dead).toBe(false);
    gob.hurt({ damage: 1, kind: 'sword', source: null, dx: 1, dy: 0 });
    expect(gob.dead).toBe(true);
  });
});

describe('shell beetle', () => {
  it('creeps toward the hero and is knocked 48 px without damage', () => {
    const r = rig([], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 4, 7);
    const x0 = b.x;
    r.run(2);
    expect(b.x).toBeGreaterThan(x0 + 15);
    const x1 = b.x;
    expect(b.hurt({ damage: 3, kind: 'sword', source: null, dx: -1, dy: 0 })).toBe(true);
    r.run(0.35);
    expect(b.x).toBeCloseTo(x1 - 48, 0);
    expect(b.hp).toBe(1);
    expect(r.sfx).toContain('swordTink');
  });

  it('dies only when a knockback leaves it over a pit', () => {
    const r = rig(['', '', '', '', '', '', '', '..oo'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7);
    r.run(0.5);
    expect(b.countsForClear).toBe(true);
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: -1, dy: 0 });
    r.run(0.4);
    expect(b.falling).toBe(true);
    expect(b.contactDamage).toBe(0);
    r.run(1, () => b.dead);
    expect(b.dead).toBe(true);
    expect(r.events).toContainEqual({ type: 'defeated', id: b.id, entityType: 'enemy.beetle' });
  });

  it('drops in mid-shove rather than sliding across a 2-wide pit', () => {
    const r = rig(['', '', '', '', '', '', '', '....oo'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7);
    b.x = 6 * TILE + 7; // hitbox touching the pit's right rim
    r.run(0.4);
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: -1, dy: 0 });
    r.run(0.35);
    expect(b.falling).toBe(true);
    expect(b.x).toBeGreaterThan(4 * TILE);
    expect(b.x).toBeLessThan(6 * TILE);
    expect(b.kbTime).toBe(0);
  });

  it('drops in even when shoved before it wakes, while stunned', () => {
    const r = rig(['', '', '', '', '', '', '', '....oo'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7);
    expect(b.wakeT).toBeGreaterThan(0);
    b.hurt({ damage: 0, kind: 'boomerang', source: null, dx: -1, dy: 0, stun: 2 });
    r.run(0.35);
    expect(b.falling).toBe(true);
    r.run(1, () => b.dead);
    expect(b.dead).toBe(true);
  });

  it('is shoved along the main axis of the hit', () => {
    const r = rig([], { tx: 1, ty: 1 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7);
    const y0 = b.y;
    const x0 = b.x;
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: 0.91, dy: 0.41 });
    r.run(0.35);
    expect(b.y).toBe(y0);
    expect(b.x).toBeCloseTo(x0 + 48, 5);
  });

  it('counts toward clearing the room only when there is a pit or deep water to push it into', () => {
    const dry = rig([], { tx: 1, ty: 1 });
    expect(roomHasDrop(dry.game.room)).toBe(false);
    expect(dry.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7).countsForClear).toBe(false);
    const pit = rig(['', '', '', '', '', '', '', '', '', '', '', '', '', '..............oo'], { tx: 1, ty: 1 });
    expect(roomHasDrop(pit.game.room)).toBe(true);
    expect(pit.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7).countsForClear).toBe(true);
    const lake = rig(['', '~~'], { tx: 1, ty: 1 });
    expect(roomHasDrop(lake.game.room)).toBe(true);
  });

  it('leaves its loot on the floor beside the pit it fell into', () => {
    const r = rig(['', '', '', '', '', '', 'oooo', 'oooo', 'oooo'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 5, 7, { drop: 'heart' });
    r.run(0.4);
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: -1, dy: 0 });
    r.run(1.5, () => b.dead);
    expect(b.dead).toBe(true);
    expect(r.drops).toHaveLength(1);
    const d = r.drops[0]!;
    expect(d.kind).toBe('heart');
    expect(r.game.room.blocked({ x: d.x - 7, y: d.y - 6, w: 14, h: 12 }, 'walker')).toBe(false);
    expect(Math.hypot(d.x - b.x, d.y - b.y)).toBeLessThan(24);
  });

  it('walks off a pit rim it was left overlapping', () => {
    const r = rig(['', '', '', '', '', '', '', '..oo'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 4, 7);
    b.x = 4 * TILE + 4; // centre on floor, hitbox over the pit's right edge
    r.run(2);
    expect(b.falling).toBe(false);
    expect(b.x).toBeGreaterThan(4 * TILE + 20);
  });

  it('never creeps into a pit on its own, even from the rim', () => {
    const chasm = new Array<string>(14).fill('..oo');
    const r = rig(chasm, { tx: 0, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 4, 7);
    r.run(3);
    expect(b.falling).toBe(false);
    expect(b.left).toBe(4 * TILE);
    b.x = 4 * TILE + 4; // left partly over the pit, hero straight across it
    r.run(3);
    expect(b.falling).toBe(false);
    expect(b.x).toBeGreaterThanOrEqual(4 * TILE);
  });

  it('is stopped short of a ledge by a shove, and keeps creeping afterwards', () => {
    const r = rig(['', '', '', '', '', '', '', '', '', '================'], { tx: 8, ty: 12 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 8, 7);
    r.run(0.4);
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: 0, dy: 1 });
    r.run(0.35);
    expect(b.bottom).toBe(9 * TILE);
    expect(b.kbTime).toBe(0);
    const at = { x: b.x, y: b.y };
    r.hero.x = 2 * TILE + 8;
    r.hero.y = 8 * TILE + 8;
    r.run(2);
    expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeGreaterThan(20);
    expect(b.bottom).toBeLessThanOrEqual(9 * TILE);
  });

  it('walks clear of a ledge it was placed on', () => {
    const r = rig(['', '', '', '', '', '', '', '================'], { tx: 8, ty: 1 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 8, 7);
    expect(r.game.room.collisionAt(b.x, b.y)).toBe('ledge');
    r.run(3);
    expect(b.bottom).toBeLessThanOrEqual(7 * TILE);
  });

  it('never walks from a ledge it was placed on into the pit beside it', () => {
    const edge = ['', '', '', '', '', '', '', '================', 'oooooooooooooooo', 'oooooooooooooooo'];
    const r = rig(edge, { tx: 8, ty: 12 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 8, 7);
    expect(r.game.room.collisionAt(b.x, b.y)).toBe('ledge');
    r.run(3);
    expect(b.falling).toBe(false);
    expect(r.game.room.collisionAt(b.x, b.y)).not.toBe('pit');
  });

  it('sinks when shoved into deep water', () => {
    const r = rig(['', '', '', '', '', '', '', '~~~~'], { tx: 12, ty: 7 });
    const b = r.add((g, i) => new Beetle(g, i), 'enemy.beetle', 6, 7);
    r.run(0.5);
    b.hurt({ damage: 1, kind: 'sword', source: null, dx: -1, dy: 0 });
    r.run(1.5, () => b.dead);
    expect(b.dead).toBe(true);
    expect(r.sfx).toContain('splash');
  });
});

describe('ghost', () => {
  it('drifts through walls toward the hero', () => {
    const r = rig(['', '', '', '', '', '', '', '', '########'], { tx: 4, ty: 11 });
    const g = r.add((gm, i) => new Ghost(gm, i), 'enemy.ghost', 4, 5);
    r.run(3);
    expect(g.y).toBeGreaterThan(5 * TILE + 8 + 40);
  });

  it('is thin air to hero attacks while faded (they pass instead of glancing off)', () => {
    const r = rig([], { tx: 1, ty: 1 });
    const g = r.add((gm, i) => new Ghost(gm, i), 'enemy.ghost', 8, 8);
    r.run(6, () => g.phase === 'invisible');
    r.run(0.1);
    expect(g.team).toBe('neutral');
    expect(strike(g, { damage: 1, kind: 'arrow', source: null, dx: 0, dy: -1 })).toBe('pass');
    expect(g.hp).toBe(2);
    r.run(6, () => g.phase === 'visible');
    r.run(0.1);
    expect(g.team).toBe('enemy');
    expect(strike(g, { damage: 1, kind: 'arrow', source: null, dx: 0, dy: -1 })).toBe('hit');
    expect(g.hp).toBe(1);
  });

  it('drops its loot on the floor, not inside the wall it died over', () => {
    const r = rig(['', '', '', '', '################', '################'], { tx: 8, ty: 12 });
    const g = r.add((gm, i) => new Ghost(gm, i), 'enemy.ghost', 8, 4, { drop: 'rupee5' });
    r.run(6, () => g.phase === 'visible' && g.tangible);
    g.x = 8 * TILE + 8;
    g.y = 4 * TILE + 8;
    g.hurt({ damage: 2, kind: 'arrow', source: null, dx: 0, dy: -1, knockback: 0 });
    expect(g.dead).toBe(true);
    expect(r.drops).toHaveLength(1);
    const d = r.drops[0]!;
    expect(r.game.room.blocked({ x: d.x - 6, y: d.y - 6, w: 12, h: 12 }, 'walker')).toBe(false);
    expect(d.y).toBeLessThan(4 * TILE);
    expect(r.events).toContainEqual({ type: 'defeated', id: g.id, entityType: 'enemy.ghost' });
  });

  it('is untouchable and harmless while faded', () => {
    const r = rig([], { tx: 1, ty: 1 });
    const g = r.add((gm, i) => new Ghost(gm, i), 'enemy.ghost', 8, 8);
    r.run(6, () => g.phase === 'invisible');
    r.run(0.1);
    expect(g.tangible).toBe(false);
    expect(g.contactDamage).toBe(0);
    expect(g.hurt({ damage: 1, kind: 'sword', source: null, dx: 1, dy: 0 })).toBe(false);
    r.run(6, () => g.phase === 'visible');
    r.run(0.1);
    expect(g.tangible).toBe(true);
    expect(g.contactDamage).toBe(1);
    expect(g.hurt({ damage: 1, kind: 'sword', source: null, dx: 1, dy: 0 })).toBe(true);
    expect(g.hp).toBe(1);
  });
});
