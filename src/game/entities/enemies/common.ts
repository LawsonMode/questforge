// =============================================================================
// Shared enemy toolkit — the Enemy base class, AI movement/sensing helpers and
// the generic EnemyProjectile. OWNER: enemies agent (group A). Other enemy and
// boss modules import this read-only, so the exported API is kept stable.
//
//   class Octo extends Enemy {
//     constructor(game: GameServices, inst: EntityInstance | null) {
//       super(game, inst);
//       this.sprite = 'enemy.spitter';
//       this.palette = this.paletteForVariant();
//       this.hp = this.maxHp = 1;
//       this.touchDamage = 1;          // NOT contactDamage (see below)
//     }
//     protected think(dt: number): void {
//       if (this.seesHero(80)) this.chase(this.hero, 50, dt); else this.wander(dt, 30);
//       this.playDir('walk');
//     }
//   }
//
// Lifecycle (engine calls tickCommon() then update() each tick):
// - Spawn grace: for `wakeT` seconds (SPAWN_DELAY) after spawning the AI does not
//   run and contactDamage stays 0, so enemies never hit the hero on the first
//   frames of a room. Set `touchDamage`; contactDamage mirrors it once awake.
// - Spawn unstick: on its first tick a walker placed partly inside a wall or a
//   solid object (the editor's 8 px and free placement allow it) moves to the
//   nearest spot within SPAWN_UNSTICK px where it can stand - every 1 px step of
//   one that starts overlapping would be refused, freezing it at its post.
//   Stationary enemies that belong where they are placed opt out (unstickOnSpawn).
// - tickCommon() also carries hop() momentum (so an arc finishes even if stunned);
//   update() calls think(dt) once awake. The engine skips update() while stunned;
//   stunned enemies freeze their anim and shake. draw() raises the sprite by
//   `artLift` for art that sits low in its frame.
// - hurt() -> default Entity rules (hp, knockback, i-frames, flash, sfx, die), then
//   onHurt(hit) if the enemy survived (alert, flee...). die() = poof + loot at
//   lootAt() (key carriers drop a one-time key, see enemyKeyId).
// - Movement helpers (stepBy, wander, chase, flee, keepDistance, lineUp) are
//   knockback-safe (no AI steps while knocked back), slide around corners and
//   avoid spike tiles; walkers already respect pits/water/ledges via `mover`.
//   chase() detours around walls: toward the nearer opening within 4 tiles, else
//   it follows the wall until it ends or opens. It is not a pathfinder, so mazes
//   and U-shaped walls still stump it (ALttP-style).
// =============================================================================
import type { Dir, EntityInstance } from '../../../core/types';
import type { DamageKind, GameServices, Hit, PlayerApi, Renderer, RoomRuntime } from '../../api';
import { Entity, findSprite } from '../../entity';
import { DIRS, DIR_VEC, OPPOSITE, normalize, rectsOverlap, sign, vecToDir, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { VARIANT_PALETTES, type DropKind } from '../../../content/ids';
import { createEntity } from '../../registry';
import { findFreeSpot } from '../../spot';

/** Seconds after spawning before an enemy acts or deals contact damage. */
export const SPAWN_DELAY = 0.4;
/** Default corner-slide assist (px) for AI movement. */
export const ENEMY_SLIDE = 6;
/** Line-of-sight sample spacing (px). */
const SIGHT_STEP = 4;
/** Walk-path sample spacing (px) for canWalkTo. */
const PATH_STEP = 4;
/** Farthest sideways probe (px) when chase() looks for a way around an obstacle. */
const DETOUR_PROBE = 4 * TILE;
/** Longest single detour (s) before chase() reconsiders. */
const DETOUR_MAX_TIME = 6;
/** Past the obstacle's edge, keep heading the blocked way this far (px). */
const DETOUR_COMMIT = TILE;
/** Look-ahead (px) when testing whether the blocked way has opened. */
const DETOUR_LOOK = 8;
/** Stun shake frequency (offset flips per second). */
const STUN_SHAKE_HZ = 30;
/** Projectiles hit the hero only while the hero is lower than this (px). */
const HIT_MAX_Z = 8;
/** Farthest (px) a walker placed overlapping a wall is moved on its first tick. */
export const SPAWN_UNSTICK = 16;

// ----------------------------------------------------------------------------
// Pure helpers (exported for reuse and unit tests)
// ----------------------------------------------------------------------------

/** Id of the placed key a key-carrying enemy drops (its pickup:<id> flag makes the key one-time). */
export function enemyKeyId(enemyId: string): string {
  return `${enemyId}-key`;
}

/** Palette id for a sprite variant (undefined = the sprite's base palette or an unknown variant). */
export function variantPalette(spriteId: string, variant: string): string | undefined {
  return VARIANT_PALETTES[spriteId]?.[variant] ?? undefined;
}

/**
 * Whether the straight segment a->b is free of sight-blocking tiles, sampled every
 * `step` px. Only 'solid' collision blocks sight (pits and water hide nothing);
 * outside the room counts as solid.
 */
export function lineOfSight(room: RoomRuntime, ax: number, ay: number, bx: number, by: number, step = SIGHT_STEP): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (room.collisionAt(ax + (bx - ax) * t, ay + (by - ay) * t) === 'solid') return false;
  }
  return true;
}

