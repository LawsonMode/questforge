// Ledge-hop landing search (pure; unit-tested). A hop only crosses ledges that
// face the hop direction and must come down on free ground past them.
// OWNER: engine agent (wave A), then player agent (wave B).
import type { Dir } from '../../core/types';
import type { RoomRuntime } from '../api';
import { DIR_VEC, type Rect, type Vec } from '../../core/math';
import { probeLedge } from '../world';

/** Furthest the landing search looks past the hopper (px). */
export const HOP_SEARCH = 64;
/** Carry on this far (px) past the first clear spot while it stays free, so the hero lands about a tile past the ledge. */
export const HOP_MARGIN = 10;

export interface HopQuery {
  room: RoomRuntime;
  /** Hitbox centre and size of the hopper (room px). */
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Dir;
  flippers: boolean;
  /** Whether a hitbox centred at (x, y) is free of blocking tiles and solid entities. */
  isFree(x: number, y: number): boolean;
  /** Whether the hopper may come down partly outside the room (a neighbour room lies that way). */
  canLeaveRoom(): boolean;
}

/**
 * Landing spot (hitbox centre) for a hop along `q.dir`, or null when there is no
 * hop: the hitbox must start against a ledge facing `dir`, cross only such
 * ledges, and land on a free spot — not a wall, deep water without flippers or
 * a solid entity, and inside the room unless canLeaveRoom().
 */
export function hopLanding(q: HopQuery): Vec | null {
  const v = DIR_VEC[q.dir];
  const at = (s: number): Vec => ({ x: q.x + v.x * s, y: q.y + v.y * s });
  const rect = (p: Vec): Rect => ({ x: p.x - q.w / 2, y: p.y - q.h / 2, w: q.w, h: q.h });
  const inside = (r: Rect): boolean =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= q.room.width && r.y + r.h <= q.room.height;
  if (probeLedge(q.room, rect(at(1)), q.dir, q.flippers) !== 'ledge') return null;
  for (let s = 2; s <= HOP_SEARCH; s++) {
    const p = at(s);
    const kind = probeLedge(q.room, rect(p), q.dir, q.flippers);
    if (kind === 'ledge') continue;
    if (kind === 'blocked' || !q.isFree(p.x, p.y)) return null;
    if (!inside(rect(p))) return q.canLeaveRoom() ? p : null;
    let end = s;
    while (end - s < HOP_MARGIN) {
      const n = at(end + 1);
      const r = rect(n);
      if (!inside(r) || probeLedge(q.room, r, q.dir, q.flippers) !== 'clear' || !q.isFree(n.x, n.y)) break;
      end++;
    }
    return at(end);
  }
  return null;
}
