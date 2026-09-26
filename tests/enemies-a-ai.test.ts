// Enemies group A: the shared toolkit in enemies/common.ts (pure helpers, Enemy
// base-class sensing & movement, EnemyProjectile) and the behaviour of soldier,
// archer, spitter, bat, skeleton and slime. Everything runs against a mock
// GameServices on a real ActiveRoom, so tile collision and line of sight follow
// the engine's rules. The shared gameplay RNG is replaced by a seeded one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dir, EntityInstance, Project, PropValue, Room, SpriteDef, TileDef, World } from '../src/core/types';
import type { GameEvent, GameServices, Hit, PlayerApi, PlayerState, Renderer } from '../src/game/api';
import { DIR_VEC, rectsOverlap } from '../src/core/math';
import { STEP, TILE } from '../src/core/constants';
import { Rng, rng } from '../src/core/rng';
import { defaultProps } from '../src/core/catalog';
import { Entity } from '../src/game/entity';
import { ActiveRoom } from '../src/game/world';
import { isRegistered, registerEntity } from '../src/game/registry';
import {
  Enemy, EnemyProjectile, SPAWN_DELAY, enemyKeyId, hopArc, lineOfSight, pickWanderDir, projectileAnim, safeShove, variantPalette,
} from '../src/game/entities/enemies/common';
import '../src/game/entities/enemies/index';
import { Soldier } from '../src/game/entities/enemies/soldier';
import { Archer } from '../src/game/entities/enemies/archer';
import { Spitter } from '../src/game/entities/enemies/spitter';
import { Bat } from '../src/game/entities/enemies/bat';
import { Skeleton } from '../src/game/entities/enemies/skeleton';
import { Slime } from '../src/game/entities/enemies/slime';

// ---------------------------------------------------------------- mock world

const COLLISIONS = { '.': 'floor', '#': 'solid', o: 'pit', '~': 'deep', '^': 'hurt' } as const;
type Cell = keyof typeof COLLISIONS;
const CELLS = Object.keys(COLLISIONS) as Cell[];
const TILES: TileDef[] = CELLS.map((c, i) => ({
  id: i + 1, key: COLLISIONS[c], name: COLLISIONS[c], palette: 'p', frames: [], collision: COLLISIONS[c], tags: [],
}));

/** One test sprite so holdFrame() has an fps to work with. */
const TEST_SPRITE: SpriteDef = {
  id: 'test.sprite', name: 'Test', palette: 'p', w: 16, h: 16, ox: 8, oy: 8, frames: [], tags: [],
  anims: { idle: { frames: [0, 1, 2, 3], fps: 4, loop: true } },
};

/** Stand-in for obj.pickup (objects are not loaded here): placed pickups show up in the rig's list. */
class PickupStub extends Entity {}
registerEntity('obj.pickup', (game, inst) => new PickupStub(game, inst));
/** Ids and items of the placed pickups in a rig's list. */
const placedPickups = (list: Entity[]): [string, PropValue][] =>
  ofType(list, PickupStub).map((e) => [e.id, e.prop('item', '')]);

/** Stand-in hero: records landed hits; blocks blockable shots from the front when `shield` is on. */
class Hero extends Entity {
  state: PlayerState = 'normal';
  readonly hits: Hit[] = [];
  blocks = 0;
  shield = false;

  hurtPlayer(hit: Hit): 'hit' | 'blocked' | 'ignored' {
    if (this.invuln > 0) return 'ignored';
    const f = DIR_VEC[this.facing];
    if (this.shield && hit.source?.blockable && f.x * hit.dx + f.y * hit.dy < -0.5) {
      this.blocks++;
      return 'blocked';
    }
    this.hits.push(hit);
    this.invuln = 1;
    return 'hit';
  }
}

/** Minimal concrete enemy exposing the toolkit. */
class Dummy extends Enemy {
  thinks = 0;
  protected think(): void {
    this.thinks++;
  }
}

interface Rig {
  game: GameServices;
  hero: Hero;
  list: Entity[];
  events: GameEvent[];
  sfx: string[];
  effects: string[];
  loot: { x: number; y: number; kind: string }[];
  add<T extends Entity>(make: (g: GameServices, inst: EntityInstance) => T, type: string, tx: number, ty: number, props?: Record<string, PropValue>): T;
  /** Advance up to `seconds` (engine tick order + contact damage); stops early once `until` is true. */
  run(seconds: number, until?: () => boolean): number;
}

