// One-tile wall borders for dungeon rooms, house interiors and caves (bg layer),
// used by "new room" and the Room tab's "Stamp walls" (resizing walled rooms
// lives in stretch.ts). Pure data, no DOM.
import type { Room, WorldKind } from '../../core/types';
import type { TileEdit } from './tileEdit';
import { roomCols, roomRows } from '../../core/project';
import { T } from '../../content/ids';

export type WallStyle = 'dungeon' | 'house' | 'cave';

export interface WallSet {
  top: number; bottom: number; left: number; right: number;
  tl: number; tr: number; bl: number; br: number;
}

function set(prefix: string): WallSet {
  const id = (k: string): number => T[`${prefix}_${k}`] ?? 0;
  return {
    top: id('TOP'), bottom: id('BOTTOM'), left: id('LEFT'), right: id('RIGHT'),
    tl: id('TL'), tr: id('TR'), bl: id('BL'), br: id('BR'),
  };
}

const CAVE = T.CAVE_WALL ?? 0;

export const WALL_SETS: Readonly<Record<WallStyle, WallSet>> = {
  dungeon: set('DWALL'),
  house: set('IWALL'),
  cave: { top: CAVE, bottom: CAVE, left: CAVE, right: CAVE, tl: CAVE, tr: CAVE, bl: CAVE, br: CAVE },
};

export const WALL_STYLE_LABELS: Readonly<Record<WallStyle, string>> = {
  dungeon: 'Dungeon brick',
  house: 'House wall',
  cave: 'Cave rock',
};

/** Default wall style for rooms of a world kind (overworld rooms have none). */
export function wallStyleFor(kind: WorldKind): WallStyle | null {
  return kind === 'dungeon' ? 'dungeon' : kind === 'interior' ? 'house' : null;
}

/** Wall style matching a floor fill tile (grass has none). */
export function wallStyleForFill(fill: number): WallStyle | null {
  if (fill === T.DFLOOR) return 'dungeon';
  if (fill === T.WOOD_FLOOR) return 'house';
  if (fill === T.CAVE_FLOOR) return 'cave';
  return null;
}

/** Border cells of a cols x rows grid with the wall piece each gets. */
function borderPieces(cols: number, rows: number, w: WallSet): [tx: number, ty: number, id: number][] {
  const out: [number, number, number][] = [];
  const lastX = cols - 1;
  const lastY = rows - 1;
  for (let tx = 1; tx < lastX; tx++) out.push([tx, 0, w.top], [tx, lastY, w.bottom]);
  for (let ty = 1; ty < lastY; ty++) out.push([0, ty, w.left], [lastX, ty, w.right]);
  out.push([0, 0, w.tl], [lastX, 0, w.tr], [0, lastY, w.bl], [lastX, lastY, w.br]);
  return out;
}

/** Write a one-tile wall border around the room's bg layer. */
export function stampWalls(edit: TileEdit, style: WallStyle): void {
  for (const [tx, ty, id] of borderPieces(edit.cols, edit.rows, WALL_SETS[style])) edit.set('bg', tx, ty, id);
}

/** The style whose complete border surrounds the room's bg layer, if any. */
export function detectWalls(room: Room): WallStyle | null {
  const cols = roomCols(room);
  const bg = room.layers.bg;
  for (const style of Object.keys(WALL_SETS) as WallStyle[]) {
    const pieces = borderPieces(cols, roomRows(room), WALL_SETS[style]);
    if (pieces.every(([tx, ty, id]) => bg[ty * cols + tx] === id)) return style;
  }
  return null;
}
