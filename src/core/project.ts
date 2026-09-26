// Project construction, lookup and (de)serialisation helpers. OWNER: data agent.
import type {
  Dir, Dialogue, EntityInstance, LayerName, MusicId, Palette, Project, ProjectSettings, Room, SpriteDef,
  TileDef, World, WorldKind,
} from './types';
import { LAYERS } from './types';
import {
  MAX_ROOM_SCREENS, PROJECT_FORMAT, PROJECT_VERSION, SCREEN_COLS, SCREEN_H, SCREEN_ROWS, SCREEN_W, TILE,
} from './constants';
import { clamp } from './math';
import { createDefaultAssets } from '../content/art';
import { T } from '../content/ids';
import { migrateProject, usabilityError } from './validate';

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 8;

/** First id of user-created tiles. */
export const USER_TILE_BASE = 1000;

/** Short unique id with a prefix, e.g. newId('e') -> "e_k3j9x2ab". */
export function newId(prefix: string): string {
  const words = new Uint32Array(ID_LENGTH);
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(words);
  } else {
    for (let i = 0; i < ID_LENGTH; i++) words[i] = Math.floor(Math.random() * 0x100000000);
  }
  let body = '';
  for (const w of words) body += ID_CHARS[w % ID_CHARS.length];
  return `${prefix}_${body}`;
}

/** Room width in tiles (gw * 16). */
export function roomCols(room: Room): number {
  return room.gw * SCREEN_COLS;
}

/** Room height in tiles (gh * 14). */
export function roomRows(room: Room): number {
  return room.gh * SCREEN_ROWS;
}

/** Clamp a room size (in screens) to 1..MAX_ROOM_SCREENS. */
export function clampScreens(n: number): number {
  return clamp(Math.round(Number.isFinite(n) ? n : 1), 1, MAX_ROOM_SCREENS);
}

/** Default music for a new world of the given kind. */
export function defaultWorldMusic(kind: WorldKind): MusicId {
  switch (kind) {
    case 'dungeon': return 'dungeon';
    case 'interior': return 'house';
    default: return 'overworld';
  }
}

/** Default project settings (a fresh object). */
export function defaultSettings(title: string): ProjectSettings {
  return { title, subtitle: '', startHearts: 3, startItems: { sword: 1, shield: 1 }, titleMusic: 'title' };
}

/** New room with all layers sized; bg filled with `fill` (default 0), fg/over empty. */
export function createRoom(opts: {
  id?: string; name: string; gx: number; gy: number; gw?: number; gh?: number; floor?: number; fill?: number;
}): Room {
  const gw = clampScreens(opts.gw ?? 1);
  const gh = clampScreens(opts.gh ?? 1);
  const cells = gw * SCREEN_COLS * gh * SCREEN_ROWS;
  return {
    id: opts.id ?? newId('r'),
    name: opts.name,
    gx: opts.gx,
    gy: opts.gy,
    gw,
    gh,
    floor: opts.floor ?? 0,
    layers: {
      bg: new Array<number>(cells).fill(opts.fill ?? 0),
      fg: new Array<number>(cells).fill(0),
      over: new Array<number>(cells).fill(0),
    },
    entities: [],
    triggers: [],
    music: 'inherit',
  };
}

/** New empty world; music defaults by kind (overworld/dungeon/house). */
export function createWorld(opts: { id?: string; name: string; kind: WorldKind; music?: MusicId | 'none' }): World {
  return {
    id: opts.id ?? newId('w'),
    name: opts.name,
    kind: opts.kind,
    music: opts.music ?? defaultWorldMusic(opts.kind),
    rooms: [],
  };
}

/** A little greenery for the blank start room (tile x, tile y, tile key), kept clear of the centre. */
const START_DECOR: readonly [number, number, string][] = [
  [3, 3, 'FLOWERS'], [4, 3, 'FLOWERS'], [3, 4, 'FLOWERS'],
  [11, 10, 'FLOWERS'], [12, 10, 'FLOWERS'], [12, 9, 'FLOWERS'],
  [12, 3, 'BUSH'], [13, 3, 'BUSH'], [2, 10, 'BUSH'], [5, 11, 'BUSH'],
];

