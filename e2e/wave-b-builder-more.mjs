// Wave B builder journey, part 2 (real mouse and keyboard from the main menu):
// a brand-new tile drawn in the Art tab becomes the map brush and is painted;
// undo / redo from another tab; a sprite edit shows on the map; a question
// dialogue with answers and a flag; the Project tab start picked on the map
// and F5 / Shift+F5 playtests from it; a walled dungeon room grown to 2x1
// screens; deleting the start room is reported and undone; the autosave alone
// (no Ctrl+S) keeps everything across a reload; a broken file is refused on import.

/** Keep other people's source edits from reloading the page mid-scenario. */
const holdHmr = (t) => t.page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      if (args[1] !== 'vite-hmr') return new target(...args);
      return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} });
    },
  });
});

const project = (t) => t.eval(() => JSON.parse(JSON.stringify(window.__qf.editor.ctx.project)));
const ctxInfo = (t) => t.eval(() => {
  const ctx = window.__qf.editor.ctx;
  return { tab: ctx.activeTab, world: ctx.worldId, room: ctx.roomId, entity: ctx.entityId, tile: ctx.tile, undo: ctx.undo.peekUndo(), redo: ctx.undo.peekRedo() };
});

/** Map room pixels / tile centres to client coordinates via the status bar's pixel readout. */
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
  const px = (x, y) => ({ x: x0 + (x - a.x - 0.5) * s, y: y0 + (y - a.y - 0.5) * s });
  return { px, cell: (tx, ty) => px(tx * 16 + 8, ty * 16 + 8), scale: s };
}

const drag = async (t, a, b, steps = 6) => {
  await t.page.mouse.move(a.x, a.y);
  await t.page.mouse.down();
  await t.page.mouse.move(b.x, b.y, { steps });
  await t.page.mouse.up();
  await t.wait(40);
};

const click = async (t, a, opts) => {
  await t.page.mouse.click(a.x, a.y, opts);
  await t.wait(60);
};

const tab = async (t, id) => {
  await t.page.click(`#qf-tab-${id}`);
  await t.wait(150);
};

const sideTab = (t, label) => t.page.click(`.qf-map-right .qf-tab:has-text("${label}")`);
const field = (label) => `.qf-map-right .qf-field:has(> .qf-field__label:text-is("${label}"))`;
const layerAt = (t, layer, cells) => t.eval(([layer, cells]) => {
  const room = window.__qf.editor.ctx.room();
  const cols = room.gw * 16;
  return cells.map(([x, y]) => room.layers[layer][y * cols + x]);
}, [layer, cells]);

/** Client point of a pixel of the art canvas. */
const artPoint = (t, x, y) => t.eval(([px, py]) => {
  const c = document.querySelector('.qf-art-canvas');
  const r = c.getBoundingClientRect();
  const w = Number(/(\d+)×/.exec(document.querySelector('.qf-art-status').textContent)?.[1] ?? 16);
  const z = r.width / w;
  return { x: r.left + (px + 0.5) * z, y: r.top + (py + 0.5) * z };
}, [x, y]);

/** Digest of the map canvas pixels around a room point (for "did it repaint?"). */
const canvasPatch = (t, at, r = 24) => t.eval(([x, y, r]) => {
  const c = document.querySelector('.qf-map-canvas');
  const box = c.getBoundingClientRect();
  const k = c.width / box.width;
  const g = c.getContext('2d');
  const d = g.getImageData(Math.round((x - box.left - r) * k), Math.round((y - box.top - r) * k), Math.round(2 * r * k), Math.round(2 * r * k)).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2]) >>> 0;
  return h;
}, [at.x, at.y, r]);

const game = (t) => t.eval(() => {
  const s = window.__qf.game?.services;
  return s ? { world: s.room.world.id, room: s.room.def.id, x: s.player.x, y: s.player.y, mode: s.mode } : null;
});

async function closePlaytest(t) {
  await t.page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest') && !window.__qf.game, undefined, 4000);
  await t.wait(200);
}

