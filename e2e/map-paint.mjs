// Map tab tile tools driven with real mouse/keyboard events on #/edit/sample:
// pencil stroke (with gap interpolation), undo/redo (Ctrl+Z/Y), rectangle, fill,
// eraser on the objects layer, eyedropper (I and Alt+click), marquee copy/paste
// & delete, and the terrain brush. Every gesture must be exactly one undo step.

/** Map tile (tx, ty) centres to client coordinates using the status bar's pixel readout. */
async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const read = async (x, y) => {
    await t.page.mouse.move(x, y);
    await t.wait(40);
    return t.eval(() => {
      const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
      const m = /(-?\d+), (-?\d+) px/.exec(text);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });
  };
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await read(x0, y0);
  const b = await read(x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  return (tx, ty) => ({ x: x0 + (tx * 16 + 8 - a.x - 0.5) * s, y: y0 + (ty * 16 + 8 - a.y - 0.5) * s });
}

const layerAt = (t, layer, cells) => t.eval(([layer, cells]) => {
  const room = window.__qf.editor.ctx.room();
  const cols = room.gw * 16;
  return cells.map(([x, y]) => room.layers[layer][y * cols + x]);
}, [layer, cells]);

const undoDepth = (t) => t.eval(() => {
  const u = window.__qf.editor.ctx.undo;
  return { label: u.peekUndo(), n: u.done.length };
});

/**
 * Keep other people's source edits from reloading the page mid-scenario: the
 * Vite HMR socket of this browser context never connects.
 */
const holdHmr = (t) => t.page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      if (args[1] !== 'vite-hmr') return new target(...args);
      return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} });
    },
  });
});

