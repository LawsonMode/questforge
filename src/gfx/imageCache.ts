// Rasterises tiles/sprite frames (palette-indexed PixelData) into cached canvases.
// Shared by the game renderer and every editor canvas. OWNER: gfx agent.
//
// Cache layout: one entry per tile id / sprite id holding lazily-built canvases
// per variant (palette id, or the white "flash" silhouette) and frame index.
// Lookups are allocation-free Map hits, so the renderer can call these every
// frame. Unknown ids never throw: they yield null / draw nothing.
import type { Palette, PixelData, Project, SpriteAnim, SpriteDef, TileDef } from '../core/types';
import { PALETTE_SIZE, TILE } from '../core/constants';
import { originOffsetX } from './layout';
import { paletteRGBA } from './palette';

/** Seconds per frame for animated tiles without an explicit frameTime. */
export const DEFAULT_TILE_FRAME_TIME = 0.25;

/** Variant key of the white hit-flash silhouette (cannot clash with a palette id). */
const FLASH = '\u0000flash';
const WHITE = 0xffffffff;

/** Greyscale ramp used when an asset references a palette that does not exist. */
const FALLBACK_RGBA = (() => {
  const out = new Uint32Array(PALETTE_SIZE);
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const v = Math.round((i / (PALETTE_SIZE - 1)) * 255);
    out[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
  }
  return out;
})();

const HEX_VALUE = new Uint8Array(128);
for (let i = 0; i < 16; i++) HEX_VALUE['0123456789abcdef'.charCodeAt(i)] = i;
for (let i = 10; i < 16; i++) HEX_VALUE['ABCDEF'.charCodeAt(i - 10)] = i;

interface Entry {
  readonly palette: string;
  readonly w: number;
  readonly h: number;
  readonly frames: readonly PixelData[];
  /** Variant key -> canvases per frame (undefined = not rasterised yet, null = empty/invalid). */
  readonly variants: Map<string, (HTMLCanvasElement | null | undefined)[]>;
}

/** Keeps an id -> def index in sync with a project array (rebuilt when the array is replaced or resized). */
class Index<K, V> {
  private map = new Map<K, V>();
  private src: readonly V[] | null = null;
  private len = -1;

  constructor(private readonly keyOf: (v: V) => K) {}

  /** Re-index if `arr` is a different array or changed length; returns true if it did. */
  sync(arr: readonly V[]): boolean {
    if (arr === this.src && arr.length === this.len) return false;
    this.rebuild(arr);
    return true;
  }

  rebuild(arr: readonly V[]): void {
    this.map.clear();
    for (const v of arr) if (!this.map.has(this.keyOf(v))) this.map.set(this.keyOf(v), v);
    this.src = arr;
    this.len = arr.length;
  }

