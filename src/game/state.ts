// SaveData rules: new game, item acquisition, keys, health. Pure logic (unit-tested).
// OWNER: data agent. Item semantics:
//   sword/glove/boomerang: level = max(current, amount || current+1) capped at ITEM_INFO.maxLevel
//   shield/bow/hookshot/lantern/boots/flippers: items[x] = 1
//   bombs: bombs += amount (default 5), items.bombs = 1; capped at maxBombs
//   arrows: arrows += amount (default 10) capped at maxArrows; rupees += amount capped MAX_RUPEES
//   heart: hp += 2*amount (cap maxHp); fairy: hp += 14; magic: magic += amount (default 16) cap maxMagic
//   heartContainer: maxHp += 2 (cap MAX_HEARTS*2), full heal; heartPiece: +1 piece, every 4 -> container
//   smallKey: dungeon(worldId).keys += amount; bigKey/map/compass: dungeon flag true
//   crystal: flags['crystal:<worldId>'] = true, crystals++, dungeon.complete = true
// Equipping: when a first equippable item is gained and nothing is equipped, equip it.
// Amounts: omitted / invalid / negative -> the default; an explicit 0 gives (or takes) nothing,
// except for level items where it steps up one level (per `amount || current+1` above).
// Unknown item ids (hand-edited projects) are ignored: no state change, empty message.
// Key names in the messages come from the input map (keys.ts). Save maps keyed by
// project text (dungeons by world id) are read as own properties only, so an id
// such as "__proto__" or "constructor" is an ordinary key, never an inherited member.
import type { DungeonState, ItemId, Project, SaveData, World } from '../core/types';
import { EQUIPPABLE_ITEMS, ITEM_IDS } from '../core/types';
import {
  DEFAULT_MAX_ARROWS, DEFAULT_MAX_BOMBS, DEFAULT_MAX_MAGIC, HP_PER_HEART, MAX_HEARTS, MAX_RUPEES, SAVE_VERSION,
} from '../core/constants';
import { clamp } from '../core/math';
import { ITEM_INFO } from '../content/ids';
import { keyWord } from './keys';

/** The hero's name where no player typed one (playtest, previews): matches the Dialogue tab's preview name. */
export const DEFAULT_HERO_NAME = 'Hero';

/** Heart pieces that make one heart container. */
export const PIECES_PER_HEART = 4;
/** Half-hearts restored by a fairy (seven hearts). */
export const FAIRY_HEAL = 14;

const DEFAULT_AMOUNT: Partial<Record<ItemId, number>> = { bombs: 5, arrows: 10, magic: 16 };
/** Items whose level is stored in `items` (weapon/equip/passive kinds). */
const LEVEL_KINDS = new Set(['weapon', 'equip', 'passive']);

/** Flag key recording a dungeon's crystal. */
export function crystalFlag(worldId: string): string {
  return `crystal:${worldId}`;
}

/** Whole amount >= 0, or `fallback` when omitted / not finite / negative (an explicit 0 stays 0). */
function count(amount: number | undefined, fallback: number): number {
  return amount !== undefined && Number.isFinite(amount) && amount >= 0 ? Math.floor(amount) : fallback;
}

/** What a dungeon's crystal is called: its world's prizeName, else "<world name> Crystal". */
export function prizeName(world: Pick<World, 'name' | 'prizeName'>): string {
  return world.prizeName?.trim() || `${world.name} Crystal`;
}

