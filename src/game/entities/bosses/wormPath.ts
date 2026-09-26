// Giant worm body geometry (pure; unit-tested): the head's recent path as a
// polyline, sampled by arc length so every segment trails the one before it
// exactly along the ground the head covered. Allocation-free per tick: the
// points live in two coordinate arrays that are compacted now and then.
// OWNER: bosses agent.
import type { Vec } from '../../../core/math';

/** Arc-length gap (px) between the head and the first body segment. */
export const HEAD_GAP = 15;
/** Gap between two body segments. */
export const BODY_GAP = 13;
/** Gap between the last body segment and the tail. */
export const TAIL_GAP = 11;

/** Dropped points kept at the front of the arrays before they are compacted. */
const COMPACT_AT = 64;

/**
 * Distance (px, along the path) of each part behind the head: `bodyCount` body
 * segments followed by the tail (the last entry).
 */
export function wormOffsets(bodyCount: number): number[] {
  const out: number[] = [];
  let d = HEAD_GAP;
  for (let i = 0; i < bodyCount; i++) {
    out.push(d);
    d += BODY_GAP;
  }
  out.push(d - BODY_GAP + TAIL_GAP);
  return out;
}

/**
 * The head's trail: points oldest-first, trimmed so it stays just longer than
 * `keep` px. sample(d) returns the point `d` px back along it from the newest.
 */
export class WormPath {
  /** Point coordinates; the live points are [start, xs.length). */
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private start = 0;
  /** Length of the whole polyline (px). */
  private total = 0;
  private readonly keep: number;

  constructor(keep: number) {
    this.keep = keep;
  }

  /** Current polyline length (px). */
  get length(): number {
    return this.total;
  }

  /** Straight trail of `keep` px ending at (x, y), running back along the unit vector (bx, by). */
  reset(x: number, y: number, bx: number, by: number, clampPoint: (p: Vec) => Vec = (p) => p): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.start = 0;
    this.total = 0;
    const steps = Math.max(1, Math.ceil(this.keep / 4));
    for (let i = steps; i >= 0; i--) {
      const d = (this.keep * i) / steps;
      const p = clampPoint({ x: x + bx * d, y: y + by * d });
      this.push(p.x, p.y);
    }
  }

  /** Record the head's new position (ignored if it has not moved). */
  push(x: number, y: number): void {
    const n = this.xs.length;
    if (n > this.start) {
      const d = Math.hypot(x - this.xs[n - 1]!, y - this.ys[n - 1]!);
      if (d < 1e-6) return;
      this.total += d;
    }
    this.xs.push(x);
    this.ys.push(y);
    this.trim();
  }

  /** Point `d` px back along the trail from the newest point (the oldest point if the trail is shorter). */
  sample(d: number): Vec {
    const out = { x: 0, y: 0 };
    this.sampleInto(d, out);
    return out;
  }

  /** sample(d) written into `out` (e.g. straight into a part's position). */
  sampleInto(d: number, out: { x: number; y: number }): void {
    const { xs, ys, start } = this;
    const n = xs.length;
    if (n <= start) {
      out.x = 0;
      out.y = 0;
      return;
    }
    let left = Math.max(0, d);
    for (let i = n - 1; i > start; i--) {
      const ax = xs[i]!;
      const ay = ys[i]!;
      const bx = xs[i - 1]!;
      const by = ys[i - 1]!;
      const seg = Math.hypot(ax - bx, ay - by);
      if (left <= seg) {
        const t = seg > 0 ? left / seg : 0;
        out.x = ax + (bx - ax) * t;
        out.y = ay + (by - ay) * t;
        return;
      }
      left -= seg;
    }
    out.x = xs[start]!;
    out.y = ys[start]!;
  }

  /** Drop the oldest points while the rest still covers `keep` px. */
  private trim(): void {
    const { xs, ys } = this;
    while (xs.length - this.start > 2) {
      const s = this.start;
      const first = Math.hypot(xs[s + 1]! - xs[s]!, ys[s + 1]! - ys[s]!);
      if (this.total - first < this.keep) break;
      this.total -= first;
      this.start++;
    }
    if (this.start >= COMPACT_AT) this.compact();
  }

  /** Move the live points back to the front of the arrays. */
  private compact(): void {
    const s = this.start;
    this.xs.copyWithin(0, s);
    this.ys.copyWithin(0, s);
    this.xs.length -= s;
    this.ys.length -= s;
    this.start = 0;
  }
}
