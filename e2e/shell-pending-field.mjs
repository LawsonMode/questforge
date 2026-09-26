// Editor shell: text typed into a field (focused, no 'change' yet) is kept when
// the user leaves by browser Back, a typed address, a reload (with the leave
// prompt) or by hiding the tab; clicking the Menu button keeps working too.

const newProject = async (t) => {
  await t.goto('#/');
  await t.page.click('.qf-menu-new-btn');
  await t.page.locator('.qf-modal').getByRole('button', { name: 'Create project' }).click();
  await t.until(() => window.__qf.editor && window.__qf.ready, null, 8000);
  await t.wait(400);
  return t.eval(() => window.__qf.editor.ctx.project.id);
};

const stored = (t, id) => t.eval(async (id) => (await import('/src/core/storage.ts')).loadProject(id), id);

/** Wait (up to 4 s) until the stored project satisfies `pred`; returns the last stored copy. */
async function storedWhen(t, id, pred) {
  let p = null;
  for (let i = 0; i < 40; i++) {
    p = await stored(t, id);
    if (p && pred(p)) return p;
    await t.wait(100);
  }
  return p;
}

async function typeInto(t, locator, text) {
  await locator.click();
  await t.page.keyboard.press('End');
  await t.page.keyboard.type(text);
}

async function openEditor(t, id) {
  await t.goto(`#/edit/${id}`);
  await t.until(() => window.__qf.editor && window.__qf.ready, null, 8000);
  await t.wait(300);
}

export default async function (t) {
  const { page } = t;
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); void d.accept(); });
  const id = await newProject(t);
  const roomName = page.locator('.qf-map-right input[data-key="name"]');
  const title = page.locator('.qf-proj input').first();

  // 1. Project title typed, then browser Back.
  await page.click('#qf-tab-project');
  await t.wait(300);
  await typeInto(t, title, ' TYPED-BACK');
  const pendingBefore = await t.eval(() => window.__qf.editor.autosave.pending);
  await page.goBack();
  let p = await storedWhen(t, id, (q) => q.settings.title.endsWith('TYPED-BACK'));
  t.log('1. Back', { pendingBefore, title: p.settings.title, hash: await t.eval(() => location.hash) });
  t.assert(!pendingBefore, 'the typed title was not yet committed before leaving (the case under test)');
  t.assert(p.settings.title === 'My Adventure TYPED-BACK', `Back keeps the typed title (${p.settings.title})`);

  // 2. Room name typed, then a new address.
  await openEditor(t, id);
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(200);
  await typeInto(t, roomName, ' ADDRESS');
  await t.eval(() => { location.hash = '#/'; });
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  p = await storedWhen(t, id, (q) => q.worlds[0].rooms[0].name.endsWith('ADDRESS'));
  t.log('2. address change', { room: p.worlds[0].rooms[0].name });
  t.assert(p.worlds[0].rooms[0].name === 'Start ADDRESS', `a typed address keeps the room name (${p.worlds[0].rooms[0].name})`);

  // 3. Hidden tab: the half-typed title is stored and the caret stays in the field.
  await openEditor(t, id);
  await page.click('#qf-tab-project');
  await t.wait(300);
  await typeInto(t, title, ' HIDDEN');
  await t.eval(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  p = await storedWhen(t, id, (q) => q.settings.title.endsWith('HIDDEN'));
  const refocused = await t.eval(() => document.activeElement === document.querySelector('.qf-proj input'));
  await t.eval(() => { delete document.hidden; });
  t.log('3. hidden', { title: p.settings.title, refocused });
  t.assert(p.settings.title === 'My Adventure TYPED-BACK HIDDEN', `hiding the tab stores the typed title (${p.settings.title})`);
  t.assert(refocused, 'the title field keeps focus after the hidden-tab save');

  // 4. Dialogue text typed with everything saved, then reload: the leave prompt shows and the text is kept.
  await page.click('#qf-tab-dialogue');
  await t.wait(300);
  await page.locator('.qf-dlg-listbar').getByRole('button', { name: /New|Add/ }).first().click();
  await t.wait(300);
  await page.keyboard.press('Control+s');
  await t.until(() => !window.__qf.editor.autosave.pending, null, 4000);
  await typeInto(t, page.locator('.qf-dlg-page__text').first(), 'A line the designer just wrote');
  dialogs.length = 0;
  await page.reload();
  await page.waitForFunction(() => window.__qf && window.__qf.ready, null, { timeout: 15000 });
  p = await storedWhen(t, id, (q) => q.dialogues[0]?.pages[0]?.text === 'A line the designer just wrote');
  t.log('4. reload', { text: p.dialogues[0]?.pages[0]?.text, dialogs: [...dialogs] });
  t.assert(dialogs.includes('beforeunload'), `a reload with a half-typed field asks first (${dialogs.join(',') || 'no dialog'})`);
  t.assert(p.dialogues[0]?.pages[0]?.text === 'A line the designer just wrote', `the reload keeps the typed dialogue text (${p.dialogues[0]?.pages[0]?.text})`);

  // 5. Control: the Menu button (mouse) still keeps a typed room name.
  await t.until(() => window.__qf.editor && window.__qf.ready, null, 8000);
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(200);
  await typeInto(t, roomName, ' MENU');
  await page.click('button[title="Back to the main menu"]');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  p = await storedWhen(t, id, (q) => q.worlds[0].rooms[0].name.endsWith('MENU'));
  t.assert(p.worlds[0].rooms[0].name === 'Start ADDRESS MENU', `the Menu button keeps the typed room name (${p.worlds[0].rooms[0].name})`);

  // 6. Nothing typed: a reload asks nothing.
  await openEditor(t, id);
  dialogs.length = 0;
  await page.reload();
  await page.waitForFunction(() => window.__qf && window.__qf.ready, null, { timeout: 15000 });
  t.assert(dialogs.length === 0, `a clean editor reloads without a prompt (${dialogs.join(',')})`);
}
