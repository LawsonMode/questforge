// Data layer in a real browser: IndexedDB persistence across reloads, save slots,
// localStorage settings, project download and file import.
export default async function (t) {
  await t.goto('#/');

  const first = await t.eval(async () => {
    const pr = await import('/src/core/project.ts');
    const s = await import('/src/core/storage.ts');
    const st = await import('/src/game/state.ts');
    const p = pr.createBlankProject('E2E Storage');
    await s.saveProject(p);
    const save = st.newSave(p, 1, 'Hero');
    st.applyItem(save, p.worlds[0].id, 'rupees', 42);
    await s.writeSave(save);
    s.setSetting('e2e.volume', 0.25);
    const dbs = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name) : ['questforge'];
    return { id: p.id, dbs };
  });
  t.assert(first.dbs.includes('questforge'), `IndexedDB "questforge" exists (${first.dbs})`);

  await t.page.reload();
  await t.goto('#/');

  const after = await t.eval(async (id) => {
    const s = await import('/src/core/storage.ts');
    const loaded = await s.loadProject(id);
    const metas = await s.listProjects();
    const saves = await s.listSaves(id);
    const volume = s.getSetting('e2e.volume', 1);
    return {
      name: loaded?.name ?? null,
      rooms: metas.find((m) => m.id === id)?.rooms ?? -1,
      slots: saves.map((x) => (x ? x.rupees : null)),
      volume,
    };
  }, first.id);
  t.log('after reload', after);
  t.assert(after.name === 'E2E Storage', 'project survives a reload (IndexedDB, not the memory fallback)');
  t.assert(after.rooms === 1, 'listProjects reports the room count');
  t.assert(JSON.stringify(after.slots) === '[null,42,null]', `save slot 1 persisted (${JSON.stringify(after.slots)})`);
  t.assert(after.volume === 0.25, 'setting persisted in localStorage');

  const [download] = await Promise.all([
    t.page.waitForEvent('download', { timeout: 5000 }),
    t.eval(async (id) => {
      const s = await import('/src/core/storage.ts');
      const p = await s.loadProject(id);
      p.name = 'My: "Quest"?';
      s.downloadProject(p);
    }, first.id),
  ]);
  const fileName = download.suggestedFilename();
  t.log('download', fileName);
  t.assert(fileName === 'My_ _Quest_.questforge.json', `download file name is sanitised (${fileName})`);

  const imported = await t.eval(async (id) => {
    const s = await import('/src/core/storage.ts');
    const pr = await import('/src/core/project.ts');
    const p = await s.loadProject(id);
    const file = new File([pr.serializeProject(p)], 'x.questforge.json', { type: 'application/json' });
    const got = await s.readProjectFile(file);
    let error = '';
    try {
      await s.readProjectFile(new File(['{"nope":true}'], 'bad.json'));
    } catch (err) {
      error = err.message;
    }
    await s.deleteProject(id);
    const gone = (await s.loadProject(id)) === null && (await s.listSaves(id)).every((x) => x === null);
    return { reId: got.id !== id, error, gone };
  }, first.id);
  t.assert(imported.reId, 'importing a project whose id exists gives it a new id');
  t.assert(/not a Questforge project/.test(imported.error), `bad import gives a readable error (${imported.error})`);
  t.assert(imported.gone, 'deleteProject removes the project and its saves');

  // Another tab deleting / upgrading the database fires versionchange on our open
  // connection: storage must close it and reopen on the next call instead of failing.
  const reopened = await t.eval(async () => {
    const s = await import('/src/core/storage.ts');
    const pr = await import('/src/core/project.ts');
    const persistentBefore = await s.storageIsPersistent();
    await s.listProjects();
    const deleted = await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('questforge');
      req.onsuccess = () => resolve('deleted');
      req.onerror = () => resolve(`error: ${req.error}`);
      req.onblocked = () => resolve('blocked');
    });
    let error = '';
    let count = -1;
    try {
      const p = pr.createBlankProject('After Reopen');
      await s.saveProject(p);
      count = (await s.listProjects()).length;
      await s.deleteProject(p.id);
    } catch (err) {
      error = String(err);
    }
    return { persistentBefore, deleted, error, count, persistentAfter: await s.storageIsPersistent() };
  });
  t.log('reopen', reopened);
  t.assert(reopened.persistentBefore && reopened.persistentAfter, 'storageIsPersistent() is true with IndexedDB');
  t.assert(reopened.deleted === 'deleted', `deleteDatabase was not blocked by our connection (${reopened.deleted})`);
  t.assert(reopened.error === '' && reopened.count === 1, `storage reopens after losing its connection (${reopened.error})`);
}
