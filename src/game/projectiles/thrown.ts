// A lifted pot / bush / rock / sign: carried overhead, thrown ~4 tiles in an
// arc (or dropped when the hero is hurt). It breaks on whatever it meets — an
// enemy (thrown damage), a wall, or the ground — with a shatter (or leaves)
// effect and its loot, unless it lands in a pit or deep water.
import type { CarryInfo, Entity } from '../entity';
import type { GameServices, Hit, Renderer } from '../api';
import { Carried } from './carried';
import { drawLiftedTile } from './tileSprite';

/** Damage to enemies when the carry info names none. */
const DEFAULT_DAMAGE = 1;

export class ThrownObject extends Carried {
  readonly info: CarryInfo;
  private readonly impact: Omit<Hit, 'dx' | 'dy'>;

  constructor(game: GameServices, info: CarryInfo, x: number, y: number) {
    super(game, 'thrown', x, y);
    this.info = info;
    this.w = 10;
    this.h = 10;
    this.sprite = info.sprite ?? '';
    this.anim = info.anim ?? 'idle';
    this.palette = info.palette;
    this.impact = { damage: info.damage ?? DEFAULT_DAMAGE, kind: 'thrown', source: this };
  }

  protected blow(): Omit<Hit, 'dx' | 'dy'> {
    return this.impact;
  }

  protected onImpact(_target: Entity | null): void {
    this.shatter();
  }

  protected onGround(): void {
    this.shatter();
  }

  protected drawBody(r: Renderer, x: number, y: number): void {
    if (this.info.tile !== undefined) drawLiftedTile(r, this.game.project, this.info.tile, x, y);
    else if (this.sprite) r.drawSpriteAnim(this.sprite, this.anim, this.animT, x, y, { palette: this.palette });
  }

  /** Break apart here: effect, sound and loot (nothing is left over pits or deep water). */
  private shatter(): void {
    if (this.dead || this.sinks()) return;
    this.dead = true;
    const game = this.game;
    game.effect(this.info.shatterFx ?? 'fx.shatter', 'play', this.x, this.y - this.z);
    game.audio.sfx('shatter');
    const drop = this.info.drop ?? 'none';
    if (drop !== 'none') game.dropLoot(this.x, this.y, drop);
  }
}
