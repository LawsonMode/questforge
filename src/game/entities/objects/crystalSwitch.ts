// obj.crystalSwitch — struck by any damaging hero attack (sword, spin, arrow,
// boomerang, thrown object, bomb, hookshot) it flips the world's colour pegs
// (game.togglePegs), sfx switch, emits switch { on: pegState() }; 0.4 s cooldown.
// Red while pegState() is false (red pegs raised), blue while true. Solid.
// OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { DamageKind, GameServices, Hit, Renderer } from '../../api';
import { registerEntity } from '../../registry';
import { ObjectEntity } from './base';

/** Seconds after a toggle during which further hits are absorbed without effect. */
export const CRYSTAL_COOLDOWN = 0.4;

const TOGGLING: ReadonlySet<DamageKind> = new Set(['sword', 'spin', 'arrow', 'boomerang', 'thrown', 'bomb', 'hookshot']);

/** Whether a hit of this kind flips a crystal switch. */
export function togglesCrystal(kind: DamageKind): boolean {
  return TOGGLING.has(kind);
}

export class CrystalSwitch extends ObjectEntity {
  private cooldown = 0;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.sprite = 'obj.crystalSwitch';
    this.solid = true;
    this.anim = this.colorAnim();
  }

  /** Absorbs every toggling hit (projectiles stop on it); flips the pegs when off cooldown. */
  override hurt(hit: Hit): boolean {
    if (!togglesCrystal(hit.kind)) return false;
    if (this.cooldown > 0) return true;
    this.cooldown = CRYSTAL_COOLDOWN;
    this.game.togglePegs();
    this.game.audio.sfx('switch');
    this.hitFlash = 0.12;
    this.game.emit({ type: 'switch', id: this.id, on: this.game.pegState() });
    return true;
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  override draw(r: Renderer): void {
    this.anim = this.colorAnim();
    super.draw(r);
  }

  private colorAnim(): string {
    return this.game.pegState() ? 'blue' : 'red';
  }
}

registerEntity('obj.crystalSwitch', (game, inst) => new CrystalSwitch(game, inst));
