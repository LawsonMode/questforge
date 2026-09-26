// Bombs: placed just ahead of the hero (costs 1), at most two ticking at once.
import type { Vec } from '../../../core/math';
import type { Entity } from '../../entity';
import { Bomb } from '../../projectiles/bomb';
import { countLive } from '../../projectiles/projectile';
import { outsideRoom } from '../../projectiles/tiles';
import { ahead, type ItemOutcome } from './front';

/** Bombs the hero may have ticking at once. */
export const MAX_BOMBS = 2;
/**
 * Preferred placement distance (px ahead); against a wall or the room's edge the
 * bomb comes back until it fits (flush with it).
 */
const PLACE_AHEAD = 12;

/** Farthest spot up to PLACE_AHEAD px ahead of the hero where the bomb fits inside the room, between walls. */
function placement(hero: Entity, bomb: Bomb): Vec {
  const room = hero.game.room;
  for (let dist = PLACE_AHEAD; dist > 0; dist--) {
    const p = ahead(hero, dist);
    if (!bomb.isBlockedAt(p.x, p.y) && outsideRoom(room, bomb.rectAt(p.x, p.y)) === 'none') return p;
  }
  return { x: hero.x, y: hero.y };
}

export function useBombs(hero: Entity): ItemOutcome {
  const game = hero.game;
  if (countLive(game, Bomb) >= MAX_BOMBS) return 'busy';
  if (!game.takeItem('bombs', 1)) return 'fail';
  const bomb = new Bomb(game, hero.x, hero.y);
  const p = placement(hero, bomb);
  bomb.x = p.x;
  bomb.y = p.y;
  game.spawn(bomb);
  game.audio.sfx('bombPlace');
  return 'pose';
}
