// Terrain autotiling (13-piece "blob-lite", see Terrain in core/types.ts).
// Used by the editor terrain brush and by the sample-project builder. OWNER: data agent.
import type { LayerName, Room, Terrain } from './types';
import { roomCols, roomRows } from './project';

/** Neighbour bits (set when the neighbour IS terrain). Out-of-room neighbours count as terrain. */
export const NB = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 } as const;

const NEIGHBOURS: readonly (readonly [dx: number, dy: number, bit: number])[] = [
  [0, -1, NB.N], [1, -1, NB.NE], [1, 0, NB.E], [1, 1, NB.SE],
  [0, 1, NB.S], [-1, 1, NB.SW], [-1, 0, NB.W], [-1, -1, NB.NW],
];

/** The 13 piece ids of a terrain. */
export function terrainPieces(terrain: Terrain): number[] {
  const t = terrain;
  return [t.center, t.n, t.s, t.e, t.w, t.ne, t.nw, t.se, t.sw, t.ine, t.inw, t.ise, t.isw];
}

/** True if tile id is one of the terrain's 13 pieces. */
export function isTerrainTile(terrain: Terrain, id: number): boolean {
  return terrainPieces(terrain).includes(id);
}

/**
 * Pick the piece for an 8-neighbour membership mask (see NB). Precedence:
 * outer corner (two adjacent cardinals missing; nw, ne, sw, se order) ->
 * edge (one cardinal missing; opposite pairs resolve to n / w) ->
 * inner corner (missing diagonal; ine, inw, ise, isw order) -> centre.
 * The W side wins ties on both steps, so 1-wide vertical strips keep one
 * consistent border (w edge, nw / sw ends) and horizontal ones the n border.
 */
export function resolveTerrainTile(terrain: Terrain, mask: number): number {
  const n = (mask & NB.N) !== 0;
  const e = (mask & NB.E) !== 0;
  const s = (mask & NB.S) !== 0;
  const w = (mask & NB.W) !== 0;
  if (!n && !w) return terrain.nw;
  if (!n && !e) return terrain.ne;
  if (!s && !w) return terrain.sw;
  if (!s && !e) return terrain.se;
  if (!n) return terrain.n;
  if (!s) return terrain.s;
  if (!w) return terrain.w;
  if (!e) return terrain.e;
  if (!(mask & NB.NE)) return terrain.ine;
  if (!(mask & NB.NW)) return terrain.inw;
  if (!(mask & NB.SE)) return terrain.ise;
  if (!(mask & NB.SW)) return terrain.isw;
  return terrain.center;
}

/** Membership mask around (tx, ty) on terrain.layer. */
export function neighborMask(room: Room, terrain: Terrain, tx: number, ty: number): number {
  const cols = roomCols(room);
  const rows = roomRows(room);
  const layer = room.layers[terrain.layer];
  const pieces = terrainPieces(terrain);
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS) {
    const x = tx + dx;
    const y = ty + dy;
    const outside = x < 0 || y < 0 || x >= cols || y >= rows;
    if (outside || pieces.includes(layer[y * cols + x] ?? 0)) mask |= bit;
  }
  return mask;
}

export interface TileChange { layer: 'bg' | 'fg' | 'over'; tx: number; ty: number; before: number; after: number }

/** Tracks original values of touched cells (per layer) so only real changes are reported. */
class ChangeLog {
  private readonly before = new Map<LayerName, Map<number, number>>();

  constructor(private readonly room: Room) {}

  set(layer: LayerName, index: number, id: number): void {
    const data = this.room.layers[layer];
    let touched = this.before.get(layer);
    if (!touched) {
      touched = new Map();
      this.before.set(layer, touched);
    }
    if (!touched.has(index)) touched.set(index, data[index] ?? 0);
    data[index] = id;
  }

  changes(): TileChange[] {
    const cols = roomCols(this.room);
    const out: TileChange[] = [];
    for (const [layer, touched] of this.before) {
      const data = this.room.layers[layer];
      for (const [index, before] of touched) {
        const after = data[index] ?? 0;
        if (after !== before) out.push({ layer, tx: index % cols, ty: Math.floor(index / cols), before, after });
      }
    }
    return out;
  }
}

