// Editor shell regressions: the address after leaving a sample copy, shortcuts
// with a checkbox/select focused and on QWERTZ/AZERTY layouts, F5 / Ctrl+S with
// a half-typed field, keyboard-opened dialogs, dialogs left open on a route
// change, leaving while a save has failed, empty-project thumbnails, the start
// preview's facing, the hearts preview and the banner hero vs the buttons.

export default async function (t) {
  t.allowConsole(/\[editor\] the (map|art|dialogue) tab failed to load/);
  t.allowConsole(/^Failed to load resource: the server responded with a status of 500/);
  // The save-failure step makes IndexedDB reject a project holding a function.
  t.allowConsole(/DataCloneError|could not be cloned|Couldn't save/i);
  const { page } = t;
  const statusText = () => document.querySelector('.qf-shell__status-text')?.textContent ?? '';

  // ---- banner: the walking hero stays clear of the buttons
  await t.goto('#/');
  await t.wait(600);
  const banner = await t.eval(() => {
    const canvas = document.querySelector('.qf-menu-banner__canvas');
    const c = canvas.getBoundingClientRect();
    const scale = c.width / canvas.width;
    return { heroFeet: Math.round(c.top + 119 * scale), ctaTop: Math.round(document.querySelector('.qf-menu-ctas').getBoundingClientRect().top) };
  });
  t.log('banner hero feet vs CTA top', banner);
  t.assert(banner.heroFeet < banner.ctaTop, `the hero walks above the buttons (${banner.heroFeet} < ${banner.ctaTop})`);
  await t.shot('banner');

  // ---- a changed sample copy left through the address bar: the address stays on the menu
  await t.goto('#/edit/sample');
  await t.until(() => !!window.__qf.editor);
  await page.fill('.qf-shell__name', 'Left Behind');
  await page.press('.qf-shell__name', 'Enter');
  await t.eval(() => { location.hash = '#/'; });
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  await t.wait(800);
  const left = await t.eval(async (mod) => ({
    hash: location.hash,
    route: window.__qf.route.view,
    stored: (await (await import(mod)).listProjects()).some((m) => m.name === 'Left Behind'),
    card: [...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Left Behind'),
  }), '/src/core/storage.ts');
  t.log('after leaving a changed sample copy', left);
  t.assert(left.hash === '#/' && left.route === 'menu', `the address stays on the menu (${left.hash}, ${left.route})`);
  t.assert(left.stored && left.card, 'the copy was stored on the way out and has a card');

  // ---- a dialog left open by the menu closes on a route change (no stale key listener)
  const leftId = await t.eval(async (mod) => (await (await import(mod)).listProjects()).find((m) => m.name === 'Left Behind').id, '/src/core/storage.ts');
  await page.click(`.qf-menu-card[data-project-id="${leftId}"] .qf-menu-card__delete`);
  await t.until(() => !!document.querySelector('.qf-modal'));
  await t.eval(() => { location.hash = '#/gallery'; });
  await t.until(() => window.__qf.route?.view === 'gallery' && window.__qf.ready);
  const stray = await t.eval(async (id) => {
    let escapes = 0;
    const count = (e) => { if (e.key === 'Escape') escapes++; };
    document.addEventListener('keydown', count);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', count);
    const S = await import('/src/core/storage.ts');
    return { backdrops: document.querySelectorAll('.qf-modal-backdrop').length, escapes, kept: !!(await S.loadProject(id)) };
  }, leftId);
  t.log('dialog left open across a route change', stray);
  t.assert(stray.backdrops === 0 && stray.escapes === 1, `the old dialog is closed and swallows no keys (${JSON.stringify(stray)})`);
  t.assert(stray.kept, 'closing the old delete confirm did not delete the project');

  // ---- a project without rooms gets the "No rooms yet" thumbnail
  const emptyId = await t.eval(async () => {
    const P = await import('/src/core/project.ts');
    const S = await import('/src/core/storage.ts');
    const p = P.createBlankProject('Roomless');
    p.worlds[0].rooms = [];
    await S.saveProject(p);
    return p.id;
  });
  await t.goto('#/');
  await t.until(() => !document.querySelector('.qf-menu-card__thumb--loading'), null, 8000);
  const emptyThumb = await t.eval((id) => document.querySelector(`.qf-menu-card[data-project-id="${id}"] .qf-menu-card__thumb`)?.className ?? '', emptyId);
  t.assert(/--empty/.test(emptyThumb), `a project without rooms shows "No rooms yet" (${emptyThumb})`);
  await t.eval((id) => document.querySelector(`.qf-menu-card[data-project-id="${id}"]`)?.scrollIntoView({ block: 'center' }), emptyId);
  await t.shot('menu-empty-thumbnail');

  // ---- a new blank project, Project tab
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await page.fill('.qf-menu-new input[aria-label="Project name"]', 'Regression Quest');
  await page.keyboard.press('Enter');
  await t.until(() => window.__qf.route?.view === 'edit' && !!window.__qf.editor);
  const pid = await t.eval(() => window.__qf.route.id);
  await page.click('.qf-shell__tab[data-tab="project"]');
  await t.until(() => !!document.querySelector('#qf-tabpanel-project .qf-proj-verdict')?.textContent, null, 8000);

  // ---- Ctrl+Z / 1-4 right after ticking a checkbox (focus stays on it)
  await page.click('#qf-proj-item-bow');
  await t.until(() => window.__qf.editor.ctx.project.settings.startItems.bow === 1);
  await page.keyboard.press('Control+z');
  const afterUndo = await t.eval(() => ({ bow: window.__qf.editor.ctx.project.settings.startItems.bow ?? null, focus: document.activeElement?.type }));
  t.assert(afterUndo.bow === null, `Ctrl+Z with a checkbox focused undoes (${JSON.stringify(afterUndo)})`);
  await page.keyboard.press('Digit1');
  t.assert(await t.eval(() => window.__qf.editor.ctx.activeTab) === 'map', 'the 1 key switches tabs with a checkbox focused');
  await page.keyboard.press('Digit4');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'project');

  // ---- Ctrl+Z right after changing a select by keyboard; digits stay with the select
  await page.focus('select[aria-label="Facing at the start"]');
  await page.keyboard.press('ArrowDown');
  await t.until(() => window.__qf.editor.ctx.project.start.dir === 'up');
  await page.keyboard.press('Digit1');
  t.assert(await t.eval(() => window.__qf.editor.ctx.activeTab) === 'project', 'digits go to a focused select (type-ahead), not the tabs');
  await page.keyboard.press('Control+z');
  t.assert(await t.eval(() => window.__qf.editor.ctx.project.start.dir ?? 'down') === 'down', 'Ctrl+Z with a select focused undoes');

  // ---- other keyboard layouts: Ctrl+Z is the key labelled Z
  const layouts = await t.eval(() => {
    const { ctx } = window.__qf.editor;
    const s = ctx.project.settings;
    const push = () => {
      const a = s.startHearts;
      s.startHearts = a + 1;
      ctx.undo.push({ label: 'Hearts', undo: () => { s.startHearts = a; }, redo: () => { s.startHearts = a + 1; } });
      ctx.changed('settings');
      return a;
    };
    document.activeElement?.blur();
    const key = (k, code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, ctrlKey: true, bubbles: true, cancelable: true }));
    const a = push();
    key('z', 'KeyY'); // QWERTZ
    const qwertz = s.startHearts === a;
    const b = push();
    key('z', 'KeyW'); // AZERTY
    const azerty = s.startHearts === b;
    key('y', 'KeyZ'); // QWERTZ redo
    const redo = s.startHearts === b + 1;
    ctx.undoLast();
    return { qwertz, azerty, redo };
  });
  t.log('keyboard layouts', layouts);
  t.assert(layouts.qwertz && layouts.azerty && layouts.redo, `Ctrl+Z / Ctrl+Y follow the typed letter (${JSON.stringify(layouts)})`);

  // ---- the start preview follows the facing
  const preview = () => document.querySelector('.qf-proj-start__screen').toDataURL();
  const down = await t.eval(preview);
  await page.selectOption('select[aria-label="Facing at the start"]', 'left');
  const leftShot = await t.eval(preview);
  await page.selectOption('select[aria-label="Facing at the start"]', 'right');
  const rightShot = await t.eval(preview);
  t.assert(down !== leftShot && leftShot !== rightShot, 'the start preview shows the hero facing the chosen way');
  await t.eval(() => document.querySelector('.qf-proj-start').scrollIntoView({ block: 'center' }));
  await t.shot('start-facing-right');

  // ---- F5 with a half-typed value plays that value; Escape returns focus to the field
  const hearts = page.locator('input[aria-label="Starting hearts"]');
  await hearts.click();
  await hearts.fill('20');
  await page.keyboard.press('F5');
  await t.until(() => !!window.__qf.game?.services?.player, null, 5000);
  const played = await t.eval(() => ({ maxHp: window.__qf.game.services.save?.maxHp, editor: window.__qf.editor.ctx.project.settings.startHearts }));
  t.log('typed 20 hearts, then F5', played);
  t.assert(played.maxHp === 40 && played.editor === 20, `the playtest uses the half-typed value (${JSON.stringify(played)})`);
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'));
  t.assert(await t.eval(() => document.activeElement?.getAttribute('aria-label')) === 'Starting hearts', 'focus returns to the field after the playtest');

  // ---- hearts preview: rows of ten
  const rows = await t.eval(() => {
    const hs = [...document.querySelectorAll('.qf-proj-hearts canvas')];
    return { n: hs.length, row1: hs[9]?.offsetTop === hs[0]?.offsetTop, row2: hs[10]?.offsetTop > hs[0]?.offsetTop, even: hs[19]?.offsetLeft === hs[9]?.offsetLeft };
  });
  t.assert(rows.n === 20 && rows.row1 && rows.row2 && rows.even, `20 hearts show as two rows of ten (${JSON.stringify(rows)})`);
  await t.eval(() => document.querySelector('.qf-proj-hearts').scrollIntoView({ block: 'center' }));
  await t.shot('hearts-20');

  // ---- Ctrl+S with a half-typed value stores it and keeps the caret in the field
  const title = page.locator('.qf-proj input.qf-input >> nth=1');
  await title.click();
  await title.fill('Typed Then Saved');
  await page.keyboard.press('Control+s');
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => n.textContent === 'Saved'), null, 4000);
  const saved = await t.eval(async ({ id, mod }) => ({
    stored: (await (await import(mod)).loadProject(id))?.settings.title,
    focused: document.activeElement?.value,
  }), { id: pid, mod: '/src/core/storage.ts' });
  t.assert(saved.stored === 'Typed Then Saved' && saved.focused === 'Typed Then Saved', `Ctrl+S stores the half-typed title (${JSON.stringify(saved)})`);
  await t.eval(() => document.activeElement?.blur());

  // ---- "Pick on map" through the real map tab's picker
  await page.click('.qf-proj-start__actions button:has-text("Pick on map")');
  await t.until(() => {
    const banner = document.querySelector('.qf-map-pick');
    return window.__qf.editor.ctx.activeTab === 'map' && !!banner && !banner.hidden;
  }, null, 8000);
  // Fit the room first: the map keeps its own pan/zoom across tab switches.
  await page.locator('.qf-map-stage button[title^="Fit the room"]').click({ timeout: 2000 }).catch(() => {});
  await t.wait(100);
  await t.shot('pick-on-map');
  const stage = await page.locator('.qf-map-canvas').boundingBox();
  await page.mouse.click(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2 + 40);
  await t.until(() => window.__qf.editor.ctx.activeTab === 'project', null, 4000);
  const picked = await t.eval(() => ({ start: window.__qf.editor.ctx.project.start, undo: window.__qf.editor.ctx.undo.peekUndo() }));
  t.log('picked start', picked);
  t.assert(picked.undo === 'Set start location' && (picked.start.x !== 128 || picked.start.y !== 112),
    `a map click sets the start location (${JSON.stringify(picked)})`);

  // ---- help from the keyboard: focus moves in, Enter does not stack, Escape returns focus
  await t.eval(() => document.querySelector('.qf-shell__iconbtn[aria-label^="Help"]').focus());
  await page.keyboard.press('Enter');
  await t.until(() => !!document.querySelector('.qf-help'));
  await page.keyboard.press('Enter');
  const help = await t.eval(() => ({ backdrops: document.querySelectorAll('.qf-modal-backdrop').length, inside: !!document.activeElement?.closest('.qf-modal') }));
  t.assert(help.backdrops === 1 && help.inside, `help opened from the keyboard takes focus and does not stack (${JSON.stringify(help)})`);
  await page.keyboard.press('?');
  t.assert(await t.eval(() => document.querySelectorAll('.qf-modal-backdrop').length) === 1, '? does not open a second help');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-modal-backdrop'));
  t.assert(await t.eval(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Help')), 'focus returns to the help button');

  // ---- leaving by address while the save failed asks first; Cancel keeps the editor
  await t.eval(() => {
    const c = window.__qf.editor.ctx;
    c.project.settings.__bad = () => 1;
    c.changed('settings');
  });
  await t.until(() => (document.querySelector('.qf-shell__status-text')?.textContent ?? '') === 'Save failed', null, 6000);
  await t.eval(() => { location.hash = '#/'; });
  await t.until(() => !!document.querySelector('.qf-modal'), null, 4000);
  const asked = await t.eval(() => ({
    text: document.querySelector('.qf-modal')?.textContent ?? '', hash: location.hash, editor: !!window.__qf.editor,
    focus: document.activeElement?.textContent,
  }));
  t.log('leave by address after a failed save', asked);
  t.assert(/could not be saved/.test(asked.text) && asked.editor, 'the editor stays and asks before leaving');
  t.assert(asked.hash === `#/edit/${pid}`, `the address goes back to the editor while asking (${asked.hash})`);
  t.assert(asked.focus === 'Cancel', `a dangerous confirm focuses Cancel (${asked.focus})`);
  await t.shot('leave-confirm');
  await page.keyboard.press('Enter');
  await t.until(() => !document.querySelector('.qf-modal'));
  const stayed = await t.eval(() => ({ hash: location.hash, route: window.__qf.route?.view, editor: !!window.__qf.editor, status: document.querySelector('.qf-shell__status-text')?.textContent }));
  t.assert(stayed.editor && stayed.route === 'edit' && stayed.hash === `#/edit/${pid}`, `Cancel keeps the editor (${JSON.stringify(stayed)})`);

  // ... and "Leave without saving" goes straight to the menu (no second prompt, no retry)
  await t.eval(() => { location.hash = '#/'; });
  await t.until(() => !!document.querySelector('.qf-modal'), null, 4000);
  await t.eval(() => document.querySelectorAll('.qf-toast').forEach((n) => n.remove()));
  await page.click('.qf-modal__footer .qf-btn >> nth=-1');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, null, 4000);
  await t.wait(300);
  const gone = await t.eval(() => ({
    hash: location.hash, modal: !!document.querySelector('.qf-modal'), error: window.__qf.error,
    toasts: [...document.querySelectorAll('.qf-toast')].map((n) => n.textContent).filter((s) => /save/i.test(s)),
  }));
  t.log('after leaving without saving', gone);
  t.assert(gone.hash === '#/' && !gone.modal && !gone.error, `"Leave without saving" lands on the menu (${JSON.stringify(gone)})`);
  t.assert(gone.toasts.length === 0, `no save retry after choosing to leave (${gone.toasts.join(' | ')})`);
  const kept = await t.eval(async ({ id, mod }) => (await (await import(mod)).loadProject(id))?.settings.title, { id: pid, mod: '/src/core/storage.ts' });
  t.assert(kept === 'Typed Then Saved', `the last good save is kept (${kept})`);
}