/** The axes a row/column test looks along. */
export type LineAxis = 'both' | 'horizontal' | 'vertical';

/**
 * Which way to go from `from` to reach `to` along a row or column: null unless `to`
 * is within `tol` px across an allowed axis and at most `rangePx` along it.
 * Lined up on both axes (overlapping), the longer offset wins.
 */
export function rowColumnDir(from: Vec, to: Vec, axis: LineAxis, rangePx: number, tol: number): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horiz = axis !== 'vertical' && Math.abs(dy) <= tol && Math.abs(dx) <= rangePx && dx !== 0;
  const vert = axis !== 'horizontal' && Math.abs(dx) <= tol && Math.abs(dy) <= rangePx && dy !== 0;
  if (horiz && (!vert || Math.abs(dx) >= Math.abs(dy))) return dx < 0 ? 'left' : 'right';
  if (vert) return dy < 0 ? 'up' : 'down';
  return null;
}

/**
 * Pick a wander direction from `free` using `roll` in [0, 1): never straight back
 * the way it came unless that is the only way out. null when boxed in.
 */
export function pickWanderDir(free: readonly Dir[], current: Dir | null, roll: number): Dir | null {
  if (free.length === 0) return null;
  const back = current ? OPPOSITE[current] : null;
  const pool = free.length > 1 ? free.filter((d) => d !== back) : free;
  return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))]!;
}

/** Launch speed and gravity for a hop that peaks at `height` px and lands after `duration` s. */
export function hopArc(height: number, duration: number): { vz: number; gravity: number } {
  return { vz: (4 * height) / duration, gravity: (8 * height) / (duration * duration) };
}

/**
 * How far (px, at most `dist`) the point (x, y) can be shoved along the unit vector
 * (ux, uy) and stay `margin` px short of a pit or spike tile. Enemies use it to cap
 * a recoil they give the hero, so a clash never knocks the hero into a hole.
 */
export function safeShove(room: RoomRuntime, x: number, y: number, ux: number, uy: number, dist: number, margin = 2): number {
  for (let d = 1; d <= dist + margin; d++) {
    const c = room.collisionAt(x + ux * d, y + uy * d);
    if (c === 'pit' || c === 'hurt') return Math.max(0, d - 1 - margin);
  }
  return dist;
}

/** Sprites an EnemyProjectile can use. */
export type ProjectileSprite = 'proj.rock' | 'proj.arrow' | 'proj.spear' | 'proj.bone' | 'proj.beam' | 'proj.fireball';

/** Anim for a projectile sprite flying along (vx, vy): arrows/spears point, bones spin, the rest 'fly'. */
export function projectileAnim(sprite: ProjectileSprite, vx: number, vy: number): string {
  if (sprite === 'proj.arrow' || sprite === 'proj.spear') return vecToDir(vx, vy);
  return sprite === 'proj.bone' ? 'spin' : 'fly';
}

// ----------------------------------------------------------------------------
// Enemy base class
// ----------------------------------------------------------------------------

