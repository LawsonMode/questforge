// obj.chest — small (16x16) or big (32x16, needs the dungeon big key) treasure
// chest. Opened with the action button while the hero faces UP against its bottom
// edge: 'open' sprite, sfx chest, item get with fanfare, flag chest:<id>. Opened
// chests stay open. Solid and hookable; a chest revealed mid-room (showEntity)
// appears with a sparkle and the secret jingle. OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { registerEntity } from '../../registry';
import { ObjectEntity, announceReveal, heroFaces, isItemId, numProp } from './base';

/** Shown when a big chest is tried without the big key. */
export const BIG_CHEST_LOCKED = "It's locked tight. A Big Key might open it.";
/** How far above the hero's head the chest may be (px) and still be "touched". */
const REACH = 6;

export class Chest extends ObjectEntity {
  readonly big: boolean;
  private opened: boolean;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.big = this.prop<boolean>('big', false) === true;
    this.sprite = this.big ? 'obj.bigChest' : 'obj.chest';
    this.solid = true;
    this.hookable = true;
    this.opened = game.flag(this.flagName);
    this.anim = this.opened ? 'open' : 'closed';
    if (!this.opened && this.midRoom) announceReveal(this);
  }

  /** Save flag recording that this chest was opened. */
  get flagName(): string {
    return `chest:${this.id}`;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  override onInteract(): boolean {
    if (this.opened || !heroFaces(this.game, this, { dir: 'up', reach: REACH })) return false;
    if (this.big && !this.game.hasItem('bigKey')) {
      void this.game.dialogue(BIG_CHEST_LOCKED);
      return true;
    }
    this.open();
    return true;
  }

  private open(): void {
    this.opened = true;
    this.play('open');
    this.game.setFlag(this.flagName, true);
    this.game.audio.sfx('chest');
    this.game.emit({ type: 'chestOpened', id: this.id });
    const item = this.prop<string>('item', 'rupees');
    if (isItemId(item)) this.game.giveItem(item, numProp(this, 'amount', 1), { fanfare: true });
  }
}

registerEntity('obj.chest', (game, inst) => new Chest(game, inst));
