import { describe, expect, it } from 'vitest';
import type { Terrain } from '../src/core/types';
import { TERRAIN_PIECES } from '../src/gfx/artCheck';
import { demoPieces } from '../src/editor/art/terrainEditor';

/** A terrain whose 13 pieces are the ids 1..13 in TERRAIN_PIECES order. */
const numbered = Object.fromEntries(TERRAIN_PIECES.map((k, i) => [k, i + 1])) as unknown as Terrain;

describe('art terrain demo', () => {
  it('shows every one of the 13 pieces', () => {
    const used = new Set(demoPieces({ ...numbered, id: 't', name: 'T', layer: 'bg' }));
    for (let id = 1; id <= 13; id++) expect(used.has(id), `piece ${TERRAIN_PIECES[id - 1]}`).toBe(true);
  });

  it('leaves the surroundings empty and fills a 12x9 scene', () => {
    const cells = demoPieces({ ...numbered, id: 't', name: 'T', layer: 'bg' });
    expect(cells).toHaveLength(12 * 9);
    expect(cells[0]).toBe(0);
    expect(cells[12 * 9 - 1]).toBe(0);
  });
});
