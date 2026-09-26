// Assembles the default asset set (palettes, tiles, terrains, sprites) that every
// new project and the sample adventure start from.
import type { Palette, SpriteDef, Terrain, TileDef } from '../../core/types';
import { DEFAULT_TERRAINS, T, TERRAIN_PARTS } from '../ids';
import { buildTileArt } from './tiles';
import { buildCoreSpriteArt } from './sprites-core';
import { buildActorSpriteArt } from './sprites-actors';

export interface DefaultAssets {
  palettes: Palette[];
  tiles: TileDef[];
  terrains: Terrain[];
  sprites: SpriteDef[];
}

export function buildTerrains(): Terrain[] {
  return DEFAULT_TERRAINS.map((d) => {
    const id = (suffix: string): number => {
      const v = T[d.base + suffix];
      if (v === undefined) throw new Error(`terrain ${d.id}: missing tile ${d.base}${suffix}`);
      return v;
    };
    const [c, n, s, e, w, ne, nw, se, sw, ine, inw, ise, isw] = TERRAIN_PARTS.map(id) as [
      number, number, number, number, number, number, number, number, number, number, number, number, number,
    ];
    return { id: d.id, name: d.name, layer: d.layer, center: c, n, s, e, w, ne, nw, se, sw, ine, inw, ise, isw };
  });
}

let cached: DefaultAssets | null = null;

function generate(): DefaultAssets {
  const tiles = buildTileArt();
  const core = buildCoreSpriteArt();
  const actors = buildActorSpriteArt();
  const palettes = new Map<string, Palette>();
  for (const p of [...tiles.palettes, ...core.palettes, ...actors.palettes]) {
    if (!palettes.has(p.id)) palettes.set(p.id, p);
  }
  return {
    palettes: [...palettes.values()],
    tiles: [...tiles.tiles].sort((a, b) => a.id - b.id),
    terrains: buildTerrains(),
    sprites: [...core.sprites, ...actors.sprites],
  };
}

/** Fresh deep copy of the default assets (safe to mutate). */
export function createDefaultAssets(): DefaultAssets {
  cached ??= generate();
  return structuredClone(cached);
}