export abstract class Enemy extends Entity {
  /** Seconds left in the spawn grace (no AI, no contact damage). */
  wakeT = SPAWN_DELAY;
  /** Contact damage in half-hearts once awake; the engine-read contactDamage mirrors it. */
  touchDamage = 1;
  /** Corner-slide assist (px) used by the movement helpers. */
  slide = ENEMY_SLIDE;
  /** AI movement refuses to step onto spike ('hurt') tiles. */
  avoidHazards = true;
  /**
   * Px the sprite is drawn above the hitbox centre, for art that sits low in its
   * frame (small slimes); the airborne shadow stays at the footprint.
   */
  artLift = 0;
  private wanderDir: Dir | null = null;
  private wanderT = 0;
  private detour: Detour | null = null;
  /** Side taken by the last detour (reused when neither side shows an opening). */
  private lastDetourSide: Dir | null = null;
  private hopVx = 0;
  private hopVy = 0;
  /** Walkers step out of a wall they were placed overlapping (first tick). False for enemies fixed to their spot. */
  protected unstickOnSpawn = true;
  private settled = false;

  constructor(game: GameServices, inst: EntityInstance | null, type?: string) {
    super(game, inst, type);
    this.team = 'enemy';
    this.contactDamage = 0;
  }

  /** AI for one tick; runs only once awake and not stunned. */
  protected abstract think(dt: number): void;

  /** Reaction to a hit that landed without killing (alert, flee...). Default: nothing. */
  protected onHurt(_hit: Hit): void {}

  /** Where the 'drop' loot lands (null: none). Default: the hitbox centre. */
  protected lootAt(): Vec | null {
    return { x: this.x, y: this.y };
  }

  /** Nearest spot within `reach` px where this hitbox fits on walker ground (null: none). */
  protected floorSpotNear(reach: number): Vec | null {
    const room = this.game.room;
    const free = (x: number, y: number): boolean => !room.blocked(this.rectAt(x, y), 'walker');
    return findFreeSpot(free, Math.round(this.x), Math.round(this.y), { maxRadius: reach });
  }

  /** Placed partly inside a wall or solid object: move to the nearest spot within SPAWN_UNSTICK px where it can stand. */
  private unstick(): void {
    if (!this.unstickOnSpawn || this.mover !== 'walker' || !this.isBlockedAt(this.x, this.y)) return;
    const spot = findFreeSpot((x, y) => this.canStand(x, y), Math.round(this.x), Math.round(this.y), { maxRadius: SPAWN_UNSTICK });
    if (!spot) return;
    this.x = spot.x;
    this.y = spot.y;
  }

  // ------------------------------------------------------------------ lifecycle

  override tickCommon(dt: number): void {
    if (!this.settled) {
      this.settled = true;
      this.unstick();
    }
    const frozen = this.stun > 0;
    const t = this.animT;
    const hopping = this.airborne && (this.hopVx !== 0 || this.hopVy !== 0);
    super.tickCommon(dt);
    if (frozen) this.animT = t;
    // Hop momentum, including the landing tick (walls and pits stop it for walkers).
    if (hopping) this.move(this.hopVx * dt, this.hopVy * dt);
    if (!this.airborne) {
      this.hopVx = 0;
      this.hopVy = 0;
    }
    if (this.wakeT > 0) this.wakeT = Math.max(0, this.wakeT - dt);
    this.contactDamage = this.wakeT > 0 ? 0 : this.touchDamage;
  }

  override update(dt: number): void {
    if (this.wakeT <= 0) this.think(dt);
  }

  override hurt(hit: Hit): boolean {
    const landed = super.hurt(hit);
    if (landed && !this.dead) this.onHurt(hit);
    return landed;
  }

  /**
   * Death while still on the enemy team: poof, then the 'drop' loot at lootAt()
   * (a small key drops only once, see dropKey). Entity.die() then sets the
   * persistDefeat flag and emits 'defeated'.
   */
  override die(): void {
    if (this.dead) return;
    if (this.team === 'enemy') {
      this.game.effect('fx.poof', 'play', this.x, this.y - this.z);
      const drop = this.prop('drop', 'random') as DropKind;
      const at = drop === 'none' ? null : this.lootAt();
      if (at && drop === 'smallKey') this.dropKey(at);
      else if (at) this.game.dropLoot(at.x, at.y, drop);
      // Entity.die() would poof and drop again for the enemy team.
      this.team = 'neutral';
    }
    super.die();
  }

