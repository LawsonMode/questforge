// Where item projectiles appear relative to the hero.
import type { Vec } from '../../../core/math';
import { DIR_VEC } from '../../../core/math';
import type { Entity } from '../../entity';

/** The point `dist` px ahead of the hero's origin along its facing. */
export function ahead(hero: Entity, dist: number): Vec {
  const f = DIR_VEC[hero.facing];
  return { x: hero.x + f.x * dist, y: hero.y + f.y * dist };
}

/** Outcome of pressing the item button: error sound, silently ignored, a brief use pose, or a started hookshot. */
export type ItemOutcome<H = never> = 'fail' | 'busy' | 'pose' | H;