export default async function (t) {
  const { page } = t;
  await holdHmr(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await t.goto('#/');
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await page.fill('.qf-modal input[aria-label="Project name"]', 'Second Journey');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.until(() => window.__qf.route?.view === 'edit' && window.__qf.ready && !!window.__qf.editor, undefined, 10000);
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);

  const tileId = await newTileToMap(t, T);
  await undoFromAnotherTab(t, tileId);
  await spriteOnMap(t);
  await questionDialogue(t);
  await startPickAndPlay(t);
  await growDungeonRoom(t, T);
  await deleteStartRoom(t);
  await autosaveAndReload(t);
  t.assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
}

/** + New tile in the Art tab, draw it, "Use as map brush", paint it on the map. */
async function newTileToMap(t, T) {
  const { page } = t;
  await tab(t, 'art');
  await t.until(() => !!document.querySelector('.qf-art-canvas'));
  await page.click('.qf-art-kinds .qf-tab:has-text("Tiles")');
  await page.click(`.qf-art-list .qf-art-cell[data-id="${T.GRASS}"]`);
  await page.click('.qf-art-browser__foot button:has-text("New")');
  await t.wait(150);
  let p = await project(t);
  const tile = p.tiles.find((x) => x.id >= 1000);
  t.assert(tile && tile.tags.includes('custom'), `+ New made a user tile (${tile?.id} ${tile?.name})`);
  const selectedCell = await t.eval(() => document.querySelector('.qf-art-list .qf-art-cell.is-active')?.dataset.id ?? null);
  t.assert(Number(selectedCell) === tile?.id, `the new tile is selected in the list (${selectedCell})`);
  // Fill it with colour 5 (G = fill), then a diagonal stroke of colour 2 (B = pencil).
  await page.keyboard.press('Digit5');
  await page.keyboard.press('KeyG');
  await click(t, await artPoint(t, 8, 8));
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyB');
  await drag(t, await artPoint(t, 0, 0), await artPoint(t, 15, 15), 16);
  p = await project(t);
  const drawn = p.tiles.find((x) => x.id === tile.id).frames[0];
  const flat = JSON.stringify(drawn);
  t.assert(/5/.test(flat) && /2/.test(flat), `the new tile got fill + stroke pixels (${flat.slice(0, 60)}…)`);
  await t.shot('new-tile-drawn');

  await page.click('.qf-art-props button:has-text("Use as map brush")');
  await t.wait(80);
  t.assert((await ctxInfo(t)).tile === tile.id, 'Use as map brush selects the tile');
  await tab(t, 'map');
  await sideTab(t, 'Tiles');
  await t.wait(120);
  const brush = await t.eval(() => document.querySelector('.qf-map-brush__name')?.textContent);
  t.assert(brush === tile.name, `the map brush panel names the new tile (${brush})`);
  const inPalette = await t.eval((id) => document.querySelectorAll(`.qf-map-palette__scroll .qf-map-tile[data-tile="${id}"]`).length, tile.id);
  t.assert(inPalette >= 1, `the map palette lists the new tile (${inPalette})`);
  const { cell } = await calibrate(t);
  await page.keyboard.press('KeyR');
  await drag(t, cell(2, 2), cell(5, 4));
  const got = await layerAt(t, 'bg', [[2, 2], [5, 4], [6, 4]]);
  t.assert(got[0] === tile.id && got[1] === tile.id && got[2] !== tile.id, `rectangle painted the new tile (${got})`);
  await t.shot('new-tile-painted');
  return tile.id;
}

