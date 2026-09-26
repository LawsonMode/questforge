// Asset contact sheets -> e2e-out/sheets/. Skipped unless QF_SHEETS=1:
//   QF_SHEETS=1 npx vitest run tests/tools/sheets.test.ts
// Optional QF_SHEETS_ONLY=tiles|sprites|scenes to limit output.
// Optional QF_SHEETS_SRC=tiles|core|actors renders ONLY that art module (isolates you from siblings' in-progress files).
// Output:
//   e2e-out/sheets/tiles-<group>.png (+ .txt legend: cell -> id key name)   4x scale, each tile shown alone AND as a 2x2 repeat (seam check)
//   e2e-out/sheets/terrain-<id>.png   a blob painted with the terrain's 13 pieces over a surrounding ground
//   e2e-out/sheets/sprite-<id>.png (+ .txt listing anim rows)            4x scale, one row per anim
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createDefaultAssets, buildTerrains, type DefaultAssets } from '../../src/content/art';
import { Raster, drawFrame, renderScene, renderSpriteSheet, writePng } from './png';
import type { Terrain } from '../../src/core/types';
import { T } from '../../src/content/ids';

const OUT = 'e2e-out/sheets';
const only = process.env.QF_SHEETS_ONLY;

async function loadAssets(): Promise<DefaultAssets> {
  const src = process.env.QF_SHEETS_SRC;
  if (!process.env.QF_SHEETS) return { palettes: [], tiles: [], terrains: [], sprites: [] };
  if (src === 'tiles') {
    const m = await import('../../src/content/art/tiles');
    const r = m.buildTileArt();
    return { palettes: r.palettes, tiles: r.tiles, terrains: buildTerrains(), sprites: [] };
  }
  if (src === 'core' || src === 'actors') {
    const m = src === 'core' ? await import('../../src/content/art/sprites-core') : await import('../../src/content/art/sprites-actors');
    const r = 'buildCoreSpriteArt' in m ? m.buildCoreSpriteArt() : m.buildActorSpriteArt();
    return { palettes: r.palettes, tiles: [], terrains: [], sprites: r.sprites };
  }
  return createDefaultAssets();
}

const assets = await loadAssets();

describe.skipIf(!process.env.QF_SHEETS)('asset sheets', () => {
  const pals = new Map(assets.palettes.map((p) => [p.id, p]));
  mkdirSync(OUT, { recursive: true });

  it.skipIf(only && only !== 'tiles')('tiles', () => {
    const groups = new Map<string, typeof assets.tiles>();
    for (const t of assets.tiles) {
      const g = t.id < 100 ? 'overworld' : t.id < 200 ? 'terrain' : t.id < 300 ? 'dungeon' : 'interior-cave';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(t);
    }
    for (const [g, list] of groups) {
      const scale = 4;
      const cell = 16 * scale * 3 + 12; // single + 2x2 repeat side by side
      const perRow = 4;
      const rowsN = Math.ceil(list.length / perRow);
      const r = new Raster(perRow * cell + 8, rowsN * (16 * scale * 2 + 12) + 8);
      const legend: string[] = [];
      list.forEach((t, i) => {
        const pal = pals.get(t.palette);
        const x = 8 + (i % perRow) * cell;
        const y = 8 + Math.floor(i / perRow) * (16 * scale * 2 + 12);
        r.checker(x, y, 16 * scale, 16 * scale, 8);
        if (pal) {
          drawFrame(r, t.frames[0]!, 16, 16, pal, x, y, scale);
          for (let k = 0; k < 4; k++) {
            drawFrame(r, t.frames[0]!, 16, 16, pal, x + 16 * scale + 4 + (k % 2) * 16 * scale, y + Math.floor(k / 2) * 16 * scale, scale);
          }
        }
        legend.push(`row ${Math.floor(i / perRow)} col ${i % perRow}: ${t.id} ${t.key} (${t.name}) frames=${t.frames.length} collision=${t.collision}`);
      });
      writePng(`${OUT}/tiles-${g}.png`, r);
      writeFileSync(`${OUT}/tiles-${g}.txt`, legend.join('\n'));
    }
  });

  it.skipIf(only && only !== 'scenes')('terrain demos', () => {
    const ground: Record<string, number> = { water: T.GRASS!, path: T.GRASS!, pit: T.DFLOOR!, plateau: T.GRASS! };
    for (const tr of assets.terrains as Terrain[]) {
      const cols = 12;
      const rows = 9;
      // Blob shape with a notch (exercises inner corners).
      const inBlob = (x: number, y: number): boolean =>
        x >= 2 && x <= 9 && y >= 2 && y <= 6 && !(x >= 7 && y <= 3) || (x >= 4 && x <= 5 && y === 7);
      const bg: number[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!inBlob(x, y)) {
            bg.push(ground[tr.id] ?? T.GRASS!);
            continue;
          }
          const n = inBlob(x, y - 1), s = inBlob(x, y + 1), e = inBlob(x + 1, y), w = inBlob(x - 1, y);
          let id = tr.center;
          if (!n && !e) id = tr.ne; else if (!n && !w) id = tr.nw; else if (!s && !e) id = tr.se; else if (!s && !w) id = tr.sw;
          else if (!n) id = tr.n; else if (!s) id = tr.s; else if (!e) id = tr.e; else if (!w) id = tr.w;
          else if (!inBlob(x + 1, y - 1)) id = tr.ine; else if (!inBlob(x - 1, y - 1)) id = tr.inw;
          else if (!inBlob(x + 1, y + 1)) id = tr.ise; else if (!inBlob(x - 1, y + 1)) id = tr.isw;
          bg.push(id);
        }
      }
      writePng(`${OUT}/terrain-${tr.id}.png`, renderScene(assets.tiles, assets.palettes, { bg }, cols, rows, 3));
    }
  });

  it.skipIf(only && only !== 'sprites')('sprites', () => {
    for (const s of assets.sprites) {
      const { raster, rows } = renderSpriteSheet(s, assets.palettes, s.w >= 32 ? 3 : 4);
      const safe = s.id.replace(/[^a-z0-9.]/gi, '_');
      writePng(`${OUT}/sprite-${safe}.png`, raster);
      writeFileSync(`${OUT}/sprite-${safe}.txt`, rows.map((r, i) => `row ${i}: ${r} frames=${JSON.stringify(s.anims[r]!.frames)}${s.anims[r]!.flipX ? ' (flipX)' : ''}`).join('\n'));
    }
  });
});
