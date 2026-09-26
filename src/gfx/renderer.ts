// Canvas2D implementation of the engine Renderer. OWNER: gfx agent.
//
// All drawing lands on a 256x224 opaque backbuffer; present() blits it to the
// visible canvas integer-scaled, centred and letterboxed (see DisplaySurface).
// World-space draws subtract the rounded camera; draws entirely outside the
// view are culled. Hot paths allocate nothing: rasterised art, light holes and
// shadows are cached canvases.
//
// Transforms: clear() starts a frame and resets ctx's transform, alpha and
// composite mode. Art, shape and text draws then honour whatever transform the
// caller sets on `ctx` (culling assumes identity). Screen-covering effects
// (overlay, darkness) always cover the whole backbuffer, ignoring it.
import type { Project, SpriteDef } from '../core/types';
import type { DrawOpts, Light, Renderer, TextOpts } from '../game/api';
import { SCREEN_H, SCREEN_W, TILE } from '../core/constants';
import { DisplaySurface } from './display';
import { AssetCache, animFrameIndex, ownAnim } from './imageCache';
import { drawTextAligned, measureText } from './font';
import { lightStampScale, onScreen, originOffsetX, stampLeft } from './layout';

const PLACEHOLDER_FILL = '#ff00ff';
const PLACEHOLDER_EDGE = '#800060';
const TEXT_COLOR = '#ffffff';
const TEXT_SHADOW = '#000';
const DEFAULT_SHADOW_W = 12;
/** Shadow widths are clamped to this range (px). */
const MIN_SHADOW_W = 4;
const MAX_SHADOW_W = SCREEN_W;
/** Stamp caches are bounded (least-recently-used eviction) so animated radii can't grow memory without limit. */
const MAX_STAMPS = 32;

function context2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** LRU lookup: a hit moves the key to the most-recently-used end of the Map's order. */
function recall<K>(map: Map<K, HTMLCanvasElement>, key: K): HTMLCanvasElement | undefined {
  const hit = map.get(key);
  if (hit) {
    map.delete(key);
    map.set(key, hit);
  }
  return hit;
}

/** Insert, evicting the least recently used entry when full. */
function remember<K>(map: Map<K, HTMLCanvasElement>, key: K, c: HTMLCanvasElement): HTMLCanvasElement {
  if (map.size >= MAX_STAMPS) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, c);
  return c;
}

