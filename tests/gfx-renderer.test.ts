import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, SpriteDef } from '../src/core/types';
import { CanvasRenderer } from '../src/gfx/renderer';
import { DisplaySurface } from '../src/gfx/display';
import { makePalette } from '../src/gfx/palette';

type Matrix = [number, number, number, number, number, number];

/** A drawImage call resolved to its screen-space destination box. */
interface Blit { img: unknown; x: number; y: number; w: number; h: number; mirrored: boolean; ctx: TrackingContext }

const blits: Blit[] = [];
const fills: { x: number; y: number; w: number; h: number; style: string; identity: boolean }[] = [];
let created = 0;

/** Canvas 2D fake that tracks the transform stack (translate/scale/setTransform/save/restore). */
class TrackingContext {
  imageSmoothingEnabled = true;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '';
  m: Matrix = [1, 0, 0, 1, 0, 0];
  private stack: { m: Matrix; alpha: number }[] = [];

  constructor(readonly canvas: FakeCanvas) {}
  save(): void {
    this.stack.push({ m: [...this.m] as Matrix, alpha: this.globalAlpha });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) {
      this.m = s.m;
      this.globalAlpha = s.alpha;
    }
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(sx: number, sy: number): void {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * sx, b * sx, c * sy, d * sy, e, f];
  }
  private box(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    const [a, , , d, e, f] = this.m;
    const x0 = a * x + e;
    const x1 = a * (x + w) + e;
    const y0 = d * y + f;
    const y1 = d * (y + h) + f;
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }
  drawImage(img: { width: number; height: number }, ...r: number[]): void {
    const [x, y, w, h] = r.length >= 8 ? r.slice(4) : [r[0]!, r[1]!, r[2] ?? img.width, r[3] ?? img.height];
    blits.push({ img, ...this.box(x!, y!, w!, h!), mirrored: this.m[0] < 0, ctx: this });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const [a, b, c, d, e, f] = this.m;
    const identity = a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0;
    fills.push({ ...this.box(x, y, w, h), style: String(this.fillStyle), identity });
  }
  clearRect(): void {}
  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(): void {}
}

class FakeCanvas {
  width = 300;
  height = 150;
  style: Record<string, string> = {};
  isConnected = false;
  /** CSS box: follows the backing store unless pinned by style (an intrinsically sized canvas) or fixed via cssSize. */
  cssSize: [number, number] | null = null;
  private readonly ctx = new TrackingContext(this);
  getContext(): TrackingContext {
    return this.ctx;
  }
  get clientWidth(): number {
    return this.cssSize ? this.cssSize[0] : this.style.width ? parseFloat(this.style.width) : this.width;
  }
  get clientHeight(): number {
    return this.cssSize ? this.cssSize[1] : this.style.height ? parseFloat(this.style.height) : this.height;
  }
}

const g = globalThis as { document?: unknown; window?: unknown };

beforeEach(() => {
  blits.length = 0;
  fills.length = 0;
  created = 0;
  g.document = {
    createElement: () => {
      created++;
      return new FakeCanvas();
    },
  };
  g.window = { devicePixelRatio: 1 };
});

afterEach(() => {
  delete g.document;
  delete g.window;
});

function project(): Project {
  const hero: SpriteDef = {
    id: 'hero', name: 'Hero', palette: 'pal.a', w: 16, h: 24, ox: 8, oy: 22,
    frames: ['1'.repeat(16 * 24)], anims: { idle: { frames: [0], fps: 0, loop: true } }, tags: [],
  };
  const sword: SpriteDef = {
    id: 'sword', name: 'Sword', palette: 'pal.a', w: 16, h: 8, ox: 3, oy: 4,
    frames: ['1'.repeat(16 * 8)], anims: {}, tags: [],
  };
  return {
    format: 'questforge', version: 1, id: 'p', name: 'P', author: '', description: '', created: 0, modified: 0,
    settings: { title: 'P', subtitle: '', startHearts: 3, startItems: {}, titleMusic: 'title' },
    palettes: [makePalette('pal.a', 'A', ['#000000', '#ff0000'])],
    tiles: [{ id: 1, key: 'T', name: 'T', palette: 'pal.a', frames: ['1'.repeat(256)], collision: 'floor', tags: [] }],
    terrains: [], sprites: [hero, sword], worlds: [], dialogues: [], flags: [], start: { world: '', room: '', x: 0, y: 0 },
  };
}