  /** Re-read a single key from the source array (after an in-place edit). */
  refresh(arr: readonly V[], key: K): void {
    const v = arr.find((x) => this.keyOf(x) === key);
    if (v) this.map.set(key, v);
    else this.map.delete(key);
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** i modulo n (always 0..n-1); non-finite i or empty n give 0. */
function wrapIndex(i: number, n: number): number {
  if (!Number.isFinite(i) || !(n > 0)) return 0;
  const k = Math.floor(i) % n;
  return k < 0 ? k + n : k;
}

/** A sprite's own anim by name (never an inherited Object.prototype member such as 'constructor'). */
export function ownAnim(def: SpriteDef, name: string): SpriteAnim | undefined {
  return Object.hasOwn(def.anims, name) ? def.anims[name] : undefined;
}

/**
 * Frame index (into SpriteDef.frames) shown by an anim at time t (s); -1 if it
 * has no frames. Looping anims wrap; others clamp to the last frame. t <= 0,
 * NaN or fps <= 0 show the first frame.
 */
export function animFrameIndex(a: SpriteAnim, t: number): number {
  const n = a.frames.length;
  if (n === 0) return -1;
  if (!(a.fps > 0) || !(t > 0)) return a.frames[0]!;
  if (!Number.isFinite(t)) return a.frames[a.loop ? 0 : n - 1]!;
  const step = Math.floor(t * a.fps + 1e-6);
  return a.frames[a.loop ? step % n : Math.min(step, n - 1)]!;
}

export class AssetCache {
  private proj: Project;
  private readonly tileIdx = new Index<number, TileDef>((t) => t.id);
  private readonly spriteIdx = new Index<string, SpriteDef>((s) => s.id);
  private readonly paletteIdx = new Index<string, Palette>((p) => p.id);
  private readonly tileEntries = new Map<number, Entry>();
  private readonly spriteEntries = new Map<string, Entry>();
  private readonly rgba = new Map<string, Uint32Array>();

  constructor(project: Project) {
    this.proj = project;
    this.reindex();
  }

  get project(): Project {
    return this.proj;
  }

  /** Switch to another project (drops every cached canvas). */
  setProject(p: Project): void {
    this.proj = p;
    this.invalidateAll();
  }

  // ---------------------------------------------------------------- lookups

  /** Tile definition by id (undefined for 0 / unknown). */
  tileDef(id: number): TileDef | undefined {
    this.syncTiles();
    return this.tileIdx.get(id);
  }

  /** Sprite definition by id. */
  spriteDef(id: string): SpriteDef | undefined {
    this.syncSprites();
    return this.spriteIdx.get(id);
  }

  /** Palette by id. */
  paletteDef(id: string): Palette | undefined {
    this.syncPalettes();
    return this.paletteIdx.get(id);
  }

  /** Anim definition of a sprite, or undefined (inherited names like 'constructor' are not anims). */
  anim(spriteId: string, anim: string): SpriteAnim | undefined {
    const def = this.spriteDef(spriteId);
    return def ? ownAnim(def, anim) : undefined;
  }

  // ---------------------------------------------------------------- tiles

  /** 16x16 canvas for a tile frame (frame index wraps), or null for id 0 / unknown. */
  tile(id: number, frame: number): HTMLCanvasElement | null {
    return this.tileVariant(id, frame, null);
  }

  /** Like tile(), drawn with another palette (null = the tile's own palette). */
  tileSwap(id: number, frame: number, palette: string | null): HTMLCanvasElement | null {
    return this.tileVariant(id, frame, palette);
  }

  /** White silhouette of a tile frame. */
  tileFlash(id: number, frame: number): HTMLCanvasElement | null {
    return this.tileVariant(id, frame, FLASH);
  }

  /** Animated frame index of a tile at time t (seconds). */
  tileFrameAt(id: number, t: number): number {
    const def = this.tileDef(id);
    if (!def || def.frames.length <= 1) return 0;
    const ft = def.frameTime !== undefined && def.frameTime > 0 ? def.frameTime : DEFAULT_TILE_FRAME_TIME;
    return wrapIndex(t / ft + 1e-6, def.frames.length);
  }

  private tileVariant(id: number, frame: number, variant: string | null): HTMLCanvasElement | null {
    if (id === 0) return null;
    this.syncTiles();
    this.syncPalettes();
    let e = this.tileEntries.get(id);
    if (!e) {
      const def = this.tileDef(id);
      if (!def || def.frames.length === 0) return null;
      e = this.makeEntry(def.palette, TILE, TILE, def.frames);
      this.tileEntries.set(id, e);
    }
    return this.frameCanvas(e, wrapIndex(frame, e.frames.length), variant === FLASH ? FLASH : this.variantKey(e, variant));
  }

  // ---------------------------------------------------------------- sprites

  /** Canvas (w x h) for a sprite frame with optional palette swap; null if unknown. */
  sprite(spriteId: string, frame: number, palette?: string): HTMLCanvasElement | null {
    const e = this.spriteEntry(spriteId);
    if (!e || frame < 0 || frame >= e.frames.length) return null;
    return this.frameCanvas(e, frame | 0, this.variantKey(e, palette));
  }

  /** White silhouette of a sprite frame (hit flash). */
  spriteFlash(spriteId: string, frame: number): HTMLCanvasElement | null {
    const e = this.spriteEntry(spriteId);
    if (!e || frame < 0 || frame >= e.frames.length) return null;
    return this.frameCanvas(e, frame | 0, FLASH);
  }

  /** Frame index (into SpriteDef.frames) of an anim at time t (seconds); -1 if unknown. Looping anims wrap; others clamp to the last frame. */
  animFrame(spriteId: string, anim: string, t: number): number {
    const a = this.anim(spriteId, anim);
    return a ? animFrameIndex(a, t) : -1;
  }

  private spriteEntry(spriteId: string): Entry | null {
    this.syncSprites();
    this.syncPalettes();
    let e = this.spriteEntries.get(spriteId);
    if (!e) {
      const def = this.spriteDef(spriteId);
      if (!def || !Array.isArray(def.frames) || def.frames.length === 0 || !validFrameSize(def.w, def.h)) return null;
      e = this.makeEntry(def.palette, def.w, def.h, def.frames);
      this.spriteEntries.set(spriteId, e);
    }
    return e;
  }

  // ---------------------------------------------------------------- invalidation

  invalidateTile(id: number): void {
    this.syncTiles();
    this.tileIdx.refresh(this.proj.tiles, id);
    this.tileEntries.delete(id);
  }

  invalidateSprite(id: string): void {
    this.syncSprites();
    this.spriteIdx.refresh(this.proj.sprites, id);
    this.spriteEntries.delete(id);
  }

  /** Invalidate every tile/sprite drawn with this palette (base or swap). */
  invalidatePalette(id: string): void {
    this.syncPalettes();
    this.paletteIdx.refresh(this.proj.palettes, id);
    this.rgba.delete(id);
    for (const map of [this.tileEntries, this.spriteEntries] as Map<unknown, Entry>[]) {
      for (const e of map.values()) {
        if (e.palette === id) {
          for (const key of [...e.variants.keys()]) if (key !== FLASH) e.variants.delete(key);
        } else {
          e.variants.delete(id);
        }
      }
    }
  }

  invalidateAll(): void {
    this.tileEntries.clear();
    this.spriteEntries.clear();
    this.rgba.clear();
    this.reindex();
  }

  // ---------------------------------------------------------------- editor helpers

  /** Draw a tile (animated at time t) with its top-left at (x, y), scaled by an integer factor. */
  drawTileTo(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, scale = 1, t = 0): void {
    const c = this.tile(id, this.tileFrameAt(id, t));
    if (!c) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, x, y, TILE * scale, TILE * scale);
  }

  /**
   * Draw a sprite frame with its TOP-LEFT at (x, y) (not the origin), scaled.
   * flipX mirrors within the frame box (frame editing); use drawSpriteAt for
   * the in-game placement.
   */
  drawSpriteTo(
    ctx: CanvasRenderingContext2D, spriteId: string, frame: number, x: number, y: number,
    scale = 1, opts: { palette?: string; flipX?: boolean } = {},
  ): void {
    const c = this.sprite(spriteId, frame, opts.palette);
    if (!c) return;
    ctx.imageSmoothingEnabled = false;
    const w = c.width * scale;
    const h = c.height * scale;
    if (opts.flipX) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(c, x, y, w, h);
    }
  }