/** Paint a stamp pixel by pixel: alphaAt(dx, dy) gets the offset of each pixel centre from the stamp centre. */
function paintStamp(w: number, h: number, alphaAt: (dx: number, dy: number) => number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alphaAt(x + 0.5 - w / 2, y + 0.5 - h / 2);
      if (a > 0) img.data[(y * w + x) * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class CanvasRenderer implements Renderer {
  readonly width = SCREEN_W;
  readonly height = SCREEN_H;
  camX = 0;
  camY = 0;
  time = 0;

  private readonly surface: DisplaySurface;
  private readonly back: HTMLCanvasElement;
  private readonly backCtx: CanvasRenderingContext2D;
  private readonly cache: AssetCache;
  private darkCanvas: HTMLCanvasElement | null = null;
  private darkCtx: CanvasRenderingContext2D | null = null;
  private darkLevel = -1;
  private darkFill = '';
  private readonly lightStamps = new Map<number, HTMLCanvasElement>();
  private readonly shadowStamps = new Map<number, HTMLCanvasElement>();

  /**
   * `display` is the visible canvas; it must be sized by CSS (e.g. width/height
   * 100% of a sized host) with no padding or border. Drawing happens on a
   * 256x224 backbuffer that present() blits integer-scaled & centred. Pass an
   * existing AssetCache to share rasterised assets (e.g. with the editor).
   */
  constructor(display: HTMLCanvasElement, project: Project, assets?: AssetCache) {
    this.surface = new DisplaySurface(display);
    this.back = makeCanvas(SCREEN_W, SCREEN_H);
    this.backCtx = context2d(this.back, { alpha: false });
    this.cache = assets ?? new AssetCache(project);
    if (assets && assets.project !== project) assets.setProject(project);
  }

  get ctx(): CanvasRenderingContext2D {
    return this.backCtx;
  }

  get assets(): AssetCache {
    return this.cache;
  }

  /** The 256x224 backbuffer canvas (e.g. for thumbnails). */
  get backbuffer(): HTMLCanvasElement {
    return this.back;
  }

  /** Re-fit the display canvas backing size to its CSS box now (size changes are also tracked automatically). */
  resize(): void {
    this.surface.refit();
  }

  /** Stop tracking the display canvas size (call when the renderer is discarded). */
  dispose(): void {
    this.surface.dispose();
  }

  setProject(p: Project): void {
    this.cache.setProject(p);
  }

  /** Start a frame: reset ctx's transform, alpha and composite mode, then fill the backbuffer (default black). */
  clear(color = '#000'): void {
    const ctx = this.backCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // ---------------------------------------------------------------- art

  /** Draw tile `id` (animated by `time`) with its top-left at (x, y). Honours flip, alpha, palette swap and flash. */
  drawTile(id: number, x: number, y: number, opts?: DrawOpts): void {
    if (id === 0) return;
    const dx = Math.round(opts?.screen ? x : x - Math.round(this.camX));
    const dy = Math.round(opts?.screen ? y : y - Math.round(this.camY));
    if (!onScreen(dx, dy, TILE, TILE)) return;
    const frame = this.cache.tileFrameAt(id, this.time);
    const img = opts?.flash
      ? this.cache.tileFlash(id, frame)
      : opts?.palette ? this.cache.tileSwap(id, frame, opts.palette) : this.cache.tile(id, frame);
    if (img) this.blit(img, dx, dy, TILE, TILE, !!opts?.flipX, !!opts?.flipY, opts?.alpha);
  }

  /** Draw a sprite frame so its origin lands at (x, y). Missing sprites draw a magenta placeholder. */
  drawSpriteFrame(spriteId: string, frame: number, x: number, y: number, opts?: DrawOpts): void {
    const def = this.cache.spriteDef(spriteId);
    if (def) this.drawSprite(def, frame, x, y, !!opts?.flipX, opts);
    else this.placeholder(x, y, opts?.screen);
  }

  /** Draw the frame of `anim` at time t. Honours the anim's flipX (XOR opts.flipX). */
  drawSpriteAnim(spriteId: string, anim: string, t: number, x: number, y: number, opts?: DrawOpts): void {
    const def = this.cache.spriteDef(spriteId);
    const a = def ? ownAnim(def, anim) : undefined;
    const frame = a ? animFrameIndex(a, t) : -1;
    if (def && a && frame >= 0) this.drawSprite(def, frame, x, y, !!a.flipX !== !!opts?.flipX, opts);
    else this.placeholder(x, y, opts?.screen);
  }

  /** Duration (s) of one pass through an anim (0 if unknown). */
  animDuration(spriteId: string, anim: string): number {
    const a = this.cache.anim(spriteId, anim);
    return a && a.fps > 0 ? a.frames.length / a.fps : 0;
  }

  /**
   * flipX mirrors about the origin (so a mirrored walk cycle or an off-centre
   * sword stays anchored on the entity); flipY mirrors within the frame box.
   */
  private drawSprite(def: SpriteDef, frame: number, x: number, y: number, flipX: boolean, opts?: DrawOpts): void {
    const screen = opts?.screen;
    const dx = Math.round((screen ? x : x - Math.round(this.camX)) - originOffsetX(def.w, def.ox, flipX));
    const dy = Math.round((screen ? y : y - Math.round(this.camY)) - def.oy);
    if (!onScreen(dx, dy, def.w, def.h)) return;
    const img = opts?.flash ? this.cache.spriteFlash(def.id, frame) : this.cache.sprite(def.id, frame, opts?.palette);
    if (img) this.blit(img, dx, dy, def.w, def.h, flipX, !!opts?.flipY, opts?.alpha);
    else this.placeholder(x, y, screen);
  }

  /** Draw img at (dx, dy), optionally mirrored within its w x h box; flips compose with the caller's transform. */
  private blit(
    img: HTMLCanvasElement, dx: number, dy: number, w: number, h: number,
    flipX: boolean, flipY: boolean, alpha: number | undefined,
  ): void {
    const ctx = this.backCtx;
    const prevAlpha = ctx.globalAlpha;
    if (alpha !== undefined) {
      if (!(alpha > 0)) return;
      if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
    }
    if (flipX || flipY) {
      ctx.save();
      ctx.translate(flipX ? dx + w : dx, flipY ? dy + h : dy);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(img, dx, dy);
    }
    ctx.globalAlpha = prevAlpha;
  }

  /** 8x8 magenta box centred on (x, y) marking a missing sprite / anim / frame. */
  private placeholder(x: number, y: number, screen?: boolean): void {
    const dx = Math.round(screen ? x : x - Math.round(this.camX)) - 4;
    const dy = Math.round(screen ? y : y - Math.round(this.camY)) - 4;
    if (!onScreen(dx, dy, 8, 8)) return;
    const ctx = this.backCtx;
    ctx.fillStyle = PLACEHOLDER_EDGE;
    ctx.fillRect(dx, dy, 8, 8);
    ctx.fillStyle = PLACEHOLDER_FILL;
    ctx.fillRect(dx + 1, dy + 1, 6, 6);
  }

  // ---------------------------------------------------------------- shapes & text

  fillRect(x: number, y: number, w: number, h: number, color: string, opts?: { screen?: boolean; alpha?: number }): void {
    const dx = Math.round(opts?.screen ? x : x - Math.round(this.camX));
    const dy = Math.round(opts?.screen ? y : y - Math.round(this.camY));
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (rw <= 0 || rh <= 0 || !onScreen(dx, dy, rw, rh)) return;
    const ctx = this.backCtx;
    const prevAlpha = ctx.globalAlpha;
    if (opts?.alpha !== undefined) {
      if (!(opts.alpha > 0)) return;
      ctx.globalAlpha = prevAlpha * Math.min(1, opts.alpha);
    }
    ctx.fillStyle = color;
    ctx.fillRect(dx, dy, rw, rh);
    ctx.globalAlpha = prevAlpha;
  }

  /** 1px outline drawn just inside the rect (crisp: built from filled edges, not a stroked path). */
  strokeRect(x: number, y: number, w: number, h: number, color: string, opts?: { screen?: boolean; alpha?: number }): void {
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (rw <= 0 || rh <= 0) return;
    const rx = Math.round(x);
    const ry = Math.round(y);
    this.fillRect(rx, ry, rw, 1, color, opts);
    if (rh > 1) this.fillRect(rx, ry + rh - 1, rw, 1, color, opts);
    if (rh > 2) {
      this.fillRect(rx, ry + 1, 1, rh - 2, color, opts);
      if (rw > 1) this.fillRect(rx + rw - 1, ry + 1, 1, rh - 2, color, opts);
    }
  }

  /** 8x8 bitmap font with a 1px drop shadow (default black at +1,+1). Screen-space unless opts.screen === false. */
  drawText(text: string, x: number, y: number, opts?: TextOpts): void {
    if (!text) return;
    const world = opts?.screen === false;
    const dx = world ? x - Math.round(this.camX) : x;
    const dy = world ? y - Math.round(this.camY) : y;
    const align = opts?.align ?? 'left';
    const shadow = opts?.shadow === undefined ? TEXT_SHADOW : opts.shadow;
    if (shadow) drawTextAligned(this.backCtx, text, dx + 1, dy + 1, shadow, align);
    drawTextAligned(this.backCtx, text, dx, dy, opts?.color ?? TEXT_COLOR, align);
  }

  measureText(text: string): number {
    return measureText(text);
  }

  /**
   * Soft elliptical ground shadow centred at (x, y) world-space, `w` px wide
   * (default 12, clamped to 4..256). The centre is rounded before the stamp is
   * placed, so it keeps a fixed offset to a sprite drawn at the same point.
   */
  drawShadow(x: number, y: number, w = DEFAULT_SHADOW_W): void {
    const sw = Math.max(MIN_SHADOW_W, Math.min(MAX_SHADOW_W, Number.isFinite(w) ? Math.round(w) : DEFAULT_SHADOW_W));
    const img = this.shadowStamp(sw);
    const dx = stampLeft(x - Math.round(this.camX), img.width);
    const dy = stampLeft(y - Math.round(this.camY), img.height);
    if (!onScreen(dx, dy, img.width, img.height)) return;
    this.backCtx.drawImage(img, dx, dy);
  }

  /** Pixel ellipse: a darker core with a lighter rim, ~0.3 alpha overall. */
  private shadowStamp(w: number): HTMLCanvasElement {
    const hit = recall(this.shadowStamps, w);
    if (hit) return hit;
    const h = Math.max(3, Math.round(w * 0.375));
    const rx = w / 2;
    const ry = h / 2;
    const c = paintStamp(w, h, (dx, dy) => {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      return d > 1 ? 0 : d > 0.5 ? 0.22 : 0.36;
    });
    return remember(this.shadowStamps, w, c);
  }

  // ---------------------------------------------------------------- lighting & overlays

  /**
   * Darkness overlay with soft circular light holes (world-space lights), level
   * 0..1. Covers the whole screen regardless of ctx's transform. Any radius
   * works: holes wider than 128px are drawn from a smaller stamp scaled up.
   */
  darkness(level: number, lights: Light[]): void {
    if (!(level > 0)) return;
    const dctx = this.darknessContext();
    if (level !== this.darkLevel) {
      this.darkLevel = level;
      this.darkFill = `rgba(0,0,0,${Math.min(1, level)})`;
    }
    dctx.globalCompositeOperation = 'copy';
    dctx.fillStyle = this.darkFill;
    dctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    dctx.globalCompositeOperation = 'destination-out';
    const cx = Math.round(this.camX);
    const cy = Math.round(this.camY);
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i]!;
      const r = Math.round(l.r);
      if (!(r >= 1)) continue;
      const lx = Math.round(l.x - cx);
      const ly = Math.round(l.y - cy);
      if (!onScreen(lx - r, ly - r, r * 2, r * 2)) continue;
      const k = lightStampScale(r);
      const stamp = this.lightStamp(Math.round(r / k));
      const size = stamp.width * k;
      dctx.drawImage(stamp, lx - (size >> 1), ly - (size >> 1), size, size);
    }
    dctx.globalCompositeOperation = 'source-over';
    this.screenBlit(this.darkCanvas!);
  }

  private darknessContext(): CanvasRenderingContext2D {
    if (!this.darkCtx) {
      this.darkCanvas = makeCanvas(SCREEN_W, SCREEN_H);
      this.darkCtx = context2d(this.darkCanvas);
    }
    return this.darkCtx;
  }

  /** Light hole of radius r: fully clear core, then 4 banded steps of falloff (retro, crisp when scaled). */
  private lightStamp(r: number): HTMLCanvasElement {
    const hit = recall(this.lightStamps, r);
    if (hit) return hit;
    const c = paintStamp(r * 2, r * 2, (dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) return 0;
      if (d <= 0.6) return 1;
      return Math.ceil(((1 - d) / 0.4) * 4) / 4;
    });
    return remember(this.lightStamps, r, c);
  }

  /** Draw a screen-sized canvas at (0, 0), ignoring the caller's transform. */
  private screenBlit(img: HTMLCanvasElement): void {
    const ctx = this.backCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /** Full-screen colour overlay (fades/flashes); covers the whole screen regardless of ctx's transform. */
  overlay(color: string, alpha: number): void {
    if (!(alpha > 0)) return;
    const ctx = this.backCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.restore();
  }

  // ---------------------------------------------------------------- output

  /** Blit the backbuffer to the display canvas, integer-scaled and centred with black bars. */
  present(): void {
    this.surface.present(this.back);
  }
}
