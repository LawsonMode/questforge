// ASCII map legends for the sample adventure (one character = one tile).
// Tiles with their ground baked in (bushes, rocks, furniture, pots) go on bg;
// transparent tiles (trees, bridges, pillars) go on fg/over above the ground.
import type { Legend } from './paint';

/** Overworld: nature, paths, water, cliffs, walls. Tree parts sit on the map's ground. */
export const OVERWORLD: Legend = {
  '.': { bg: 'GRASS' },
  ',': { bg: 'GRASS_ALT' },
  ';': { bg: 'GRASS_DARK' },
  '*': { bg: 'FLOWERS' },
  '"': { bg: 'TALL_GRASS' },
  b: { bg: 'BUSH' },
  r: { bg: 'ROCK' },
  R: { bg: 'HEAVY_ROCK' },
  S: { bg: 'STUMP' },
  k: { bg: 'PEBBLES' },
  d: { bg: 'DIRT' },
  z: { bg: 'SAND' },
  o: { bg: 'HOLE' },
  g: { bg: 'GRAVESTONE' },
  u: { bg: 'STATUE' },
  s: { bg: 'STONE_PATH' },
  '-': { bg: 'FENCE_H' },
  '|': { bg: 'FENCE_V' },
  '+': { bg: 'FENCE_POST' },
  '=': { terrain: 'path' },
  '~': { terrain: 'water' },
  _: { bg: 'SHALLOW_WATER' },
  B: { terrain: 'water', fg: 'BRIDGE_V' },
  Z: { terrain: 'water', fg: 'BRIDGE_H' },
  p: { terrain: 'plateau' },
  '[': { over: 'TREE_TL' },
  ']': { over: 'TREE_TR' },
  '{': { fg: 'TREE_BL' },
  '}': { fg: 'TREE_BR' },
  t: { fg: 'TREE_SMALL' },
  // Canopy tops along a screen edge whose trunks would lie off-screen: solid undergrowth beneath.
  '(': { fg: 'TREE_SMALL', over: 'TREE_TL' },
  ')': { fg: 'TREE_SMALL', over: 'TREE_TR' },
  m: { bg: 'MOUNTAIN_ROCK' },
  M: { bg: 'MOUNTAIN_GROUND' },
  x: { bg: 'CRACKED_ROCKWALL' },
  c: { bg: 'CAVE_ENTRANCE' },
  D: { bg: 'STAIRS_DOWN' },
  L: { bg: 'LEDGE_S' },
  J: { bg: 'LEDGE_W' },
  K: { bg: 'LEDGE_E' },
  Y: { terrain: 'plateau', after: 'CLIFF_STAIRS' },
  W: { bg: 'STONE_WALL' },
  w: { bg: 'STONE_WALL_TOP' },
  H: { bg: 'GRASS' },
};

/** Dungeon: autotiled stone walls ('#'), doorways ('D'), floors, props, pits. */
export const DUNGEON: Legend = {
  '#': { wall: true },
  D: { bg: 'DFLOOR', inWall: true },
  '%': { bg: 'CRACKED_WALL', inWall: true },
  '.': { bg: 'DFLOOR' },
  ',': { bg: 'DFLOOR_TILE' },
  ':': { bg: 'DFLOOR_ORNATE' },
  x: { bg: 'DFLOOR_CRACKED' },
  c: { bg: 'CARPET' },
  I: { bg: 'DFLOOR', fg: 'PILLAR' },
  U: { bg: 'DFLOOR', fg: 'DSTATUE' },
  P: { bg: 'DPOT' },
  B: { bg: 'DBLOCK' },
  '^': { bg: 'SPIKES' },
  O: { terrain: 'pit' },
  u: { bg: 'DSTAIRS_UP' },
  n: { bg: 'DSTAIRS_DOWN' },
  _: { bg: 'SHALLOW_WATER' },
};

/** House interiors: void outside (' '), autotiled timber walls ('#'), furniture. */
export const INTERIOR: Legend = {
  ' ': { bg: '' },
  '#': { wall: true },
  w: { bg: 'IWALL_WINDOW', inWall: true },
  e: { bg: 'EXIT_MAT', inWall: true },
  '.': { bg: 'WOOD_FLOOR' },
  ':': { bg: 'STONE_FLOOR' },
  r: { bg: 'RUG' },
  T: { bg: 'TABLE' },
  o: { bg: 'STOOL' },
  b: { bg: 'BED_TOP' },
  d: { bg: 'BED_BOTTOM' },
  s: { bg: 'SHELF' },
  f: { bg: 'FIREPLACE' },
  p: { bg: 'IPOT' },
  a: { bg: 'BARREL' },
  x: { bg: 'CRATE' },
};

/** Caves: rock mass, rough floor, boulders, the lit exit. */
export const CAVE: Legend = {
  '#': { bg: 'CAVE_WALL' },
  '.': { bg: 'CAVE_FLOOR' },
  ':': { bg: 'STONE_FLOOR' },
  k: { bg: 'CAVE_ROCKS' },
  X: { bg: 'CAVE_EXIT' },
  _: { bg: 'SHALLOW_WATER' },
};
