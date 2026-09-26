// Storage when reading window.indexedDB throws (Chrome does this in opaque-origin / sandboxed
// iframes): everything falls back to the in-memory store instead of failing for the session.
// The harness fails the scenario on any uncaught page error.
export default async function (t) {
  t.allowConsole(/IndexedDB unavailable/);
  await t.page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException("Failed to read the 'indexedDB' property from 'Window': access is denied for this document.", 'SecurityError');
      },
    });
  });
  await t.goto('#/');
  await t.wait(500);
  const r = await t.eval(async () => {
    const st = await import('/src/core/storage.ts');
    const pr = await import('/src/core/project.ts');
    const out = {};
    try { out.persistent = await st.storageIsPersistent(); } catch (e) { out.persistent = `threw: ${e.message}`; }
    try {
      const p = pr.createBlankProject('Sandboxed');
      await st.saveProject(p);
      out.list = (await st.listProjects()).map((m) => m.name);
      out.loaded = (await st.loadProject(p.id))?.name ?? null;
    } catch (e) {
      out.error = e.message;
    }
    out.toasts = [...document.querySelectorAll('.qf-toast')].map((n) => n.textContent);
    return out;
  });
  t.log('sandboxed storage', r);
  t.assert(r.persistent === false, `storageIsPersistent() resolves false (${r.persistent})`);
  t.assert(!r.error && r.list?.includes('Sandboxed') && r.loaded === 'Sandboxed', `save/list/load work in memory (${r.error ?? ''})`);
  t.assert(!r.toasts.some((x) => /couldn.t/i.test(x)), `no storage error toast (${r.toasts})`);
  // New project from the menu opens the editor.
  await t.eval(() => [...document.querySelectorAll('button')].find((b) => /new project/i.test(b.textContent))?.click());
  await t.wait(300);
  await t.eval(() => [...document.querySelectorAll('button')].find((b) => /create project/i.test(b.textContent))?.click());
  await t.until(() => /^#\/edit\//.test(location.hash) && window.__qf.editor, undefined, 8000);
  t.assert(!(await t.eval(() => window.__qf.error)), 'the new project opens in the editor');
  await t.shot('sandboxed-editor');
}
