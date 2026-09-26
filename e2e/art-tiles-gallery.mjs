// Tile art in the browser: every default tile draws in the gallery with no
// problem badge, the four terrain demos render, a small village composed from
// the real tiles module renders through Vite, and (if the engine boots) the
// test overworld at native resolution.

/** Draw a tile scene into a fresh canvas using the palette-indexed data (page context). */
async function composeVillage(t) {
  return t.eval(async () => {
    const { buildTileArt } = await import('/src/content/art/tiles.ts');
    const { buildTerrains } = await import('/src/content/art/index.ts');
    const { T } = await import('/src/content/ids.ts');
    const { tiles, palettes } = buildTileArt();
    const byId = new Map(tiles.map((x) => [x.id, x]));
    const pals = new Map(palettes.map((p) => [p.id, p]));
    const W = 12;
    const H = 8;
    const bg = new Array(W * H).fill(T.GRASS);
    const fg = new Array(W * H).fill(0);
    const over = new Array(W * H).fill(0);
    const water = buildTerrains().find((tr) => tr.id === 'water');
    const pond = (x, y) => x >= 6 && x <= 10 && y >= 4 && y <= 6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!pond(x, y)) continue;
        const n = pond(x, y - 1), s = pond(x, y + 1), e = pond(x + 1, y), w = pond(x - 1, y);
        let id = water.center;
        if (!n && !e) id = water.ne; else if (!n && !w) id = water.nw; else if (!s && !e) id = water.se; else if (!s && !w) id = water.sw;
        else if (!n) id = water.n; else if (!s) id = water.s; else if (!e) id = water.e; else if (!w) id = water.w;
        bg[y * W + x] = id;
      }
    }
    const roof = [['ROOF_TL', 'ROOF_T', 'ROOF_TR'], ['ROOF_BL', 'ROOF_B', 'ROOF_BR'], ['HOUSE_WINDOW', 'HOUSE_DOOR', 'HOUSE_WALL']];
    roof.forEach((row, ry) => row.forEach((k, rx) => { bg[(1 + ry) * W + 1 + rx] = T[k]; }));
    over[1 * W + 8] = T.TREE_TL; over[1 * W + 9] = T.TREE_TR; fg[2 * W + 8] = T.TREE_BL; fg[2 * W + 9] = T.TREE_BR;
    for (const [x, y] of [[5, 1], [1, 5], [3, 6]]) fg[y * W + x] = T.BUSH;
    for (const [x, y] of [[4, 2], [5, 2], [2, 6]]) bg[y * W + x] = T.FLOWERS;
    for (let x = 1; x <= 4; x++) fg[5 * W + x + 1] = x === 1 ? T.FENCE_POST : T.FENCE_H;
    const S = 3;
    const cv = document.createElement('canvas');
    cv.id = 'qf-tile-scene';
    cv.width = W * 16 * S;
    cv.height = H * 16 * S;
    cv.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;image-rendering:pixelated;border:2px solid #000';
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(cv.width, cv.height);
    let drawn = 0;
    for (const layer of [bg, fg, over]) {
      layer.forEach((id, i) => {
        const tile = byId.get(id);
        if (!tile) return;
        const cols = pals.get(tile.palette).colors;
        const f = tile.frames[0];
        for (let p = 0; p < 256; p++) {
          const v = parseInt(f[p], 16);
          if (!v) continue;
          const c = parseInt(cols[v].slice(1), 16);
          for (let yy = 0; yy < S; yy++) {
            for (let xx = 0; xx < S; xx++) {
              const px = ((i % W) * 16 + (p % 16)) * S + xx;
              const py = (Math.floor(i / W) * 16 + Math.floor(p / 16)) * S + yy;
              const o = (py * cv.width + px) * 4;
              img.data[o] = c >> 16; img.data[o + 1] = (c >> 8) & 255; img.data[o + 2] = c & 255; img.data[o + 3] = 255;
            }
          }
        }
        drawn++;
      });
    }
    ctx.putImageData(img, 0, 0);
    document.body.append(cv);
    return { drawn, tiles: tiles.length, palettes: palettes.length };
  });
}

export default async function (t) {
  const specCount = await (async () => {
    await t.goto('#/gallery?section=tiles');
    return t.eval(async () => (await import('/src/content/ids.ts')).TILE_SPECS.length);
  })();
  await t.wait(200);
  const tilesInfo = await t.eval(() => {
    const sec = document.querySelector('[data-section="tiles"]');
    const cells = [...(sec?.querySelectorAll('.qf-gal-item') ?? [])];
    const drawn = cells.filter((cell) => {
      const cv = cell.querySelector('canvas');
      const ctx = cv?.getContext('2d');
      if (!ctx || !cv.width) return false;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    });
    return { cells: cells.length, drawn: drawn.length, badges: sec?.querySelectorAll('.qf-gal-badge').length ?? -1 };
  });
  t.log('tiles', tilesInfo, 'specs', specCount);
  t.assert(tilesInfo.cells === specCount, `gallery shows every tile (${tilesInfo.cells}/${specCount})`);
  t.assert(tilesInfo.drawn === tilesInfo.cells, `every tile cell draws pixels (${tilesInfo.drawn}/${tilesInfo.cells})`);
  t.assert(tilesInfo.badges === 0, `no tile problem badges (${tilesInfo.badges})`);
  await t.shot('gallery-tiles');
  await t.page.mouse.wheel(0, 900);
  await t.wait(150);
  await t.shot('gallery-tiles-scrolled');

  await t.goto('#/gallery?section=terrains');
  await t.wait(300);
  const terr = await t.eval(() => ({
    cards: document.querySelectorAll('.qf-gal-terrain').length,
    badges: document.querySelectorAll('[data-section="terrains"] .qf-gal-badge').length,
  }));
  t.log('terrains', terr);
  t.assert(terr.cards === 4, `four terrain demos (${terr.cards})`);
  t.assert(terr.badges === 0, `no terrain problem badges (${terr.badges})`);
  await t.shot('gallery-terrains');

  const scene = await composeVillage(t);
  t.log('composed scene', scene);
  t.assert(scene.drawn > 96, `composed village draws its tiles (${scene.drawn})`);
  await t.page.locator('#qf-tile-scene').screenshot({ path: `${t.outDir}/village-scene.png` });
  await t.eval(() => document.getElementById('qf-tile-scene')?.remove());

  await t.goto('#/playtest/test');
  const booted = await t.page
    .waitForFunction(() => !!(window.__qf.game && window.__qf.game.services), null, { timeout: 5000 })
    .then(() => true, () => false);
  if (!booted) {
    t.log('playtest did not boot; skipping the in-engine shot');
    return;
  }
  await t.wait(500);
  await t.shotCanvas('engine-overworld');
}
