// Map tab review fixes on #/edit/sample: paste mode ends when another tool
// takes over, the Entities sidebar picks the entity tool (and Tiles gives the
// brush back), arrows / Delete on a focused sidebar control never touch the
// selected entity, a right-click mid-stroke neither opens the menu nor cuts the
// stroke, map keys work after clicking a checkbox, the music preview stops when
// its tab is left, a location pick shows its own hint, shrinking a room asks
// before dropping content, Esc cancels an overview drag, and neighbour labels
// sit next to the room.

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

/** Client coordinates of room pixels (px) and tile centres (cell) for the current view. */
async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await pixelAt(t, x0, y0);
  const b = await pixelAt(t, x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  const px = (ax, ay) => ({ x: x0 + (ax - a.x - 0.5) * s, y: y0 + (ay - a.y - 0.5) * s });
  return { px, cell: (tx, ty) => px(tx * 16 + 8, ty * 16 + 8) };
}

/** Client point over the overview cell whose tooltip matches `re` (scans the canvas). */
async function overviewCell(t, re) {
  const box = await t.page.locator('.qf-map-overview__canvas').boundingBox();
  for (let y = box.y + 4; y < box.y + box.height; y += 8) {
    for (let x = box.x + 4; x < box.x + box.width; x += 8) {
      await t.page.mouse.move(x, y);
      const title = await t.eval(() => document.querySelector('.qf-map-overview__canvas').title);
      if (re.test(title)) return { x, y };
    }
  }
  return null;
}

