// The lantern's flame: burns a moment in front of the hero, lighting what it
// touches (ignite: torches) and scorching enemies ('fire' hits), each once.
import type { GameServices, Hit } from '../api';
import { PlayerProjectile } from './projectile';
import { strike, strikeRole, touching } from './targets';

/** Seconds the flame burns. */
export const FLAME_LIFE = 0.6;
/** Damage to enemies. */
export const FLAME_DAMAGE = 1;
/** Light radius (px) in dark rooms while burning. */
const FLAME_LIGHT = 32;

export class Flame extends PlayerProjectile {
  private life = FLAME_LIFE;
  private readonly touched = new Set<number>();

  constructor(game: GameServices, x: number, y: number) {
    super(game, 'flame', x, y);
    this.w = 12;
    this.h = 12;
    this.sprite = 'fx.flame';
    this.anim = 'play';
    this.light = FLAME_LIGHT;
  }

  override update(dt: number): void {
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
      return;
    }
    for (const e of touching(this.game, this.hitbox(), this.x, this.y, this)) {
      if (this.touched.has(e.uid)) continue;
      this.touched.add(e.uid);
      e.ignite?.();
      if (strikeRole(e) === 'enemy') strike(e, this.scorch(e.x, e.y));
    }
  }

  private scorch(x: number, y: number): Hit {
    const dx = x - this.x;
    const dy = y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    return { damage: FLAME_DAMAGE, kind: 'fire', source: this, dx: dx / d, dy: dy / d };
  }
}
