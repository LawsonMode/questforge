// Dialogue tab mounted in isolation with a minimal EditorContext: list CRUD with
// reference checks, page editor, live preview (the game's own dialogue box),
// "Used by" jumps and the flags manager.

/** Page function: fixture project + EditorContext; mounts the Dialogue tab full-screen. */
async function setup() {
  const { createBlankProject, createRoom } = await import('/src/core/project.ts');
  const { defaultProps } = await import('/src/core/catalog.ts');
  const { UndoStack } = await import('/src/editor/undo.ts');
  const { Emitter } = await import('/src/core/events.ts');
  const { AssetCache } = await import('/src/gfx/imageCache.ts');
  const { toast } = await import('/src/editor/ui/dom.ts');
  const { mountDialogueTab } = await import('/src/editor/dialogue/dialogueTab.ts');

  const p = createBlankProject('Dialogue E2E');
  const world = p.worlds[0];
  const room = world.rooms[0];
  room.name = 'Village';
  const shop = createRoom({ name: 'Shop', gx: 1, gy: 0 });
  world.rooms.push(shop);
  const ent = (id, type, props = {}) => ({ id, type, x: 120, y: 88, props: { ...defaultProps(type), ...props } });
  p.dialogues.push(
    { id: 'd_elder', name: 'Elder intro', pages: [
      { speaker: 'Elder', text: 'Welcome to Brookhollow, {name}. The crown was stolen from the old keep, and the roads are no longer safe for travellers.' },
      { speaker: 'Elder', text: 'Will you help us?', choice: { options: ['Of course!', 'Not now.'], flag: 'accepted_quest' } },
    ] },
    { id: 'd_sign', name: 'Village sign', pages: [{ text: 'Brookhollow\nPop. 23' }] },
    { id: 'd_shop', name: 'Shopkeeper', pages: [{ speaker: 'Tam', text: 'Take a look around!' }] },
  );
  p.flags.push({ name: 'accepted_quest', description: 'Said yes to the elder' }, { name: 'gate_open' });
  room.entities.push(ent('e_elder', 'npc.person', { name: 'Elder', sprite: 'npc.elder', dialogue: 'd_elder' }), ent('e_sign', 'obj.sign', { dialogue: 'd_sign' }));
  room.triggers.push({ id: 't_gate', name: 'Gate', on: 'auto', once: true, conditions: [{ kind: 'flag', flag: 'accepted_quest', value: true }], actions: [{ kind: 'setFlag', flag: 'gate_open', value: true }, { kind: 'dialogue', dialogue: 'd_elder' }] });
  shop.triggers.push({ id: 't_shop', name: 'Greet', on: 'enter', once: false, conditions: [], actions: [{ kind: 'dialogue', dialogue: 'd_shop' }] });

  const bus = new Emitter();
  const undo = new UndoStack();
  const log = { changed: [], tabs: [], toasts: [] };
  const sel = { worldId: world.id, roomId: shop.id, layer: 'bg', tile: 1, terrainId: null, entityType: null, entityId: null };
  const ctx = {
    project: p, assets: new AssetCache(p), undo, bus,
    get worldId() { return sel.worldId; },
    get roomId() { return sel.roomId; },
    get layer() { return sel.layer; },
    get tile() { return sel.tile; },
    get terrainId() { return sel.terrainId; },
    get entityType() { return sel.entityType; },
    get entityId() { return sel.entityId; },
    selectRoom(w, r) { if (w === sel.worldId && r === sel.roomId) return; sel.worldId = w; sel.roomId = r; sel.entityId = null; bus.emit('selection', { what: 'room' }); },
    selectLayer() {}, selectTile() {}, selectTerrain() {}, selectEntityType() {},
    selectEntity(id) { sel.entityId = id; bus.emit('selection', { what: 'entity' }); },
    world() { return p.worlds.find((w) => w.id === sel.worldId); },
    room() { return this.world().rooms.find((r) => r.id === sel.roomId) ?? null; },
    changed(what, id) { log.changed.push(what); bus.emit('project', id === undefined ? { what } : { what, id }); },
    assetsChanged() {},
    switchTab(id) { log.tabs.push(id); bus.emit('tab', { id }); },
    playtest() {},
    async pickLocation() { return null; },
    setLocationPicker() {},
    async save() {},
    toast(m, k) { log.toasts.push(m); toast(m, k); },
  };
  const doUndo = () => { const c = undo.undo(); if (c) bus.emit('undo', { label: c.label }); return c?.label ?? null; };

  document.getElementById('app').style.display = 'none';
  const host = document.createElement('section');
  host.id = 'dlg-host';
  host.className = 'qf-shell__panel';
  host.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;overflow:auto;background:var(--qf-bg);';
  document.body.appendChild(host);
  const panel = mountDialogueTab(host, ctx);
  window.__dlg = { ctx, p, world, room, shop, log, doUndo, panel };
}

