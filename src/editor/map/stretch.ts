// Resizing walled rooms (dungeons, interiors, caves) by moving their far walls:
// growing inserts copies of an interior "seam" column / row just inside the
// right / bottom wall band, so the walls, their doorways and the void around a
// house keep their shape, and carpets or paths crossing the seam run on;
// shrinking removes the columns / rows ending at that seam. Rooms without a
// seam are cropped / extended anchored top-left. Trigger tile targets on
// removed lines go with them. remapArrival() says where a warp / start arrival
// point into the room should land afterwards. Pure data, no DOM.
import type { Collision, LayerName, Room } from '../../core/types';
import { SCREEN_COLS, SCREEN_ROWS, TILE } from '../../core/constants';
import { LAYERS } from '../../core/types';
import { resizeLayerData, roomCols, roomRows } from '../../core/project';
import { T } from '../../content/ids';

/** What stretching needs to know about a tile id (undefined = not a defined tile). */
export type TileLookup = (id: number) => { tags: readonly string[]; collision: Collision } | undefined;

const ids = (...keys: string[]): ReadonlySet<number> => new Set(keys.map((k) => T[k]).filter((id): id is number => id !== undefined));

/** Wall faces a column seam may cross (top / bottom walls); a row seam crosses the left / right ones. */
const HORIZONTAL = ids('DWALL_TOP', 'DWALL_BOTTOM', 'IWALL_TOP', 'IWALL_BOTTOM');
const VERTICAL = ids('DWALL_LEFT', 'DWALL_RIGHT', 'IWALL_LEFT', 'IWALL_RIGHT');
/** Solid wall mass, fine in either direction. */
const MASS = ids('DWALL_FILL', 'CAVE_WALL');

type SeamClass = 'void' | 'floor' | 'face' | 'other';

const isWall = (tile: TileLookup, id: number): boolean => tile(id)?.tags.includes('wall') ?? false;

/** Class of a bg id on a seam: void, interior floor, a wall face the seam may cross, or anything else. */
function classify(id: number, column: boolean, tile: TileLookup): SeamClass {
  if (id === 0) return 'void';
  if (MASS.has(id) || (column ? HORIZONTAL : VERTICAL).has(id)) return 'face';
  if ((column ? VERTICAL : HORIZONTAL).has(id) || isWall(tile, id)) return 'other';
  return 'floor';
}

/**
 * Whether a line of bg ids (a column if `column`, else a row) can be copied to
 * stretch the room: it crosses the interior (some floor) between two plain wall
 * faces or wall mass, with only void beyond them, and holds no corner, window,
 * doorway or other wall piece.
 */
export function isSeam(line: readonly number[], column: boolean, tile: TileLookup): boolean {
  const classes = line.map((id) => classify(id, column, tile));
  const first = classes.findIndex((c) => c !== 'void');
  let last = classes.length - 1;
  while (last > first && classes[last] === 'void') last--;
  if (first < 0 || first === last || classes[first] !== 'face' || classes[last] !== 'face') return false;
  return classes.includes('floor') && !classes.includes('other');
}

/** Right-most seam column (never an outer column), or -1. */
export function seamColumn(bg: readonly number[], cols: number, rows: number, tile: TileLookup): number {
  for (let x = cols - 2; x >= 1; x--) {
    if (isSeam(Array.from({ length: rows }, (_, y) => bg[y * cols + x] ?? 0), true, tile)) return x;
  }
  return -1;
}

/** Bottom-most seam row (never an outer row), or -1. */
export function seamRow(bg: readonly number[], cols: number, rows: number, tile: TileLookup): number {
  for (let y = rows - 2; y >= 1; y--) if (isSeam(bg.slice(y * cols, (y + 1) * cols), false, tile)) return y;
  return -1;
}

/** One axis of a stretch: insert `d` copies after line `seam` (d > 0), or remove the -d lines ending at it. */
export interface Stretch { seam: number; d: number }

/** What a resize did, per axis (null = cropped / extended top-left), with the sizes in tiles before and after. */
export interface ResizePlan {
  sx: Stretch | null;
  sy: Stretch | null;
  fromCols: number;
  fromRows: number;
  toCols: number;
  toRows: number;
}

/** The stretch resizing `from` lines to `to`, or null to crop / extend instead (no seam, or it would eat line 0). */
function planAxis(seam: number, from: number, to: number): Stretch | null {
  const d = to - from;
  return d !== 0 && seam >= 0 && seam + d >= 0 ? { seam, d } : null;
}

/** Old line that new line `i` shows; -1 = an inserted copy of the seam. */
function sourceLine(i: number, s: Stretch): number {
  if (s.d < 0) return i <= s.seam + s.d ? i : i - s.d;
  if (i <= s.seam) return i;
  return i <= s.seam + s.d ? -1 : i - s.d;
}

/** New position of old line `i` (null = removed). */
function targetLine(i: number, s: Stretch): number | null {
  if (i <= s.seam + Math.min(0, s.d)) return i;
  return s.d < 0 && i <= s.seam ? null : i + s.d;
}

/**
 * Stretch the columns of a cols x rows layer. Inserted cells copy the seam's
 * walls, void and walkable ground (carpets, paths); other interior cells (pots,
 * pits...) become `fill` on bg, and objects above the ground are not copied.
 */
