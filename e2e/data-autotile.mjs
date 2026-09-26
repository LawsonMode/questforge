// Visual check of terrain autotiling against the current default tile art:
// paints water / path / pit / plateau blobs (with notches for inner corners)
// into a 2x1-screen room and draws its layers straight from tile pixels. A path
// "bridge" painted across a pool shows resolveTerrainsAround fixing the water borders.
export default async function (t) {
  await t.goto('#/');
  const info = await t.eval(async () => {
    const pr = await import('/src/core/project.ts');
    const at = await import('/src/core/autotile.ts');
    const { T } = await import('/src/content/ids.ts');
    const p = pr.createBlankProject('Autotile');
    const room = pr.createRoom({ name: 'A', gx: 0, gy: 0, gw: 2, fill: T.GRASS });
    const terrain = Object.fromEntries(p.terrains.map((x) => [x.id, x]));
    const rect = (x, y, w, h) => {
      const cells = [];
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) cells.push({ tx, ty });
      return cells;
    };
    // Water: 6x5 lake with a notch (inner corners) and a 1-wide inlet.
    at.paintTerrain(room, terrain.water, rect(1, 1, 6, 5));
    at.paintTerrain(room, terrain.water, [{ tx: 6, ty: 1 }, { tx: 1, ty: 5 }], { erase: true, eraseTo: T.GRASS });
    at.paintTerrain(room, terrain.water, rect(3, 6, 1, 3));
    // Pool crossed by a vertical path; other terrains are re-resolved around the path.
    at.paintTerrain(room, terrain.water, rect(1, 10, 7, 3));
    const bridge = rect(4, 9, 1, 5);
    at.paintTerrain(room, terrain.path, bridge);
    const around = at.resolveTerrainsAround(room, p.terrains, bridge);
    // Path: a plus shape (all inner corners) plus a single tile.
    at.paintTerrain(room, terrain.path, [...rect(9, 2, 3, 7), ...rect(8, 4, 5, 3)]);
    at.paintTerrain(room, terrain.path, [{ tx: 14, ty: 2 }]);
    // Plateau: a block with a bite taken out.
    at.paintTerrain(room, terrain.plateau, rect(17, 1, 6, 5));
    at.paintTerrain(room, terrain.plateau, rect(21, 4, 2, 2), { erase: true, eraseTo: T.GRASS });
    // Pit on dungeon floor: ring shape.
    for (const c of rect(17, 7, 12, 6)) room.layers.bg[c.ty * 32 + c.tx] = T.DFLOOR;
    at.paintTerrain(room, terrain.pit, rect(18, 8, 5, 4));
    at.paintTerrain(room, terrain.pit, [{ tx: 20, ty: 9 }, { tx: 20, ty: 10 }], { erase: true, eraseTo: T.DFLOOR });
    at.paintTerrain(room, terrain.pit, rect(25, 8, 2, 4));

    const cols = pr.roomCols(room);
    const rows = pr.roomRows(room);
    const canvas = document.createElement('canvas');
    canvas.width = cols * 16;
    canvas.height = rows * 16;
    canvas.style.cssText = 'width:1024px;height:448px;image-rendering:pixelated;display:block;margin:8px';
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(canvas.width, canvas.height);
    let missing = 0;
    for (const layer of ['bg', 'fg', 'over']) {
      room.layers[layer].forEach((id, i) => {
        if (id === 0) return;
        const tile = pr.tileById(p, id);
        const pal = tile && pr.paletteById(p, tile.palette);
        if (!tile || !pal) {
          missing++;
          return;
        }
        const frame = tile.frames[0];
        const ox = (i % cols) * 16;
        const oy = Math.floor(i / cols) * 16;
        for (let k = 0; k < 256; k++) {
          const ci = parseInt(frame[k], 16);
          if (!ci) continue;
          const hex = pal.colors[ci];
          const o = ((oy + (k >> 4)) * canvas.width + ox + (k & 15)) * 4;
          img.data[o] = parseInt(hex.slice(1, 3), 16);
          img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
          img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
          img.data[o + 3] = 255;
        }
      });
    }
    ctx.putImageData(img, 0, 0);
    document.body.textContent = '';
    document.body.style.background = '#202020';
    document.body.appendChild(canvas);
    const tileAt = (tx, ty) => room.layers.bg[ty * cols + tx];
    return {
      missing,
      lakeInner: tileAt(5, 2) === terrain.water.ine,
      plusInner: tileAt(9, 4) === terrain.path.inw,
      single: tileAt(14, 2) === terrain.path.nw,
      inlet: [tileAt(3, 6), tileAt(3, 7), tileAt(3, 8)].join() === [terrain.water.w, terrain.water.w, terrain.water.sw].join(),
      poolSides: tileAt(3, 11) === terrain.water.e && tileAt(5, 11) === terrain.water.w,
      aroundChanges: around.length,
      problems: (await import('/src/core/validate.ts')).validateProject(p).length,
    };
  });
  t.log(info);
  t.assert(info.missing === 0, 'every painted tile id resolves to a tile + palette');
  t.assert(info.lakeInner && info.plusInner && info.single, 'expected pieces at probe cells');
  t.assert(info.inlet, '1-wide inlet keeps one border side (w, w, sw)');
  t.assert(info.poolSides && info.aroundChanges > 0, 'resolveTerrainsAround re-borders the water beside the path');
  await t.shot('terrains');
  // 4x close-up of the left screen (lake, inlet, bridge pool, path plus).
  await t.eval(() => {
    const canvas = document.querySelector('canvas');
    canvas.style.width = '2048px';
    canvas.style.height = '896px';
    canvas.style.margin = '0';
  });
  await t.shot('terrains-zoom');
}
