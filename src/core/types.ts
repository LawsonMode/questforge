// =============================================================================
// Questforge data model — THE shared contract. Everything a project contains
// is plain JSON-serialisable data described here. Do not add class instances,
// functions, Maps or typed arrays to these types (projects are saved as JSON).
// Changing a type here is a contract change: coordinate, don't improvise.
// =============================================================================

export type Dir = 'up' | 'down' | 'left' | 'right';

// ----------------------------------------------------------------------------
// Pixel art
// ----------------------------------------------------------------------------

/**
 * A 16-colour SNES-style palette. `colors` has exactly 16 CSS hex strings
 * ("#rrggbb", lowercase). Index 0 is ALWAYS transparent when drawn; its value
 * is only used as the editor backdrop. The editor snaps channels to 5-bit
 * (multiples of 8) to stay within the SNES BGR555 gamut.
 */
export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

/**
 * One frame of pixel art: exactly w*h characters, row-major, each a lowercase
 * hex digit '0'-'f' indexing the owning asset's palette ('0' = transparent).
 * A 16x16 frame is a 256-character string.
 */
export type PixelData = string;

// ----------------------------------------------------------------------------
// Tiles
// ----------------------------------------------------------------------------

/**
 * How a tile behaves for movement.
 *  floor     walkable
 *  solid     wall (optionally partial via TileDef.solidMask)
 *  shallow   walkable water (splash, slight slow)
 *  deep      deep water: blocks unless the player has flippers (then swims)
 *  pit       hole: the player falls in (damage + respawn, or Room.pitTarget)
 *  ledge     one-way drop: blocks, except the player moving in TileDef.ledgeDir hops over it
 *  hurt      walkable but damages (spikes)
 *  tallgrass walkable, drawn over the player's feet, cuttable
 *  stairs    walkable, slows movement slightly
 */
export type Collision =
  | 'floor'
  | 'solid'
  | 'shallow'
  | 'deep'
  | 'pit'
  | 'ledge'
  | 'hurt'
  | 'tallgrass'
  | 'stairs';

export const COLLISIONS: readonly Collision[] = [
  'floor', 'solid', 'shallow', 'deep', 'pit', 'ledge', 'hurt', 'tallgrass', 'stairs',
];

export interface TileDef {
  /** Numeric id used in room layer arrays. 0 is reserved for "empty". */
  id: number;
  /** Stable programmatic key, e.g. "GRASS". Unique. */
  key: string;
  name: string;
  /** Palette id. */
  palette: string;
  /** One or more 16x16 frames. More than one = animated. */
  frames: PixelData[];
  /** Seconds per animation frame (default 0.25). */
  frameTime?: number;
  collision: Collision;
  /**
   * Only for collision 'solid': which 8x8 quarters are solid.
   * bit0 = top-left, bit1 = top-right, bit2 = bottom-left, bit3 = bottom-right.
   * Omitted or 15 = fully solid.
   */
  solidMask?: number;
  /** Only for collision 'ledge': the direction the player hops. */
  ledgeDir?: Dir;
  /** Palette-grouping tags for the editor: 'overworld', 'dungeon', 'interior', 'cave', 'water', 'decor', ... */
  tags: string[];
  /** Sword cuts it; tile becomes `to`. `drops` rolls random loot. */
  cut?: { to: number; drops?: boolean };
  /** Player lifts it with the action button (weight 1 needs glove lv1, 2 needs glove lv2). Tile becomes `to`. */
  lift?: { to: number; weight: 0 | 1 | 2; drops?: boolean };
  /** A bomb blast turns it into `to` (persistently). */
  bomb?: { to: number };
  /** A boots dash into it turns it into `to`. */
  dash?: { to: number };
}

/**
 * 13-tile autotile set ("blob-lite") for editor terrain brushes. The terrain
 * "blob" is the painted area. For a painted cell with 8-neighbour membership:
 *  - edge tiles (n/s/e/w): that cardinal neighbour is NOT terrain
 *  - outer corners (ne/nw/se/sw): both named cardinals are NOT terrain
 *  - inner corners (ine/inw/ise/isw): all 4 cardinals ARE terrain but that diagonal is NOT
 *  - otherwise `center`.
 */
