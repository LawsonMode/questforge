// How a placed entity looks in the editor: the catalog icon sprite, refined by
// props the designer cares to see (variant palette, facing, NPC look, door kind,
// big chest, pickup item, lit torch...). Always falls back to the catalog icon.
import type { EntityInstance, ItemId, PropValue } from '../../core/types';
import type { AssetCache } from '../../gfx/imageCache';
import { entityInfo, propOf } from '../../core/catalog';
import { ITEM_INFO, VARIANT_PALETTES } from '../../content/ids';

export interface EntityLook {
  sprite: string;
  anim: string;
  /** Frame index into the sprite's frames (first frame of the anim). */
  frame: number;
  palette?: string;
  flipX: boolean;
}

/** Pickup-sprite anim for a ground item, if the pickup sheet has one. */
const PICKUP_ANIMS: Partial<Record<ItemId, string>> = {
  heart: 'heart', smallKey: 'smallKey', bigKey: 'bigKey', bombs: 'bombs', arrows: 'arrows',
  magic: 'magic_small', heartContainer: 'heartContainer', heartPiece: 'heartPiece', fairy: 'fairy', crystal: 'crystal',
};

const str = (inst: EntityInstance, key: string, fallback: string): string => String(propOf<PropValue>(inst, key, fallback));

function itemLook(item: string): [sprite: string, anim: string] {
  const info = ITEM_INFO[item as ItemId];
  return ['item', info ? info.icon : 'rupees'];
}

/** Preferred (sprite, anim) for an instance before validation. */
function preferred(inst: EntityInstance, base: { sprite: string; anim: string }): [string, string] {
  switch (inst.type) {
    case 'npc.person':
      return [str(inst, 'sprite', base.sprite), `idle_${str(inst, 'facing', 'down')}`];
    case 'obj.chest':
      return propOf(inst, 'big', false) ? ['obj.bigChest', 'closed'] : [base.sprite, base.anim];
    case 'obj.door': {
      const dir = str(inst, 'dir', 'up');
      const kind = str(inst, 'kind', 'locked');
      const sprite = dir === 'left' || dir === 'right' ? 'obj.doorEW' : 'obj.doorNS';
      return [sprite, `${kind === 'bombable' ? 'cracked' : kind}_${dir}`];
    }
    case 'obj.pickup': {
      const item = str(inst, 'item', 'smallKey') as ItemId;
      if (item === 'rupees') {
        const n = Number(propOf(inst, 'amount', 1));
        return ['pickup', n >= 20 ? 'rupee_red' : n >= 5 ? 'rupee_blue' : 'rupee_green'];
      }
      const anim = PICKUP_ANIMS[item];
      return anim ? ['pickup', anim] : itemLook(item);
    }
    case 'obj.shopItem':
      return itemLook(str(inst, 'item', 'bombs'));
    case 'obj.torch':
      return [base.sprite, propOf(inst, 'lit', false) ? 'lit' : 'unlit'];
    case 'obj.peg':
      return [base.sprite, `${str(inst, 'color', 'red')}_up`];
    case 'obj.block':
      return [base.sprite, propOf(inst, 'heavy', false) ? 'heavy' : 'idle'];
    default: {
      const facing = inst.props.facing;
      return typeof facing === 'string' ? [base.sprite, `walk_${facing}`] : [base.sprite, base.anim];
    }
  }
}

/** Resolve the editor look of an instance; null if not even the fallback glyph exists. */
export function entityLook(inst: EntityInstance, assets: AssetCache): EntityLook | null {
  const info = entityInfo(inst.type);
  const base = info?.icon ?? { sprite: 'editor.icons', anim: 'unknown' };
  const [sprite, anim] = preferred(inst, base);
  const candidates: [string, string][] = [[sprite, anim], [base.sprite, base.anim], ['editor.icons', 'unknown']];
  for (const [s, a] of candidates) {
    const def = assets.anim(s, a);
    const frame = def?.frames[0];
    if (!def || frame === undefined) continue;
    const variant = inst.props.variant;
    const swap = typeof variant === 'string' ? VARIANT_PALETTES[s]?.[variant] : undefined;
    const palette = swap ?? (s === base.sprite ? info?.icon.palette : undefined);
    return { sprite: s, anim: a, frame, palette, flipX: !!def.flipX };
  }
  return null;
}