/** Ctrl+Z / Ctrl+Y on the Dialogue tab undo / redo a map paint and name it. */
async function undoFromAnotherTab(t, tileId) {
  const { page } = t;
  await tab(t, 'dialogue');
  await page.locator('#qf-tabpanel-dialogue').click({ position: { x: 600, y: 700 } }).catch(() => undefined);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(100);
  const note = await t.eval(() => document.querySelector('.qf-shell__history-note')?.textContent);
  t.assert(/^Undid: (Paint tiles|Fill rectangle)$/.test(note ?? ''), `the history note names the undone map step (${note})`);
  t.assert((await ctxInfo(t)).tab === 'dialogue', 'undo keeps the Dialogue tab open');
  await t.shot('undo-from-dialogue');
  const room = await t.eval(() => window.__qf.editor.ctx.room().layers.bg[2 * 16 + 2]);
  t.assert(room !== tileId, `the paint was undone (${room})`);
  await page.keyboard.press('Control+KeyY');
  await t.wait(100);
  const back = await t.eval(() => window.__qf.editor.ctx.room().layers.bg[2 * 16 + 2]);
  t.assert(back === tileId, `Ctrl+Y on the Dialogue tab redoes it (${back})`);
  await tab(t, 'map');
  await t.wait(100);
  await t.shot('map-after-redo');
}

/** Place an NPC, edit its sprite in the Art tab: the map shows the new pixels; undo brings the old look back. */
async function spriteOnMap(t) {
  const { page } = t;
  await sideTab(t, 'Entities');
  let { cell } = await calibrate(t);
  await page.click('.qf-ent-item[data-type="npc.person"]');
  await click(t, cell(10, 6));
  await page.keyboard.press('Escape');
  const at = cell(10, 6);
  const before = await canvasPatch(t, at);
  await tab(t, 'art');
  await page.click('.qf-art-kinds .qf-tab:has-text("Sprites")');
  await page.fill('.qf-art-browser input[type="search"]', 'villager');
  await t.wait(100);
  await page.click('.qf-art-list .qf-art-row[data-id="npc.villager"]');
  await t.wait(100);
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyB');
  const w = await t.eval(() => Number(/(\d+)×/.exec(document.querySelector('.qf-art-status').textContent)?.[1] ?? 16));
  for (let y = 2; y < 14; y += 2) await drag(t, await artPoint(t, 0, y), await artPoint(t, w - 1, y), 12);
  await t.shot('sprite-edited');
  await tab(t, 'map');
  await t.wait(200);
  ({ cell } = await calibrate(t));
  const after = await canvasPatch(t, cell(10, 6));
  t.assert(after !== before, 'the map canvas shows the edited NPC sprite');
  await t.shot('sprite-on-map');
  // Undo the six strokes from the map.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+KeyZ');
  await t.wait(200);
  const undone = await canvasPatch(t, cell(10, 6));
  t.assert(undone === before, 'six Ctrl+Z on the map restore the NPC look');
}

/** A question page with three answers and a flag; the preview shows the answers. */
async function questionDialogue(t) {
  const { page } = t;
  await tab(t, 'dialogue');
  await page.click('.qf-dlg-listbar .qf-btn:has-text("New")');
  await t.wait(120);
  await page.click('.qf-dlg-page__text');
  await page.keyboard.type('Will you help us find the lost lantern?');
  await page.click('.qf-dlg-choice input[type="checkbox"]');
  await t.wait(120);
  const answers = page.locator('.qf-dlg-choice__row input');
  t.assert(await answers.count() === 2, `a question starts with two answers (${await answers.count()})`);
  await answers.nth(0).fill('Of course!');
  await answers.nth(0).press('Tab');
  await answers.nth(1).fill('Not now');
  await answers.nth(1).press('Tab');
  await page.click('.qf-dlg-choice button:has-text("+ Answer")');
  await t.wait(100);
  t.assert(await page.locator('.qf-dlg-choice__row input').count() === 3, 'a third answer can be added');
  const flag = page.locator('.qf-dlg-choice .qf-field:has-text("Sets flag") input').first();
  await flag.fill('agreed_lantern');
  await flag.press('Tab');
  await t.wait(150);
  const p = await project(t);
  const d = p.dialogues.at(-1);
  const choice = d?.pages[0]?.choice;
  t.assert(choice?.options.join('|') === 'Of course!|Not now|Answer 3' && choice.flag === 'agreed_lantern',
    `question saved with answers and flag (${JSON.stringify(choice)})`);
  await page.click('.qf-dlg-preview__bar button:has-text("Play")');
  await t.wait(1500);
  await t.shot('question-dialogue');
  const flags = await t.eval(() => document.querySelector('.qf-dlg-flags__undeclared')?.textContent ?? '');
  t.assert(flags.includes('agreed_lantern'), `the Flags panel lists the new flag as used but not declared (${flags})`);
}