export interface Terrain {
  id: string;
  name: string;
  layer: LayerName;
  center: number;
  n: number; s: number; e: number; w: number;
  ne: number; nw: number; se: number; sw: number;
  ine: number; inw: number; ise: number; isw: number;
}

// ----------------------------------------------------------------------------
// Sprites
// ----------------------------------------------------------------------------

export interface SpriteAnim {
  /** Indices into SpriteDef.frames. */
  frames: number[];
  /** Frames per second. */
  fps: number;
  loop: boolean;
  /** Draw mirrored horizontally (e.g. walk_left reuses walk_right frames). */
  flipX?: boolean;
}

export interface SpriteDef {
  id: string;
  name: string;
  palette: string;
  /** Frame size in pixels. */
  w: number;
  h: number;
  /** Origin inside the frame. The frame is drawn so (ox, oy) lands on the entity position. */
  ox: number;
  oy: number;
  frames: PixelData[];
  anims: Record<string, SpriteAnim>;
  tags: string[];
}

// ----------------------------------------------------------------------------
// Rooms & worlds
// ----------------------------------------------------------------------------

export type LayerName = 'bg' | 'fg' | 'over';
/** bg = ground, fg = objects on the ground (collision: fg wins when non-zero), over = drawn above sprites (no collision). */
export const LAYERS: readonly LayerName[] = ['bg', 'fg', 'over'];

export interface WarpTarget {
  world: string;
  room: string;
  /** Room-local pixel position (entity centre). */
  x: number;
  y: number;
  /** Facing on arrival. */
  dir?: Dir;
}

/** Entity property values. A 'warp' prop stores a WarpTarget object. */
export type PropValue = string | number | boolean | null | WarpTarget;

export interface EntityInstance {
  /** Project-unique id (e.g. "e_k3j9x2"). Referenced by triggers, doors, flags. */
  id: string;
  /** Catalog type key, e.g. "enemy.soldier" (see core/catalog.ts). */
  type: string;
  /** Room-local pixel position of the entity centre (tile-aligned placements use tx*16+8, ty*16+8). */
  x: number;
  y: number;
  props: Record<string, PropValue>;
}

export interface Room {
  id: string;
  name: string;
  /** Top-left position on the world grid, in screens. */
  gx: number;
  gy: number;
  /** Size in screens (1..MAX_ROOM_SCREENS). cols = gw*16, rows = gh*14. */
  gw: number;
  gh: number;
  /** Floor index; edge transitions only link rooms on the same floor. 0 = ground. */
  floor: number;
  /** Each layer is cols*rows tile ids, row-major. bg id 0 renders black and is solid. */
  layers: Record<LayerName, number[]>;
  entities: EntityInstance[];
  triggers: Trigger[];
  /** 'inherit' (default) uses the world's music. */
  music?: MusicId | 'none' | 'inherit';
  /** Dark room: only lit by the player's lantern and lit torches. */
  dark?: boolean;
  /** Falling into a pit here lands the player at this target instead of damage + respawn. */
  pitTarget?: WarpTarget;
}

export type WorldKind = 'overworld' | 'dungeon' | 'interior';

export interface World {
  id: string;
  name: string;
  /** 'dungeon' worlds get small keys, big key, map, compass tracked per world. */
  kind: WorldKind;
  music: MusicId | 'none';
  rooms: Room[];
  /** Dungeon worlds: display name of the prize (e.g. "Sun Crystal"); default "<world name> Crystal". */
  prizeName?: string;
}

// ----------------------------------------------------------------------------
// Triggers (room-scoped event rules)
// ----------------------------------------------------------------------------

/**
 * When a trigger is evaluated:
 *  'auto'  every frame; fires on the rising edge of "all conditions true"
 *  'enter' once each time the room is entered (if conditions hold)
 *  'talk'  when the player talks to / interacts with entity `source`
 */
export type TriggerOn = 'auto' | 'enter' | 'talk';

export type Condition =
  | { kind: 'enemiesCleared' }
  | { kind: 'switch'; target: string; on: boolean }
  | { kind: 'torchesLit' }
  | { kind: 'flag'; flag: string; value: boolean }
  | { kind: 'hasItem'; item: ItemId; min: number }
  | { kind: 'inRegion'; target: string }
  | { kind: 'defeated'; target: string }
  | { kind: 'blockPushed'; target: string };