/** Default assets + one overworld world with a single grass room; start in its centre facing down. */
export function createBlankProject(name: string, author = 'You'): Project {
  const assets = createDefaultAssets();
  const world = createWorld({ name: 'Overworld', kind: 'overworld' });
  const room = createRoom({ name: 'Start', gx: 0, gy: 0, fill: T.GRASS ?? 0 });
  const cols = roomCols(room);
  for (const [tx, ty, key] of START_DECOR) {
    const id = T[key];
    if (id !== undefined) room.layers.bg[ty * cols + tx] = id;
  }
  world.rooms.push(room);
  const now = Date.now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId('p'),
    name,
    author,
    description: '',
    created: now,
    modified: now,
    settings: defaultSettings(name),
    palettes: assets.palettes,
    tiles: assets.tiles,
    terrains: assets.terrains,
    sprites: assets.sprites,
    worlds: [world],
    dialogues: [],
    flags: [],
    start: { world: world.id, room: room.id, x: SCREEN_W / 2, y: SCREEN_H / 2, dir: 'down' },
  };
}

/** Deep copy (structuredClone). */
export function cloneProject(p: Project): Project {
  return structuredClone(p);
}

/** Update `modified` to now. */
export function touchProject(p: Project): void {
  p.modified = Date.now();
}

// ---------------------------------------------------------------------------
// Lookups. Arrays are indexed lazily by identity; every hit is re-verified so
// in-place edits (push/splice/id change) never return a stale record.
// ---------------------------------------------------------------------------

type Keyed = { id: string | number };
/** id -> first index, plus the array length it was built for. */
interface IdIndex { length: number; at: Map<string | number, number> }
const indexCache = new WeakMap<readonly Keyed[], IdIndex>();

function buildIndex(arr: readonly Keyed[]): IdIndex {
  const at = new Map<string | number, number>();
  arr.forEach((x, i) => {
    if (!at.has(x.id)) at.set(x.id, i);
  });
  return { length: arr.length, at };
}

/**
 * Find by id. A miss on an up-to-date index (same length) is final when `trustMiss`
 * is set (tile ids never change once created), otherwise it is confirmed by a scan
 * so an id renamed in place is still found. Anything else rebuilds the index.
 */
function lookup<V extends Keyed>(arr: readonly V[], id: V['id'], trustMiss = false): V | undefined {
  const index = indexCache.get(arr);
  const cached = index?.at.get(id);
  if (cached !== undefined) {
    const hit = arr[cached];
    if (hit !== undefined && hit.id === id) return hit;
  } else if (index && index.length === arr.length && (trustMiss || !arr.some((x) => x.id === id))) {
    return undefined;
  }
  const fresh = buildIndex(arr);
  indexCache.set(arr, fresh);
  const at = fresh.at.get(id);
  return at === undefined ? undefined : arr[at];
}

export function findWorld(p: Project, worldId: string): World | undefined {
  return lookup(p.worlds, worldId);
}

export function findRoom(p: Project, worldId: string, roomId: string): Room | undefined {
  const world = findWorld(p, worldId);
  return world ? lookup(world.rooms, roomId) : undefined;
}

/** Search every world for a room id. */
export function locateRoom(p: Project, roomId: string): { world: World; room: Room } | undefined {
  for (const world of p.worlds) {
    const room = lookup(world.rooms, roomId);
    if (room) return { world, room };
  }
  return undefined;
}

/** Room covering world-grid screen cell (gx, gy) on `floor`. */
export function roomAtGrid(world: World, gx: number, gy: number, floor: number): Room | undefined {
  return world.rooms.find((r) => r.floor === floor
    && gx >= r.gx && gx < r.gx + r.gw
    && gy >= r.gy && gy < r.gy + r.gh);
}

/**
 * Room adjacent to `room` across its `dir` edge, at the edge position `along`
 * (room-local px along that edge: x for up/down, y for left/right).
 */