/** Project tab: pick the start on the map, then F5 starts there; Shift+F5 plays from the map cursor. */
async function startPickAndPlay(t) {
  const { page } = t;
  await tab(t, 'project');
  await page.click('.qf-proj-start button:has-text("Pick on map")');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'map' && !document.querySelector('.qf-map-pick')?.hidden);
  await t.wait(150);
  const { cell } = await calibrate(t);
  await click(t, cell(12, 10));
  await t.wait(200);
  const p = await project(t);
  t.assert(p.start.x === 200 && p.start.y === 168, `the start was picked on the map (${JSON.stringify(p.start)})`);
  t.assert((await ctxInfo(t)).tab === 'project', 'the pick returns to the Project tab');
  await t.shot('start-picked');
  await page.keyboard.press('F5');
  await t.until(() => window.__qf.game?.state === 'playing', undefined, 8000);
  await t.wait(300);
  let g = await game(t);
  t.assert(g && g.room === p.start.room && g.x === 200 && g.y === 168, `F5 starts at the picked start (${JSON.stringify(g)})`);
  await t.shot('f5-playtest');
  await closePlaytest(t);

  if ((await ctxInfo(t)).tab !== 'map') await tab(t, 'map');
  const c = await calibrate(t);
  const target = c.cell(3, 11);
  await page.mouse.move(target.x, target.y);
  await t.wait(60);
  await page.keyboard.press('Shift+F5');
  await t.until(() => window.__qf.game?.state === 'playing', undefined, 8000);
  await t.wait(300);
  g = await game(t);
  t.assert(g && g.x === 56 && g.y === 184, `Shift+F5 plays from the tile under the cursor (${JSON.stringify(g)})`);
  await closePlaytest(t);
}

/** A walled dungeon room grown to 2x1 moves its right wall; shrinking back asks first only when something would be lost. */
async function growDungeonRoom(t, T) {
  const { page } = t;
  await page.click('.qf-map-left__head .qf-map-iconbtn[title^="New world"]');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.fill('.qf-modal .qf-field:has-text("Name") input', 'Deep Vault');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(200);
  await sideTab(t, 'Room');
  await page.selectOption('.qf-map-props select[data-key="gw"]', '2');
  await t.wait(200);
  const room = await t.eval(() => {
    const r = window.__qf.editor.ctx.room();
    const cols = r.gw * 16;
    return { gw: r.gw, right: r.layers.bg[5 * cols + cols - 1], mid: r.layers.bg[5 * cols + 15], top: r.layers.bg[20] };
  });
  t.assert(room.gw === 2 && room.right === T.DWALL_RIGHT && room.mid === T.DFLOOR && room.top === T.DWALL_TOP,
    `growing a walled room to 2x1 moves the right wall out (${JSON.stringify(room)})`);
  await t.shot('room-grown');
  await page.selectOption('.qf-map-props select[data-key="gw"]', '1');
  await t.wait(250);
  // Only the moved walls would go: nothing painted or placed is lost, so no question.
  t.assert(!(await t.eval(() => !!document.querySelector('.qf-modal'))), 'shrinking an untouched walled room back asks nothing');
  const gw = await t.eval(() => window.__qf.editor.ctx.room().gw);
  t.assert(gw === 1, `shrunk back to 1 screen (${gw})`);
}

