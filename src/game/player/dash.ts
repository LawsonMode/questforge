// Boots dash (pure; unit-tested): hold the action button for a wind-up spent
// running in place, then run straight ahead until the button is released or
// the hero steers another way. Bonks and tile breaks are decided by the Player,
// which owns collision.
import type { Dir } from '../../core/types';
import type { Vec } from '../../core/math';
import { DIR_VEC } from '../../core/math';

/** Wind-up spent running in place (s). */
export const DASH_WINDUP = 0.35;
/** Dash speed (px/s). */
export const DASH_SPEED = 180;
/** Seconds between dust puffs while winding up / dashing. */
export const DASH_DUST_EVERY = 0.08;

export type DashPhase = 'windup' | 'run';

/** Whether the d-pad holds any direction other than `facing` (steering ends a dash). */
export function turnedAway(facing: Dir, d: Vec): boolean {
  const f = DIR_VEC[facing];
  const offX = d.x !== 0 && Math.sign(d.x) !== f.x;
  const offY = d.y !== 0 && Math.sign(d.y) !== f.y;
  return offX || offY;
}

/**
 * Next dash phase after `t` seconds in the dash: releasing the button stops it,
 * the wind-up turns into the run once DASH_WINDUP has passed, and steering stops a run.
 */
export function dashNext(phase: DashPhase, t: number, actionHeld: boolean, turned: boolean): DashPhase | 'stop' {
  if (!actionHeld) return 'stop';
  if (phase === 'windup') return t >= DASH_WINDUP ? 'run' : 'windup';
  return turned ? 'stop' : 'run';
}