/** A 16x14 room from a char grid ('.' floor, '#' wall, 'o' pit, '~' deep water, '^' spikes); missing cells are floor. */
function rig(grid: string[], hero: { tx: number; ty: number; facing?: Dir }): Rig {
  const cols = 16;
  const rows = 14;
  const bg: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) bg.push(CELLS.indexOf((grid[y]?.[x] ?? '.') as Cell) + 1 || 1);
  }
  const def: Room = {
    id: 'r', name: 'R', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, entities: [], triggers: [],
    layers: { bg, fg: new Array<number>(bg.length).fill(0), over: new Array<number>(bg.length).fill(0) },
  };
  const world: World = { id: 'w', name: 'W', kind: 'dungeon', music: 'none', rooms: [def] };
  const room = new ActiveRoom({ tiles: TILES }, world, def);
  const list: Entity[] = [];
  const events: GameEvent[] = [];
  const sfx: string[] = [];
  const effects: string[] = [];
  const loot: { x: number; y: number; kind: string }[] = [];
  let time = 0;
  const game = {
    project: { sprites: [TEST_SPRITE] } as unknown as Project,
    room,
    entities: list,
    get time() { return time; },
    audio: { sfx: (id: string) => sfx.push(id) },
    spawn: <T extends Entity>(e: T) => { list.push(e); return e; },
    findEntity: (id: string) => list.find((e) => e.id === id),
    solidEntityAt: (r: { x: number; y: number; w: number; h: number }, self: Entity | null) =>
      list.find((e) => e.solid && e !== self && !e.dead && rectsOverlap(e.hitbox(), r)) ?? null,
    emit: (e: GameEvent) => events.push(e),
    effect: (sprite: string) => effects.push(sprite),
    dropLoot: (x: number, y: number, kind = 'random') => loot.push({ x, y, kind }),
    setFlag: () => {},
    flag: () => false,
  } as unknown as GameServices & { player: PlayerApi };
  const h = new Hero(game, null, 'player');
  h.team = 'player';
  h.mover = 'player';
  h.x = hero.tx * TILE + 8;
  h.y = hero.ty * TILE + 8;
  h.facing = hero.facing ?? 'up';
  (game as { player: PlayerApi }).player = h as unknown as PlayerApi;
  list.push(h);
  let n = 0;
  return {
    game, hero: h, list, events, sfx, effects, loot,
    add(make, type, tx, ty, props = {}) {
      const inst: EntityInstance = { id: `${type}_${n++}`, type, x: tx * TILE + 8, y: ty * TILE + 8, props: { ...defaultProps(type), ...props } };
      return game.spawn(make(game, inst));
    },
    run(seconds, until) {
      let t = 0;
      while (t < seconds - 1e-9) {
        for (const e of [...list]) {
          if (e.dead) continue;
          e.tickCommon(STEP);
          if (e !== h && (e.stun <= 0 || e.ignoresStun)) e.update(STEP);
        }
        for (const e of list) {
          if (e.team !== 'enemy' || e.contactDamage <= 0 || e.dead || e.stun > 0 || e.z >= 8 || !e.overlaps(h)) continue;
          h.hurtPlayer({ damage: e.contactDamage, kind: 'contact', source: e, dx: 0, dy: 0 });
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

const dummy = (r: Rig, tx: number, ty: number): Dummy => r.add((g, i) => new Dummy(g, i), 'enemy.test', tx, ty);
const shots = (list: Entity[]): EnemyProjectile[] => list.filter((e): e is EnemyProjectile => e instanceof EnemyProjectile);
const ofType = <T extends Entity>(list: Entity[], cls: abstract new (...args: never[]) => T): T[] =>
  list.filter((e): e is T => e instanceof cls);

beforeEach(() => {
  const seeded = new Rng(0xc0ffee);
  vi.spyOn(rng, 'next').mockImplementation(() => seeded.next());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- pure helpers

describe('pure helpers', () => {
  it('variantPalette maps catalog variants to palette swaps', () => {
    expect(variantPalette('enemy.soldier', 'blue')).toBe('pal.soldier.blue');
    expect(variantPalette('enemy.soldier', 'red')).toBe('pal.soldier.red');
    expect(variantPalette('enemy.soldier', 'green')).toBeUndefined();
    expect(variantPalette('enemy.spitter', 'blue')).toBe('pal.spitter.blue');
    expect(variantPalette('enemy.slime', 'purple')).toBeUndefined();
    expect(variantPalette('enemy.nobody', 'blue')).toBeUndefined();
  });

  it('lineOfSight: solid tiles and the room edge block, pits and water do not', () => {
    const { game } = rig(['', '', '', '', '', '....#...........', '....o~..........'], { tx: 0, ty: 0 });
    const room = game.room;
    expect(lineOfSight(room, 8, 88, 120, 88)).toBe(false);
    expect(lineOfSight(room, 8, 104, 120, 104)).toBe(true);
    expect(lineOfSight(room, 40, 40, 200, 150)).toBe(true);
    expect(lineOfSight(room, 100, 100, 300, 100)).toBe(false);
    expect(lineOfSight(room, 50, 50, 50, 50)).toBe(true);
  });

  it('pickWanderDir never turns straight back unless boxed in', () => {
    const free: Dir[] = ['up', 'down', 'left'];
    for (let i = 0; i < 20; i++) expect(pickWanderDir(free, 'up', i / 20)).not.toBe('down');
    expect(pickWanderDir(['down'], 'up', 0.5)).toBe('down');
    expect(pickWanderDir([], 'up', 0.5)).toBeNull();
    expect(pickWanderDir(['left', 'right'], null, 0)).toBe('left');
    expect(pickWanderDir(['left', 'right'], null, 0.999)).toBe('right');
  });

  it('hopArc peaks at the height half-way and lands at the duration', () => {
    const { vz, gravity } = hopArc(8, 0.4);
    const z = (t: number) => vz * t - (gravity * t * t) / 2;
    expect(z(0.2)).toBeCloseTo(8);
    expect(z(0.4)).toBeCloseTo(0);
  });

  it('projectileAnim points arrows and spears, spins bones, flies the rest', () => {
    expect(projectileAnim('proj.arrow', 100, 0)).toBe('right');
    expect(projectileAnim('proj.arrow', -100, 5)).toBe('left');
    expect(projectileAnim('proj.spear', 0, -80)).toBe('up');
    expect(projectileAnim('proj.bone', 30, 30)).toBe('spin');
    expect(projectileAnim('proj.rock', 0, 90)).toBe('fly');
    expect(projectileAnim('proj.fireball', 1, 1)).toBe('fly');
  });

  it('safeShove stops short of pits and spikes, and the full distance on open floor', () => {
    const r = rig(['', '', '....o...^.......'], { tx: 0, ty: 0 });
    const room = r.game.room;
    const y = 2 * TILE + 8;
    expect(safeShove(room, 8, y, 1, 0, 8)).toBe(8);
    // Pit from x=64: the shove from x=56 halts 2 px before it.
    expect(safeShove(room, 56, y, 1, 0, 8)).toBe(5);
    expect(safeShove(room, 63, y, 1, 0, 8)).toBe(0);
    expect(safeShove(room, 120, y, 1, 0, 10)).toBe(5);
    expect(safeShove(room, 120, y, -1, 0, 10)).toBe(10);
  });
});

// ---------------------------------------------------------------- Enemy base

describe('Enemy lifecycle', () => {
  it('waits out the spawn grace before thinking or dealing contact damage', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const d = dummy(r, 8, 4);
    d.touchDamage = 2;
    expect(d.team).toBe('enemy');
    r.run(SPAWN_DELAY - 0.05);
    expect(d.thinks).toBe(0);
    expect(d.contactDamage).toBe(0);
    r.run(0.1);
    expect(d.thinks).toBeGreaterThan(0);
    expect(d.contactDamage).toBe(2);
  });

  it('never contact-hits a hero standing on its spawn point during the grace', () => {
    const r = rig([], { tx: 8, ty: 8 });
    dummy(r, 8, 8);
    r.run(SPAWN_DELAY - 0.05);
    expect(r.hero.hits).toHaveLength(0);
    r.run(0.2);
    expect(r.hero.hits).toHaveLength(1);
  });

  it('freezes its animation while stunned and draws with a sideways shake', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const d = dummy(r, 8, 4);
    d.sprite = 'test.sprite';
    d.play('idle');
    d.animT = 0.3;
    d.stun = 0.5;
    d.tickCommon(STEP);
    expect(d.animT).toBe(0.3);
    const xs: number[] = [];
    const renderer = { drawSpriteAnim: (_s: string, _a: string, _t: number, x: number) => xs.push(x), drawShadow: () => {} } as unknown as Renderer;
    d.draw(renderer);
    r.run(1 / 30);
    d.stun = 0.5;
    d.draw(renderer);
    expect(xs.map((x) => x - d.x).sort()).toEqual([-1, 1]);
    expect(d.x).toBe(8 * TILE + 8);
  });

  it('artLift raises the sprite but keeps the airborne shadow at the footprint', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const d = dummy(r, 8, 4);
    d.sprite = 'test.sprite';
    d.artLift = 3;
    d.z = 4;
    const sprites: number[] = [];
    const shadows: number[] = [];
    const renderer = {
      drawSpriteAnim: (_s: string, _a: string, _t: number, _x: number, y: number) => sprites.push(y),
      drawShadow: (_x: number, y: number) => shadows.push(y),
    } as unknown as Renderer;
    d.draw(renderer);
    expect(sprites).toEqual([Math.round(d.y - d.z) - 3]);
    expect(shadows).toEqual([d.y + d.h / 2 - 1]);
    expect(d.y).toBe(4 * TILE + 8);
    expect(d.shadow).toBe(true);
  });

  it('holdFrame shows one frame of an anim', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const d = dummy(r, 8, 4);
    d.sprite = 'test.sprite';
    d.holdFrame('idle', 2);
    expect(d.anim).toBe('idle');
    expect(Math.floor(d.animT * 4)).toBe(2);
  });

  it('onHurt runs only for hits that land without killing', () => {
    class Tough extends Dummy {
      hurts = 0;
      protected override onHurt(): void {
        this.hurts++;
      }
    }
    const r = rig([], { tx: 8, ty: 12 });
    const e = r.add((g, i) => new Tough(g, i), 'enemy.test', 8, 4);
    e.hp = 2;
    const hit: Hit = { damage: 1, kind: 'sword', source: null, dx: 0, dy: -1 };
    expect(e.hurt(hit)).toBe(true);
    expect(e.hurts).toBe(1);
    expect(e.hurt(hit)).toBe(false);
    r.run(0.4);
    expect(e.hurt(hit)).toBe(true);
    expect(e.dead).toBe(true);
    expect(e.hurts).toBe(1);
    expect(r.effects).toContain('fx.poof');
  });
});

describe('Enemy senses', () => {
  it('seesHero needs range and a clear line; frontOnly ignores a hero behind', () => {
    const r = rig(['', '', '', '', '', '', '', '########........'], { tx: 8, ty: 9 });
    const d = dummy(r, 8, 5);
    d.facing = 'down';
    expect(d.seesHero(5 * TILE)).toBe(true);
    expect(d.seesHero(3 * TILE)).toBe(false);
    expect(d.seesHero(5 * TILE, true)).toBe(true);
    d.facing = 'up';
    expect(d.seesHero(5 * TILE, true)).toBe(false);
    r.hero.x = 1 * TILE + 8;
    expect(d.seesHero(10 * TILE)).toBe(false);
    r.hero.state = 'dead';
    r.hero.x = 8 * TILE + 8;
    expect(d.seesHero(10 * TILE)).toBe(false);
  });

  it('lineUpDir closes the smaller offset, then heads straight at a lined-up target', () => {
    const r = rig([], { tx: 1, ty: 12 });
    const d = dummy(r, 8, 5);
    const at = (dx: number, dy: number) => ({ x: d.x + dx, y: d.y + dy });
    expect(d.lineUpDir(at(20, 100))).toBe('right');
    expect(d.lineUpDir(at(-20, -100))).toBe('left');
    expect(d.lineUpDir(at(90, -30))).toBe('up');
    expect(d.lineUpDir(at(1, 100))).toBe('down');
    expect(d.lineUpDir(at(6, -100))).toBe('right');
    expect(d.lineUpDir(at(6, -100), 8)).toBe('up');
    expect(d.lineUpDir(at(-80, 0))).toBe('left');
  });

  it('heroSwinging needs an attack nearby', () => {
    const r = rig([], { tx: 12, ty: 5 });
    const d = dummy(r, 4, 5);
    expect(d.heroSwinging(10 * TILE)).toBe(false);
    r.hero.state = 'attack';
    expect(d.heroSwinging(10 * TILE)).toBe(true);
    expect(d.heroSwinging(4 * TILE)).toBe(false);
  });
});

describe('Enemy walkability', () => {
  const grid = ['', '', '', '', '', '...#.o.~.^......'];

  it('canWalkTo refuses walls, pits, deep water and (by default) spikes', () => {
    const r = rig(grid, { tx: 0, ty: 12 });
    const d = dummy(r, 0, 5);
    expect(d.canWalkTo(2 * TILE + 8, 5 * TILE + 8)).toBe(true);
    expect(d.canWalkTo(4 * TILE + 8, 5 * TILE + 8)).toBe(false);
    d.x = 4 * TILE + 8;
    expect(d.canWalkTo(6 * TILE + 8, 5 * TILE + 8)).toBe(false);
    d.x = 6 * TILE + 8;
    expect(d.canWalkTo(8 * TILE + 8, 5 * TILE + 8)).toBe(false);
    d.x = 8 * TILE + 8;
    expect(d.canStand(9 * TILE + 8, 5 * TILE + 8)).toBe(false);
    d.avoidHazards = false;
    expect(d.canStand(9 * TILE + 8, 5 * TILE + 8)).toBe(true);
  });

  it('flyers cross pits and water but not walls', () => {
    const r = rig(grid, { tx: 0, ty: 12 });
    const d = dummy(r, 4, 5);
    d.mover = 'flyer';
    expect(d.canWalkTo(8 * TILE + 8, 5 * TILE + 8)).toBe(true);
    expect(d.canWalkTo(2 * TILE + 8, 5 * TILE + 8)).toBe(false);
  });

  it('freeDirs lists the open directions of a corridor', () => {
    const r = rig(['', '', '', '################', '................', '################'], { tx: 0, ty: 12 });
    const d = dummy(r, 8, 4);
    expect(d.freeDirs().sort()).toEqual(['left', 'right']);
  });
});

describe('Enemy movement', () => {
  it('stepBy does nothing during knockback and never steps onto spikes', () => {
    const r = rig(['', '', '', '', '', '.........^......'], { tx: 0, ty: 12 });
    const d = dummy(r, 8, 5);
    d.knock(1, 0, 16, 0.15);
    expect(d.stepBy(0, 5)).toBe(0);
    d.kbTime = 0;
    expect(d.stepBy(0, 5)).toBeCloseTo(5);
    d.y = 5 * TILE + 8;
    d.x = 8 * TILE + 8;
    for (let i = 0; i < 20; i++) d.stepBy(1, 0);
    expect(d.x).toBeLessThan(9 * TILE);
    expect(d.x).toBeGreaterThan(9 * TILE - 2);
  });

  it('wander keeps moving inside its pen without entering pits or water', () => {
    const r = rig([
      'oooooooooooooooo', 'o..............o', 'o..............o', 'o......~~......o', 'o......~~......o',
      'o..............o', 'o..............o', 'oooooooooooooooo',
    ], { tx: 8, ty: 12 });
    const d = r.add((g, i) => {
      const e = new Dummy(g, i);
      (e as unknown as { think(dt: number): void }).think = (dt: number) => e.wander(dt, 40);
      return e;
    }, 'enemy.test', 3, 3);
    const seen = new Set<string>();
    let travelled = 0;
    let last = { x: d.x, y: d.y };
    for (let i = 0; i < 60 * 8; i++) {
      r.run(STEP);
      travelled += Math.hypot(d.x - last.x, d.y - last.y);
      last = { x: d.x, y: d.y };
      seen.add(d.facing);
      const c = r.game.room.collisionAt(d.x, d.y);
      expect(c).toBe('floor');
    }
    expect(travelled).toBeGreaterThan(200);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('chase reaches the hero around a wall', () => {
    const r = rig(['', '', '', '', '', '...#######......'], { tx: 6, ty: 9 });
    const d = r.add((g, i) => {
      const e = new Dummy(g, i);
      (e as unknown as { think(dt: number): void }).think = (dt: number) => e.chase(r.hero, 50, dt);
      return e;
    }, 'enemy.test', 6, 2);
    r.run(8, () => d.distTo(r.hero) < 14);
    expect(d.distTo(r.hero)).toBeLessThan(14);
  });

  it('chase follows a long wall to an opening beyond its probe instead of pacing', () => {
    const r = rig(['', '', '', '', '', '', '##....##########'], { tx: 13, ty: 10 });
    const d = r.add((g, i) => {
      const e = new Dummy(g, i);
      (e as unknown as { think(dt: number): void }).think = (dt: number) => e.chase(r.hero, 50, dt);
      return e;
    }, 'enemy.test', 13, 3);
    r.run(12, () => d.distTo(r.hero) < 14);
    expect(d.distTo(r.hero)).toBeLessThan(14);
  });

  it('flee and keepDistance hold a band around the target', () => {
    const r = rig([], { tx: 8, ty: 7 });
    const d = dummy(r, 10, 7);
    expect(d.keepDistance(r.hero, 48, 80, 40, STEP)).toBe('away');
    const d0 = d.distTo(r.hero);
    for (let i = 0; i < 30; i++) d.flee(r.hero, 40, STEP);
    expect(d.distTo(r.hero)).toBeGreaterThan(d0 + 15);
    d.x = 14 * TILE + 8;
    expect(d.keepDistance(r.hero, 16, 48, 40, STEP)).toBe('toward');
    d.x = 12 * TILE + 8;
    expect(d.keepDistance(r.hero, 48, 80, 40, STEP)).toBe('hold');
  });

  it('lineUp closes the smaller offset, or the other one when that way is walled', () => {
    const r = rig([], { tx: 12, ty: 3 });
    const d = dummy(r, 4, 5);
    let axis: 'h' | 'v' | null = null;
    for (let i = 0; i < 120 && !axis; i++) axis = d.lineUp(r.hero, 40, STEP);
    expect(axis).toBe('h');
    expect(d.x).toBe(4 * TILE + 8);

    const walled = rig(['', '', '', '', '....#...........'], { tx: 12, ty: 2 });
    const w = dummy(walled, 4, 5);
    w.x = 4 * TILE + 8;
    axis = null;
    for (let i = 0; i < 240 && !axis; i++) axis = w.lineUp(walled.hero, 40, STEP);
    expect(axis).toBe('h');
    expect(w.x).toBeGreaterThan(5 * TILE);
  });

  it('hop travels its distance through the air and lands', () => {
    const r = rig([], { tx: 1, ty: 12 });
    const d = dummy(r, 4, 5);
    d.wakeT = 0;
    d.hop(20, 0, 8, 0.4);
    let maxZ = 0;
    r.run(0.2);
    maxZ = Math.max(maxZ, d.z);
    expect(d.airborne).toBe(true);
    r.run(0.3);
    expect(d.airborne).toBe(false);
    expect(maxZ).toBeGreaterThan(6);
    expect(d.x - (4 * TILE + 8)).toBeCloseTo(20, 0);
  });
});

// ---------------------------------------------------------------- projectiles

describe('EnemyProjectile', () => {
  const fire = (r: Rig, from: Enemy, vx: number, vy: number, extra: Partial<{ blockable: boolean; damage: number }> = {}) =>
    from.shoot({ sprite: 'proj.rock', x: from.x, y: from.y, vx, vy, ...extra });

  it('hits the hero once and disappears', () => {
    const r = rig([], { tx: 8, ty: 10 });
    const d = dummy(r, 8, 4);
    const p = fire(r, d, 0, 120, { damage: 2 });
    expect(p.source).toBe(d);
    expect(p.blockable).toBe(true);
    r.run(2, () => p.dead);
    expect(p.dead).toBe(true);
    expect(r.hero.hits).toHaveLength(1);
    expect(r.hero.hits[0]!.damage).toBe(2);
    expect(r.hero.hits[0]!.dy).toBeCloseTo(1);
  });

  it('bounces off a facing shield harmlessly and vanishes', () => {
    const r = rig([], { tx: 8, ty: 10, facing: 'up' });
    r.hero.shield = true;
    const d = dummy(r, 8, 4);
    const p = fire(r, d, 0, 120);
    r.run(2, () => p.isDeflected);
    expect(p.isDeflected).toBe(true);
    expect(r.hero.blocks).toBe(1);
    expect(p.vy).toBeLessThan(0);
    r.run(1.5, () => p.dead);
    expect(p.dead).toBe(true);
    expect(r.hero.hits).toHaveLength(0);
    expect(r.hero.blocks).toBe(1);
  });

  it('a deflected shot never drifts into a wall', () => {
    const r = rig(['', '', '', '#...............'], { tx: 2, ty: 3, facing: 'left' });
    r.hero.shield = true;
    const d = dummy(r, 8, 8);
    const p = d.shoot({ sprite: 'proj.rock', x: 1 * TILE + 8, y: 3 * TILE + 8, vx: 200, vy: 0 });
    r.run(0.5, () => p.isDeflected);
    expect(p.isDeflected).toBe(true);
    for (let i = 0; i < 60 && !p.dead; i++) {
      r.run(STEP);
      if (!p.dead) expect(r.game.room.blocked(p.hitbox(), 'projectile')).toBe(false);
    }
    expect(p.dead).toBe(true);
    expect(p.left).toBeGreaterThanOrEqual(TILE - 1);
  });

  it('is not blocked from behind, nor when unblockable', () => {
    const r = rig([], { tx: 8, ty: 10, facing: 'down' });
    r.hero.shield = true;
    const d = dummy(r, 8, 4);
    fire(r, d, 0, 120);
    r.run(2);
    expect(r.hero.hits).toHaveLength(1);
    const r2 = rig([], { tx: 8, ty: 10, facing: 'up' });
    r2.hero.shield = true;
    fire(r2, dummy(r2, 8, 4), 0, 120, { blockable: false });
    r2.run(2);
    expect(r2.hero.hits).toHaveLength(1);
  });

  it('flies over pits and water, bursts on walls', () => {
    const r = rig(['', '', '', '', '..oo~~~.#.......'], { tx: 8, ty: 12 });
    const d = dummy(r, 1, 4);
    const p = fire(r, d, 150, 0);
    r.run(0.6);
    expect(p.dead).toBe(false);
    expect(p.x).toBeGreaterThan(6 * TILE);
    r.run(1, () => p.dead);
    expect(p.dead).toBe(true);
    expect(p.right).toBeLessThanOrEqual(8 * TILE + 2);
    expect(r.effects).toContain('fx.hit');
  });

  it('a fireball ignites the solid entity it bursts on; other shots do not', () => {
    class Brazier extends Entity {
      lit = 0;
      override ignite(): boolean {
        this.lit++;
        return true;
      }
    }
    const r = rig([], { tx: 8, ty: 12 });
    const torch = r.add((g, i) => new Brazier(g, i), 'obj.test', 8, 2);
    torch.solid = true;
    const d = dummy(r, 8, 6);
    const ball = d.shoot({ sprite: 'proj.fireball', x: d.x, y: d.y, vx: 0, vy: -120 });
    expect(ball.kind).toBe('fire');
    r.run(1, () => ball.dead);
    expect(ball.dead).toBe(true);
    expect(torch.lit).toBe(1);
    const rock = d.shoot({ sprite: 'proj.rock', x: d.x, y: d.y, vx: 0, vy: -120 });
    r.run(1, () => rock.dead);
    expect(rock.dead).toBe(true);
    expect(torch.lit).toBe(1);
  });

  it('keeps flying through an invulnerable hero, expires, and shrugs off attacks', () => {
    const r = rig([], { tx: 8, ty: 8 });
    r.hero.invuln = 10;
    const d = dummy(r, 8, 2);
    const p = d.shoot({ sprite: 'proj.bone', x: d.x, y: d.y, vx: 0, vy: 100, life: 1.5 });
    expect(p.anim).toBe('spin');
    expect(p.hurt({ damage: 5, kind: 'sword', source: r.hero, dx: 0, dy: 1 })).toBe(false);
    r.run(1.2);
    expect(p.dead).toBe(false);
    expect(p.y).toBeGreaterThan(r.hero.y);
    r.run(0.5);
    expect(p.dead).toBe(true);
  });
});

// ---------------------------------------------------------------- enemies

const TYPES = ['enemy.soldier', 'enemy.archer', 'enemy.spitter', 'enemy.bat', 'enemy.skeleton', 'enemy.slime'];

describe('registration', () => {
  it('registers every group A catalog type', () => {
    for (const t of TYPES) expect(isRegistered(t)).toBe(true);
  });
});

describe('soldier', () => {
  const soldier = (r: Rig, tx: number, ty: number, props: Record<string, PropValue> = {}) =>
    r.add((g, i) => new Soldier(g, i), 'enemy.soldier', tx, ty, props);

  it('has per-variant health, speed, damage and palette', () => {
    const r = rig([], { tx: 1, ty: 12 });
    const g = soldier(r, 3, 3);
    const b = soldier(r, 6, 3, { variant: 'blue' });
    const red = soldier(r, 9, 3, { variant: 'red' });
    expect([g.hp, b.hp, red.hp]).toEqual([2, 4, 6]);
    expect([g.palette, b.palette, red.palette]).toEqual([undefined, 'pal.soldier.blue', 'pal.soldier.red']);
    expect([g.touchDamage, b.touchDamage, red.touchDamage]).toEqual([1, 1, 2]);
    expect(g.countsForClear).toBe(true);
  });

  it('a guard spots the hero in front: alert beat, then a 1.4x chase', () => {
    const r = rig([], { tx: 8, ty: 8 });
    const s = soldier(r, 8, 3, { behavior: 'guard', facing: 'down' });
    r.run(1, () => s.aiState === 'alert');
    expect(s.aiState).toBe('alert');
    expect(s.z > 0 || s.vz > 0).toBe(true);
    r.run(1, () => s.aiState === 'chase');
    expect(s.aiState).toBe('chase');
    r.hero.y = 13 * TILE;
    r.hero.x = 8 * TILE + 8;
    s.y = 1 * TILE + 8;
    s.x = 8 * TILE + 8;
    const y0 = s.y;
    r.run(0.5);
    expect((s.y - y0) / 0.5).toBeCloseTo(36 * 1.4, 0);
    expect(s.anim.startsWith('walk_down')).toBe(true);
  });

  it('a guard holds its post while the hero is behind it or behind a wall', () => {
    const r = rig(['', '', '', '', '', '', '################'], { tx: 8, ty: 9 });
    const s = soldier(r, 8, 3, { behavior: 'guard', facing: 'down' });
    r.run(4);
    expect(s.aiState).toBe('guard');
    expect([s.x, s.y]).toEqual([8 * TILE + 8, 3 * TILE + 8]);
    const r2 = rig([], { tx: 8, ty: 0 });
    const s2 = soldier(r2, 8, 5, { behavior: 'guard', facing: 'down' });
    r2.run(1);
    expect(s2.aiState).toBe('guard');
  });

  const blade = (r: Rig): Hit => ({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: -1 });
  const knockDist = (e: Entity): number => Math.hypot(e.kbx, e.kby) * e.kbTime;
  /** A blue chase soldier thrusting at the hero standing just below it. */
  const thruster = (grid: string[] = []): { r: Rig; s: Soldier } => {
    const r = rig(grid, { tx: 8, ty: 7 });
    r.hero.invuln = 99;
    const s = soldier(r, 8, 6, { variant: 'blue', behavior: 'chase', facing: 'down' });
    r.run(1, () => s.wakeT <= 0 && s.anim === 'attack_down');
    expect(s.anim).toBe('attack_down');
    r.hero.kbTime = 0;
    s.kbTime = 0;
    return { r, s };
  };

  it('a hit alerts it at once; a front hit on a soldier not thrusting is a plain hit', () => {
    const r = rig([], { tx: 8, ty: 0 });
    const s = soldier(r, 8, 5, { behavior: 'guard', facing: 'down' });
    r.run(0.5);
    expect(s.hurt({ damage: 1, kind: 'arrow', source: null, dx: 0, dy: 1 })).toBe(true);
    expect(s.aiState).toBe('chase');
    expect(r.hero.kbTime).toBe(0);

    const r2 = rig([], { tx: 8, ty: 9 });
    const s2 = soldier(r2, 8, 5, { variant: 'blue', behavior: 'guard', facing: 'down' });
    r2.run(0.3);
    expect(s2.hurt(blade(r2))).toBe(true);
    expect(s2.hp).toBe(3);
    expect(r2.sfx).toEqual(['enemyHit']);
    expect(knockDist(s2)).toBeCloseTo(16);
    expect(r2.hero.kbTime).toBe(0);
  });

  it('a swing meeting its thrusting blade clashes: no damage, clink, both pushed apart, then its guard drops', () => {
    const { r, s } = thruster();
    expect(s.hurt(blade(r))).toBe(false);
    expect(s.hp).toBe(4);
    expect(r.sfx).toContain('swordTink');
    expect(r.sfx).not.toContain('enemyHit');
    expect(r.effects).toContain('fx.hit');
    expect(knockDist(s)).toBeCloseTo(16);
    expect(s.kby).toBeLessThan(0);
    expect(knockDist(r.hero)).toBeCloseTo(8);
    expect(r.hero.kby).toBeGreaterThan(0);
    // Guard down: walk pose, and the follow-up swing lands as a plain hit without recoil.
    r.run(0.3);
    expect(s.anim.startsWith('walk_')).toBe(true);
    r.hero.kbTime = 0;
    expect(s.hurt(blade(r))).toBe(true);
    expect(s.hp).toBe(3);
    expect(r.hero.kbTime).toBe(0);
    // Once the guard is back up (and it thrusts again), the next front swing clashes again.
    r.run(1.5, () => s.anim === 'attack_down' && s.kbTime <= 0 && s.invuln <= 0);
    expect(s.hurt(blade(r))).toBe(false);
  });

  it('the clash recoil never pushes the hero into a pit', () => {
    const { r, s } = thruster(['', '', '', '', '', '', '', '', 'oooooooooooooooo']);
    r.hero.y = 8 * TILE - 5;
    s.y = r.hero.y - 16;
    expect(s.hurt(blade(r))).toBe(false);
    r.run(0.3);
    expect(r.game.room.collisionAt(r.hero.x, r.hero.y)).toBe('floor');
    expect(r.hero.y).toBeLessThanOrEqual(8 * TILE - 2);
  });

  it('spin attacks, stunned and reeling soldiers take plain hits', () => {
    const { r, s } = thruster();
    expect(s.hurt({ ...blade(r), kind: 'spin' })).toBe(true);
    expect(r.hero.kbTime).toBe(0);
    const t2 = thruster();
    t2.s.stun = 1;
    expect(t2.s.hurt(blade(t2.r))).toBe(true);
    expect(knockDist(t2.s)).toBeCloseTo(16);
    expect(t2.r.hero.kbTime).toBe(0);
    const t3 = thruster();
    t3.s.knock(0, -1, 16);
    expect(t3.s.hurt(blade(t3.r))).toBe(true);
    expect(t3.r.hero.kbTime).toBe(0);
  });

  it('a chase soldier hunts from the start and deals its contact damage', () => {
    const r = rig([], { tx: 8, ty: 10 });
    soldier(r, 8, 2, { behavior: 'chase', variant: 'red' });
    r.run(4, () => r.hero.hits.length > 0);
    expect(r.hero.hits[0]?.damage).toBe(2);
  });

  it('a key carrier leaves a placed key once; after it was collected, ordinary loot', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const first = soldier(r, 8, 3, { drop: 'smallKey' });
    first.hurt({ damage: 9, kind: 'sword', source: null, dx: 0, dy: -1 });
    expect(r.loot).toHaveLength(0);
    expect(placedPickups(r.list)).toEqual([[enemyKeyId(first.id), 'smallKey']]);
    expect(r.effects).toContain('fx.poof');
    // Next visit, with the key collected: the same soldier rolls random loot instead.
    const r2 = rig([], { tx: 8, ty: 12 });
    (r2.game as { flag: (name: string) => boolean }).flag = (name) => name === `pickup:${enemyKeyId(first.id)}`;
    const again = soldier(r2, 8, 3, { drop: 'smallKey' });
    again.hurt({ damage: 9, kind: 'sword', source: null, dx: 0, dy: -1 });
    expect(placedPickups(r2.list)).toEqual([]);
    expect(r2.loot).toEqual([{ x: again.x, y: again.y, kind: 'random' }]);
  });

  it('dies on its last hit with a poof and its drop', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const s = soldier(r, 8, 3, { drop: 'rupee5' });
    s.hurt({ damage: 2, kind: 'spin', source: null, dx: 0, dy: -1 });
    expect(s.dead).toBe(true);
    expect(r.loot).toEqual([{ x: s.x, y: s.y, kind: 'rupee5' }]);
    expect(r.events).toContainEqual({ type: 'defeated', id: s.id, entityType: 'enemy.soldier' });
  });
});

describe('archer', () => {
  it('lines up and fires a blockable arrow at the hero', () => {
    const r = rig([], { tx: 3, ty: 7 });
    const a = r.add((g, i) => new Archer(g, i), 'enemy.archer', 8, 6);
    r.run(5, () => shots(r.list).length > 0);
    const [arrow] = shots(r.list);
    expect(arrow).toBeDefined();
    expect(arrow!.sprite).toBe('proj.arrow');
    expect(arrow!.blockable).toBe(true);
    expect(arrow!.vx).toBeLessThan(-100);
    expect(a.anim).toBe('shoot_left');
    const d = a.distTo(r.hero);
    expect(d).toBeGreaterThan(2.5 * TILE);
    expect(d).toBeLessThan(7 * TILE);
  });

  it('a hit during the draw spoils the shot', () => {
    const r = rig([], { tx: 3, ty: 7 });
    const a = r.add((g, i) => new Archer(g, i), 'enemy.archer', 8, 6);
    r.run(5, () => a.aiState === 'aim');
    expect(a.aiState).toBe('aim');
    expect(a.hurt({ damage: 1, kind: 'arrow', source: r.hero, dx: 1, dy: 0 })).toBe(true);
    expect(a.aiState).toBe('engage');
    r.run(1);
    expect(shots(r.list)).toHaveLength(0);
  });

  it('backs away when the hero closes in', () => {
    const r = rig([], { tx: 7, ty: 7 });
    const a = r.add((g, i) => new Archer(g, i), 'enemy.archer', 8, 7);
    r.run(0.5);
    const d0 = a.distTo(r.hero);
    r.run(0.6);
    expect(a.distTo(r.hero)).toBeGreaterThan(d0 + 20);
  });
});

describe('spitter', () => {
  it('spits a rock along its facing when the hero lines up (red: single)', () => {
    const r = rig([], { tx: 8, ty: 11 });
    const s = r.add((g, i) => new Spitter(g, i), 'enemy.spitter', 8, 4);
    expect(s.hp).toBe(1);
    r.run(10, () => shots(r.list).some((p) => p.vy > 0));
    const rock = shots(r.list).find((p) => p.vy > 0);
    expect(rock).toBeDefined();
    expect(rock!.sprite).toBe('proj.rock');
    expect(rock!.blockable).toBe(true);
  });

  it('blue fires three-rock bursts', () => {
    const r = rig([], { tx: 8, ty: 13 });
    r.hero.invuln = 99;
    const s = r.add((g, i) => new Spitter(g, i), 'enemy.spitter', 8, 3, { variant: 'blue' });
    expect(s.hp).toBe(2);
    expect(s.palette).toBe('pal.spitter.blue');
    const fired: EnemyProjectile[] = [];
    r.run(10, () => {
      for (const p of shots(r.list)) if (!fired.includes(p)) fired.push(p);
      return fired.length > 0;
    });
    r.run(0.5, () => {
      for (const p of shots(r.list)) if (!fired.includes(p)) fired.push(p);
      return false;
    });
    expect(fired).toHaveLength(3);
  });
});

describe('bat', () => {
  it('sleeps until the hero comes within 3 tiles, then flies', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const b = r.add((g, i) => new Bat(g, i), 'enemy.bat', 8, 3, { sleeping: true });
    expect(b.hp).toBe(1);
    expect(b.mover).toBe('flyer');
    r.run(2);
    expect(b.aiState).toBe('sleep');
    expect([b.x, b.y]).toEqual([8 * TILE + 8, 3 * TILE + 8]);
    r.hero.y = 5 * TILE + 8;
    r.run(0.5);
    expect(b.aiState).toBe('fly');
    expect(b.z).toBeGreaterThan(0);
    expect(Math.hypot(b.x - (8 * TILE + 8), b.y - (3 * TILE + 8))).toBeGreaterThan(8);
  });

  it('the boomerang knocks it out of the air', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const b = r.add((g, i) => new Bat(g, i), 'enemy.bat', 8, 3, { drop: 'heart' });
    expect(b.hurt({ damage: 0, kind: 'boomerang', source: r.hero, dx: 0, dy: -1, knockback: 0, stun: 2 })).toBe(true);
    expect(b.dead).toBe(true);
    expect(r.loot.map((l) => l.kind)).toEqual(['heart']);
  });

  it('swoops over pits and water and stays in the room', () => {
    const rows = ['################'];
    for (let y = 1; y < 13; y++) rows.push(`#${(y % 2 ? 'o' : '~').repeat(14)}#`);
    rows.push('################');
    const r = rig(rows, { tx: 7, ty: 7 });
    r.hero.invuln = 99;
    const b = r.add((g, i) => new Bat(g, i), 'enemy.bat', 3, 3);
    let travelled = 0;
    let last = { x: b.x, y: b.y };
    for (let i = 0; i < 60 * 5; i++) {
      r.run(STEP);
      travelled += Math.hypot(b.x - last.x, b.y - last.y);
      last = { x: b.x, y: b.y };
      expect(r.game.room.collisionAt(b.x, b.y)).not.toBe('solid');
    }
    expect(travelled).toBeGreaterThan(150);
  });
});

