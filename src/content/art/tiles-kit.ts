// Shared toolkit for the default tileset: palette snapping, tileable noise,
// ordered dithering, periodic Voronoi cells, light/shadow helpers and object
// compositing. Everything here is pure and deterministic.
import type { Palette } from '../../core/types';
import { clamp, lerp } from '../../core/math';
import { Rng, hashSeed } from '../../core/rng';
import { palette } from './build';
import { PixelGrid } from './pixelgrid';

/** Tile edge length. */
export const TS = 16;

/** Painted frames for one tile plus the palette they index. */
export interface TileArt {
  pal: string;
  frames: PixelGrid[];
  frameTime?: number;
}

/** Paints one tile; `rng` is seeded from the tile key. */
export type Painter = (rng: Rng) => TileArt;
/** Painters keyed by tile key. */
export type PainterTable = Record<string, Painter>;

/** A scalar field over the tile plane, periodic with the tile size. */
export type Field = (x: number, y: number) => number;

/**
 * Cache a pure field at the integer pixels of the tile plus a `pad` px border (other points
 * are computed as usual). Painters sample the same SDF many times per pixel (normals,
 * 8-neighbour tests), so this removes most of the default tileset's generation time
 * without changing a single pixel.
 */
export function memoField(f: Field, pad = 2): Field {
  const size = TS + 2 * pad;
  const cache = new Float64Array(size * size).fill(Number.NaN);
  return (x, y) => {
    const cx = x + pad;
    const cy = y + pad;
    if ((cx | 0) !== cx || (cy | 0) !== cy || cx < 0 || cy < 0 || cx >= size || cy >= size) return f(x, y);
    const i = cy * size + cx;
    let v = cache[i]!;
    if (Number.isNaN(v)) {
      v = f(x, y);
      cache[i] = v;
    }
    return v;
  };
}

/** Palette index lookup table (index -> replacement index). */
export type Lut = Readonly<Partial<Record<number, number>>>;

/** Shorthand for a TileArt record. */
export const art = (pal: string, frames: PixelGrid[], frameTime?: number): TileArt =>
  frameTime === undefined ? { pal, frames } : { pal, frames, frameTime };

/** Deterministic RNG for a named texture (shared bases must not depend on the caller's RNG). */
export const seeded = (name: string): Rng => new Rng(hashSeed(name));

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** Snap each channel of '#rrggbb' to a multiple of 8 (SNES BGR555 gamut). */
export function snap8(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0]
    .map((s) => Math.min(248, Math.round(((n >> s) & 255) / 8) * 8).toString(16).padStart(2, '0'))
    .join('');
}

/** Tile palette 'pal.t.<name>': index 0 transparent, then up to 15 colours (snapped). */
export function tilePalette(name: string, label: string, colors: readonly string[]): Palette {
  if (colors.length > 15) throw new Error(`palette ${name}: ${colors.length} colours (max 15)`);
  return palette(`pal.t.${name}`, label, ['#000000', ...colors].map(snap8));
}

// ---------------------------------------------------------------------------
// Tileable fields & dithering
// ---------------------------------------------------------------------------

