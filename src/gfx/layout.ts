// Pure layout maths shared by the renderer, display surface and editor helpers.
// OWNER: gfx agent. No DOM access (unit-tested in node).
import { SCREEN_H, SCREEN_W } from '../core/constants';

/** Largest backing-store dimension (device px) the display canvas is ever given. */
export const MAX_BACKING = 8192;

/** Largest light-hole radius painted 1:1; bigger lights draw a smaller stamp scaled up. */
export const MAX_LIGHT_STAMP_R = 128;

/** Where present() puts the 256x224 image inside the display canvas (device px). */
export interface PresentLayout {
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Integer scale (>= 1) that fits the screen in a W x H canvas, centred; fills
 * and returns `out` so the per-frame call allocates nothing. A canvas smaller
 * than the screen gets scale 1 and a negative offset (centred crop).
 */
export function presentLayout(W: number, H: number, out: PresentLayout): PresentLayout {
  const fit = Math.floor(Math.min(W / SCREEN_W, H / SCREEN_H));
  out.scale = fit >= 1 ? fit : 1;
  out.w = SCREEN_W * out.scale;
  out.h = SCREEN_H * out.scale;
  out.x = Math.floor((W - out.w) / 2);
  out.y = Math.floor((H - out.h) / 2);
  return out;
}

/** Backing-store size (device px) for a CSS length at a device pixel ratio: rounded, capped at MAX_BACKING, 0 if empty. */
export function backingSize(css: number, dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const v = Math.round(css * ratio);
  return v >= 1 ? Math.min(MAX_BACKING, v) : 0;
}

/**
 * Horizontal distance from a sprite frame's left edge to the point placed on
 * the entity. flipX mirrors about the origin, so a mirrored frame spans
 * [x - (w - ox), x + ox) and off-centre origins (a sword hilt) stay anchored.
 */
export function originOffsetX(w: number, ox: number, flipX: boolean): number {
  return flipX ? w - ox : ox;
}

/** Left edge (whole px) of a stamp `size` px wide centred on `centre`; the centre is rounded first so the stamp never jitters against sprites. */
export function stampLeft(centre: number, size: number): number {
  return Math.round(centre) - (size >> 1);
}

/** True if a w x h box at (x, y) overlaps the 256x224 view. */
export function onScreen(x: number, y: number, w: number, h: number): boolean {
  return x < SCREEN_W && y < SCREEN_H && x + w > 0 && y + h > 0;
}

/** Upscale factor for a light of radius r: its stamp is painted at radius round(r / k) and drawn k times larger. */
export function lightStampScale(r: number): number {
  return r > MAX_LIGHT_STAMP_R ? Math.ceil(r / MAX_LIGHT_STAMP_R) : 1;
}

/**
 * Backing size along one axis: the exact device-pixel size a ResizeObserver
 * reported when it agrees with css x dpr (within 1px), else css x dpr rounded.
 * The check guards against DPR emulation (DevTools device mode, headless
 * deviceScaleFactor), where Chromium reports device-pixel boxes at 1x.
 */
export function deviceSize(exact: number, css: number, dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (exact > 0 && Math.abs(exact - css * ratio) <= 1) return Math.min(MAX_BACKING, Math.round(exact));
  return backingSize(css, ratio);
}
