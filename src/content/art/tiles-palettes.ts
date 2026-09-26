// Tile palettes, one per material family. Families that sit on a common
// ground share that ground's ramp at the same indices, so a bush, a rock and a
// fence all paint the identical meadow under themselves:
//   overworld palettes: 1 outline, 2-6 grass ramp (G), 7-15 material
//   dungeon palettes:   1 outline, 2 void, 3-7 floor ramp (DF), 8-15 material
//   interior palettes:  1 outline, 2-6 wood-floor ramp (WF), 7-15 material
// Colours are authored freely and snapped to multiples of 8 by tilePalette().
import type { Palette } from '../../core/types';
import { tilePalette, type Lut } from './tiles-kit';

// ---- Shared ramps ----------------------------------------------------------

const GRASS_RAMP = ['#285430', '#387c38', '#58a444', '#80c058', '#b0dc70'];
/** Grass indices shared by every overworld palette. */
export const G = { SH: 2, DK: 3, MID: 4, LT: 5, HI: 6 } as const;
/** Cast-shadow LUT on grass (one step darker). */
export const GRASS_SHADE: Lut = { 3: 2, 4: 3, 5: 4, 6: 5 };

const DFLOOR_RAMP = ['#262a44', '#363a5c', '#4a4e74', '#62668c', '#8084a8'];
/** Dungeon floor indices shared by the dungeon palettes. */
export const DF = { OUT: 1, VOID: 2, D0: 3, D1: 4, D2: 5, D3: 6, D4: 7 } as const;
export const DFLOOR_SHADE: Lut = { 4: 3, 5: 4, 6: 5, 7: 6 };

const WOOD_FLOOR_RAMP = ['#54341c', '#7c5428', '#9c7038', '#b88c4c', '#d4ac68'];
/** Interior wood-floor indices shared by the interior palettes. */
export const WF = { OUT: 1, D0: 2, D1: 3, D2: 4, D3: 5, D4: 6 } as const;
export const WOOD_FLOOR_SHADE: Lut = { 3: 2, 4: 3, 5: 4, 6: 5 };

// ---- Overworld --------------------------------------------------------------

/** Meadow: grass variants, flowers, tall grass, bushes. */
export const MEADOW = { OUT: 1, ...G, B0: 7, B1: 8, B2: 9, B3: 10, WHITE: 11, RED: 12, YELLOW: 13, BLUE: 14, RED_DK: 15 } as const;
/** Stone objects on grass: rocks, gravestones, statues, flagstones, stairs. */
export const ROCK = { OUT: 1, ...G, S0: 7, S1: 8, S2: 9, S3: 10, S4: 11, H0: 12, H1: 13, H2: 14, VOID: 15 } as const;
/** Wood on grass: stumps, fences, bridges. */
export const WOOD = { OUT: 1, ...G, W0: 7, W1: 8, W2: 9, W3: 10, W4: 11, CUT: 12, RING: 13, MOSS: 14 } as const;
/** Trees (transparent backgrounds). */
export const TREE = { OUT: 1, ...G, L0: 7, L1: 8, L2: 9, L3: 10, L4: 11, T0: 12, T1: 13, T2: 14, T3: 15 } as const;
/** Earth: dirt, dirt path, ledges, holes. */
export const EARTH = { OUT: 1, ...G, E0: 7, E1: 8, E2: 9, E3: 10, E4: 11, VOID: 12, HOLE: 13, P3: 14, P4: 15 } as const;
/** Sand. */
export const SAND = { OUT: 1, ...G, S0: 7, S1: 8, S2: 9, S3: 10, S4: 11, SHELL: 12 } as const;
/** Deep water terrain (grass shore). */
export const WATER = { OUT: 1, ...G, BANK0: 7, BANK1: 8, W0: 9, W1: 10, W2: 11, W3: 12, FOAM: 13, SPARK: 14 } as const;
/** Shallow water (sandy bottom seen through water). */
export const SHALLOW = { OUT: 1, ...G, B0: 7, B1: 8, B2: 9, B3: 10, W2: 11, W3: 12, FOAM: 13, SPARK: 14 } as const;
/** Mountain: craggy rock, cliffs/plateau, mountain ground, cave mouths. */
export const MOUNT = { OUT: 1, ...G, R0: 7, R1: 8, R2: 9, R3: 10, R4: 11, VOID: 12, M0: 13, M1: 14, M2: 15 } as const;

