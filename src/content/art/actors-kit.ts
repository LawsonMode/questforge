// Shared toolkit for actor sprite art (enemies, bosses, NPCs): one palette
// index layout for every actor, an ASCII legend for authoring pixels, lit
// sphere / cylinder / bevel shaders (light from the top-left), and a frame bank
// that assembles SpriteDefs from the catalog specs.
import type { Palette, PixelData, SpriteDef } from '../../core/types';
import { spriteSpec } from '../ids';
import { palette, spriteDefFromSpec } from './build';
import { PixelGrid } from './pixelgrid';

/** Palette slot of the dark, hue-tinted outline colour. */
export const OUT = 1;
/** Three palette slots forming a colour ramp: [dark, mid, light]. */
export type Ramp = readonly [number, number, number];
export const RAMP_A: Ramp = [2, 3, 4];
export const RAMP_B: Ramp = [5, 6, 7];
export const RAMP_C: Ramp = [8, 9, 10];
export const RAMP_D: Ramp = [11, 12, 13];
export const WHITE = 14;
export const GLOW = 15;

/**
 * ASCII legend used by `art()`: '#' outline, x/a/A = ramp A dark/mid/light,
 * y/b/B = ramp B, z/c/C = ramp C, k/s/S = ramp D (usually skin), w = white,
 * r = glow/special. '.' or ' ' is transparent.
 */
export const LEGEND: Readonly<Record<string, number>> = {
  '#': OUT, x: 2, a: 3, A: 4, y: 5, b: 6, B: 7, z: 8, c: 9, C: 10, k: 11, s: 12, S: 13, w: WHITE, r: GLOW,
};

type Trio = readonly [string, string, string];

/** Colours of one actor palette, matching the slot layout above. */
export interface ActorColors {
  outline: string;
  a: Trio;
  b: Trio;
  c: Trio;
  d: Trio;
  white: string;
  glow: string;
}

/** Build a 16-colour palette from actor colours (index 0 transparent). */
export function actorPalette(id: string, name: string, c: ActorColors): Palette {
  return palette(id, name, ['#000000', c.outline, ...c.a, ...c.b, ...c.c, ...c.d, c.white, c.glow]);
}

/** A palette swap: the base colours with some ramps replaced (same index layout). */
export function swapPalette(id: string, name: string, base: ActorColors, over: Partial<ActorColors>): Palette {
  return actorPalette(id, name, { ...base, ...over });
}

/**
 * Parse ASCII art (see LEGEND). '|' characters are guides (e.g. a centre
 * marker) and are ignored; every row must then be exactly `w` pixels wide.
 */
export function art(w: number, rows: readonly string[]): PixelGrid {
  return PixelGrid.rows(rows.map((raw, i) => {
    const row = raw.replaceAll('|', '');
    if (row.length !== w) throw new Error(`art: row ${i} "${raw}" is ${row.length} px wide, expected ${w}`);
    return row;
  }), LEGEND);
}

/** Copy of `g` translated by (dx, dy) without wrap-around. */
export function moved(g: PixelGrid, dx: number, dy: number): PixelGrid {
  return new PixelGrid(g.w, g.h).blit(g, dx, dy);
}

/** Copy of the first grid with the others blitted on top (no outline). */
export function stack(first: PixelGrid, ...rest: PixelGrid[]): PixelGrid {
  const g = first.clone();
  for (const r of rest) g.blit(r, 0, 0);
  return g;
}

/** Stack layers (later on top) into a new w x h grid and add the 1px outline. */
export function compose(w: number, h: number, layers: readonly (PixelGrid | null | undefined)[], dx = 0, dy = 0): PixelGrid {
  const g = new PixelGrid(w, h);
  for (const l of layers) if (l) g.blit(l, dx, dy);
  return g.outline(OUT);
}

/** Options for the shaders (`sphere`, `cylinder`). */
export interface SphereOpts {
  /** Index for a specular glint on the brightest pixels. */
  hi?: number;
  /** Only paint pixels where this returns true. */
  clip?: (x: number, y: number) => boolean;
  /** Bias added to the light term (-1..1); positive = brighter overall. */
  bias?: number;
}

