// Shared authoring helpers for the core sprite art (hero, fx, items, objects, UI).
// Pure: builds PixelGrids and SpriteDefs, no DOM.
import type { PixelData, SpriteDef } from '../../core/types';
import { spriteSpec } from '../ids';
import { PixelGrid } from './pixelgrid';
import { spriteDefFromSpec } from './build';

/** Character -> palette index map for ASCII pixel art ('.' is always transparent). */
export type Legend = Readonly<Record<string, number>>;

/**
 * Parse ASCII pixel art with a strict legend: every character must be '.' or a
 * legend key (unlike PixelGrid.rows, stray hex digits are rejected).
 */
export function pix(rows: readonly string[], legend: Legend): PixelGrid {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x]!;
      if (c !== '.' && !(c in legend)) throw new Error(`pix: char "${c}" at ${x},${y} is not in the legend`);
    }
  });
  return PixelGrid.rows(rows, legend);
}

/** A grid placed at (x, y) inside a larger frame. */
export interface Layer {
  g: PixelGrid;
  x: number;
  y: number;
  /** Outline index drawn around the part where it overlaps pixels already in the frame. */
  ring?: number;
}

/** Shorthand for a positioned layer. */
export function at(g: PixelGrid, x: number, y: number, ring?: number): Layer {
  return ring === undefined ? { g, x, y } : { g, x, y, ring };
}

/** Draw `ring` on frame pixels that are 4-adjacent to the part but not covered by it. */
function ringUnder(dst: PixelGrid, l: Layer, ring: number): void {
  const { g, x, y } = l;
  for (let py = -1; py <= g.h; py++) {
    for (let px = -1; px <= g.w; px++) {
      if (g.get(px, py) !== 0) continue;
      const touches = g.get(px - 1, py) || g.get(px + 1, py) || g.get(px, py - 1) || g.get(px, py + 1);
      if (touches && dst.get(x + px, y + py) !== 0) dst.set(x + px, y + py, ring);
    }
  }
}

/**
 * Add a 1px silhouette outline in index `v`: every transparent pixel 4-adjacent to a FILL pixel (not
 * transparent and not already `v`). Outline pixels drawn earlier (rings, hand-drawn edges) therefore
 * become the silhouette edge themselves instead of getting a second, 2px-thick rim.
 */
export function outlineFill(g: PixelGrid, v: number): PixelGrid {
  const src = g.clone();
  const fill = (x: number, y: number): boolean => {
    const c = src.get(x, y);
    return c !== 0 && c !== v;
  };
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (src.get(x, y) === 0 && (fill(x - 1, y) || fill(x + 1, y) || fill(x, y - 1) || fill(x, y + 1))) g.set(x, y, v);
    }
  }
  return g;
}

/**
 * Stack layers (first = bottom) onto a w x h frame. When `outline` is given, a
 * 1px silhouette outline in that index is added around the result (outlineFill).
 */
export function compose(w: number, h: number, layers: readonly (Layer | null | undefined)[], outline?: number): PixelGrid {
  const g = new PixelGrid(w, h);
  for (const l of layers) {
    if (!l) continue;
    if (l.ring !== undefined) ringUnder(g, l, l.ring);
    g.blit(l.g, l.x, l.y);
  }
  return outline === undefined ? g : outlineFill(g, outline);
}

/** The same layers moved by (dx, dy). */
export function shifted(layers: readonly Layer[], dx: number, dy = 0): Layer[] {
  return layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
}

/** Grid of size w x h with `src` centred in it (rounded towards the top-left). */
export function centred(src: PixelGrid, w = 16, h = 16, dx = 0, dy = 0): PixelGrid {
  return new PixelGrid(w, h).blit(src, Math.floor((w - src.w) / 2) + dx, Math.floor((h - src.h) / 2) + dy);
}

/** Copy of `g` with every index remapped through `map` (unlisted indices unchanged). */
export function recolor(g: PixelGrid, map: Readonly<Record<number, number>>): PixelGrid {
  const out = g.clone();
  for (let i = 0; i < out.px.length; i++) {
    const to = map[out.px[i]!];
    if (to !== undefined) out.px[i] = to;
  }
  return out;
}

/**
 * Collects de-duplicated frames and anim -> frame-index lists for one sprite,
 * then turns them into a SpriteDef via spriteDefFromSpec.
 */
export class SpriteBuilder {
  readonly frames: PixelData[] = [];
  readonly anims: Record<string, number[]> = {};
  private readonly index = new Map<string, number>();

  constructor(readonly id: string, readonly paletteId: string) {}

  /** Add (or reuse) a frame; returns its index. */
  frame(g: PixelGrid): number {
    const data = g.toData();
    let i = this.index.get(data);
    if (i === undefined) {
      i = this.frames.length;
      this.frames.push(data);
      this.index.set(data, i);
    }
    return i;
  }

  /** Define an anim from its frames (in play order). */
  anim(name: string, frames: readonly PixelGrid[]): this {
    this.anims[name] = frames.map((g) => this.frame(g));
    return this;
  }

  build(): SpriteDef {
    const spec = spriteSpec(this.id);
    if (!spec) throw new Error(`SpriteBuilder: unknown sprite "${this.id}"`);
    return spriteDefFromSpec(spec, this.paletteId, this.frames, this.anims);
  }
}
