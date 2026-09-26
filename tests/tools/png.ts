// Minimal node-side PNG rendering of palette-indexed assets (no canvas needed).
// Used by tests/tools/sheets.test.ts and available to art agents for previews:
//   import { Raster, writePng, drawFrame, renderScene } from './png';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Palette, PixelData, SpriteDef, TileDef } from '../../src/core/types';

export class Raster {
  readonly data: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: [number, number, number] = [40, 38, 56]) {
    this.data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.data[i * 4] = bg[0];
      this.data[i * 4 + 1] = bg[1];
      this.data[i * 4 + 2] = bg[2];
      this.data[i * 4 + 3] = 255;
    }
  }

  set(x: number, y: number, r: number, g: number, b: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
  }

  fill(x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, rgb[0], rgb[1], rgb[2]);
  }

  /** Checkerboard backdrop (to judge transparency). */
  checker(x: number, y: number, w: number, h: number, size = 4): void {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const c = ((Math.floor(xx / size) + Math.floor(yy / size)) & 1) === 0 ? 70 : 90;
        this.set(x + xx, y + yy, c, c, c + 12);
      }
    }
  }
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Draw a palette-indexed frame at (x, y) with integer scale; index 0 is transparent. */
export function drawFrame(r: Raster, data: PixelData, w: number, h: number, pal: Palette, x: number, y: number, scale = 1, flipX = false): void {
  const cols = pal.colors.map(hex);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const sx = flipX ? w - 1 - px : px;
      const v = parseInt(data[py * w + sx] ?? '0', 16);
      if (!v) continue;
      const [cr, cg, cb] = cols[v]!;
      for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) r.set(x + px * scale + xx, y + py * scale + yy, cr, cg, cb);
    }
  }
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(r: Raster): Uint8Array {
  const raw = new Uint8Array((r.w * 4 + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    raw[y * (r.w * 4 + 1)] = 0;
    raw.set(r.data.subarray(y * r.w * 4, (y + 1) * r.w * 4), y * (r.w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.w);
  dv.setUint32(4, r.h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function writePng(path: string, r: Raster): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(r));
}

/**
 * Render a tile scene: layers is { bg, fg, over } arrays of cols*rows tile ids
 * (missing layers = empty). Draws at `scale`. Animated tiles use `frame`.
 */
export function renderScene(
  tiles: TileDef[], palettes: Palette[], layers: { bg?: number[]; fg?: number[]; over?: number[] },
  cols: number, rows: number, scale = 2, frame = 0,
): Raster {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const pals = new Map(palettes.map((p) => [p.id, p]));
  const r = new Raster(cols * 16 * scale, rows * 16 * scale, [0, 0, 0]);
  for (const layer of [layers.bg, layers.fg, layers.over]) {
    if (!layer) continue;
    for (let i = 0; i < cols * rows; i++) {
      const t = byId.get(layer[i] ?? 0);
      if (!t) continue;
      const pal = pals.get(t.palette);
      if (!pal) continue;
      const f = t.frames[frame % t.frames.length]!;
      drawFrame(r, f, 16, 16, pal, (i % cols) * 16 * scale, Math.floor(i / cols) * 16 * scale, scale);
    }
  }
  return r;
}

/** Render every anim of a sprite as rows of frames (checkerboard backdrop). Returns raster + row labels. */
export function renderSpriteSheet(s: SpriteDef, palettes: Palette[], scale = 4, paletteOverride?: string): { raster: Raster; rows: string[] } {
  const pal = palettes.find((p) => p.id === (paletteOverride ?? s.palette));
  const names = Object.keys(s.anims);
  const maxFrames = Math.max(1, ...names.map((n) => s.anims[n]!.frames.length));
  const cw = s.w * scale + 4;
  const ch = s.h * scale + 4;
  const r = new Raster(Math.max(1, maxFrames) * cw + 4, Math.max(1, names.length) * ch + 4);
  names.forEach((n, row) => {
    const a = s.anims[n]!;
    a.frames.forEach((fi, col) => {
      const x = 4 + col * cw;
      const y = 4 + row * ch;
      r.checker(x, y, s.w * scale, s.h * scale, scale * 2);
      if (pal) drawFrame(r, s.frames[fi] ?? '', s.w, s.h, pal, x, y, scale, !!a.flipX);
    });
  });
  return { raster: r, rows: names };
}
