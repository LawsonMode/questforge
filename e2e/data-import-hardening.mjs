// Untrusted .questforge.json files imported through the real menu file input are made safe by
// migration (src/core/validate.ts): no prototype pollution from a setTile layer, no string heal,
// no CSS url() palette colours (no network beacon from the Art tab), no crashing sprite sizes,
// built-in sprites restored for partial files, floors clamped, overlap reports capped, and the
// reserved id "test" re-assigned.
export default async function (t) {
  const beacons = [];
  t.page.on('request', (r) => { if (r.url().includes('qf-beacon')) beacons.push(r.url()); });

  /** A blank project as JSON, changed by `src` (a function body over `p`). */
  async function blank(src) {
    return t.eval(async (body) => {
      const pr = await import('/src/core/project.ts');
      const p = JSON.parse(pr.serializeProject(pr.createBlankProject('Hardening')));
      // eslint-disable-next-line no-new-func
      new Function('p', body)(p);
      return JSON.stringify(p);
    }, src);
  }

  /** Import through the menu's file input; resolves to the new project's id. */
  async function importJson(json, name) {
    await t.goto('#/');
    const before = await t.eval(async () => (await (await import('/src/core/storage.ts')).listProjects()).map((m) => m.id));
    await t.page.setInputFiles('.qf-menu input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(json) });
    for (let i = 0; i < 100; i++) {
      const id = await t.eval(async (b) => {
        const ms = await (await import('/src/core/storage.ts')).listProjects();
        return ms.find((m) => !b.includes(m.id))?.id ?? null;
      }, before);
      if (id) return id;
      await t.wait(100);
    }
    throw new Error(`import of ${name} did not produce a project`);
  }

  const pollution = () => t.eval(() => ({
    obj: ({})[0], arr: [][0], hole: new Array(3)[0], own: Object.prototype.hasOwnProperty.call(Object.prototype, '0'),
  }));

  await t.goto('#/');

  // ---------------------------------------------------------------- 1. setTile "__proto__" + heal "lots"
  {
    const json = await blank(`
      p.worlds[0].rooms[0].triggers.push({ id: 't_bad', name: 'bad', on: 'auto', once: false, conditions: [],
        actions: [
          { kind: 'setTile', layer: '__proto__', tx: 0, ty: 0, tile: 'POLLUTED' },
          { kind: 'heal', amount: 'lots' },
          { kind: 'setTile', layer: 'fg', tx: 2, ty: 2, tile: ${16} },
        ] });
    `);
    const id = await importJson(json, 'hostile-trigger.questforge.json');
    const stored = await t.eval(async (pid) => (await (await import('/src/core/storage.ts')).loadProject(pid)).worlds[0].rooms[0].triggers
      .find((x) => x.id === 't_bad').actions, id);
    t.log('stored actions', stored);
    t.assert(stored.length === 2 && stored[0].kind === 'heal' && stored[0].amount === 2 && stored[1].layer === 'fg',
      `migration drops the "__proto__" setTile and types the heal amount (${JSON.stringify(stored)})`);
    await t.goto(`#/playtest/${encodeURIComponent(id)}`);
    await t.wait(800);
    const after = await pollution();
    const game = await t.eval(() => ({ hp: window.__qf.game?.services?.save?.hp, err: window.__qf.error, state: window.__qf.game?.state ?? null }));
    t.log('after playtest', after, game);
    t.assert(after.obj === undefined && after.arr === undefined && after.hole === undefined && !after.own,
      `no Object.prototype pollution after playing (${JSON.stringify(after)})`);
    t.assert(!game.err, `game keeps running (${game.err})`);
    t.assert(typeof game.hp === 'number' && Number.isFinite(game.hp), `save.hp stays a finite number (${JSON.stringify(game.hp)})`);
    await t.shotCanvas('hostile-trigger-playtest');
    // The menu still routes after leaving the game in-app (a polluted [][0] used to break the router).
    await t.eval(() => { window.__qf.ready = false; location.hash = '#/'; });
    await t.page.waitForFunction(() => window.__qf.ready || window.__qf.error, null, { timeout: 15000 });
    const menuOk = await t.eval(() => !!document.querySelector('.qf-menu') && !window.__qf.error);
    t.assert(menuOk, 'menu renders after the playtest (router intact)');
  }

  // ---------------------------------------------------------------- 2. palette url() beacon
  {
    const json = await blank(`
      const tile = p.tiles.find((x) => x.id === p.worlds[0].rooms[0].layers.bg[0]) || p.tiles[0];
      const pal = p.palettes.find((x) => x.id === tile.palette);
      for (let i = 1; i < 16; i++) pal.colors[i] = 'url(/qf-beacon.png?c=' + i + ')';
    `);
    const id = await importJson(json, 'beacon.questforge.json');
    await t.goto(`#/edit/${encodeURIComponent(id)}`);
    await t.eval(() => window.__qf.editor.ctx.switchTab('art'));
    await t.wait(1500);
    const bg = await t.eval(() => [...document.querySelectorAll('[style*="background"]')]
      .map((n) => getComputedStyle(n).backgroundImage).filter((v) => v && v !== 'none' && v.includes('url(')));
    t.log('beacon requests', beacons.length, 'url() backgrounds', bg.slice(0, 3));
    t.assert(beacons.length === 0, `opening the Art tab makes no request from palette colours (${beacons.length})`);
    t.assert(!bg.some((v) => v.includes('qf-beacon')), 'no palette colour reaches CSS as url()');
    await t.shot('beacon-art-tab');
  }

  // ---------------------------------------------------------------- 3. malformed sprite sizes + partial sprite list
  {
    const json = await blank(`
      const hero = p.sprites.find((s) => s.id === 'hero');
      hero.w = 0.5; hero.h = 1e7;
    `);
    const id = await importJson(json, 'sprite-size.questforge.json');
    await t.goto(`#/playtest/${encodeURIComponent(id)}`);
    await t.wait(600);
    const err = await t.eval(() => window.__qf.error);
    t.assert(!err, `a bad sprite size does not stop the game (${err})`);
    const json2 = await blank(`p.sprites = [];`);
    const id2 = await importJson(json2, 'no-sprites.questforge.json');
    const restored = await t.eval(async (pid) => {
      const p = await (await import('/src/core/storage.ts')).loadProject(pid);
      return ['hero', 'hud', 'item'].filter((s) => p.sprites.some((x) => x.id === s));
    }, id2);
    t.assert(restored.length === 3, `a file with "sprites": [] gets the built-in sprites back (${restored})`);
    await t.goto(`#/playtest/${encodeURIComponent(id2)}`);
    await t.wait(600);
    t.assert(!(await t.eval(() => window.__qf.error)), 'the restored project plays');
    await t.shotCanvas('no-sprites-restored');
  }

  // ---------------------------------------------------------------- 4. huge floor + 1200 overlapping rooms
  {
    const json = await blank(`
      p.worlds[0].rooms.push({ id: 'far', name: 'Far', gx: 9, gy: 9, floor: 1000000 });
      for (let i = 0; i < 1200; i++) p.worlds[0].rooms.push({});
    `);
    const id = await importJson(json, 'scale.questforge.json');
    const t0 = Date.now();
    await t.goto(`#/edit/${encodeURIComponent(id)}`, { timeout: 30000 });
    const openMs = Date.now() - t0;
    const floors = await t.eval(() => Math.max(0, ...[...document.querySelectorAll('select')].map((s) => s.options.length)));
    t.log('editor open ms', openMs, 'largest <select>', floors);
    t.assert(floors < 300, `the floor list stays small (${floors} options)`);
    const t1 = Date.now();
    await t.eval(() => window.__qf.editor.ctx.switchTab('project'));
    await t.until(() => document.querySelectorAll('.qf-proj-problem').length > 0, undefined, 20000);
    const projMs = Date.now() - t1;
    const rows = await t.eval(() => document.querySelectorAll('.qf-proj-problem').length);
    const problems = await t.eval(async () => {
      const v = await import('/src/core/validate.ts');
      return v.validateProject(window.__qf.editor.ctx.project).filter((x) => /overlap/.test(x.message)).length;
    });
    t.log('project tab ms', projMs, 'problem rows', rows, 'overlap problems', problems);
    t.assert(problems <= 51, `overlap problems are capped (${problems})`);
    t.assert(rows < 500, `the Project tab renders a bounded list (${rows} rows)`);
    await t.shot('scale-project-tab');
  }

  // ---------------------------------------------------------------- 5. reserved id "test"
  {
    const json = await blank(`p.id = 'test'; p.name = 'My imported quest'; p.settings.title = 'My imported quest';`);
    const id = await importJson(json, 'test-id.questforge.json');
    t.assert(id !== 'test', `a file with id "test" is stored under a fresh id (${id})`);
    await t.goto(`#/play/${encodeURIComponent(id)}`);
    await t.wait(300);
    const title = await t.eval(() => document.title);
    t.assert(/My imported quest/.test(title), `Play opens the imported project, not the engine test (${title})`);
  }
}
