// Palettes for the core sprite art. Every palette keeps index 0 transparent and a
// dark COLOURED outline at index 1. Swap palettes (pal.sword.2, pal.boomerang.2)
// share the exact index layout of their base palettes; only the colours differ.
import type { Palette } from '../../core/types';
import { palette } from './build';
import { DUN, PAL as TILE_PAL, tilePalettes } from './tiles-palettes';

export const PAL = {
  hero: 'pal.c.hero',
  sword: 'pal.c.sword',
  sword2: 'pal.sword.2',
  boomerang: 'pal.c.boomerang',
  boomerang2: 'pal.boomerang.2',
  fx: 'pal.c.fx',
  proj: 'pal.c.proj',
  items: 'pal.c.items',
  wood: 'pal.c.wood',
  stone: 'pal.c.stone',
  crystal: 'pal.c.crystal',
  hud: 'pal.c.hud',
  editor: 'pal.c.editor',
} as const;

/** Colour lists (index 0 is transparent; its colour is never drawn). */
const COLORS: Readonly<Record<keyof typeof PAL, readonly string[]>> = {
  // outline, green d/m/l, cap mid, skin shade/skin, hair dark/auburn, leather dark/mid, wood, cream, gold, cap dark
  hero: ['#000000', '#2a1a14', '#1d6a2e', '#3aa344', '#8ad85a', '#2d7249', '#cf7c52', '#f8c898',
    '#8a3218', '#c65a26', '#5e3214', '#9c6230', '#d8a458', '#fcf4dc', '#f0c040', '#184830'],
  // outline, blade d/m/l, guard d/l, grip d/l, gem
  sword: ['#000000', '#1a1c34', '#6878a0', '#b4c4de', '#f6faff', '#9a5c18', '#f0c040', '#4a2410',
    '#8a5028', '#d83838', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
  // level-2 blade: blue-white glow with bright gold guard
  sword2: ['#000000', '#102050', '#2c7cd8', '#7ccaff', '#f0feff', '#c08818', '#fff078', '#283870',
    '#4c70c0', '#40f0e8', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
  // outline, wood l/m/d, tip light/dark, glint
  boomerang: ['#000000', '#2c1810', '#eeb068', '#b86c30', '#744018', '#f86050', '#b02820', '#fff8e0',
    '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
  boomerang2: ['#000000', '#101a48', '#90d0ff', '#3c80e8', '#1e3e90', '#ff6878', '#c01e48', '#ffffff',
    '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
  // outline, white, pale yellow, yellow, orange, red, smoke l/m/d, water l/m, leaf l/d, clay l/d
  fx: ['#000000', '#2a1c34', '#ffffff', '#fff4a8', '#f8d030', '#f08020', '#c83020', '#e8e4dc',
    '#aca8b0', '#6c6878', '#b8ecff', '#4ea4ec', '#90d850', '#34882c', '#dc8c50', '#8a4a28'],
  // outline, white, steel l/m/d, wood l/m/d, fletch red, fire y/o/r, bone l/d, beam
  proj: ['#000000', '#241a24', '#fcfcfc', '#c8d0e0', '#8890a8', '#505870', '#dca464', '#a06430',
    '#603818', '#d83838', '#fff070', '#f08828', '#c02818', '#f4ecd0', '#b8a888', '#60f0ff'],
  // outline, white, green d/m/l, blue d/m/l, red d/m/l, gold d/l, brown, grey
  items: ['#000000', '#1c1428', '#ffffff', '#107a32', '#30c04c', '#a8f488', '#1a3aa0', '#3a7cf0',
    '#9cd4ff', '#8e1828', '#e03838', '#ff9c8c', '#b07818', '#f8d848', '#8a5428', '#98a0b8'],
  // outline, wood d/m/l, gold d/l/hi, iron d/l, clay d/m/l, interior, red gem, blue gem
  wood: ['#000000', '#241410', '#5c3418', '#9a5c2c', '#d09050', '#a87018', '#f8d050', '#fff8d0',
    '#384058', '#8890a8', '#8c4020', '#c86c38', '#f0a868', '#140c10', '#d83040', '#3c70e8'],
  // outline, stone 5-step ramp, void, wood d/m, gold d/l, flame r/o/y, ledge highlight. The outline, ramp, void
  // and ledge are overwritten with the dungeon tile palette's wall colours (stoneColors), so doors painted
  // from the wall tiles, blocks and switches match the room walls exactly.
  stone: ['#000000', '#101020', '#203038', '#304858', '#486878', '#688898', '#98b8c0', '#080808',
    '#5a3018', '#946030', '#a87018', '#f0c848', '#d83818', '#f89020', '#fff080', '#e8f0f8'],
  // outline, red d/m/l, blue d/m/l, white, stone ramp (darkest..highlight), gold
  crystal: ['#000000', '#101020', '#8c1830', '#e04050', '#ff9ca4', '#1c3890', '#3c7cf0', '#a4d6ff',
    '#ffffff', '#203038', '#304858', '#486878', '#688898', '#98b8c0', '#f0c848', '#000000'],
  // outline, white, red d/m/l, empty fill, green d/l, blue d/m, gold d/l, brown, grey l/d
  hud: ['#000000', '#1a0c18', '#ffffff', '#a01828', '#f03838', '#ff9c98', '#4c3448', '#108830',
    '#58e050', '#2040b0', '#5890f8', '#b88018', '#f8d848', '#8a5428', '#b0b8c8', '#585c70'],
  // outline, white, magenta l/d, cyan l/d, yellow l/d, red, green, brown, grey, purple
  editor: ['#000000', '#101018', '#ffffff', '#f048c8', '#901878', '#48e4f4', '#1880a0', '#f8e040',
    '#b08818', '#e83838', '#40c040', '#8a5428', '#a8b0c0', '#8050e0', '#000000', '#000000'],
};

const NAMES: Readonly<Record<keyof typeof PAL, string>> = {
  hero: 'Hero', sword: 'Sword blade', sword2: 'Sword blade (level 2)', boomerang: 'Boomerang',
  boomerang2: 'Boomerang (level 2)', fx: 'Effects', proj: 'Projectiles', items: 'Items & pickups',
  wood: 'Wooden objects', stone: 'Stone objects & doors', crystal: 'Crystal switches & pegs',
  hud: 'HUD icons', editor: 'Editor icons',
};

/** Dungeon tile palette index -> pal.c.stone index for every dungeon wall colour. */
const DUNGEON_TO_STONE: Readonly<Record<number, number>> = {
  [DUN.OUT]: 1, [DUN.K0]: 2, [DUN.K1]: 3, [DUN.K2]: 4, [DUN.K3]: 5, [DUN.K4]: 6, [DUN.VOID]: 7, [DUN.MET_HI]: 15,
};

function dungeonColors(): readonly string[] | undefined {
  return tilePalettes().find((p) => p.id === TILE_PAL.dungeon)?.colors;
}

/** The stone palette colours with the wall colours copied from the dungeon tile palette. */
function stoneColors(): string[] {
  const out = [...COLORS.stone];
  const dungeon = dungeonColors();
  if (dungeon) for (const [from, to] of Object.entries(DUNGEON_TO_STONE)) out[to] = dungeon[Number(from)] ?? out[to]!;
  return out;
}

function rgbDistance(a: string, b: string): number {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  return [16, 8, 0].reduce((d, s) => d + Math.abs(((x >> s) & 255) - ((y >> s) & 255)), 0);
}

/**
 * For every dungeon tile palette index, the pal.c.stone index of the same colour (the nearest wall colour
 * for any index outside the wall ramp). core-doors paints door backgrounds from the real wall tiles with it.
 */
export function dungeonToStoneLut(): number[] {
  const dungeon = dungeonColors() ?? [];
  const stone = stoneColors();
  const wallIdx = Object.values(DUNGEON_TO_STONE);
  return Array.from({ length: 16 }, (_, i) => {
    if (i === 0) return 0;
    const direct = DUNGEON_TO_STONE[i];
    if (direct !== undefined) return direct;
    const c = dungeon[i] ?? '#000000';
    return wallIdx.reduce((best, j) => (rgbDistance(c, stone[j]!) < rgbDistance(c, stone[best]!) ? j : best));
  });
}

/** Every palette used by the core sprites, including the required swaps. */
export function corePalettes(): Palette[] {
  return (Object.keys(PAL) as (keyof typeof PAL)[]).map((k) => {
    const colors = k === 'stone' ? stoneColors() : [...COLORS[k]];
    return palette(PAL[k], NAMES[k], colors);
  });
}
