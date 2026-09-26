// Bosses: the worm's path-following geometry and the knight's hit-direction
// rules as pure functions, plus both bosses ticked against a mock GameServices
// on a real ActiveRoom (walls, bounces, weak points, stun, death finale).
import { describe, expect, it } from 'vitest';
import type { Dir, EntityInstance, Project, PropValue, Room, TileDef, World } from '../src/core/types';
import type { DamageKind, GameEvent, GameServices, Hit, PlayerApi } from '../src/game/api';
import { normalize, rectsOverlap, type Vec } from '../src/core/math';
import { STEP, TILE } from '../src/core/constants';
import { defaultProps } from '../src/core/catalog';
import { Entity } from '../src/game/entity';
import { ActiveRoom } from '../src/game/world';
import { isRegistered, registerEntity } from '../src/game/registry';
import { BODY_GAP, HEAD_GAP, TAIL_GAP, WormPath, wormOffsets } from '../src/game/entities/bosses/wormPath';
import {
  FRONT_COS, attackVector, bossTinks, facingToward, isFrontal, knightVerdict, overlapArea, wormVerdict,
} from '../src/game/entities/bosses/logic';
import { Worm, WormPart, WormShadow, angleDelta, bounceHeading } from '../src/game/entities/bosses/worm';
import { Knight, KnightHelm } from '../src/game/entities/bosses/knight';
import { INTRO_TIME } from '../src/game/entities/bosses/boss';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- worm geometry