  /**
   * A key carrier leaves a placed key (enemyKeyId) that never times out; once it
   * was collected, its pickup flag turns later drops into ordinary loot.
   */
  private dropKey(at: Vec): void {
    const id = enemyKeyId(this.id);
    if (this.game.flag(`pickup:${id}`)) {
      this.game.dropLoot(at.x, at.y, 'random');
      return;
    }
    const inst: EntityInstance = { id, type: 'obj.pickup', x: at.x, y: at.y, props: { item: 'smallKey', amount: 1, hidden: false } };
    const key = createEntity(this.game, inst);
    if (key) this.game.spawn(key);
  }

  /** Default draw, raised by artLift and shaken sideways while stunned. */
  override draw(r: Renderer): void {
    const shake = this.stun > 0 ? (Math.floor(this.game.time * STUN_SHAKE_HZ) % 2 === 0 ? 1 : -1) : 0;
    const lift = this.artLift;
    if (shake === 0 && lift === 0) {
      super.draw(r);
      return;
    }
    const { x, y, shadow } = this;
    if (lift !== 0 && shadow && this.visible && this.sprite !== '' && this.z > 0) r.drawShadow(x + shake, y + this.h / 2 - 1, Math.max(8, this.w));
    this.x = x + shake;
    this.y = y - lift;
    this.shadow = shadow && lift === 0;
    try {
      super.draw(r);
    } finally {
      this.x = x;
      this.y = y;
      this.shadow = shadow;
    }
  }

  // ------------------------------------------------------------------ looks

  get hero(): PlayerApi {
    return this.game.player;
  }

  /** True while in a hop / jump arc. */
  get airborne(): boolean {
    return this.z > 0 || this.vz > 0;
  }

  /** Palette for this instance's 'variant' prop on its sprite (undefined = base palette). */
  paletteForVariant(): string | undefined {
    return variantPalette(this.sprite, String(this.prop('variant', '')));
  }

  /** Show a single frame of `anim` (standing poses, anticipation squashes). */
  holdFrame(anim: string, frame = 0): void {
    this.play(anim);
    const fps = findSprite(this.game.project, this.sprite)?.anims[anim]?.fps ?? 0;
    this.animT = fps > 0 ? (frame + 0.5) / fps : 0;
  }

  faceToward(p: Vec): void {
    this.facing = this.dirTo(p);
  }

  /** Face the dominant direction of a movement vector (unchanged for a zero vector). */
  faceAlong(dx: number, dy: number): void {
    this.facing = vecToDir(dx, dy, this.facing);
  }

  /** Point `dist` px from the hitbox centre toward `dir` (projectile muzzles). */
  ahead(dist: number, dir: Dir = this.facing): Vec {
    const v = DIR_VEC[dir];
    return { x: this.x + v.x * dist, y: this.y + v.y * dist };
  }

  // ------------------------------------------------------------------ senses

  /** The hero can be targeted: visible, not dead, not falling into a pit. */
  heroTargetable(): boolean {
    const s = this.hero.state;
    return this.hero.visible && s !== 'dead' && s !== 'fall';
  }

  /** Clear line of sight to `p` (solid tiles block) within `range` px. */
  canSee(p: Vec, range: number): boolean {
    return this.distTo(p) <= range && lineOfSight(this.game.room, this.x, this.y, p.x, p.y);
  }

  /**
   * The hero is targetable and visible within `range` px. frontOnly: the hero must
   * not be behind this enemy's facing (a ~200 degree view cone).
   */
  seesHero(range: number, frontOnly = false): boolean {
    if (!this.heroTargetable() || !this.canSee(this.hero, range)) return false;
    return !frontOnly || this.inFront(this.hero, -0.2);
  }

  /** Dot product of the facing vector and the unit vector to `p` is at least minDot. */
  inFront(p: Vec, minDot = 0): boolean {
    const f = DIR_VEC[this.facing];
    const v = this.vecTo(p);
    return f.x * v.x + f.y * v.y >= minDot;
  }

