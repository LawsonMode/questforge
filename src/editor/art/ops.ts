// Pure pixel-editing operations for the art editor (no DOM, unit-tested in node).
// Frames are edited as decoded Bitmaps (palette indices) and converted from/to
// PixelData with the gfx/pixels helpers; region transforms reuse those helpers.
import type { PixelData } from '../../core/types';
import { decodeFrame, encodeFrame, flipFrameX, flipFrameY, rotateFrameCW, shiftFrame } from '../../gfx/pixels';

export interface Pt { x: number; y: number }
/** Integer pixel rectangle (w, h >= 1 when non-empty). */
export interface Box { x: number; y: number; w: number; h: number }

/** A mutable decoded frame: w*h palette indices, row-major. */
export interface Bitmap { w: number; h: number; px: Uint8Array }

/** Region transforms offered by the toolbar (rotate needs a square region). */
export type RegionTransform = 'flipX' | 'flipY' | 'rotate' | { shift: Pt };

export function toBitmap(data: PixelData, w: number, h: number): Bitmap {
  return { w, h, px: decodeFrame(data, w, h) };
}

export function fromBitmap(b: Bitmap): PixelData {
  return encodeFrame(b.px);
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return { w: b.w, h: b.h, px: b.px.slice() };
}

export function inBounds(b: Bitmap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < b.w && y < b.h;
}

function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h;
}

/** Palette index at (x, y); 0 outside. */
export function pixelAt(b: Bitmap, x: number, y: number): number {
  return inBounds(b, x, y) ? b.px[y * b.w + x]! : 0;
}

