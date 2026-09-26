// Loot rolls and drops. 'random' uses an ALttP-like table; named kinds drop
// exactly that item. Drops spawn transient 'obj.pickup' instances.
// OWNER: engine agent.
import type { EntityInstance, ItemId, SaveData } from '../core/types';
import type { DropKind } from '../content/ids';
import type { GameServices } from './api';
import { createEntity } from './registry';
import { rng as sharedRng, type Rng } from '../core/rng';

export interface LootDrop {
  item: ItemId;
  amount: number;
}

/** Chance that a 'random' roll yields nothing. */
export const NOTHING_CHANCE = 0.45;

const NAMED: Readonly<Record<Exclude<DropKind, 'random' | 'none'>, LootDrop>> = {
  smallKey: { item: 'smallKey', amount: 1 },
  heart: { item: 'heart', amount: 1 },
  rupee: { item: 'rupees', amount: 1 },
  rupee5: { item: 'rupees', amount: 5 },
  rupee20: { item: 'rupees', amount: 20 },
  bombs: { item: 'bombs', amount: 4 },
  arrows: { item: 'arrows', amount: 10 },
  magic: { item: 'magic', amount: 16 },
};

/** Weighted entries of the random table for the current save (hearts favoured at low health). */
export function randomTable(save: SaveData): [LootDrop, number][] {
  const lowHealth = save.hp <= save.maxHp / 2;
  const fullHealth = save.hp >= save.maxHp;
  const table: [LootDrop, number][] = [
    [{ item: 'rupees', amount: 1 }, 34],
    [{ item: 'rupees', amount: 5 }, 10],
    [{ item: 'heart', amount: 1 }, lowHealth ? 44 : fullHealth ? 6 : 18],
  ];
  if ((save.items.bombs ?? 0) > 0) table.push([{ item: 'bombs', amount: 1 }, 12]);
  if ((save.items.bow ?? 0) > 0) table.push([{ item: 'arrows', amount: 5 }, 12]);
  if ((save.items.lantern ?? 0) > 0) table.push([{ item: 'magic', amount: 8 }, 10]);
  return table;
}

/** Roll a drop (null = nothing). Pure given `rng`. */
export function rollLoot(kind: DropKind, save: SaveData, rng: Rng = sharedRng): LootDrop | null {
  if (kind === 'none') return null;
  if (kind !== 'random') return { ...NAMED[kind] };
  if (rng.chance(NOTHING_CHANCE)) return null;
  return { ...rng.weighted(randomTable(save)) };
}

let lootCounter = 1;

/** Roll and spawn a transient pickup at (x, y). Nothing appears until 'obj.pickup' is registered. */
export function dropLoot(game: GameServices, x: number, y: number, kind: DropKind = 'random'): void {
  const drop = rollLoot(kind, game.save);
  if (!drop) return;
  const inst: EntityInstance = {
    id: `loot-${lootCounter++}`,
    type: 'obj.pickup',
    x,
    y,
    props: { item: drop.item, amount: drop.amount, transient: true },
  };
  const e = createEntity(game, inst);
  if (e) game.spawn(e);
}