  /** The hero is mid sword swing / spin within `radius` px. */
  heroSwinging(radius: number): boolean {
    const s = this.hero.state;
    return (s === 'attack' || s === 'spin') && this.distTo(this.hero) <= radius;
  }

  // ------------------------------------------------------------------ walkability

  /** The hitbox could stand at (x, y): tiles for this mover, solid entities and (avoidHazards) spikes. */
  canStand(x: number, y: number): boolean {
    if (this.isBlockedAt(x, y)) return false;
    return !this.avoidHazards || !this.onHazard(x, y);
  }

  /** A straight walk from here to (x, y) stays standable (sampled every 4 px). */
  canWalkTo(x: number, y: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x - this.x, y - this.y) / PATH_STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.canStand(this.x + (x - this.x) * t, this.y + (y - this.y) * t)) return false;
    }
    return true;
  }

  /** Directions with a clear walk of `dist` px (default one tile). */
  freeDirs(dist: number = TILE): Dir[] {
    return DIRS.filter((d) => this.canWalkTo(this.x + DIR_VEC[d].x * dist, this.y + DIR_VEC[d].y * dist));
  }

  private onHazard(x: number, y: number): boolean {
    return this.game.room.collisionAt(x, y) === 'hurt';
  }

  // ------------------------------------------------------------------ movement

  /**
   * AI step by (dx, dy) px: nothing while knocked back (the knockback owns the
   * motion), corner sliding, and no axis steps onto a spike tile (avoidHazards).
   * Returns the distance actually moved.
   */
  stepBy(dx: number, dy: number): number {
    if (this.kbTime > 0) return 0;
    const x0 = this.x;
    const y0 = this.y;
    if (this.avoidHazards && !this.onHazard(x0, y0)) {
      if (dx !== 0 && this.onHazard(x0 + dx, y0)) dx = 0;
      if (dy !== 0 && this.onHazard(x0, y0 + dy)) dy = 0;
    }
    if (dx === 0 && dy === 0) return 0;
    this.move(dx, dy, this.slide);
    return Math.hypot(this.x - x0, this.y - y0);
  }

  /**
   * Random 4-way wander at `speed` px/s: turns when blocked or after a random
   * turnMin..turnMax seconds, never straight back unless cornered. Faces the walk
   * direction. Returns true if it moved.
   */
  wander(dt: number, speed: number, turnMin = 0.8, turnMax = 2): boolean {
    this.wanderT -= dt;
    if (this.wanderDir === null || this.wanderT <= 0) this.turnWander(turnMin, turnMax);
    const dir = this.wanderDir;
    if (!dir) return false;
    this.facing = dir;
    const v = DIR_VEC[dir];
    const moved = this.stepBy(v.x * speed * dt, v.y * speed * dt);
    if (moved < speed * dt * 0.5 && this.kbTime <= 0) this.turnWander(turnMin, turnMax);
    return moved > 0;
  }

  /**
   * Choose a new wander direction now (e.g. after a pause) and face it. `prefer`
   * is taken when it is free (steer a wander toward the hero, a post...).
   */
  turnWander(turnMin = 0.8, turnMax = 2, prefer?: Dir): void {
    const free = this.freeDirs();
    this.wanderDir = prefer && free.includes(prefer) ? prefer : pickWanderDir(free, this.wanderDir, rng.next());
    this.wanderT = rng.range(turnMin, turnMax);
    if (this.wanderDir) this.facing = this.wanderDir;
  }

  /**
   * The direction that closes the smaller offset to `p` (the quickest way to line
   * up with it); once lined up within `tol` px, the direction straight toward it.
   */
  lineUpDir(p: Vec, tol = 2): Dir {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const horizontal = Math.abs(dx) < Math.abs(dy);
    const minor = horizontal ? dx : dy;
    if (Math.abs(minor) <= tol) return vecToDir(dx, dy, this.facing);
    if (horizontal) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  /**
   * Walk toward `target` at `speed` px/s, sliding along walls and around corners.
   * When an obstacle blocks the main way to the target it detours: sidesteps
   * toward the nearer opening (probing up to 4 tiles each way) or, seeing none,
   * follows the obstacle (keeping the side it last took) until it ends or opens;
   * then pushes a tile through the gap before heading straight for the target
   * again. Faces the direction of travel. Returns true if it moved.
   */
  chase(target: Vec, speed: number, dt: number): boolean {
    if (this.kbTime > 0) return false;
    const step = speed * dt;
    if (this.detour && this.followDetour(target, step, dt)) return true;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    // Snap near-aligned offsets to one axis so the base corner sliding kicks in.
    const n = normalize(Math.abs(dx) < 2 ? 0 : dx, Math.abs(dy) < 2 ? 0 : dy);
    if (n.x === 0 && n.y === 0) return false;
    this.faceAlong(dx, dy);
    const len = Math.min(step, Math.hypot(dx, dy));
    const x0 = this.x;
    const y0 = this.y;
    const moved = this.stepBy(n.x * len, n.y * len);
    if (moved >= len * 0.25 && this.madeHeadway(n, x0, y0, len)) return true;
    this.startDetour(dx, dy);
    return moved > 0;
  }

  /** Walk straight away from `from` (faces away). */
  flee(from: Vec, speed: number, dt: number): boolean {
    return this.chase({ x: 2 * this.x - from.x, y: 2 * this.y - from.y }, speed, dt);
  }

  /** Hold min..max px from `target`: back off when closer, approach when farther. */
  keepDistance(target: Vec, min: number, max: number, speed: number, dt: number): 'away' | 'toward' | 'hold' {
    const d = this.distTo(target);
    if (d < min) {
      this.flee(target, speed, dt);
      return 'away';
    }
    if (d > max) {
      this.chase(target, speed, dt);
      return 'toward';
    }
    return 'hold';
  }

  /**
   * Sidestep along the smaller offset until lined up with `target` on a row ('h')
   * or column ('v') within tol px; when that sidestep is blocked it closes the
   * other offset instead. Returns the axis once aligned, else null. Facing is
   * left alone (callers usually face the target to aim).
   */
  lineUp(target: Vec, speed: number, dt: number, tol = 4): 'h' | 'v' | null {
    const already = this.alignedWith(target, tol);
    if (already) return already;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const step = speed * dt;
    const sx = sign(dx) * Math.min(step, Math.abs(dx));
    const sy = sign(dy) * Math.min(step, Math.abs(dy));
    const horizontalFirst = Math.abs(dx) < Math.abs(dy);
    const moved = horizontalFirst ? this.stepBy(sx, 0) : this.stepBy(0, sy);
    if (moved === 0 && this.kbTime <= 0) {
      if (horizontalFirst) this.stepBy(0, sy);
      else this.stepBy(sx, 0);
    }
    return this.alignedWith(target, tol);
  }

  /**
   * Start a hop arc that travels (dx, dy) px in `duration` s, peaking at `height`
   * px. The horizontal motion is applied automatically each tick while airborne
   * (walls and pits stop it for walkers).
   */
  hop(dx: number, dy: number, height: number, duration: number): void {
    const arc = hopArc(height, duration);
    this.gravity = arc.gravity;
    this.vz = arc.vz;
    this.hopVx = dx / duration;
    this.hopVy = dy / duration;
  }

  /** Spawn an EnemyProjectile fired by this enemy. */
  shoot(shot: Omit<EnemyShot, 'source'>): EnemyProjectile {
    return this.game.spawn(new EnemyProjectile(this.game, { ...shot, source: this }));
  }

  /**
   * Pick the detour side after chase() got stuck heading (dx, dy): the side whose
   * opening is nearer (ties: toward the target); seeing none, the side it last took
   * (so it keeps following one wall instead of pacing), else any side with room.
   */
  private startDetour(dx: number, dy: number): void {
    const primary = vecToDir(dx, dy);
    const vertical = primary === 'up' || primary === 'down';
    const minor = vertical ? dx : dy;
    const toward: Dir = vertical ? (minor < 0 ? 'left' : 'right') : (minor < 0 ? 'up' : 'down');
    const last = this.lastDetourSide;
    const lastUsable = last !== null && last !== primary && last !== OPPOSITE[primary];
    const first = lastUsable && Math.abs(minor) < 1 ? last : toward;
    const second = OPPOSITE[first];
    const reachFirst = this.detourReach(first, primary);
    const reachSecond = this.detourReach(second, primary);
    let side: Dir | null = null;
    if (Math.min(reachFirst, reachSecond) < Infinity) side = reachFirst <= reachSecond ? first : second;
    else {
      const order = lastUsable ? [last, OPPOSITE[last]] : [first, second];
      side = order.find((s) => this.canStand(this.x + DIR_VEC[s].x * PATH_STEP, this.y + DIR_VEC[s].y * PATH_STEP)) ?? null;
    }
    this.detour = side ? { side, primary, t: DETOUR_MAX_TIME, commit: 0 } : null;
    if (side) this.lastDetourSide = side;
  }

  /** Sideways distance (px) toward `side` at which the `primary` way opens; Infinity if none within DETOUR_PROBE. */
  private detourReach(side: Dir, primary: Dir): number {
    const s = DIR_VEC[side];
    const p = DIR_VEC[primary];
    for (let o = PATH_STEP; o <= DETOUR_PROBE; o += PATH_STEP) {
      const x = this.x + s.x * o;
      const y = this.y + s.y * o;
      if (!this.canStand(x, y)) return Infinity;
      if (this.canStand(x + p.x * PATH_STEP, y + p.y * PATH_STEP) && this.canStand(x + p.x * DETOUR_LOOK, y + p.y * DETOUR_LOOK)) return o;
    }
    return Infinity;
  }

  /**
   * Whether a step of `len` px along unit vector `n` from (x0, y0) advanced along
   * the main way to the target. An axis-aligned step always counts; a diagonal
   * one that merely slid sideways along a wall blocking that way does not.
   */
  private madeHeadway(n: Vec, x0: number, y0: number, len: number): boolean {
    if (n.x === 0 || n.y === 0) return true;
    const p = DIR_VEC[vecToDir(n.x, n.y)];
    const want = len * Math.abs(n.x * p.x + n.y * p.y);
    return (this.x - x0) * p.x + (this.y - y0) * p.y >= want * 0.25;
  }

  /**
   * One tick of a detour: sidestep until the blocked way opens, then commit
   * through it. Ends (false) once the target no longer lies beyond the obstacle,
   * the sidestep is blocked too (a wall's end or a corner), or it times out.
   */
  private followDetour(target: Vec, step: number, dt: number): boolean {
    const det = this.detour!;
    const p = DIR_VEC[det.primary];
    if ((target.x - this.x) * p.x + (target.y - this.y) * p.y <= 0) {
      this.detour = null;
      return false;
    }
    if (det.commit <= 0 && this.canWalkTo(this.x + p.x * DETOUR_LOOK, this.y + p.y * DETOUR_LOOK)) det.commit = DETOUR_COMMIT;
    const committing = det.commit > 0;
    const dir = committing ? det.primary : det.side;
    const v = DIR_VEC[dir];
    const moved = this.stepBy(v.x * step, v.y * step);
    if (committing) det.commit -= moved;
    det.t -= dt;
    if (moved > 0) this.facing = dir;
    if (moved <= 0 || det.t <= 0 || (committing && det.commit <= 0)) this.detour = null;
    return moved > 0;
  }
}