describe('skeleton', () => {
  it('hops toward the hero in arcs', () => {
    const r = rig([], { tx: 8, ty: 11 });
    const s = r.add((g, i) => new Skeleton(g, i), 'enemy.skeleton', 8, 3, { throws: false });
    expect(s.hp).toBe(2);
    const d0 = s.distTo(r.hero);
    let maxZ = 0;
    for (let i = 0; i < 60 * 3; i++) {
      r.run(STEP);
      maxZ = Math.max(maxZ, s.z);
    }
    expect(maxZ).toBeGreaterThan(5);
    expect(s.distTo(r.hero)).toBeLessThan(d0 - 30);
  });

  it('leaps backward from a nearby sword swing', () => {
    const r = rig([], { tx: 8, ty: 8 });
    const s = r.add((g, i) => new Skeleton(g, i), 'enemy.skeleton', 8, 6, { throws: false });
    r.run(0.5);
    let dodged = false;
    for (let attempt = 0; attempt < 6 && !dodged; attempt++) {
      r.run(0.1, () => !s.airborne);
      s.x = 8 * TILE + 8;
      s.y = 6 * TILE + 8;
      r.hero.state = 'attack';
      r.run(0.1);
      r.hero.state = 'normal';
      r.run(0.5);
      dodged = s.distTo(r.hero) > 2 * TILE + 12;
      r.run(0.8);
    }
    expect(dodged).toBe(true);
    expect(r.sfx).toContain('jump');
  });

  /** A skeleton 2 tiles above the hero, awake and standing; its dodge roll always succeeds. */
  const dodger = (): { r: Rig; s: Skeleton } => {
    vi.spyOn(rng, 'chance').mockReturnValue(true);
    const r = rig([], { tx: 8, ty: 8 });
    const s = r.add((g, i) => new Skeleton(g, i), 'enemy.skeleton', 8, 6, { throws: false });
    r.run(2, () => s.wakeT <= 0 && s.aiState === 'wait');
    return { r, s };
  };
  const blade = (r: Rig): Hit => ({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: -1 });

  it('the blade misses it during the dodge leap; arrows still hit', () => {
    const { r, s } = dodger();
    r.hero.state = 'attack';
    r.run(STEP);
    expect(s.aiState).toBe('dodge');
    expect(s.dodging).toBe(true);
    r.run(3 * STEP);
    expect(s.hurt(blade(r))).toBe(false);
    expect(s.hurt({ ...blade(r), kind: 'spin' })).toBe(false);
    expect(s.hp).toBe(2);
    expect(s.hurt({ ...blade(r), kind: 'arrow' })).toBe(true);
    expect(s.hp).toBe(1);
  });

  it('a second swing during the dodge cooldown lands', () => {
    const { r, s } = dodger();
    r.hero.state = 'attack';
    r.run(STEP);
    expect(s.aiState).toBe('dodge');
    r.hero.state = 'normal';
    r.run(1, () => !s.airborne);
    expect(s.dodging).toBe(false);
    s.x = 8 * TILE + 8;
    s.y = 6 * TILE + 8;
    r.hero.state = 'attack';
    r.run(STEP);
    expect(s.aiState).not.toBe('dodge');
    expect(s.hurt(blade(r))).toBe(true);
    expect(s.hp).toBe(1);
  });

  it('caught by the blade mid-hop, it lands without a delayed dodge', () => {
    const { r, s } = dodger();
    r.run(2, () => s.aiState === 'hop' && s.vz < 0);
    expect(s.aiState).toBe('hop');
    r.hero.state = 'attack';
    expect(s.hurt(blade(r))).toBe(true);
    const states = new Set<string>();
    r.run(0.5, () => {
      states.add(s.aiState);
      return false;
    });
    expect(states.has('dodge')).toBe(false);
  });

  it('throws spinning bones from mid range only when allowed', () => {
    // A pit moat keeps it at mid range (bones fly over pits).
    const moat = ['', '', '', '', '', '', 'oooooooooooooooo', 'oooooooooooooooo'];
    const r = rig(moat, { tx: 8, ty: 11 });
    r.hero.invuln = 99;
    r.add((g, i) => new Skeleton(g, i), 'enemy.skeleton', 8, 3);
    r.run(6, () => shots(r.list).length > 0);
    expect(shots(r.list)[0]?.sprite).toBe('proj.bone');
    const r2 = rig(moat, { tx: 8, ty: 11 });
    r2.hero.invuln = 99;
    r2.add((g, i) => new Skeleton(g, i), 'enemy.skeleton', 8, 3, { throws: false });
    r2.run(6, () => shots(r2.list).length > 0);
    expect(shots(r2.list)).toHaveLength(0);
  });
});

