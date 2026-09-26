// obj.torch — brazier. ignite() (lantern flame, fireball) lights it: sfx lantern,
// emits torchLit, light radius 48 in dark rooms. A torch lit that way goes out
// again after burnTime seconds when burnTime > 0; torches placed lit burn for
// ever. Solid and hookable. OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { registerEntity } from '../../registry';
import { ObjectEntity, numProp } from './base';

/** Light radius (px) of a lit torch. */
export const TORCH_LIGHT = 48;

export class Torch extends ObjectEntity {
  readonly burnTime: number;
  /** Seconds until it goes out (0 = burns for ever). */
  private burnLeft = 0;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.burnTime = Math.max(0, numProp(this, 'burnTime', 0));
    this.sprite = 'obj.torch';
    this.solid = true;
    this.hookable = true;
    this.setLit(this.prop<boolean>('lit', false) === true);
  }

  get lit(): boolean {
    return this.light > 0;
  }

  /** Light it; false if it was already burning (a timed flame's timer restarts, an endless one stays endless). */
  override ignite(): boolean {
    if (this.lit) {
      if (this.burnLeft > 0) this.burnLeft = this.burnTime;
      return false;
    }
    this.burnLeft = this.burnTime;
    this.setLit(true);
    this.game.audio.sfx('lantern');
    this.game.emit({ type: 'torchLit', id: this.id });
    return true;
  }

  override update(dt: number): void {
    if (this.burnLeft <= 0) return;
    this.burnLeft = Math.max(0, this.burnLeft - dt);
    if (this.burnLeft === 0) this.setLit(false);
  }

  private setLit(lit: boolean): void {
    this.light = lit ? TORCH_LIGHT : 0;
    this.play(lit ? 'lit' : 'unlit');
  }
}

registerEntity('obj.torch', (game, inst) => new Torch(game, inst));
