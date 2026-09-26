// Free-spot search (pure; unit-tested): the nearest position where a hitbox
// fits. Keeps the hero out of walls after scrolls, warps and respawns, and
// frees them if something solid ends up on top of them; nearestFreeCell is the
// whole-room fallback when nothing fits close by. OWNER: engine agent.
import type { Vec } from '../core/math';

export interface FreeSpotOptions {
  /** Search along this axis first (e.g. along the edge a scroll entered by). */
  along?: 'x' | 'y';
  /** Max px searched along `along` before the ring search (default 32). */
  alongMax?: number;
  /** Largest ring radius (px, square rings) of the general search (default 64). */
  maxRadius?: number;
}

/**
 * Position nearest to (x, y), in whole-pixel offsets, where `isFree` holds:
 * (x, y) itself, else along `opts.along` (+-1..alongMax px), else the closest
 * point on square rings of growing radius. Null when nothing fits.
 */
export function findFreeSpot(
  isFree: (x: number, y: number) => boolean, x: number, y: number, opts: FreeSpotOptions = {},
): Vec | null {
  if (isFree(x, y)) return { x, y };
  const { along, alongMax = 32, maxRadius = 64 } = opts;
  if (along) {
    for (let d = 1; d <= alongMax; d++) {
      for (let s = d; s >= -d; s -= 2 * d) {
        const px = along === 'x' ? x + s : x;
        const py = along === 'y' ? y + s : y;
        if (isFree(px, py)) return { x: px, y: py };
      }
    }
  }
  for (let r = 1; r <= maxRadius; r++) {
    const best = closestOnRing(isFree, x, y, r);
    if (best) return best;
  }
  return null;
}

/**
 * Last resort after findFreeSpot: the free tile centre nearest (x, y) in a
 * room of cols x rows tiles (`tile` px each), or null when not one is free.
 * Bounded (one probe per tile), so a whole room can be searched in one tick.
 */
export function nearestFreeCell(
  isFree: (x: number, y: number) => boolean, x: number, y: number, cols: number, rows: number, tile: number,
): Vec | null {
  const cells: { x: number; y: number; d: number }[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const cx = tx * tile + tile / 2;
      const cy = ty * tile + tile / 2;
      cells.push({ x: cx, y: cy, d: (cx - x) ** 2 + (cy - y) ** 2 });
    }
  }
  cells.sort((a, b) => a.d - b.d);
  for (const c of cells) if (isFree(c.x, c.y)) return { x: c.x, y: c.y };
  return null;
}

/** Closest free point on the square ring of radius `r` around (x, y). */
function closestOnRing(isFree: (x: number, y: number) => boolean, x: number, y: number, r: number): Vec | null {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const step = dy === -r || dy === r ? 1 : 2 * r;
    for (let dx = -r; dx <= r; dx += step) {
      const d = dx * dx + dy * dy;
      if (d < bestD && isFree(x + dx, y + dy)) {
        best = { x: x + dx, y: y + dy };
        bestD = d;
      }
    }
  }
  return best;
}
