// Grapple Claw (internal id `hookshot`): one claw at a time; the hero waits (and is pulled) until it is done.
import type { Entity } from '../../entity';
import { Hookshot } from '../../projectiles/hookshot';
import { countLive } from '../../projectiles/projectile';
import type { ItemOutcome } from './front';

export function useHookshot(hero: Entity): ItemOutcome<Hookshot> {
  const game = hero.game;
  if (countLive(game, Hookshot) > 0) return 'busy';
  game.audio.sfx('hookshot');
  return game.spawn(new Hookshot(game, hero, hero.facing));
}
