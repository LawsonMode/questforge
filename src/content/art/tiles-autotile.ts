// Geometry for 13-piece autotile sets (see Terrain in core/types.ts) and for
// room walls, which are the same shape problem with the floor as "outside".
//
// Every function here is a pure function of the piece shape and the pixel
// coordinate, valid beyond the 0..15 range, so painters can sample neighbours
// across tile borders. Two pieces that meet along an edge always agree there:
// that is what makes painted blobs join without seams.
import { TERRAIN_PARTS } from '../ids';
import { TS } from './tiles-kit';

export type PartSuffix = (typeof TERRAIN_PARTS)[number];
export type Side = 'n' | 's' | 'e' | 'w';
export type Notch = '' | 'ne' | 'nw' | 'se' | 'sw';

/** Which borders of the tile face outside terrain. */
export interface PieceShape {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
  /** Concave corner: only this corner of the tile touches outside terrain. */
  notch: Notch;
}

/** Shape of an autotile piece from its key suffix ('', '_N', ... '_ISW'). */
export function pieceShape(suffix: PartSuffix): PieceShape {
  const p = suffix.replace('_', '').toLowerCase();
  if (p.startsWith('i')) return { n: false, s: false, e: false, w: false, notch: p.slice(1) as Notch };
  return { n: p.includes('n'), s: p.includes('s'), e: p.includes('e'), w: p.includes('w'), notch: '' };
}

/** All 13 shapes in TERRAIN_PARTS order. */
export const PIECES: readonly (readonly [PartSuffix, PieceShape])[] = TERRAIN_PARTS.map((s) => [s, pieceShape(s)] as const);

/** Distance (px, from pixel centre) to a tile edge. */
export function edgeDist(side: Side, x: number, y: number): number {
  switch (side) {
    case 'n': return y + 0.5;
    case 's': return TS - 0.5 - y;
    case 'w': return x + 0.5;
    case 'e': return TS - 0.5 - x;
  }
}

const notchSides = (n: Notch): [Side, Side] => [n[0] as Side, n[1] as Side];

// ---------------------------------------------------------------------------
// Rounded signed distance (organic terrains)
// ---------------------------------------------------------------------------

/**
 * Signed distance into the terrain (negative = outside ground). The outside
 * band is `t` px deep along bordered tile edges; convex corners are rounded with
 * radius `r`, concave notches with radius `rn`.
 */
export function terrainSdf(shape: PieceShape, x: number, y: number, t: number, r: number, rn: number): number {
  if (shape.notch) {
    const [a, b] = notchSides(shape.notch);
    const qa = edgeDist(a, x, y) - (t - rn);
    const qb = edgeDist(b, x, y) - (t - rn);
    return (qa > 0 && qb > 0 ? Math.hypot(qa, qb) : Math.max(qa, qb)) - rn;
  }
  const sides = (['n', 's', 'e', 'w'] as const).filter((s) => shape[s]);
  if (sides.length === 0) return 99;
  if (sides.length === 1) return edgeDist(sides[0]!, x, y) - t;
  const da = edgeDist(sides[0]!, x, y);
  const db = edgeDist(sides[1]!, x, y);
  const c = t + r;
  if (da < c && db < c) return r - Math.hypot(c - da, c - db);
  return Math.min(da, db) - t;
}

/** Unit normal of an SDF (pointing into the terrain) by central differences. */
export function sdfNormal(sdf: (x: number, y: number) => number, x: number, y: number): [number, number] {
  const nx = sdf(x + 1, y) - sdf(x - 1, y);
  const ny = sdf(x, y + 1) - sdf(x, y - 1);
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}

// ---------------------------------------------------------------------------
// Per-side bands (cliffs and room walls)
// ---------------------------------------------------------------------------

/** Band order from the outside in. */
export const OUT = 0;
export const FACE = 1;
export const TOP = 2;
export type Band = typeof OUT | typeof FACE | typeof TOP;

/** Width of the outside strip and of the face strip for each side. */
export interface BandWidths {
  out: Readonly<Record<Side, number>>;
  face: Readonly<Record<Side, number>>;
  /**
   * Optional per-side wobble of the face/top boundary as a function of the
   * coordinate along that side (x for n/s, y for e/w). Must be 16-periodic.
   */
  jag?: Readonly<Partial<Record<Side, (along: number) => number>>>;
}

export interface BandHit {
  band: Band;
  /** Side whose band decided the result (null for pure top). */
  side: Side | null;
  /** Pixels from the top/rim end of the face (0 = the rim next to the top surface). */
  fromRim: number;
  /** Pixels from the outer end of the face (0 = where the face meets the outside). */
  fromBase: number;
}

function sideBand(side: Side, x: number, y: number, w: BandWidths): BandHit {
  const d = Math.floor(edgeDist(side, x, y));
  const o = w.out[side];
  const f = w.face[side] + (w.jag?.[side]?.(side === 'n' || side === 's' ? x : y) ?? 0);
  const band: Band = d < o ? OUT : d < o + f ? FACE : TOP;
  return { band, side, fromRim: o + f - 1 - d, fromBase: d - o };
}

/** Tie-breaks: faces favour the tall south face; outside strips favour the unshaded north. */
const CONVEX_FACE_PRIORITY: Readonly<Record<Side, number>> = { s: 3, e: 2, w: 2, n: 1 };
const CONVEX_OUT_PRIORITY: Readonly<Record<Side, number>> = { n: 3, w: 2, e: 1, s: 0 };
const NOTCH_PRIORITY: Readonly<Record<Side, number>> = { e: 3, w: 3, s: 2, n: 1 };

/**
 * Classify a pixel of a cliff/wall piece. Edges and convex corners take the
 * union of their sides' outside/face strips (the tall south face wins face
 * ties, the north wins outside ties);
 * concave notches take the intersection (the side faces win ties, so a room's
 * side walls run up into the back wall).
 */
export function classifyBands(shape: PieceShape, w: BandWidths, x: number, y: number): BandHit {
  const none: BandHit = { band: TOP, side: null, fromRim: -1, fromBase: 99 };
  if (shape.notch) {
    const [a, b] = notchSides(shape.notch).map((s) => sideBand(s, x, y, w)) as [BandHit, BandHit];
    if (a.band === TOP || b.band === TOP) return none;
    if (a.band !== b.band) return a.band > b.band ? a : b;
    return NOTCH_PRIORITY[a.side!] >= NOTCH_PRIORITY[b.side!] ? a : b;
  }
  const hits = (['n', 's', 'e', 'w'] as const).filter((s) => shape[s]).map((s) => sideBand(s, x, y, w));
  let best = none;
  for (const h of hits) {
    const prio = h.band === OUT ? CONVEX_OUT_PRIORITY : CONVEX_FACE_PRIORITY;
    if (h.band < best.band || (h.band === best.band && best.side && prio[h.side!] > prio[best.side])) best = h;
  }
  return best;
}
