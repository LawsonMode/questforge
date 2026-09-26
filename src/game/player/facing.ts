// Pure movement helpers for the hero (unit-tested): ALttP facing rules and the
// 8-direction walk velocity.
import type { Dir } from '../../core/types';
import type { Vec } from '../../core/math';
import { DIRS } from '../../core/math';

/** Hero walk speed (px/s). */
export const WALK_SPEED = 88;
/** Per-axis factor when moving diagonally (ALttP-like, ~0.75). */
export const DIAGONAL_FACTOR = 0.75;

/** Which d-pad directions a dir() vector holds (written into `out` when given). */
export function heldDirs(d: Vec, out: Record<Dir, boolean> = { up: false, down: false, left: false, right: false }): Record<Dir, boolean> {
  out.up = d.y < 0;
  out.down = d.y > 0;
  out.left = d.x < 0;
  out.right = d.x > 0;
  return out;
}

/**
 * ALttP facing: keep the current facing while it is still one of the held
 * directions; otherwise take a newly pressed held direction, else any held one.
 */
export function nextFacing(current: Dir, held: Record<Dir, boolean>, pressed: Record<Dir, boolean>): Dir {
  if (held[current]) return current;
  for (const d of DIRS) if (held[d] && pressed[d]) return d;
  for (const d of DIRS) if (held[d]) return d;
  return current;
}

/** Velocity (px/s) for a d-pad vector at `speed` (written into `out` when given); diagonals are scaled per axis. */
export function walkVelocity(d: Vec, speed = WALK_SPEED, out: Vec = { x: 0, y: 0 }): Vec {
  const k = d.x !== 0 && d.y !== 0 ? DIAGONAL_FACTOR : 1;
  out.x = Math.sign(d.x) * speed * k;
  out.y = Math.sign(d.y) * speed * k;
  return out;
}
