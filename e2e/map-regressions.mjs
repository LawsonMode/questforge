// Map tab regressions on #/edit/sample: the view survives tab / playtest round
// trips, Space keeps working on focused buttons, Ctrl+A selects the room, Esc
// drops a marquee being dragged, hidden layers refuse edits, Alt+click with the
// terrain brush picks into the pencil, Esc reverts an in-progress stroke or
// entity drag, undo waits for the stroke to end and shows the room it changes,
// the palette leads with the world's kind, Enter submits the new-room dialog,
// overview drags stay on the grid, the Room tab moves rooms on the grid and big
// rooms fit at 50%.

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

/** Map tile (tx, ty) centres to client coordinates using the status bar's pixel readout. */
async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await pixelAt(t, x0, y0);
  const b = await pixelAt(t, x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  return (tx, ty) => ({ x: x0 + (tx * 16 + 8 - a.x - 0.5) * s, y: y0 + (ty * 16 + 8 - a.y - 0.5) * s });
}

const centre = async (t) => {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  return pixelAt(t, box.x + box.width / 2, box.y + box.height / 2);
};
const bgAt = (t, tx, ty) => t.eval(([x, y]) => {
  const r = window.__qf.editor.ctx.room();
  return r.layers.bg[y * r.gw * 16 + x];
}, [tx, ty]);
const undoInfo = (t) => t.eval(() => ({ n: window.__qf.editor.ctx.undo.done.length, label: window.__qf.editor.ctx.undo.peekUndo() }));
const status = (t) => t.eval(() => document.querySelector('.qf-map-status__hint').textContent);
const away = (t) => t.page.mouse.move(5, 880);

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
  const { page } = t;
  await t.goto('#/edit/sample');
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);

  // ---- the view survives an Art-tab round trip and a playtest
  const c0 = await centre(t);
  await page.click('#qf-tab-art');
  await t.wait(400);
  await page.click('#qf-tab-map');
  await t.wait(300);
  const c1 = await centre(t);
  t.assert(c0 && c1 && c0.x === c1.x && c0.y === c1.y, `view unchanged after the Art tab (${JSON.stringify([c0, c1])})`);
  await away(t);
  await page.keyboard.press('F5');
  await t.until(() => !!document.querySelector('.qf-playtest'), null, 8000);
  await t.wait(500);
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'), null, 8000);
  await t.wait(300);
  const c2 = await centre(t);
  t.assert(c2 && c2.x === c0.x && c2.y === c0.y, `view unchanged after a playtest (${JSON.stringify([c0, c2])})`);
  await t.shot('after-round-trips');

  // ---- Space activates a focused toolbar button when the mouse is elsewhere
  await away(t);
  await t.eval(() => document.querySelector('.qf-map-tool[data-tool="fill"]').focus());
  await page.keyboard.press('Space');
  await t.wait(40);
  const tool = await t.eval(() => document.querySelector('.qf-map-tool--active[data-tool]')?.dataset.tool);
  t.assert(tool === 'fill', `Space on the focused Fill button selects it (${tool})`);

  // ---- Ctrl+A from any tool selects the whole room, not the page text
  await t.press('KeyP');
  await page.keyboard.press('Control+KeyA');
  await t.wait(40);
  const sel = await t.eval(() => ({
    tool: document.querySelector('.qf-map-tool--active[data-tool]')?.dataset.tool,
    text: String(window.getSelection()).length,
    hint: document.querySelector('.qf-map-status__hint').textContent,
  }));
  t.assert(sel.tool === 'select' && sel.text === 0 && /^\d+×\d+ tiles/.test(sel.hint), `Ctrl+A selects the room (${JSON.stringify(sel)})`);
  await page.keyboard.press('Escape');

  // ---- Esc while dragging a marquee drops it
  const cellA = await calibrate(t);
  await t.press('KeyS');
  let q = cellA(2, 2);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  q = cellA(5, 4);
  await page.mouse.move(q.x, q.y, { steps: 2 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await t.wait(60);
  t.assert(/^Select — /.test(await status(t)), `Esc dropped the marquee being dragged (${await status(t)})`);

  // ---- a hidden layer refuses edits
  const cell = await calibrate(t);
  await t.press('KeyP');
  await page.click('[data-eye="bg"]');
  const before = await bgAt(t, 5, 5);
  const depth0 = await undoInfo(t);
  let p = cell(5, 5);
  await page.mouse.click(p.x, p.y);
  await t.wait(40);
  t.assert(await bgAt(t, 5, 5) === before && (await undoInfo(t)).n === depth0.n, 'painting a hidden layer changes nothing');
  t.assert(/hidden/.test(await status(t)), `the status bar explains why (${await status(t)})`);
  const cursor = await t.eval(() => document.querySelector('.qf-map-canvas').style.cursor);
  t.assert(cursor === 'not-allowed', `the pencil shows a not-allowed cursor over a hidden layer (${cursor})`);
  await t.shot('hidden-layer');
  await page.click('[data-eye="bg"]');

  // ---- Alt+click with the terrain brush picks the tile and switches to the pencil
  await t.press('KeyT');
  p = cell(6, 6);
  await page.keyboard.down('Alt');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Alt');
  const picked = await t.eval(() => ({ tool: document.querySelector('.qf-map-tool--active[data-tool]')?.dataset.tool, tile: window.__qf.editor.ctx.tile }));
  const under = await t.eval(() => { const r = window.__qf.editor.ctx.room(); const i = 6 * r.gw * 16 + 6; return r.layers.over[i] || r.layers.fg[i] || r.layers.bg[i]; });
  t.assert(picked.tool === 'pencil' && picked.tile === under, `Alt+click picked the tile into the pencil (${JSON.stringify(picked)} vs ${under})`);

  // ---- Esc during a pencil stroke reverts it; Ctrl+Z is held until the stroke ends
  await page.click(`.qf-map-palette__scroll .qf-map-tile[data-tile="${T.SAND}"] >> nth=-1`);
  await t.press('KeyP');
  const row = [3, 4, 5, 6];
  const orig = await Promise.all(row.map((x) => bgAt(t, x, 3)));
  p = cell(3, 3);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = cell(6, 3);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.keyboard.press('Control+KeyZ');
  const mid = await Promise.all(row.map((x) => bgAt(t, x, 3)));
  t.assert(mid.every((id) => id === T.SAND) && (await undoInfo(t)).n === depth0.n, `Ctrl+Z does nothing mid-stroke (${mid})`);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await t.wait(40);
  const after = await Promise.all(row.map((x) => bgAt(t, x, 3)));
  t.assert(JSON.stringify(after) === JSON.stringify(orig) && (await undoInfo(t)).n === depth0.n, `Esc reverted the stroke without an undo step (${after} vs ${orig})`);

  // ---- Esc during an entity drag puts it back
  await t.press('KeyN');
  const ent = await t.eval(() => {
    const e = window.__qf.editor.ctx.room().entities.find((x) => !x.type.startsWith('marker'));
    return { id: e.id, x: e.x, y: e.y };
  });
  p = cell(Math.floor(ent.x / 16), Math.floor(ent.y / 16));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 70, p.y + 40, { steps: 4 });
  const dragged = await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id), ent.id);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await t.wait(40);
  const back = await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id), ent.id);
  t.assert(dragged.x !== ent.x && back.x === ent.x && back.y === ent.y && (await undoInfo(t)).n === depth0.n,
    `Esc mid-drag restored the entity (${JSON.stringify([ent, dragged, back])})`);

  // ---- undo of an edit made in another room shows that room
  await t.press('KeyP');
  p = cell(4, 4);
  await page.mouse.click(p.x, p.y);
  await t.wait(40);
  const roomA = await t.eval(() => window.__qf.editor.ctx.roomId);
  await page.click('.qf-map-world >> nth=0');
  await t.wait(100);
  await away(t);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(100);
  const shown = await t.eval(() => window.__qf.editor.ctx.roomId);
  t.assert(shown === roomA, `undo switched to the edited room (${shown} vs ${roomA})`);

  // ---- the tile palette leads with the current world's kind
  await page.click('.qf-map-right .qf-tab >> text=Tiles');
  await page.click('.qf-map-world >> text=Hollow Keep');
  await t.wait(100);
  const firstGroup = await t.eval(() => document.querySelector('.qf-map-group[data-group^="tag:"]')?.dataset.group);
  t.assert(firstGroup === 'tag:dungeon', `a dungeon world lists dungeon tiles first (${firstGroup})`);
  await page.click('.qf-map-world >> nth=1');
  await t.wait(100);

  // ---- Enter in the new-room dialog creates the room
  const n0 = await t.eval(() => window.__qf.editor.ctx.world().rooms.length);
  await page.click('.qf-map-left__actions .qf-btn >> text=Room');
  await t.until(() => !!document.querySelector('.qf-map-size__grid'));
  await page.keyboard.type(' annex');
  await page.keyboard.press('Enter');
  await t.wait(100);
  const created = await t.eval(() => ({ open: !!document.querySelector('.qf-modal'), n: window.__qf.editor.ctx.world().rooms.length, name: window.__qf.editor.ctx.room()?.name }));
  t.assert(!created.open && created.n === n0 + 1 && / annex$/.test(created.name ?? ''), `Enter created the room (${JSON.stringify(created)})`);

  // ---- overview drags stay on the shown grid
  const drag = await t.eval(async () => {
    const { overviewBounds } = await import('/src/editor/map/worldOverview.ts');
    const ctx = window.__qf.editor.ctx;
    const room = ctx.room();
    const b = overviewBounds(ctx.world().rooms.filter((r) => r.floor === room.floor));
    const c = document.querySelector('.qf-map-overview__canvas').getBoundingClientRect();
    const cw = c.width / b.cols;
    const ch = c.height / b.rows;
    return { id: room.id, x: c.left + (room.gx - b.x0 + 0.5) * cw, y: c.top + (room.gy - b.y0 + 0.5) * ch, ch, b };
  });
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x, drag.y + drag.ch * 12, { steps: 6 });
  await t.shot('overview-drag-clamped');
  await page.mouse.up();
  await t.wait(80);
  const moved = await t.eval((id) => window.__qf.editor.ctx.world().rooms.find((r) => r.id === id), drag.id);
  t.assert(moved.gy + moved.gh <= drag.b.y0 + drag.b.rows, `the dropped room stays inside the grid (${moved.gy} in ${JSON.stringify(drag.b)})`);

  // ---- Room tab: grid position fields move the room (undoable)
  await page.click('.qf-map-right .qf-tab >> text=Room');
  await t.wait(60);
  const gx0 = moved.gx;
  const posX = page.locator('.qf-map-props__pos input').first();
  await posX.fill(String(gx0 + 3));
  await posX.press('Enter');
  await t.wait(80);
  const gx1 = await t.eval(() => window.__qf.editor.ctx.room().gx);
  t.assert(gx1 === gx0 + 3, `Position X moved the room (${gx0} -> ${gx1})`);
  const released = await t.eval(() => document.activeElement === document.body);
  t.assert(released, 'Enter commits the Position field and hands the keyboard back to the map');
  await t.shot('room-position');
  await away(t);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(80);
  t.assert(await t.eval(() => window.__qf.editor.ctx.room().gx) === gx0, 'moving by position is undoable');

  // ---- a 4x4 room fits at 50%; '-' zooms out to 25%
  await t.eval(async () => {
    const ctx = window.__qf.editor.ctx;
    const { buildRoom, addRoom, freeSpot } = await import('/src/editor/map/roomOps.ts');
    const { T } = await import('/src/content/ids.ts');
    const w = ctx.world();
    const at = freeSpot(w, 0, 4, 4, { gx: 10, gy: 10 });
    addRoom(ctx, w.id, buildRoom({ name: 'Great Hall', gx: at.gx, gy: at.gy, gw: 4, gh: 4, floor: 0, fill: T.WOOD_FLOOR, walls: 'house' }));
  });
  await t.wait(200);
  const zoom = () => t.eval(() => document.querySelector('.qf-map-zoom__label').textContent);
  t.assert(await zoom() === '50%', `a 4x4 room fits at 50% (${await zoom()})`);
  await t.shot('big-room-50');
  await away(t);
  await page.keyboard.press('Minus');
  await t.wait(60);
  t.assert(await zoom() === '25%', `'-' zooms out to 25% (${await zoom()})`);
  await page.keyboard.press('Minus');
  t.assert(await zoom() === '25%', '25% is the smallest zoom');
  await t.shot('big-room-25');
}