/** A chase() detour in progress: sidestep toward `side` until `primary` opens, then `commit` px along it. */
interface Detour {
  side: Dir;
  primary: Dir;
  /** Time left (s) before it gives up. */
  t: number;
  /** Distance still to push through the opening (px); 0 while sidestepping. */
  commit: number;
}

// ----------------------------------------------------------------------------
// Enemy projectile
// ----------------------------------------------------------------------------

/** Launch parameters for an EnemyProjectile. */
export interface EnemyShot {
  sprite: ProjectileSprite;
  /** Start position (room px). */
  x: number;
  y: number;
  /** Velocity (px/s). */
  vx: number;
  vy: number;
  /** Half-hearts dealt to the hero (default 1). */
  damage?: number;
  /** The hero's shield can block it from the front (default true). */
  blockable?: boolean;
  /** Square hitbox edge (px, default 6). */
  size?: number;
  /** Drawn height above its ground shadow (px, default 4). */
  height?: number;
  /** Seconds before it vanishes on its own (default 4). */
  life?: number;
  /** Damage kind reported to the hero (default 'fire' for fireballs, else 'projectile'). 'fire' shots ignite what they burst on. */
  kind?: DamageKind;
  /** Who fired it. */
  source?: Entity | null;
}

/**
 * A straight-flying enemy shot (rock, arrow, spear, bone, beam, fireball). Flies
 * over pits and water (mover 'projectile'), bursts on solid tiles, solid entities
 * and the room edge, hurts the hero via hurtPlayer: 'hit' -> gone, 'blocked' (the
 * shield) -> bounces off and falls away harmlessly, 'ignored' -> keeps flying.
 * Fire shots (fireballs) ignite() the solid entity they burst on (torches light).
 * Its own shooter never stops it (a solid statue fires from inside its body).
 * Weapons can't destroy it (hurt() is ignored).
 */