const undoInfo = (t) => t.eval(() => ({ n: window.__qf.editor.ctx.undo.done.length, label: window.__qf.editor.ctx.undo.peekUndo() }));
const hint = (t) => t.eval(() => document.querySelector('.qf-map-status__hint').textContent);
const toolNow = (t) => t.eval(() => document.querySelector('.qf-map-tool--active[data-tool]')?.dataset.tool);
const music = (t) => t.eval(async () => (await import('/src/audio/audio.ts')).getAudio().currentMusic);
const sideTab = (t, name) => t.page.click(`.qf-map-right .qf-tab >> text=${name}`);

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
  await t.eval(() => window.__qf.editor.ctx.selectRoom('ellendor', 'ow_cliffs'));
  await t.wait(400);
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  let { px, cell } = await calibrate(t);
  const drag = async (a, b, steps = 4) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps });
    await page.mouse.up();
    await t.wait(60);
  };

  // ---- 1. paste mode ends when another tool takes over
  await page.keyboard.press('s');
  await drag(cell(2, 2), cell(4, 3));
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await t.wait(60);
  t.assert(/^Paste/.test(await hint(t)), `Ctrl+V shows the paste hint at once ("${await hint(t)}")`);
  await page.keyboard.press('p');
  await page.keyboard.press('s');
  await t.wait(60);
  const u0 = await undoInfo(t);
  await drag(cell(8, 6), cell(11, 8));
  const u1 = await undoInfo(t);
  t.assert(u1.n === u0.n, `a drag after coming back to Select pasted instead of selecting (${u1.label})`);
  t.assert(/^4×3 tiles/.test(await hint(t)), `the drag made a 4×3 marquee ("${await hint(t)}")`);
  await t.shot('marquee-after-tool-switch');
  await page.keyboard.press('Escape');

  // ---- 2. the Entities sidebar picks the entity tool, Tiles gives the brush back
  await page.keyboard.press('r');
  await sideTab(t, 'Entities');
  await t.wait(150);
  t.assert((await toolNow(t)) === 'entity', `opening the Entities sidebar picks the entity tool (${await toolNow(t)})`);
  const target = await t.eval(() => {
    const e = window.__qf.editor.ctx.room().entities.find((x) => x.type.startsWith('enemy.'));
    return { id: e.id, x: e.x, y: e.y };
  });
  const layers0 = await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room().layers));
  const u2 = await undoInfo(t);
  const at = px(target.x, target.y);
  await page.mouse.click(at.x, at.y);
  await t.wait(120);
  const picked = await t.eval(() => window.__qf.editor.ctx.entityId);
  t.assert(picked === target.id, `clicking an enemy with the Entities sidebar open selects it (${picked})`);
  t.assert((await undoInfo(t)).n === u2.n && layers0 === await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room().layers)),
    'clicking an entity with the Entities sidebar open edits nothing');
  const entX = () => t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id).x, target.id);
  await page.keyboard.press('ArrowRight');
  const nudged = await entX();
  t.assert(nudged === target.x + 1, `an arrow key nudges the selected entity from the canvas (${target.x} -> ${nudged})`);
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Delete');
  await t.wait(60);
  const still = await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id), target.id);
  t.assert(still && still.x === nudged && still.y === target.y, 'arrows / Delete on a focused sidebar control leave the entity alone');
  await page.keyboard.press('Control+z');
  await t.wait(60);
  await sideTab(t, 'Tiles');
  await t.wait(120);
  t.assert((await toolNow(t)) === 'rect', `going back to Tiles restores the rectangle tool (${await toolNow(t)})`);

  // ---- 3. a right-click in the middle of a pencil stroke
  await page.keyboard.press('p');
  await t.eval((id) => window.__qf.editor.ctx.selectTile(id), T.SAND);
  ({ px, cell } = await calibrate(t));
  const u3 = await undoInfo(t);
  let p = cell(2, 12);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = cell(5, 12);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await t.wait(80);
  const menus = await t.eval(() => document.querySelectorAll('.qf-map-menu').length);
  p = cell(8, 12);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
  await t.wait(80);
  const row = await t.eval(() => window.__qf.editor.ctx.room().layers.bg.slice(12 * 16 + 2, 12 * 16 + 9));
  const u4 = await undoInfo(t);
  t.assert(menus === 0, `a right-click mid-stroke opened the context menu (${menus})`);
  t.assert(row.every((id) => id === T.SAND), `the stroke went on across the right-click (${row})`);
  t.assert(u4.n === u3.n + 1 && u4.label === 'Paint tiles', `the stroke is one undo step (${u4.n - u3.n}, ${u4.label})`);
  await t.shot('stroke-across-right-click');
  await page.keyboard.press('Control+z');

  // ---- 4. map keys after clicking a Room-tab checkbox
  await sideTab(t, 'Room');
  await t.wait(150);
  await page.click('.qf-map-props label.qf-check input');
  await t.wait(80);
  await page.keyboard.press('g');
  await page.keyboard.press('f');
  await t.wait(60);
  const grid = await t.eval(() => document.querySelector('[data-toggle="grid"]').getAttribute('aria-pressed'));
  t.assert(grid === 'true' && (await toolNow(t)) === 'fill', `G and F work while a checkbox has focus (grid ${grid}, tool ${await toolNow(t)})`);
  await page.keyboard.press('g');
  await page.keyboard.press('Control+z'); // the dark flag
  await t.wait(80);

  // ---- 5. the music preview stops when its sidebar or the Map tab is left
  await page.click('.qf-map-props__music button');
  await t.wait(150);
  t.assert((await music(t)) !== 'none', 'the preview plays');
  await sideTab(t, 'Tiles');
  await t.wait(100);
  t.assert((await music(t)) === 'none', `the preview stops when the Room sidebar is left (${await music(t)})`);
  await sideTab(t, 'Room');
  await t.wait(150);
  await page.click('.qf-map-props__music button');
  await t.wait(150);
  await page.click('#qf-tab-art');
  await t.wait(250);
  t.assert((await music(t)) === 'none', `the preview stops on the Art tab (${await music(t)})`);
  await page.click('#qf-tab-map');
  await t.wait(250);
  const title = await t.eval(() => document.querySelector('.qf-map-props__music button').title);
  t.assert(/^Preview/.test(title), `the preview button offers to play again ("${title}")`);

  // ---- 6. a location pick shows its own hint instead of the tool's
  await t.eval(() => { window.__pick = window.__qf.editor.ctx.pickLocation('test spot'); });
  await t.wait(120);
  const pickHint = await hint(t);
  t.assert(/^Picking a location/.test(pickHint), `the status bar explains the pick ("${pickHint}")`);
  await t.shot('location-pick-hint');
  await page.keyboard.press('Escape');
  t.assert((await t.eval(() => window.__pick)) === null, 'Esc cancels the pick');
  t.assert(!/^Picking/.test(await hint(t)), 'the tool hint comes back after the pick');

  // ---- 7. shrinking a room asks before dropping what lies outside
  await t.eval(() => window.__qf.editor.ctx.selectRoom('ellendor', 'ow_village'));
  await t.wait(250);
  const before = await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room()));
  const u5 = await undoInfo(t);
  await page.selectOption('.qf-map-props select[data-key="gw"]', '1');
  await t.until(() => !!document.querySelector('.qf-modal'));
  const ask = await t.eval(() => document.querySelector('.qf-modal').innerText);
  t.assert(/entities/.test(ask) && /painted tiles/.test(ask), `the dialog says what would go ("${ask}")`);
  await t.shot('shrink-confirm');
  await page.click('.qf-modal__footer .qf-btn:not(.qf-btn--danger)');
  await t.wait(150);
  const kept = await t.eval(() => ({ room: JSON.stringify(window.__qf.editor.ctx.room()), sel: document.querySelector('.qf-map-props select[data-key="gw"]').value }));
  t.assert(kept.room === before && kept.sel === '2' && (await undoInfo(t)).n === u5.n, 'cancelling keeps the room and resets the size field');
  await page.selectOption('.qf-map-props select[data-key="gw"]', '1');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.wait(150);
  t.assert((await t.eval(() => window.__qf.editor.ctx.room().gw)) === 1, 'confirming shrinks the room');
  await page.keyboard.press('Control+z');
  await t.wait(150);
  t.assert((await t.eval(() => JSON.stringify(window.__qf.editor.ctx.room()))) === before, 'undo restores the room exactly');

  // ---- 8. Esc cancels a room drag in the world overview
  const room = await t.eval(() => { const r = window.__qf.editor.ctx.room(); return { name: r.name, gx: r.gx, gy: r.gy }; });
  const from = await overviewCell(t, new RegExp(`^${room.name} — `));
  const to = await overviewCell(t, /^Empty cell/);
  t.assert(from && to, 'found the room and a free cell in the overview');
  if (from && to) {
    const u6 = await undoInfo(t);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.keyboard.press('Escape');
    await t.wait(50);
    await page.mouse.up();
    await t.wait(100);
    const after = await t.eval(() => { const r = window.__qf.editor.ctx.room(); return { gx: r.gx, gy: r.gy }; });
    t.assert(after.gx === room.gx && after.gy === room.gy && (await undoInfo(t)).n === u6.n, `Esc cancelled the overview drag (${JSON.stringify(after)})`);
  }

  // ---- 9. neighbour names sit next to the room (the centre screen has all four), zoomed out and panned
  await t.eval(() => document.activeElement?.blur());
  await t.eval(() => window.__qf.editor.ctx.selectRoom('ellendor', 'ow_crossroads'));
  await page.mouse.move(5, 880);
  await t.wait(150);
  await page.keyboard.press('0');
  await page.keyboard.press('-');
  await t.wait(150);
  await t.shot('neighbour-labels-zoomed-out');
  await page.keyboard.press('0');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await t.wait(150);
  await t.shot('neighbour-labels-left');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await t.wait(150);
  await t.shot('neighbour-labels-right');
  t.assert((await t.eval(() => window.__qf.editor.ctx.roomId)) === 'ow_crossroads', 'arrow keys pan the canvas, not the overview selection');
}
