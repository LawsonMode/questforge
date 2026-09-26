// Editor shell: new blank project -> editor, tab switching (clicks & 1-4),
// rename + autosave + back to the menu, undo/redo buttons & shortcuts, the
// Project tab (settings, validation, start location), the playtest overlay
// (F5 / Escape), and an unsaved sample copy being stored on its first change.

const status = () => document.querySelector('.qf-shell__status-text')?.textContent ?? '';

export default async function (t) {
  // Sibling tabs (map/art/dialogue) are developed separately; the shell shows their load
  // errors in place, so a broken sibling module must not fail the shell scenarios.
  t.allowConsole(/\[editor\] the (map|art|dialogue) tab failed to load/);
  t.allowConsole(/^Failed to load resource: the server responded with a status of 500/);
  const { page } = t;

  // ---- create a blank project from the menu
  await t.goto('#/');
  await page.click('.qf-menu-cta:not(.qf-menu-cta--primary)');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await page.fill('.qf-menu-new input[aria-label="Project name"]', 'Shell Quest');
  await page.fill('.qf-menu-new input[aria-label="Author"]', 'Tester');
  await page.keyboard.press('Enter');
  await t.until(() => window.__qf.route?.view === 'edit' && window.__qf.ready && !!window.__qf.editor);
  const id = await t.eval(() => window.__qf.route.id);
  const mounted = (tab) => {
    const s = document.querySelector(`#qf-tabpanel-${tab}`);
    return !!s && s.childNodes.length > 0 && !s.querySelector('.qf-shell__loading');
  };
  await t.until(mounted, 'map', 8000);
  await t.wait(300);
  await t.shot('editor-map');

  const chrome = await t.eval(() => ({
    name: document.querySelector('.qf-shell__name')?.value,
    status: document.querySelector('.qf-shell__status-text')?.textContent,
    tabs: [...document.querySelectorAll('.qf-shell__tab')].map((b) => b.dataset.tab),
    active: window.__qf.editor.ctx.activeTab,
    undoDisabled: document.querySelector('.qf-shell__iconbtn[aria-label^="Nothing to undo"]')?.disabled,
    title: document.title,
  }));
  t.log('chrome', chrome);
  t.assert(chrome.name === 'Shell Quest', 'top bar shows the project name');
  t.assert(chrome.status === 'Saved', `a stored project starts "Saved" (${chrome.status})`);
  t.assert(chrome.tabs.join() === 'map,art,dialogue,project', 'tab strip: Map | Art | Dialogue | Project');
  t.assert(chrome.active === 'map', 'the map tab opens first');
  t.assert(chrome.undoDisabled === true, 'undo is disabled with an empty history');
  t.assert(/Shell Quest/.test(chrome.title), 'window title names the project');

  // ---- tabs: click and number keys; panels stay mounted
  for (const tab of ['art', 'dialogue', 'project']) {
    await page.click(`.qf-shell__tab[data-tab="${tab}"]`);
    await t.until((tb) => window.__qf.editor.ctx.activeTab === tb && !document.querySelector(`#qf-tabpanel-${tb}`).hidden, tab);
  }
  await t.until(() => !!document.querySelector('#qf-tabpanel-project .qf-proj'), null, 8000);
  await page.locator('body').click({ position: { x: 5, y: 890 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Digit1');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'map');
  await page.keyboard.press('Digit4');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'project');
  const panels = await t.eval(() => [...document.querySelectorAll('.qf-shell__panel')].map((s) => ({
    tab: s.dataset.tab, hidden: s.hidden, mounted: s.childNodes.length > 0 && !s.querySelector('.qf-shell__loading'),
  })));
  t.assert(panels.every((p) => p.mounted), `every visited tab stays mounted (${JSON.stringify(panels)})`);
  t.assert(panels.filter((p) => !p.hidden).length === 1, 'only the active panel is visible');
  await t.wait(400);
  await t.shot('project-tab');
  await t.eval(() => { document.querySelector('#qf-tabpanel-project').scrollTop = 10000; });
  await t.wait(100);
  await t.shot('project-tab-bottom');
  await t.eval(() => { document.querySelector('#qf-tabpanel-project').scrollTop = 0; });

  // ---- Project tab: settings edit is undoable, validation renders
  const proj = await t.eval(() => ({
    verdict: document.querySelector('.qf-proj-verdict')?.textContent ?? '',
    worlds: document.querySelectorAll('.qf-proj-table tbody tr').length,
    place: document.querySelector('.qf-proj-start__place')?.textContent ?? '',
    items: document.querySelectorAll('.qf-proj-items__row').length,
  }));
  t.log('project tab', proj);
  t.assert(proj.verdict.length > 0, 'validation verdict is shown');
  t.assert(proj.worlds === 1, 'worlds summary lists the world');
  t.assert(/Start/.test(proj.place), `start location names the room (${proj.place})`);
  t.assert(proj.items >= 10, 'start items checklist is shown');

  await page.check('#qf-proj-item-bow');
  await t.until(() => window.__qf.editor.ctx.project.settings.startItems.bow === 1);
  const heartsInput = page.locator('input[aria-label="Starting hearts"]');
  await heartsInput.fill('6');
  await heartsInput.press('Enter');
  await t.until(() => window.__qf.editor.ctx.project.settings.startHearts === 6);
  const undoTitle = await t.eval(() => document.querySelectorAll('.qf-shell__iconbtn')[0].title);
  t.assert(/^Undo: Change starting hearts/.test(undoTitle), `undo tooltip names the command (${undoTitle})`);
  await page.click('.qf-shell__iconbtn >> nth=0');
  await t.until(() => window.__qf.editor.ctx.project.settings.startHearts === 3);
  const redoTitle = await t.eval(() => document.querySelectorAll('.qf-shell__iconbtn')[1].title);
  t.assert(/^Redo: Change starting hearts/.test(redoTitle), `redo tooltip names the command (${redoTitle})`);
  await page.click('.qf-shell__iconbtn >> nth=1');
  await t.until(() => window.__qf.editor.ctx.project.settings.startHearts === 6);
  await t.until(() => document.querySelector('input[aria-label="Starting hearts"]').value === '6');

  // Validation "Go": a broken start location reveals the Start location panel ("Pick on map" fixes it).
  await t.eval(() => {
    const { ctx } = window.__qf.editor;
    ctx.project.start.x = 9999;
    ctx.changed('settings');
  });
  await t.until(() => document.querySelector('.qf-proj-verdict')?.dataset.state === 'error', null, 3000);
  const outside = await t.eval(() => {
    const n = document.querySelector('.qf-proj-start__notice');
    return n && !n.hidden ? n.textContent : null;
  });
  t.assert(/Start is outside the room/.test(outside ?? ''), `the preview flags a start outside its room (${outside})`);
  await t.shot('project-tab-error');
  await page.click('.qf-proj-problem--error:has-text("The start location") .qf-btn');
  await t.wait(100);
  const revealed = await t.eval(() => ({ tab: window.__qf.editor.ctx.activeTab, focused: document.activeElement?.textContent }));
  t.assert(revealed.tab === 'project' && revealed.focused === 'Pick on map', `"Go" on a start problem reveals the Start location panel (${JSON.stringify(revealed)})`);

  // ...and a problem inside a room selects that room and entity on the map tab.
  const signId = await t.eval(() => {
    const { ctx } = window.__qf.editor;
    const p = ctx.project;
    const room = p.worlds.find((w) => w.id === p.start.world).rooms.find((r) => r.id === p.start.room);
    const sign = { id: 'e_badsign', type: 'obj.sign', x: 40, y: 40, props: { dialogue: 'no_such_dialogue', text: '' } };
    room.entities.push(sign);
    ctx.changed('entities', sign.id);
    ctx.selectRoom(ctx.worldId, null);
    return sign.id;
  });
  await t.until(() => [...document.querySelectorAll('.qf-proj-problem__msg')].some((m) => m.textContent.includes('no_such_dialogue')), null, 3000);
  await page.click('.qf-proj-problem--error:has-text("no_such_dialogue") .qf-btn');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'map');
  const jumped = await t.eval((id) => {
    const { ctx } = window.__qf.editor;
    return ctx.roomId === ctx.project.start.room && ctx.entityId === id;
  }, signId);
  t.assert(jumped, 'validation "Go" selects the problem room and entity on the map tab');
  await t.eval((id) => {
    const { ctx } = window.__qf.editor;
    for (const w of ctx.project.worlds) for (const r of w.rooms) r.entities = r.entities.filter((e) => e.id !== id);
    ctx.selectEntity(null);
    ctx.changed('entities');
  }, signId);

  // "Pick on map" hands off to the map's picker and stores the answer as one undo step.
  await page.keyboard.press('Digit4');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'project');
  await t.eval(() => {
    const { ctx } = window.__qf.editor;
    ctx.setLocationPicker(async () => ({ world: ctx.project.start.world, room: ctx.project.start.room, x: 72, y: 88 }));
  });
  await page.click('.qf-proj-start__actions .qf-btn >> nth=0');
  await t.until(() => window.__qf.editor.ctx.project.start.x === 72 && window.__qf.editor.ctx.activeTab === 'project');
  const picked = await t.eval(() => ({
    start: window.__qf.editor.ctx.project.start,
    coords: document.querySelector('.qf-proj-start__coords')?.textContent,
    undo: window.__qf.editor.ctx.undo.peekUndo(),
  }));
  t.assert(picked.start.y === 88 && picked.coords === 'x 72, y 88', `picked start is shown (${picked.coords})`);
  t.assert(picked.undo === 'Set start location', `picking is undoable (${picked.undo})`);
  await t.until(() => document.querySelector('.qf-proj-verdict')?.dataset.state !== 'error', null, 3000);

  // ---- rename in the top bar -> dirty -> autosave -> stored
  await page.fill('.qf-shell__name', 'Renamed Quest');
  await page.press('.qf-shell__name', 'Enter');
  await t.until(() => document.title.startsWith('Renamed Quest'));
  const dirty = await t.eval(status);
  t.assert(dirty === 'Unsaved changes' || dirty === 'Saving…', `status shows unsaved changes (${dirty})`);
  await t.until(() => (document.querySelector('.qf-shell__status-text')?.textContent ?? '') === 'Saved', null, 5000);
  const storedName = await t.eval(async (pid) => (await (await import('/src/core/storage.ts')).loadProject(pid))?.name, id);
  t.assert(storedName === 'Renamed Quest', `autosave stored the new name (${storedName})`);
  const projField = await t.eval(() => document.querySelector('.qf-proj input.qf-input')?.value);
  t.assert(projField === 'Renamed Quest', `the Project tab follows the rename (${projField})`);

  // Keyboard undo / redo (focus outside inputs).
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await t.until(() => document.querySelector('.qf-shell__name').value === 'Shell Quest');
  await page.keyboard.press('Control+Shift+z');
  await t.until(() => document.querySelector('.qf-shell__name').value === 'Renamed Quest');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await t.until(() => document.querySelector('.qf-shell__name').value === 'Renamed Quest');

  // ---- help modal
  await page.click('.qf-shell__iconbtn[aria-label^="Help"]');
  await t.until(() => !!document.querySelector('.qf-help'));
  await t.shot('help');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-help'));

  // ---- playtest overlay: F5 opens, Escape returns
  await page.keyboard.press('F5');
  await t.until(() => !!document.querySelector('.qf-playtest') && !!window.__qf.game, null, 5000);
  await t.wait(700);
  const during = await t.eval(() => ({
    shellHidden: document.querySelector('.qf-shell').hidden,
    state: window.__qf.game?.state,
    separate: window.__qf.game?.services?.project !== window.__qf.editor.ctx.project,
  }));
  t.log('playtest', during);
  t.assert(during.shellHidden, 'the editor hides under the playtest overlay');
  t.assert(during.state === 'playing' || during.state === 'dialogue', `the game runs in playtest mode (${during.state})`);
  await t.shot('playtest');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest') && !document.querySelector('.qf-shell').hidden);
  const after = await t.eval(() => ({ game: window.__qf.game, playing: window.__qf.editor.playtesting }));
  t.assert(after.game === null && after.playing === false, 'Escape closes the overlay and releases the game');

  // Shift+F5 plays from the selected room.
  await page.keyboard.press('Shift+F5');
  await t.until(() => !!document.querySelector('.qf-playtest'), null, 5000);
  await t.wait(300);
  await page.click('.qf-playtest__close');
  await t.until(() => !document.querySelector('.qf-playtest'));

  // ---- back to the menu: the renamed project is listed
  await page.click('.qf-shell__bar button[title="Back to the main menu"]');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  await t.until((pid) => document.querySelector(`.qf-menu-card[data-project-id="${pid}"] .qf-menu-card__name`)?.textContent === 'Renamed Quest', id, 5000);

  // ---- editing the sample opens an unsaved copy, stored on the first change
  await t.goto('#/edit/sample');
  await t.until(() => !!window.__qf.editor);
  const fresh = await t.eval(() => ({ status: document.querySelector('.qf-shell__status-text')?.textContent, hash: location.hash }));
  t.assert(fresh.status === 'Not saved yet', `an untouched sample copy is not stored (${fresh.status})`);
  const countBefore = await t.eval(async () => (await (await import('/src/core/storage.ts')).listProjects()).length);
  await page.fill('.qf-shell__name', 'My Remix');
  await page.press('.qf-shell__name', 'Enter');
  await t.until(() => /^#\/edit\/p_/.test(location.hash), null, 5000);
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => n.textContent === 'Saved as a new project'));
  const countAfter = await t.eval(async () => (await (await import('/src/core/storage.ts')).listProjects()).length);
  t.assert(countAfter === countBefore + 1, `the copy was stored as a new project (${countBefore} -> ${countAfter})`);
  await t.shot('sample-copy-saved');

  // Ctrl+S saves explicitly.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+s');
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => n.textContent === 'Saved'));

  // A playtest of the sample copy spawns its placed entities (behaviours load with the editor).
  await page.keyboard.press('F5');
  await t.until(() => !!window.__qf.game?.services?.player, null, 8000);
  const spawned = await t.eval(() => {
    const s = window.__qf.game.services;
    return { placed: s.room.entities?.length ?? null, live: s.entities.filter((e) => e !== s.player).length };
  });
  t.log('sample playtest entities', spawned);
  t.assert(spawned.live > 0, `the sample's start room spawns its entities (${JSON.stringify(spawned)})`);
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'));
}