// ---- Buildings ---------------------------------------------------------------

/** Shingled roof. */
export const ROOF = { OUT: 1, S0: 2, S1: 3, S2: 4, S3: 5, S4: 6, V0: 7, V1: 8, V2: 9, V3: 10, C0: 11, C1: 12, C2: 13 } as const;
/** Timber-framed plaster house front. */
export const HOUSE = {
  OUT: 1, P0: 2, P1: 3, P2: 4, P3: 5, T0: 6, T1: 7, T2: 8, F0: 9, F1: 10, L0: 11, L1: 12, L2: 13, D0: 14, D1: 15,
} as const;
/** Castle / town stone. */
export const STONE = { OUT: 1, S0: 2, S1: 3, S2: 4, S3: 5, S4: 6, S5: 7, MOSS0: 8, MOSS1: 9, M0: 10 } as const;

// ---- Dungeon -----------------------------------------------------------------

/** Dungeon floors, walls, pits, stairs, stone furniture. */
export const DUN = { ...DF, K0: 8, K1: 9, K2: 10, K3: 11, K4: 12, MET: 13, MET_HI: 14, GOLD: 15 } as const;
/** Dungeon props: clay pots and carpet (share the dungeon floor ramp). */
export const DPROP = { ...DF, C0: 8, C1: 9, C2: 10, C3: 11, R0: 12, R1: 13, R2: 14, GOLD: 15 } as const;

// ---- Interior & cave -----------------------------------------------------------

/** House interior shell: wood floor, plaster walls, beams, windows, mat. */
export const INT = { ...WF, P0: 7, P1: 8, P2: 9, B0: 10, B1: 11, B2: 12, SKY: 13, SKY_HI: 14, MAT: 15 } as const;
/** Furniture on wood floor. */
export const FURN = { ...WF, F0: 7, F1: 8, F2: 9, F3: 10, CLOTH: 11, BLUE0: 12, BLUE1: 13, RED: 14, GOLD: 15 } as const;
/** Hearth: stone fireplace with fire. */
export const HEARTH = { ...WF, S0: 7, S1: 8, S2: 9, S3: 10, F0: 11, F1: 12, F2: 13, F3: 14, SOOT: 15 } as const;
/** Cave: floor, walls, boulders, exit light. */
export const CAVE = { OUT: 1, D0: 2, D1: 3, D2: 4, D3: 5, D4: 6, K0: 7, K1: 8, K2: 9, K3: 10, K4: 11, L0: 12, L1: 13, L2: 14 } as const;

/** Palette ids, one per family. */
export const PAL = {
  meadow: 'pal.t.meadow', rock: 'pal.t.rock', wood: 'pal.t.wood', tree: 'pal.t.tree', earth: 'pal.t.earth',
  sand: 'pal.t.sand', water: 'pal.t.water', shallow: 'pal.t.shallow', mount: 'pal.t.mountain', roof: 'pal.t.roof',
  house: 'pal.t.house', stone: 'pal.t.stone', dungeon: 'pal.t.dungeon', dprop: 'pal.t.dprops', interior: 'pal.t.interior',
  furniture: 'pal.t.furniture', hearth: 'pal.t.hearth', cave: 'pal.t.cave',
} as const;