/** Normalised box spanning two corner pixels (inclusive). */
export function boxFrom(a: Pt, b: Pt): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/** Intersection of a box with the frame, or null if nothing is left. */
export function clipBox(box: Box, w: number, h: number): Box | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(w, box.x + box.w);
  const y1 = Math.min(h, box.y + box.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Bresenham line from a to b, both endpoints included. */
export function linePoints(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) return out;
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

/** Rectangle with corners a and b: the 1-px outline, or every pixel when filled. */
export function rectPoints(a: Pt, b: Pt, filled: boolean): Pt[] {
  const box = boxFrom(a, b);
  const out: Pt[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const edge = x === box.x || y === box.y || x === box.x + box.w - 1 || y === box.y + box.h - 1;
      if (filled || edge) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Ellipse inscribed in the box spanned by a and b (Zingl's rectangle ellipse,
 * exact for even and odd sizes). Filled ellipses fill each row between its
 * outermost outline pixels.
 */
export function ellipsePoints(a: Pt, b: Pt, filled: boolean): Pt[] {
  const outline = ellipseOutline(boxFrom(a, b));
  if (!filled) return outline;
  const rows = new Map<number, [number, number]>();
  for (const p of outline) {
    const r = rows.get(p.y);
    if (!r) rows.set(p.y, [p.x, p.x]);
    else rows.set(p.y, [Math.min(r[0], p.x), Math.max(r[1], p.x)]);
  }
  const out: Pt[] = [];
  for (const [y, [x0, x1]] of rows) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

function ellipseOutline(box: Box): Pt[] {
  let x0 = box.x;
  let x1 = box.x + box.w - 1;
  const a = x1 - x0;
  const b = box.h - 1;
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let y0 = box.y + Math.floor((b + 1) / 2);
  let y1 = y0 - b1;
  const a8 = 8 * a * a;
  b1 = 8 * b * b;
  const out: Pt[] = [];
  const put = (x: number, y: number): void => {
    out.push({ x, y });
  };
  do {
    put(x1, y0);
    put(x0, y0);
    put(x0, y1);
    put(x1, y1);
    const e2 = 2 * err;
    if (e2 <= dy) {
      y0++;
      y1--;
      dy += a8;
      err += dy;
    }
    if (e2 >= dx || 2 * err > dy) {
      x0++;
      x1--;
      dx += b1;
      err += dx;
    }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    put(x0 - 1, y0);
    put(x1 + 1, y0++);
    put(x0 - 1, y1);
    put(x1 + 1, y1--);
  }
  return dedupe(out);
}

function dedupe(pts: readonly Pt[]): Pt[] {
  const seen = new Set<number>();
  const out: Pt[] = [];
  for (const p of pts) {
    const k = (p.y + 4096) * 8192 + (p.x + 4096);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** The points plus their mirror images across the frame's vertical (mx) and/or horizontal (my) centre line. */
export function mirrorPoints(pts: readonly Pt[], w: number, h: number, mx: boolean, my: boolean): Pt[] {
  if (!mx && !my) return [...pts];
  const out: Pt[] = [];
  for (const p of pts) {
    out.push(p);
    if (mx) out.push({ x: w - 1 - p.x, y: p.y });
    if (my) out.push({ x: p.x, y: h - 1 - p.y });
    if (mx && my) out.push({ x: w - 1 - p.x, y: h - 1 - p.y });
  }
  return dedupe(out);
}

/** Set every in-frame point (inside `mask` when given) to index v. */
export function plot(b: Bitmap, pts: readonly Pt[], v: number, mask: Box | null = null): void {
  for (const p of pts) {
    if (!inBounds(b, p.x, p.y) || (mask && !inBox(mask, p.x, p.y))) continue;
    b.px[p.y * b.w + p.x] = v & 15;
  }
}

/** 4-connected flood fill of the region sharing (x, y)'s index, limited to `mask` when given. */
export function floodFill(b: Bitmap, x: number, y: number, v: number, mask: Box | null = null): void {
  if (!inBounds(b, x, y) || (mask && !inBox(mask, x, y))) return;
  const target = b.px[y * b.w + x]!;
  const value = v & 15;
  if (target === value) return;
  const stack: number[] = [y * b.w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (b.px[i] !== target) continue;
    b.px[i] = value;
    const px = i % b.w;
    const py = (i - px) / b.w;
    const visit = (nx: number, ny: number): void => {
      if (!inBounds(b, nx, ny) || (mask && !inBox(mask, nx, ny))) return;
      const j = ny * b.w + nx;
      if (b.px[j] === target) stack.push(j);
    };
    visit(px + 1, py);
    visit(px - 1, py);
    visit(px, py + 1);
    visit(px, py - 1);
  }
}

/** Copy of the pixels inside a box (the box must lie inside the frame). */
export function extractRegion(b: Bitmap, box: Box): Bitmap {
  const out: Bitmap = { w: box.w, h: box.h, px: new Uint8Array(box.w * box.h) };
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) out.px[y * box.w + x] = pixelAt(b, box.x + x, box.y + y);
  }
  return out;
}

/** Paste `sub` with its top-left at (x, y), clipped to the frame; index-0 pixels are skipped when skipTransparent. */
function pasteRegion(b: Bitmap, sub: Bitmap, x: number, y: number, skipTransparent: boolean): void {
  for (let sy = 0; sy < sub.h; sy++) {
    for (let sx = 0; sx < sub.w; sx++) {
      const v = sub.px[sy * sub.w + sx]!;
      if (skipTransparent && v === 0) continue;
      const tx = x + sx;
      const ty = y + sy;
      if (inBounds(b, tx, ty)) b.px[ty * b.w + tx] = v;
    }
  }
}

/** Set every pixel inside the box to 0 (transparent). */
export function clearRegion(b: Bitmap, box: Box): void {
  plot(b, rectPoints({ x: box.x, y: box.y }, { x: box.x + box.w - 1, y: box.y + box.h - 1 }, true), 0);
}

/** A lifted ("floating") selection: the frame with the region cleared, plus the region's pixels. */
export interface Floating { base: Bitmap; content: Bitmap }

export function liftRegion(b: Bitmap, box: Box): Floating {
  const base = cloneBitmap(b);
  clearRegion(base, box);
  return { base, content: extractRegion(b, box) };
}

/** The base with the floating content dropped at (x, y); transparent content pixels keep the base. */
export function composeFloating(f: Floating, x: number, y: number): Bitmap {
  const out = cloneBitmap(f.base);
  pasteRegion(out, f.content, x, y, true);
  return out;
}

/** Apply a transform to a standalone bitmap via the gfx/pixels helpers (rotate: square only, else unchanged). */
export function transformBitmap(b: Bitmap, op: RegionTransform): Bitmap {
  const data = fromBitmap(b);
  let out: PixelData;
  if (op === 'flipX') out = flipFrameX(data, b.w, b.h);
  else if (op === 'flipY') out = flipFrameY(data, b.w, b.h);
  else if (op === 'rotate') out = b.w === b.h ? rotateFrameCW(data, b.w) : data;
  else out = shiftFrame(data, b.w, b.h, op.shift.x, op.shift.y);
  return toBitmap(out, b.w, b.h);
}

/** Transform the pixels inside a box in place (the whole frame when box is null). */
export function transformRegion(b: Bitmap, box: Box | null, op: RegionTransform): void {
  const region = box ?? { x: 0, y: 0, w: b.w, h: b.h };
  const sub = transformBitmap(extractRegion(b, region), op);
  pasteRegion(b, sub, region.x, region.y, false);
}

/**
 * Re-lay a frame on a new canvas size: source pixel (x, y) lands at (x + dx, y + dy);
 * uncovered pixels are transparent, pixels pushed outside are cropped.
 */
export function resizeFrame(data: PixelData, w: number, h: number, nw: number, nh: number, dx: number, dy: number): PixelData {
  const src = toBitmap(data, w, h);
  const out: Bitmap = { w: nw, h: nh, px: new Uint8Array(nw * nh) };
  pasteRegion(out, src, dx, dy, false);
  return fromBitmap(out);
}

/**
 * Offset that keeps a sprite's art anchored bottom-centre when its frame size
 * changes (frames resized with resizeFrame; the origin moves by the same offset).
 */
export function anchorOffset(w: number, h: number, nw: number, nh: number): Pt {
  return { x: Math.floor((nw - w) / 2), y: nh - h };
}
