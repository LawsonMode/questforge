// Room transitions: edge math (which edge the player crossed, where they land in
// the neighbour), the ALttP-style scroll, and fade / iris warps.
// OWNER: engine agent.
import type { Dir, Room, World } from '../core/types';
import type { Vec } from '../core/math';
import type { Renderer } from './api';
import { clamp, lerp, rectsOverlap } from '../core/math';
import { SCREEN_COLS, SCREEN_H, SCREEN_ROWS, SCREEN_W, TILE } from '../core/constants';
import { clampCamera } from './camera';

/** Seconds for an edge scroll. */
export const SCROLL_TIME = 0.6;
/** How far (px) the player is carried into the new room by a scroll. */
export const SCROLL_CARRY = 16;
/** Seconds per half (out / in) of a fade warp and of an iris warp. */
export const FADE_HALF = 0.25;
export const IRIS_HALF = 0.4;

/** Room size in px. */
export function roomSizePx(room: Room): { w: number; h: number } {
  return { w: room.gw * SCREEN_COLS * TILE, h: room.gh * SCREEN_ROWS * TILE };
}

/** The edge a point has crossed (outside the half-open room rect), or null while inside. */
export function edgeExit(x: number, y: number, roomW: number, roomH: number): Dir | null {
  if (y < 0) return 'up';
  if (y >= roomH) return 'down';
  if (x < 0) return 'left';
  if (x >= roomW) return 'right';
  return null;
}

/** Position along an edge (x for up/down, y for left/right), clamped inside the room. */
export function edgeAlong(dir: Dir, x: number, y: number, roomW: number, roomH: number): number {
  return dir === 'up' || dir === 'down' ? clamp(x, 0, roomW - 1) : clamp(y, 0, roomH - 1);
}

/** Pixel offset of `to`'s origin relative to `from`'s origin (both rooms in one world grid). */
export function roomOffset(from: Room, to: Room): Vec {
  return { x: (to.gx - from.gx) * SCREEN_W, y: (to.gy - from.gy) * SCREEN_H };
}

/**
 * Where the player lands in `to` after leaving `from` across `dir` at (x, y)
 * (from-local px): same world position along the edge, carried SCROLL_CARRY px
 * inside the new room, and kept at least `margin` px from its side edges.
 */
export function scrollEntry(from: Room, to: Room, dir: Dir, x: number, y: number, margin = 8): Vec {
  const off = roomOffset(from, to);
  const size = roomSizePx(to);
  let nx = x - off.x;
  let ny = y - off.y;
  switch (dir) {
    case 'right': nx = SCROLL_CARRY; break;
    case 'left': nx = size.w - SCROLL_CARRY; break;
    case 'down': ny = SCROLL_CARRY; break;
    case 'up': ny = size.h - SCROLL_CARRY; break;
  }
  return { x: clamp(nx, margin, size.w - margin), y: clamp(ny, margin, size.h - margin) };
}

/**
 * Camera (new-room px) at the end of a scroll: along the scroll axis it frames
 * the landing spot; across it, it stays where the old camera was (clamped to
 * the new room) so the view slides straight instead of diagonally.
 */
export function scrollCameraEnd(dir: Dir, fromCam: Vec, offset: Vec, focus: Vec, to: Room): Vec {
  const size = roomSizePx(to);
  const framed = clampCamera(focus.x, focus.y, size.w, size.h);
  const kept = {
    x: Math.round(clamp(fromCam.x - offset.x, 0, Math.max(0, size.w - SCREEN_W))),
    y: Math.round(clamp(fromCam.y - offset.y, 0, Math.max(0, size.h - SCREEN_H))),
  };
  return dir === 'up' || dir === 'down' ? { x: kept.x, y: framed.y } : { x: framed.x, y: kept.y };
}

/**
 * Other rooms on the same floor that the scroll camera can show on its way
 * (e.g. when sliding sideways between rooms of different sizes), with their
 * origins relative to `from`. Drawing them keeps void from flashing by.
 */
export function roomsAlongScroll(
  world: World, from: Room, to: Room, fromCam: Vec, toCam: Vec,
): { room: Room; offset: Vec }[] {
  const off = roomOffset(from, to);
  const x0 = Math.min(fromCam.x, toCam.x + off.x);
  const y0 = Math.min(fromCam.y, toCam.y + off.y);
  const view = {
    x: x0, y: y0,
    w: Math.max(fromCam.x, toCam.x + off.x) - x0 + SCREEN_W,
    h: Math.max(fromCam.y, toCam.y + off.y) - y0 + SCREEN_H,
  };
  const out: { room: Room; offset: Vec }[] = [];
  for (const room of world.rooms) {
    if (room === from || room === to || room.floor !== from.floor) continue;
    const offset = roomOffset(from, room);
    const size = roomSizePx(room);
    if (rectsOverlap(view, { x: offset.x, y: offset.y, w: size.w, h: size.h })) out.push({ room, offset });
  }
  return out;
}