export function neighborRoom(world: World, room: Room, dir: Dir, along: number): Room | undefined {
  const offsetY = clamp(Math.floor(along / SCREEN_H), 0, room.gh - 1);
  const offsetX = clamp(Math.floor(along / SCREEN_W), 0, room.gw - 1);
  switch (dir) {
    case 'right': return roomAtGrid(world, room.gx + room.gw, room.gy + offsetY, room.floor);
    case 'left': return roomAtGrid(world, room.gx - 1, room.gy + offsetY, room.floor);
    case 'up': return roomAtGrid(world, room.gx + offsetX, room.gy - 1, room.floor);
    case 'down': return roomAtGrid(world, room.gx + offsetX, room.gy + room.gh, room.floor);
  }
}

/** Whether placing a room at the given grid rect would overlap another room on that floor. */
export function gridOverlaps(world: World, gx: number, gy: number, gw: number, gh: number, floor: number, ignoreRoomId?: string): boolean {
  return world.rooms.some((r) => r.id !== ignoreRoomId && r.floor === floor
    && gx < r.gx + r.gw && gx + gw > r.gx
    && gy < r.gy + r.gh && gy + gh > r.gy);
}

export function findEntityInstance(p: Project, id: string): { world: World; room: Room; entity: EntityInstance } | undefined {
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      const entity = lookup(room.entities, id);
      if (entity) return { world, room, entity };
    }
  }
  return undefined;
}

/**
 * Tile definition by numeric id (0 = empty, never defined). Misses are answered from the cached
 * index, so it is cheap per cell; add/remove tiles with push/splice rather than re-id one in place.
 */
export function tileById(p: Project, id: number): TileDef | undefined {
  return id === 0 ? undefined : lookup(p.tiles, id, true);
}

export function spriteById(p: Project, id: string): SpriteDef | undefined {
  return lookup(p.sprites, id);
}

export function paletteById(p: Project, id: string): Palette | undefined {
  return lookup(p.palettes, id);
}

export function dialogueById(p: Project, id: string): Dialogue | undefined {
  return lookup(p.dialogues, id);
}

/** Lowest unused tile id >= 1000 (user-created tiles live at 1000+). */
export function nextTileId(p: Project): number {
  const used = new Set(p.tiles.map((t) => t.id));
  let id = USER_TILE_BASE;
  while (used.has(id)) id++;
  return id;
}

/** Re-lay a row-major layer to a new size, anchored top-left; new cells get `fill`. */
export function resizeLayerData(
  src: readonly number[], oldCols: number, oldRows: number, cols: number, rows: number, fill: number,
): number[] {
  const out = new Array<number>(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out[y * cols + x] = x < oldCols && y < oldRows ? (src[y * oldCols + x] ?? fill) : fill;
    }
  }
  return out;
}

/** Resize a room in screens, keeping existing content anchored top-left; new bg cells get `fill`; entities outside are dropped. */
export function resizeRoom(room: Room, gw: number, gh: number, fill: number): void {
  const oldCols = roomCols(room);
  const oldRows = roomRows(room);
  room.gw = clampScreens(gw);
  room.gh = clampScreens(gh);
  const cols = roomCols(room);
  const rows = roomRows(room);
  const layers = {} as Record<LayerName, number[]>;
  for (const layer of LAYERS) {
    layers[layer] = resizeLayerData(room.layers[layer], oldCols, oldRows, cols, rows, layer === 'bg' ? fill : 0);
  }
  room.layers = layers;
  const w = cols * TILE;
  const h = rows * TILE;
  room.entities = room.entities.filter((e) => e.x >= 0 && e.x < w && e.y >= 0 && e.y < h);
}

/** Compact JSON string for storage/export. */
export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}

/**
 * Parse + migrate + validate (throws Error with a readable message if unusable).
 * Non-fatal validation problems are left for the editor to report.
 */
export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`This file is not valid JSON, so it can't be a Questforge project (${detail}).`);
  }
  const project = migrateProject(raw);
  const fatal = usabilityError(project);
  if (fatal) throw new Error(fatal);
  return project;
}