describe('worm path following', () => {
  it('wormOffsets spaces head gap, body gaps, then the tail gap', () => {
    expect(wormOffsets(4)).toEqual([HEAD_GAP, HEAD_GAP + BODY_GAP, HEAD_GAP + 2 * BODY_GAP, HEAD_GAP + 3 * BODY_GAP, HEAD_GAP + 3 * BODY_GAP + TAIL_GAP]);
    expect(wormOffsets(2)).toEqual([HEAD_GAP, HEAD_GAP + BODY_GAP, HEAD_GAP + BODY_GAP + TAIL_GAP]);
    const o = wormOffsets(8);
    expect(o).toHaveLength(9);
    for (let i = 1; i < o.length; i++) expect(o[i]!).toBeGreaterThan(o[i - 1]!);
  });

  it('samples points by arc length back along the recorded path', () => {
    const path = new WormPath(200);
    // Right 40 px, then down 30 px (an L); the newest point is (40, 30).
    for (let x = 0; x <= 40; x += 2) path.push(x, 0);
    for (let y = 2; y <= 30; y += 2) path.push(40, y);
    expect(path.length).toBeCloseTo(70);
    expect(path.sample(0)).toEqual({ x: 40, y: 30 });
    expect(path.sample(10)).toEqual({ x: 40, y: 20 });
    expect(path.sample(30)).toEqual({ x: 40, y: 0 });
    const round = path.sample(45);
    expect(round.x).toBeCloseTo(25);
    expect(round.y).toBeCloseTo(0);
    // Beyond the trail: the oldest point.
    expect(path.sample(500)).toEqual({ x: 0, y: 0 });
  });

  it('ignores repeated points and trims the trail to just over `keep`', () => {
    const path = new WormPath(50);
    for (let i = 0; i <= 300; i++) {
      path.push(i, 0);
      path.push(i, 0);
    }
    expect(path.length).toBeGreaterThanOrEqual(50);
    expect(path.length).toBeLessThan(52);
    expect(path.sample(50)).toEqual({ x: 250, y: 0 });
  });

  it('sampleInto writes in place and stays exact across the internal compaction', () => {
    const path = new WormPath(30);
    const out = { x: -1, y: -1 };
    path.sampleInto(5, out);
    expect(out).toEqual({ x: 0, y: 0 }); // empty trail
    // A long diagonal walk: many hundreds of points are dropped and compacted away.
    for (let i = 0; i <= 2000; i++) path.push(i * 0.6, i * 0.8);
    path.sampleInto(0, out);
    expect(out.x).toBeCloseTo(1200);
    expect(out.y).toBeCloseTo(1600);
    path.sampleInto(25, out);
    expect(out.x).toBeCloseTo(1200 - 15);
    expect(out.y).toBeCloseTo(1600 - 20);
    expect(path.length).toBeGreaterThanOrEqual(30);
    expect(path.length).toBeLessThan(32);
  });

  it('reset lays a straight trail behind the head (clamped by the callback)', () => {
    const path = new WormPath(60);
    path.reset(100, 100, 0, 1);
    expect(path.sample(0)).toEqual({ x: 100, y: 100 });
    expect(path.sample(60).y).toBeCloseTo(160);
    const clamped = new WormPath(60);
    clamped.reset(100, 100, 0, 1, (p) => ({ x: p.x, y: Math.min(p.y, 130) }));
    expect(clamped.sample(60).y).toBeCloseTo(130);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(0, 90 * DEG)).toBeCloseTo(90 * DEG);
    expect(angleDelta(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG);
    expect(angleDelta(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG);
    expect(angleDelta(0, 4 * Math.PI + 0.5)).toBeCloseTo(0.5);
  });

  it('bounceHeading reflects the blocked axis and keeps jitter from aiming back into the wall', () => {
    const h = bounceHeading(30 * DEG, true, false, 0);
    expect(Math.cos(h)).toBeCloseTo(-Math.cos(30 * DEG));
    expect(Math.sin(h)).toBeCloseTo(Math.sin(30 * DEG));
    const both = bounceHeading(45 * DEG, true, true, 0);
    expect(Math.cos(both)).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.sin(both)).toBeCloseTo(-Math.SQRT1_2);
    // Heading almost straight down into a floor: a big jitter would skim the wall, so it is dropped.
    const steep = bounceHeading(80 * DEG, false, true, 1.2);
    expect(Math.sin(steep)).toBeCloseTo(-Math.sin(80 * DEG));
    for (let j = -0.3; j <= 0.3; j += 0.05) {
      expect(Math.cos(bounceHeading(10 * DEG, true, false, j))).toBeLessThan(0);
    }
  });

  it('a repeat bounce leaves a single wall at the shallowest angle, keeping its way along it', () => {
    // Steeply down-right into a floor, right after another bounce: out along the floor, not back up.
    const floor = bounceHeading(80 * DEG, false, true, 0.2, true);
    expect(Math.sin(floor)).toBeCloseTo(-0.3);
    expect(Math.cos(floor)).toBeGreaterThan(0.9);
    // Up-left into a side wall.
    const side = bounceHeading(-100 * DEG, true, false, -0.2, true);
    expect(Math.cos(side)).toBeCloseTo(0.3);
    expect(Math.sin(side)).toBeLessThan(-0.9);
    // Straight at the wall: the jitter's sign picks the way.
    expect(Math.cos(bounceHeading(90 * DEG, false, true, -0.1, true))).toBeLessThan(0);
    expect(Math.cos(bounceHeading(90 * DEG, false, true, 0.1, true))).toBeGreaterThan(0);
    // Into a corner (both axes): the plain reflection, no jitter.
    const corner = bounceHeading(45 * DEG, true, true, 0.3, true);
    expect(Math.cos(corner)).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.sin(corner)).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe('boss helpers', () => {
  it('overlapArea measures the area two boxes share', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlapArea(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlapArea(a, { x: 2, y: 2, w: 4, h: 4 })).toBe(16);
    expect(overlapArea(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
    expect(overlapArea(a, { x: 30, y: 30, w: 4, h: 4 })).toBe(0);
  });

  it('bosses give the immune feedback for every weapon but those that clink by themselves', () => {
    for (const kind of ['sword', 'spin', 'bomb', 'thrown', 'fire'] as const) expect(bossTinks(kind)).toBe(true);
    for (const kind of ['arrow', 'boomerang', 'hookshot'] as const) expect(bossTinks(kind)).toBe(false);
  });
});

// ---------------------------------------------------------------- knight hit direction

/** A hit from a hero standing at (sx, sy) (melee) or flying along (dx, dy) (projectile). */
function hitFrom(kind: DamageKind, sx: number, sy: number, targetX = 0, targetY = 0, damage = 1): Hit {
  const source = { x: sx, y: sy } as unknown as Entity;
  const len = Math.hypot(targetX - sx, targetY - sy) || 1;
  return { damage, kind, source, dx: (targetX - sx) / len, dy: (targetY - sy) / len };
}

describe('knight hit direction', () => {
  it('attackVector points at the swordsman for melee and against the flight for projectiles', () => {
    const v = attackVector(hitFrom('sword', 0, 20), 0, 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    const arrow: Hit = { damage: 1, kind: 'arrow', source: { x: 500, y: 500 } as unknown as Entity, dx: 1, dy: 0 };
    const a = attackVector(arrow, 0, 0);
    expect(a.x).toBeCloseTo(-1);
    expect(a.y).toBeCloseTo(0);
    expect(attackVector({ damage: 1, kind: 'bomb', source: null, dx: 0, dy: 0 }, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('judges blasts, flames and thrown objects by where they are, not how the struck part is pushed', () => {
    // A bomb just above the knight's centre, blasting its helm box further up (pushed up, -y):
    // the blast still comes from above the knight.
    const blast: Hit = { damage: 2, kind: 'bomb', source: { x: 0, y: -10 } as unknown as Entity, dx: 0, dy: -1 };
    const b = attackVector(blast, 0, 0);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(-1);
    expect(knightVerdict('up', false, blast, 0, 0)).toBe('blocked');
    expect(knightVerdict('down', false, blast, 0, 0)).toBe('damage');
    const pot: Hit = { damage: 1, kind: 'thrown', source: { x: 14, y: 0 } as unknown as Entity, dx: -1, dy: 0 };
    expect(knightVerdict('right', false, pot, 0, 0)).toBe('blocked');
    expect(knightVerdict('left', false, pot, 0, 0)).toBe('damage');
  });

  it('isFrontal covers the front cone only', () => {
    const at = (deg: number) => ({ x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) }); // 0 deg = straight down
    expect(isFrontal('down', at(0))).toBe(true);
    expect(isFrontal('down', at(50))).toBe(true);
    expect(isFrontal('down', at(-50))).toBe(true);
    expect(isFrontal('down', at(60))).toBe(false);
    expect(isFrontal('down', at(90))).toBe(false);
    expect(isFrontal('down', at(180))).toBe(false);
    expect(isFrontal('left', { x: -1, y: 0 })).toBe(true);
    expect(isFrontal('left', { x: 1, y: 0 })).toBe(false);
  });

  it('the shield covers every bearing facingToward can lag behind', () => {
    const dirs: Dir[] = ['up', 'down', 'left', 'right'];
    for (const facing of dirs) {
      for (let deg = 0; deg < 360; deg += 1) {
        const dx = Math.cos(deg * DEG);
        const dy = Math.sin(deg * DEG);
        if (facingToward(facing, dx, dy) !== facing) continue;
        expect(isFrontal(facing, { x: dx, y: dy })).toBe(true);
      }
    }
    expect(FRONT_COS).toBeLessThan(0.6);
  });

  it('blocks frontal sword hits, lets side and back hits land, and anything lands while stunned', () => {
    // Knight at the origin facing down (+y).
    expect(knightVerdict('down', false, hitFrom('sword', 0, 20), 0, 0)).toBe('blocked');
    expect(knightVerdict('down', false, hitFrom('spin', 6, 20), 0, 0)).toBe('blocked');
    expect(knightVerdict('down', false, hitFrom('sword', 0, -20), 0, 0)).toBe('damage');
    expect(knightVerdict('down', false, hitFrom('sword', 20, 0), 0, 0)).toBe('damage');
    expect(knightVerdict('down', false, hitFrom('sword', -20, 2), 0, 0)).toBe('damage');
    expect(knightVerdict('down', true, hitFrom('sword', 0, 20), 0, 0)).toBe('damage');
    expect(knightVerdict('right', false, hitFrom('sword', 20, 0), 0, 0)).toBe('blocked');
    expect(knightVerdict('right', false, hitFrom('sword', -20, 0), 0, 0)).toBe('damage');
  });

  it('judges arrows by their flight, tinks weapons that cannot hurt it and ignores non-weapons', () => {
    // An arrow flying up (-y) hits a knight facing down in the face.
    const upArrow: Hit = { damage: 1, kind: 'arrow', source: null, dx: 0, dy: -1 };
    expect(knightVerdict('down', false, upArrow, 0, 0)).toBe('blocked');
    expect(knightVerdict('up', false, upArrow, 0, 0)).toBe('damage');
    expect(knightVerdict('down', true, upArrow, 0, 0)).toBe('damage');
    expect(knightVerdict('down', true, hitFrom('boomerang', 0, -40, 0, 0, 0), 0, 0)).toBe('tink');
    expect(knightVerdict('up', false, hitFrom('hookshot', 0, 40, 0, 0, 0), 0, 0)).toBe('tink');
    expect(knightVerdict('up', false, hitFrom('fire', 0, 40), 0, 0)).toBe('tink');
    expect(knightVerdict('down', false, hitFrom('contact', 0, -40), 0, 0)).toBe('ignore');
    expect(knightVerdict('down', false, hitFrom('spikes', 0, -40), 0, 0)).toBe('ignore');
    expect(knightVerdict('down', false, hitFrom('projectile', 0, 40), 0, 0)).toBe('ignore');
    expect(knightVerdict('down', false, hitFrom('beam', 0, 40), 0, 0)).toBe('ignore');
  });

  it('worm verdict: only blades and arrows on the tail hurt', () => {
    expect(wormVerdict('tail', hitFrom('sword', 0, 20))).toBe('damage');
    expect(wormVerdict('tail', hitFrom('spin', 0, 20, 0, 0, 2))).toBe('damage');
    expect(wormVerdict('tail', hitFrom('arrow', 0, 20))).toBe('damage');
    expect(wormVerdict('tail', hitFrom('boomerang', 0, 20, 0, 0, 0))).toBe('tink');
    expect(wormVerdict('tail', hitFrom('bomb', 0, 20, 0, 0, 2))).toBe('tink');
    expect(wormVerdict('head', hitFrom('sword', 0, 20))).toBe('tink');
    expect(wormVerdict('body', hitFrom('arrow', 0, 20))).toBe('tink');
    expect(wormVerdict('body', hitFrom('contact', 0, 20))).toBe('ignore');
    expect(wormVerdict('tail', hitFrom('beam', 0, 20))).toBe('ignore');
  });

  it('facingToward keeps its facing near diagonals and turns past the hysteresis', () => {
    expect(facingToward('down', 10, 10)).toBe('down');
    expect(facingToward('down', 12, 10)).toBe('down');
    expect(facingToward('down', 14, 10)).toBe('right');
    expect(facingToward('down', 0, -10)).toBe('up');
    expect(facingToward('left', 0, 0)).toBe('left');
  });
});

// ---------------------------------------------------------------- mock world

const TILES: TileDef[] = (['floor', 'solid', 'pit'] as const).map((collision, i) => ({
  id: i + 1, key: collision, name: collision, palette: 'p', frames: [], collision, tags: [],
}));

/** Stand-in hero: records hits; knockback via the Entity base. */
class Hero extends Entity {
  state: PlayerApi['state'] = 'normal';
  readonly hits: Hit[] = [];
  hurtPlayer(hit: Hit): 'hit' | 'blocked' | 'ignored' {
    this.hits.push(hit);
    return 'hit';
  }
}

interface Rig {
  game: GameServices;
  hero: Hero;
  list: Entity[];
  events: GameEvent[];
  sfx: string[];
  effects: string[];
  flags: Record<string, boolean>;
  add<T extends Entity>(make: (g: GameServices, inst: EntityInstance) => T, type: string, x: number, y: number, props?: Record<string, PropValue>): T;
  run(seconds: number, until?: () => boolean): number;
}

/** A walled 16x14 room (one screen) with the hero at (hx, hy) px. */
function rig(hx: number, hy: number): Rig {
  const cols = 16;
  const rows = 14;
  const bg: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) bg.push(x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? 2 : 1);
  }
  const def: Room = {
    id: 'r', name: 'R', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, entities: [], triggers: [],
    layers: { bg, fg: new Array<number>(bg.length).fill(0), over: new Array<number>(bg.length).fill(0) },
  };
  const world: World = { id: 'w', name: 'W', kind: 'dungeon', music: 'boss', rooms: [def] };
  const room = new ActiveRoom({ tiles: TILES }, world, def);
  const list: Entity[] = [];
  const events: GameEvent[] = [];
  const sfx: string[] = [];
  const effects: string[] = [];
  const flags: Record<string, boolean> = {};
  let time = 0;
  const game = {
    project: { sprites: [] } as unknown as Project,
    room,
    entities: list,
    get time() { return time; },
    audio: { sfx: (id: string) => sfx.push(id) },
    camera: { x: 0, y: 0, shake: () => {} },
    spawn: <T extends Entity>(e: T) => { if (!list.includes(e)) list.push(e); return e; },
    solidEntityAt: (r: { x: number; y: number; w: number; h: number }, self: Entity | null) =>
      list.find((e) => e.solid && e !== self && !e.dead && rectsOverlap(e.hitbox(), r)) ?? null,
    entitiesIn: (r: { x: number; y: number; w: number; h: number }, filter?: (e: Entity) => boolean) =>
      list.filter((e) => !e.dead && rectsOverlap(e.hitbox(), r) && (!filter || filter(e))),
    emit: (e: GameEvent) => events.push(e),
    effect: (sprite: string) => effects.push(sprite),
    dropLoot: () => {},
    setFlag: (name: string, v = true) => { flags[name] = v; },
    flag: (name: string) => flags[name] === true,
  } as unknown as GameServices & { player: PlayerApi };
  const h = new Hero(game, null, 'player');
  h.team = 'player';
  h.mover = 'player';
  h.x = hx;
  h.y = hy;
  (game as { player: PlayerApi }).player = h as unknown as PlayerApi;
  list.push(h);
  let n = 0;
  return {
    game, hero: h, list, events, sfx, effects, flags,
    add(make, type, x, y, props = {}) {
      const inst: EntityInstance = { id: `${type}_${n++}`, type, x, y, props: { ...defaultProps(type), ...props } };
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
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i]!.dead) {
            list[i]!.onRemove?.();
            list.splice(i, 1);
          }
        }
        t += STEP;
        time += STEP;
        if (until?.()) break;
      }
      return t;
    },
  };
}

/** A sword hit from the hero onto `target`. */
function swordHit(r: Rig, target: Entity, kind: DamageKind = 'sword', damage = 1): Hit {
  const len = Math.hypot(target.x - r.hero.x, target.y - r.hero.y) || 1;
  return { damage, kind, source: r.hero, dx: (target.x - r.hero.x) / len, dy: (target.y - r.hero.y) / len };
}

// A stand-in pickup so the heart container drop can be observed without the objects module.
class FakePickup extends Entity {}
if (!isRegistered('obj.pickup')) registerEntity('obj.pickup', (g, inst) => new FakePickup(g, inst));

/** A solid box (a closed shutter, a raised peg, a block) of w x h px centred at (x, y). */
class Solid extends Entity {}
function addSolid(r: Rig, x: number, y: number, w: number, h: number): Solid {
  const s = new Solid(r.game, null, 'test.solid');
  s.solid = true;
  s.x = x;
  s.y = y;
  s.w = w;
  s.h = h;
  return r.game.spawn(s);
}

/** An open doorway: an obj.door box (catalog size 32 x 16) that is not solid. */
function addDoor(r: Rig, x: number, y: number): Solid {
  const d = new Solid(r.game, null, 'obj.door');
  d.x = x;
  d.y = y;
  return r.game.spawn(d);
}

/** The private worm state the pocket test drives / watches. */
type WormInternals = { decideT: number; sinceBounce: number };

const worms = (list: Entity[]) => list.filter((e): e is WormPart => e instanceof WormPart);

describe('registration', () => {
  it('registers both bosses at import', () => {
    expect(isRegistered('boss.worm')).toBe(true);
    expect(isRegistered('boss.knight')).toBe(true);
  });
});

describe('giant worm', () => {
  it('spawns `segments` body parts plus a tail, all trailing the head on its path', () => {
    const r = rig(40, 40);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { segments: 5 });
    const parts = worms(r.list);
    expect(parts).toHaveLength(6);
    expect(parts.map((p) => p.kind)).toEqual(['body', 'body', 'body', 'body', 'body', 'tail']);
    expect(parts.every((p) => p.team === 'enemy' && !p.countsForClear)).toBe(true);
    expect(worm.countsForClear).toBe(true);
    // Straight starting trail: consecutive parts sit exactly one gap apart.
    const chain: Entity[] = [worm, ...parts];
    const gaps = worm.partOffsets.map((o, i) => o - (i === 0 ? 0 : worm.partOffsets[i - 1]!));
    for (let i = 1; i < chain.length; i++) {
      expect(Math.hypot(chain[i]!.x - chain[i - 1]!.x, chain[i]!.y - chain[i - 1]!.y)).toBeCloseTo(gaps[i - 1]!, 3);
    }
  });

  it('holds still during the intro, then crawls, bouncing inside the walls with the chain following', () => {
    const r = rig(40, 40);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    const x0 = worm.x;
    const y0 = worm.y;
    r.run(INTRO_TIME - 0.05);
    expect(worm.x).toBe(x0);
    expect(worm.y).toBe(y0);
    const parts = worms(r.list);
    const chain: Entity[] = [worm, ...parts];
    let moved = 0;
    for (let tick = 0; tick < 60 * 12; tick++) {
      const hx = worm.x;
      const hy = worm.y;
      r.run(STEP);
      moved += Math.hypot(worm.x - hx, worm.y - hy);
      for (const e of chain) {
        // Inside the walls (one tile thick) at all times.
        expect(e.left).toBeGreaterThanOrEqual(TILE - 1e-6);
        expect(e.top).toBeGreaterThanOrEqual(TILE - 1e-6);
        expect(e.right).toBeLessThanOrEqual(15 * TILE + 1e-6);
        expect(e.bottom).toBeLessThanOrEqual(13 * TILE + 1e-6);
      }
      // Each part trails the one before it by no more than its arc-length gap.
      for (let i = 1; i < chain.length; i++) {
        const gap = worm.partOffsets[i - 1]! - (i === 1 ? 0 : worm.partOffsets[i - 2]!);
        expect(Math.hypot(chain[i]!.x - chain[i - 1]!.x, chain[i]!.y - chain[i - 1]!.y)).toBeLessThanOrEqual(gap + 1e-6);
      }
    }
    // 12 s at >= 46 px/s: it covered ground and bounced (the room is only ~200 px across).
    expect(moved).toBeGreaterThan(400);
  });

  it('only the tail takes damage; hits flash it, grant i-frames and speed the worm up', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { hp: 6 });
    r.run(INTRO_TIME + 1);
    const body = worms(r.list)[0]!;
    const tail = worm.tail;
    expect(worm.hurt(swordHit(r, worm))).toBe(false);
    expect(body.hurt(swordHit(r, body))).toBe(false);
    expect(worm.hp).toBe(6);
    expect(r.sfx).toContain('swordTink');
    expect(tail.hurt(swordHit(r, tail, 'boomerang', 0))).toBe(false);
    expect(worm.hp).toBe(6);

    const calm = worm.speed;
    expect(tail.hurt(swordHit(r, tail))).toBe(true);
    expect(worm.hp).toBe(5);
    expect(tail.hitFlash).toBeGreaterThan(0);
    expect(tail.invuln).toBeGreaterThan(0);
    expect(r.sfx).toContain('bossHit');
    // I-frames: a second swing right away does nothing, and the same blow reaching a body segment does not tink.
    expect(tail.hurt(swordHit(r, tail))).toBe(false);
    expect(worm.hp).toBe(5);
    r.sfx.length = 0;
    expect(body.hurt(swordHit(r, body))).toBe(false);
    expect(r.sfx).not.toContain('swordTink');
    r.run(0.6);
    expect(worm.speed).toBeGreaterThan(calm);
    expect(tail.hurt(swordHit(r, tail, 'arrow'))).toBe(true);
    expect(worm.hp).toBe(4);
  });

  it('touching any part deals 2 once awake (never during the spawn grace)', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    r.run(STEP);
    expect(worm.contactDamage).toBe(0);
    expect(worms(r.list).every((p) => p.contactDamage === 0)).toBe(true);
    r.run(0.5);
    expect(worm.contactDamage).toBe(2);
    expect(worms(r.list).every((p) => p.contactDamage === 2)).toBe(true);
  });

  it('dies tail-first in bursts, then drops a heart container and reports the defeat', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { hp: 1 });
    r.run(INTRO_TIME + 0.5);
    expect(worm.tail.hurt(swordHit(r, worm.tail))).toBe(true);
    expect(worm.dying).toBe(true);
    expect(worm.contactDamage).toBe(0);
    // Further hits do nothing while it bursts.
    expect(worm.tail.hurt(swordHit(r, worm.tail))).toBe(false);
    r.run(STEP * 2);
    expect(r.sfx).toContain('bossDie');
    // The first burst took the tail.
    const parts = worm.parts;
    expect(parts[parts.length - 1]!.dead).toBe(true);
    expect(parts[0]!.dead).toBe(false);
    r.run(6, () => worm.dead);
    expect(worm.dead).toBe(true);
    expect(parts.every((p) => p.dead)).toBe(true);
    expect(r.effects.filter((s) => s === 'fx.explosion').length % 6).toBe(0);
    expect(r.effects.filter((s) => s === 'fx.explosion').length).toBeGreaterThanOrEqual(parts.length + 1);
    expect(r.flags[`defeated:${worm.id}`]).toBe(true);
    expect(r.events).toContainEqual({ type: 'defeated', id: worm.id, entityType: 'boss.worm' });
    const heart = r.list.find((e) => e.type === 'obj.pickup');
    expect(heart?.id).toBe(`${worm.id}-heart`);
    expect(heart?.inst?.props['item']).toBe('heartContainer');
    expect(r.game.room.blocked(heart!.hitbox(), 'walker')).toBe(false);
  });

  it('dropHeart=false skips the heart container; removal takes the segments along', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { hp: 1, dropHeart: false });
    r.run(INTRO_TIME + 0.5);
    worm.tail.hurt(swordHit(r, worm.tail));
    r.run(6, () => worm.dead);
    expect(worm.dead).toBe(true);
    expect(r.list.some((e) => e.type === 'obj.pickup')).toBe(false);

    const r2 = rig(40, 200);
    const w2 = r2.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    w2.dead = true;
    r2.run(STEP);
    expect(r2.list).toEqual([r2.hero]);
  });

  it('every piece casts a ground-layer shadow that follows it (shadows sit under every piece)', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    r.run(INTRO_TIME + 2);
    const shadows = r.list.filter((e): e is WormShadow => e instanceof WormShadow);
    const chain: Entity[] = [worm, ...worm.parts];
    expect(shadows).toHaveLength(chain.length);
    expect(shadows.every((s) => s.drawLayer === 'ground' && s.team === 'neutral' && !s.countsForClear)).toBe(true);
    for (const piece of chain) {
      expect(shadows.some((s) => s.x === piece.x && s.y === piece.y)).toBe(true);
    }
    // Only a small depth nudge keeps the tail over its neighbour (not over a hero standing below it).
    expect(worm.tail.sortBias).toBeGreaterThan(0);
    expect(worm.tail.sortBias).toBeLessThanOrEqual(2);
  });

  it('leaving the room retires the parts without hiding them (the scroll-out still shows the whole worm)', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    r.run(INTRO_TIME + 1);
    worm.onRemove();
    expect(worm.parts.every((p) => p.dead && p.visible && p.contactDamage === 0)).toBe(true);
    expect(r.list.filter((e) => e instanceof WormShadow).every((s) => s.dead)).toBe(true);
  });

  it('a solid that closes on the head never traps it', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    r.run(INTRO_TIME + 0.5);
    // A shutter-sized solid shut 2 px into the head from above.
    addSolid(r, worm.x, worm.top - 8 + 2, 32, 16);
    expect(worm.isBlockedAt(worm.x, worm.y - 1)).toBe(true); // deeper in: no
    expect(worm.isBlockedAt(worm.x, worm.y + 1)).toBe(false); // out: yes
    expect(worm.isBlockedAt(worm.x + 1, worm.y)).toBe(false); // along it: yes
    const x0 = worm.x;
    const y0 = worm.y;
    r.run(2);
    expect(Math.hypot(worm.x - x0, worm.y - y0)).toBeGreaterThan(24);
  });

  it('never crawls into a doorway, open ones included', () => {
    const r = rig(40, 150);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    // Open doorways lined up just inside the top and bottom walls (y 16..32 and 192..208).
    const doors = [32, 64, 96, 128, 160, 192, 224].flatMap((x) => [addDoor(r, x, 24), addDoor(r, x, 200)]);
    expect(doors.every((d) => !d.solid && d.w === 32 && d.h === 16)).toBe(true);
    let entered = false;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    r.run(15, () => {
      entered ||= doors.some((d) => worm.overlaps(d));
      minTop = Math.min(minTop, worm.top);
      maxBottom = Math.max(maxBottom, worm.bottom);
      return false;
    });
    expect(entered).toBe(false);
    // It did reach them (and bounced off).
    expect(Math.min(minTop - 32, 192 - maxBottom)).toBeLessThan(2);
  });

  it('slides out of a tight pocket instead of rattling between its walls', () => {
    // A 32 px corridor for the 24 px head: the top wall above, a row of solids below, open to the right.
    const r = rig(40, 200);
    for (let x = TILE; x < 11 * TILE; x += TILE) addSolid(r, x + TILE / 2, 3.5 * TILE, TILE, TILE);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 48, 2 * TILE, { hp: 12 });
    r.run(INTRO_TIME);
    worm.hp = 1; // full rage: the fastest crawl
    const w = worm as unknown as WormInternals;
    let bounces = 0;
    let worstSecond = 0;
    let second = 0;
    let escaped = false;
    for (let tick = 1; tick <= 60 * 3; tick++) {
      w.decideT = 99; // no steering: the bounces alone must get it out
      if (tick === 1) worm.heading = 80 * DEG; // steeply into the solids
      r.run(STEP);
      escaped ||= worm.left > 11 * TILE;
      if (w.sinceBounce === 0) {
        bounces++;
        second++;
      }
      if (tick % 60 === 0) {
        worstSecond = Math.max(worstSecond, second);
        second = 0;
      }
    }
    expect(bounces).toBeGreaterThan(0);
    // A zig-zag along the corridor, not a rattle in place (up to 10 a second without the settling).
    expect(worstSecond).toBeLessThanOrEqual(6);
    expect(escaped).toBe(true);
  });

  it('the whole worm glows faintly in the dark, the tail brightest', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    expect(worm.light).toBeGreaterThan(0);
    for (const p of worm.parts) expect(p.light).toBeGreaterThan(0);
    const others = [worm, ...worm.parts.slice(0, -1)].map((e) => e.light);
    expect(worm.tail.light).toBeGreaterThan(Math.max(...others));
  });

  it('leaving the room mid-death still records the defeat (the flag only)', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { hp: 1 });
    r.run(INTRO_TIME + 0.5);
    worm.tail.hurt(swordHit(r, worm.tail));
    r.run(0.3);
    expect(worm.dying).toBe(true);
    worm.onRemove();
    expect(r.flags[`defeated:${worm.id}`]).toBe(true);
    expect(r.events.some((e) => e.type === 'defeated')).toBe(false);
    expect(r.list.some((e) => e.type === 'obj.pickup')).toBe(false);
    // A live worm leaving records nothing.
    const r2 = rig(40, 200);
    const w2 = r2.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112);
    r2.run(INTRO_TIME + 0.5);
    w2.onRemove();
    expect(r2.flags[`defeated:${w2.id}`]).toBeUndefined();
  });

  it('stays slower than the walking hero (88 px/s) at its last hit point, dashes included', () => {
    const r = rig(40, 200);
    const worm = r.add((g, i) => new Worm(g, i), 'boss.worm', 128, 112, { hp: 12 });
    r.run(INTRO_TIME);
    worm.hp = 1;
    let top = 0;
    let sum = 0;
    let n = 0;
    r.run(30, () => {
      top = Math.max(top, worm.speed);
      sum += worm.speed;
      n++;
      return false;
    });
    expect(top).toBeLessThan(100);
    expect(sum / n).toBeLessThan(88);
  });
});