export class EnemyProjectile extends Entity {
  readonly damage: number;
  readonly kind: DamageKind;
  readonly source: Entity | null;
  private life: number;
  private deflected = false;

  constructor(game: GameServices, shot: EnemyShot) {
    super(game, null, shot.sprite);
    this.sprite = shot.sprite;
    this.anim = projectileAnim(shot.sprite, shot.vx, shot.vy);
    this.x = shot.x;
    this.y = shot.y;
    this.vx = shot.vx;
    this.vy = shot.vy;
    this.w = shot.size ?? 6;
    this.h = this.w;
    this.z = shot.height ?? 4;
    this.mover = 'projectile';
    this.blockable = shot.blockable ?? true;
    this.damage = shot.damage ?? 1;
    this.kind = shot.kind ?? (shot.sprite === 'proj.fireball' ? 'fire' : 'projectile');
    this.source = shot.source ?? null;
    this.life = shot.life ?? 4;
  }

  /** True once the hero's shield knocked it away (harmless, falling); lets callers tell a block from a hit. */
  get isDeflected(): boolean {
    return this.deflected;
  }

  override update(dt: number): void {
    this.life -= dt;
    if (this.deflected) {
      this.fallAway(dt);
      return;
    }
    if (this.life <= 0) {
      this.dead = true;
      return;
    }
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (this.isBlockedAt(nx, ny)) {
      if (this.kind === 'fire') this.solidAt(nx, ny)?.ignite?.();
      this.burst();
      return;
    }
    this.x = nx;
    this.y = ny;
    this.checkHero();
  }

