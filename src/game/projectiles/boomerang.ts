// The boomerang: flies up to ~5 tiles (level 2: 7 tiles, faster) in any of 8
// directions, then homes back to the hero through walls. On the way it stuns
// enemies (0 damage; immune bosses refuse the hit), strikes crystal switches,
// and grabs one pickup to deliver it to the hero. A wall sends it back early
// with a clink; reaching the room's edge turns it back silently.
import type { Vec } from '../../core/math';
import type { Entity } from '../entity';
import type { GameServices, Hit } from '../api';
import { normalize } from '../../core/math';
import { PlayerProjectile } from './projectile';
import { strike, strikeRole, touching } from './targets';

/** Range (px) and speed (px/s) per boomerang level. */
export const BOOMERANG_LEVELS: Readonly<Record<1 | 2, { range: number; speed: number }>> = {
  1: { range: 80, speed: 160 },
  2: { range: 112, speed: 224 },
};
/** Seconds enemies stay stunned. */
export const BOOMERANG_STUN = 2;
/** Drawn this high above its ground position. */
const BOOMERANG_Z = 6;
/** Caught when this close (px) to the hero. */
const CATCH_DIST = 6;
const WHOOSH_EVERY = 0.2;

export class Boomerang extends PlayerProjectile {
  private readonly owner: Entity;
  private readonly range: number;
  private readonly speed: number;
  private returning = false;
  private travelled = 0;
  private cargo: Entity | null = null;
  private readonly struck = new Set<number>();
  private readonly hit: Hit;
  private whooshT = 0;

  constructor(game: GameServices, owner: Entity, x: number, y: number, dir: Vec, level: number) {
    super(game, 'boomerang', x, y);
    this.owner = owner;
    const stats = BOOMERANG_LEVELS[level >= 2 ? 2 : 1];
    this.range = stats.range;
    this.speed = stats.speed;
    const v = normalize(dir.x, dir.y);
    this.vx = v.x * this.speed;
    this.vy = v.y * this.speed;
    this.w = 8;
    this.h = 8;
    this.z = BOOMERANG_Z;
    this.sprite = 'proj.boomerang';
    this.anim = 'spin';
    this.palette = level >= 2 ? 'pal.boomerang.2' : undefined;
    this.hit = { damage: 0, kind: 'boomerang', source: this, dx: 0, dy: 0, knockback: 0, stun: BOOMERANG_STUN };
  }

  override update(dt: number): void {
    this.whoosh(dt);
    if (this.returning) this.flyBack(dt);
    else this.flyOut(dt);
    if (this.dead) return;
    this.strikeAround();
    if (this.cargo && !this.cargo.dead) {
      this.cargo.x = this.x;
      this.cargo.y = this.y;
    }
  }

  private whoosh(dt: number): void {
    this.whooshT -= dt;
    if (this.whooshT > 0) return;
    this.whooshT = WHOOSH_EVERY;
    this.game.audio.sfx('boomerang');
  }

  private flyOut(dt: number): void {
    const moved = this.move(this.vx * dt, this.vy * dt);
    this.travelled += this.speed * dt;
    if (moved.hitX || moved.hitY) this.bounce();
    else if (this.travelled >= this.range || this.roomExit() !== 'none') this.returning = true;
  }

  /** Home in on the hero, ignoring walls; caught on arrival. */
  private flyBack(dt: number): void {
    const dx = this.owner.x - this.x;
    const dy = this.owner.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (d <= step + CATCH_DIST) {
      this.caught();
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  private caught(): void {
    this.dead = true;
    if (this.cargo && !this.cargo.dead) this.cargo.collect?.();
  }

  /** Clink off a wall or something solid and head home. */
  private bounce(): void {
    this.returning = true;
    this.game.effect('fx.hit', 'play', this.x, this.y - this.z);
    this.game.audio.sfx('swordTink');
  }

  private strikeAround(): void {
    for (const e of touching(this.game, this.hitbox(), this.x, this.y, this)) {
      if (this.struck.has(e.uid)) continue;
      const role = strikeRole(e);
      if (role === 'ignore') continue;
      this.struck.add(e.uid);
      if (role === 'collect') {
        if (!this.cargo) this.cargo = e;
        this.returning = true;
        continue;
      }
      const res = strike(e, this.hit);
      if (res === 'pass' || this.returning) continue;
      if (res === 'hit') this.returning = true;
      else this.bounce();
    }
  }
}
