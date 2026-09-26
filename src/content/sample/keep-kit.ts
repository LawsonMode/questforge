// Shared pieces for the Hollow Keep: one-screen room shells from ASCII maps,
// door link names (both sides of a doorway share one link) and the stair and
// exit spots that connect the keep's floors and the overworld.
import type { Room, Terrain } from '../../core/types';
import { DUNGEON } from './legends';
import { mapRoom } from './paint';
import { spot } from './entities';
import { KP, OW, W } from './ids';

/** Door links: both sides of a doorway use the same one. */
export const LINK = {
  entranceGuard: 'kp_d_entrance_guard',
  guardPits: 'kp_d_guard_pits',
  keyA: 'kp_d_key_a',
  pitsWest: 'kp_d_pits_west',
  blockBlade: 'kp_d_block_blade',
  darkTorch: 'kp_d_dark_torch',
  keyB: 'kp_d_key_b',
  eyeChest: 'kp_d_eye_chest',
  chestPegs: 'kp_d_chest_pegs',
  bossDoor: 'kp_d_boss_door',
  bossOut: 'kp_d_boss_out',
} as const;

/**
 * Stairs: the 1F blade hall's up-stairs and the 2F dark hall's down-stairs share a
 * tile, set against a thick north wall so the HUD (rows 0-2) never covers them, in
 * a niche between two statues: they are only ever climbed walking up.
 */
export const STAIRS = { tx: 2, ty: 3 } as const;

/**
 * Where the hero lands on each floor when taking the stairs: diagonally below
 * them, so UP still held after the fade walks into a statue instead of straight
 * back onto the stairs, and DOWN leads onto floor rather than into a pit.
 */
export const STAIRS_LANDING = {
  up: spot(W.keep, KP.darkHall, STAIRS.tx + 1, STAIRS.ty + 1, 'down'),
  down: spot(W.keep, KP.bladeHall, STAIRS.tx + 1, STAIRS.ty + 1, 'down'),
};

/**
 * Where a fall through the dark hall's pits lands in the blade hall: the clear
 * west column, from which walking on in any direction meets neither the stairs
 * nor the spikes.
 */
export const PIT_LANDING = spot(W.keep, KP.bladeHall, STAIRS.tx - 1, STAIRS.ty + 1, 'down');

/** Outside, in front of the keep's entrance arch. */
export const KEEP_EXIT = { ...spot(W.overworld, OW.keepGate, 7, 5, 'down'), x: 8 * 16 };

/** A one-screen keep room painted from a 16x14 map (walls '#', doorways 'D'). */
export function keepRoom(
  terrains: readonly Terrain[], id: string, name: string, gx: number, gy: number, floor: number, lines: readonly string[],
): Room {
  const { room } = mapRoom(terrains, { id, name, gx, gy, floor }, lines, DUNGEON, { ground: 'DFLOOR', walls: 'dungeon' });
  return room;
}
