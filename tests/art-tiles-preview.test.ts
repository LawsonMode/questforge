// Close-up previews of the tileset for visual review (skipped unless QF_SHEETS=1):
//   QF_SHEETS=1 npx vitest run tests/art-tiles-preview.test.ts
// Writes e2e-out/sheets/tiles-zoom-<group>.png: each tile as a 3x3 repeat at 4x
// (seams and repetition show up immediately), plus a grass-variant mix.
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildTileArt } from '../src/content/art/tiles';
import { T } from '../src/content/ids';
import { Raster, drawFrame, renderScene, writePng } from './tools/png';

const OUT = 'e2e-out/sheets';

const GROUPS: Record<string, string[]> = {
  ground: ['GRASS', 'GRASS_ALT', 'GRASS_DARK', 'TALL_GRASS', 'FLOWERS', 'PEBBLES', 'DIRT', 'SAND', 'MOUNTAIN_GROUND', 'STONE_PATH',
    'SHALLOW_WATER', 'MOUNTAIN_ROCK'],
  objects: ['BUSH', 'ROCK', 'HEAVY_ROCK', 'STUMP', 'FENCE_H', 'FENCE_V', 'FENCE_POST', 'GRAVESTONE', 'STATUE', 'HOLE', 'STAIRS_DOWN',
    'CAVE_ENTRANCE', 'CRACKED_ROCKWALL', 'CLIFF_STAIRS', 'LEDGE_S', 'LEDGE_N', 'LEDGE_E', 'LEDGE_W', 'BRIDGE_H', 'BRIDGE_V', 'TREE_SMALL'],
  building: ['ROOF_M', 'HOUSE_WALL', 'HOUSE_WINDOW', 'HOUSE_DOOR', 'STONE_WALL', 'STONE_WALL_TOP'],
  dungeon: ['DFLOOR', 'DFLOOR_TILE', 'DFLOOR_ORNATE', 'DFLOOR_CRACKED', 'CARPET', 'DWALL_FILL', 'CRACKED_WALL', 'PILLAR', 'DSTATUE',
    'SPIKES', 'DSTAIRS_UP', 'DSTAIRS_DOWN', 'DPOT', 'DBLOCK'],
  walls: ['DWALL_TOP', 'DWALL_BOTTOM', 'DWALL_LEFT', 'DWALL_RIGHT', 'DWALL_TL', 'DWALL_TR', 'DWALL_BL', 'DWALL_BR',
    'IWALL_TOP', 'IWALL_BOTTOM', 'IWALL_LEFT', 'IWALL_RIGHT', 'IWALL_TL', 'IWALL_TR', 'IWALL_WINDOW', 'PLATEAU_S'],
  roof: ['ROOF_TL', 'ROOF_T', 'ROOF_TR', 'ROOF_L', 'ROOF_M', 'ROOF_R', 'ROOF_BL', 'ROOF_B', 'ROOF_BR', 'PLATEAU_N', 'PLATEAU_E',
    'PLATEAU_W'],
  interior: ['WOOD_FLOOR', 'STONE_FLOOR', 'RUG', 'TABLE', 'STOOL', 'BED_TOP', 'BED_BOTTOM', 'SHELF', 'FIREPLACE', 'IPOT', 'BARREL',
    'CRATE', 'EXIT_MAT', 'CAVE_FLOOR', 'CAVE_WALL', 'CAVE_ROCKS', 'CAVE_EXIT'],
};

describe.skipIf(!process.env.QF_SHEETS)('tile close-ups', () => {
  const { tiles, palettes } = buildTileArt();
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const pals = new Map(palettes.map((p) => [p.id, p]));

  it('zoomed repeats', () => {
    const scale = 4;
    const cell = 16 * scale * 3 + 8;
    for (const [group, keys] of Object.entries(GROUPS)) {
      const perRow = 4;
      const r = new Raster(perRow * cell + 8, Math.ceil(keys.length / perRow) * cell + 8);
      const legend: string[] = [];
      keys.forEach((key, i) => {
        const t = byKey.get(key);
        if (!t) return;
        const pal = pals.get(t.palette)!;
        const x0 = 8 + (i % perRow) * cell;
        const y0 = 8 + Math.floor(i / perRow) * cell;
        for (let k = 0; k < 9; k++) {
          drawFrame(r, t.frames[0]!, 16, 16, pal, x0 + (k % 3) * 16 * scale, y0 + Math.floor(k / 3) * 16 * scale, scale);
        }
        legend.push(`row ${Math.floor(i / perRow)} col ${i % perRow}: ${key}`);
      });
      writePng(`${OUT}/tiles-zoom-${group}.png`, r);
      writeFileSync(`${OUT}/tiles-zoom-${group}.txt`, legend.join('\n'));
    }
  });

  it('grass variant mix', () => {
    const cols = 12;
    const rows = 8;
    const ids = [T.GRASS!, T.GRASS!, T.GRASS_ALT!, T.GRASS!, T.GRASS_DARK!];
    const bg: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) bg.push(x >= 8 && y >= 4 ? T.GRASS_DARK! : ids[(x * 7 + y * 3) % 4]!);
    }
    writePng(`${OUT}/tiles-zoom-grassmix.png`, renderScene(tiles, palettes, { bg }, cols, rows, 3));
  });
});