/** Wrap a pixel coordinate into 0..15. */
export const wrap16 = (v: number): number => ((Math.round(v) % TS) + TS) % TS;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable value noise in [0, 1] with a `cells` x `cells` lattice (cells must divide 16). */
export function tileNoise(rng: Rng, cells: number): Field {
  const lat = Array.from({ length: cells * cells }, () => rng.next());
  const at = (i: number, j: number): number => lat[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
  return (x, y) => {
    const fx = (wrap16(x) + 0.5) * cells / TS;
    const fy = (wrap16(y) + 0.5) * cells / TS;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = smooth(fx - i);
    const v = smooth(fy - j);
    return lerp(lerp(at(i, j), at(i + 1, j), u), lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
  };
}

/** Weighted sum of tileable noise octaves, normalised to [0, 1]. */
export function fbm(rng: Rng, octaves: readonly (readonly [cells: number, weight: number])[]): Field {
  const layers = octaves.map(([c, w]) => [tileNoise(rng, c), w] as const);
  const total = octaves.reduce((s, [, w]) => s + w, 0);
  return (x, y) => layers.reduce((s, [f, w]) => s + f(x, y) * w, 0) / total;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4x4 ordered-dither threshold in (0, 1). */
export const bayer = (x: number, y: number): number => (BAYER4[(wrap16(y) & 3) * 4 + (wrap16(x) & 3)]! + 0.5) / 16;

/**
 * Pick an index from `ramp` (dark -> light) for v in [0, 1]. `soft` (0..1) is the
 * width of the ordered-dither band around each step boundary (0 = hard bands).
 */
export function rampAt(v: number, ramp: readonly number[], x: number, y: number, soft = 0.5): number {
  const p = clamp(v, 0, 1) * (ramp.length - 1);
  const base = Math.floor(p);
  const t = 0.5 + (bayer(x, y) - 0.5) * soft;
  return ramp[Math.min(ramp.length - 1, base + (p - base > t ? 1 : 0))]!;
}

/** Two-tone ordered dither: true where `v` (0..1 coverage) wins at (x, y). */
export const dither = (v: number, x: number, y: number): boolean => v > bayer(x, y);

// ---------------------------------------------------------------------------
// Periodic Voronoi cells (flagstones, rock facets, cobbles)
// ---------------------------------------------------------------------------

/** A periodic Voronoi partition of the tile. */
export interface Cells {
  /** Cell id per pixel. */
  id: (x: number, y: number) => number;
  /** Distance to the nearest cell border (second-nearest minus nearest), ~0 on seams. */
  edge: (x: number, y: number) => number;
  /** Offset of the pixel from its cell's seed (wrapped), for per-cell shading. */
  offset: (x: number, y: number) => readonly [number, number];
  count: number;
}

/** Wrapped Voronoi over the tile; `sx`/`sy` weight the distance axes (a weight < 1 elongates cells along that axis). */
export function voronoi(pts: readonly (readonly [number, number])[], sx = 1, sy = 1): Cells {
  const ids = new Uint8Array(256);
  const edges = new Float32Array(256);
  const offs: [number, number][] = [];
  const wd = (d: number): number => {
    const a = ((d % TS) + TS) % TS;
    return a > TS / 2 ? a - TS : a;
  };
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let best = Infinity;
      let second = Infinity;
      let bi = 0;
      let bo: [number, number] = [0, 0];
      pts.forEach(([px, py], i) => {
        const dx = wd(x + 0.5 - px);
        const dy = wd(y + 0.5 - py);
        const d = Math.hypot(dx * sx, dy * sy);
        if (d < best) {
          second = best;
          best = d;
          bi = i;
          bo = [dx, dy];
        } else if (d < second) second = d;
      });
      ids[y * TS + x] = bi;
      edges[y * TS + x] = second - best;
      offs[y * TS + x] = bo;
    }
  }
  const k = (x: number, y: number): number => wrap16(y) * TS + wrap16(x);
  return {
    id: (x, y) => ids[k(x, y)]!,
    edge: (x, y) => edges[k(x, y)]!,
    offset: (x, y) => offs[k(x, y)]!,
    count: pts.length,
  };
}

/** Blue-noise-ish points on the wrapped tile (rejection sampling). */
export function scatter(rng: Rng, count: number, minDist: number, margin = 0): [number, number][] {
  const pts: [number, number][] = [];
  const wd = (a: number, b: number): number => {
    const d = Math.abs(a - b) % TS;
    return Math.min(d, TS - d);
  };
  for (let tries = 0; pts.length < count && tries < count * 60; tries++) {
    const x = margin + rng.next() * (TS - margin * 2);
    const y = margin + rng.next() * (TS - margin * 2);
    if (pts.every(([px, py]) => Math.hypot(wd(px, x), wd(py, y)) >= minDist)) pts.push([x, y]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Light & shading
// ---------------------------------------------------------------------------

const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.55];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((c) => c / l) as [number, number, number];
})();

/** Brightness 0..1 of an ellipsoid surface point given its normalised offset (nx, ny) from the centre. */
export function sphereLight(nx: number, ny: number): number {
  const r2 = nx * nx + ny * ny;
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
  const inv = r2 > 1 ? 1 / Math.sqrt(r2) : 1;
  return clamp(nx * inv * LIGHT[0] + ny * inv * LIGHT[1] + nz * LIGHT[2], 0, 1);
}

/** Brightness 0..1 of a vertical cylinder at normalised horizontal offset nx (-1..1). */
export const cylinderLight = (nx: number): number => sphereLight(nx, -0.15);

/** Remap indices through a LUT wherever `where` holds. */
export function remap(g: PixelGrid, lut: Lut, where: (x: number, y: number) => boolean = () => true): PixelGrid {
  return g.map((x, y, c) => (where(x, y) && lut[c] !== undefined ? lut[c]! : -1));
}

/** Non-transparent test for a grid pixel (out of bounds = transparent). */
export const solidAt = (g: PixelGrid, x: number, y: number): boolean => g.get(x, y) !== 0;

/**
 * Composite `obj` (0 = empty) over a copy of `base`. `shadow` darkens the base
 * through `lut` under the object's silhouette shifted by (dx, dy), plus an
 * optional contact shadow ellipse.
 */
export function composite(
  base: PixelGrid, obj: PixelGrid,
  shadow?: { lut: Lut; dx?: number; dy?: number; ellipse?: readonly [number, number, number, number] },
): PixelGrid {
  const out = base.clone();
  if (shadow) {
    const { lut, dx = 1, dy = 1, ellipse } = shadow;
    const inShadow = (x: number, y: number): boolean => {
      if (solidAt(obj, x - dx, y - dy)) return true;
      if (!ellipse) return false;
      const [ex, ey, rx, ry] = ellipse;
      const nx = (x + 0.5 - ex) / rx;
      const ny = (y + 0.5 - ey) / ry;
      return nx * nx + ny * ny <= 1;
    };
    remap(out, lut, (x, y) => !solidAt(obj, x, y) && inShadow(x, y));
  }
  return out.blit(obj, 0, 0);
}

/** Build a 16x16 grid from a per-pixel function. */
export function paintTile(fn: (x: number, y: number) => number): PixelGrid {
  const g = new PixelGrid(TS, TS);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) g.px[y * TS + x] = fn(x, y) & 15;
  return g;
}

