// obj.pot — placed pot entity (tile pots are handled by the player's tile
// lifting). Solid; lifted with no glove (liftWeight 0); breaks into its
// 'contents' loot when thrown. A key pot instead leaves its small key lying
// where it stood (a placed pickup, so the key is found once and never times
// out); once that key is taken the pot holds ordinary loot. Holds floor
// switches down. OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { CarryInfo } from '../../entity';
import type { GameServices } from '../../api';
import { DROP_KINDS, type DropKind } from '../../../content/ids';
import { registerEntity } from '../../registry';
import { ObjectEntity } from './base';
import { Pickup } from './pickup';

/** Id of the key pickup a key pot leaves behind (its pickup:<id> flag makes the key one-time). */
export function potKeyId(potId: string): string {
  return `${potId}-key`;
}

export class Pot extends ObjectEntity {
  readonly contents: DropKind;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    const c = this.prop<string>('contents', 'random');
    const contents = (DROP_KINDS as readonly string[]).includes(c) ? (c as DropKind) : 'random';
    this.contents = contents === 'smallKey' && game.flag(`pickup:${potKeyId(this.id)}`) ? 'random' : contents;
    this.sprite = 'obj.pot';
    this.anim = 'idle';
    this.solid = true;
    this.liftWeight = 0;
  }

  override onLift(): CarryInfo {
    if (this.contents !== 'smallKey') return { sprite: 'obj.pot', anim: 'idle', drop: this.contents };
    this.revealKey();
    return { sprite: 'obj.pot', anim: 'idle', drop: 'none' };
  }

  private revealKey(): void {
    const inst: EntityInstance = {
      id: potKeyId(this.id), type: 'obj.pickup', x: this.x, y: this.y, props: { item: 'smallKey', amount: 1 },
    };
    this.game.spawn(new Pickup(this.game, inst, { inPlace: true }));
    this.game.effect('fx.sparkle', 'play', this.x, this.y - 4, { above: true });
  }
}

registerEntity('obj.pot', (game, inst) => new Pot(game, inst));