/** Whether `item` is a real ItemId (guards against ids from hand-edited project files). */
export function isKnownItem(item: string): item is ItemId {
  return (ITEM_IDS as readonly string[]).includes(item);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** Start a new game for `project` in `slot`. */
export function newSave(project: Project, slot: number, name: string): SaveData {
  const start = project.settings.startHearts;
  const hearts = Number.isFinite(start) ? clamp(Math.round(start), 1, MAX_HEARTS) : 3;
  const now = Date.now();
  const save: SaveData = {
    version: SAVE_VERSION,
    slot,
    name,
    projectId: project.id,
    hp: hearts * HP_PER_HEART,
    maxHp: hearts * HP_PER_HEART,
    heartPieces: 0,
    magic: DEFAULT_MAX_MAGIC,
    maxMagic: DEFAULT_MAX_MAGIC,
    rupees: 0,
    bombs: 0,
    maxBombs: DEFAULT_MAX_BOMBS,
    arrows: 0,
    maxArrows: DEFAULT_MAX_ARROWS,
    items: {},
    equipped: null,
    dungeons: {},
    flags: {},
    respawn: { ...project.start },
    crystals: 0,
    playTime: 0,
    deaths: 0,
    created: now,
    updated: now,
  };
  for (const [key, raw] of Object.entries(project.settings.startItems)) {
    grantStartItem(save, key as ItemId, Math.floor(Number(raw) || 0));
  }
  save.equipped = ownedEquippables(save)[0] ?? null;
  return save;
}

/** Starting inventory: counters for ammo/money, levels for gear; other kinds have no effect at start. */
function grantStartItem(save: SaveData, item: ItemId, amount: number): void {
  if (amount <= 0) return;
  const info = ITEM_INFO[item];
  if (item === 'bombs') {
    save.bombs = Math.min(amount, save.maxBombs);
    save.items.bombs = 1;
  } else if (item === 'arrows') {
    save.arrows = Math.min(amount, save.maxArrows);
  } else if (item === 'rupees') {
    save.rupees = Math.min(amount, MAX_RUPEES);
  } else if (info && LEVEL_KINDS.has(info.kind)) {
    save.items[item] = Math.min(amount, info.maxLevel);
  }
}

/** The save's dungeon state for a world, if it has one (own entries only). */
export function findDungeonState(save: SaveData, worldId: string): DungeonState | undefined {
  return Object.hasOwn(save.dungeons, worldId) ? save.dungeons[worldId] : undefined;
}

/** Get (creating if needed) the dungeon state for a world. */
export function dungeonState(save: SaveData, worldId: string): DungeonState {
  let d = findDungeonState(save, worldId);
  if (!d) {
    d = { keys: 0, bigKey: false, map: false, compass: false, visited: [], complete: false };
    // defineProperty: a plain assignment to "__proto__" would replace the object's prototype instead.
    Object.defineProperty(save.dungeons, worldId, { value: d, enumerable: true, writable: true, configurable: true });
  }
  return d;
}

/** Apply an item gain. Returns the item-get message (e.g. "You got the Bow! Press C to use it."). */
export function applyItem(save: SaveData, worldId: string, item: ItemId, amount?: number): { message: string } {
  if (!isKnownItem(item)) return { message: '' };
  const message = grant(save, worldId, item, amount);
  if (save.equipped === null && EQUIPPABLE_ITEMS.includes(item) && ownedEquippables(save).includes(item)) {
    save.equipped = item;
  }
  return { message };
}

function grant(save: SaveData, worldId: string, item: ItemId, amount: number | undefined): string {
  switch (item) {
    case 'sword':
    case 'glove':
    case 'boomerang':
      return grantLevel(save, item, amount);
    case 'shield':
    case 'bow':
    case 'hookshot':
    case 'lantern':
    case 'boots':
    case 'flippers': {
      const owned = itemLevel(save, item) > 0;
      save.items[item] = 1;
      return owned ? alreadyHave(item) : GEAR_MESSAGES[item];
    }
    case 'bombs':
    case 'arrows':
    case 'rupees':
    case 'magic':
      return grantCounter(save, item, count(amount, DEFAULT_AMOUNT[item] ?? 1));
    case 'heart':
    case 'fairy':
    case 'heartContainer':
    case 'heartPiece':
      return grantHealth(save, item, amount);
    case 'smallKey':
    case 'bigKey':
    case 'map':
    case 'compass':
    case 'crystal':
      return grantDungeon(save, worldId, item, count(amount, 1));
  }
}

/** "Select it in the menu (Enter) and press C to ..." with the game's own key names. */
const SELECT_AND_USE = `Select it in the menu (${keyWord('start')}) and press ${keyWord('y')} to`;

const GEAR_MESSAGES: Record<'shield' | 'bow' | 'hookshot' | 'lantern' | 'boots' | 'flippers', string> = {
  shield: `You got the ${ITEM_INFO.shield.name}! It blocks small projectiles from the front.`,
  bow: `You got the ${ITEM_INFO.bow.name}! ${SELECT_AND_USE} shoot.`,
  hookshot: `You got the ${ITEM_INFO.hookshot.name}! ${SELECT_AND_USE} fire it.`,
  lantern: `You got the ${ITEM_INFO.lantern.name}! ${SELECT_AND_USE} light torches.`,
  boots: `You got the ${ITEM_INFO.boots.name}! Hold ${keyWord('a')} to dash.`,
  flippers: `You got the ${ITEM_INFO.flippers.name}! Now you can swim in deep water.`,
};

function alreadyHave(item: ItemId): string {
  return `You already have the ${ITEM_INFO[item].name}.`;
}

function grantLevel(save: SaveData, item: 'sword' | 'glove' | 'boomerang', amount: number | undefined): string {
  const current = itemLevel(save, item);
  const target = amount !== undefined && Number.isFinite(amount) && amount >= 1 ? Math.floor(amount) : current + 1;
  const level = Math.min(ITEM_INFO[item].maxLevel, Math.max(current, target));
  save.items[item] = level;
  const name = ITEM_INFO[item].name;
  if (level === current) return alreadyHave(item);
  if (level >= 2) {
    switch (item) {
      case 'sword': return `Your ${name} glows with new power! It strikes harder than ever.`;
      case 'glove': return `Your ${name} grew stronger! Now you can lift heavy rocks with ${keyWord('a')}.`;
      case 'boomerang': return `Your ${name} was upgraded! It flies farther and faster.`;
    }
  }
  switch (item) {
    case 'sword': return `You got the ${name}! Press ${keyWord('b')} to swing it. Hold ${keyWord('b')}, then release, for a spin attack.`;
    case 'glove': return `You got the ${name}! Press ${keyWord('a')} to lift rocks.`;
    case 'boomerang': return `You got the ${name}! ${SELECT_AND_USE} throw it.`;
  }
}

function grantCounter(save: SaveData, item: 'bombs' | 'arrows' | 'rupees' | 'magic', n: number): string {
  switch (item) {
    case 'bombs': {
      const first = (save.items.bombs ?? 0) === 0;
      save.items.bombs = 1;
      save.bombs = Math.min(save.maxBombs, save.bombs + n);
      return first
        ? `You got ${plural(n, 'a Bomb', 'Bombs')}! Select them in the menu (${keyWord('start')}) and press ${keyWord('y')} to place one.`
        : `You got ${plural(n, 'a Bomb', 'Bombs')}!`;
    }
    case 'arrows':
      save.arrows = Math.min(save.maxArrows, save.arrows + n);
      return `You got ${plural(n, 'an Arrow', 'Arrows')}!`;
    case 'rupees':
      save.rupees = Math.min(MAX_RUPEES, save.rupees + n);
      return `You got ${plural(n, 'a Gem', 'Gems')}!`;
    case 'magic':
      save.magic = Math.min(save.maxMagic, save.magic + n);
      return `You got a ${ITEM_INFO.magic.name}! Your magic was restored.`;
  }
}

/** One more heart (a Heart Vessel's worth, capped at MAX_HEARTS) and a full heal. */
function addContainer(save: SaveData): void {
  save.maxHp = Math.min(MAX_HEARTS * HP_PER_HEART, save.maxHp + HP_PER_HEART);
  save.hp = save.maxHp;
}

/** Health items; `amount` only matters for hearts (containers and pieces always count as one). */
function grantHealth(save: SaveData, item: 'heart' | 'fairy' | 'heartContainer' | 'heartPiece', amount: number | undefined): string {
  switch (item) {
    case 'heart': {
      const n = count(amount, 1);
      healSave(save, n * HP_PER_HEART);
      return `You recovered ${plural(n, 'a heart', 'hearts')}!`;
    }
    case 'fairy':
      healSave(save, FAIRY_HEAL);
      return `A ${ITEM_INFO.fairy.name} restored your health!`;
    case 'heartContainer':
      addContainer(save);
      return `You got a ${ITEM_INFO.heartContainer.name}! Your life meter grew by one heart.`;
    case 'heartPiece': {
      save.heartPieces++;
      if (save.heartPieces >= PIECES_PER_HEART) {
        save.heartPieces -= PIECES_PER_HEART;
        addContainer(save);
        return `You got a ${ITEM_INFO.heartPiece.name}! That makes a full heart: your life meter grew by one heart.`;
      }
      const left = PIECES_PER_HEART - save.heartPieces;
      return `You got a ${ITEM_INFO.heartPiece.name}! Collect ${left} more to make a new heart.`;
    }
  }
}

function grantDungeon(save: SaveData, worldId: string, item: 'smallKey' | 'bigKey' | 'map' | 'compass' | 'crystal', n: number): string {
  const d = dungeonState(save, worldId);
  switch (item) {
    case 'smallKey':
      d.keys += n;
      return n === 1 ? `You found a ${ITEM_INFO.smallKey.name}!` : `You found ${n} ${ITEM_INFO.smallKey.name}s!`;
    case 'bigKey':
      d.bigKey = true;
      return `You found the ${ITEM_INFO.bigKey.name}! It opens the big chest and the boss door.`;
    case 'map':
      d.map = true;
      return `You found the ${ITEM_INFO.map.name}! Press ${keyWord('select')} (or M) to view it.`;
    case 'compass':
      d.compass = true;
      return `You found the ${ITEM_INFO.compass.name}! Chests and the boss now show on the map.`;
    case 'crystal': {
      const flag = crystalFlag(worldId);
      if (!save.flags[flag]) {
        save.flags[flag] = true;
        save.crystals++;
      }
      d.complete = true;
      return `You got the ${ITEM_INFO.crystal.name}! This dungeon's treasure is yours.`;
    }
  }
}

/**
 * Whether the player has `item` (default min 1): counters for ammo/money/magic/heart pieces,
 * current-dungeon keys, dungeon flags for big key/map/compass, levels otherwise.
 * Crystal: true in the world whose crystal was collected (min <= 1); otherwise the total crystal
 * count must reach `min`, so "hasItem crystal min 3" works as an overworld gate. To test one
 * specific dungeon from elsewhere, check its flag `crystal:<worldId>`.
 */
export function hasItem(save: SaveData, worldId: string, item: ItemId, min?: number): boolean {
  if (!isKnownItem(item)) return false;
  const need = min ?? 1;
  const d = findDungeonState(save, worldId);
  switch (item) {
    case 'bombs': return save.bombs >= need;
    case 'arrows': return save.arrows >= need;
    case 'rupees': return save.rupees >= need;
    case 'magic': return save.magic >= need;
    case 'heartPiece': return save.heartPieces >= need;
    case 'smallKey': return (d?.keys ?? 0) >= need;
    case 'bigKey': return d?.bigKey ?? false;
    case 'map': return d?.map ?? false;
    case 'compass': return d?.compass ?? false;
    case 'crystal': return (need <= 1 && save.flags[crystalFlag(worldId)] === true) || save.crystals >= need;
    default: return itemLevel(save, item) >= need;
  }
}

/**
 * Consume items/ammo/rupees/keys. Returns false (and changes nothing) if not enough.
 * An explicit amount of 0 is a successful no-op; unknown item ids always fail.
 */
export function takeItem(save: SaveData, worldId: string, item: ItemId, amount?: number): boolean {
  if (!isKnownItem(item)) return false;
  const n = count(amount, 1);
  if (n === 0) return true;
  switch (item) {
    case 'bombs':
    case 'arrows':
    case 'rupees':
    case 'magic':
      if (save[item] < n) return false;
      save[item] -= n;
      return true;
    case 'heartPiece':
      if (save.heartPieces < n) return false;
      save.heartPieces -= n;
      return true;
    case 'smallKey': {
      const d = findDungeonState(save, worldId);
      if (!d || d.keys < n) return false;
      d.keys -= n;
      return true;
    }
    case 'bigKey':
    case 'map':
    case 'compass': {
      const d = findDungeonState(save, worldId);
      if (!d?.[item]) return false;
      d[item] = false;
      return true;
    }
    case 'heart':
    case 'fairy':
    case 'heartContainer':
    case 'crystal':
      return false;
    default:
      return takeLevel(save, item, n);
  }
}

function takeLevel(save: SaveData, item: ItemId, n: number): boolean {
  const level = itemLevel(save, item);
  if (level < n) return false;
  if (level === n) delete save.items[item];
  else save.items[item] = level - n;
  if (save.equipped === item && !ownedEquippables(save).includes(item)) {
    save.equipped = ownedEquippables(save)[0] ?? null;
  }
  return true;
}

/** Owned level/count stored in `items` (0 when not owned). */
export function itemLevel(save: SaveData, item: ItemId): number {
  return save.items[item] ?? 0;
}

/** Equippable items the player owns, in EQUIPPABLE_ITEMS order (bombs only if bombs > 0 or owned). */
export function ownedEquippables(save: SaveData): ItemId[] {
  return EQUIPPABLE_ITEMS.filter((item) => (item === 'bombs' && save.bombs > 0) || itemLevel(save, item) > 0);
}

/** Heal (half-hearts), clamped to maxHp. */
export function healSave(save: SaveData, halfHearts: number): void {
  if (!Number.isFinite(halfHearts)) return; // a broken amount (NaN / Infinity from hand-edited data) changes nothing
  save.hp = clamp(save.hp + halfHearts, 0, save.maxHp);
}