describe('slime', () => {
  const slime = (r: Rig, props: Record<string, PropValue> = {}) =>
    r.add((g, i) => new Slime(g, i), 'enemy.slime', 8, 4, props);
  const kill = (e: Entity) => e.hurt({ damage: 9, kind: 'sword', source: null, dx: 0, dy: -1 });

  it('bounces toward the hero in hops', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const s = slime(r);
    const d0 = s.distTo(r.hero);
    let maxZ = 0;
    for (let i = 0; i < 60 * 4; i++) {
      r.run(STEP);
      maxZ = Math.max(maxZ, s.z);
    }
    expect(maxZ).toBeGreaterThan(4);
    expect(s.distTo(r.hero)).toBeLessThan(d0 - 24);
  });

  it('a big slime splits into two small ones that share its drop without duplicating it', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const big = slime(r, { variant: 'red', drop: 'smallKey' });
    expect([big.hp, big.w, big.artLift, big.palette]).toEqual([2, 12, 0, 'pal.slime.red']);
    kill(big);
    expect(big.dead).toBe(true);
    expect(r.loot).toHaveLength(0);
    const halves = ofType(r.list, Slime).filter((s) => !s.dead);
    expect(halves).toHaveLength(2);
    for (const h of halves) {
      expect([h.hp, h.w, h.artLift, h.palette, h.countsForClear]).toEqual([1, 8, 3, 'pal.slime.red', true]);
      expect(h.prop('split', true)).toBe(false);
    }
    expect(halves.map((h) => h.prop('drop', '')).sort()).toEqual(['none', 'smallKey']);
    // The swing that split it can't cut the halves on the spot.
    for (const h of halves) expect(kill(h)).toBe(false);
    r.run(0.6);
    halves.forEach(kill);
    expect(ofType(r.list, Slime).filter((s) => !s.dead)).toHaveLength(0);
    expect(r.loot).toHaveLength(0);
    expect(placedPickups(r.list)).toEqual([[`${big.id}/a-key`, 'smallKey']]);
  });

  it('the big slime counts as defeated only once both halves are gone', () => {
    const r = rig([], { tx: 8, ty: 12 });
    const big = slime(r);
    const bigDefeats = () => r.events.filter((e) => e.type === 'defeated' && e.id === big.id);
    kill(big);
    expect(bigDefeats()).toHaveLength(0);
    r.run(0.6);
    const [a, b] = ofType(r.list, Slime).filter((s) => !s.dead);
    kill(a!);
    expect(bigDefeats()).toHaveLength(0);
    expect(r.events).toContainEqual({ type: 'defeated', id: a!.id, entityType: 'enemy.slime' });
    kill(b!);
    expect(bigDefeats()).toEqual([{ type: 'defeated', id: big.id, entityType: 'enemy.slime' }]);
  });

  it('random drops stay random on both halves; small and non-splitting slimes just die', () => {
    const r = rig([], { tx: 8, ty: 12 });
    kill(slime(r));
    expect(ofType(r.list, Slime).filter((s) => !s.dead).map((h) => h.prop('drop', ''))).toEqual(['random', 'random']);
    const r2 = rig([], { tx: 8, ty: 12 });
    kill(slime(r2, { split: false }));
    kill(slime(r2, { size: 'small' }));
    expect(ofType(r2.list, Slime).filter((s) => !s.dead)).toHaveLength(0);
    expect(r2.loot).toHaveLength(2);
  });
});
