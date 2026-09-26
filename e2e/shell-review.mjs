// Shell fixes from the review round: one project per double click on "Create
// project", a blank author stays blank, Ctrl+S during a playtest, file drops
// anywhere on the menu (and refused elsewhere), the drop highlight, focus after
// a keyboard delete, long names in toasts, a stored project without worlds,
// the Project tab's labels / "Last saved" / item icons, Alt+1-4 on the Art tab
// and a location pick abandoned by switching tabs.

const STORAGE = '/src/core/storage.ts';

export default async function (t) {
  const { page } = t;
  const count = () => t.eval(async (mod) => (await (await import(mod)).listProjects()).length, STORAGE);
  const tab = () => t.eval(() => window.__qf.editor?.ctx.activeTab ?? null);

  // ---- double click on "Create project" with a blank author
  await t.goto('#/');
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await page.fill('.qf-menu-new input[aria-label="Author"]', '');
  const before = await count();
  await page.dblclick('.qf-modal__footer .qf-btn--primary');
  await t.until(() => window.__qf.route?.view === 'edit' && !!window.__qf.editor, null, 8000);
  await t.wait(500);
  const created = (await count()) - before;
  const author = await t.eval(() => window.__qf.editor.ctx.project.author);
  t.log('double click', { created, author });
  t.assert(created === 1, `a double click creates one project (${created})`);
  t.assert(author === '', `a blank author stays blank (${JSON.stringify(author)})`);

  // ---- Project tab: every text control is named by its label
  await page.click('.qf-shell__tab[data-tab="project"]');
  await t.until(() => !!document.querySelector('.qf-proj-dates')?.textContent, null, 8000);
  const unnamed = await t.eval(() => [...document.querySelectorAll('.qf-proj input, .qf-proj select, .qf-proj textarea')]
    .filter((c) => !c.getAttribute('aria-label') && !(c.labels && c.labels.length)).map((c) => c.outerHTML.slice(0, 60)));
  t.assert(unnamed.length === 0, `all Project tab controls have a name (${unnamed.join(' | ')})`);
  await page.click('.qf-proj .qf-field__label >> text=Author');
  const focusedAuthor = await t.eval(() => document.activeElement?.labels?.[0]?.textContent ?? null);
  t.assert(focusedAuthor === 'Author', `clicking a label focuses its field (${focusedAuthor})`);
  await t.eval(() => document.activeElement?.blur());

  // ---- "Last saved" follows the autosave
  await t.eval(() => {
    const { ctx } = window.__qf.editor;
    ctx.project.modified = Date.now() - 3 * 86_400_000;
    ctx.project.settings.subtitle = 'edited now';
    ctx.changed('settings');
  });
  await t.until(() => document.querySelector('.qf-shell__status-text').textContent === 'Saved', null, 5000);
  await t.wait(100);
  const dates = await t.eval(() => document.querySelector('.qf-proj-dates').textContent);
  t.log('dates after the autosave', dates);
  t.assert(dates.includes('Last saved just now'), `"Last saved" is current after the autosave (${dates})`);

  // ---- start-item icons repaint after the item sprite changes
  const iconBefore = await t.eval(() => document.querySelector('label[for="qf-proj-item-bow"] canvas').toDataURL());
  await t.eval(() => {
    const { ctx } = window.__qf.editor;
    const item = ctx.project.sprites.find((s) => s.id === 'item');
    window.__qfFrames = item.frames;
    item.frames = item.frames.map((fr) => fr.replace(/[0-9a-f]/gi, '3'));
    ctx.assetsChanged('sprite', 'item');
  });
  await t.wait(100);
  const icons = await t.eval(async () => {
    const { spriteIcon } = await import('/src/app/spriteIcon.ts');
    const { ITEM_INFO } = await import('/src/content/ids.ts');
    const shown = document.querySelector('label[for="qf-proj-item-bow"] canvas').toDataURL();
    return { shown, fresh: spriteIcon(window.__qf.editor.ctx.assets, 'item', ITEM_INFO.bow.icon, 1).toDataURL() };
  });
  t.assert(icons.shown !== iconBefore && icons.shown === icons.fresh, 'the bow icon shows the edited sprite');
  await t.eval(() => {
    const { ctx } = window.__qf.editor;
    ctx.project.sprites.find((s) => s.id === 'item').frames = window.__qfFrames;
    ctx.assetsChanged('sprite', 'item');
  });
  await t.wait(100);
  const restored = await t.eval(() => document.querySelector('label[for="qf-proj-item-bow"] canvas').toDataURL());
  t.assert(restored === iconBefore, 'the bow icon repaints back after the sprite is restored');
  await t.shot('project-tab');

  // ---- Alt+1-4 switch tabs from the Art tab's pixel editor (plain digits pick colours there)
  await page.click('.qf-shell__tab[data-tab="art"]');
  await t.until(() => !!document.querySelector('#qf-tabpanel-art canvas'), null, 8000);
  await t.wait(300);
  await t.eval(() => document.activeElement?.blur());
  await page.keyboard.press('Digit1');
  const afterDigit = await tab();
  await page.keyboard.press('Alt+Digit1');
  const afterAlt = await tab();
  t.log('Art tab keys', { afterDigit, afterAlt });
  t.assert(afterAlt === 'map', `Alt+1 on the Art tab opens the map (${afterAlt})`);
  const tips = await t.eval(() => document.querySelector('.qf-shell__tab[data-tab="art"]').title);
  t.assert(tips.includes('Alt+2'), `the tab tooltip names Alt+2 (${tips})`);

  // ---- a pick abandoned by switching tabs resolves null and leaves the user where they went
  await page.click('.qf-shell__tab[data-tab="project"]');
  await t.until(() => !!document.querySelector('.qf-proj-start__actions'));
  const startBefore = await t.eval(() => JSON.stringify(window.__qf.editor.ctx.project.start));
  await page.click('.qf-proj-start__actions .qf-btn >> nth=0');
  await t.until(() => window.__qf.editor.ctx.activeTab === 'map', null, 5000);
  await t.wait(200);
  await page.click('.qf-shell__tab[data-tab="dialogue"]');
  await t.wait(200);
  const abandoned = await tab();
  await page.click('.qf-shell__tab[data-tab="map"]');
  await t.wait(300);
  const canvas = await page.locator('.qf-map-canvas').boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await t.wait(300);
  const late = await t.eval(() => ({ tab: window.__qf.editor.ctx.activeTab, start: JSON.stringify(window.__qf.editor.ctx.project.start) }));
  t.log('abandoned pick', { abandoned, lateTab: late.tab, startChanged: late.start !== startBefore });
  t.assert(abandoned === 'dialogue', `leaving a pick stays on the tab the user chose (${abandoned})`);
  t.assert(late.start === startBefore && late.tab === 'map', 'a later map click does not move the start');
  await t.eval(() => window.__qf.editor.ctx.undo.peekUndo() === 'Paint tiles' && window.__qf.editor.ctx.undoLast());

  // ---- during a playtest Ctrl+S never reaches the browser; stray file drops are refused
  await t.eval(() => document.activeElement?.blur());
  await page.keyboard.press('F5');
  await t.until(() => !!document.querySelector('.qf-playtest') && !!window.__qf.game, null, 8000);
  await t.eval(() => {
    window.__qfKeys = [];
    window.addEventListener('keydown', (e) => window.__qfKeys.push([e.key, e.defaultPrevented]));
  });
  await page.keyboard.press('Control+s');
  await page.keyboard.press('F5');
  const keys = await t.eval(() => window.__qfKeys);
  t.log('keys during playtest', keys);
  t.assert(keys.some(([k, p]) => k.toLowerCase() === 's' && p), 'Ctrl+S is prevented during a playtest');
  t.assert(keys.some(([k, p]) => k === 'F5' && p), 'F5 is prevented during a playtest');
  const refused = await t.eval(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{}'], 'x.questforge.json', { type: 'application/json' }));
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector('.qf-playtest').dispatchEvent(over);
    const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector('.qf-playtest').dispatchEvent(drop);
    return { over: over.defaultPrevented, effect: dt.dropEffect, drop: drop.defaultPrevented };
  });
  t.log('file drop over the playtest', refused);
  t.assert(refused.over && refused.drop && refused.effect === 'none', 'a file drop outside the menu is refused, not opened');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest'), null, 5000);

  // ---- back on the menu: a long-named project, drops anywhere, the highlight
  await t.eval(async (mod) => {
    const P = await import('/src/core/project.ts');
    const S = await import(mod);
    await S.saveProject(P.createBlankProject('W'.repeat(60), ''));
  }, STORAGE);
  await page.click('.qf-shell__bar button[title="Back to the main menu"]');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  await t.until(() => document.querySelectorAll('.qf-menu-card__delete').length >= 2, null, 5000);

  const highlight = await t.eval(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{}'], 'x.json', { type: 'application/json' }));
    const fire = (sel, type) => document.querySelector(sel).dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    const on = () => document.querySelector('.qf-menu-projects').classList.contains('qf-menu-projects--drop');
    fire('.qf-menu-hero', 'dragenter');
    fire('.qf-menu-hero', 'dragover');
    const overBanner = on();
    fire('.qf-menu-card', 'dragenter');
    fire('.qf-menu-hero', 'dragleave');
    const movedInside = on();
    fire('.qf-menu-card', 'dragleave');
    return { overBanner, movedInside, afterLeaving: on() };
  });
  t.log('drop highlight', highlight);
  t.assert(highlight.overBanner && highlight.movedInside && !highlight.afterLeaving, 'the drop highlight follows the drag and clears when it leaves');

  const json = await t.eval(async () => JSON.stringify((await import('/src/core/project.ts')).createBlankProject('Banner Drop', 'Dropper')));
  const dropped = await t.eval((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'banner.questforge.json', { type: 'application/json' }));
    const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector('.qf-menu-banner').dispatchEvent(drop);
    return drop.defaultPrevented;
  }, json);
  await t.until(() => [...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Banner Drop'), null, 5000);
  t.assert(dropped, 'a drop on the banner is taken by the app');

  // Duplicate the long-named project: the toast stays on screen.
  const longId = await t.eval(() => [...document.querySelectorAll('.qf-menu-card')].find((c) => c.querySelector('.qf-menu-card__name').textContent.startsWith('WWWW')).dataset.projectId);
  await page.click(`.qf-menu-card[data-project-id="${longId}"] .qf-menu-card__duplicate`);
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => n.textContent.startsWith('Duplicated')), null, 5000);
  const toastBox = await t.eval(() => {
    const n = [...document.querySelectorAll('.qf-toast')].find((x) => x.textContent.startsWith('Duplicated'));
    const r = n.getBoundingClientRect();
    return { text: n.textContent, right: Math.round(r.right), vw: window.innerWidth };
  });
  t.log('toast', toastBox);
  t.assert(toastBox.right <= toastBox.vw, `the toast fits on screen (${toastBox.right} <= ${toastBox.vw})`);
  await t.shot('menu-toast');

  // Keyboard delete: focus lands on the card that took the deleted one's place.
  await page.focus('.qf-menu-card__delete >> nth=0');
  const deletedId = await t.eval(() => document.activeElement.closest('.qf-menu-card').dataset.projectId);
  await page.keyboard.press('Enter');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await t.until((id) => !document.querySelector(`.qf-menu-card[data-project-id="${id}"]`), deletedId, 5000);
  await t.wait(200);
  const focusAfter = await t.eval(() => ({ tag: document.activeElement?.tagName, cls: document.activeElement?.className ?? '' }));
  t.log('focus after a keyboard delete', focusAfter);
  t.assert(focusAfter.tag === 'BUTTON' && focusAfter.cls.includes('qf-menu-card__delete'), `focus stays in the grid (${focusAfter.tag} ${focusAfter.cls})`);

  // ---- a stored project without worlds opens a friendly page, not a broken editor
  const empty = await t.eval(async (mod) => {
    const P = await import('/src/core/project.ts');
    const S = await import(mod);
    const p = P.createBlankProject('No Worlds');
    p.worlds = [];
    await S.saveProject(p);
    return p.id;
  }, STORAGE);
  for (const view of ['edit', 'play']) {
    await t.goto(`#/${view}/${empty}`);
    const page1 = await t.eval(() => ({
      title: document.querySelector('.qf-app-message h1')?.textContent ?? null,
      editor: !!window.__qf.editor, error: window.__qf.error, shell: !!document.querySelector('.qf-shell'),
      buttons: [...document.querySelectorAll('.qf-app-message button')].map((b) => b.textContent),
    }));
    t.log(`world-less ${view}`, page1);
    t.assert(page1.title === 'This project can’t be opened' && !page1.editor && !page1.shell && page1.error === null, `a world-less project shows the message page (${view})`);
  }
  await t.shot('worldless');
  await page.click('.qf-app-message button >> text=Delete it');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.click('.qf-modal__footer .qf-btn--danger');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, null, 5000);
  const gone = await t.eval(async ([mod, id]) => !(await (await import(mod)).loadProject(id)), [STORAGE, empty]);
  t.assert(gone, 'the world-less project can be deleted from its message page');

  // ---- banner close-up (no stars on the lettering)
  await page.setViewportSize({ width: 1920, height: 1080 });
  await t.wait(600);
  await page.screenshot({ path: await t.shot('banner-1920'), clip: { x: 360, y: 0, width: 1200, height: 200 } });
}
