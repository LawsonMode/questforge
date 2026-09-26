// Editor shell polish: broken percent-escapes in the address show the not-found
// page, whole-number fields show what they store, name and title share one
// length limit, undo/redo say what they did, a missing start room is flagged on
// the preview and its problems jump to the Start location panel, new and
// imported projects get unique names, and a memory-only save says so.

const STORAGE = '/src/core/storage.ts';

/** Store a blank project named `name`; returns its id. */
async function storeBlank(t, name) {
  return t.eval(async ({ name, mod }) => {
    const P = await import('/src/core/project.ts');
    const S = await import(mod);
    const p = P.createBlankProject(name);
    await S.saveProject(p);
    return p.id;
  }, { name, mod: STORAGE });
}

async function malformedAddresses(t) {
  for (const hash of ['#/edit/%E0%A4%A', '#/play/%', '#/playtest/%zz?w=a']) {
    await t.goto(hash);
    const r = await t.eval(() => ({
      view: window.__qf.route?.view, error: window.__qf.error, title: document.querySelector('.qf-app-message h1')?.textContent ?? null,
    }));
    t.log(hash, r);
    t.assert(r.view === 'notFound' && r.error === null && r.title === 'Page not found', `${hash} shows the not-found page (${JSON.stringify(r)})`);
  }
  await t.shot('malformed-address');
}

async function wholeNumbers(t) {
  const { page } = t;
  await page.fill('[aria-label="Starting hearts"]', '2.5');
  await page.press('[aria-label="Starting hearts"]', 'Tab');
  await page.check('#qf-proj-item-bombs');
  const bombs = '.qf-proj-items__row:has(#qf-proj-item-bombs) input[type="number"]';
  await page.fill(bombs, '7.6');
  await page.press(bombs, 'Tab');
  const r = await t.eval((sel) => ({
    heartsField: document.querySelector('[aria-label="Starting hearts"]').value,
    hearts: window.__qf.editor.ctx.project.settings.startHearts,
    bombsField: document.querySelector(sel).value,
    bombs: window.__qf.editor.ctx.project.settings.startItems.bombs,
  }), bombs);
  t.log('fractional entries', r);
  t.assert(r.heartsField === '3' && r.hearts === 3, `2.5 hearts is stored and shown as 3 (${JSON.stringify(r)})`);
  t.assert(r.bombsField === '8' && r.bombs === 8, `7.6 bombs is stored and shown as 8 (${JSON.stringify(r)})`);
}

async function nameLimits(t) {
  const { page } = t;
  const long = 'A Very Long Adventure Name That Keeps Going On And On Ok';
  await page.fill('.qf-shell__name', long);
  await page.press('.qf-shell__name', 'Enter');
  await t.wait(100);
  const r = await t.eval(() => {
    const title = [...document.querySelectorAll('.qf-proj label')].find((l) => l.textContent === 'Title').control;
    return { nameMax: document.querySelector('.qf-shell__name').maxLength, titleMax: title.maxLength, title: title.value };
  });
  t.log('name vs title limits', r);
  t.assert(r.title === long, 'the untouched title followed the rename');
  t.assert(r.nameMax === r.titleMax && r.title.length <= r.titleMax, `name and title share one limit (${JSON.stringify({ ...r, title: r.title.length })})`);
}

async function undoNotes(t) {
  const { page } = t;
  await t.eval(() => document.activeElement?.blur());
  const note = () => {
    const n = document.querySelector('.qf-shell__history-note');
    return { text: n?.textContent ?? '', shown: n?.classList.contains('qf-shell__history-note--show') ?? false, live: n?.getAttribute('aria-live') };
  };
  await page.keyboard.press('Control+z');
  await t.wait(200);
  const undone = await t.eval(note);
  await t.shot('undo-note');
  await page.click('.qf-shell__history button[aria-label^="Redo"]');
  await t.wait(200);
  const redone = await t.eval(note);
  t.log('history notes', undone, redone);
  t.assert(undone.shown && undone.text === 'Undid: Rename project' && undone.live === 'polite', `Ctrl+Z names the undone step (${JSON.stringify(undone)})`);
  t.assert(redone.shown && redone.text === 'Redid: Rename project', `the Redo button names the redone step (${JSON.stringify(redone)})`);
  await t.wait(2600);
  t.assert(!(await t.eval(note)).shown, 'the note goes away by itself');
  await page.click('.qf-shell__history button[aria-label^="Undo"]');
  await t.until(() => window.__qf.editor.ctx.project.name === 'My Adventure');
}

