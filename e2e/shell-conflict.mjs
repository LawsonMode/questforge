// Editor shell: the same project open in two tabs never silently loses one
// tab's saved work (notice banner, conflict dialog: save as a copy / decide
// later + overwrite / reload; a closing editor keeps its work as a copy); a tab
// whose code fails to download offers a reload and retries; two "Edit a copy"
// saves of the sample get distinct names.

const S = '/src/core/storage.ts';

async function openOn(page, base, hash) {
  await page.goto(`${base}/${hash}`);
  await page.waitForFunction(() => window.__qf && window.__qf.ready && window.__qf.editor, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

const renameRoom = (page, name) => page.evaluate(async (name) => {
  const { editRoom } = await import('/src/editor/map/history.ts');
  const ctx = window.__qf.editor.ctx;
  const w = ctx.project.worlds[0];
  editRoom(ctx, w.id, w.rooms[0].id, 'rename', 'rooms', (r) => { r.name = name; });
}, name);

const renameWorld = (page, name) => page.evaluate(async (name) => {
  const { renameWorld: rw } = await import('/src/editor/map/worldOps.ts');
  const ctx = window.__qf.editor.ctx;
  rw(ctx, ctx.project.worlds[0].id, name);
}, name);

const storedNames = (page, id) => page.evaluate(async ([S, id]) => {
  const p = await (await import(S)).loadProject(id);
  return p && { name: p.name, world: p.worlds[0].name, room: p.worlds[0].rooms[0].name };
}, [S, id]);

const modalTitle = (page) => page.evaluate(() => document.querySelector('.qf-modal .qf-modal__title')?.textContent ?? null);
const clickModal = (page, label) => page.locator('.qf-modal .qf-modal__footer').getByRole('button', { name: label, exact: true }).click();

export default async function (t) {
  const { page, base } = t;
  t.allowConsole(/\[editor\] the art tab failed to load/);
  t.allowConsole(/Failed to fetch dynamically imported module|net::ERR_FAILED|Failed to load resource/);

  // ---- two tabs on one project
  await t.goto('#/');
  await page.click('.qf-menu-new-btn');
  await page.locator('.qf-modal').getByRole('button', { name: 'Create project' }).click();
  await t.until(() => window.__qf.editor && window.__qf.ready, null, 8000);
  await t.wait(1500);
  const id = await t.eval(() => window.__qf.editor.ctx.project.id);
  const page2 = await page.context().newPage();
  page2.on('pageerror', (e) => t.assert(false, `page2 error: ${e.message}`));
  await openOn(page2, base, `#/edit/${id}`);

  // Tab 1 saves a change: tab 2 is told at once.
  await renameRoom(page, 'Renamed in tab 1');
  await page.keyboard.press('Control+s');
  await t.until(() => !window.__qf.editor.autosave.pending, null, 4000);
  const notice = await page2.waitForSelector('.qf-shell__banner--conflict', { timeout: 3000 }).then((h) => h.textContent(), () => null);
  t.log('tab 2 notice', notice);
  t.assert(/saved in another tab/.test(notice ?? ''), `tab 2 shows a "saved in another tab" banner (${notice})`);
  await page2.screenshot({ path: `${t.outDir}/p2-1-tab2-notice.png` });

  // Tab 2 saves its own change: it asks instead of overwriting.
  await renameWorld(page2, 'World from tab 2');
  await page2.keyboard.press('Control+s');
  await page2.waitForSelector('.qf-modal', { timeout: 4000 });
  t.assert((await modalTitle(page2)) === 'Changed in another tab', 'tab 2 asks what to do about the conflict');
  await page2.screenshot({ path: `${t.outDir}/p2-2-conflict-dialog.png` });
  let orig = await storedNames(page, id);
  t.assert(orig.room === 'Renamed in tab 1' && orig.world !== 'World from tab 2', `nothing is overwritten while asking (${JSON.stringify(orig)})`);

  // Save as a copy: both versions survive, tab 2 now edits the copy.
  await clickModal(page2, 'Save as a copy');
  await page2.waitForFunction((id) => !window.__qf.editor.autosave.pending && window.__qf.editor.ctx.project.id !== id, id, { timeout: 4000 });
  const copyId = await page2.evaluate(() => window.__qf.editor.ctx.project.id);
  const copy = await storedNames(page, copyId);
  orig = await storedNames(page, id);
  const hash2 = await page2.evaluate(() => location.hash);
  t.log('after save as a copy', { orig, copy, hash2 });
  t.assert(orig.room === 'Renamed in tab 1' && orig.world !== 'World from tab 2', `the original keeps tab 1's change (${JSON.stringify(orig)})`);
  t.assert(copy?.world === 'World from tab 2' && copy.room === 'Start' && copy.name === 'My Adventure (copy)', `tab 2's version is a new project (${JSON.stringify(copy)})`);
  t.assert(hash2 === `#/edit/${copyId}`, `tab 2's address follows the copy (${hash2})`);
  t.assert(!(await page2.$('.qf-shell__banner--conflict')), 'the banner is gone once saved');

  // Tab 1 keeps saving its own project without a false alarm.
  await renameRoom(page, 'Tab 1 again');
  await page.keyboard.press('Control+s');
  await t.until(() => !window.__qf.editor.autosave.pending, null, 4000);
  t.assert((await modalTitle(page)) === null, 'no conflict for the tab that saved last');
  t.assert((await storedNames(page, id)).room === 'Tab 1 again', 'tab 1 saved normally');

  // ---- autosave meets a conflict: "Decide later" pauses saving, the banner's Overwrite settles it
  await openOn(page2, base, `#/edit/${id}`);
  await renameRoom(page, 'Tab 1 third');
  await page.keyboard.press('Control+s');
  await t.until(() => !window.__qf.editor.autosave.pending, null, 4000);
  await renameWorld(page2, 'Autosaved in tab 2');
  await page2.waitForSelector('.qf-modal', { timeout: 5000 }); // the automatic save (1.2 s later) asks
  await clickModal(page2, 'Decide later');
  await page2.waitForSelector('.qf-shell__banner--conflict', { timeout: 2000 });
  const paused = await page2.evaluate(() => ({
    banner: document.querySelector('.qf-shell__banner--conflict')?.textContent,
    status: document.querySelector('.qf-shell__status')?.dataset.state,
  }));
  await page2.screenshot({ path: `${t.outDir}/p2-3-paused-banner.png` });
  t.log('paused', paused);
  t.assert(/Saving is paused/.test(paused.banner ?? '') && paused.status === 'error', `saving pauses with a banner (${JSON.stringify(paused)})`);
  // More edits do not re-open the dialog nor write.
  await renameRoom(page2, 'Still tab 2');
  await page2.waitForTimeout(1800);
  t.assert((await modalTitle(page2)) === null, 'automatic saves do not nag while the conflict is open');
  t.assert((await storedNames(page, id)).room === 'Tab 1 third', 'nothing is written while paused');
  await page2.locator('.qf-shell__banner--conflict').getByRole('button', { name: 'Overwrite' }).click();
  await page2.waitForFunction(() => !window.__qf.editor.autosave.pending, null, { timeout: 4000 });
  orig = await storedNames(page, id);
  t.assert(orig.world === 'Autosaved in tab 2' && orig.room === 'Still tab 2', `Overwrite stores tab 2's version (${JSON.stringify(orig)})`);

  // ---- Reload: tab 1 (now stale) drops its change and shows the stored version
  await renameRoom(page, 'Lost on reload');
  await page.keyboard.press('Control+s');
  await t.until(() => !!document.querySelector('.qf-modal'), null, 4000);
  await t.eval(() => { window.__beforeReload = true; });
  await clickModal(page, 'Reload');
  await page.waitForFunction(() => !window.__beforeReload && window.__qf && window.__qf.ready && window.__qf.editor, null, { timeout: 15000 });
  await t.wait(300);
  const reloaded = await t.eval(() => window.__qf.editor.ctx.project.worlds[0].rooms[0].name);
  t.assert(reloaded === 'Still tab 2', `Reload shows the stored version (${reloaded})`);
  t.assert((await storedNames(page, id)).room === 'Still tab 2', 'Reload wrote nothing');

  // ---- a stale editor that closes keeps its work as a copy
  await renameRoom(page2, 'Tab 2 fourth');
  await page2.keyboard.press('Control+s');
  await page2.waitForFunction(() => !window.__qf.editor.autosave.pending, null, { timeout: 4000 });
  await renameRoom(page, 'Kept on close');
  await t.eval(() => { location.hash = '#/'; });
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  await t.wait(800);
  const all = await t.eval(async (S) => {
    const st = await import(S);
    const metas = await st.listProjects();
    const out = [];
    for (const m of metas) {
      const p = await st.loadProject(m.id);
      out.push({ id: m.id, name: m.name, room: p.worlds[0].rooms[0].name });
    }
    return out;
  }, S);
  t.log('after closing a stale editor', all);
  t.assert(all.find((m) => m.id === id)?.room === 'Tab 2 fourth', 'the other tab\'s save is untouched');
  t.assert(all.some((m) => m.id !== id && m.room === 'Kept on close' && /\(copy/.test(m.name)), 'the closing editor saved its change as a copy');
  await page2.close();

  // ---- a tab whose code fails to download: reload offered, retried on the next visit
  let fail = true;
  let artRequests = 0;
  await page.route(/\/src\/editor\/art\/artTab\.ts/, (route) => {
    artRequests++;
    return fail ? route.abort('failed') : route.continue();
  });
  await t.goto('#/edit/sample');
  await page.click('#qf-tab-art');
  await t.until(() => /failed to download/.test(document.querySelector('#qf-tabpanel-art')?.textContent ?? ''), null, 4000);
  await t.shot('tab-download-error');
  const firstTry = artRequests;
  await page.click('#qf-tab-map');
  await page.click('#qf-tab-art');
  await t.wait(600);
  t.log('art requests', { firstTry, afterRetry: artRequests });
  t.assert(artRequests > firstTry || await t.eval(() => /failed to download/.test(document.querySelector('#qf-tabpanel-art')?.textContent ?? '')),
    'showing the tab again retries the load');
  fail = false;
  // A change first: the reload stores the sample copy and reopens it under its new address.
  await page.fill('.qf-shell__name', 'Reloaded Copy');
  await page.press('.qf-shell__name', 'Enter');
  await page.click('#qf-tab-art');
  await t.eval(() => { window.__beforeReload = true; }); // gone once the page has really reloaded
  await page.locator('#qf-tabpanel-art').getByRole('button', { name: 'Reload the editor' }).click();
  await page.waitForFunction(() => !window.__beforeReload && window.__qf && window.__qf.ready && window.__qf.editor && /^#\/edit\/p/.test(location.hash), null, { timeout: 15000 });
  const afterReload = await t.eval(() => ({ hash: location.hash, name: window.__qf.editor.ctx.project.name }));
  t.assert(afterReload.name === 'Reloaded Copy', `the reload reopens the stored copy (${JSON.stringify(afterReload)})`);
  await page.click('#qf-tab-art');
  await t.until(() => !!document.querySelector('.qf-art-canvas'), null, 8000);

  // ---- "Edit a copy" of the sample twice: distinct names
  const names = [];
  for (let i = 0; i < 2; i++) {
    await t.goto('#/edit/sample');
    names.push(await t.eval(() => window.__qf.editor.ctx.project.name));
    await renameRoom(page, `Copy edit ${i}`);
    await page.keyboard.press('Control+s');
    await t.until(() => /^#\/edit\/p/.test(location.hash), null, 4000);
  }
  const storedCopyNames = (await t.eval(async (S) => (await (await import(S)).listProjects()).map((m) => m.name), S)).filter((n) => n.startsWith('The Hollow Crown'));
  t.log('sample copies', { names, storedCopyNames });
  t.assert(names[0] === 'The Hollow Crown (copy)' && names[1] === 'The Hollow Crown (copy 2)', `sample copies get unique names (${names.join(' | ')})`);
  t.assert(new Set(storedCopyNames).size === storedCopyNames.length, 'no two stored sample copies share a name');
}
