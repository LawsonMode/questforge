// Entity palette + inspector and the trigger panel, mounted in isolation with a
// minimal EditorContext built in the page (the map tab may not host them yet).

/** Page function: build a fixture project + EditorContext and mount both panels side by side. */
async function setup() {
  const { createBlankProject, createRoom } = await import('/src/core/project.ts');
  const { defaultProps } = await import('/src/core/catalog.ts');
  const { UndoStack } = await import('/src/editor/undo.ts');
  const { Emitter } = await import('/src/core/events.ts');
  const { AssetCache } = await import('/src/gfx/imageCache.ts');
  const { toast } = await import('/src/editor/ui/dom.ts');
  const { mountEntityPanel } = await import('/src/editor/entities/entityPanel.ts');
  const { mountTriggerPanel } = await import('/src/editor/entities/triggerPanel.ts');

  const p = createBlankProject('Entity E2E');
  const world = p.worlds[0];
  const room = world.rooms[0];
  room.name = 'Courtyard';
  const cave = createRoom({ name: 'Cave', gx: 1, gy: 0 });
  world.rooms.push(cave);
  const ent = (id, type, x, y, props = {}) => ({ id, type, x, y, props: { ...defaultProps(type), ...props } });
  room.entities.push(
    ent('e_sold', 'enemy.soldier', 72, 56, { variant: 'blue' }),
    ent('e_chest', 'obj.chest', 136, 104, { item: 'bow', hidden: true }),
    ent('e_door', 'obj.door', 128, 8, { kind: 'shutter', link: 'court-n' }),
    ent('e_sw', 'obj.switch', 40, 152),
    ent('e_mira', 'npc.person', 200, 72, { name: 'Mira', sprite: 'npc.elder' }),
    ent('e_warp', 'marker.warp', 232, 200),
    ent('e_block', 'obj.block', 88, 152),
    ent('e_eye', 'enemy.eye', 200, 152),
  );
  room.triggers.push(
    { id: 't_clear', name: 'Reward', on: 'auto', once: true, conditions: [{ kind: 'enemiesCleared' }], actions: [{ kind: 'showEntity', target: 'e_chest' }, { kind: 'secret' }] },
    { id: 't_talk', name: 'Mira chat', on: 'talk', source: 'e_mira', once: false, conditions: [], actions: [{ kind: 'dialogue', dialogue: 'd_hi' }, { kind: 'setFlag', flag: 'met_mira', value: true }] },
  );
  p.dialogues.push({ id: 'd_hi', name: 'Mira hello', pages: [{ speaker: 'Mira', text: 'Hello, {name}!' }] });
  p.flags.push({ name: 'met_mira', description: 'Talked to Mira once' });

  const bus = new Emitter();
  const undo = new UndoStack();
  const log = { changed: [], tabs: [], prompts: [], toasts: [] };
  const sel = { worldId: world.id, roomId: room.id, layer: 'bg', tile: 4, terrainId: null, entityType: null, entityId: null };
  const assets = new AssetCache(p);
  const ctx = {
    project: p, assets, undo, bus,
    get worldId() { return sel.worldId; },
    get roomId() { return sel.roomId; },
    get layer() { return sel.layer; },
    get tile() { return sel.tile; },
    get terrainId() { return sel.terrainId; },
    get entityType() { return sel.entityType; },
    get entityId() { return sel.entityId; },
    selectRoom(w, r) {
      if (w === sel.worldId && r === sel.roomId) return;
      sel.worldId = w; sel.roomId = r; sel.entityId = null;
      bus.emit('selection', { what: 'room' });
    },
    selectLayer(l) { sel.layer = l; bus.emit('selection', { what: 'layer' }); },
    selectTile(id) { sel.tile = id; bus.emit('selection', { what: 'tile' }); },
    selectTerrain(id) { sel.terrainId = id; bus.emit('selection', { what: 'tile' }); },
    selectEntityType(t) { if (sel.entityType === t) return; sel.entityType = t; bus.emit('selection', { what: 'entityType' }); },
    selectEntity(id) { if (sel.entityId === id) return; sel.entityId = id; bus.emit('selection', { what: 'entity' }); },
    world() { return p.worlds.find((w) => w.id === sel.worldId); },
    room() { return this.world().rooms.find((r) => r.id === sel.roomId) ?? null; },
    changed(what, id) {
      log.changed.push(what);
      if (sel.entityId && !this.room()?.entities.some((e) => e.id === sel.entityId)) this.selectEntity(null);
      bus.emit('project', id === undefined ? { what } : { what, id });
    },
    assetsChanged(kind, id) { assets.invalidateAll(); bus.emit('assets', { kind, id }); },
    switchTab(id) { log.tabs.push(id); bus.emit('tab', { id }); },
    playtest() {},
    async pickLocation(prompt) { log.prompts.push(prompt); return window.__ent.pick; },
    setLocationPicker() {},
    async save() {},
    toast(m, k) { log.toasts.push(m); toast(m, k); },
  };
  const doUndo = () => { const c = undo.undo(); if (c) bus.emit('undo', { label: c.label }); return c?.label ?? null; };
  const doRedo = () => { const c = undo.redo(); if (c) bus.emit('undo', { label: c.label }); return c?.label ?? null; };

  document.getElementById('app').style.display = 'none';
  const host = document.createElement('div');
  host.id = 'ent-host';
  host.style.cssText = 'position:fixed;inset:0;display:flex;gap:8px;padding:8px;background:var(--qf-bg);';
  const col = (id, w) => {
    const c = document.createElement('div');
    c.id = id;
    c.className = 'qf-panel';
    c.style.cssText = `width:${w}px;overflow:auto;display:flex;flex-direction:column;`;
    host.appendChild(c);
    return c;
  };
  const entCol = col('ent-col', 276);
  const trigCol = col('trig-col', 276);
  document.body.appendChild(host);
  const entityPanel = mountEntityPanel(entCol, ctx);
  const triggerPanel = mountTriggerPanel(trigCol, ctx);
  window.__ent = { ctx, p, world, room, cave, log, pick: null, doUndo, doRedo, entityPanel, triggerPanel };
}

