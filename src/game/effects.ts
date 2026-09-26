// One-shot visual effects (poofs, splashes, sparkles...): an entity that plays a
// sprite anim once, then removes itself. OWNER: engine agent.
import type { GameServices } from './api';
import { Entity } from './entity';

export interface EffectOptions {
  z?: number;
  palette?: string;
  /** Draw above the 'over' tile layer (default: sorted with normal entities). */
  above?: boolean;
}

export class Effect extends Entity {
  constructor(game: GameServices, sprite: string, anim: string, x: number, y: number, opts: EffectOptions = {}) {
    super(game, null, 'fx');
    this.sprite = sprite;
    this.anim = anim;
    this.x = x;
    this.y = y;
    this.z = opts.z ?? 0;
    this.palette = opts.palette;
    this.drawLayer = opts.above ? 'above' : 'normal';
    this.mover = 'ghost';
    this.shadow = false;
    this.w = 8;
    this.h = 8;
  }

  /** Gone after one pass of the anim (at once for an unknown sprite or anim, whose length is 0). */
  override update(_dt: number): void {
    if (this.animDone()) this.dead = true;
  }
}