/** Indices of the in-room cells among `cells`. */
function cellIndices(room: Room, cells: readonly { tx: number; ty: number }[]): number[] {
  const cols = roomCols(room);
  const rows = roomRows(room);
  return cells
    .filter(({ tx, ty }) => Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < cols && ty < rows)
    .map(({ tx, ty }) => ty * cols + tx);
}

/** The given cell indices plus their in-room 8-neighbours. */
function neighbourhood(room: Room, indices: readonly number[]): Set<number> {
  const cols = roomCols(room);
  const rows = roomRows(room);
  const out = new Set<number>();
  for (const i of indices) {
    const tx = i % cols;
    const ty = Math.floor(i / cols);
    for (let y = Math.max(0, ty - 1); y <= Math.min(rows - 1, ty + 1); y++) {
      for (let x = Math.max(0, tx - 1); x <= Math.min(cols - 1, tx + 1); x++) out.add(y * cols + x);
    }
  }
  return out;
}

/** Re-resolve the terrain cells at the given indices. */
function resolveCells(room: Room, terrain: Terrain, indices: Iterable<number>, log: ChangeLog): void {
  const cols = roomCols(room);
  const layer = room.layers[terrain.layer];
  const pieces = terrainPieces(terrain);
  for (const i of indices) {
    if (!pieces.includes(layer[i] ?? 0)) continue;
    log.set(terrain.layer, i, resolveTerrainTile(terrain, neighborMask(room, terrain, i % cols, Math.floor(i / cols))));
  }
}

/**
 * Paint (or erase -> `eraseTo` tile) terrain membership at the given cells, then
 * re-resolve those cells and their 8 neighbours. Mutates the room; returns the
 * changes (for undo). Cells outside the room are ignored.
 */
export function paintTerrain(
  room: Room, terrain: Terrain, cells: { tx: number; ty: number }[], opts?: { erase?: boolean; eraseTo?: number },
): TileChange[] {
  const layer = room.layers[terrain.layer];
  const pieces = terrainPieces(terrain);
  const log = new ChangeLog(room);
  const indices = cellIndices(room, cells);
  for (const i of indices) {
    if (!opts?.erase) log.set(terrain.layer, i, terrain.center);
    else if (pieces.includes(layer[i] ?? 0)) log.set(terrain.layer, i, opts.eraseTo ?? 0);
  }
  resolveCells(room, terrain, neighbourhood(room, indices), log);
  return log.changes();
}

/**
 * Re-resolve every terrain in `terrains` around the given cells (each cell and its
 * 8 neighbours). Call it after paintTerrain with all the project's terrains so a
 * different terrain next to the painted cells (e.g. water beside freshly painted
 * path) updates its borders too. Mutates the room; returns only real changes.
 */
export function resolveTerrainsAround(
  room: Room, terrains: readonly Terrain[], cells: { tx: number; ty: number }[],
): TileChange[] {
  const affected = neighbourhood(room, cellIndices(room, cells));
  const log = new ChangeLog(room);
  for (const terrain of terrains) resolveCells(room, terrain, affected, log);
  return log.changes();
}

/** Re-resolve every terrain cell in a rect (whole room if omitted). */
export function resolveRoomTerrain(room: Room, terrain: Terrain, rect?: { tx: number; ty: number; w: number; h: number }): TileChange[] {
  const cols = roomCols(room);
  const rows = roomRows(room);
  const x0 = Math.max(0, rect?.tx ?? 0);
  const y0 = Math.max(0, rect?.ty ?? 0);
  const x1 = Math.min(cols, rect ? rect.tx + rect.w : cols);
  const y1 = Math.min(rows, rect ? rect.ty + rect.h : rows);
  const indices: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) indices.push(y * cols + x);
  const log = new ChangeLog(room);
  resolveCells(room, terrain, indices, log);
  return log.changes();
}