/** Every tile palette. */
export function tilePalettes(): Palette[] {
  return [
    tilePalette('meadow', 'Meadow', ['#183018', ...GRASS_RAMP,
      '#205c30', '#36883c', '#5cb050', '#98dc70', '#f8f8e8', '#e85868', '#f8d050', '#90a0f8', '#a83048']),
    tilePalette('rock', 'Stone on grass', ['#20242c', ...GRASS_RAMP,
      '#474c5c', '#686e80', '#8c92a2', '#b2b8c2', '#dce0e4', '#403840', '#5e5460', '#807482', '#0c0c10']),
    tilePalette('wood', 'Wood on grass', ['#281810', ...GRASS_RAMP,
      '#482818', '#6e4424', '#966232', '#bc8a50', '#dcb474', '#ecd4a0', '#c49a64', '#5c8038']),
    tilePalette('tree', 'Trees', ['#0c2018', ...GRASS_RAMP,
      '#18402c', '#26603a', '#388444', '#58a84c', '#98d068', '#3c2414', '#5c3a20', '#84582e', '#a87c48']),
    tilePalette('earth', 'Earth', ['#2c1c14', ...GRASS_RAMP,
      '#5a3a22', '#7e5432', '#a47444', '#c49460', '#e0b87c', '#100808', '#382418', '#d4ac74', '#ecd09c']),
    tilePalette('sand', 'Sand', ['#4c3c24', ...GRASS_RAMP,
      '#a08858', '#c0a870', '#d8c48c', '#e8d8a4', '#f8f0cc', '#e8a8a0']),
    tilePalette('water', 'Water', ['#1c3024', ...GRASS_RAMP,
      '#5c4028', '#86603c', '#1c3470', '#244c98', '#306cb8', '#4c90d4', '#88c0e8', '#e0f4f8']),
    tilePalette('shallow', 'Shallow water', ['#203040', ...GRASS_RAMP,
      '#3c808c', '#589ca0', '#74b4b0', '#a4d4c8', '#306878', '#5c9cd8', '#dcf4f0', '#e8f8f8']),
    tilePalette('mountain', 'Mountain', ['#281c18', ...GRASS_RAMP,
      '#3e2e2a', '#5e463a', '#846650', '#a88a68', '#ccb088', '#0c0808', '#7c6e5c', '#9c8c74', '#bcae94']),
    tilePalette('roof', 'Roof', ['#281010',
      '#5a1e1e', '#802c26', '#a84430', '#c86440', '#e48c5c', '#4c2c18', '#6e4424', '#966232', '#c09058',
      '#40404c', '#60606e', '#8c8c98']),
    tilePalette('house', 'House front', ['#241810',
      '#a08870', '#c8b494', '#e4d4b4', '#f8f0d8', '#4a2c1c', '#6e4428', '#966238', '#56505a', '#847c84',
      '#c07c2c', '#f0b848', '#f8e8a0', '#140c08', '#302018']),
    tilePalette('stone', 'Castle stone', ['#1c1c24',
      '#3c3c4a', '#5a5c6a', '#7a7e8a', '#9ca0aa', '#bcc0c6', '#dcdee0', '#3c5c34', '#5a803c', '#2a2a34']),
    tilePalette('dungeon', 'Dungeon', ['#10101c', '#060608', ...DFLOOR_RAMP,
      '#1c2c38', '#304658', '#486474', '#688894', '#96b4bc', '#b0b8c4', '#e8eef4', '#d8a840']),
    tilePalette('dprops', 'Dungeon props', ['#10101c', '#060608', ...DFLOOR_RAMP,
      '#4c2014', '#843c24', '#b86838', '#e0a060', '#5c1424', '#962432', '#c84448', '#f0c850']),
    tilePalette('interior', 'Interior', ['#1c120c', ...WOOD_FLOOR_RAMP,
      '#a89078', '#d0bc9c', '#ece0c4', '#2c1a12', '#4a2e1c', '#6a4428', '#84bce4', '#dcf0f8', '#a83c30']),
    tilePalette('furniture', 'Furniture', ['#1c120c', ...WOOD_FLOOR_RAMP,
      '#48220e', '#743c1c', '#a0602e', '#cc9050', '#ecece4', '#2c3c80', '#4c70c0', '#b83c38', '#dcb048']),
    tilePalette('hearth', 'Hearth', ['#1c120c', ...WOOD_FLOOR_RAMP,
      '#4c4448', '#6c6468', '#908888', '#b8b0ac', '#b02c14', '#ec6c1c', '#f8b830', '#f8f0a8', '#140c0c']),
    tilePalette('cave', 'Cave', ['#140c10',
      '#2e2428', '#443836', '#5c4e4a', '#766660', '#948478', '#1e161c', '#34282c', '#4e4042', '#6c5a58', '#907a72',
      '#f8f0c8', '#dccc98', '#a89870']),
  ];
}