describe('iron knight', () => {
  /** The recoil moves the knight a few px back off the wall after a crash. */
  const CRASH_SLACK = 10;

  /** Knight at (x, y) with the hero at (hx, hy), past its intro. */
  function knightRig(x: number, y: number, hx: number, hy: number, props: Record<string, PropValue> = {}): { r: Rig; k: Knight } {
    const r = rig(hx, hy);
    const k = r.add((g, i) => new Knight(g, i), 'boss.knight', x, y, props);
    return { r, k };
  }

  it('walks toward the hero after the intro, keeping its shield on them', () => {
    const { r, k } = knightRig(128, 60, 128, 180);
    r.run(INTRO_TIME - 0.05);
    expect(k.y).toBe(60);
    r.run(1);
    expect(k.aiState).toBe('walk');
    expect(k.y).toBeGreaterThan(70);
    expect(k.facing).toBe('down');
  });

  it('winds up, charges in a line and is stunned by the wall it crashes into', () => {
    const { r, k } = knightRig(128, 60, 128, 180);
    r.run(6, () => k.aiState === 'windup');
    expect(k.aiState).toBe('windup');
    r.run(3, () => k.aiState === 'charge');
    expect(k.aiState).toBe('charge');
    const x0 = k.x;
    r.hero.x = 20;
    r.hero.y = 20; // out of the way
    r.run(3, () => k.aiState === 'stun');
    expect(k.aiState).toBe('stun');
    expect(Math.abs(k.x - x0)).toBeLessThan(1); // straight down
    expect(k.bottom).toBeGreaterThan(13 * TILE - CRASH_SLACK);
    expect(k.contactDamage).toBe(0);
    r.run(2.3);
    expect(k.aiState).toBe('stun');
    r.run(0.4);
    expect(k.aiState).toBe('walk');
    expect(k.contactDamage).toBe(2);
  });

  it('its shield blocks frontal sword hits (tink, hero pushed back); back hits land', () => {
    const { r, k } = knightRig(128, 100, 128, 130);
    r.run(INTRO_TIME + 0.1);
    expect(k.facing).toBe('down');
    const hp = k.hp;
    expect(k.hurt(swordHit(r, k))).toBe(false);
    expect(k.hp).toBe(hp);
    expect(r.sfx).toContain('swordTink');
    expect(r.hero.kbTime).toBeGreaterThan(0);
    expect(r.hero.kby).toBeGreaterThan(0);
    // Same swing from behind.
    r.hero.x = 128;
    r.hero.y = 70;
    expect(k.hurt({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: 1 })).toBe(true);
    expect(k.hp).toBe(hp - 1);
    expect(r.sfx).toContain('bossHit');
  });

  it('turns heavily: a hero who darts to its flank gets a hit in before the shield comes round', () => {
    const { r, k } = knightRig(128, 60, 128, 180);
    r.run(INTRO_TIME + 0.5);
    expect(k.aiState).toBe('walk');
    expect(k.facing).toBe('down');
    // Dart to its right side: still facing down a moment later, so the swing lands.
    r.hero.x = k.x + 26;
    r.hero.y = k.y;
    r.run(0.2);
    expect(k.facing).toBe('down');
    expect(k.hurt(swordHit(r, k))).toBe(true);
    // Hit, it wheels round at once.
    expect(k.facing).toBe('right');
    // Dart to the other flank: it follows after the lag, then blocks.
    const toLeft = (): void => {
      r.hero.x = k.x - 26;
      r.hero.y = k.y;
    };
    toLeft();
    r.run(0.2, () => (toLeft(), false));
    expect(k.facing).toBe('right');
    r.run(0.2, () => (toLeft(), false));
    expect(k.facing).toBe('left');
    expect(k.hurt(swordHit(r, k))).toBe(false);
  });

  it('a stunned knight takes damage from the front', () => {
    const { r, k } = knightRig(128, 60, 128, 180);
    r.run(8, () => k.aiState === 'stun');
    expect(k.aiState).toBe('stun');
    expect(k.facing).toBe('down');
    const hp = k.hp;
    r.hero.x = k.x;
    r.hero.y = k.y + 24;
    expect(k.hurt(swordHit(r, k))).toBe(true);
    expect(k.hp).toBe(hp - 1);
  });

  it('enrages at half health: faster charges and hop-slams with a shockwave', () => {
    const { r, k } = knightRig(128, 100, 128, 150, { hp: 4 });
    r.run(INTRO_TIME + 0.1);
    r.hero.x = 128;
    r.hero.y = 70;
    k.hurt({ damage: 2, kind: 'spin', source: r.hero, dx: 0, dy: 1 });
    expect(k.enraged).toBe(true);
    r.hero.y = 150;
    let hopped = false;
    let stunned = false;
    r.run(30, () => {
      hopped ||= k.aiState === 'hop';
      stunned ||= k.aiState === 'stun';
      return hopped && stunned;
    });
    expect(hopped).toBe(true);
    expect(r.effects).toContain('fx.dust');
  });

  it('once enraged, never charges more than twice in a row', () => {
    const { r, k } = knightRig(128, 100, 128, 150, { hp: 2 });
    r.run(INTRO_TIME + 0.1);
    r.hero.y = 70;
    k.hurt({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: 1 });
    expect(k.enraged).toBe(true);
    r.hero.y = 150;
    const attacks: string[] = [];
    let last = k.aiState;
    r.run(60, () => {
      if (k.aiState !== last && (k.aiState === 'windup' || k.aiState === 'hop')) attacks.push(k.aiState);
      last = k.aiState;
      return false;
    });
    expect(attacks.length).toBeGreaterThan(4);
    expect(attacks.join(',')).not.toContain('windup,windup,windup');
    expect(attacks).toContain('hop');
  });

  /** Private knight internals driven directly by the charge / slam tests. */
  type KnightInternals = { aim: Vec; charged: number; enter(st: string, len?: number): void; startHop(): void };
  const internals = (k: Knight) => k as unknown as KnightInternals;

  /** Force a charge along (ax, ay), skipping the walk and the wind-up. */
  function forceCharge(k: Knight, ax: number, ay: number): void {
    const kk = internals(k);
    kk.aim = normalize(ax, ay);
    kk.charged = 0;
    kk.enter('charge');
  }

  /** Run until the charge ends; returns how far it went and the state it ended in. */
  function runCharge(r: Rig, k: Knight): { travelled: number; ended: string } {
    const x0 = k.x;
    const y0 = k.y;
    r.run(4, () => k.aiState !== 'charge');
    return { travelled: Math.hypot(k.x - x0, k.y - y0), ended: k.aiState };
  }

  it('flush with a wall, a charge at a hero further along it slides along the wall instead of stunning at once', () => {
    // Knight flush with the top wall (top = one tile), the hero hugging the same wall far to its left.
    const { r, k } = knightRig(220, TILE + 10, 40, TILE + 6);
    expect(k.top).toBe(TILE);
    let from: Vec | null = null;
    r.run(10, () => {
      if (k.aiState === 'charge' && !from) from = { x: k.x, y: k.y };
      return k.aiState === 'stun';
    });
    expect(k.aiState).toBe('stun');
    expect(from).not.toBeNull();
    const start = from as unknown as Vec;
    expect(Math.hypot(k.x - start.x, k.y - start.y)).toBeGreaterThan(32);
    // It crashed into the left wall it charged at, not the top wall it grazed.
    expect(k.left).toBeLessThan(TILE + CRASH_SLACK);
  });

  it('grazing contacts deflect the charge; head-on ones after a run-up crash; a charge into an adjacent wall just stops', () => {
    // Flush with the top wall, aimed 20 degrees into it: deflected left along the wall all the way to the left wall.
    // (Forced during the last intro tick, before its walk can move it.)
    const a = knightRig(180, TILE + 10, 30, 200);
    a.r.run(INTRO_TIME - STEP);
    forceCharge(a.k, -0.94, -0.34);
    const graze = runCharge(a.r, a.k);
    expect(graze.ended).toBe('stun');
    expect(graze.travelled).toBeGreaterThan(120);
    expect(a.k.facing).toBe('left');

    // 8 px above the floor wall, shallow down-right: it skims the floor wall, then crashes into the right wall.
    const b = knightRig(100, 13 * TILE - 18, 30, 30);
    b.r.run(INTRO_TIME - STEP);
    forceCharge(b.k, 0.95, 0.31);
    const skim = runCharge(b.r, b.k);
    expect(skim.ended).toBe('stun');
    expect(b.k.right).toBeGreaterThan(15 * TILE - CRASH_SLACK);

    // Already against the left wall and charging straight into it: no free stun.
    const c = knightRig(TILE + 12, 112, 200, 112);
    c.r.run(INTRO_TIME - STEP);
    forceCharge(c.k, -1, 0);
    const stuck = runCharge(c.r, c.k);
    expect(stuck.ended).toBe('recover');
    expect(stuck.travelled).toBeLessThan(1);
  });

  it('in the wind-up the drawn pose always shows the side the shield covers', () => {
    // Hero to the left: braced facing left (walk pose, pawing), not the camera-facing charge pose.
    const { r, k } = knightRig(170, 112, 60, 112);
    r.run(8, () => k.aiState === 'windup');
    r.run(0.1);
    expect(k.aiState).toBe('windup');
    expect(k.facing).toBe('left');
    expect(k.anim).toBe('walk_left');
    const hp = k.hp;
    r.hero.x = k.x - 26;
    r.hero.y = k.y;
    expect(k.hurt(swordHit(r, k))).toBe(false); // into the drawn shield
    expect(k.hp).toBe(hp);
    r.hero.x = k.x;
    r.hero.y = k.y + 26;
    expect(k.hurt(swordHit(r, k))).toBe(true); // its flank
    // It keeps turning toward the hero while it braces (after its heavy turn lag).
    r.run(0.35);
    expect(k.aiState).toBe('windup');
    expect(k.facing).toBe('down');

    // Hero below: the front-facing brace, which is facing down.
    const d = knightRig(128, 60, 128, 180);
    d.r.run(8, () => d.k.aiState === 'windup');
    d.r.run(0.1);
    expect(d.k.facing).toBe('down');
    expect(d.k.anim).toBe('charge');
  });

  it('telegraphs the hop-slam: a hero who starts running within half a second dodges, one who stands still is hit', () => {
    const trial = (react: number | null): { hits: number; groundedFor: number } => {
      const { r, k } = knightRig(128, 112, 158, 112, { hp: 8 });
      r.run(INTRO_TIME + 0.1);
      k.hp = 4;
      r.hero.x = k.x + 30;
      r.hero.y = k.y;
      internals(k).startHop();
      expect(k.aiState).toBe('crouch');
      let t = 0;
      let groundedFor = -1;
      r.run(1.4, () => {
        t += STEP;
        if (groundedFor < 0 && k.z > 0) groundedFor = t;
        if (react !== null && t > react) r.hero.x = Math.min(15 * TILE - 8, r.hero.x + 88 * STEP);
        return false;
      });
      return { hits: r.hero.hits.filter((h) => h.source === k).length, groundedFor };
    };
    for (const react of [0, 0.25, 0.5]) expect(trial(react).hits).toBe(0);
    const still = trial(null);
    expect(still.hits).toBe(1);
    // The flail goes up well before it leaves the ground.
    expect(still.groundedFor).toBeGreaterThanOrEqual(0.35);
  });

  it('tinks blade hits on the shield itself, but leaves the clink of a refused arrow to the arrow', () => {
    const { r, k } = knightRig(128, 100, 128, 130);
    r.run(INTRO_TIME + 0.1);
    expect(k.facing).toBe('down');
    r.sfx.length = 0;
    r.effects.length = 0;
    expect(k.hurt({ damage: 1, kind: 'arrow', source: null, dx: 0, dy: -1 })).toBe(false);
    expect(r.sfx).not.toContain('swordTink');
    expect(r.effects).not.toContain('fx.hit');
    expect(k.hurt(swordHit(r, k))).toBe(false);
    expect(r.sfx).toContain('swordTink');
    expect(r.effects).toContain('fx.hit');
  });

  it('a solid that closes on it never traps it: it walks out, but cannot sink deeper', () => {
    const { r, k } = knightRig(128, 100, 128, 180);
    r.run(INTRO_TIME + 0.1);
    // A shutter shut 3 px into its back, and a peg standing just below it.
    addSolid(r, k.x, k.top - 8 + 3, 32, 16);
    const peg = addSolid(r, k.x + 40, k.bottom + 8, 16, 16);
    expect(k.isBlockedAt(k.x, k.y - 1)).toBe(true);
    expect(k.isBlockedAt(k.x, k.y + 1)).toBe(false);
    expect(k.isBlockedAt(k.x - 1, k.y)).toBe(false);
    // Solids it does not overlap block as usual.
    expect(k.isBlockedAt(peg.x, k.y + 1)).toBe(true);
    const y0 = k.y;
    r.run(2);
    expect(k.y).toBeGreaterThan(y0 + 16);
  });

  it('keeps out of doorways: a charge at a hero standing in an open one crashes on its edge', () => {
    const { r, k } = knightRig(128, 190, 128, 40);
    const door = addDoor(r, 128, 40); // open: not solid, the hero inside it
    r.run(8, () => k.aiState === 'charge');
    expect(k.aiState).toBe('charge');
    r.run(3, () => k.aiState === 'stun');
    expect(k.aiState).toBe('stun');
    expect(k.top).toBeGreaterThanOrEqual(door.bottom - 1e-6);
    expect(k.top).toBeLessThan(door.bottom + CRASH_SLACK);
    // A doorway it already stands in only keeps it from going deeper.
    door.y = k.top - door.h / 2 + 4;
    expect(k.isBlockedAt(k.x, k.y - 1)).toBe(true);
    expect(k.isBlockedAt(k.x, k.y + 1)).toBe(false);
  });

  it('blows on its helm and shoulders count: the same shield rule, shared i-frames', () => {
    const { r, k } = knightRig(128, 100, 128, 60);
    r.run(INTRO_TIME + 0.1);
    const helm = r.list.find((e): e is KnightHelm => e instanceof KnightHelm)!;
    expect(helm).toBe(k.helm);
    // Right on top of the footprint hitbox; harmless and not part of the room's enemy count.
    expect(helm.x).toBe(k.x);
    expect(helm.bottom).toBeCloseTo(k.top);
    expect(helm.solid || helm.countsForClear || helm.contactDamage > 0).toBe(false);
    // The hero swings down onto the helm of a knight facing away.
    k.facing = 'down';
    r.hero.x = k.x;
    r.hero.y = k.y - 30;
    const hp = k.hp;
    expect(helm.hurt(swordHit(r, helm))).toBe(true);
    expect(k.hp).toBe(hp - 1);
    expect(k.hitFlash).toBeGreaterThan(0);
    // Hit, it wheels round to face the hero; the same swing reaching its body neither hits again nor tinks.
    expect(k.facing).toBe('up');
    r.sfx.length = 0;
    expect(k.hurt(swordHit(r, k))).toBe(false);
    expect(k.hp).toBe(hp - 1);
    expect(r.sfx).not.toContain('swordTink');
    // Facing the hero, the shield takes it.
    r.run(0.6);
    k.facing = 'up';
    r.sfx.length = 0;
    expect(helm.hurt(swordHit(r, helm))).toBe(false);
    expect(k.hp).toBe(hp - 1);
    expect(r.sfx).toContain('swordTink');
    // It keeps following the knight, and goes with it.
    r.run(0.5);
    expect(helm.x).toBe(k.x);
    expect(helm.y).toBeCloseTo(k.y - 16);
    k.dead = true;
    r.run(STEP);
    expect(helm.dead).toBe(true);
    expect(r.list.includes(helm)).toBe(false);
  });

  it('bomb blasts on its shield glance off with a spark and a tink', () => {
    const { r, k } = knightRig(128, 100, 128, 150);
    r.run(INTRO_TIME + 0.1);
    k.facing = 'down';
    r.sfx.length = 0;
    r.effects.length = 0;
    const bomb = { x: k.x, y: k.y + 16 } as unknown as Entity;
    expect(k.hurt({ damage: 2, kind: 'bomb', source: bomb, dx: 0, dy: -1 })).toBe(false);
    expect(r.sfx).toContain('swordTink');
    expect(r.effects).toContain('fx.hit');
    const hp = k.hp;
    expect(k.hurt({ damage: 2, kind: 'bomb', source: { x: k.x, y: k.y - 16 } as unknown as Entity, dx: 0, dy: 1 })).toBe(true);
    expect(k.hp).toBe(hp - 2);
  });

  it('leaving the room mid-death still records the defeat', () => {
    const { r, k } = knightRig(128, 100, 128, 150, { hp: 1 });
    r.run(INTRO_TIME + 0.1);
    r.hero.y = 70;
    k.hurt({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: 1 });
    r.run(1);
    expect(k.dying && !k.dead).toBe(true);
    k.onRemove();
    expect(r.flags[`defeated:${k.id}`]).toBe(true);
    expect(k.helm.dead).toBe(true);
  });

  it('dies in a dozen explosions and drops its heart container', () => {
    const { r, k } = knightRig(128, 100, 128, 150, { hp: 1 });
    r.run(INTRO_TIME + 0.1);
    r.hero.y = 70;
    expect(k.hurt({ damage: 1, kind: 'sword', source: r.hero, dx: 0, dy: 1 })).toBe(true);
    expect(k.dying).toBe(true);
    r.run(5, () => k.dead);
    expect(k.dead).toBe(true);
    expect(r.effects.filter((s) => s === 'fx.explosion')).toHaveLength(12);
    expect(r.flags[`defeated:${k.id}`]).toBe(true);
    expect(r.list.find((e) => e.type === 'obj.pickup')?.id).toBe(`${k.id}-heart`);
  });
});