/** Deleting the room holding the start is flagged on the Project tab; Ctrl+Z restores it. */
async function deleteStartRoom(t) {
  const { page } = t;
  const p = await project(t);
  await page.click(`.qf-map-world[data-world="${p.start.world}"]`);
  await t.wait(200);
  const cur = await ctxInfo(t);
  t.assert(cur.room === p.start.room, 'the start world opens on the start room');
  await page.click('.qf-map-left__actions .qf-btn:has-text("Delete")');
  await t.until(() => !!document.querySelector('.qf-modal'));
  const text = await t.eval(() => document.querySelector('.qf-modal')?.textContent ?? '');
  t.assert(/with its tiles, 1 entity and 0 triggers\?/.test(text), `the delete question counts correctly (${text})`);
  await t.shot('delete-start-confirm');
  await page.click('.qf-modal__footer .qf-btn--danger, .qf-modal__footer .qf-btn--primary');
  await t.wait(200);
  const after = await project(t);
  t.assert(!after.worlds.some((w) => w.rooms.some((r) => r.id === p.start.room)), 'the start room is gone');
  await tab(t, 'project');
  await t.wait(200);
  const problems = await t.eval(() => [...document.querySelectorAll('.qf-proj-problem')].map((e) => e.textContent));
  t.assert(problems.some((x) => /start/i.test(x)), `the Project tab reports the missing start (${problems.join(' | ')})`);
  const notice = await t.eval(() => document.querySelector('.qf-proj-start__notice:not([hidden])')?.textContent ?? '');
  t.assert(/missing|No rooms/i.test(notice), `the start preview says so (${notice})`);
  await t.shot('start-missing');
  await page.keyboard.press('F5');
  await t.wait(300);
  t.assert(!(await t.eval(() => !!window.__qf.game)), 'F5 refuses to playtest from a missing start');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(100);
  const restored = await project(t);
  t.assert(restored.worlds.some((w) => w.rooms.some((r) => r.id === p.start.room)), 'Ctrl+Z brings the start room back');
  // The report re-runs after a short quiet period.
  const cleared = await t.until(() => ![...document.querySelectorAll('.qf-proj-problem')].some((e) => /start/i.test(e.textContent)), undefined, 2000);
  t.assert(cleared, 'the start problem clears after the undo');
  await t.shot('start-restored');
}

/** No Ctrl+S: the autosave stores everything, a reload brings it back; the menu refuses a broken file. */
async function autosaveAndReload(t) {
  const { page } = t;
  const saved = await t.until(() => document.querySelector('.qf-shell__status-text')?.textContent === 'Saved', undefined, 6000);
  t.assert(saved, 'the autosave reports Saved on its own');
  const before = await project(t);
  await page.reload();
  await t.until(() => window.__qf.ready && !!window.__qf.editor, undefined, 15000);
  await t.wait(300);
  const after = await project(t);
  const strip = (p) => JSON.stringify({ ...p, modified: 0 });
  t.assert(strip(after) === strip(before), 'the reloaded project equals the autosaved one');
  t.assert(after.tiles.some((x) => x.id >= 1000) && after.dialogues.some((d) => d.pages[0]?.choice?.flag === 'agreed_lantern'),
    'the new tile and the question dialogue survived the reload');
  await t.shot('reloaded');

  await page.click('.qf-shell__bar button:has-text("Menu")');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, undefined, 8000);
  await t.until(() => document.querySelectorAll('.qf-menu-card').length >= 2, undefined, 5000);
  const cards = await t.eval(() => document.querySelectorAll('.qf-menu-card').length);
  const file = `${t.outDir}/broken.questforge.json`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, '{"format":"questforge","version":1,"project":{"name":');
  await page.setInputFiles('.qf-menu-projects input[type="file"]', file);
  await t.wait(600);
  const toasts = await t.eval(() => [...document.querySelectorAll('.qf-toast')].map((e) => e.textContent).join(' | '));
  t.assert(/import|could not|couldn|invalid|not a/i.test(toasts), `a broken file is refused with a message (${toasts})`);
  t.assert(await t.eval(() => document.querySelectorAll('.qf-menu-card').length) === cards, 'no card appears for the broken file');
  await t.shot('broken-import');
}
