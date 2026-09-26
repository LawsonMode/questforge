// Wave B editor integration checks on #/edit/sample with real input:
// (1) tabs refresh each other (room / world / NPC / dialogue renames, a deleted
//     dialogue and its undo, tile art, usage and validation "Go" jumps landing on
//     the right map sidebar, the project name in the Project tab and top bar);
// (2) editor shortcuts never fire while typing in inputs (and Ctrl+Z there is the
//     field's own); (3) leaving the editor releases every document / window
//     listener, interval and animation loop it started (twice in a row).

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

/** Count live document / window listeners, intervals and animation-frame requests. */
const trackLeaks = (t) => t.page.addInitScript(() => {
  const entries = [];
  const capture = (o) => (typeof o === 'boolean' ? o : !!o?.capture);
  const name = (target) => (target === window ? 'window' : 'document');
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const drop = (target, type, fn, cap) => {
    const i = entries.findIndex((e) => e.target === target && e.type === type && e.fn === fn && e.capture === cap);
    if (i >= 0) entries.splice(i, 1);
  };
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const tracked = (this === window || this === document) && fn && !(typeof opts === 'object' && opts?.once);
    if (tracked && !entries.some((e) => e.target === this && e.type === type && e.fn === fn && e.capture === capture(opts))) {
      entries.push({ target: this, type, fn, capture: capture(opts), src: `${name(this)}:${type}:${String(fn).replace(/\s+/g, ' ').slice(0, 90)}` });
      opts?.signal?.addEventListener('abort', () => drop(this, type, fn, capture(opts)));
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (this === window || this === document) drop(this, type, fn, capture(opts));
    return remove.call(this, type, fn, opts);
  };
  const setI = window.setInterval;
  const clearI = window.clearInterval;
  const intervals = new Set();
  window.setInterval = function (...a) {
    const id = setI.apply(this, a);
    intervals.add(id);
    return id;
  };
  window.clearInterval = function (id) {
    intervals.delete(id);
    return clearI.call(this, id);
  };
  const raf = window.requestAnimationFrame;
  let frames = 0;
  window.requestAnimationFrame = function (cb) {
    frames++;
    return raf.call(this, cb);
  };
  // Elements parked on <body> (menus, popups, overlays); the toast stack comes and goes on its own.
  const parked = () => [...document.body.children].filter((e) => e.id !== 'app' && !e.classList.contains('qf-toasts') && e.tagName !== 'SCRIPT')
    .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`).sort();
  window.__leaks = () => ({ listeners: entries.map((e) => e.src).sort(), intervals: intervals.size, frames, parked: parked() });
});

const snap = (t) => t.eval(() => {
  const ctx = window.__qf.editor.ctx;
  return {
    tab: ctx.activeTab, world: ctx.worldId, room: ctx.roomId, entity: ctx.entityId, layer: ctx.layer,
    undo: ctx.undo.peekUndo(), sidebar: document.querySelector('.qf-map-right .qf-tab--active')?.textContent ?? null,
    tool: document.querySelector('.qf-map-tool--active[data-tool]')?.dataset.tool ?? null,
  };
});

const field = (label) => `.qf-map-right .qf-field:has(> .qf-field__label:text-is("${label}"))`;
const sideTab = (t, label) => t.page.click(`.qf-map-right .qf-tab:has-text("${label}")`);
const tab = async (t, id) => {
  await t.page.click(`#qf-tab-${id}`);
  await t.wait(150);
};

/** Find the sample's NPC with a dialogue, a dialogue shown by a trigger, and a warp with a destination. */
const findCast = (t) => t.eval(() => {
  const p = window.__qf.editor.ctx.project;
  let npc = null;
  let trig = null;
  let warp = null;
  for (const w of p.worlds) {
    for (const r of w.rooms) {
      for (const e of r.entities) {
        if (!npc && e.type === 'npc.person' && p.dialogues.some((d) => d.id === e.props.dialogue)) npc = { world: w.id, room: r.id, id: e.id, dialogue: e.props.dialogue };
        if (!warp && e.type === 'marker.warp' && e.props.target) warp = { world: w.id, room: r.id, id: e.id, target: e.props.target };
      }
      for (const tr of r.triggers) {
        const a = tr.actions.find((x) => x.kind === 'dialogue' && p.dialogues.some((d) => d.id === x.dialogue));
        if (!trig && a) trig = { world: w.id, room: r.id, id: tr.id, dialogue: a.dialogue };
      }
    }
  }
  return { npc, trig, warp };
});

/** Navigation set-up (not under test): show a room and select an entity. */
const show = (t, world, room, entity = null) => t.eval(([w, r, e]) => {
  const ctx = window.__qf.editor.ctx;
  ctx.selectRoom(w, r);
  ctx.selectEntity(e);
}, [world, room, entity]);

export default async function (t) {
  const { page } = t;
  await holdHmr(t);
  await trackLeaks(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await t.goto('#/');
  await t.wait(800);
  const base = await t.eval(() => window.__leaks());
  const f0 = await t.eval(() => window.__leaks().frames);
  await t.wait(1000);
  base.menuFps = (await t.eval(() => window.__leaks().frames)) - f0;
  await t.eval(() => { location.hash = '#/edit/sample'; });
  await t.until(() => window.__qf.ready && !!window.__qf.editor, undefined, 15000);
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);

  const inEditor = await t.eval(() => window.__leaks());
  t.log(`listeners: menu ${base.listeners.length}, editor ${inEditor.listeners.length}; intervals ${base.intervals} -> ${inEditor.intervals}`);
  t.assert(inEditor.listeners.length > base.listeners.length, 'the leak tracker sees the editor listeners');
  const cast = await findCast(t);
  t.assert(cast.npc && cast.trig && cast.warp, `the sample has an NPC with a dialogue, a trigger dialogue and a warp (${JSON.stringify(cast)})`);
  await refreshChecks(t, cast);
  await inputChecks(t, cast);
  await leakChecks(t, base);
}

async function refreshChecks(t, cast) {
  const { page } = t;
  // ---- Room rename (Room tab) -> breadcrumb, overview caption, the warp's destination summary.
  const { target } = cast.warp;
  await show(t, target.world, target.room);
  await sideTab(t, 'Room');
  await page.fill('.qf-map-props input[data-key="name"]', 'Renamed Hall');
  await page.keyboard.press('Enter');
  await t.wait(120);
  const trail = await t.eval(() => document.querySelector('.qf-shell__trail')?.textContent ?? '');
  const caption = await t.eval(() => document.querySelector('.qf-map-caption')?.textContent ?? '');
  t.assert(trail.includes('Renamed Hall') && caption.includes('Renamed Hall'), `a room rename shows in the breadcrumb and caption (${trail} / ${caption})`);
  await show(t, cast.warp.world, cast.warp.room, cast.warp.id);
  await sideTab(t, 'Entities');
  await t.wait(100);
  let summary = await page.locator(`${field('Destination')} .qf-ent-warp__summary`).textContent();
  t.assert(summary.includes('Renamed Hall'), `the warp inspector names the renamed room (${summary})`);

  // ---- World rename (world menu) -> warp summary and the Project tab's worlds table.
  await page.hover(`.qf-map-world[data-world="${target.world}"]`);
  await page.click(`.qf-map-world[data-world="${target.world}"] .qf-map-world__more`);
  await page.click('.qf-map-menu__item:has-text("Rename")');
  await t.until(() => !!document.querySelector('.qf-modal input'));
  await page.fill('.qf-modal input', 'Renamed Realm');
  await page.keyboard.press('Enter');
  await t.wait(150);
  summary = await page.locator(`${field('Destination')} .qf-ent-warp__summary`).textContent();
  t.assert(summary.includes('Renamed Realm'), `the warp inspector names the renamed world (${summary})`);
  await tab(t, 'project');
  const worlds = await t.eval(() => [...document.querySelectorAll('.qf-proj-table tbody tr td:first-child b')].map((b) => b.textContent));
  t.assert(worlds.includes('Renamed Realm'), `the Project tab lists the renamed world (${worlds})`);

  // ---- Project name in the Project tab -> top bar and window title.
  const nameField = page.locator('.qf-proj .qf-field:has(> .qf-field__label:text-is("Project name")) input');
  await nameField.fill('Checks Quest');
  await nameField.press('Tab');
  await t.wait(100);
  const top = await t.eval(() => ({ bar: document.querySelector('.qf-shell__name').value, title: document.title }));
  t.assert(top.bar === 'Checks Quest' && top.title.startsWith('Checks Quest'), `the Project tab rename updates the top bar (${JSON.stringify(top)})`);

  // ---- NPC rename -> the Dialogue tab's "Used by" list.
  await tab(t, 'map');
  await show(t, cast.npc.world, cast.npc.room, cast.npc.id);
  await sideTab(t, 'Entities');
  await page.fill(`${field('Name')} input`, 'Renamed Elder');
  await page.keyboard.press('Tab');
  await t.wait(80);
  await tab(t, 'dialogue');
  await page.click(`.qf-dlg-item[data-dialogue="${cast.npc.dialogue}"]`);
  await t.wait(80);
  const used = await t.eval(() => [...document.querySelectorAll('.qf-dlg-used .qf-dlg-usage__label')].map((n) => n.textContent).join(' | '));
  t.assert(used.includes('Renamed Elder'), `"Used by" shows the renamed NPC (${used})`);

  // ---- Delete that dialogue (keeping references) -> the map inspector warns; Ctrl+Z brings it back.
  const dname = await t.eval((id) => window.__qf.editor.ctx.project.dialogues.find((d) => d.id === id).name, cast.npc.dialogue);
  await page.click('.qf-dlg-listbar .qf-btn:has-text("Delete")');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn:has-text("keep references")');
  await t.wait(100);
  await tab(t, 'map');
  let warn = await t.eval(() => document.querySelector('.qf-map-right .qf-ent-insp .qf-ent-warn')?.textContent ?? '');
  t.assert(/no longer exists/.test(warn), `the inspector warns about the deleted dialogue (${warn})`);
  await t.shot('dialogue-deleted-warning');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(150);
  warn = await t.eval(() => document.querySelector('.qf-map-right .qf-ent-insp .qf-ent-warn')?.textContent ?? '');
  const back = await page.locator(`${field('Dialogue')} select`).evaluate((s) => s.selectedOptions[0]?.textContent ?? null);
  t.assert(!/no longer exists/.test(warn) && back === dname, `Ctrl+Z on the map restores the dialogue in the inspector (${back})`);

  // ---- "Used by" Go on a trigger -> map with the Triggers sidebar and that trigger selected.
  await sideTab(t, 'Tiles');
  await tab(t, 'dialogue');
  await page.click(`.qf-dlg-item[data-dialogue="${cast.trig.dialogue}"]`);
  await t.wait(80);
  const row = page.locator('.qf-dlg-used .qf-dlg-usage__item', { hasText: 'Trigger' }).first();
  await row.locator('button:has-text("Go")').click();
  await t.wait(200);
  let s = await snap(t);
  const activeTrig = await t.eval(() => document.querySelector('.qf-map-right .qf-ent-trig-item.qf-list__item--active')?.dataset.trigger ?? null);
  t.assert(s.tab === 'map' && s.room === cast.trig.room && s.sidebar === 'Triggers' && activeTrig === cast.trig.id,
    `"Go" on a trigger usage opens its room with the Triggers sidebar on it (${JSON.stringify({ ...s, activeTrig })})`);
  await t.shot('go-trigger');

  // ---- Rename that trigger's dialogue and one of its flags on the Dialogue tab -> the open trigger form follows.
  const flag = await t.eval(([w, r, id]) => {
    const p = window.__qf.editor.ctx.project;
    const tr = p.worlds.find((x) => x.id === w).rooms.find((x) => x.id === r).triggers.find((x) => x.id === id);
    const used = [...tr.conditions, ...tr.actions].map((x) => x.flag).filter(Boolean);
    return p.flags.find((f) => used.includes(f.name))?.name ?? null;
  }, [cast.trig.world, cast.trig.room, cast.trig.id]);
  t.assert(!!flag, `the trigger uses a declared flag (${flag})`);
  await tab(t, 'dialogue');
  await page.click(`.qf-dlg-item[data-dialogue="${cast.trig.dialogue}"]`);
  await page.fill('.qf-dlg-name', 'Renamed Speech');
  await page.keyboard.press('Enter');
  await t.wait(80);
  await page.click(`.qf-dlg-flags li[data-flag="${flag}"] button:has-text("Rename")`);
  await t.until(() => !!document.querySelector('.qf-modal input'));
  await page.fill('.qf-modal input', 'renamed_flag');
  await page.keyboard.press('Enter');
  await t.wait(150);
  await tab(t, 'map');
  await t.wait(150);
  const form = await t.eval(() => {
    const editor = document.querySelector('.qf-map-right .qf-ent-trig-editor');
    const selects = [...(editor?.querySelectorAll('select') ?? [])].map((x) => x.selectedOptions[0]?.textContent ?? '');
    const inputs = [...(editor?.querySelectorAll('input') ?? [])].map((x) => x.value);
    const summary = document.querySelector('.qf-map-right .qf-ent-trig-item.qf-list__item--active')?.textContent ?? '';
    return { selects, inputs, summary };
  });
  t.assert(form.selects.includes('Renamed Speech'), `the open trigger form names the renamed dialogue (${form.selects.join(' | ')})`);
  t.assert(form.inputs.includes('renamed_flag') && form.summary.includes('renamed_flag') && !form.summary.includes(`“${flag}”`),
    `the open trigger form and its summary show the renamed flag (${form.summary})`);
  await t.shot('trigger-follows-renames');

  // ---- Clear the warp's destination -> Project tab validation; its Go opens the Entities sidebar on the warp.
  await show(t, cast.warp.world, cast.warp.room, cast.warp.id);
  await sideTab(t, 'Entities');
  await page.click(`${field('Destination')} button:has-text("Clear")`);
  await t.wait(80);
  await page.keyboard.press('KeyP');
  await sideTab(t, 'Tiles');
  await tab(t, 'project');
  const problem = page.locator('.qf-proj-problem', { hasText: 'has no destination' }).first();
  t.assert(await problem.count() === 1, 'the Project tab reports the warp without a destination');
  await problem.locator('button:has-text("Go")').click();
  await t.wait(200);
  s = await snap(t);
  t.assert(s.tab === 'map' && s.entity === cast.warp.id && s.sidebar === 'Entities' && s.tool === 'entity',
    `validation "Go" selects the warp with the Entities sidebar and tool (${JSON.stringify(s)})`);
  await t.shot('go-validation');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(80);

  // ---- Tile art edited in the Art tab repaints the map palette; undo on the map paints it back.
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  await sideTab(t, 'Tiles');
  const swatch = () => t.eval((id) => document.querySelector(`.qf-map-palette__scroll .qf-map-tile[data-tile="${id}"] canvas`)?.toDataURL() ?? null, T.GRASS);
  const sw0 = await swatch();
  await tab(t, 'art');
  await page.click('.qf-art-kinds .qf-tab:has-text("Tiles")');
  await page.click(`.qf-art-list .qf-art-cell[data-id="${T.GRASS}"]`);
  await page.keyboard.press('Digit1');
  const box = await page.locator('.qf-art-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await tab(t, 'map');
  const sw1 = await swatch();
  t.assert(sw0 && sw1 && sw1 !== sw0, 'the map palette repaints the edited tile');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(150);
  t.assert(await swatch() === sw0, 'Ctrl+Z on the map paints the palette tile back');
}

async function inputChecks(t, cast) {
  const { page } = t;
  await show(t, cast.npc.world, cast.npc.room, null);
  await page.keyboard.press('KeyP');
  const before = await snap(t);
  const grid0 = await t.eval(() => document.querySelector('.qf-map-tool[data-toggle="grid"]').classList.contains('qf-map-tool--active'));
  const same = async (what) => {
    const s = await snap(t);
    const grid = await t.eval(() => document.querySelector('.qf-map-tool[data-toggle="grid"]')?.classList.contains('qf-map-tool--active'));
    const modal = await t.eval(() => !!document.querySelector('.qf-modal'));
    t.assert(s.tab === before.tab && s.tool === before.tool && s.layer === before.layer && grid === grid0 && !modal,
      `typing in ${what} fires no editor shortcut (${JSON.stringify({ tab: s.tab, tool: s.tool, layer: s.layer, grid, modal })})`);
  };

  // Room name: tool keys, digits, [ ], ?, G and Space all type.
  await sideTab(t, 'Room');
  const roomName = page.locator('.qf-map-props input[data-key="name"]');
  const original = await roomName.inputValue();
  await roomName.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' erg[]12?');
  t.assert((await roomName.inputValue()) === `${original} erg[]12?`, 'every key typed into the room name');
  await same('the room name');
  await roomName.fill(original);
  await page.keyboard.press('Enter');

  // Tile search: Ctrl+Z is the field's own (the editor's last edit stays).
  await sideTab(t, 'Tiles');
  const undoTop = (await snap(t)).undo;
  await page.click('.qf-map-search__input');
  await page.keyboard.type('fbe');
  await page.keyboard.press('Control+KeyZ');
  t.assert((await snap(t)).undo === undoTop, `Ctrl+Z in the tile search does not undo the editor (${undoTop})`);
  await same('the tile search');
  await page.fill('.qf-map-search__input', '');

  // Inspector: Delete / Backspace in a field never delete the selected entity.
  await show(t, cast.npc.world, cast.npc.room, cast.npc.id);
  await page.keyboard.press('KeyN');
  await sideTab(t, 'Entities');
  await page.click(`${field('Name')} input`);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+KeyD');
  const kept = await t.eval((id) => window.__qf.editor.ctx.room().entities.filter((e) => e.type === 'npc.person').map((e) => e.id).includes(id)
    && window.__qf.editor.ctx.entityId === id, cast.npc.id);
  t.assert(kept, 'Delete / Ctrl+D typed in the inspector leave the selected NPC alone');
  // Clearing a number field puts its value back instead of moving the NPC to x = 0.
  const xField = page.locator(`${field('Position')} input >> nth=0`);
  await xField.click();
  await t.wait(80);
  const x0 = await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id).x, cast.npc.id);
  const depth0 = await t.eval(() => window.__qf.editor.ctx.undo.done.length);
  await xField.fill('');
  await xField.press('Tab');
  await t.wait(80);
  const x1 = await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id).x, cast.npc.id);
  t.assert(x1 === x0 && (await xField.inputValue()) === String(x0) && (await t.eval(() => window.__qf.editor.ctx.undo.done.length)) === depth0,
    `a cleared x field shows ${x0} again and changes nothing (x ${x1})`);
  await page.keyboard.press('Escape');
  await page.click('.qf-map-canvas', { position: { x: 3, y: 3 } }).catch(() => undefined);
  await page.keyboard.press('KeyP');

  // Dialogue text: digits and ? type, the tab stays.
  await tab(t, 'dialogue');
  const text = page.locator('.qf-dlg-page__text').first();
  await text.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 1234?');
  t.assert((await text.inputValue()).endsWith(' 1234?'), 'digits and ? type into the dialogue text');
  t.assert((await snap(t)).tab === 'dialogue' && !(await t.eval(() => !!document.querySelector('.qf-modal'))), 'no tab switch or help while typing a dialogue');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyZ');

  // Art tile name: tool letters and digits type.
  await tab(t, 'art');
  const tool0 = await t.eval(() => document.querySelector('.qf-art-toolbar .qf-btn--active[data-tool]')?.dataset.tool);
  const primary0 = await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index);
  await page.click('.qf-art-props input[data-fk="name"]');
  await page.keyboard.press('End');
  await page.keyboard.type('le7');
  const tool1 = await t.eval(() => document.querySelector('.qf-art-toolbar .qf-btn--active[data-tool]')?.dataset.tool);
  const primary1 = await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index);
  t.assert(tool1 === tool0 && primary1 === primary0, `typing a tile name leaves the pixel tool and colour alone (${tool0}/${primary0} -> ${tool1}/${primary1})`);
  await page.keyboard.press('Escape');

  // Project tab: digits in a text field do not switch tabs.
  await tab(t, 'project');
  const subtitle = page.locator('.qf-proj .qf-field:has(> .qf-field__label:text-is("Subtitle")) input');
  await subtitle.click();
  await page.keyboard.type('Part 2 of 3');
  t.assert((await snap(t)).tab === 'project' && (await subtitle.inputValue()).endsWith('Part 2 of 3'), 'digits type into the subtitle');
  await page.keyboard.press('Tab');
  await tab(t, 'map');
}

