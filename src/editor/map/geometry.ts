// Pure grid helpers for the map editor (no DOM): stroke interpolation,
// rectangles, flood fill, entity snapping and small layer statistics.
import { TILE } from '../../core/constants';

/** A tile cell (column, row). */
export interface Cell { tx: number; ty: number }

/** A rectangle of tiles (inclusive of x..x+w-1, y..y+h-1). */
export interface CellRect { x: number; y: number; w: number; h: number }

/** Cells on the Bresenham line from (ax, ay) to (bx, by), both ends included. */
export function lineCells(ax: number, ay: number, bx: number, by: number): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  for (;;) {
    out.push({ tx: x, ty: y });
    if (x === bx && y === by) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Cells a stroke paints for a new pointer sample: the Bresenham line from the
 * previous sample (already painted, so excluded) to the current one; just the
 * current cell when the stroke starts. Fast mouse moves leave no gaps.
 */
export function strokeCells(prev: Cell | null, cur: Cell): Cell[] {
  if (!prev) return [{ tx: cur.tx, ty: cur.ty }];
  if (prev.tx === cur.tx && prev.ty === cur.ty) return [];
  return lineCells(prev.tx, prev.ty, cur.tx, cur.ty).slice(1);
}

/** Normalised rect spanning two corner cells (both included). */
export function rectBetween(a: Cell, b: Cell): CellRect {
  const x = Math.min(a.tx, b.tx);
  const y = Math.min(a.ty, b.ty);
  return { x, y, w: Math.abs(a.tx - b.tx) + 1, h: Math.abs(a.ty - b.ty) + 1 };
}

/** Intersect a rect with a cols x rows grid; null when nothing is left. */
export function clipRect(r: CellRect, cols: number, rows: number): CellRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(cols, r.x + r.w);
  const y1 = Math.min(rows, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Cells of a rect: all of them, or only its one-tile outline. */
export function rectCells(r: CellRect, outline = false): Cell[] {
  const out: Cell[] = [];
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      const edge = tx === r.x || ty === r.y || tx === r.x + r.w - 1 || ty === r.y + r.h - 1;
      if (!outline || edge) out.push({ tx, ty });
    }
  }
  return out;
}

/** Row-major indices of the 4-connected region of equal ids containing (tx, ty); empty if outside. */
export function floodRegion(data: readonly number[], cols: number, rows: number, tx: number, ty: number): number[] {
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return [];
  const target = data[ty * cols + tx];
  const seen = new Uint8Array(cols * rows);
  const out: number[] = [];
  const stack = [ty * cols + tx];
  seen[ty * cols + tx] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % cols;
    const y = (i - x) / cols;
    const next = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
    for (const n of next) {
      if (n >= 0 && !seen[n] && data[n] === target) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return out;
}

/**
 * Snap one coordinate of an entity centre. Without `step`, footprints spanning
 * an even number of tiles snap to tile edges and odd ones to tile centres (so a
 * 16 px chest lands mid-tile and a 32 px door straddles two tiles); `step`
 * snaps to multiples of that many pixels instead (1 = free).
 */
export function snapAxis(v: number, size: number, step?: number): number {
  if (step !== undefined) return Math.round(v / step) * step;
  const tiles = Math.max(1, Math.round(size / TILE));
  return tiles % 2 === 0 ? Math.round(v / TILE) * TILE : Math.floor(v / TILE) * TILE + TILE / 2;
}

/** Keep a centred footprint of `size` px inside 0..max (centre only, if it cannot fit). */
export function clampAxis(v: number, size: number, max: number): number {
  const half = Math.min(size, max) / 2;
  return Math.min(Math.max(v, Math.ceil(half)), Math.floor(max - half));
}

/** Most frequent id in `data` that `skip` does not reject (0 if none qualifies). */
export function dominantTile(data: readonly number[], skip: (id: number) => boolean = (id) => id === 0): number {
  const counts = new Map<number, number>();
  for (const id of data) if (!skip(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best = 0;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}
