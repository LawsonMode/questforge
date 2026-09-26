// Map tab world management on #/edit/sample: create a room by double-clicking an
// empty overview cell (size picker, dungeon fill, walls), undo/redo it, drag it
// on the grid (overlaps rejected), wheel zoom around the cursor, Space+drag and
// middle-drag panning, fit, add a world, the location picker and Room-tab resize.

async function readPx(t, x, y) {
  await t.page.mouse.move(x, y);
  await t.wait(40);
  return t.eval(() => {
    const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
    const m = /(-?\d+), (-?\d+) px/.exec(text);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
}

/** Client point of an overview grid cell centre (layout mirrors WorldOverview). */
const overviewCell = (t, gx, gy) => t.eval(async ([gx, gy]) => {
  const { overviewBounds } = await import('/src/editor/map/worldOverview.ts');
  const ctx = window.__qf.editor.ctx;
  const floor = ctx.room()?.floor ?? 0;
  const b = overviewBounds(ctx.world().rooms.filter((r) => r.floor === floor));
  const c = document.querySelector('.qf-map-overview__canvas').getBoundingClientRect();
  const cw = c.width / b.cols;
  const ch = c.height / b.rows;
  return { x: c.left + (gx - b.x0 + 0.5) * cw, y: c.top + (gy - b.y0 + 0.5) * ch };
}, [gx, gy]);

/** An empty grid cell right of the rooms on the selected room's floor. */
const emptyCell = (t) => t.eval(() => {
  const ctx = window.__qf.editor.ctx;
  const floor = ctx.room()?.floor ?? 0;
  const rooms = ctx.world().rooms.filter((r) => r.floor === floor);
  const gy = Math.min(...rooms.map((r) => r.gy));
  return { gx: Math.max(...rooms.map((r) => r.gx + r.gw)), gy };
});

const roomInfo = (t) => t.eval(() => {
  const ctx = window.__qf.editor.ctx;
  const r = ctx.room();
  return r && { id: r.id, name: r.name, gx: r.gx, gy: r.gy, gw: r.gw, gh: r.gh, floor: r.floor, bg0: r.layers.bg[0], count: ctx.world().rooms.length };
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
  const { page } = t;
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  const start = await roomInfo(t);

  // ---- Double-click an empty overview cell -> new room dialog (2x1, dungeon floor, walls).
  const free = await emptyCell(t);
  let p = await overviewCell(t, free.gx, free.gy);
  await page.mouse.dblclick(p.x, p.y);
  await t.until(() => !!document.querySelector('.qf-map-size__grid'));
  await page.click('.qf-map-size__cell[data-w="2"][data-h="1"]');
  await page.click('.qf-map-fill[data-fill="DFLOOR"]');
  await t.wait(60);
  await t.shot('new-room-dialog');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(120);
  const created = await roomInfo(t);
  t.assert(created.count === start.count + 1 && created.id !== start.id, 'a room was created and selected');
  t.assert(created.gx === free.gx && created.gy === free.gy && created.gw === 2 && created.gh === 1, `new room sits on the clicked cell with the chosen size (${JSON.stringify(created)})`);
  t.assert(created.bg0 === T.DWALL_TL, `dungeon floor rooms get a wall border (${created.bg0})`);
  await t.shot('room-created');

  await page.keyboard.press('Control+KeyZ');
  await t.wait(80);
  t.assert((await t.eval(() => window.__qf.editor.ctx.world().rooms.length)) === start.count, 'Ctrl+Z removes the new room');
  await page.keyboard.press('Control+KeyY');
  await t.wait(80);
  t.assert((await roomInfo(t))?.id === created.id, 'Ctrl+Y brings it back selected');

  // ---- Drag the room one row down (free) then onto the start room (rejected).
  p = await overviewCell(t, free.gx, free.gy);
  let q = await overviewCell(t, free.gx, free.gy + 1);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
  await t.wait(100);
  let moved = await roomInfo(t);
  t.assert(moved.gx === free.gx && moved.gy === free.gy + 1, `dragging moved the room on the grid (${moved.gx}, ${moved.gy})`);
  p = await overviewCell(t, moved.gx, moved.gy);
  q = await overviewCell(t, start.gx, start.gy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
  await t.wait(100);
  const kept = await roomInfo(t);
  t.assert(kept.gx === moved.gx && kept.gy === moved.gy, 'dropping onto another room is rejected');

  // ---- Wheel zoom keeps the art pixel under the cursor; Space+drag / middle-drag pan; fit.
  const box = await page.locator('.qf-map-canvas').boundingBox();
  const cx = box.x + box.width / 2 + 30;
  const cy = box.y + box.height / 2 + 20;
  const zoomPct = () => t.eval(() => parseInt(document.querySelector('.qf-map-zoom__label').textContent, 10));
  const z0 = await zoomPct();
  const a0 = await readPx(t, cx, cy);
  await page.mouse.wheel(0, -120);
  await t.wait(80);
  const z1 = await zoomPct();
  const a1 = await readPx(t, cx, cy);
  t.assert(z1 === z0 + 100, `wheel zooms in one step (${z0}% -> ${z1}%)`);
  const s = z1 / 100; // CSS px per art px (deviceScaleFactor 1)
  t.assert(Math.abs(a1.x - a0.x) <= 1 && Math.abs(a1.y - a0.y) <= 1, `zoom keeps the pixel under the cursor (${JSON.stringify([a0, a1])})`);
  await page.keyboard.down('Space');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 90, cy - 60, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const a2 = await readPx(t, cx, cy);
  t.assert(Math.abs(a2.x - (a1.x + 90 / s)) <= 1 && Math.abs(a2.y - (a1.y + 60 / s)) <= 1, `Space+drag pans the view (${JSON.stringify([a1, a2])})`);
  const untouched = await t.eval(() => window.__qf.editor.ctx.undo.peekUndo());
  t.assert(untouched === 'Move room', `panning does not paint (${untouched})`);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 90, cy + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const a3 = await readPx(t, cx, cy);
  t.assert(Math.abs(a3.x - a1.x) <= 1 && Math.abs(a3.y - a1.y) <= 1, `middle-drag pans back (${JSON.stringify([a2, a3])})`);
  await t.shot('zoomed');
  await page.click('.qf-map-zoom__btn[title^="Fit"]');
  await t.wait(60);
  t.assert((await zoomPct()) === z0, 'Fit returns to the fitted zoom');

  // ---- Location picker: banner, click a tile -> target snapped to the tile centre; Esc cancels.
  await t.eval(() => {
    window.__pick = 'pending';
    window.__qf.editor.ctx.pickLocation('test spot').then((r) => { window.__pick = r; });
  });
  await t.until(() => !document.querySelector('.qf-map-pick').hidden);
  await t.shot('pick-banner');
  const fitBox = await page.locator('.qf-map-canvas').boundingBox();
  const px0 = await readPx(t, fitBox.x + fitBox.width / 2, fitBox.y + fitBox.height / 2);
  await page.mouse.click(fitBox.x + fitBox.width / 2, fitBox.y + fitBox.height / 2);
  await t.until(() => window.__pick !== 'pending');
  const picked = await t.eval(() => window.__pick);
  const tile = (v) => Math.floor(v / 16) * 16 + 8;
  t.assert(picked && picked.room === created.id && picked.x === tile(px0.x) && picked.y === tile(px0.y) && picked.dir === 'down',
    `picker resolved the clicked tile centre (${JSON.stringify(picked)})`);
  t.assert(await t.eval(() => document.querySelector('.qf-map-pick').hidden), 'banner hides after picking');
  await t.eval(() => {
    window.__pick = 'pending';
    window.__qf.editor.ctx.pickLocation('another').then((r) => { window.__pick = r; });
  });
  await t.wait(60);
  await page.keyboard.press('Escape');
  await t.until(() => window.__pick !== 'pending');
  t.assert(await t.eval(() => window.__pick === null), 'Esc cancels a pick (null)');

  // ---- Room tab: resize to 2x2 (undoable), walls follow the new size.
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(60);
  await page.selectOption('.qf-map-props__size select >> nth=1', '2');
  await t.wait(80);
  const resized = await t.eval(() => {
    const r = window.__qf.editor.ctx.room();
    return { gw: r.gw, gh: r.gh, bl: r.layers.bg[(r.gh * 14 - 1) * r.gw * 16], label: window.__qf.editor.ctx.undo.peekUndo() };
  });
  t.assert(resized.gw === 2 && resized.gh === 2 && resized.bl === T.DWALL_BL && resized.label === 'Resize room', `Room tab resize re-stamps walls (${JSON.stringify(resized)})`);
  await t.shot('room-resized');

  // ---- Pit target: "Pick on map…" hands over to the location picker.
  await page.click('.qf-map-props button:has-text("Pick on map")');
  await t.until(() => !document.querySelector('.qf-map-pick').hidden);
  const pitBox = await page.locator('.qf-map-canvas').boundingBox();
  await page.mouse.click(pitBox.x + pitBox.width / 2, pitBox.y + pitBox.height / 2);
  await t.wait(100);
  const pit = await t.eval(() => window.__qf.editor.ctx.room().pitTarget ?? null);
  t.assert(pit && pit.room === created.id && pit.x % 16 === 8, `pit target set from the map (${JSON.stringify(pit)})`);
  const pitLabel = await t.eval(() => document.querySelector('.qf-map-props__targetlabel')?.textContent ?? '');
  t.assert(pitLabel.includes('›'), `Room tab shows the pit target (${pitLabel})`);

  // ---- Delete the room through its confirm dialog.
  const beforeDelete = await t.eval(() => window.__qf.editor.ctx.world().rooms.length);
  await page.click('.qf-map-props button:has-text("Delete room")');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.wait(100);
  const afterDelete = await t.eval(() => ({ n: window.__qf.editor.ctx.world().rooms.length, sel: window.__qf.editor.ctx.roomId }));
  t.assert(afterDelete.n === beforeDelete - 1 && afterDelete.sel && afterDelete.sel !== created.id, `room deleted and another selected (${JSON.stringify(afterDelete)})`);

  // ---- Add a world from the worlds list.
  await page.click('.qf-map-left__head .qf-map-iconbtn[title^="New world"]');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.fill('.qf-modal input.qf-input', 'Crypt of Ash');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(120);
  const world = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const w = ctx.world();
    return { name: w.name, kind: w.kind, rooms: w.rooms.length, selected: ctx.roomId === w.rooms[0]?.id, floorsShown: !document.querySelector('.qf-map-left__row:has(.qf-map-left__label)').hidden };
  });
  t.assert(world.name === 'Crypt of Ash' && world.kind === 'dungeon' && world.rooms === 1 && world.selected, `new world created with a starter room (${JSON.stringify(world)})`);
  await t.shot('new-world');

  // ---- Reorder through the world's "⋯" menu.
  const last = await t.eval(() => window.__qf.editor.ctx.project.worlds.length - 1);
  await page.hover(`.qf-map-world >> nth=${last}`);
  await page.click(`.qf-map-world >> nth=${last} >> .qf-map-world__more`);
  await t.until(() => !!document.querySelector('.qf-map-menu'));
  await t.shot('world-menu');
  await page.click('.qf-map-menu__item:has-text("Move up")');
  await t.wait(80);
  const order = await t.eval(() => window.__qf.editor.ctx.project.worlds.map((w) => w.name));
  t.assert(order[last - 1] === 'Crypt of Ash', `Move up reorders the worlds (${order})`);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(80);
  t.assert((await t.eval(() => window.__qf.editor.ctx.project.worlds.at(-1).name)) === 'Crypt of Ash', 'reordering is undoable');
}
