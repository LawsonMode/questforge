// obj.shopItem — an item for sale: its icon with the price above it (white,
// drop shadow). Action button: enough gems -> pay, get the item (fanfare unless
// it is a quiet refill); otherwise "You don't have enough Gems.". A purchase
// that would give nothing (ammo at its cap, a heart at full health, gear already
// owned) is refused without charging. Restockable (no sold-out state). Solid,
// so it sits like goods on a counter: its companion tag is an invisible solid
// strip along the item's front (south) edge that keeps a hero walking up from
// below far enough back that his head clears the icon, and buying works facing
// the item or its strip. The tag draws the price on the 'above' layer.
// OWNER: objects agent.
import type { EntityInstance, ItemId } from '../../../core/types';
import type { GameServices, Renderer } from '../../api';
import { MAX_RUPEES } from '../../../core/constants';
import { ITEM_INFO } from '../../../content/ids';
import { registerEntity } from '../../registry';
import { Companion, ObjectEntity, heroFaces, isItemId, itemIcon, numProp, wantsFanfare } from './base';

export const NOT_ENOUGH_RUPEES = `You don't have enough ${ITEM_INFO.rupees.name}.`;
export const CANT_CARRY_MORE = "You can't carry any more.";
export const ALREADY_FULL_HEALTH = 'Your life meter is already full.';
/** Refusal for gear the hero already owns (worded like the engine's own item-get line). */
export function alreadyOwned(item: ItemId): string {
  return `You already have the ${ITEM_INFO[item].name}.`;
}

/** Price text top edge relative to the icon's centre (px): just above the 16 px icon. */
const PRICE_DY = -17;
/**
 * The counter strip in front of the item: its size and the offset of its centre
 * below the item's (px). A hero stopped against it stands 26 px below the item,
 * so his sprite (18 px above his footprint centre) ends at the icon's bottom edge.
 */
const COUNTER = { w: 16, h: 12, dy: 14 } as const;
/** Buying reach in front of the hero (px); a little wider than the hero. */
const REACH = 8;
const INSET = -2;

/** Gear kept as a single owned level. */
const GEAR: ReadonlySet<ItemId> = new Set(['shield', 'bow', 'hookshot', 'lantern', 'boots', 'flippers']);
const LEVELLED: ReadonlySet<ItemId> = new Set(['sword', 'glove', 'boomerang']);
const DUNGEON_ONCE: ReadonlySet<ItemId> = new Set(['bigKey', 'map', 'compass']);

/** Ammo / money counters: [current, cap] from the save. */
function counter(game: Pick<GameServices, 'save'>, item: ItemId): [number, number] | null {
  const s = game.save;
  switch (item) {
    case 'bombs': return [s.bombs, s.maxBombs];
    case 'arrows': return [s.arrows, s.maxArrows];
    case 'magic': return [s.magic, s.maxMagic];
    case 'rupees': return [s.rupees, MAX_RUPEES];
    default: return null;
  }
}

/**
 * Why buying `amount` of `item` would give the hero nothing (the message to show),
 * or null when it is worth paying for. Mirrors the item rules of game/state.ts.
 */
export function purchaseRefusal(game: Pick<GameServices, 'save' | 'hasItem'>, item: ItemId, amount: number): string | null {
  const count = counter(game, item);
  if (count) return amount <= 0 || count[0] >= count[1] ? CANT_CARRY_MORE : null;
  if (item === 'heart' || item === 'fairy') return game.save.hp >= game.save.maxHp ? ALREADY_FULL_HEALTH : null;
  if (GEAR.has(item) || DUNGEON_ONCE.has(item)) return game.hasItem(item) ? alreadyOwned(item) : null;
  if (LEVELLED.has(item)) {
    const level = game.save.items[item] ?? 0;
    const target = amount >= 1 ? Math.floor(amount) : level + 1;
    return Math.min(ITEM_INFO[item].maxLevel, Math.max(level, target)) === level ? alreadyOwned(item) : null;
  }
  return null;
}

export class ShopItem extends ObjectEntity {
  readonly item: ItemId | null;
  readonly amount: number;
  readonly price: number;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    const item = this.prop<string>('item', 'bombs');
    this.item = isItemId(item) ? item : null;
    this.amount = numProp(this, 'amount', 5);
    this.price = Math.max(0, Math.floor(numProp(this, 'price', 30)));
    this.sprite = 'item';
    this.anim = this.item ? itemIcon(this.item, this.amount) : 'rupees';
    this.solid = true;
    game.spawn(new PriceTag(this));
  }

  override onInteract(): boolean {
    if (!this.item || !heroFaces(this.game, this, { reach: REACH, inset: INSET })) return false;
    return this.buy();
  }

  /** Pay and hand the item over, or say why not. Always handled (true) for a real item. */
  buy(): boolean {
    if (!this.item) return false;
    const game = this.game;
    const refusal = purchaseRefusal(game, this.item, this.amount);
    if (refusal || !game.takeItem('rupees', this.price)) {
      game.audio.sfx('error');
      void game.dialogue(refusal ?? NOT_ENOUGH_RUPEES);
      return true;
    }
    game.giveItem(this.item, this.amount, { fanfare: wantsFanfare(this.item) });
    return true;
  }
}

/**
 * The counter in front of a shop item: an invisible solid strip below it (see
 * COUNTER) that also sells the item when faced, and the price drawn above the
 * icon on the 'above' layer. Goes when its item goes.
 */
export class PriceTag extends Companion<ShopItem> {
  constructor(shop: ShopItem) {
    super(shop, 'shop.price');
    this.drawLayer = 'above';
    this.w = COUNTER.w;
    this.h = COUNTER.h;
    this.solid = true;
    this.follow();
  }

  override onInteract(): boolean {
    if (!heroFaces(this.game, this, { reach: REACH, inset: INSET })) return false;
    return this.owner.buy();
  }

  override update(dt: number): void {
    super.update(dt);
    this.follow();
  }

  override draw(r: Renderer): void {
    const shop = this.owner;
    if (shop.dead || !shop.visible) return;
    r.drawText(String(shop.price), Math.round(shop.x), Math.round(shop.y) + PRICE_DY, { align: 'center', screen: false, color: '#ffffff' });
  }

  private follow(): void {
    this.x = this.owner.x;
    this.y = this.owner.y + COUNTER.dy;
  }
}

registerEntity('obj.shopItem', (game, inst) => new ShopItem(game, inst));