function setup(): { r: CanvasRenderer; ctx: TrackingContext; display: FakeCanvas } {
  const display = new FakeCanvas();
  const r = new CanvasRenderer(display as unknown as HTMLCanvasElement, project());
  const ctx = r.ctx as unknown as TrackingContext;
  r.clear();
  blits.length = 0;
  fills.length = 0;
  return { r, ctx, display };
}

const backBlits = (ctx: TrackingContext): Blit[] => blits.filter((b) => b.ctx === ctx);

describe('CanvasRenderer: sprites and transforms', () => {
  it('flipX mirrors about the origin, so off-centre sprites stay anchored', () => {
    const { r, ctx } = setup();
    r.drawSpriteFrame('sword', 0, 100, 50);
    r.drawSpriteFrame('sword', 0, 100, 50, { flipX: true });
    const [plain, flipped] = backBlits(ctx);
    expect([plain!.x, plain!.y, plain!.w, plain!.mirrored]).toEqual([97, 46, 16, false]);
    // Unflipped spans [97, 113) (3px left of the origin); mirrored about x = 100 it spans [87, 103).
    expect([flipped!.x, flipped!.y, flipped!.w, flipped!.mirrored]).toEqual([87, 46, 16, true]);
  });

  it('composes flips with a transform the caller set on ctx and leaves it intact', () => {
    const { r, ctx } = setup();
    r.drawSpriteFrame('hero', 0, 40, 40);
    r.drawSpriteFrame('hero', 0, 40, 40, { flipX: true, flipY: true });
    ctx.save();
    ctx.translate(100, 0);
    r.drawSpriteFrame('hero', 0, 40, 40);
    r.drawSpriteFrame('hero', 0, 40, 40, { flipX: true, flipY: true });
    expect(ctx.m).toEqual([1, 0, 0, 1, 100, 0]);
    ctx.restore();
    const [a, b, c, d] = backBlits(ctx);
    expect(c!.x - a!.x).toBe(100);
    expect(d!.x - b!.x).toBe(100);
    expect([d!.y, d!.w, d!.h]).toEqual([b!.y, b!.w, b!.h]);
  });

  it('keeps alpha multiplied with the caller alpha and restores it', () => {
    const { r, ctx } = setup();
    ctx.globalAlpha = 0.5;
    r.drawSpriteFrame('hero', 0, 40, 40, { alpha: 0.5, flipX: true });
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it('draws a placeholder (never throws) for anims named like Object.prototype members', () => {
    const { r } = setup();
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(() => r.drawSpriteAnim('hero', name, 0, 40, 40)).not.toThrow();
    }
    expect(fills.filter((f) => f.style === '#ff00ff')).toHaveLength(3);
    expect(r.animDuration('hero', 'constructor')).toBe(0);
  });

  it('culls sprites and tiles fully outside the view', () => {
    const { r, ctx } = setup();
    r.drawSpriteFrame('hero', 0, 5000, 40);
    r.drawTile(1, -16, 0);
    r.drawTile(1, 256, 0);
    r.camX = 100;
    r.drawTile(1, 90, 0);
    expect(backBlits(ctx)).toHaveLength(1);
    expect(backBlits(ctx)[0]!.x).toBe(-10);
  });
});

describe('CanvasRenderer: shadows and lights', () => {
  it('keeps a fixed shadow offset under the sprite at sub-pixel positions', () => {
    for (const w of [12, 13]) {
      const { r, ctx } = setup();
      r.camX = 3.4;
      const offsets = new Set<string>();
      for (let i = 0; i <= 10; i++) {
        blits.length = 0;
        const x = 60 + i / 10;
        const y = 80 + i / 10;
        r.drawShadow(x, y, w);
        r.drawSpriteFrame('hero', 0, x, y);
        const [shadow, sprite] = backBlits(ctx);
        offsets.add(`${sprite!.x - shadow!.x},${sprite!.y - shadow!.y}`);
      }
      expect([...offsets], `w=${w}`).toHaveLength(1);
    }
  });

  it('lights bigger than 128px use a scaled stamp and still cover their radius', () => {
    const { r } = setup();
    r.darkness(1, [{ x: 128, y: 112, r: 300 }]);
    const hole = blits.find((b) => b.w > 256)!;
    expect(hole.w).toBe(600);
    expect([hole.x, hole.y]).toEqual([128 - 300, 112 - 300]);
    expect((hole.img as FakeCanvas).width).toBeLessThanOrEqual(256);
  });

  it('keeps recently used light stamps (LRU) when more than 32 radii are in use', () => {
    const { r } = setup();
    r.darkness(1, [{ x: 100, y: 100, r: 10 }]); // creates the darkness canvas + stamp 10
    for (let rad = 11; rad <= 41; rad++) r.darkness(1, [{ x: 100, y: 100, r: rad }]); // cache now full (32)
    r.darkness(1, [{ x: 100, y: 100, r: 10 }]); // hit: 10 becomes most recent
    r.darkness(1, [{ x: 100, y: 100, r: 42 }]); // evicts 11, not 10
    const before = created;
    r.darkness(1, [{ x: 100, y: 100, r: 10 }]);
    expect(created).toBe(before);
    r.darkness(1, [{ x: 100, y: 100, r: 11 }]);
    expect(created).toBe(before + 1);
  });

  it('overlay and darkness cover the whole screen whatever the caller transform', () => {
    const { r, ctx } = setup();
    ctx.translate(30, 10);
    r.overlay('#fff', 0.5);
    r.darkness(0.5, []);
    expect(fills.at(-1)).toMatchObject({ x: 0, y: 0, w: 256, h: 224, identity: true });
    const composite = backBlits(ctx).at(-1)!;
    expect([composite.x, composite.y]).toEqual([0, 0]);
    expect(ctx.m).toEqual([1, 0, 0, 1, 30, 10]);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('DisplaySurface: backing store', () => {
  it('pins an intrinsically sized canvas instead of growing it every frame', () => {
    (g.window as { devicePixelRatio: number }).devicePixelRatio = 2;
    const canvas = new FakeCanvas(); // no CSS size: its CSS box follows its backing store
    const s = new DisplaySurface(canvas as unknown as HTMLCanvasElement);
    const back = new FakeCanvas();
    for (let i = 0; i < 5; i++) s.present(back as unknown as HTMLCanvasElement);
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    expect(canvas.style).toEqual({ width: '300px', height: '150px' });
  });

  it('sizes a CSS-sized canvas to CSS x DPR and centres the integer-scaled image', () => {
    (g.window as { devicePixelRatio: number }).devicePixelRatio = 2;
    const canvas = new FakeCanvas();
    canvas.cssSize = [700, 500];
    const s = new DisplaySurface(canvas as unknown as HTMLCanvasElement);
    const back = new FakeCanvas();
    s.present(back as unknown as HTMLCanvasElement);
    expect([canvas.width, canvas.height]).toEqual([1400, 1000]);
    expect(canvas.style).toEqual({});
    const img = blits.find((b) => b.img === back)!;
    expect([img.x, img.y, img.w, img.h]).toEqual([188, 52, 1024, 896]);
    expect(fills.filter((f) => f.style === '#000')).toHaveLength(4);
    canvas.cssSize = [512, 448];
    (g.window as { devicePixelRatio: number }).devicePixelRatio = 1;
    s.present(back as unknown as HTMLCanvasElement);
    expect([canvas.width, canvas.height]).toEqual([512, 448]);
  });

  it('keeps the current size while the canvas is hidden', () => {
    const canvas = new FakeCanvas();
    canvas.cssSize = [0, 0];
    const s = new DisplaySurface(canvas as unknown as HTMLCanvasElement);
    s.present(new FakeCanvas() as unknown as HTMLCanvasElement);
    expect([canvas.width, canvas.height]).toEqual([300, 150]);
  });
});
