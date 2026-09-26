// Entity icons for the palette / inspector / lists: the first frame of the
// catalog icon anim (or a per-instance look), trimmed to its ink and scaled to
// fit a square canvas with crisp pixels.
import type { EntityInstance, ItemId, PropValue } from '../../core/types';
import type { AssetCache } from '../../gfx/imageCache';
import { entityInfo, propOf } from '../../core/catalog';
import { ITEM_INFO, VARIANT_PALETTES, spriteSpec } from '../../content/ids';
import { pixelCanvas } from '../ui/dom';

export interface IconRef {
  sprite: string;
  anim: string;
  palette?: string;
}

const DOOR_ANIM: Readonly<Record<string, string>> = { locked: 'locked', bigKey: 'bigKey', shutter: 'shutter', bombable: 'cracked', open: 'open' };
/** Pickup-sprite anims for items whose name differs from the anim. */
const PICKUP_ANIM: Readonly<Partial<Record<ItemId, string>>> = { rupees: 'rupee_green', magic: 'magic_small' };
/** Anims the default pickup sheet provides (other items show their inventory icon). */
const PICKUP_ANIMS: ReadonlySet<string> = new Set(Object.keys(spriteSpec('pickup')?.anims ?? {}));

/** Ground look of an item: its pickup anim if the sheet has one, else the item icon. */
function pickupIcon(item: ItemId): IconRef {
  const anim = PICKUP_ANIM[item] ?? item;
  return PICKUP_ANIMS.has(anim) ? { sprite: 'pickup', anim } : { sprite: 'item', anim: ITEM_INFO[item]?.icon ?? 'rupees' };
}

/** Catalog icon of a type ('editor.icons'/'unknown' for unknown types). */
export function typeIcon(type: string): IconRef {
  return entityInfo(type)?.icon ?? { sprite: 'editor.icons', anim: 'unknown' };
}

const str = (inst: EntityInstance, key: string, fallback: string): string => String(propOf<PropValue>(inst, key, fallback));

/** Icon reflecting an instance's props (NPC look, variant palette, door kind, item...). */
export function instanceIcon(inst: EntityInstance): IconRef {
  const base = typeIcon(inst.type);
  switch (inst.type) {
    case 'npc.person':
      return { sprite: str(inst, 'sprite', 'npc.villager'), anim: `idle_${str(inst, 'facing', 'down')}` };
    case 'obj.chest':
      return propOf(inst, 'big', false) ? { sprite: 'obj.bigChest', anim: 'closed' } : base;
    case 'obj.door': {
      const dir = str(inst, 'dir', 'up');
      const sprite = dir === 'left' || dir === 'right' ? 'obj.doorEW' : 'obj.doorNS';
      return { sprite, anim: `${DOOR_ANIM[str(inst, 'kind', 'locked')] ?? 'locked'}_${dir}` };
    }
    case 'obj.peg':
      return { sprite: 'obj.peg', anim: `${str(inst, 'color', 'red')}_up` };
    case 'obj.torch':
      return { sprite: 'obj.torch', anim: propOf(inst, 'lit', false) ? 'lit' : 'unlit' };
    case 'obj.pickup':
      return pickupIcon(str(inst, 'item', 'smallKey') as ItemId);
    case 'obj.shopItem':
      return { sprite: 'item', anim: ITEM_INFO[str(inst, 'item', 'bombs') as ItemId]?.icon ?? 'bombs' };
    case 'enemy.slime':
      return { ...base, anim: str(inst, 'size', 'big') === 'small' ? 'small_idle' : 'idle', palette: variantPalette(inst) };
    default: {
      const facing = inst.props.facing;
      const anim = typeof facing === 'string' && base.anim.endsWith('_down') ? base.anim.replace(/_down$/, `_${facing}`) : base.anim;
      return { ...base, anim, palette: variantPalette(inst) };
    }
  }
}

function variantPalette(inst: EntityInstance): string | undefined {
  const table = VARIANT_PALETTES[typeIcon(inst.type).sprite];
  const v = inst.props.variant;
  return table && typeof v === 'string' ? table[v] ?? undefined : undefined;
}

interface Box { x: number; y: number; w: number; h: number }
const inkCache = new WeakMap<HTMLCanvasElement, Box | null>();

/** Bounding box of the non-transparent pixels of a frame canvas (null = empty). */
function inkBox(c: HTMLCanvasElement): Box | null {
  if (inkCache.has(c)) return inkCache.get(c)!;
  let box: Box | null = null;
  const g = c.getContext('2d');
  if (g) {
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width;
    let y0 = c.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3]! === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  inkCache.set(c, box);
  return box;
}

/** Paint `icon` centred into a square canvas (integer scale when it fits, else shrunk). */
export function drawIcon(canvas: HTMLCanvasElement, assets: AssetCache, icon: IconRef): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const size = canvas.width;
  g.clearRect(0, 0, size, canvas.height);
  const own = assets.anim(icon.sprite, icon.anim);
  const sprite = own ? icon.sprite : 'editor.icons';
  const anim = own ?? assets.anim(sprite, 'unknown');
  const src = anim && anim.frames.length ? assets.sprite(sprite, anim.frames[0]!, own ? icon.palette : undefined) : null;
  const box = src ? inkBox(src) : null;
  if (!src || !box) return;
  const fit = size / Math.max(box.w, box.h);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const dw = Math.round(box.w * scale);
  const dh = Math.round(box.h * scale);
  const dx = Math.floor((size - dw) / 2);
  const dy = Math.floor((canvas.height - dh) / 2);
  g.imageSmoothingEnabled = false;
  if (anim?.flipX) {
    g.save();
    g.translate(dx + dw, dy);
    g.scale(-1, 1);
    g.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, dw, dh);
    g.restore();
  } else {
    g.drawImage(src, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
  }
}

/** New square icon canvas of `size` px showing `icon`. */
export function iconCanvas(assets: AssetCache, icon: IconRef, size: number): HTMLCanvasElement {
  const c = pixelCanvas(size, size, 1, 'qf-ent-icon');
  drawIcon(c, assets, icon);
  return c;
}