/** Smooth ease-in-out on [0, 1]. */
export function easeInOut(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

// ----------------------------------------------------------------------------
// Transitions
// ----------------------------------------------------------------------------

export interface Transition {
  readonly done: boolean;
  update(dt: number): void;
}

/**
 * Draws one room's scene with the given camera (that room's px) and the player at
 * `player` (that room's px); the scroll calls it for the old and the new room.
 */
export type RoomPainter = (camX: number, camY: number, player: Vec) => void;

export interface ScrollSetup {
  /** Old room camera at the start (old-room px). */
  fromCam: Vec;
  /** New room camera at the end (new-room px). */
  toCam: Vec;
  /** New room origin relative to the old room origin (px). */
  offset: Vec;
  /** Player position when the scroll starts (old-room px). */
  playerFrom: Vec;
  /** Player landing position (new-room px). */
  playerTo: Vec;
}

/**
 * ALttP-style edge scroll: both rooms slide by while the player is carried a
 * short way into the new room. Everything else is frozen by the engine.
 */
export class ScrollTransition implements Transition {
  private t = 0;
  readonly setup: ScrollSetup;

  constructor(setup: ScrollSetup) {
    this.setup = setup;
  }

  get done(): boolean {
    return this.t >= SCROLL_TIME;
  }

  get progress(): number {
    return easeInOut(this.t / SCROLL_TIME);
  }

  update(dt: number): void {
    this.t = Math.min(SCROLL_TIME, this.t + dt);
  }

  /** Camera in old-room coordinates. */
  camera(): Vec {
    const { fromCam, toCam, offset } = this.setup;
    const p = this.progress;
    return {
      x: Math.round(lerp(fromCam.x, toCam.x + offset.x, p)),
      y: Math.round(lerp(fromCam.y, toCam.y + offset.y, p)),
    };
  }

  /** Player position in old-room coordinates. */
  playerPos(): Vec {
    const { playerFrom, playerTo, offset } = this.setup;
    const p = this.progress;
    return { x: lerp(playerFrom.x, playerTo.x + offset.x, p), y: lerp(playerFrom.y, playerTo.y + offset.y, p) };
  }

  /**
   * Paint the old room, then the new one, each with the player at the
   * interpolated position in its own coordinates. Each room clips to its own
   * rect, so a player straddling the seam is drawn half by each, under each
   * room's 'over' layer.
   */
  draw(paintOld: RoomPainter, paintNew: RoomPainter): void {
    const cam = this.camera();
    const { offset } = this.setup;
    const pp = this.playerPos();
    paintOld(cam.x, cam.y, pp);
    paintNew(cam.x - offset.x, cam.y - offset.y, { x: pp.x - offset.x, y: pp.y - offset.y });
  }
}

export type WarpStyle = 'fade' | 'iris';

/**
 * Fade or iris warp: covers the screen, calls `onMidpoint` (load the target
 * room) while fully covered, then uncovers.
 */
export class WarpTransition implements Transition {
  readonly style: WarpStyle;
  private phase: 'out' | 'in' | 'done' = 'out';
  private t = 0;
  private readonly half: number;
  private readonly onMidpoint: () => void;

  constructor(style: WarpStyle, onMidpoint: () => void) {
    this.style = style;
    this.half = style === 'iris' ? IRIS_HALF : FADE_HALF;
    this.onMidpoint = onMidpoint;
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /** 0 = clear screen, 1 = fully covered. */
  get cover(): number {
    if (this.phase === 'done') return 0;
    const p = clamp(this.t / this.half, 0, 1);
    return this.phase === 'out' ? p : 1 - p;
  }

  update(dt: number): void {
    if (this.phase === 'done') return;
    this.t += dt;
    if (this.t < this.half) return;
    if (this.phase === 'out') {
      this.onMidpoint();
      this.phase = 'in';
      this.t = 0;
    } else {
      this.phase = 'done';
    }
  }

  /** Overlay; `focus` is the iris centre in screen px (the player). */
  drawOverlay(r: Renderer, focus: Vec): void {
    const cover = this.cover;
    if (cover <= 0) return;
    if (this.style === 'fade') {
      r.overlay('#000000', cover);
      return;
    }
    drawIris(r, focus, (1 - cover) * irisMaxRadius(focus, r.width, r.height));
  }
}

/** Radius that uncovers the whole screen from `focus`. */
function irisMaxRadius(focus: Vec, w: number, h: number): number {
  const dx = Math.max(focus.x, w - focus.x);
  const dy = Math.max(focus.y, h - focus.y);
  return Math.hypot(dx, dy) + 2;
}

/** Black screen with a circular hole of `radius` around `focus` (screen px). */
export function drawIris(r: Renderer, focus: Vec, radius: number): void {
  const ctx = r.ctx;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.rect(0, 0, r.width, r.height);
  if (radius > 0.5) ctx.arc(focus.x, focus.y, radius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
}