async function leakChecks(t, base) {
  const { page } = t;
  const cycle = async (n) => {
    // Visit every tab and both lazy sidebars, run a playtest, then go back to the menu.
    for (const id of ['art', 'dialogue', 'project', 'map']) await tab(t, id);
    await sideTab(t, 'Entities');
    await sideTab(t, 'Triggers');
    // A context menu left open when the editor goes away must go with it.
    const c = await page.locator('.qf-map-canvas').boundingBox();
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2, { button: 'right' });
    await t.until(() => !!document.querySelector('.qf-map-menu'));
    await page.keyboard.press('Escape');
    await page.keyboard.press('F5');
    await t.until(() => window.__qf.game?.state === 'playing', undefined, 8000);
    await t.wait(400);
    await page.keyboard.press('Escape');
    await t.until(() => !document.querySelector('.qf-playtest'), undefined, 4000);
    await page.click('.qf-shell__bar button:has-text("Menu")');
    await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, undefined, 8000);
    await t.wait(800);
    const now = await t.eval(() => window.__leaks());
    const extra = now.listeners.filter((l) => !base.listeners.includes(l));
    const missing = base.listeners.filter((l) => !now.listeners.includes(l));
    t.assert(extra.length === 0 && now.listeners.length === base.listeners.length,
      `round ${n}: leaving the editor leaves no document/window listener behind (${extra.join(' || ')}${missing.length ? ` / missing ${missing.join(' || ')}` : ''})`);
    t.assert(now.intervals === base.intervals, `round ${n}: no interval keeps running (${base.intervals} -> ${now.intervals})`);
    t.assert(JSON.stringify(now.parked) === JSON.stringify(base.parked), `round ${n}: nothing the editor put on <body> stays (${now.parked.join(', ')})`);
    const f0 = await t.eval(() => window.__leaks().frames);
    await t.wait(1000);
    const f1 = await t.eval(() => window.__leaks().frames);
    const perSecond = f1 - f0;
    t.log(`round ${n}: ${perSecond} animation frames/s on the menu`);
    t.assert(perSecond <= base.menuFps * 1.3 + 5, `round ${n}: no editor or game animation loop survives (${perSecond}/s vs ${base.menuFps}/s)`);
    const refs = await t.eval(() => ({ editor: window.__qf.editor, game: window.__qf.game }));
    t.assert(refs.editor === null && refs.game === null, 'window.__qf drops the editor and game');
    // Keys on the menu must not reach a dead editor.
    for (const k of ['KeyG', 'KeyP', 'Digit2', 'Control+KeyZ', 'Delete']) await page.keyboard.press(k);
    await t.wait(100);
    t.assert(await t.eval(() => window.__qf.route?.view === 'menu' && !window.__qf.error), 'editor keys pressed on the menu do nothing');
  };
  await cycle(1);
  await t.eval(() => { location.hash = '#/edit/sample'; });
  await t.until(() => window.__qf.ready && !!window.__qf.editor, undefined, 15000);
  await t.wait(300);
  await cycle(2);
  await t.shot('menu-after-leaving');

  // Leaving by address with a context menu and then the help dialog open: both go with the editor.
  for (const opener of ['menu', 'help']) {
    await t.eval(() => { location.hash = '#/edit/sample'; });
    await t.until(() => window.__qf.ready && !!window.__qf.editor, undefined, 15000);
    await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
    await t.wait(200);
    if (opener === 'menu') {
      const c = await page.locator('.qf-map-canvas').boundingBox();
      await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2, { button: 'right' });
      await t.until(() => !!document.querySelector('.qf-map-menu'));
    } else {
      await page.keyboard.press('Shift+Slash');
      await t.until(() => !!document.querySelector('.qf-modal'));
    }
    await t.eval(() => { location.hash = '#/'; });
    await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, undefined, 8000);
    await t.wait(300);
    const now = await t.eval(() => window.__leaks());
    t.assert(JSON.stringify(now.parked) === JSON.stringify(base.parked) && !(await t.eval(() => !!document.querySelector('.qf-modal, .qf-map-menu'))),
      `leaving by address with the ${opener} open leaves nothing behind (${now.parked.join(', ')})`);
    t.assert(now.listeners.length === base.listeners.length, `leaving with the ${opener} open drops its listeners (${now.listeners.filter((l) => !base.listeners.includes(l)).join(' || ')})`);
  }
}
