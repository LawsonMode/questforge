// Human-readable labels for editor lists, summaries and warnings (pure: no DOM).
import type { EntityInstance, ItemId, MusicId, Project, PropValue, Room, SfxId, WarpTarget } from '../../core/types';
import { entityInfo, type EntityCategory } from '../../core/catalog';
import { findRoom, findWorld } from '../../core/project';
import { ITEM_INFO } from '../../content/ids';

/** Palette / list headings per catalog category, in display order. */
export const CATEGORY_LABELS: Readonly<Record<EntityCategory, string>> = {
  enemy: 'Enemies',
  boss: 'Bosses',
  npc: 'NPCs',
  object: 'Objects',
  pickup: 'Pickups',
  marker: 'Markers',
};

/** Natural name order for editor lists: "Dialogue 2" before "Dialogue 10", case-insensitive. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Placed instance by id within one room. */
export function findInRoom(room: Room | null | undefined, id: string): EntityInstance | undefined {
  return room?.entities.find((e) => e.id === id);
}

/** Catalog name of a type (the raw type key if unknown). */
export function typeName(type: string): string {
  return entityInfo(type)?.name ?? type;
}

/** "Person “Mira” (e_ab12)": type name, the instance's own name prop if any, then its id. */
export function entityLabel(inst: EntityInstance | undefined, id = inst?.id ?? ''): string {
  if (!inst) return id ? `missing entity (${id})` : 'nothing';
  const own = typeof inst.props.name === 'string' ? inst.props.name.trim() : '';
  const named = own ? `${typeName(inst.type)} “${own}”` : typeName(inst.type);
  return `${named} (${inst.id})`;
}

/** Label of an entity referenced from a room ("missing entity (id)" when gone, "nothing" when unset). */
export function refLabel(room: Room | null | undefined, id: string): string {
  return id ? entityLabel(findInRoom(room, id), id) : 'nothing';
}

export function itemName(item: ItemId | string): string {
  return ITEM_INFO[item as ItemId]?.name ?? item;
}

/** "20 Gems", "Bow" (amount 1 is implied). */
export function itemAmount(item: ItemId, amount: number): string {
  return amount === 1 ? itemName(item) : `${amount} ${itemName(item)}`;
}

/** "Dungeon", "None", "Inherit". */
export function musicLabel(m: MusicId | 'none' | 'inherit' | string): string {
  if (m === 'none') return 'None (silence)';
  if (m === 'inherit') return 'Inherit from world';
  return m.charAt(0).toUpperCase() + m.slice(1).replace(/([A-Z])/g, ' $1');
}

/** Enum options whose internal id does not read well (loot kinds keep their saved ids; the currency shows as Gems). */
const ENUM_LABELS: Readonly<Record<string, string>> = {
  rupee: ITEM_INFO.rupees.name.replace(/s$/, ''),
  rupee5: `5 ${ITEM_INFO.rupees.name}`,
  rupee20: `20 ${ITEM_INFO.rupees.name}`,
};

/** Friendly label for an enum option: "npc.elder" -> "Elder", "bigKey" -> "Big key", "rupee20" -> "20 Gems". */
export function enumLabel(option: string): string {
  const named = Object.prototype.hasOwnProperty.call(ENUM_LABELS, option) ? ENUM_LABELS[option] : undefined;
  if (named) return named;
  const last = option.slice(option.lastIndexOf('.') + 1);
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "swordSpin" -> "sword spin". */
export function sfxLabel(s: SfxId | string): string {
  return s.replace(/([A-Z])/g, ' $1').toLowerCase();
}

/** A prop value as a warp target: null unless it names a world and room at finite coordinates. */
export function asWarpTarget(v: PropValue | undefined): WarpTarget | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const t = v as Partial<WarpTarget>;
  const ok = typeof t.world === 'string' && typeof t.room === 'string' && Number.isFinite(t.x) && Number.isFinite(t.y);
  return ok ? (v as WarpTarget) : null;
}

/** "World › Room (x,y)" for a warp target; "No destination" for null. */
export function warpLabel(p: Project, target: WarpTarget | null | undefined): string {
  if (!target) return 'No destination';
  const world = findWorld(p, target.world);
  const room = world ? findRoom(p, target.world, target.room) : undefined;
  const where = room && world ? `${world.name} › ${room.name}` : 'Missing room';
  return `${where} (${Math.round(target.x)},${Math.round(target.y)})`;
}

/** "Welcome" (dialogue name) or "missing dialogue (id)". */
export function dialogueLabel(p: Project, id: string): string {
  if (!id) return 'no dialogue';
  const d = p.dialogues.find((x) => x.id === id);
  return d ? d.name || d.id : `missing dialogue (${id})`;
}

/** "Grass (#1)". */
export function tileLabel(p: Project, id: number): string {
  if (id === 0) return 'empty (#0)';
  const t = p.tiles.find((x) => x.id === id);
  return t ? `${t.name} (#${id})` : `unknown tile (#${id})`;
}