async function missingStart(t) {
  const { page } = t;
  const removed = await t.eval(() => {
    const { ctx } = window.__qf.editor;
    const p = ctx.project;
    const world = p.worlds.find((w) => w.id === p.start.world);
    const index = world.rooms.findIndex((r) => r.id === p.start.room);
    const [room] = world.rooms.splice(index, 1);
    world.rooms.push({ ...structuredClone(room), id: 'spare', gx: room.gx + room.gw + 1 });
    ctx.changed('rooms');
    return { world: world.id, index, room };
  });
  await t.until(() => {
    const n = document.querySelector('.qf-proj-start__notice');
    return n && !n.hidden && [...document.querySelectorAll('.qf-proj-problem__msg')].some((m) => /^The start location/.test(m.textContent));
  }, null, 3000);
  const notice = await t.eval(() => ({
    text: document.querySelector('.qf-proj-start__notice')?.textContent,
    dimmed: document.querySelector('.qf-proj-start__frame')?.classList.contains('qf-proj-start__frame--missing'),
  }));
  t.log('missing start preview', notice);
  t.assert(notice.dimmed && /Start room missing/.test(notice.text ?? ''), 'the preview is dimmed and says the start room is missing');
  const panel = page.locator('.qf-panel:has(.qf-proj-start)');
  await panel.screenshot({ path: await t.shot('start-missing') });

  await page.click('.qf-proj-problem:has-text("The start location") button:has-text("Go")');
  await t.wait(300);
  const went = await t.eval(() => ({
    tab: window.__qf.editor.ctx.activeTab,
    focused: document.activeElement?.textContent ?? '',
    flash: !!document.querySelector('.qf-panel.qf-proj-flash .qf-proj-start'),
  }));
  t.log('Go on a start problem', went);
  t.assert(went.tab === 'project' && went.focused === 'Pick on map' && went.flash, `Go reveals the Start location panel (${JSON.stringify(went)})`);
  await t.shot('start-go');

  await t.eval(({ world, index, room }) => {
    const { ctx } = window.__qf.editor;
    const w = ctx.project.worlds.find((x) => x.id === world);
    w.rooms = w.rooms.filter((r) => r.id !== 'spare');
    w.rooms.splice(index, 0, room);
    ctx.changed('rooms');
  }, removed);
  await t.until(() => document.querySelector('.qf-proj-start__notice')?.hidden === true, null, 3000);
}

async function uniqueNames(t) {
  const { page } = t;
  await t.goto('#/');
  await t.until(() => document.querySelectorAll('.qf-menu-card').length >= 2);
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal input[aria-label="Project name"]'));
  const offered = await t.eval(() => document.querySelector('.qf-modal input[aria-label="Project name"]').value);
  t.log('offered new name', offered);
  t.assert(offered === 'My Adventure 2', `a new project is not offered a taken name (${offered})`);
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-modal'));

  const json = await t.eval(async () => (await import('/src/core/project.ts')).serializeProject((await import('/src/core/project.ts')).createBlankProject('Twin Quest')));
  const input = '.qf-menu-projects input[type="file"]';
  const names = () => [...document.querySelectorAll('.qf-menu-card__name')].map((n) => n.textContent);
  for (let i = 0; i < 3; i++) {
    const before = (await t.eval(names)).length;
    await page.setInputFiles(input, { name: 'twin.questforge.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await t.until((n) => document.querySelectorAll('.qf-menu-card__name').length > n, before, 4000);
  }
  const twins = (await t.eval(names)).filter((n) => n.startsWith('Twin Quest')).sort();
  t.log('imported three times', twins);
  t.assert(JSON.stringify(twins) === JSON.stringify(['Twin Quest', 'Twin Quest (imported 2)', 'Twin Quest (imported)']), `each import gets its own name (${twins.join(', ')})`);
  await t.shot('menu-unique-names');
}

async function memoryOnlyStatus(t) {
  const { page } = t;
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  // The init script runs in new documents only (a hash change keeps the page).
  await page.reload();
  await t.goto('#/edit/sample');
  await t.until(() => !!document.querySelector('.qf-shell__banner'), null, 4000);
  await page.fill('.qf-shell__name', 'Private Copy');
  await page.press('.qf-shell__name', 'Enter');
  await t.until(() => document.querySelector('.qf-shell__status')?.dataset.state === 'volatile', null, 4000);
  const st = await t.eval(() => ({
    text: document.querySelector('.qf-shell__status-text')?.textContent,
    tip: document.querySelector('.qf-shell__status')?.title,
    toasts: [...document.querySelectorAll('.qf-toast')].map((x) => x.textContent),
  }));
  t.log('memory-only status', st);
  t.assert(st.text === 'Saved (this tab only)' && /until this tab closes/.test(st.tip ?? ''), `a memory-only save says so (${JSON.stringify(st)})`);
  t.assert(st.toasts.includes('Saved as a new project (this tab only)'), `the first-save toast says so too (${st.toasts.join(' | ')})`);
  await page.locator('.qf-shell__bar').screenshot({ path: await t.shot('status-memory-only') });
}

export default async function (t) {
  await malformedAddresses(t);
  const id = await storeBlank(t, 'My Adventure');
  await t.goto(`#/edit/${id}`);
  await t.until(() => !!window.__qf.editor);
  await t.page.click('#qf-tab-project');
  await t.until(() => !!document.querySelector('[aria-label="Starting hearts"]'), null, 8000);
  await wholeNumbers(t);
  await nameLimits(t);
  await undoNotes(t);
  await missingStart(t);
  await t.eval(() => window.__qf.editor.ctx.save());
  await uniqueNames(t);
  await memoryOnlyStatus(t);
}
