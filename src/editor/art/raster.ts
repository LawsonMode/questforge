// Canvas helpers for the art editor: painting decoded bitmaps with a palette
// (live, before the AssetCache sees a commit), checkerboards and thumbnails.
import type { Palette } from '../../core/types';
import { PALETTE_SIZE, TILE } from '../../core/constants';
import type { AssetCache } from '../../gfx/imageCache';
import { paletteRGBA } from '../../gfx/palette';
import type { Bitmap } from './ops';

/** Checkerboard colours behind transparent pixels (match --qf-art-checker-a / -b in art.css). */
const CHECKER_A = '#2a2638';
const CHECKER_B = '#353049';

/** Greyscale ramp for assets whose palette is missing (matches the AssetCache fallback). */
const GREY = (() => {
  const out = new Uint32Array(PALETTE_SIZE);
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const v = Math.round((i / (PALETTE_SIZE - 1)) * 255);
    out[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
  }
  return out;
})();

export function paletteColors(p: Palette | undefined): Uint32Array {
  return p ? paletteRGBA(p) : GREY;
}

const scratch = new Map<string, { canvas: HTMLCanvasElement; img: ImageData }>();

function scratchFor(w: number, h: number): { canvas: HTMLCanvasElement; img: ImageData } | null {
  const key = `${w}x${h}`;
  let s = scratch.get(key);
  if (!s) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    s = { canvas, img: g.createImageData(w, h) };
    scratch.set(key, s);
  }
  return s;
}

/** The bitmap rendered at 1x on a shared scratch canvas (valid until the next call with the same size). */
export function rasterBitmap(b: Bitmap, rgba: Uint32Array): HTMLCanvasElement | null {
  const s = scratchFor(b.w, b.h);
  if (!s) return null;
  const out = new Uint32Array(s.img.data.buffer);
  for (let i = 0; i < b.px.length; i++) out[i] = rgba[b.px[i]!] ?? 0;
  s.canvas.getContext('2d')!.putImageData(s.img, 0, 0);
  return s.canvas;
}

/** Draw a palette-indexed bitmap with its top-left at (x, y), scaled (index 0 stays transparent). */
export function paintBitmap(
  g: CanvasRenderingContext2D, b: Bitmap, rgba: Uint32Array, x: number, y: number, scale: number, alpha = 1,
): void {
  const src = rasterBitmap(b, rgba);
  if (!src) return;
  g.save();
  g.imageSmoothingEnabled = false;
  g.globalAlpha = alpha;
  g.drawImage(src, x, y, b.w * scale, b.h * scale);
  g.restore();
}

/** Checkerboard tiles (2x2 cells) per cell size, and the patterns made from them per context. */
const checkerTiles = new Map<number, HTMLCanvasElement>();
const checkerPatterns = new WeakMap<CanvasRenderingContext2D, Map<number, CanvasPattern>>();

function checkerTile(cell: number): HTMLCanvasElement | null {
  const cached = checkerTiles.get(cell);
  if (cached) return cached;
  const tile = document.createElement('canvas');
  tile.width = tile.height = cell * 2;
  const t = tile.getContext('2d');
  if (!t) return null;
  t.fillStyle = CHECKER_A;
  t.fillRect(0, 0, cell * 2, cell * 2);
  t.fillStyle = CHECKER_B;
  t.fillRect(cell, 0, cell, cell);
  t.fillRect(0, cell, cell, cell);
  checkerTiles.set(cell, tile);
  return tile;
}

function checkerPattern(g: CanvasRenderingContext2D, cell: number): CanvasPattern | null {
  let byCell = checkerPatterns.get(g);
  const cached = byCell?.get(cell);
  if (cached) return cached;
  const tile = checkerTile(cell);
  const pattern = tile ? g.createPattern(tile, 'repeat') : null;
  if (!pattern) return null;
  if (!byCell) checkerPatterns.set(g, (byCell = new Map()));
  byCell.set(cell, pattern);
  return pattern;
}

/** Fill a rect with the editor's transparency checkerboard (cell px squares, aligned to the rect). */
export function fillChecker(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell = 8): void {
  g.save();
  g.imageSmoothingEnabled = false;
  g.translate(x, y);
  g.fillStyle = checkerPattern(g, cell) ?? CHECKER_A;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** A crisp canvas of w x h CSS px (backing store matches, smoothing off). */
export function smallCanvas(w: number, h: number, cls = ''): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = `qf-canvas ${cls}`.trim();
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) g.imageSmoothingEnabled = false;
  return c;
}

/** Redraw a tile thumbnail canvas (frame 0, scaled to fill it). */
export function drawTileThumb(c: HTMLCanvasElement, assets: AssetCache, id: number): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  const tile = assets.tile(id, 0);
  if (!tile) return;
  g.imageSmoothingEnabled = false;
  g.drawImage(tile, 0, 0, c.width, c.height);
}

/** Frame shown as a sprite's thumbnail: its idle anim if any, else the first anim, else frame 0. */
function thumbFrame(assets: AssetCache, id: string): number {
  const def = assets.spriteDef(id);
  if (!def) return 0;
  const names = Object.keys(def.anims);
  const pick = ['idle_down', 'idle', 'closed', 'walk_down'].find((n) => names.includes(n)) ?? names[0];
  const f = pick ? def.anims[pick]?.frames[0] : undefined;
  return f !== undefined && f < def.frames.length ? f : 0;
}

/** Redraw a sprite thumbnail canvas: one frame, integer-scaled to fit, centred. */
export function drawSpriteThumb(c: HTMLCanvasElement, assets: AssetCache, id: string, frame = thumbFrame(assets, id)): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  const def = assets.spriteDef(id);
  if (!def) return;
  const scale = Math.max(1, Math.floor(Math.min(c.width / def.w, c.height / def.h)));
  const x = Math.floor((c.width - def.w * scale) / 2);
  const y = Math.floor((c.height - def.h * scale) / 2);
  assets.drawSpriteTo(g, id, frame, x, y, scale);
}

/** Tile edge in thumbnails (px). */
export const THUMB = TILE * 2;