  /**
   * Draw a sprite frame exactly as the game does: its origin lands on (x, y)
   * and flipX mirrors about the origin (see originOffsetX), scaled.
   */
  drawSpriteAt(
    ctx: CanvasRenderingContext2D, spriteId: string, frame: number, x: number, y: number,
    scale = 1, opts: { palette?: string; flipX?: boolean } = {},
  ): void {
    const def = this.spriteDef(spriteId);
    if (!def) return;
    const left = Math.round(x - originOffsetX(def.w, def.ox, !!opts.flipX) * scale);
    this.drawSpriteTo(ctx, spriteId, frame, left, Math.round(y - def.oy * scale), scale, opts);
  }

  // ---------------------------------------------------------------- internals

  private reindex(): void {
    this.tileIdx.rebuild(this.proj.tiles);
    this.spriteIdx.rebuild(this.proj.sprites);
    this.paletteIdx.rebuild(this.proj.palettes);
  }

  /** Tiles array replaced/resized: drop entries whose def is gone or was swapped for another object. */
  private syncTiles(): void {
    if (!this.tileIdx.sync(this.proj.tiles)) return;
    for (const id of [...this.tileEntries.keys()]) {
      const def = this.tileIdx.get(id);
      const e = this.tileEntries.get(id)!;
      if (!def || def.frames !== e.frames || def.palette !== e.palette) this.tileEntries.delete(id);
    }
  }

