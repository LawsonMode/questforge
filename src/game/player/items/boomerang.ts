// Boomerang: thrown along the held d-pad direction (8-way) or the facing; one at a time.
import type { Entity } from '../../entity';
import { DIR_VEC } from '../../../core/math';
import { Boomerang } from '../../projectiles/boomerang';
import { countLive } from '../../projectiles/projectile';
import { ahead, type ItemOutcome } from './front';

/** It leaves this far (px) ahead of the hero's origin. */
const RELEASE = 6;

export function useBoomerang(hero: Entity): ItemOutcome {
  const game = hero.game;
  if (countLive(game, Boomerang) > 0) return 'busy';
  const d = game.input.dir();
  const dir = d.x !== 0 || d.y !== 0 ? d : DIR_VEC[hero.facing];
  const p = ahead(hero, RELEASE);
  const level = game.hasItem('boomerang', 2) ? 2 : 1;
  game.spawn(new Boomerang(game, hero, p.x, p.y, dir, level));
  return 'pose';
}
