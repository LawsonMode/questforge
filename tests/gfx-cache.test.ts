import { beforeAll, describe, expect, it } from 'vitest';
import type { Project, SpriteDef, TileDef } from '../src/core/types';
import { AssetCache, animFrameIndex } from '../src/gfx/imageCache';
import { makePalette } from '../src/gfx/palette';

// Minimal canvas fake: records the RGBA written by putImageData.
class FakeContext {
  imageSmoothingEnabled = true;
  pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
  draws: unknown[][] = [];
  translations: number[][] = [];
  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(img: { data: Uint8ClampedArray }): void {
    this.pixels = img.data;
  }
  drawImage(...args: unknown[]): void {
    this.draws.push(args);
  }
  save(): void {}
  restore(): void {}
  translate(x: number, y: number): void {
    this.translations.push([x, y]);
  }
  scale(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly ctx = new FakeContext();
  getContext(): FakeContext {
    return this.ctx;
  }
}

function rgbaAt(c: HTMLCanvasElement | null, x: number, y: number): number[] {
  const f = c as unknown as FakeCanvas;
  const i = (y * f.width + x) * 4;
  return Array.from(f.ctx.pixels.slice(i, i + 4));
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeCanvas() };
});

function tile(id: number, frames: string[], extra: Partial<TileDef> = {}): TileDef {
  return { id, key: `T${id}`, name: `Tile ${id}`, palette: 'pal.a', frames, collision: 'floor', tags: ['test'], ...extra };
}