/** Page function: data URL of the preview canvas. */
const previewData = () => document.querySelector('.qf-dlg-preview__canvas').toDataURL();

/** Page function: fraction of preview pixels that are the box fill colour (dark navy). */
const boxInk = () => {
  const c = document.querySelector('.qf-dlg-preview__canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let navy = 0;
  let white = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] > 20 && d[i + 2] < 80) navy++;
    if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) white++;
  }
  return { navy: navy / (d.length / 4), white: white / (d.length / 4) };
};

export default async function (t) {
  const page = t.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await t.goto('#/');
  await t.eval(setup);
  await t.wait(200);
  await t.shot('initial');

  // ---------------------------------------------------------------- list
  const names = await page.locator('.qf-dlg-item__name').allTextContents();
  t.assert(JSON.stringify(names) === '["Elder intro","Shopkeeper","Village sign"]', `list sorted by name (${names})`);
  t.assert(await page.locator('.qf-dlg-name').inputValue() === 'Elder intro', 'first dialogue selected');
  const ink = await t.eval(boxInk);
  t.log('preview ink', ink);
  t.assert(ink.navy > 0.2 && ink.white > 0.005, 'preview draws the framed box with text');
  const used = await page.locator('.qf-dlg-used .qf-dlg-usage__label').allTextContents();
  t.assert(used.length === 2 && /Person “Elder”/.test(used[0]) && /Trigger “Gate”/.test(used[1]), `used-by list (${used})`);

  await page.locator('.qf-dlg-search').fill('tam');
  const filtered = await page.locator('.qf-dlg-item__name').allTextContents();
  t.assert(JSON.stringify(filtered) === '["Shopkeeper"]', `search matches speakers (${filtered})`);
  await page.locator('.qf-dlg-search').fill('');

  // ---------------------------------------------------------------- page editing + live preview
  await page.locator('.qf-dlg-preview__bar').getByRole('button', { name: 'Box ›' }).click();
  const status2 = await page.locator('.qf-dlg-preview__status').textContent();
  t.assert(/box 2 of 2/.test(status2), `long page spans two boxes and ▶ steps to box 2 (${status2})`);
  await t.shot('box-2');
  const text = page.locator('.qf-dlg-page__text').first();
  const before = await t.eval(previewData);
  await text.fill('Short and sweet.');
  const live = await t.eval(previewData);
  t.assert(live !== before, 'preview updates while typing');
  t.assert(/16 characters · 1 line · 1 box/.test(await page.locator('.qf-dlg-page__stats').first().textContent()), 'live character counter');
  t.assert(await t.eval(() => window.__dlg.p.dialogues[0].pages[0].text.startsWith('Welcome')), 'typing does not commit yet');
  await text.press('Tab');
  t.assert(await t.eval(() => window.__dlg.p.dialogues[0].pages[0].text === 'Short and sweet.'), 'blur commits the text');
  t.assert(await t.eval(() => document.activeElement?.closest('.qf-dlg-choice, .qf-dlg-page') !== null), 'focus survives the commit');
  await t.shot('edited-page-1');

  await page.locator('.qf-dlg-page').nth(1).locator('.qf-dlg-page__title').click();
  await t.wait(50);
  t.assert(/Page 2 of 2/.test(await page.locator('.qf-dlg-preview__status').textContent()), 'selecting page 2 moves the preview');
  await t.shot('choice-page');

  // choice editor
  await page.locator('.qf-dlg-page').nth(1).getByRole('button', { name: '+ Answer' }).click();
  let choice = await t.eval(() => window.__dlg.p.dialogues[0].pages[1].choice);
  t.assert(choice.options.length === 3, `+ Answer adds a third option (${JSON.stringify(choice)})`);
  t.assert(await page.locator('.qf-dlg-page').nth(1).getByRole('button', { name: '+ Answer' }).isDisabled(), 'at most 3 answers');
  const opt3 = page.locator('.qf-dlg-page').nth(1).locator('.qf-dlg-choice__row input').nth(2);
  await opt3.fill('Tell me more');
  await opt3.press('Enter');
  await page.locator('.qf-dlg-page').nth(1).locator('.qf-dlg-choice__row').nth(0).getByRole('button', { name: '✕' }).click();
  choice = await t.eval(() => window.__dlg.p.dialogues[0].pages[1].choice);
  t.assert(JSON.stringify(choice.options) === '["Not now.","Tell me more"]' && choice.flag === 'accepted_quest', `edit/remove answers (${JSON.stringify(choice)})`);

  // pages: add, move, delete
  await page.getByRole('button', { name: '+ Add page' }).click();
  await t.wait(50);
  t.assert(await page.locator('.qf-dlg-page').count() === 3, 'add page');
  const p3 = page.locator('.qf-dlg-page').nth(2);
  await p3.locator('.qf-field', { hasText: 'Speaker' }).locator('input').fill('Hero');
  await p3.locator('.qf-dlg-page__text').fill('I will find the crown.');
  await p3.locator('.qf-dlg-page__text').press('Tab');
  await p3.locator('.qf-dlg-page__head').getByRole('button', { name: '▲' }).click();
  await t.wait(50);
  let pages = await t.eval(() => window.__dlg.p.dialogues[0].pages.map((pg) => pg.speaker ?? ''));
  t.assert(JSON.stringify(pages) === '["Elder","Hero","Elder"]', `move page up (${pages})`);
  await t.shot('three-pages');
  await page.locator('.qf-dlg-page').nth(2).locator('.qf-dlg-page__head').getByRole('button', { name: '✕' }).click();
  pages = await t.eval(() => window.__dlg.p.dialogues[0].pages.length);
  t.assert(pages === 2, 'delete page');
  const undoLabel = await t.eval(() => window.__dlg.doUndo());
  t.assert(undoLabel === 'Delete page' && await t.eval(() => window.__dlg.p.dialogues[0].pages.length) === 3, `page delete undoes (${undoLabel})`);
  await t.wait(50);
  t.assert(await page.locator('.qf-dlg-page').count() === 3, 'tab refreshes after undo');

  // ---------------------------------------------------------------- play
  await page.locator('.qf-dlg-page').nth(0).locator('.qf-dlg-page__title').click();
  await page.getByRole('button', { name: '▶ Play' }).click();
  await t.wait(250);
  await t.shot('playing');
  t.assert(await page.getByRole('button', { name: '■ Stop' }).count() === 1, 'play mode shows a stop button');
  for (let i = 0; i < 12 && await page.getByRole('button', { name: '■ Stop' }).count(); i++) {
    await t.wait(700);
    await page.keyboard.press('Space');
  }
  t.assert(await page.getByRole('button', { name: '▶ Play' }).count() === 1, 'playback finishes after the last box');

  // ---------------------------------------------------------------- used by → jump
  await page.locator('.qf-dlg-used').getByRole('button', { name: 'Go' }).first().click();
  const jumped = await t.eval(() => ({ room: window.__dlg.ctx.roomId, entity: window.__dlg.ctx.entityId, tabs: window.__dlg.log.tabs }));
  t.assert(jumped.room === await t.eval(() => window.__dlg.room.id) && jumped.entity === 'e_elder' && jumped.tabs.at(-1) === 'map', `Go jumps to the entity on the map (${JSON.stringify(jumped)})`);

  // ---------------------------------------------------------------- delete with references
  await page.locator('.qf-dlg-item[data-dialogue="d_shop"]').click();
  await page.locator('.qf-dlg-listbar').getByRole('button', { name: 'Delete' }).click();
  await t.until(() => document.querySelector('.qf-modal'));
  t.assert(/Trigger “Greet”/.test(await page.locator('.qf-modal').textContent()), 'delete warns with the usage list');
  await t.shot('delete-warning');
  await page.locator('.qf-modal').getByRole('button', { name: 'Delete and clear references' }).click();
  const cleared = await t.eval(() => ({ has: window.__dlg.p.dialogues.some((d) => d.id === 'd_shop'), actions: window.__dlg.shop.triggers[0].actions.length }));
  t.assert(!cleared.has && cleared.actions === 0, `delete + clear references (${JSON.stringify(cleared)})`);
  await t.eval(() => window.__dlg.doUndo());
  const restored = await t.eval(() => ({ has: window.__dlg.p.dialogues.some((d) => d.id === 'd_shop'), actions: window.__dlg.shop.triggers[0].actions.length }));
  t.assert(restored.has && restored.actions === 1, `one undo restores dialogue and references (${JSON.stringify(restored)})`);

  // add / duplicate / rename
  await page.getByRole('button', { name: '+ New' }).click();
  const created = await t.eval(() => window.__dlg.p.dialogues.at(-1));
  t.assert(created.name === 'New dialogue' && await page.locator('.qf-dlg-name').inputValue() === 'New dialogue', 'new dialogue selected');
  t.assert(await t.eval(() => document.activeElement?.classList.contains('qf-dlg-page__text')), 'new dialogue focuses the text box');
  await page.keyboard.type('A brand new line.');
  await page.locator('.qf-dlg-listbar').getByRole('button', { name: 'Duplicate' }).click();
  const dupe = await t.eval(() => window.__dlg.p.dialogues.map((d) => d.name));
  t.assert(dupe.includes('New dialogue copy') && await t.eval(() => window.__dlg.p.dialogues.find((d) => d.name === 'New dialogue').pages[0].text === 'A brand new line.'), `duplicate (and the typed text was committed first) (${dupe})`);
  await page.locator('.qf-dlg-listbar').getByRole('button', { name: 'Rename' }).click();
  await t.until(() => document.querySelector('.qf-modal input'));
  await page.locator('.qf-modal input').fill('Copy renamed');
  await page.locator('.qf-modal input').press('Enter');
  await t.wait(50);
  t.assert(await t.eval(() => window.__dlg.p.dialogues.some((d) => d.name === 'Copy renamed')), 'rename via dialog');

  // ---------------------------------------------------------------- flags
  const flagRows = await page.locator('.qf-dlg-flag__name').allTextContents();
  t.assert(JSON.stringify(flagRows) === '["accepted_quest","gate_open"]', `flag list (${flagRows})`);
  const counts = await page.locator('.qf-dlg-flag__count').allTextContents();
  t.assert(JSON.stringify(counts) === '["2 uses","1 use"]', `usage counts (${counts})`);
  await page.locator('.qf-dlg-flags__add input').fill('found_crown');
  await page.locator('.qf-dlg-flags__add').getByRole('button', { name: 'Add' }).click();
  t.assert(await t.eval(() => window.__dlg.p.flags.some((f) => f.name === 'found_crown')), 'add flag');
  await page.locator('.qf-dlg-flags__add input').fill('chest:x');
  await page.locator('.qf-dlg-flags__add').getByRole('button', { name: 'Add' }).click();
  t.assert(await t.eval(() => !window.__dlg.p.flags.some((f) => f.name === 'chest:x') && window.__dlg.log.toasts.some((m) => /used by the engine/.test(m))), 'reserved flag names are refused');

  await page.locator('.qf-dlg-flag[data-flag="accepted_quest"]').getByRole('button', { name: 'Rename' }).click();
  await t.until(() => document.querySelector('.qf-modal input'));
  await page.locator('.qf-modal input').fill('quest_accepted');
  await page.locator('.qf-modal input').press('Enter');
  await t.wait(50);
  const renamed = await t.eval(() => ({
    cond: window.__dlg.room.triggers[0].conditions[0].flag,
    choice: window.__dlg.p.dialogues.find((d) => d.id === 'd_elder').pages.find((pg) => pg.choice)?.choice.flag,
    flags: window.__dlg.p.flags.map((f) => f.name),
  }));
  t.assert(renamed.cond === 'quest_accepted' && renamed.choice === 'quest_accepted' && renamed.flags.includes('quest_accepted'), `rename updates references (${JSON.stringify(renamed)})`);

  await page.locator('.qf-dlg-flag[data-flag="gate_open"]').getByRole('button', { name: 'Describe' }).click();
  await t.until(() => document.querySelector('.qf-modal input'));
  await page.locator('.qf-modal input').fill('The village gate was opened');
  await page.locator('.qf-modal input').press('Enter');
  await t.wait(50);
  t.assert(await t.eval(() => window.__dlg.p.flags.find((f) => f.name === 'gate_open').description === 'The village gate was opened'), 'describe flag');

  await page.locator('.qf-dlg-flag[data-flag="gate_open"] .qf-dlg-flag__count').click();
  await t.until(() => document.querySelector('.qf-modal .qf-dlg-usage'));
  t.assert(/Trigger “Gate”/.test(await page.locator('.qf-modal').textContent()), 'usage count opens the usage list');
  await page.keyboard.press('Escape');

  await page.locator('.qf-dlg-flag[data-flag="gate_open"]').getByRole('button', { name: 'Delete' }).click();
  await t.until(() => document.querySelector('.qf-modal'));
  await page.locator('.qf-modal').getByRole('button', { name: 'Delete' }).click();
  await t.wait(50);
  const undeclared = await page.locator('.qf-dlg-flags__undeclared .qf-dlg-flag__name').allTextContents();
  t.assert(JSON.stringify(undeclared) === '["gate_open"]', `a deleted-but-used flag shows as undeclared (${undeclared})`);
  await t.shot('flags');
  await page.locator('.qf-dlg-flags__undeclared').getByRole('button', { name: 'Declare' }).click();
  t.assert(await t.eval(() => window.__dlg.p.flags.some((f) => f.name === 'gate_open')), 'declare an undeclared flag');

  // ---------------------------------------------------------------- narrow layout + jump-to-dialogue request
  await page.setViewportSize({ width: 1024, height: 896 });
  await t.eval(async () => {
    const { requestDialogueFocus } = await import('/src/editor/entities/focus.ts');
    requestDialogueFocus('d_sign');
    window.__dlg.ctx.switchTab('dialogue');
  });
  await t.wait(80);
  t.assert(await page.locator('.qf-dlg-name').inputValue() === 'Village sign', 'a focus request selects that dialogue');
  await t.shot('narrow-layout');

  const errors = await t.eval(() => window.__dlg.log.toasts.filter((m) => /could not|failed/i.test(m)));
  t.assert(errors.length === 0, `no failure toasts (${errors})`);
  await t.eval(() => window.__dlg.panel.destroy());
  t.assert(await t.eval(() => !document.querySelector('.qf-dlg')), 'destroy() removes the tab');
}
