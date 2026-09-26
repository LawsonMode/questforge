// Small geometry helpers shared by engine, editor and tests.
import type { Dir } from './types';

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export const DIR_VEC: Readonly<Record<Dir, Vec>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function normalize(x: number, y: number): Vec {
  const l = Math.hypot(x, y);
  return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

/** Dominant cardinal direction of a vector (ties favour vertical). */
export function vecToDir(x: number, y: number, fallback: Dir = 'down'): Dir {
  if (x === 0 && y === 0) return fallback;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