const LIGHT = ((): [number, number, number] => {
  const v: [number, number, number] = [-0.55, -0.65, 0.55];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/** Quantise a light term to a ramp index (or the specular index). */
function shadeIndex(lum: number, ramp: readonly number[], hi?: number): number {
  if (hi !== undefined && lum > 0.975) return hi;
  const t = Math.min(0.999, Math.max(0, (lum + 0.25) / 1.2));
  return ramp[Math.floor(t * ramp.length)]!;
}

/**
 * Fill an ellipse shaded like a sphere lit from the top-left. `ramp` lists
 * palette indices from darkest to lightest (any length).
 */
export function sphere(g: PixelGrid, cx: number, cy: number, rx: number, ry: number, ramp: readonly number[], opts: SphereOpts = {}): PixelGrid {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1 || (opts.clip && !opts.clip(x, y))) continue;
      const nz = Math.sqrt(1 - d);
      g.set(x, y, shadeIndex(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + (opts.bias ?? 0), ramp, opts.hi));
    }
  }
  return g;
}

/**
 * Fill a rectangle shaded like an upright cylinder (lit from the left), e.g.
 * armoured limbs, torsos and helmets.
 */
export function cylinder(g: PixelGrid, x0: number, y0: number, w: number, h: number, ramp: readonly number[], opts: SphereOpts = {}): PixelGrid {
  for (let x = x0; x < x0 + w; x++) {
    const nx = ((x - x0 + 0.5) / w) * 2 - 1;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx));
    const v = shadeIndex(nx * LIGHT[0] + nz * LIGHT[2] + 0.2 + (opts.bias ?? 0), ramp, opts.hi);
    for (let y = y0; y < y0 + h; y++) if (!opts.clip || opts.clip(x, y)) g.set(x, y, v);
  }
  return g;
}

/**
 * Edge-light a flat-coloured shape: every pixel holding a ramp's mid index
 * becomes light where the shape ends toward the top-left and dark where it
 * ends toward the bottom-right (good for tubes and irregular silhouettes).
 */
export function bevel(g: PixelGrid, ramps: readonly Ramp[]): PixelGrid {
  const src = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const ramp = ramps.find((r) => r[1] === src.get(x, y));
      if (!ramp) continue;
      const lit = src.get(x - 1, y) === 0 || src.get(x, y - 1) === 0 || src.get(x - 1, y - 1) === 0;
      const shade = src.get(x + 1, y) === 0 || src.get(x, y + 1) === 0 || src.get(x + 1, y + 1) === 0;
      if (shade && !lit) g.set(x, y, ramp[0]);
      else if (lit && !shade) g.set(x, y, ramp[2]);
    }
  }
  return g;
}

/** A tiny 4-point twinkle star (plus sign with a bright centre). */
export function star(g: PixelGrid, x: number, y: number, edge: number, core: number): PixelGrid {
  return g.set(x, y - 1, edge).set(x - 1, y, edge).set(x + 1, y, edge).set(x, y + 1, edge).set(x, y, core);
}

/**
 * Collects frames for one sprite (identical frames are stored once) and turns
 * them into a SpriteDef that satisfies the catalog spec.
 */
export class FrameBank {
  readonly frames: PixelData[] = [];
  readonly anims: Record<string, number[]> = {};
  private readonly index = new Map<PixelData, number>();

  /** Append frames to an anim (in order). */
  add(anim: string, ...grids: PixelGrid[]): this {
    const list = (this.anims[anim] ??= []);
    for (const g of grids) {
      const data = g.toData();
      let i = this.index.get(data);
      if (i === undefined) {
        i = this.frames.length;
        this.frames.push(data);
        this.index.set(data, i);
      }
      list.push(i);
    }
    return this;
  }

  /** Build the SpriteDef for catalog sprite `id` using `paletteId`. */
  build(id: string, paletteId: string): SpriteDef {
    const spec = spriteSpec(id);
    if (!spec) throw new Error(`actor art: no sprite spec "${id}"`);
    return spriteDefFromSpec(spec, paletteId, this.frames, this.anims);
  }
}

/** Palettes + sprites contributed by one creature family module. */
export interface ArtSet {
  palettes: Palette[];
  sprites: SpriteDef[];
}