function stretchColumns(
  data: readonly number[], bg: readonly number[], cols: number, rows: number, s: Stretch, layer: LayerName, fill: number, tile: TileLookup,
): number[] {
  const next = cols + s.d;
  const out = new Array<number>(next * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < next; x++) {
      const src = sourceLine(x, s);
      const at = y * cols + (src < 0 ? s.seam : src);
      const id = data[at] ?? 0;
      const ground = bg[at] ?? 0;
      if (src >= 0 || classify(ground, true, tile) !== 'floor') out[y * next + x] = id;
      else if (layer !== 'bg') out[y * next + x] = 0;
      else out[y * next + x] = tile(id)?.collision === 'floor' ? id : fill;
    }
  }
  return out;
}

/** Transpose a row-major cols x rows grid. */
function transpose(data: readonly number[], cols: number, rows: number): number[] {
  const out = new Array<number>(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out[x * rows + y] = data[y * cols + x] ?? 0;
  return out;
}

/**
 * Resize a room to gw x gh screens (already clamped). Walled rooms move their
 * right / bottom wall band, with its doorways and the entities and trigger tile
 * targets in it; other content is cropped / extended top-left with `fill` on
 * new ground cells. Entities and trigger tile targets on removed lines or left
 * outside the room are dropped. Returns what was done (see remapArrival).
 */
export function resizeWalledRoom(room: Room, gw: number, gh: number, fill: number, tile: TileLookup): ResizePlan {
  const fromCols = roomCols(room);
  const fromRows = roomRows(room);
  let cols = fromCols;
  let rows = fromRows;
  const toCols = gw * SCREEN_COLS;
  const toRows = gh * SCREEN_ROWS;
  const sx = planAxis(seamColumn(room.layers.bg, cols, rows, tile), cols, toCols);
  if (sx) {
    const bg = room.layers.bg;
    for (const layer of LAYERS) room.layers[layer] = stretchColumns(room.layers[layer], bg, cols, rows, sx, layer, fill, tile);
    cols += sx.d;
    moveContent(room, sx, 'x');
  }
  const sy = planAxis(seamRow(room.layers.bg, cols, rows, tile), rows, toRows);
  if (sy) {
    // Stretching rows = stretching the columns of the transposed grid.
    const bgT = transpose(room.layers.bg, cols, rows);
    for (const layer of LAYERS) {
      const t = stretchColumns(transpose(room.layers[layer], cols, rows), bgT, rows, cols, sy, layer, fill, tile);
      room.layers[layer] = transpose(t, rows + sy.d, cols);
    }
    rows += sy.d;
    moveContent(room, sy, 'y');
  }
  for (const layer of LAYERS) {
    room.layers[layer] = resizeLayerData(room.layers[layer], cols, rows, toCols, toRows, layer === 'bg' ? fill : 0);
  }
  room.gw = gw;
  room.gh = gh;
  const w = toCols * TILE;
  const h = toRows * TILE;
  room.entities = room.entities.filter((e) => e.x >= 0 && e.x < w && e.y >= 0 && e.y < h);
  for (const trigger of room.triggers) {
    trigger.actions = trigger.actions.filter((a) => a.kind !== 'setTile' || (a.tx >= 0 && a.tx < toCols && a.ty >= 0 && a.ty < toRows));
  }
  return { sx, sy, fromCols, fromRows, toCols, toRows };
}

/**
 * Where an arrival point into a resized room (a warp or pit target, the
 * start; room px) should land: it keeps its distance to the nearer of the
 * two walls on each axis, so a doorway arrival follows its wall (moved far
 * walls take their doorways along). A point whose lines were removed lands
 * on the last kept line before the far wall; anything still outside the new
 * size is pulled inside.
 */
export function remapArrival(x: number, y: number, plan: ResizePlan): { x: number; y: number } {
  return { x: remapAxis(x, plan.sx, plan.fromCols, plan.toCols), y: remapAxis(y, plan.sy, plan.fromRows, plan.toRows) };
}

function remapAxis(v: number, s: Stretch | null, from: number, to: number): number {
  let out = v;
  if (s) {
    const line = Math.floor(v / TILE);
    const far = line > s.seam || v > (from * TILE) / 2;
    if (far) out = v + s.d * TILE;
    else if (s.d < 0 && line > s.seam + s.d) out = v - (line - (s.seam + s.d)) * TILE; // a removed line: the last kept one
    if (out < 0) out = TILE / 2;
  }
  const max = to * TILE;
  return out >= max ? max - TILE / 2 : out;
}

/** Move entities and trigger setTile targets with the lines a stretch moved (those on removed lines go). */
function moveContent(room: Room, s: Stretch, axis: 'x' | 'y'): void {
  room.entities = room.entities.filter((e) => {
    const line = Math.floor(e[axis] / TILE);
    const to = targetLine(line, s);
    if (to === null) return false;
    e[axis] += (to - line) * TILE;
    return true;
  });
  const key = axis === 'x' ? 'tx' : 'ty';
  for (const trigger of room.triggers) {
    trigger.actions = trigger.actions.filter((action) => {
      if (action.kind !== 'setTile') return true;
      const to = targetLine(action[key], s);
      if (to === null) return false;
      action[key] = to;
      return true;
    });
  }
}
