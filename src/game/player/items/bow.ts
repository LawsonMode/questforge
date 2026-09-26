// Bow: one arrow per press (costs 1 arrow), at most two in flight.
import type { Entity } from '../../entity';
import { Arrow } from '../../projectiles/arrow';
import { countLive } from '../../projectiles/projectile';
import { ahead, type ItemOutcome } from './front';

/** Arrows the hero may have in the room at once. */
export const MAX_ARROWS = 2;
/** Arrows leave this far (px) ahead of the hero's origin. */
const MUZZLE = 8;

export function useBow(hero: Entity): ItemOutcome {
  const game = hero.game;
  if (countLive(game, Arrow) >= MAX_ARROWS) return 'busy';
  if (!game.takeItem('arrows', 1)) return 'fail';
  const p = ahead(hero, MUZZLE);
  game.spawn(new Arrow(game, p.x, p.y, hero.facing));
  game.audio.sfx('arrow');
  return 'pose';
}
