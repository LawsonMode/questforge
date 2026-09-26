// Room camera: follows a focus point, clamps to the room (one-screen rooms never
// scroll), adds screen-shake jitter for rendering. OWNER: engine agent.
import type { Vec } from '../core/math';
import { approach, clamp } from '../core/math';
import { SCREEN_H, SCREEN_W } from '../core/constants';
import { rng as sharedRng, type Rng } from '../core/rng';

/** Top-left camera position (integer px) centring `focus` inside a room of the given size. */
export function clampCamera(
  focusX: number, focusY: number, roomW: number, roomH: number, viewW = SCREEN_W, viewH = SCREEN_H,
): Vec {
  return {
    x: Math.round(clamp(focusX - viewW / 2, 0, Math.max(0, roomW - viewW))),
    y: Math.round(clamp(focusY - viewH / 2, 0, Math.max(0, roomH - viewH))),
  };
}

export class Camera {
  /** Unshaken camera position (integer px, room-local). */
  x = 0;
  y = 0;
  private shakeTime = 0;
  private shakeMag = 0;
  private jx = 0;
  private jy = 0;
  private readonly rng: Rng;

  constructor(rng: Rng = sharedRng) {
    this.rng = rng;
  }

  /** Snap to the clamped position for a focus point (feet-centre of the player, usually). */
  follow(focusX: number, focusY: number, roomW: number, roomH: number): void {
    const c = clampCamera(focusX, focusY, roomW, roomH);
    this.x = c.x;
    this.y = c.y;
  }

  /** Move toward the clamped position for a focus point by at most `maxStep` px per axis (smooth catch-up). */
  approach(focusX: number, focusY: number, roomW: number, roomH: number, maxStep: number): void {
    const c = clampCamera(focusX, focusY, roomW, roomH);
    this.x = approach(this.x, c.x, maxStep);
    this.y = approach(this.y, c.y, maxStep);
  }

  /** Place the camera directly (integer px). */
  set(x: number, y: number): void {
    this.x = Math.round(x);
    this.y = Math.round(y);
  }

  /** Shake for `seconds` with up to `magnitude` px of jitter (longest/strongest request wins). */
  shake(seconds: number, magnitude = 2): void {
    if (seconds <= 0) return;
    this.shakeMag = this.shakeTime > 0 ? Math.max(this.shakeMag, magnitude) : magnitude;
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  /** Advance the shake timer and pick this tick's jitter. */
  update(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const m = Math.round(this.shakeMag);
      this.jx = this.rng.int(-m, m);
      this.jy = this.rng.int(-m, m);
    } else {
      this.jx = 0;
      this.jy = 0;
      this.shakeMag = 0;
    }
  }

  get shaking(): boolean {
    return this.shakeTime > 0;
  }

  /** Integer camera position for rendering (includes shake jitter). */
  get renderX(): number {
    return this.x + this.jx;
  }

  get renderY(): number {
    return this.y + this.jy;
  }
}
