// The item button: dispatches the equipped item to its module.
import type { ItemId } from '../../../core/types';
import type { Entity } from '../../entity';
import type { Hookshot } from '../../projectiles/hookshot';
import type { ItemOutcome } from './front';
import { useBow } from './bow';
import { useBoomerang } from './boomerang';
import { useHookshot } from './hookshot';
import { useBombs } from './bombs';
import { useLantern } from './lantern';

const USES: Partial<Record<ItemId, (hero: Entity) => ItemOutcome<Hookshot>>> = {
  bow: useBow,
  boomerang: useBoomerang,
  hookshot: useHookshot,
  bombs: useBombs,
  lantern: useLantern,
};

/** Use `item` (the equipped one): 'fail' when it isn't owned / out of ammo or magic. */
export function useItem(hero: Entity, item: ItemId): ItemOutcome<Hookshot> {
  const use = USES[item];
  if (!use) return 'busy';
  if (!hero.game.hasItem(item)) return 'fail';
  return use(hero);
}