export default async function (t) {
  await holdHmr(t);
  await t.goto('#/edit/sample');
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const cell = await calibrate(t);
  const { page } = t;
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  const orig = await layerAt(t, 'bg', [[2, 2]]);

  const drag = async (from, to, steps = 3) => {
    const a = cell(...from);
    const b = cell(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps });
    await page.mouse.up();
    await t.wait(40);
  };
  const click = async (c, opts) => {
    const p = cell(...c);
    await page.mouse.click(p.x, p.y, opts);
    await t.wait(40);
  };
  const pickPalette = async (id) => {
    await page.click(`.qf-map-palette__scroll .qf-map-tile[data-tile="${id}"] >> nth=-1`);
    await t.wait(30);
  };

  // ---- Pencil: a fast 2-sample drag across 6 tiles must leave no gaps; one undo step.
  await pickPalette(T.SAND);
  t.assert(await t.eval(() => window.__qf.editor.ctx.tile) === T.SAND, 'clicking a palette tile selects the brush');
  await t.press('KeyP');
  const d0 = await undoDepth(t);
  await drag([2, 2], [7, 2], 1);
  const row = await layerAt(t, 'bg', [2, 3, 4, 5, 6, 7].map((x) => [x, 2]));
  t.assert(row.every((id) => id === T.SAND), `pencil stroke painted a gap-free line (${row})`);
  const d1 = await undoDepth(t);
  t.assert(d1.n === d0.n + 1 && d1.label === 'Paint tiles', `a stroke is one undo step (${JSON.stringify(d1)})`);
  await t.shot('pencil-stroke');

  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  const undone = await layerAt(t, 'bg', [[2, 2], [7, 2]]);
  t.assert(undone[0] === orig[0] && undone[1] !== T.SAND, `Ctrl+Z reverts the whole stroke (${undone})`);
  await page.keyboard.press('Control+KeyY');
  await t.wait(60);
  t.assert((await layerAt(t, 'bg', [[2, 2], [7, 2]])).every((id) => id === T.SAND), 'Ctrl+Y redoes it');

  // ---- Rectangle (filled) then Fill inside it.
  await pickPalette(T.STONE_PATH);
  await t.press('KeyR');
  await drag([2, 5], [5, 7]);
  const rect = await layerAt(t, 'bg', [[2, 5], [5, 5], [2, 7], [5, 7], [3, 6]]);
  t.assert(rect.every((id) => id === T.STONE_PATH), `rectangle filled its area (${rect})`);
  t.assert((await layerAt(t, 'bg', [[6, 6]]))[0] !== T.STONE_PATH, 'rectangle stays inside its corners');
  t.assert((await undoDepth(t)).label === 'Fill rectangle', 'rectangle is one undo step');

  await pickPalette(T.DIRT);
  await t.press('KeyF');
  await click([3, 6]);
  const filled = await layerAt(t, 'bg', [[2, 5], [5, 7], [4, 6], [6, 6], [1, 5]]);
  t.assert(filled.slice(0, 3).every((id) => id === T.DIRT) && filled[3] !== T.DIRT && filled[4] !== T.DIRT, `fill flooded exactly the rectangle (${filled})`);
  t.assert((await undoDepth(t)).label === 'Fill area', 'fill is one undo step');

  // ---- Objects layer: paint bushes, erase one.
  await page.keyboard.press(']');
  t.assert(await t.eval(() => window.__qf.editor.ctx.layer) === 'fg', '] switches to the objects layer');
  await pickPalette(T.BUSH);
  await t.press('KeyB');
  await drag([10, 4], [12, 4]);
  await t.press('KeyE');
  await click([11, 4]);
  const bushes = await layerAt(t, 'fg', [[10, 4], [11, 4], [12, 4]]);
  t.assert(bushes[0] === T.BUSH && bushes[1] === 0 && bushes[2] === T.BUSH, `eraser cleared one objects-layer tile (${bushes})`);
  t.assert((await layerAt(t, 'bg', [[11, 4]]))[0] !== 0, 'erasing the objects layer leaves the ground intact');

  // ---- Eyedropper: I + click picks the top-most tile and its layer; Alt+click works from any tile tool.
  await pickPalette(T.SAND);
  await t.press('KeyI');
  await click([12, 4]);
  let sel = await t.eval(() => ({ tile: window.__qf.editor.ctx.tile, layer: window.__qf.editor.ctx.layer }));
  t.assert(sel.tile === T.BUSH && sel.layer === 'fg', `eyedropper picked the bush on fg (${JSON.stringify(sel)})`);
  const tool = await t.eval(() => document.querySelector('.qf-map-tool--active')?.dataset.tool);
  t.assert(tool !== 'eyedropper', `eyedropper returns to the previous tool (${tool})`);
  await page.keyboard.down('Alt');
  await click([3, 2]);
  await page.keyboard.up('Alt');
  sel = await t.eval(() => ({ tile: window.__qf.editor.ctx.tile, layer: window.__qf.editor.ctx.layer }));
  t.assert(sel.tile === T.SAND && sel.layer === 'bg', `Alt+click picked the sand on bg (${JSON.stringify(sel)})`);

  // ---- Select: marquee, copy, paste-follows-cursor + click to stamp, then delete.
  await t.press('KeyS');
  await drag([2, 2], [4, 2]);
  await page.keyboard.press('Control+KeyC');
  await page.keyboard.press('Control+KeyV');
  const target = cell(8, 10);
  await page.mouse.move(target.x, target.y);
  await t.wait(60);
  await t.shot('paste-preview');
  await page.mouse.click(target.x, target.y);
  await t.wait(40);
  const pasted = await layerAt(t, 'bg', [[7, 10], [8, 10], [9, 10], [10, 10]]);
  t.assert(pasted.slice(0, 3).every((id) => id === T.SAND) && pasted[3] !== T.SAND, `paste stamped the 3 copied tiles centred on the cursor (${pasted})`);
  t.assert((await undoDepth(t)).label === 'Paste tiles', 'paste is one undo step');
  await page.keyboard.press('Escape');
  await drag([7, 10], [8, 10]);
  await page.keyboard.press('Delete');
  await t.wait(40);
  const cleared = await layerAt(t, 'bg', [[7, 10], [8, 10], [9, 10]]);
  t.assert(cleared[0] === 0 && cleared[1] === 0 && cleared[2] === T.SAND, `Delete cleared the marquee (${cleared})`);
  await page.keyboard.press('Control+KeyZ');
  await page.keyboard.press('Escape');
  await t.wait(40);

  // ---- Terrain brush (first terrain = water): two strokes make a blob with fitted borders.
  await t.press('KeyT');
  const terrain = await t.eval(() => window.__qf.editor.ctx.terrainId);
  t.assert(terrain !== null, `terrain tool picks a terrain brush (${terrain})`);
  await drag([10, 8], [13, 8]);
  await drag([10, 9], [13, 9]);
  await drag([10, 10], [13, 10]);
  const water = await layerAt(t, 'bg', [[10, 8], [11, 9], [13, 10], [14, 9]]);
  t.assert(water.slice(0, 3).every((id) => id >= 100 && id <= 112), `terrain painted water pieces (${water})`);
  t.assert(water[1] === T.WATER, 'the blob centre is the plain water tile');
  t.assert(water[3] < 100 || water[3] > 112, 'terrain stays inside the stroke');
  t.assert((await undoDepth(t)).label.startsWith('Paint'), 'a terrain stroke is one undo step');
  // Right-drag erases terrain back to the surrounding floor.
  const e0 = cell(13, 8);
  const e1 = cell(13, 10);
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(e1.x, e1.y, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  await t.wait(40);
  const erased = await layerAt(t, 'bg', [[13, 8], [13, 9], [13, 10]]);
  t.assert(erased.every((id) => id < 100 || id > 112), `right-drag erased the whole terrain column, last cell included (${erased})`);
  t.assert(!(await t.eval(() => !!document.querySelector('.qf-map-menu'))), 'terrain right-drag does not open the context menu');

  await t.press('KeyG');
  await t.wait(80);
  await t.shot('after-tools');
  await t.press('KeyG');
}
