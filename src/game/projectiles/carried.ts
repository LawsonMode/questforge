// Objects the hero lifts, carries overhead, throws or drops: lifted pots, bushes
// and rocks (thrown.ts) and bombs (bomb.ts). Shared behaviour: follow the
// carrier's head while held (drawn by the carrier then, so it stays with the
// carrier through culling, depth order and room scrolls), fly a throw arc
// (~4 tiles) or drop straight down, vanish once thrown past the room's edge, and
// report impacts / landings to the subclass.
import type { Dir } from '../../core/types';
import type { Hit, Renderer } from '../api';
import { DIR_VEC, clamp, lerp, type Vec } from '../../core/math';
import type { Entity } from '../entity';
import { PlayerProjectile } from './projectile';
import { hitFrom, strike, strikeRole, touching } from './targets';

/** Height (px) of a carried object's centre above the carrier's footprint centre. */
export const HOLD_Z = 20;
/** Throw: horizontal speed (px/s), distance to the landing spot (px) and initial upward speed (px/s). */
export const THROW_SPEED = 160;
export const THROW_DIST = 64;
export const THROW_VZ = 20;
/** Gravity (px/s^2) of an object dropped straight down (carrier got hurt). */
export const DROP_GRAVITY = 480;

export type CarryMode = 'ground' | 'held' | 'flying';

export interface CarryPose {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a carried object is `lift` (0..1) of the way from its pick-up spot to
 * overhead: it slides onto the carrier while rising on a quarter-sine to HOLD_Z.
 */
export function carryPose(from: Vec, carrier: { x: number; y: number; z: number }, lift: number): CarryPose {
  const p = clamp(lift, 0, 1);
  return {
    x: lerp(from.x, carrier.x, p),
    y: lerp(from.y, carrier.y, p),
    z: carrier.z + HOLD_Z * Math.sin((p * Math.PI) / 2),
  };
}

/** Gravity that lands a throw starting at height z0 (upward speed vz0) `dist` px away at `speed` px/s. */
export function throwGravity(z0: number, vz0: number, dist: number, speed: number): number {
  const t = dist / speed;
  return (2 * (z0 + vz0 * t)) / (t * t);
}

/** Height (px) of a throw `t` seconds after launch from z0 with upward speed vz0 under `gravity`. */
export function throwHeight(z0: number, vz0: number, gravity: number, t: number): number {
  return z0 + vz0 * t - (gravity * t * t) / 2;
}

export abstract class Carried extends PlayerProjectile {
  protected mode: CarryMode = 'ground';
  private carrier: Entity | null = null;
  private lift = 0;
  private from: Vec = { x: 0, y: 0 };

  get isHeld(): boolean {
    return this.mode === 'held';
  }

  get isFlying(): boolean {
    return this.mode === 'flying';
  }

  /** Held by `carrier`, `lift` (0..1) of the way up from where it was picked up. */
  carry(carrier: Entity, lift: number): void {
    if (this.mode !== 'held') {
      this.from = { x: this.x, y: this.y };
      this.mode = 'held';
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.gravity = 0;
    }
    this.carrier = carrier;
    this.lift = lift;
    this.follow();
  }

  /** Thrown in `dir` from the carrier's head. */
  launch(dir: Dir): void {
    this.follow();
    const v = DIR_VEC[dir];
    this.fly(v.x * THROW_SPEED, v.y * THROW_SPEED, THROW_VZ, throwGravity(this.z, THROW_VZ, THROW_DIST, THROW_SPEED));
    this.game.audio.sfx('throw');
  }

  /** Let go in place: drops straight down from where it is. */
  release(): void {
    this.follow();
    this.fly(0, 0, 0, DROP_GRAVITY);
  }

  override update(dt: number): void {
    if (this.mode === 'held') this.follow();
    else if (this.mode === 'flying') this.flyStep(dt);
  }

  override onLand(): void {
    if (this.mode !== 'flying') return;
    this.mode = 'ground';
    this.vx = 0;
    this.vy = 0;
    this.gravity = 0;
    this.onGround();
  }

  /** A held object moves to the next room with its carrier; anything else ends with the room. */
  override onRemove(): void {
    if (this.mode !== 'held') this.dead = true;
  }

  /** The blow dealt to what it flies into (null = it only bumps into enemies and solid things). */
  protected abstract blow(): Omit<Hit, 'dx' | 'dy'> | null;
  /** Hit a wall (null) or an entity (already struck with blow()) while flying. */
  protected abstract onImpact(target: Entity | null): void;
  /** Came to rest on the ground after a throw or drop. */
  protected abstract onGround(): void;
  /** Draw the object with its centre at world (x, y) (already raised by z). */
  protected abstract drawBody(r: Renderer, x: number, y: number): void;

  /** Stop moving sideways and fall from here (bounced off something). */
  protected dropHere(): void {
    this.vx = 0;
    this.vy = 0;
  }

  /** Lost down a pit or in deep water under it (a splash in water). True if it sank (and is gone). */
  protected sinks(): boolean {
    const ground = this.game.room.collisionAt(this.x, this.y);
    if (ground !== 'pit' && ground !== 'deep') return false;
    this.dead = true;
    if (ground === 'deep') {
      this.game.effect('fx.splash', 'play', this.x, this.y);
      this.game.audio.sfx('splash');
    }
    return true;
  }

  /** On the ground or in flight; while held its carrier draws it (drawHeld). */
  override draw(r: Renderer): void {
    if (this.visible && this.mode !== 'held') this.drawAt(r, this);
  }

  /**
   * Drawn by the carrier around its own sprite: call with behind=true before
   * drawing the carrier and behind=false after; the object draws in the pass
   * matching where it is (behind while lifted from above the carrier).
   */
  drawHeld(r: Renderer, behind: boolean): void {
    if (!this.visible || this.dead || this.mode !== 'held' || !this.carrier) return;
    const p = carryPose(this.from, this.carrier, this.lift);
    if ((p.y < this.carrier.y) === behind) this.drawAt(r, p);
  }

  private drawAt(r: Renderer, p: CarryPose): void {
    if (this.mode === 'flying' && p.z > 0) r.drawShadow(p.x, p.y + this.h / 2 - 1, 10);
    this.drawBody(r, Math.round(p.x), Math.round(p.y - p.z));
  }

  private fly(vx: number, vy: number, vz: number, gravity: number): void {
    this.mode = 'flying';
    this.carrier = null;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.gravity = gravity;
  }

  private follow(): void {
    if (!this.carrier) return;
    const p = carryPose(this.from, this.carrier, this.lift);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
  }

  private flyStep(dt: number): void {
    // Released at ground level: gravity never kicks in (tickCommon only pulls airborne things).
    if (this.z <= 0 && this.vz <= 0) {
      this.onLand();
      return;
    }
    if (this.vx === 0 && this.vy === 0) return;
    const hit = this.move(this.vx * dt, this.vy * dt);
    if (hit.hitX || hit.hitY) {
      this.onImpact(null);
      return;
    }
    if (this.roomExit() === 'all') {
      this.dead = true;
      return;
    }
    const blow = this.blow();
    for (const e of touching(this.game, this.hitbox(), this.x, this.y, this)) {
      const role = strikeRole(e);
      if (role === 'ignore' || role === 'collect') continue;
      if (blow) {
        if (strike(e, hitFrom(e, this.x, this.y, blow, { x: this.vx, y: this.vy })) === 'pass') continue;
      } else if (role === 'reactive' && !e.solid) {
        continue;
      }
      this.onImpact(e);
      return;
    }
  }
}
