// obj.peg — colour peg. Raised (solid, hookable, sorted with sprites) while its
// colour is active: red pegs when game.pegState() is false, blue when true;
// otherwise lowered (walkable, ground layer). Follows the state every tick, so a
// crystal switch hit anywhere in the room flips it at once. A peg due to rise
// under an enemy, NPC or block waits until it has moved off, so nothing is ever
// trapped inside one. Pegs do rise under the hero, ALttP-style: while the hero
// stands on a raised peg he walks across the tops of raised pegs until he is off
// all of them (Player.isBlockedAt), however thick the field; a peg he stands on
// is drawn on the ground layer so he shows on top of it. OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import type { Entity } from '../../entity';
import { registerEntity } from '../../registry';
import { ObjectEntity, overlapsBox } from './base';

export type PegColor = 'red' | 'blue';

/** Whether a peg of this colour stands raised for the given peg state. */
export function pegRaised(color: PegColor, pegState: boolean): boolean {
  return (color === 'red') === !pegState;
}

/** Whether a rising peg would trap `e`: something that walks, flies or is solid (not the hero, who walks off the tops; not other pegs). */
function trappable(e: Entity, hero: Entity): boolean {
  if (e.dead || e === hero || e instanceof Peg) return false;
  return e.solid || e.mover === 'walker' || e.mover === 'flyer';
}

export class Peg extends ObjectEntity {
  readonly color: PegColor;
  private readonly upAnim: string;
  private readonly downAnim: string;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.color = this.prop<string>('color', 'red') === 'blue' ? 'blue' : 'red';
    this.upAnim = `${this.color}_up`;
    this.downAnim = `${this.color}_down`;
    this.sprite = 'obj.peg';
    this.sync();
  }

  get raised(): boolean {
    return this.solid;
  }

  override update(_dt: number): void {
    this.sync();
  }

  private sync(): void {
    const due = pegRaised(this.color, this.game.pegState());
    const up = due && (this.solid || !this.occupied());
    this.solid = up;
    this.hookable = up;
    this.drawLayer = up && !this.underHero() ? 'normal' : 'ground';
    this.play(up ? this.upAnim : this.downAnim);
  }

  /** The hero stands on this peg (overlaps it on the ground). */
  private underHero(): boolean {
    const hero = this.game.player as Entity | undefined;
    return hero !== undefined && hero.z <= 0 && overlapsBox(hero, this.left, this.top, this.w, this.h);
  }

  /** Something that a raised peg would trap stands on it. */
  private occupied(): boolean {
    const hero = this.game.player;
    for (const e of this.game.entities) {
      if (overlapsBox(e, this.left, this.top, this.w, this.h) && trappable(e, hero)) return true;
    }
    return false;
  }
}

registerEntity('obj.peg', (game, inst) => new Peg(game, inst));