export default async function (t) {
  await t.page.setViewportSize({ width: 1024, height: 1200 });
  await t.goto('#/');
  await t.eval(setup);
  await t.wait(200);
  const page = t.page;
  const ent = page.locator('#ent-col');
  const trig = page.locator('#trig-col');
  await t.shot('initial');

  // ---------------------------------------------------------------- palette
  const groups = await t.eval(() => [...document.querySelectorAll('#ent-col .qf-ent-cat__title')].map((n) => n.textContent));
  t.assert(JSON.stringify(groups) === JSON.stringify(['Enemies', 'Bosses', 'NPCs', 'Objects', 'Pickups', 'Markers']), `palette groups in order (${groups})`);
  const inked = await t.eval(() => [...document.querySelectorAll('#ent-col .qf-ent-item canvas')].filter((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  }).length);
  const total = await t.eval(() => document.querySelectorAll('#ent-col .qf-ent-item').length);
  t.log('palette icons drawn', inked, 'of', total);
  t.assert(total >= 28 && inked === total, `every palette item has a drawn icon (${inked}/${total})`);

  await ent.locator('.qf-ent-item[data-type="enemy.soldier"]').click();
  t.assert(await t.eval(() => window.__ent.ctx.entityType === 'enemy.soldier'), 'clicking a palette item arms it for placement');
  t.assert(await ent.locator('.qf-ent-item--active').count() === 1, 'armed item is highlighted');
  t.assert(await ent.locator('.qf-ent-placing').count() === 1, 'placing banner shown');
  await t.shot('armed-soldier');
  await page.keyboard.press('Escape');
  t.assert(await t.eval(() => window.__ent.ctx.entityType === null), 'Escape clears the armed type');
  await ent.locator('.qf-ent-item[data-type="obj.chest"]').click();
  await ent.locator('.qf-ent-item[data-type="obj.chest"]').click();
  t.assert(await t.eval(() => window.__ent.ctx.entityType === null), 'clicking the armed item again clears it');
  await ent.locator('.qf-ent-item[data-type="enemy.bat"]').click();
  await t.eval(() => { document.getElementById('ent-col').style.display = 'none'; });
  await page.keyboard.press('Escape');
  t.assert(await t.eval(() => window.__ent.ctx.entityType === 'enemy.bat'), 'Escape leaves the armed type alone while the panel is hidden');
  await t.eval(() => { document.getElementById('ent-col').style.display = 'flex'; window.__ent.entityPanel.refresh(); });
  await page.keyboard.press('Escape');
  t.assert(await t.eval(() => window.__ent.ctx.entityType === null), 'Escape clears it again once the panel shows');

  await ent.locator('.qf-ent-search').fill('torch');
  const visible = await t.eval(() => [...document.querySelectorAll('#ent-col .qf-ent-item')].filter((b) => !b.hidden).map((b) => b.dataset.type));
  t.assert(JSON.stringify(visible) === '["obj.torch"]', `search filters the palette (${visible})`);
  await ent.locator('.qf-ent-search').fill('');

  // ---------------------------------------------------------------- inspector: chest
  await t.eval(() => window.__ent.ctx.selectEntity('e_chest'));
  await t.wait(50);
  const head = await ent.locator('.qf-ent-head__name').textContent();
  t.assert(head === 'Chest', `inspector header shows the type (${head})`);
  t.assert(await ent.locator('.qf-ent-id').textContent() === 'e_chest', 'inspector shows the id');
  await t.shot('inspect-chest');
  const contents = ent.locator('.qf-field', { hasText: 'Contents' }).locator('select');
  await contents.selectOption('map');
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_chest').props.item === 'map'), 'item select edits the prop');
  const warn = await ent.locator('.qf-ent-warn').textContent();
  t.assert(/only works inside a dungeon/.test(warn ?? ''), `dungeon-item warning shows inline (${warn})`);
  await t.shot('chest-map-warning');
  const label = await t.eval(() => window.__ent.doUndo());
  t.assert(label === 'Set contents', `edit is one undo step (${label})`);
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_chest').props.item === 'bow'), 'undo restores the prop');
  await t.wait(50);
  t.assert(await contents.inputValue() === 'bow', 'inspector refreshes after undo');

  const amount = ent.locator('.qf-field', { hasText: 'Amount' }).locator('input');
  await amount.fill('20');
  await amount.press('Tab');
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_chest').props.amount === 20), 'number field edits the prop');
  await amount.fill('2.4');
  await amount.press('Tab');
  const whole = await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_chest').props.amount);
  t.assert(whole === 2 && await amount.inputValue() === '2', `whole-number props round a typed fraction (${whole})`);

  // Keyboard changes on a select keep focus there (the rebuild must not drop it to <body>).
  await contents.focus();
  await page.keyboard.press('ArrowDown');
  await t.wait(50);
  const keyFocus = await t.eval(() => ({ fk: document.activeElement?.dataset.fk, item: window.__ent.room.entities.find((e) => e.id === 'e_chest').props.item }));
  t.assert(keyFocus.fk === 'prop:item' && keyFocus.item !== 'bow', `focus stays on the select after a keyboard change (${JSON.stringify(keyFocus)})`);
  await t.eval(() => window.__ent.doUndo());
  await t.wait(50);
  const xInput = ent.locator('.qf-ent-xy input').first();
  await xInput.fill('152');
  await xInput.press('Tab');
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_chest').x === 152), 'x input moves the entity');
  const focused = await t.eval(() => document.activeElement?.closest('.qf-ent-xy') !== null);
  t.assert(focused, 'focus moved on to the y field (no rebuild stole it)');

  // ---------------------------------------------------------------- inspector: warp
  await t.eval(() => window.__ent.ctx.selectEntity('e_warp'));
  await t.wait(50);
  t.assert(/No destination/.test(await ent.locator('.qf-ent-warp__summary').textContent()), 'warp without target says so');
  t.assert(/no destination yet/.test(await ent.locator('.qf-ent-warn').textContent()), 'warp without target warns');
  await t.eval(() => { window.__ent.pick = { world: window.__ent.world.id, room: window.__ent.cave.id, x: 100.4, y: 79.6 }; });
  await ent.getByRole('button', { name: 'Pick on map' }).click();
  await t.wait(50);
  const target = await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_warp').props.target);
  t.assert(target && target.room === await t.eval(() => window.__ent.cave.id) && target.x === 100 && target.y === 80, `warp target picked & rounded (${JSON.stringify(target)})`);
  const summary = await ent.locator('.qf-ent-warp__summary').textContent();
  t.assert(/› Cave \(100,80\)/.test(summary), `warp summary text (${summary})`);
  await t.shot('warp-picked');
  // The real map picker always reports dir 'down': it seeds a first pick but never overrides a chosen facing.
  await t.eval(() => { window.__ent.pick = { world: window.__ent.world.id, room: window.__ent.room.id, x: 40, y: 40, dir: 'down' }; });
  await ent.locator('.qf-ent-warp select').selectOption('up');
  await ent.getByRole('button', { name: 'Pick on map' }).click();
  await t.wait(50);
  const repicked = await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_warp').props.target);
  t.assert(repicked.x === 40 && repicked.dir === 'up', `re-picking keeps the arrival facing (${JSON.stringify(repicked)})`);
  await ent.getByRole('button', { name: 'Clear' }).click();
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_warp').props.target === null), 'Clear removes the target');
  await ent.getByRole('button', { name: 'Pick on map' }).click();
  await t.wait(50);
  const first = await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_warp').props.target);
  t.assert(first.dir === 'down', `a first pick takes the picker's facing (${JSON.stringify(first)})`);
  const w = ent.locator('.qf-field', { hasText: 'Width (tiles)' }).locator('input');
  await w.fill('1.5');
  await w.press('Tab');
  const width = await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_warp').props.w);
  t.assert(width === 2, `tile sizes stay whole numbers (${width})`);

  // ---------------------------------------------------------------- inspector: person + new dialogue
  await t.eval(() => window.__ent.ctx.selectEntity('e_mira'));
  await t.wait(50);
  await t.shot('inspect-person');
  const before = await t.eval(() => window.__ent.p.dialogues.length);
  await ent.locator('.qf-field', { hasText: 'Dialogue' }).getByRole('button', { name: 'New' }).click();
  const made = await t.eval(() => ({ n: window.__ent.p.dialogues.length, prop: window.__ent.room.entities.find((e) => e.id === 'e_mira').props.dialogue, last: window.__ent.p.dialogues.at(-1), tabs: window.__ent.log.tabs }));
  t.assert(made.n === before + 1 && made.prop === made.last.id && made.last.name === 'Mira', `"New" creates a dialogue named after the person (${JSON.stringify(made.last)})`);
  await ent.locator('.qf-field', { hasText: 'Dialogue' }).getByRole('button', { name: 'New' }).click();
  const second = await t.eval(() => window.__ent.p.dialogues.at(-1).name);
  t.assert(second === 'Mira 2', `a second "New" gets a unique name (${second})`);
  await t.eval(() => window.__ent.doUndo());
  t.assert(made.tabs.includes('dialogue'), '"New" opens the Dialogue tab');
  await t.eval(() => window.__ent.doUndo());
  const undone = await t.eval(() => ({ n: window.__ent.p.dialogues.length, prop: window.__ent.room.entities.find((e) => e.id === 'e_mira').props.dialogue }));
  t.assert(undone.n === before && undone.prop === '', `one undo removes the dialogue and the reference (${JSON.stringify(undone)})`);

  // ---------------------------------------------------------------- duplicate / delete
  await t.eval(() => window.__ent.ctx.selectEntity('e_sold'));
  await t.wait(50);
  await ent.getByRole('button', { name: 'Duplicate' }).click();
  const dup = await t.eval(() => ({ sel: window.__ent.ctx.entityId, n: window.__ent.room.entities.filter((e) => e.type === 'enemy.soldier').length }));
  t.assert(dup.n === 2 && dup.sel !== 'e_sold', `duplicate adds a copy and selects it (${JSON.stringify(dup)})`);
  await t.eval(() => window.__ent.ctx.selectEntity('e_chest'));
  await t.wait(50);
  await ent.getByRole('button', { name: 'Delete' }).click();
  await t.until(() => document.querySelector('.qf-modal'));
  const modalText = await page.locator('.qf-modal').textContent();
  t.assert(/Trigger “Reward”/.test(modalText), 'deleting a referenced entity lists its users');
  await t.shot('delete-warning');
  await page.locator('.qf-modal').getByRole('button', { name: 'Delete' }).click();
  t.assert(await t.eval(() => !window.__ent.room.entities.some((e) => e.id === 'e_chest') && window.__ent.ctx.entityId === null), 'entity deleted and deselected');
  await t.eval(() => window.__ent.doUndo());
  t.assert(await t.eval(() => window.__ent.room.entities.some((e) => e.id === 'e_chest')), 'undo restores the deleted entity');

  // ---------------------------------------------------------------- triggers
  const lines = await trig.locator('.qf-ent-trig-item__summary').allTextContents();
  t.log('summaries', lines);
  t.assert(lines[0] === 'When all enemies are defeated → show Chest (e_chest), play secret', `summary line 1 (${lines[0]})`);
  t.assert(lines[1] === 'When talking to Person “Mira” (e_mira) → say “Mira hello”, set flag “met_mira” (repeats)', `summary line 2 (${lines[1]})`);

  await trig.locator('.qf-ent-trig-item[data-trigger="t_talk"]').click();
  t.assert(await trig.locator('.qf-ent-trig-editor .qf-ent-id').textContent() === 't_talk', 'clicking a trigger opens it');
  await t.shot('trigger-talk');

  await trig.locator('.qf-ent-trig-add').first().selectOption('defeated');
  await t.wait(50);
  const foes = await trig.locator('.qf-ent-trig-card', { hasText: 'Enemy defeated' }).locator('select option').allTextContents();
  t.assert(!foes.some((o) => /Eye Statue/.test(o)) && foes.some((o) => /Soldier/.test(o)), `"Enemy defeated" offers only defeatable foes (${foes})`);
  await trig.locator('.qf-ent-trig-card', { hasText: 'Enemy defeated' }).getByRole('button', { name: '✕' }).focus();
  await page.keyboard.press('Enter');
  await t.wait(50);
  t.assert(await t.eval(() => document.activeElement?.dataset.fk === 'cond:add'), 'focus lands on "+ Add condition" after removing a card');
  await trig.locator('.qf-ent-trig-add').first().selectOption('switch');
  const cond = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').conditions);
  t.assert(JSON.stringify(cond) === '[{"kind":"switch","target":"e_sw","on":true}]', `add condition targets the room's switch (${JSON.stringify(cond)})`);
  await t.wait(50);
  const stateSel = trig.locator('.qf-ent-trig-card').first().locator('.qf-field', { hasText: 'State' }).locator('select');
  await stateSel.selectOption('off');
  t.assert(await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').conditions[0].on === false), 'condition field edits');

  await trig.locator('.qf-ent-trig-add').nth(1).selectOption('setTile');
  await t.wait(50);
  await t.eval(() => { window.__ent.pick = { world: window.__ent.world.id, room: window.__ent.room.id, x: 40, y: 72 }; });
  const tileCard = trig.locator('.qf-ent-trig-card', { hasText: 'Change tile' });
  await tileCard.getByRole('button', { name: 'Pick on map' }).click();
  await t.wait(50);
  let act = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions[2]);
  t.assert(act.kind === 'setTile' && act.tx === 2 && act.ty === 4, `setTile position picked in tiles (${JSON.stringify(act)})`);
  await t.eval(() => window.__ent.ctx.selectTile(2));
  await t.wait(50);
  await trig.locator('.qf-ent-trig-card', { hasText: 'Change tile' }).getByRole('button', { name: 'Use brush' }).click();
  act = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions[2]);
  t.assert(act.tile === 2, `"Use brush" takes the map tile brush (${act.tile})`);
  await trig.locator('.qf-ent-trig-card', { hasText: 'Change tile' }).getByRole('button', { name: 'Choose…' }).click();
  await t.until(() => document.querySelector('.qf-ent-tilegrid'));
  await t.shot('tile-chooser');
  await page.locator('.qf-ent-tilegrid__cell[data-tile="4"]').click();
  act = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions[2]);
  t.assert(act.tile === 4, `tile chooser sets the tile (${act.tile})`);

  await trig.locator('.qf-ent-trig-add').nth(1).selectOption('sound');
  await t.wait(50);
  await trig.locator('.qf-ent-trig-card', { hasText: 'Play sound' }).getByRole('button', { name: '▶' }).click();

  // reorder: ▲ on the sound action moves it above setTile
  await trig.locator('.qf-ent-trig-card', { hasText: 'Play sound' }).getByRole('button', { name: '▲' }).click();
  await t.wait(50);
  let kinds = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions.map((a) => a.kind));
  t.assert(JSON.stringify(kinds) === '["dialogue","setFlag","sound","setTile"]', `▲ reorders actions (${kinds})`);
  // Keyboard: focus follows the moved card; at the top ▲ is disabled, so focus falls back to its ▼.
  await trig.locator('.qf-ent-trig-card', { hasText: 'Play sound' }).getByRole('button', { name: '▲' }).focus();
  await page.keyboard.press('Enter');
  await t.wait(50);
  await page.keyboard.press('Enter');
  await t.wait(50);
  const moved = await t.eval(() => ({
    kinds: window.__ent.room.triggers.find((x) => x.id === 't_talk').actions.map((a) => a.kind),
    fk: document.activeElement?.dataset.fk,
  }));
  t.assert(JSON.stringify(moved.kinds) === '["sound","dialogue","setFlag","setTile"]' && moved.fk === 'act:0:down', `keyboard ▲ moves twice and focus follows (${JSON.stringify(moved)})`);
  for (let i = 0; i < 2; i++) await t.eval(() => window.__ent.doUndo());
  await t.wait(50);
  const order = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions.map((a) => a.kind));
  t.assert(JSON.stringify(order) === '["dialogue","setFlag","sound","setTile"]', `undo restores the order (${order})`);
  // drag the first action onto the second card
  const cards = trig.locator('.qf-ent-trig-sec').nth(1).locator('.qf-ent-trig-card');
  await cards.nth(1).scrollIntoViewIfNeeded();
  await cards.first().locator('.qf-ent-trig-card__grip').dragTo(cards.nth(1));
  await t.wait(80);
  kinds = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions.map((a) => a.kind));
  t.log('after drag', kinds);
  t.assert(JSON.stringify(kinds) === '["setFlag","dialogue","sound","setTile"]', `drag & drop reorders actions (${kinds})`);

  const tx = trig.locator('.qf-ent-trig-card', { hasText: 'Change tile' }).locator('input[type=number]').first();
  await tx.fill('2.6');
  await tx.press('Tab');
  const rounded = await t.eval(() => window.__ent.room.triggers.find((x) => x.id === 't_talk').actions[3].tx);
  t.assert(rounded === 3, `tile column rounds to a whole number (${rounded})`);
  await tx.fill('2');
  await tx.press('Tab');
  const newSummary = await trig.locator('.qf-ent-trig-item[data-trigger="t_talk"] .qf-ent-trig-item__summary').textContent();
  t.log('talk summary', newSummary);
  t.assert(/if Floor Switch \(e_sw\) is off/.test(newSummary) && /set bg tile \(2,4\)/.test(newSummary), 'list summary follows edits');
  await t.shot('trigger-edited');

  // validation hints + undo
  await trig.locator('.qf-ent-trig-add').nth(1).selectOption('showEntity');
  await t.wait(50);
  const showCard = trig.locator('.qf-ent-trig-card', { hasText: 'Show entity' });
  await showCard.locator('select').first().selectOption('e_sold');
  await t.wait(50);
  const issues = await trig.locator('.qf-ent-trig-editor .qf-ent-warn').textContent();
  t.assert(/not marked Hidden/.test(issues ?? ''), `validation hint for a visible show target (${issues})`);
  await showCard.getByRole('button', { name: 'Mark it Hidden' }).click();
  t.assert(await t.eval(() => window.__ent.room.entities.find((e) => e.id === 'e_sold').props.hidden === true), '"Mark it Hidden" fixes the target');
  await t.wait(50);
  await t.shot('trigger-hints');

  const steps = [];
  for (let i = 0; i < 3; i++) steps.push(await t.eval(() => window.__ent.doUndo()));
  t.log('undo labels', steps);
  t.assert(steps[0] === 'Mark entity hidden' && steps[1] === 'Set entity' && steps[2] === 'Add action: Show entity', `each trigger edit is one undo step (${steps})`);

  // add / duplicate / move / delete triggers
  await trig.getByRole('button', { name: '+ Add' }).click();
  let ids = await t.eval(() => window.__ent.room.triggers.map((x) => x.name));
  t.assert(ids.length === 3 && ids[2] === 'Trigger 3', `+ Add appends a trigger (${ids})`);
  const nameInput = trig.locator('.qf-ent-trig-form .qf-field', { hasText: 'Name' }).locator('input');
  await nameInput.fill('Gate opener');
  await nameInput.press('Enter');
  await nameInput.press('Tab');
  t.assert(await t.eval(() => window.__ent.room.triggers[2].name === 'Gate opener'), 'rename a trigger');
  await nameInput.fill('');
  await nameInput.press('Tab');
  t.assert(await nameInput.inputValue() === 'Gate opener', 'clearing the name shows the kept name again');
  t.assert(await trig.locator('.qf-ent-trig-form .qf-field', { hasText: 'Fires' }).count() === 1, 'the once checkbox is labelled "Fires"');
  const addedId = await t.eval(() => window.__ent.room.triggers[2].id);
  await t.eval(() => { window.__ent.doUndo(); window.__ent.doUndo(); });
  await t.wait(50);
  await t.eval(() => { window.__ent.doRedo(); window.__ent.doRedo(); });
  await t.wait(50);
  const reselected = await trig.locator('.qf-ent-trig-editor .qf-ent-id').textContent();
  t.assert(reselected === addedId, `undo + redo of "+ Add" selects the re-added trigger (${reselected} vs ${addedId})`);
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: 'Duplicate' }).click();
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: '▲' }).click();
  ids = await t.eval(() => window.__ent.room.triggers.map((x) => x.name));
  t.assert(JSON.stringify(ids) === '["Reward","Mira chat","Gate opener copy","Gate opener"]', `duplicate + move up (${ids})`);
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: 'Delete' }).click();
  ids = await t.eval(() => window.__ent.room.triggers.map((x) => x.name));
  t.assert(ids.length === 3, `delete trigger (${ids})`);
  const selectWhen = trig.locator('.qf-ent-trig-form .qf-field', { hasText: 'When' }).locator('select');
  await selectWhen.selectOption('enter');
  t.assert(await t.eval(() => window.__ent.room.triggers.find((x) => x.name === 'Gate opener')?.on === 'enter'), 'change trigger event');
  await t.shot('triggers-final');

  // ---------------------------------------------------------------- room switch
  await t.eval(() => window.__ent.ctx.selectRoom(window.__ent.world.id, window.__ent.cave.id));
  await t.wait(50);
  t.assert(/Triggers in Cave/.test(await trig.locator('.qf-ent-trig-head__title').textContent()), 'trigger panel follows the room');
  t.assert(await trig.locator('.qf-ent-trig-item').count() === 0, 'new room has no triggers');
  await t.shot('empty-room');

  const errs = await t.eval(() => window.__ent.log.toasts.filter((m) => /cannot|error/i.test(m)));
  t.assert(errs.length === 0, `no error toasts (${errs})`);
  await t.eval(() => { window.__ent.entityPanel.destroy(); window.__ent.triggerPanel.destroy(); });
  t.assert(await t.eval(() => document.querySelectorAll('#ent-host .qf-ent-panel, #ent-host .qf-ent-trig').length === 0), 'destroy() removes both panels');
}