  private syncSprites(): void {
    if (!this.spriteIdx.sync(this.proj.sprites)) return;
    for (const id of [...this.spriteEntries.keys()]) {
      const def = this.spriteIdx.get(id);
      const e = this.spriteEntries.get(id)!;
      if (!def || def.frames !== e.frames || def.palette !== e.palette || def.w !== e.w || def.h !== e.h) {
        this.spriteEntries.delete(id);
      }
    }
  }

  /** Palettes array replaced/resized: colours may resolve differently now, so drop every coloured canvas. */
  private syncPalettes(): void {
    if (!this.paletteIdx.sync(this.proj.palettes)) return;
    this.rgba.clear();
    for (const map of [this.tileEntries, this.spriteEntries] as Map<unknown, Entry>[]) {
      for (const e of map.values()) for (const key of [...e.variants.keys()]) if (key !== FLASH) e.variants.delete(key);
    }
  }

  /** Palette to draw an entry with: the override if it exists, else the entry's own palette. */
  private variantKey(e: Entry, palette: string | null | undefined): string {
    return palette && palette !== e.palette && this.paletteDef(palette) ? palette : e.palette;
  }

  private makeEntry(palette: string, w: number, h: number, frames: readonly PixelData[]): Entry {
    return { palette, w, h, frames, variants: new Map() };
  }

  private paletteColors(id: string): Uint32Array {
    let c = this.rgba.get(id);
    if (!c) {
      const p = this.paletteDef(id);
      c = p ? paletteRGBA(p) : FALLBACK_RGBA;
      this.rgba.set(id, c);
    }
    return c;
  }

  private frameCanvas(e: Entry, frame: number, variant: string): HTMLCanvasElement | null {
    let list = e.variants.get(variant);
    if (!list) {
      // Filled (not holey): a hole would read through to Array.prototype, so a polluted prototype could never leak in here.
      list = new Array<HTMLCanvasElement | null | undefined>(e.frames.length).fill(undefined);
      e.variants.set(variant, list);
    }
    let c = list[frame];
    if (c === undefined) {
      c = this.rasterise(e.frames[frame] ?? '', e.w, e.h, variant === FLASH ? null : this.paletteColors(variant));
      list[frame] = c;
    }
    return c;
  }

  /**
   * Paint one frame into a new canvas; colors = null paints the white silhouette. Returns null
   * (drawn as nothing) for a size the canvas cannot hold: non-integer, below 1 or above
   * MAX_FRAME_AREA pixels. Imported files can carry any w/h, and one bad sprite must not stop the game.
   */
  private rasterise(data: PixelData, w: number, h: number, colors: Uint32Array | null): HTMLCanvasElement | null {
    if (!validFrameSize(w, h)) return null;
    try {
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const img = ctx.createImageData(w, h);
      const out = new Uint32Array(img.data.buffer);
      const n = Math.min(w * h, typeof data === 'string' ? data.length : 0);
      for (let i = 0; i < n; i++) {
        const code = data.charCodeAt(i);
        const v = code < 128 ? HEX_VALUE[code]! : 0;
        if (v !== 0) out[i] = colors ? colors[v]! : WHITE;
      }
      ctx.putImageData(img, 0, 0);
      return c;
    } catch (err) {
      console.warn(`Questforge: could not draw a ${w}x${h} frame.`, err);
      return null;
    }
  }
}

/** Largest frame the cache rasterises, in pixels (64x64, the art editor's biggest sprite). */
export const MAX_FRAME_AREA = 64 * 64;

/** Whether a w x h frame can be rasterised: whole numbers, at least 1, at most MAX_FRAME_AREA pixels. */
export function validFrameSize(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w * h <= MAX_FRAME_AREA;
}