function makeProject(): Project {
  const hero: SpriteDef = {
    id: 'hero', name: 'Hero', palette: 'pal.a', w: 2, h: 2, ox: 1, oy: 1,
    frames: ['1000', '0200', '0030', '0004'],
    anims: {
      walk: { frames: [0, 1, 2], fps: 12, loop: true },
      once: { frames: [3, 2, 1], fps: 20, loop: false },
      still: { frames: [2], fps: 0, loop: true },
      empty: { frames: [], fps: 8, loop: true },
    },
    tags: ['hero'],
  };
  // Off-centre origin (a sword hilt at x=1 of a 4px frame).
  const sword: SpriteDef = {
    id: 'sword', name: 'Sword', palette: 'pal.a', w: 4, h: 2, ox: 1, oy: 1,
    frames: ['12340000'], anims: { swing: { frames: [0], fps: 0, loop: false } }, tags: [],
  };
  return {
    format: 'questforge', version: 1, id: 'p', name: 'P', author: '', description: '', created: 0, modified: 0,
    settings: { title: 'P', subtitle: '', startHearts: 3, startItems: {}, titleMusic: 'title' },
    palettes: [
      makePalette('pal.a', 'A', ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff']),
      makePalette('pal.b', 'B', ['#000000', '#101010', '#202020', '#303030', '#404040']),
    ],
    tiles: [
      tile(1, ['1'.repeat(256)]),
      tile(2, ['1'.repeat(256), '2'.repeat(256), '3'.repeat(256)], { frameTime: 0.5 }),
      tile(3, ['1'.repeat(256), '2'.repeat(256)]),
      tile(4, ['1'.repeat(256)], { palette: 'pal.missing' }),
    ],
    terrains: [], sprites: [hero, sword], worlds: [], dialogues: [], flags: [], start: { world: '', room: '', x: 0, y: 0 },
  };
}

describe('AssetCache: lookups', () => {
  it('returns null for id 0, unknown ids and out-of-range sprite frames', () => {
    const c = new AssetCache(makeProject());
    expect(c.tile(0, 0)).toBeNull();
    expect(c.tile(99, 0)).toBeNull();
    expect(c.sprite('nope', 0)).toBeNull();
    expect(c.spriteFlash('nope', 0)).toBeNull();
    expect(c.sprite('hero', 4)).toBeNull();
    expect(c.sprite('hero', -1)).toBeNull();
    expect(c.animFrame('nope', 'walk', 0)).toBe(-1);
    expect(c.animFrame('hero', 'nope', 0)).toBe(-1);
    expect(c.animFrame('hero', 'empty', 0)).toBe(-1);
  });

  it('caches canvases and wraps tile frame indices', () => {
    const c = new AssetCache(makeProject());
    const t = c.tile(2, 0);
    expect(t).not.toBeNull();
    expect(c.tile(2, 0)).toBe(t);
    expect(c.tile(2, 3)).toBe(t);
    expect(c.tile(2, -3)).toBe(t);
    expect(c.tile(2, 1)).not.toBe(t);
    expect(c.sprite('hero', 1)).toBe(c.sprite('hero', 1));
    expect([t!.width, t!.height]).toEqual([16, 16]);
  });

  it('rasterises palette colours with index 0 transparent', () => {
    const c = new AssetCache(makeProject());
    expect(rgbaAt(c.sprite('hero', 0), 0, 0)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(c.sprite('hero', 0), 1, 0)).toEqual([0, 0, 0, 0]);
    expect(rgbaAt(c.sprite('hero', 3), 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it('applies palette swaps, falls back for unknown swaps and missing palettes', () => {
    const c = new AssetCache(makeProject());
    expect(rgbaAt(c.sprite('hero', 1, 'pal.b'), 1, 0)).toEqual([32, 32, 32, 255]);
    expect(c.sprite('hero', 1, 'pal.nope')).toBe(c.sprite('hero', 1));
    expect(c.sprite('hero', 1, 'pal.a')).toBe(c.sprite('hero', 1));
    expect(rgbaAt(c.tileSwap(1, 0, 'pal.b'), 0, 0)).toEqual([16, 16, 16, 255]);
    // Missing palette: greyscale ramp instead of throwing.
    expect(rgbaAt(c.tile(4, 0), 0, 0)).toEqual([17, 17, 17, 255]);
  });

  it('draws white flash silhouettes', () => {
    const c = new AssetCache(makeProject());
    expect(rgbaAt(c.spriteFlash('hero', 1), 1, 0)).toEqual([255, 255, 255, 255]);
    expect(rgbaAt(c.spriteFlash('hero', 1), 0, 0)).toEqual([0, 0, 0, 0]);
    expect(rgbaAt(c.tileFlash(1, 0), 5, 5)).toEqual([255, 255, 255, 255]);
  });
});

describe('AssetCache: animation timing', () => {
  it('tileFrameAt uses frameTime (default 0.25 s) and wraps', () => {
    const c = new AssetCache(makeProject());
    expect(c.tileFrameAt(2, 0)).toBe(0);
    expect(c.tileFrameAt(2, 0.49)).toBe(0);
    expect(c.tileFrameAt(2, 0.5)).toBe(1);
    expect(c.tileFrameAt(2, 1.5)).toBe(0);
    expect(c.tileFrameAt(3, 0.25)).toBe(1);
    expect(c.tileFrameAt(3, 0.75)).toBe(1);
    expect(c.tileFrameAt(1, 7)).toBe(0);
    expect(c.tileFrameAt(99, 7)).toBe(0);
  });

  it('looping anims wrap, one-shot anims clamp, exact frame boundaries are stable', () => {
    const c = new AssetCache(makeProject());
    expect(c.animFrame('hero', 'walk', 0)).toBe(0);
    expect(c.animFrame('hero', 'walk', 1 / 12)).toBe(1);
    expect(c.animFrame('hero', 'walk', 2 / 12)).toBe(2);
    expect(c.animFrame('hero', 'walk', 3 / 12)).toBe(0);
    expect(c.animFrame('hero', 'walk', (1 / 60) * 15)).toBe(0); // 15 ticks at 60 Hz = 3 frames at 12 fps
    expect(c.animFrame('hero', 'once', 0)).toBe(3);
    expect(c.animFrame('hero', 'once', 0.05)).toBe(2);
    expect(c.animFrame('hero', 'once', 99)).toBe(1);
    expect(c.animFrame('hero', 'once', -1)).toBe(3);
    expect(c.animFrame('hero', 'still', 5)).toBe(2);
  });
});

describe('AssetCache: hostile inputs', () => {
  it('never treats Object.prototype members as anims', () => {
    const c = new AssetCache(makeProject());
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(c.anim('hero', name), name).toBeUndefined();
      expect(c.animFrame('hero', name, 0.5), name).toBe(-1);
    }
  });

  it('normalises non-finite times and frame indices to frame 0', () => {
    const c = new AssetCache(makeProject());
    expect(c.tileFrameAt(2, Number.NaN)).toBe(0);
    expect(c.tileFrameAt(2, Number.POSITIVE_INFINITY)).toBe(0);
    expect(c.tile(2, Number.NaN)).toBe(c.tile(2, 0));
    expect(c.tile(2, Number.NEGATIVE_INFINITY)).toBe(c.tile(2, 0));
    expect(c.animFrame('hero', 'walk', Number.NaN)).toBe(0);
    expect(c.animFrame('hero', 'walk', Number.POSITIVE_INFINITY)).toBe(0);
    expect(c.animFrame('hero', 'once', Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('animFrameIndex works on a bare anim', () => {
    expect(animFrameIndex({ frames: [4, 5], fps: 10, loop: true }, 0.15)).toBe(5);
    expect(animFrameIndex({ frames: [4, 5], fps: 10, loop: true }, 0.2)).toBe(4);
    expect(animFrameIndex({ frames: [], fps: 10, loop: true }, 1)).toBe(-1);
  });
});

describe('AssetCache: invalidation', () => {
  it('invalidateTile picks up in-place frame edits', () => {
    const p = makeProject();
    const c = new AssetCache(p);
    const before = c.tile(1, 0);
    p.tiles[0]!.frames[0] = '2'.repeat(256);
    expect(c.tile(1, 0)).toBe(before);
    c.invalidateTile(1);
    expect(c.tile(1, 0)).not.toBe(before);
    expect(rgbaAt(c.tile(1, 0), 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('invalidateSprite picks up a replaced definition', () => {
    const p = makeProject();
    const c = new AssetCache(p);
    const before = c.sprite('hero', 0);
    p.sprites[0] = { ...p.sprites[0]!, frames: ['4444', '0200', '0030', '0004'] };
    c.invalidateSprite('hero');
    expect(c.sprite('hero', 0)).not.toBe(before);
    expect(rgbaAt(c.sprite('hero', 0), 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it('a palette edit invalidates assets using it as base or swap, and nothing else', () => {
    const p = makeProject();
    const c = new AssetCache(p);
    const heroBase = c.sprite('hero', 0);
    const heroSwap = c.sprite('hero', 0, 'pal.b');
    const tile1 = c.tile(1, 0);
    const flash = c.spriteFlash('hero', 0);
    p.palettes[1]!.colors[1] = '#abcdef';
    c.invalidatePalette('pal.b');
    expect(c.sprite('hero', 0)).toBe(heroBase);
    expect(c.tile(1, 0)).toBe(tile1);
    expect(c.sprite('hero', 0, 'pal.b')).not.toBe(heroSwap);
    expect(rgbaAt(c.sprite('hero', 0, 'pal.b'), 0, 0)).toEqual([0xab, 0xcd, 0xef, 255]);
    p.palettes[0]!.colors[1] = '#010203';
    c.invalidatePalette('pal.a');
    expect(c.sprite('hero', 0)).not.toBe(heroBase);
    expect(c.tile(1, 0)).not.toBe(tile1);
    expect(rgbaAt(c.tile(1, 0), 3, 3)).toEqual([1, 2, 3, 255]);
    expect(c.spriteFlash('hero', 0)).toBe(flash);
  });

  it('notices appended, removed and replaced arrays without explicit invalidation', () => {
    const p = makeProject();
    const c = new AssetCache(p);
    expect(c.tile(1000, 0)).toBeNull();
    p.tiles.push(tile(1000, ['3'.repeat(256)]));
    expect(c.tile(1000, 0)).not.toBeNull();
    const old = c.tile(1, 0);
    p.tiles = p.tiles.map((t) => (t.id === 1 ? { ...t, frames: ['4'.repeat(256)] } : t));
    expect(c.tile(1, 0)).not.toBe(old);
    p.tiles = p.tiles.filter((t) => t.id !== 1000);
    expect(c.tile(1000, 0)).toBeNull();
    p.palettes.push(makePalette('pal.missing', 'Now present', ['#000000', '#00ff00']));
    expect(rgbaAt(c.tile(4, 0), 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('setProject and invalidateAll drop everything', () => {
    const c = new AssetCache(makeProject());
    const t = c.tile(1, 0);
    c.invalidateAll();
    expect(c.tile(1, 0)).not.toBe(t);
    const other = makeProject();
    other.tiles = [];
    c.setProject(other);
    expect(c.project).toBe(other);
    expect(c.tile(1, 0)).toBeNull();
  });
});

describe('AssetCache: editor helpers', () => {
  it('drawTileTo / drawSpriteTo scale and disable smoothing; unknown ids draw nothing', () => {
    const c = new AssetCache(makeProject());
    const ctx = new FakeContext();
    const g = ctx as unknown as CanvasRenderingContext2D;
    c.drawTileTo(g, 2, 4, 8, 3, 0.5);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.draws).toHaveLength(1);
    expect(ctx.draws[0]![0]).toBe(c.tile(2, 1));
    expect(ctx.draws[0]!.slice(1)).toEqual([4, 8, 48, 48]);
    c.drawSpriteTo(g, 'hero', 0, 1, 2, 2);
    expect(ctx.draws[1]!.slice(1)).toEqual([1, 2, 4, 4]);
    c.drawTileTo(g, 99, 0, 0);
    c.drawSpriteTo(g, 'nope', 0, 0, 0);
    expect(ctx.draws).toHaveLength(2);
  });

  it('drawSpriteAt places the origin like the game, mirroring about it', () => {
    const c = new AssetCache(makeProject());
    const ctx = new FakeContext();
    const g = ctx as unknown as CanvasRenderingContext2D;
    // Unflipped: origin (1, 1) at (10, 10) at 2x -> frame box [8, 16) x [8, 12).
    c.drawSpriteAt(g, 'sword', 0, 10, 10, 2);
    expect(ctx.draws[0]!.slice(1)).toEqual([8, 8, 8, 4]);
    // Mirrored about x = 10 -> frame box [4, 12): flipped within that box.
    c.drawSpriteAt(g, 'sword', 0, 10, 10, 2, { flipX: true });
    expect(ctx.translations[0]).toEqual([4 + 8, 8]);
    expect(ctx.draws[1]!.slice(1)).toEqual([0, 0, 8, 4]);
    c.drawSpriteAt(g, 'nope', 0, 0, 0);
    expect(ctx.draws).toHaveLength(2);
  });
});

describe('AssetCache: malformed sizes from imported files', () => {
  it('draws nothing (null) for non-integer, zero or oversized sprite frames instead of throwing', () => {
    const p = makeProject();
    const bad = (id: string, w: number, h: number): SpriteDef => ({ ...p.sprites[0]!, id, w, h });
    p.sprites.push(bad('half', 0.5, 2), bad('zero', 0, 2), bad('huge', 2, 1e7), bad('nan', Number.NaN, 2), bad('big', 65, 64));
    const c = new AssetCache(p);
    for (const id of ['half', 'zero', 'huge', 'nan', 'big']) {
      expect(() => c.sprite(id, 0), id).not.toThrow();
      expect(c.sprite(id, 0), id).toBeNull();
      expect(c.spriteFlash(id, 0), id).toBeNull();
    }
    expect(c.sprite('hero', 0)).not.toBeNull();
  });

  it('treats a canvas that refuses the frame (createImageData throws) as empty', () => {
    const c = new AssetCache(makeProject());
    const orig = FakeContext.prototype.createImageData;
    FakeContext.prototype.createImageData = () => {
      throw new RangeError('Out of memory at ImageData creation');
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(c.sprite('hero', 0)).toBeNull();
    } finally {
      FakeContext.prototype.createImageData = orig;
      console.warn = warn;
    }
  });

  it('never reads a polluted Array.prototype through its per-frame cache', () => {
    const c = new AssetCache(makeProject());
    const proto = Array.prototype as unknown as Record<number, unknown>;
    proto[0] = 'POLLUTED';
    proto[1] = 'POLLUTED';
    try {
      const t = c.tile(1, 0);
      const s = c.sprite('hero', 1);
      expect(t).not.toBe('POLLUTED');
      expect(t).not.toBeNull();
      expect(s).not.toBe('POLLUTED');
      expect(s).not.toBeNull();
    } finally {
      delete proto[0];
      delete proto[1];
    }
  });
});
