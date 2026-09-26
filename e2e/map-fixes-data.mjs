// Map tab review fixes, data side, on #/edit/sample: a marquee never outlives a
// room resize, walled rooms grow by moving their far walls (doorways, carpets
// and markers move with them) and shrink back exactly, redoing a room delete
// keeps a room selected, deleting another world keeps the selection, entity
// placement ignores clicks outside the room, the Walls group only shows for
// walled rooms, tile-art events repaint thumbnails cheaply and the recent tiles
// use one per-browser setting.

const holdHmr = (t) => t.page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      if (args[1] !== 'vite-hmr') return new target(...args);
      return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} });
    },
  });
});

/** Room pixel under a client point, read from the status bar (null off the room). */
async function pixelAt(t, x, y) {
  await t.page.mouse.move(x, y);
  await t.wait(40);
  return t.eval(() => {
    const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
    const m = /(-?\d+), (-?\d+) px/.exec(text);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
}

/** Client point of room pixel (px, py), calibrated from the status bar. */
async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await pixelAt(t, x0, y0);
  const b = await pixelAt(t, x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  return (px, py) => ({ x: x0 + (px - a.x - 0.5) * s, y: y0 + (py - a.y - 0.5) * s });
}

const select = (t, world, room) => t.eval(([w, r]) => window.__qf.editor.ctx.selectRoom(w, r), [world, room]);
const sel = (t) => t.eval(() => ({ w: window.__qf.editor.ctx.worldId, r: window.__qf.editor.ctx.roomId }));
const roomTab = (t) => t.page.click('.qf-map-right .qf-tab >> text=Room');
const hint = (t) => t.eval(() => document.querySelector('.qf-map-status__hint').textContent);

/** Pick a size in the Room tab (0 = width, 1 = height), confirming the shrink dialog when one asks. */
async function setSize(t, which, value) {
  await t.page.locator('.qf-map-props__size select').nth(which).selectOption(value);
  await t.wait(150);
  if (await t.eval(() => !!document.querySelector('.qf-modal'))) {
    await t.page.click('.qf-modal__footer .qf-btn--danger');
    await t.wait(150);
  }
}

export default async function (t) {
  await holdHmr(t);
  const { page } = t;
  await t.goto('#/edit/sample');
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  t.assert(await t.eval(() => Object.keys(localStorage).filter((k) => k.startsWith('questforge:map.recent.')).length) === 0,
    'opening the editor writes no per-project recent-tiles key');

  // ---- a stale marquee: select the whole 2x1 village, shrink it, copy
  await select(t, 'ellendor', 'ow_village');
  await t.wait(200);
  await page.click('.qf-map-status');
  await page.keyboard.press('s');
  await page.keyboard.press('Control+a');
  await t.wait(60);
  t.assert((await hint(t)).includes('32×14 tiles'), `Ctrl+A selected the 2x1 room (${await hint(t)})`);
  await roomTab(t);
  await setSize(t, 0, '1');
  t.assert(!(await hint(t)).includes('tiles on'), `the marquee was dropped by the resize (${await hint(t)})`);
  await page.click('.qf-map-status');
  await page.keyboard.press('Control+c');
  await t.wait(60);
  t.assert((await hint(t)).includes('Select an area first'), 'Ctrl+C after the resize copies nothing');
  t.assert(await t.eval(() => !document.querySelector('.qf-map-props__group .qf-map-props__gtitle') ||
    ![...document.querySelectorAll('.qf-map-props__gtitle')].some((e) => e.textContent === 'Walls')), 'no Walls group for an overworld grass room');
  await t.shot('village-shrunk');
  await page.keyboard.press('Control+z');
  await t.wait(100);

  // ---- a real dungeon room grows by moving its bottom wall (doorway, carpet, warp marker follow)
  await select(t, 'hollow_keep', 'kp_entrance');
  await t.wait(200);
  const before = await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room()));
  const marker = await t.eval(() => {
    const r = window.__qf.editor.ctx.room();
    const warps = r.entities.filter((e) => e.type === 'marker.warp').sort((a, b) => b.y - a.y);
    return warps[0] ? { id: warps[0].id, y: warps[0].y } : null;
  });
  t.assert(await t.eval(() => [...document.querySelectorAll('.qf-map-props__gtitle')].some((e) => e.textContent === 'Walls')), 'dungeon rooms offer the Walls group');
  await setSize(t, 1, '2');
  const grown = await t.eval(() => {
    const r = window.__qf.editor.ctx.room();
    const bg = (x, y) => r.layers.bg[y * 16 + x];
    return { rows: r.gh * 14, bl: bg(0, 27), br: bg(15, 27), door: [bg(7, 27), bg(8, 27)], carpet: bg(7, 20), side: [bg(0, 20), bg(15, 20)], mid: bg(3, 20), entities: r.entities };
  });
  t.assert(grown.rows === 28 && grown.bl === T.DWALL_BL && grown.br === T.DWALL_BR, `the bottom wall moved to the new edge (${JSON.stringify(grown)})`);
  t.assert(grown.door.every((id) => id !== T.DWALL_BOTTOM), 'the bottom doorway moved with the wall');
  t.assert(grown.side[0] === T.DWALL_LEFT && grown.side[1] === T.DWALL_RIGHT, 'the side walls run down the new screen');
  t.assert(grown.carpet === T.CARPET && grown.mid === T.DFLOOR, 'the carpet runs on; the rest is floor');
  if (marker) {
    const moved = grown.entities.find((e) => e.id === marker.id);
    t.assert(moved && moved.y === marker.y + 14 * 16, `the exit warp marker moved with the doorway (${marker.y} -> ${moved?.y})`);
  }
  await t.shot('entrance-grown');
  await setSize(t, 1, '1');
  t.assert(await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room())) === before, 'shrinking back restores the room exactly');

  // ---- redo of a room delete keeps a room selected
  await select(t, 'hollow_keep', 'kp_guard_hall');
  await t.wait(150);
  await page.click('.qf-map-left__actions >> text=Delete');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.wait(150);
  const afterDelete = await sel(t);
  t.assert(afterDelete.r && afterDelete.r !== 'kp_guard_hall', `deleting selects a neighbour (${afterDelete.r})`);
  await page.click('.qf-map-status');
  await page.keyboard.press('Control+z');
  await t.wait(100);
  t.assert((await sel(t)).r === 'kp_guard_hall', 'undo shows the restored room');
  await page.keyboard.press('Control+y');
  await t.wait(150);
  const afterRedo = await sel(t);
  t.assert(afterRedo.r && afterRedo.r !== 'kp_guard_hall', `redo keeps a room selected (${afterRedo.r})`);
  t.assert(await t.eval(() => document.querySelector('.qf-map-empty').hidden), 'the canvas shows a room after the redo');
  await t.shot('after-redo-delete');
  await page.keyboard.press('Control+z');
  await t.wait(100);

  // ---- deleting another world keeps the selection
  await select(t, 'ellendor', 'ow_village');
  await t.wait(150);
  const mine = await sel(t);
  await page.click('.qf-map-world >> text=Ellendor Homes', { button: 'right' });
  await page.click('.qf-map-menu__item >> text=Delete world…');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.wait(150);
  const still = await sel(t);
  t.assert(still.w === mine.w && still.r === mine.r, `deleting another world keeps the selection (${JSON.stringify(still)})`);
  await page.click('.qf-map-status');
  await page.keyboard.press('Control+z');
  await t.wait(100);
  t.assert(await t.eval(() => window.__qf.editor.ctx.project.worlds.length) === 3, 'undo brings the world back');

  // ---- no entity placement outside the room
  await select(t, 'hollow_keep', 'kp_beetle_pits');
  await t.wait(200);
  await t.eval(() => window.__qf.editor.ctx.selectEntityType('enemy.bat'));
  await t.wait(100);
  const at = await calibrate(t);
  const count = () => t.eval(() => window.__qf.editor.ctx.room().entities.length);
  const n0 = await count();
  const below = at(128, 224 + 20);
  await page.mouse.click(below.x, below.y);
  await t.wait(80);
  t.assert(await count() === n0, 'a click on the neighbour strip below the room places nothing');
  t.assert((await hint(t)).includes('Click inside the room'), 'and says why');
  const inside = at(128, 200);
  await page.mouse.click(inside.x, inside.y);
  await t.wait(80);
  t.assert(await count() === n0 + 1, 'a click inside the room still places the bat');
  await t.shot('placed-inside');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await t.wait(80);

  // ---- tile art events repaint only what changed; recents use one setting
  const ms = await t.eval(async (grass) => {
    const ctx = window.__qf.editor.ctx;
    const t0 = performance.now();
    ctx.assetsChanged('tile', grass);
    await new Promise((r) => requestAnimationFrame(() => r()));
    return performance.now() - t0;
  }, T.GRASS);
  t.log('assetsChanged(tile) incl. one frame', Math.round(ms), 'ms');
  t.assert(ms < 120, `a tile-art event stays cheap (${Math.round(ms)} ms)`);
  await page.click('.qf-map-right .qf-tab >> text=Tiles');
  await t.wait(100);
  await page.click(`.qf-map-tile[data-tile="${T.SAND}"]`);
  const recent = await t.eval(() => ({
    global: localStorage.getItem('questforge:map.recent'),
    perProject: Object.keys(localStorage).filter((k) => k.startsWith('questforge:map.recent.')).length,
  }));
  t.assert(recent.global?.includes(String(T.SAND)) && recent.perProject === 0, `picking a tile records it in the per-browser recent list (${JSON.stringify(recent)})`);
  await t.shot('end');
}
