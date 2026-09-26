// The hero's arrow: flies straight at ARROW_SPEED, hurts the first enemy it
// meets (or strikes crystal switches and other reactive objects), sticks
// quivering in walls and solid objects for a moment before vanishing, and flies
// silently off the screen past the room's edge.
import type { Dir } from '../../core/types';
import type { GameServices, Hit, Renderer } from '../api';
import { DIR_VEC } from '../../core/math';
import { PlayerProjectile } from './projectile';
import { strike, touching } from './targets';

/** Flight speed (px/s). */
export const ARROW_SPEED = 240;
/** Damage to enemies. */
export const ARROW_DAMAGE = 2;
/** Seconds an arrow stays stuck in a wall. */
export const ARROW_STUCK_TIME = 0.35;
/** Drawn this high above its ground position (hand height). */
const ARROW_Z = 4;
/** How far (px) the head sinks into what it sticks in. */
const SINK = 3;

export class Arrow extends PlayerProjectile {
  private stuckT = -1;
  private readonly hit: Hit;

  constructor(game: GameServices, x: number, y: number, dir: Dir) {
    super(game, 'arrow', x, y);
    this.facing = dir;
    this.sprite = 'proj.arrow';
    this.anim = dir;
    const v = DIR_VEC[dir];
    this.vx = v.x * ARROW_SPEED;
    this.vy = v.y * ARROW_SPEED;
    this.w = v.x !== 0 ? 10 : 4;
    this.h = v.x !== 0 ? 4 : 10;
    this.z = ARROW_Z;
    this.hit = { damage: ARROW_DAMAGE, kind: 'arrow', source: this, dx: v.x, dy: v.y, knockback: 8 };
  }

  /** True while stuck in a wall. */
  get stuck(): boolean {
    return this.stuckT >= 0;
  }

  override update(dt: number): void {
    if (this.stuck) {
      this.stuckT += dt;
      if (this.stuckT >= ARROW_STUCK_TIME) this.dead = true;
      return;
    }
    const moved = this.move(this.vx * dt, this.vy * dt);
    if (this.hitEntity()) return;
    if (moved.hitX || moved.hitY) this.stick();
    else if (this.roomExit() === 'all') this.dead = true;
  }

  override draw(r: Renderer): void {
    const v = DIR_VEC[this.facing];
    const sink = this.stuck ? SINK : 0;
    const wobble = this.stuck && Math.floor(this.stuckT * 30) % 2 === 0 ? 1 : 0;
    const x = Math.round(this.x + v.x * sink + (v.y !== 0 ? wobble : 0));
    const y = Math.round(this.y - this.z + v.y * sink + (v.x !== 0 ? wobble : 0));
    r.drawSpriteAnim(this.sprite, this.anim, 0, x, y);
  }

  /** Strike the nearest thing in the way; true if the arrow is spent. */
  private hitEntity(): boolean {
    const v = DIR_VEC[this.facing];
    for (const e of touching(this.game, this.hitbox(), this.x - v.x * this.w, this.y - v.y * this.h, this)) {
      const res = strike(e, this.hit);
      if (res === 'pass') continue;
      if (res === 'solid') this.stick();
      else this.burst(res === 'deflected');
      return true;
    }
    return false;
  }

  private stick(): void {
    this.stuckT = 0;
    this.vx = 0;
    this.vy = 0;
    this.game.audio.sfx('arrowHit');
  }

  private burst(clink: boolean): void {
    this.dead = true;
    if (!clink) return;
    this.game.effect('fx.hit', 'play', this.x, this.y - this.z);
    this.game.audio.sfx('arrowHit');
  }
}
