// Shield rules (pure; unit-tested): a blockable source hitting the hero's
// facing side is stopped while the hero's arms are free.
import type { Dir } from '../../core/types';
import type { Hit, PlayerState } from '../api';
import { vecToDir } from '../../core/math';

/** States in which the shield arm is up (not attacking, lifting, carrying, dashing, swimming...). */
const SHIELD_STATES: ReadonlySet<PlayerState> = new Set(['normal', 'push', 'charge', 'locked']);

/** Whether the shield can block in this state. */
export function shieldReady(state: PlayerState): boolean {
  return SHIELD_STATES.has(state);
}

/**
 * The side of the hero (at x, y) a hit came from: against its travel (dx, dy) when
 * known, else toward its source; null when neither tells.
 */
export function hitSide(hit: Hit, x: number, y: number): Dir | null {
  if (hit.dx !== 0 || hit.dy !== 0) return vecToDir(-hit.dx, -hit.dy);
  const s = hit.source;
  if (!s || (s.x === x && s.y === y)) return null;
  return vecToDir(s.x - x, s.y - y);
}

/** Whether a shield held facing `facing` stops `hit` (blockable source, from the front). */
export function shieldBlocks(hit: Hit, x: number, y: number, facing: Dir): boolean {
  return hit.source?.blockable === true && hitSide(hit, x, y) === facing;
}
