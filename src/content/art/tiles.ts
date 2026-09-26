// Default tileset art: an original 16x16 SNES-era action-adventure tileset.
// Palettes live in tiles-palettes.ts; painters are grouped by material family
// in tiles-*.ts and mapped here by tile key.
import type { Palette, TileDef } from '../../core/types';
import { Rng, hashSeed } from '../../core/rng';
import { TILE_SPECS } from '../ids';
import { tileDefFromSpec } from './build';
import { buildingPainters } from './tiles-buildings';
import { dungeonPainters } from './tiles-dungeon';
import { groundPainters } from './tiles-ground';
import { interiorPainters } from './tiles-interior';
import type { PainterTable } from './tiles-kit';
import { mountainPainters } from './tiles-mountain';
import { naturePainters } from './tiles-nature';
import { tilePalettes } from './tiles-palettes';
import { terrainPainters } from './tiles-terrain';

/** Every tile painter, keyed by tile key (exactly one per TILE_SPECS entry). */
export function tilePainters(): PainterTable {
  return {
    ...groundPainters,
    ...naturePainters(),
    ...mountainPainters(),
    ...terrainPainters(),
    ...buildingPainters(),
    ...dungeonPainters(),
    ...interiorPainters(),
  };
}

/** Build the default tile palettes and one TileDef per tile spec. */
export function buildTileArt(): { palettes: Palette[]; tiles: TileDef[] } {
  const painters = tilePainters();
  const tiles = TILE_SPECS.map((spec) => {
    const paint = painters[spec.key];
    if (!paint) throw new Error(`tile art: no painter for ${spec.key}`);
    const a = paint(new Rng(hashSeed(`tile.${spec.key}`)));
    return tileDefFromSpec(spec, a.pal, a.frames.map((f) => f.toData()), a.frameTime);
  });
  return { palettes: tilePalettes(), tiles };
}
