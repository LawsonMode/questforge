// PixelData (hex string) helpers. OWNER: gfx agent. Pure functions (unit-testable in node).
// A frame is w*h lowercase hex digits, row-major; each digit indexes the owning
// asset's palette ('0' = transparent). All helpers are non-mutating (strings).
import type { PixelData } from '../core/types';

const HEX = '0123456789abcdef';

/** Char code -> palette index (0-15); anything that is not a hex digit decodes as 0. */
const DECODE = new Uint8Array(128);
for (let i = 0; i < 16; i++) {
  DECODE[HEX.charCodeAt(i)] = i;
  DECODE[HEX.toUpperCase().charCodeAt(i)] = i;
}

function indexAt(data: string, i: number): number {
  const c = data.charCodeAt(i);
  return c < 128 ? DECODE[c]! : 0;
}

/** A fully transparent w x h frame. */
export function blankFrame(w: number, h: number): PixelData {
  return '0'.repeat(Math.max(0, w * h));
}

/** Decode a frame into w*h palette indices. Missing or malformed digits decode as 0. */
export function decodeFrame(data: PixelData, w: number, h: number): Uint8Array {
  const n = Math.max(0, w * h);
  const out = new Uint8Array(n);
  const len = Math.min(n, data.length);
  for (let i = 0; i < len; i++) out[i] = indexAt(data, i);
  return out;
}

/** Encode palette indices (each masked to 0-15) as PixelData. */
export function encodeFrame(px: ArrayLike<number>): PixelData {
  let s = '';
  for (let i = 0; i < px.length; i++) s += HEX[(px[i]! | 0) & 15];
  return s;
}

/** Palette index at (x, y); 0 outside the frame. */
export function getPixel(data: PixelData, w: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w) return 0;
  const i = y * w + x;
  return i < data.length ? indexAt(data, i) : 0;
}

/** Copy of the frame with (x, y) set to v (masked to 0-15); out-of-range writes return data unchanged. */
export function setPixel(data: PixelData, w: number, x: number, y: number, v: number): PixelData {
  if (x < 0 || y < 0 || x >= w) return data;
  const i = y * w + x;
  if (i >= data.length) return data;
  return data.slice(0, i) + HEX[(v | 0) & 15] + data.slice(i + 1);
}

/** True if data is exactly w*h lowercase hex digits. */
export function isValidFrame(data: string, w: number, h: number): boolean {
  if (typeof data !== 'string' || w <= 0 || h <= 0 || data.length !== w * h) return false;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

/** Rebuild a w x h frame; output pixel (x, y) takes the source pixel at string index src(x, y). */
function remap(data: PixelData, w: number, h: number, src: (x: number, y: number) => number): PixelData {
  let s = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = src(x, y);
      s += i < data.length ? HEX[indexAt(data, i)] : '0';
    }
  }
  return s;
}

/** Mirror horizontally. */
export function flipFrameX(data: PixelData, w: number, h: number): PixelData {
  return remap(data, w, h, (x, y) => y * w + (w - 1 - x));
}

/** Mirror vertically. */
export function flipFrameY(data: PixelData, w: number, h: number): PixelData {
  return remap(data, w, h, (x, y) => (h - 1 - y) * w + x);
}

/** Rotate 90 degrees clockwise (square frames only). */
export function rotateFrameCW(data: PixelData, size: number): PixelData {
  // Output (x, y) comes from source (y, size - 1 - x).
  return remap(data, size, size, (x, y) => (size - 1 - x) * size + y);
}

/** Shift with wrap-around: the pixel at (x, y) moves to (x + dx, y + dy) modulo the frame size. */
export function shiftFrame(data: PixelData, w: number, h: number, dx: number, dy: number): PixelData {
  const mx = ((Math.round(dx) % w) + w) % w;
  const my = ((Math.round(dy) % h) + h) % h;
  return remap(data, w, h, (x, y) => ((y - my + h) % h) * w + ((x - mx + w) % w));
}