  override isBlockedAt(x: number, y: number): boolean {
    return this.game.room.blocked(this.rectAt(x, y), this.mover) || this.solidAt(x, y) !== null;
  }

  /** The solid entity the shot would overlap at (x, y), other than itself and its shooter. */
  private solidAt(x: number, y: number): Entity | null {
    const r = this.rectAt(x, y);
    return this.game.entities.find((e) => e.solid && !e.dead && e !== this && e !== this.source && rectsOverlap(e.hitbox(), r))
      ?? null;
  }

  override hurt(_hit: Hit): boolean {
    return false;
  }

  private checkHero(): void {
    const p = this.game.player;
    if (!p.visible || p.z >= HIT_MAX_Z || !this.overlaps(p)) return;
    const n = normalize(this.vx, this.vy);
    const res = p.hurtPlayer({ damage: this.damage, kind: this.kind, source: this, dx: n.x, dy: n.y });
    if (res === 'hit') this.dead = true;
    else if (res === 'blocked') this.deflect();
  }

  /** Deflected flight: drift along the bounce arc; gone on landing, on timeout or at a wall / the room edge. */
  private fallAway(dt: number): void {
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (this.z <= 0 || this.life <= 0 || this.isBlockedAt(nx, ny)) {
      this.dead = true;
      return;
    }
    this.x = nx;
    this.y = ny;
  }

  /** Bounce back off the shield in a short arc, flickering, then vanish on landing. */
  private deflect(): void {
    this.deflected = true;
    this.vx = -this.vx * 0.35 + rng.range(-24, 24);
    this.vy = -this.vy * 0.35 + rng.range(-24, 24);
    this.vz = 70;
    this.gravity = 320;
    this.life = 1;
    this.invuln = 1;
  }

  private burst(): void {
    this.dead = true;
    this.game.effect('fx.hit', 'play', this.x, this.y - this.z);
  }
}