export type Action =
  | { kind: 'openDoor'; target: string }
  | { kind: 'closeDoor'; target: string }
  | { kind: 'showEntity'; target: string }
  | { kind: 'hideEntity'; target: string }
  | { kind: 'setFlag'; flag: string; value: boolean }
  | { kind: 'dialogue'; dialogue: string }
  | { kind: 'giveItem'; item: ItemId; amount: number }
  | { kind: 'takeItem'; item: ItemId; amount: number }
  | { kind: 'setTile'; layer: LayerName; tx: number; ty: number; tile: number }
  | { kind: 'sound'; sfx: SfxId }
  | { kind: 'music'; music: MusicId | 'none' }
  | { kind: 'secret' }
  | { kind: 'warp'; target: WarpTarget }
  | { kind: 'heal'; amount: number }
  | { kind: 'shake'; seconds: number }
  | { kind: 'wait'; seconds: number };

export interface Trigger {
  id: string;
  name: string;
  on: TriggerOn;
  /** Entity id for on === 'talk'. */
  source?: string;
  /** All must hold (AND). Empty = always true. */
  conditions: Condition[];
  /** Run in order; 'dialogue' and 'wait' block until finished. */
  actions: Action[];
  /** Fire at most once per save file (persisted as flag `trigger:<id>`). */
  once: boolean;
}

// ----------------------------------------------------------------------------
// Dialogue
// ----------------------------------------------------------------------------

export interface DialoguePage {
  /** Optional speaker name shown above the text. */
  speaker?: string;
  /** Text. Word-wrapped by the box. `{name}` = save-file name. `\n` forces a line break. */
  text: string;
  /**
   * Optional choice shown after the text (2-3 options). If `flag` is set, the
   * flag is set true when option 0 is chosen and false otherwise.
   */
  choice?: { options: string[]; flag?: string };
}

export interface Dialogue {
  id: string;
  name: string;
  pages: DialoguePage[];
}

// ----------------------------------------------------------------------------
// Items, audio ids
// ----------------------------------------------------------------------------

export type ItemId =
  | 'sword' | 'shield' | 'bow' | 'boomerang' | 'hookshot' | 'bombs' | 'lantern'
  | 'boots' | 'glove' | 'flippers'
  | 'arrows' | 'rupees' | 'heart' | 'heartContainer' | 'heartPiece' | 'magic' | 'fairy'
  | 'smallKey' | 'bigKey' | 'map' | 'compass' | 'crystal';

export const ITEM_IDS: readonly ItemId[] = [
  'sword', 'shield', 'bow', 'boomerang', 'hookshot', 'bombs', 'lantern',
  'boots', 'glove', 'flippers',
  'arrows', 'rupees', 'heart', 'heartContainer', 'heartPiece', 'magic', 'fairy',
  'smallKey', 'bigKey', 'map', 'compass', 'crystal',
];

/** Items that can be assigned to the item button (Y). */
export const EQUIPPABLE_ITEMS: readonly ItemId[] = ['bow', 'boomerang', 'hookshot', 'bombs', 'lantern'];

export type SfxId =
  | 'sword' | 'swordSpin' | 'swordCharge' | 'swordTink' | 'hit' | 'enemyHit' | 'enemyDie' | 'hurt'
  | 'lowHealth' | 'rupee' | 'heart' | 'item' | 'fanfare' | 'secret' | 'door' | 'locked'
  | 'unlock' | 'chest' | 'bombPlace' | 'explode' | 'arrow' | 'arrowHit' | 'boomerang'
  | 'lift' | 'throw' | 'shatter' | 'cut' | 'splash' | 'fall' | 'stairs' | 'text'
  | 'menuMove' | 'menuSelect' | 'menuOpen' | 'menuClose' | 'switch' | 'push' | 'shield'
  | 'hookshot' | 'dash' | 'bossHit' | 'bossDie' | 'fairy' | 'lantern' | 'error' | 'jump'
  | 'land' | 'magic' | 'crystal';

