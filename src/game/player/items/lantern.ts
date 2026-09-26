// Lantern: a short flame ahead of the hero for 2 magic (one flame at a time).
// Its light in dark rooms is the engine's job.
import type { Entity } from '../../entity';
import { Flame } from '../../projectiles/flame';
import { countLive } from '../../projectiles/projectile';
import { ahead, type ItemOutcome } from './front';

/** Magic per flame. */
export const LANTERN_COST = 2;
/** The flame burns this far (px) ahead of the hero's origin. */
const REACH = 14;

export function useLantern(hero: Entity): ItemOutcome {
  const game = hero.game;
  if (countLive(game, Flame) > 0) return 'busy';
  if (!game.takeItem('magic', LANTERN_COST)) return 'fail';
  const p = ahead(hero, REACH);
  game.spawn(new Flame(game, p.x, p.y));
  game.audio.sfx('lantern');
  return 'pose';
}
