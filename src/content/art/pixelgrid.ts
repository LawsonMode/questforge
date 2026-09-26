// PixelGrid — a tiny palette-index raster for authoring pixel art in code.
// Shared by all art modules. Pure (no DOM); indices 0-15, 0 = transparent.
import type { PixelData } from '../../core/types';
import type { Rng } from '../../core/rng';

const HEX = '0123456789abcdef';

export class PixelGrid {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number, fill = 0) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h).fill(fill);
  }

  /** From an existing PixelData string. */
  static from(data: PixelData, w: number, h: number): PixelGrid {
    const g = new PixelGrid(w, h);
    for (let i = 0; i < w * h; i++) g.px[i] = parseInt(data[i] ?? '0', 16) || 0;
    return g;
  }

  /**
   * From ASCII rows. Each char is a hex digit, or '.'/' ' for 0. All rows must
   * have the same length. Optional `map` translates other chars to indices,
   * e.g. { G: 3, g: 4 }.
   */
  static rows(rows: readonly string[], map: Readonly<Record<string, number>> = {}): PixelGrid {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    const g = new PixelGrid(w, h);
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`PixelGrid.rows: row ${y} has length ${row.length}, expected ${w}`);
      for (let x = 0; x < w; x++) {
        const c = row[x]!;
        if (c in map) g.px[y * w + x] = map[c]!;
        else if (c === '.' || c === ' ') g.px[y * w + x] = 0;
        else {
          const v = HEX.indexOf(c.toLowerCase());
          if (v < 0) throw new Error(`PixelGrid.rows: bad char "${c}" at ${x},${y}`);
          g.px[y * w + x] = v;
        }
      }
    });
    return g;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.px[y * this.w + x]! : 0;
  }

  /** Set a pixel (ignored outside bounds or when v < 0). */
  set(x: number, y: number, v: number): this {
    x = Math.round(x);
    y = Math.round(y);
    if (v >= 0 && this.inBounds(x, y)) this.px[y * this.w + x] = v & 15;
    return this;
  }

  /** Filled rectangle. */
  fill(x: number, y: number, w: number, h: number, v: number): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
    return this;
  }

  /** Rectangle outline. */
  rect(x: number, y: number, w: number, h: number, v: number): this {
    for (let i = 0; i < w; i++) {
      this.set(x + i, y, v);
      this.set(x + i, y + h - 1, v);
    }
    for (let i = 0; i < h; i++) {
      this.set(x, y + i, v);
      this.set(x + w - 1, y + i, v);
    }
    return this;
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, v: number): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, v);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Ellipse centred at (cx, cy) with radii rx, ry (half-pixel centres allowed, e.g. 7.5). */
  ellipse(cx: number, cy: number, rx: number, ry: number, v: number, filled = true): this {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (filled ? d <= 1 : d <= 1 && d > 1 - 2.2 / Math.max(rx, ry)) this.set(x, y, v);
      }
    }
    return this;
  }

  circle(cx: number, cy: number, r: number, v: number, filled = true): this {
    return this.ellipse(cx, cy, r, r, v, filled);
  }

  /** 4-way flood fill from (x, y). */
  flood(x: number, y: number, v: number): this {
    const target = this.get(x, y);
    if (target === v || !this.inBounds(x, y)) return this;
    const stack: [number, number][] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (!this.inBounds(cx, cy) || this.get(cx, cy) !== target) continue;
      this.px[cy * this.w + cx] = v;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return this;
  }

  /** Replace every `from` index with `to`. */
  replace(from: number, to: number): this {
    for (let i = 0; i < this.px.length; i++) if (this.px[i] === from) this.px[i] = to;
    return this;
  }

  /** Copy src onto this grid at (dx, dy); index 0 in src is skipped unless opaque=true. */
  blit(src: PixelGrid, dx: number, dy: number, opaque = false): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const v = src.px[y * src.w + x]!;
        if (v !== 0 || opaque) this.set(dx + x, dy + y, v);
      }
    }
    return this;
  }

  /** Draw index `v` on every transparent pixel 4-adjacent to a non-transparent one (sprite outline). */
  outline(v: number, diagonal = false): this {
    const src = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.get(x, y) !== 0) continue;
        const n = src.get(x - 1, y) || src.get(x + 1, y) || src.get(x, y - 1) || src.get(x, y + 1)
          || (diagonal && (src.get(x - 1, y - 1) || src.get(x + 1, y - 1) || src.get(x - 1, y + 1) || src.get(x + 1, y + 1)));
        if (n) this.set(x, y, v);
      }
    }
    return this;
  }

  /** Randomly set pixels to v with probability p where pred(x, y, current) is true. */
  speckle(rng: Rng, p: number, v: number, pred: (x: number, y: number, cur: number) => boolean = () => true): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (pred(x, y, this.get(x, y)) && rng.next() < p) this.set(x, y, v);
      }
    }
    return this;
  }

  /** Apply fn to every pixel (return a new index, or -1 to leave unchanged). */
  map(fn: (x: number, y: number, cur: number) => number): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = fn(x, y, this.get(x, y));
        if (v >= 0) this.px[y * this.w + x] = v & 15;
      }
    }
    return this;
  }

  clone(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    g.px.set(this.px);
    return g;
  }

  flipX(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.px[y * this.w + x] = this.get(this.w - 1 - x, y);
    return g;
  }

  flipY(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.px[y * this.w + x] = this.get(x, this.h - 1 - y);
    return g;
  }

  /** Rotate 90 degrees clockwise (returns new grid of size h x w). */
  rotateCW(): PixelGrid {
    const g = new PixelGrid(this.h, this.w);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.set(this.h - 1 - y, x, this.get(x, y));
    return g;
  }

  /** Sub-rectangle copy. */
  crop(x: number, y: number, w: number, h: number): PixelGrid {
    const g = new PixelGrid(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) g.px[yy * w + xx] = this.get(x + xx, y + yy);
    return g;
  }

  /** Shift contents by (dx, dy) with wrap-around (useful for seamless tiles / animation). */
  shift(dx: number, dy: number): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        g.px[(((y + dy) % this.h) + this.h) % this.h * this.w + ((((x + dx) % this.w) + this.w) % this.w)] = this.get(x, y);
      }
    }
    return g;
  }

  toData(): PixelData {
    let s = '';
    for (let i = 0; i < this.px.length; i++) s += HEX[this.px[i]!];
    return s;
  }
}