export const SFX_IDS: readonly SfxId[] = [
  'sword', 'swordSpin', 'swordCharge', 'swordTink', 'hit', 'enemyHit', 'enemyDie', 'hurt',
  'lowHealth', 'rupee', 'heart', 'item', 'fanfare', 'secret', 'door', 'locked',
  'unlock', 'chest', 'bombPlace', 'explode', 'arrow', 'arrowHit', 'boomerang',
  'lift', 'throw', 'shatter', 'cut', 'splash', 'fall', 'stairs', 'text',
  'menuMove', 'menuSelect', 'menuOpen', 'menuClose', 'switch', 'push', 'shield',
  'hookshot', 'dash', 'bossHit', 'bossDie', 'fairy', 'lantern', 'error', 'jump',
  'land', 'magic', 'crystal',
];

export type MusicId =
  | 'title' | 'overworld' | 'village' | 'forest' | 'dungeon' | 'cave' | 'house'
  | 'boss' | 'victory' | 'gameover' | 'fileSelect';

export const MUSIC_IDS: readonly MusicId[] = [
  'title', 'overworld', 'village', 'forest', 'dungeon', 'cave', 'house',
  'boss', 'victory', 'gameover', 'fileSelect',
];

// ----------------------------------------------------------------------------
// Project
// ----------------------------------------------------------------------------

export interface FlagDef {
  name: string;
  description?: string;
}

export interface ProjectSettings {
  /** Title shown on the title screen. */
  title: string;
  subtitle: string;
  /** Starting max hearts (1..20). */
  startHearts: number;
  /** Items the player starts with (e.g. { sword: 1, shield: 1 }). */
  startItems: Partial<Record<ItemId, number>>;
  /** Dialogue shown when a new game starts. */
  introDialogue?: string;
  titleMusic: MusicId;
}

export interface Project {
  format: 'questforge';
  version: number;
  id: string;
  name: string;
  author: string;
  description: string;
  /** epoch ms */
  created: number;
  modified: number;
  settings: ProjectSettings;
  palettes: Palette[];
  tiles: TileDef[];
  terrains: Terrain[];
  sprites: SpriteDef[];
  worlds: World[];
  dialogues: Dialogue[];
  flags: FlagDef[];
  /** Where a new game begins. */
  start: WarpTarget;
}

// ----------------------------------------------------------------------------
// Save games (one per slot per project)
// ----------------------------------------------------------------------------

export interface DungeonState {
  keys: number;
  bigKey: boolean;
  map: boolean;
  compass: boolean;
  /** Room ids the player has visited (for the dungeon map). */
  visited: string[];
  complete: boolean;
}

/**
 * Persistent world state lives in `flags` using these conventions:
 *   chest:<entityId>      chest opened
 *   pickup:<entityId>     placed pickup collected
 *   door:<link>           door unlocked/opened (shared by both sides via `link`)
 *   shown:<entityId>      hidden entity revealed by a trigger
 *   hidden:<entityId>     entity hidden by a trigger
 *   defeated:<entityId>   persistDefeat enemy (boss) killed
 *   trigger:<triggerId>   once-trigger already fired
 *   tile:<roomId>:<layer>:<tx>,<ty>=<tileId>  (key only; value true) persistent tile change (bomb/dash)
 *   pegs:<worldId>        crystal-switch state (false = red pegs raised, true = blue raised)
 *   crystal:<worldId>     dungeon prize collected
 * plus any designer-defined flags.
 */
export interface SaveData {
  version: number;
  slot: number;
  name: string;
  projectId: string;
  /** Half-heart units. */
  hp: number;
  maxHp: number;
  heartPieces: number;
  magic: number;
  maxMagic: number;
  rupees: number;
  bombs: number;
  maxBombs: number;
  arrows: number;
  maxArrows: number;
  /** Owned items -> level/count (sword 1-2, glove 1-2, boomerang 1-2, others 1). */
  items: Partial<Record<ItemId, number>>;
  /** Item on the item button. */
  equipped: ItemId | null;
  /** Per dungeon world id. */
  dungeons: Record<string, DungeonState>;
  flags: Record<string, boolean>;
  /** Where "continue" places the player (last entrance). */
  respawn: WarpTarget;
  crystals: number;
  /** Seconds. */
  playTime: number;
  deaths: number;
  created: number;
  updated: number;
}
