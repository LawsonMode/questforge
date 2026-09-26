// Storage v2 in a real browser: a database written by v1 (projects + saves only) is upgraded
// in place with a filled `meta` store; listProjects reads only that light store (never the
// full projects); saves/deletes keep it in step; a stored project under the reserved id
// "test" (from an import before the fix) is moved to a free id so Play opens it.
export default async function (t) {
  await t.goto('#/');

  const result = await t.eval(async () => {
    const s = await import('/src/core/storage.ts');
    const pr = await import('/src/core/project.ts');
    await s.listProjects(); // our connection is open (v2)

    const req = (r) => new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve('blocked');
    });
    // Start over from a v1 database, as an older Questforge left it.
    const deleted = await req(indexedDB.deleteDatabase('questforge'));
    const old = pr.createBlankProject('From v1');
    old.modified = 1000;
    const shadowed = pr.createBlankProject('Imported as test');
    shadowed.id = 'test';
    shadowed.modified = 2000;
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('questforge', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('projects', { keyPath: 'id' });
        open.result.createObjectStore('saves');
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(JSON.parse(pr.serializeProject(old)));
        tx.objectStore('projects').put(JSON.parse(pr.serializeProject(shadowed)));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });

    // Count which stores getAll() reads while listing.
    const reads = [];
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...a) { reads.push(this.name); return getAll.apply(this, a); };
    let metas;
    try {
      metas = await s.listProjects();
    } finally {
      IDBObjectStore.prototype.getAll = getAll;
    }
    const version = await new Promise((resolve) => {
      const open = indexedDB.open('questforge');
      open.onsuccess = () => {
        const db = open.result;
        const out = { version: db.version, stores: [...db.objectStoreNames] };
        db.close();
        resolve(out);
      };
    });
    const fromV1 = metas.find((m) => m.name === 'From v1');
    const moved = metas.find((m) => m.name === 'Imported as test');
    const movedLoads = moved ? (await s.loadProject(moved.id))?.name : null;
    const testGone = (await s.loadProject('test')) === null;

    // Saves and deletes keep the meta store in step.
    const p = pr.createBlankProject('Fresh');
    await s.saveProject(p);
    p.name = 'Fresh renamed';
    await s.saveProject(p);
    const renamed = (await s.listProjects()).find((m) => m.id === p.id)?.name;
    await s.deleteProject(p.id);
    const afterDelete = (await s.listProjects()).some((m) => m.id === p.id);
    for (const m of await s.listProjects()) await s.deleteProject(m.id);
    return {
      deleted, reads, version, ids: metas.map((m) => m.id),
      fromV1: fromV1 ? { id: fromV1.id, rooms: fromV1.rooms, modified: fromV1.modified } : null,
      moved: moved ? moved.id : null, movedLoads, testGone, renamed, afterDelete,
    };
  });
  t.log('storage v2', result);
  t.assert(result.deleted === 'blocked' || result.deleted === undefined || result.deleted === null, `v1 database recreated (${result.deleted})`);
  t.assert(result.version.version === 2 && result.version.stores.includes('meta'), `database upgraded to v2 with a meta store (${JSON.stringify(result.version)})`);
  t.assert(result.fromV1 && result.fromV1.rooms === 1 && result.fromV1.modified === 1000, 'a project stored by v1 is listed after the upgrade');
  // (Twice here: once more after moving the stored "test" project.)
  t.assert(result.reads.length > 0 && result.reads.every((s) => s === 'meta'), `listProjects reads only the meta store (${result.reads})`);
  t.assert(result.moved && result.moved !== 'test' && result.movedLoads === 'Imported as test' && result.testGone,
    `a stored "test" project is moved to a free id (${result.moved})`);
  t.assert(!result.ids.includes('test'), 'no listed project keeps the reserved id "test"');
  t.assert(result.renamed === 'Fresh renamed' && result.afterDelete === false, 'saves and deletes keep the list in step');

  // The menu lists from the meta store too, and its cards still open.
  await t.page.reload();
  await t.goto('#/');
  await t.shot('menu-after-upgrade');
}
