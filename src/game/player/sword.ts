// Sword geometry and timing (pure; unit-tested): the swing timeline over the
// three hero attack frames, where the blade sits on each frame (the art's
// HERO_SWORD_POSES, matched to the hand), the blade hitbox, and the spin-attack
// ring that sweeps the blade through all eight compass directions.
import type { Dir } from '../../core/types';
import type { Rect, Vec } from '../../core/math';
import { HERO_SWORD_POSES, type SwordPose } from '../../content/art/sprites-core';

export type { SwordPose };
export type BladeDir = SwordPose['blade'];
/** Attack anim frame: 0 = wind-up, 1 = slash, 2 = thrust (held). */
export type SwingFrame = 0 | 1 | 2;

/** One sword swing (s). */
export const SWING_TIME = 0.26;
/** A new press may restart the swing after this much of it (s). */
export const RESWING_AFTER = 0.16;
/** Hold the sword button this long (s, counted from the press) to charge a spin. */
export const CHARGE_TIME = 0.8;
/** Full 360-degree spin attack (s). */
export const SPIN_TIME = 0.4;
/** Start times (s) of attack frames 0, 1 and 2 within a swing. */
const FRAME_STARTS: readonly number[] = [0, 0.05, 0.11];
/**
 * Blade hitbox: from BLADE_BASE to BLADE_REACH px past the hand, padded BLADE_PAD px along
 * the blade and BLADE_HALF_WIDTH px across a straight one (as wide as the hero, ALttP-generous).
 */
export const BLADE_REACH = 12;
const BLADE_BASE = 2;
const BLADE_PAD = 3;
const BLADE_HALF_WIDTH = 6;
/** Where along the blade (px past the hand) its tip effects (sparkle, tink spark) are drawn. */
const TIP = 8;

const D = Math.SQRT1_2;
/** Unit vector each fx.sword anim points along (screen space, y down). */
export const BLADE_VEC: Readonly<Record<BladeDir, Vec>> = {
  n: { x: 0, y: -1 }, ne: { x: D, y: -D }, e: { x: 1, y: 0 }, se: { x: D, y: D },
  s: { x: 0, y: 1 }, sw: { x: -D, y: D }, w: { x: -1, y: 0 }, nw: { x: -D, y: -D },
};

/** Attack frame shown `t` seconds into a swing. */
export function swingFrame(t: number): SwingFrame {
  if (t >= FRAME_STARTS[2]!) return 2;
  return t >= FRAME_STARTS[1]! ? 1 : 0;
}

/** Blade placement on attack frame `frame` facing `facing`. */
export function swingPose(facing: Dir, frame: SwingFrame): SwordPose {
  return HERO_SWORD_POSES[facing][frame]!;
}

/** The sword held straight out in front (charging, dashing): the thrust frame. */
export function heldPose(facing: Dir): SwordPose {
  return swingPose(facing, 2);
}

/** Blade hitbox (room px) for `pose` with the hero's origin at (x, y), written into `out` when given. */
export function bladeRect(x: number, y: number, pose: SwordPose, out: Rect = { x: 0, y: 0, w: 0, h: 0 }): Rect {
  const v = BLADE_VEC[pose.blade];
  const hx = x + pose.dx;
  const hy = y + pose.dy;
  const padX = v.x === 0 ? BLADE_HALF_WIDTH : BLADE_PAD;
  const padY = v.y === 0 ? BLADE_HALF_WIDTH : BLADE_PAD;
  const x0 = Math.min(hx + v.x * BLADE_BASE, hx + v.x * BLADE_REACH) - padX;
  const y0 = Math.min(hy + v.y * BLADE_BASE, hy + v.y * BLADE_REACH) - padY;
  const x1 = Math.max(hx + v.x * BLADE_BASE, hx + v.x * BLADE_REACH) + padX;
  const y1 = Math.max(hy + v.y * BLADE_BASE, hy + v.y * BLADE_REACH) + padY;
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return out;
}

/** Where the blade's tip effects go for `pose` with the hero's origin at (x, y). */
export function bladeTip(x: number, y: number, pose: SwordPose): Vec {
  const v = BLADE_VEC[pose.blade];
  return { x: x + pose.dx + v.x * TIP, y: y + pose.dy + v.y * TIP };
}

/** One step of the spin: the hero frame to show and where the blade is. */
export interface SpinStep {
  facing: Dir;
  frame: SwingFrame;
  pose: SwordPose;
}

/** The hero frame whose hand holds `blade`, reused with the blade rotated for the one direction no frame covers (se). */
function step(facing: Dir, frame: SwingFrame, blade?: BladeDir): SpinStep {
  const base = swingPose(facing, frame);
  return { facing, frame, pose: blade ? { ...base, blade } : base };
}

/** Clockwise (on screen) from south: s, sw, w, nw, n, ne, e, se. */
export const SPIN_RING: readonly SpinStep[] = [
  step('down', 2), step('down', 1), step('left', 2), step('left', 1),
  step('up', 2), step('up', 1), step('right', 2), step('right', 2, 'se'),
];

const RING_START: Readonly<Record<Dir, number>> = { down: 0, left: 2, up: 4, right: 6 };

/** Ring index `t` seconds into a spin that started facing `start` (one full turn over SPIN_TIME). */
export function spinIndex(t: number, start: Dir): number {
  const n = SPIN_RING.length;
  const k = Math.min(n - 1, Math.max(0, Math.floor((t / SPIN_TIME) * n)));
  return (RING_START[start] + k) % n;
}

/** Spin step `t` seconds into a spin that started facing `start`. */
export function spinStep(t: number, start: Dir): SpinStep {
  return SPIN_RING[spinIndex(t, start)]!;
}
