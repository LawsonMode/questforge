// The Hollow Keep: a two-floor dungeon (13 rooms). See keep-1f.ts and
// keep-2f.ts for the room-by-room route; keys and doors are strictly ordered
// (one small key per locked door, each found before its door) so no order of
// play can lock the hero out.
import type { Terrain, World } from '../../core/types';
import { createWorld } from '../../core/project';
import { keepGroundFloor } from './keep-1f';
import { keepUpperFloor } from './keep-2f';
import { W } from './ids';

/** The Hollow Keep dungeon world (both floors). */
export function buildKeep(terrains: readonly Terrain[]): World {
  const world = createWorld({ id: W.keep, name: 'Hollow Keep', kind: 'dungeon', music: 'dungeon' });
  // What the plaque, the Elder and the crystal's own message call the prize.
  world.prizeName = 'Sun Crystal';
  world.rooms.push(...keepGroundFloor(terrains), ...keepUpperFloor(terrains));
  return world;
}