/** Set a pixel with wrap-around (for seamless stamps). */
export function wset(g: PixelGrid, x: number, y: number, v: number): void {
  if (v > 0) g.px[wrap16(y) * TS + wrap16(x)] = v;
}

/** Stamp ASCII rows (hex digits, '.' = skip) with wrap-around at (x, y). */
export function wstamp(g: PixelGrid, rows: readonly string[], x: number, y: number, map: Lut = {}): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = row[dx]!;
      if (c === '.' || c === ' ') continue;
      const v = parseInt(c, 16);
      wset(g, x + dx, y + dy, map[v] ?? v);
    }
  });
}

/** Stamp ASCII rows without wrap (clipped to the grid). */
export function stamp(g: PixelGrid, rows: readonly string[], x: number, y: number, map: Lut = {}): PixelGrid {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = row[dx]!;
      if (c === '.' || c === ' ') continue;
      const v = parseInt(c, 16);
      g.set(x + dx, y + dy, map[v] ?? v);
    }
  });
  return g;
}

/** Split a (16*cols x 16*rows) grid into row-major 16x16 tiles. */
export function slice(g: PixelGrid): PixelGrid[] {
  const out: PixelGrid[] = [];
  for (let ty = 0; ty < g.h / TS; ty++) for (let tx = 0; tx < g.w / TS; tx++) out.push(g.crop(tx * TS, ty * TS, TS, TS));
  return out;
}

/** A round clay pot with a dark mouth (transparent layer, outlined). `ramp` is 4 shades dark -> light. */
export function clayPot(ramp: readonly [number, number, number, number], out: number): PixelGrid {
  const obj = new PixelGrid(TS, TS);
  for (let y = 4; y <= 14; y++) {
    for (let x = 1; x <= 14; x++) {
      const nx = (x + 0.5 - 8) / 6;
      const ny = (y + 0.5 - 9.8) / 5.2;
      if (nx * nx + ny * ny <= 1) obj.set(x, y, rampAt(sphereLight(nx, ny), ramp, x, y, 0.5));
    }
  }
  // Rim and dark mouth, a lit lip on the left.
  for (let x = 4; x <= 11; x++) obj.set(x, 3, ramp[3]).set(x, 4, x < 6 ? ramp[3] : ramp[2]);
  for (let x = 5; x <= 10; x++) obj.set(x, 4, out);
  // Band of decoration around the belly.
  for (let x = 3; x <= 12; x += 2) obj.set(x, 8, ramp[1]);
  return obj.outline(out);
}

/** Colours of a four-step staircase (arrays run from the top step to the bottom step). */
export interface StairStyle {
  /** Front-edge highlight of each tread. */
  nose: readonly number[];
  tread: readonly number[];
  /** Upper and lower riser rows. */
  riser: readonly number[];
  riserDark: readonly number[];
  /** Side walls: width and a pixel painter for columns 0..sideW-1 (left) / mirrored (right, `right` = true). */
  sideW: number;
  side: (x: number, y: number, right: boolean) => number;
}

/** Four steps of 4 px (nose, tread, riser, riser shadow) between two side walls. */
export function staircase(style: StairStyle): PixelGrid {
  return paintTile((x, y) => {
    if (x < style.sideW) return style.side(x, y, false);
    if (x >= TS - style.sideW) return style.side(TS - 1 - x, y, true);
    const k = y >> 2;
    return [style.nose, style.tread, style.riser, style.riserDark][y & 3]![k]!;
  });
}
