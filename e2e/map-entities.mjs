// Map tab entity editing on #/edit/sample: choose a type (ctx.selectEntityType,
// as the entity palette does) and click to place it snapped to the tile centre,
// select + drag to move, arrow-key nudges merged into one undo step, Ctrl+D,
// Delete, undo, hidden-entity drawing, and the canvas context menu (playtest
// from here, set project start, add warp).

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
  /** Client point of room pixel (px, py). */
  return (px, py) => ({ x: x0 + (px - a.x - 0.5) * s, y: y0 + (py - a.y - 0.5) * s });
}

const entities = (t) => t.eval(() => window.__qf.editor.ctx.room().entities.map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, props: e.props })));
const undo = (t) => t.eval(() => ({ label: window.__qf.editor.ctx.undo.peekUndo(), n: window.__qf.editor.ctx.undo.done.length }));

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
  const at = await calibrate(t);
  const before = await entities(t);

  // ---- Choose a type: the map switches to the entity tool; a click places it at the tile centre.
  await t.eval(() => window.__qf.editor.ctx.selectEntityType('enemy.soldier'));
  await t.wait(60);
  const tool = await t.eval(() => document.querySelector('.qf-map-tool--active')?.dataset.tool);
  t.assert(tool === 'entity', `choosing an entity type activates the entity tool (${tool})`);
  let p = at(5 * 16 + 3, 5 * 16 + 12);
  await page.mouse.move(p.x, p.y);
  await t.wait(60);
  await t.shot('placement-ghost');
  await page.mouse.click(p.x, p.y);
  await t.wait(60);
  let list = await entities(t);
  const placed = list.find((e) => !before.some((b) => b.id === e.id));
  t.assert(placed && placed.type === 'enemy.soldier' && placed.x === 88 && placed.y === 88, `soldier placed snapped to the tile centre (${JSON.stringify(placed)})`);
  t.assert(placed?.props.variant === 'green' && /^e_/.test(placed?.id ?? ''), 'placed with default props and a fresh id');
  t.assert((await undo(t)).label === 'Place Soldier', 'placement is one undo step');
  t.assert(await t.eval(() => window.__qf.editor.ctx.entityId) === placed?.id, 'the new entity is selected');

  // ---- Esc leaves placement mode; drag moves (snapped), a plain click does not move.
  await page.keyboard.press('Escape');
  t.assert(await t.eval(() => window.__qf.editor.ctx.entityType) === null, 'Esc stops placing');
  p = at(88, 86);
  await page.mouse.click(p.x, p.y);
  await t.wait(40);
  list = await entities(t);
  t.assert(list.find((e) => e.id === placed.id)?.x === 88, 'clicking an entity selects it without moving it');
  const q = at(8 * 16 + 6, 5 * 16 + 5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
  await t.wait(60);
  list = await entities(t);
  let moved = list.find((e) => e.id === placed.id);
  t.assert(moved?.x === 136 && moved?.y === 88, `drag moved it one tile grid step at a time (${moved?.x}, ${moved?.y})`);
  t.assert((await undo(t)).label === 'Move entity', 'a drag is one undo step');

  // ---- Arrow nudges merge into one undo step.
  const n0 = (await undo(t)).n;
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await t.wait(40);
  moved = (await entities(t)).find((e) => e.id === placed.id);
  t.assert(moved?.x === 139 && moved?.y === 96, `arrows nudge 1 px, Shift+arrow 8 px (${moved?.x}, ${moved?.y})`);
  const u = await undo(t);
  t.assert(u.n === n0 + 1 && u.label === 'Nudge entity', `consecutive nudges are one undo step (${JSON.stringify(u)})`);

  // ---- Duplicate, delete, undo.
  await page.keyboard.press('Control+KeyD');
  await t.wait(40);
  list = await entities(t);
  const copy = list.find((e) => e.id !== placed.id && !before.some((b) => b.id === e.id));
  t.assert(copy && copy.type === 'enemy.soldier' && copy.x === moved.x + 16, `Ctrl+D duplicates one tile to the side (${JSON.stringify(copy)})`);
  await page.keyboard.press('Delete');
  await t.wait(40);
  t.assert(!(await entities(t)).some((e) => e.id === copy?.id), 'Delete removes the selected entity');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(40);
  t.assert((await entities(t)).some((e) => e.id === copy?.id), 'Ctrl+Z restores it');

  // ---- Hidden entities draw translucent with an eye-slash.
  await t.eval((id) => {
    const ctx = window.__qf.editor.ctx;
    ctx.room().entities.find((e) => e.id === id).props.hidden = true;
    ctx.changed('entities', ctx.roomId);
  }, copy?.id);
  await t.wait(60);
  await t.shot('entities');

  // ---- Context menu: set the start here (undoable), add a warp, playtest from here.
  const spot = at(3 * 16 + 8, 3 * 16 + 8);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await t.wait(60);
  const items = await t.eval(() => [...document.querySelectorAll('.qf-map-menu__item')].map((b) => b.textContent));
  t.log('menu', items);
  t.assert(items.some((s) => s.startsWith('Playtest from here')), 'context menu offers "Playtest from here"');
  await t.shot('context-menu');
  await page.click('.qf-map-menu__item:has-text("Set project start here")');
  await t.wait(40);
  const start = await t.eval(() => window.__qf.editor.ctx.project.start);
  const roomId = await t.eval(() => window.__qf.editor.ctx.roomId);
  t.assert(start.room === roomId && start.x === 56 && start.y === 56, `project start moved to the clicked tile (${JSON.stringify(start)})`);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(40);
  t.assert((await t.eval(() => window.__qf.editor.ctx.project.start.x)) !== 56 || start.x !== 56, 'setting the start is undoable');

  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.click('.qf-map-menu__item:has-text("Add warp here")');
  await t.wait(40);
  const warp = (await entities(t)).find((e) => e.type === 'marker.warp' && e.x === 56 && e.y === 56);
  t.assert(!!warp, 'Add warp here places a warp marker on the tile');

  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.click('.qf-map-menu__item:has-text("Playtest from here")');
  const opened = await t.until(() => !!document.querySelector('.qf-playtest'), undefined, 5000);
  t.assert(opened, 'playtest overlay opened');
  await t.wait(700);
  await t.shot('playtest-from-here');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'), undefined, 5000);
  await t.wait(200);
  t.assert(await t.eval(() => document.querySelector('.qf-map-canvas')?.width > 0), 'back in the editor after Escape');
}
