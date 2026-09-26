// Wave B builder journey, driven with real mouse and keyboard input from the
// main menu: create a blank project, rename it, add rooms and a dungeon world,
// paint terrain and tiles with several tools, stamp walls, place a chest, a
// locked door pair with its key, an enemy, an NPC with a new dialogue, a sign,
// a warp between worlds (picked on the map) and a trigger (enemies cleared ->
// show the chest + secret), draw on a tile and recolour a palette in the Art
// tab, undo / redo, playtest (walk, warp, talk), reload, export and re-import.

/**
 * Keep other people's source edits from reloading the page mid-scenario: the
 * Vite HMR socket of this browser context never connects.
 */
const holdHmr = (t) => t.page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      if (args[1] !== 'vite-hmr') return new target(...args);
      return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} });
    },
  });
});

/** Editor selection + current room content. */
const snap = (t) => t.eval(() => {
  const ctx = window.__qf.editor?.ctx;
  const room = ctx?.room();
  return {
    tab: ctx?.activeTab ?? null,
    world: ctx?.worldId ?? null,
    room: ctx?.roomId ?? null,
    entityId: ctx?.entityId ?? null,
    undo: ctx?.undo.peekUndo() ?? null,
    entities: room?.entities.map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, props: e.props })) ?? [],
  };
});

const project = (t) => t.eval(() => JSON.parse(JSON.stringify(window.__qf.editor.ctx.project)));

/** Map room tile (tx, ty) centres (or room pixels) to client coordinates via the status bar's pixel readout. */
async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const read = async (x, y) => {
    await t.page.mouse.move(x, y);
    await t.wait(40);
    return t.eval(() => {
      const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
      const m = /(-?\d+), (-?\d+) px/.exec(text);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });
  };
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await read(x0, y0);
  const b = await read(x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  const px = (x, y) => ({ x: x0 + (x - a.x - 0.5) * s, y: y0 + (y - a.y - 0.5) * s });
  return { px, cell: (tx, ty) => px(tx * 16 + 8, ty * 16 + 8) };
}

/** Client point of a world-overview grid cell centre (layout mirrors WorldOverview). */
const overviewCell = (t, gx, gy) => t.eval(async ([gx, gy]) => {
  const { overviewBounds } = await import('/src/editor/map/worldOverview.ts');
  const ctx = window.__qf.editor.ctx;
  const floor = ctx.room()?.floor ?? 0;
  const b = overviewBounds(ctx.world().rooms.filter((r) => r.floor === floor));
  const c = document.querySelector('.qf-map-overview__canvas').getBoundingClientRect();
  const cw = c.width / b.cols;
  const ch = c.height / b.rows;
  return { x: c.left + (gx - b.x0 + 0.5) * cw, y: c.top + (gy - b.y0 + 0.5) * ch };
}, [gx, gy]);

const layerAt = (t, layer, cells) => t.eval(([layer, cells]) => {
  const room = window.__qf.editor.ctx.room();
  const cols = room.gw * 16;
  return cells.map(([x, y]) => room.layers[layer][y * cols + x]);
}, [layer, cells]);

export default async function (t) {
  const { page } = t;
  await holdHmr(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // ---------------------------------------------------------------- menu -> new blank project
  await t.goto('#/');
  await t.shot('menu');
  await page.click('.qf-menu-new-btn');
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  await page.fill('.qf-modal input[aria-label="Project name"]', 'Journey Test');
  await page.fill('.qf-modal input[aria-label="Author"]', 'Tester');
  await t.shot('new-project-dialog');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.until(() => window.__qf.route?.view === 'edit' && window.__qf.ready && !!window.__qf.editor, undefined, 10000);
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  let p = await project(t);
  t.assert(p.name === 'Journey Test' && p.author === 'Tester' && p.worlds.length === 1 && p.worlds[0].rooms.length === 1,
    `blank project created (${p.name}, ${p.worlds.length} world, ${p.worlds[0]?.rooms.length} room)`);
  await t.shot('editor-blank');

  // ---------------------------------------------------------------- rename in the top bar
  await page.click('.qf-shell__name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Emberfall Quest');
  await page.keyboard.press('Enter');
  await t.wait(100);
  p = await project(t);
  t.assert(p.name === 'Emberfall Quest', `project renamed (${p.name})`);
  t.assert(p.settings.title === 'Emberfall Quest', `the untouched game title follows the rename (${p.settings.title})`);
  t.assert((await t.eval(() => document.title)).startsWith('Emberfall Quest'), 'window title follows the rename');
  t.assert((await snap(t)).undo === 'Rename project', 'rename is an undo step');

  // ---------------------------------------------------------------- second overworld room
  const ow = p.worlds[0].id;
  const startRoom = p.worlds[0].rooms[0].id;
  await page.click('.qf-map-left__actions .qf-btn:has-text("Room")');
  await t.until(() => !!document.querySelector('.qf-modal .qf-map-size__grid'));
  await page.fill('.qf-modal .qf-field:has-text("Name") input', 'Meadow East');
  await t.shot('new-room-dialog');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(150);
  p = await project(t);
  const east = p.worlds[0].rooms.find((r) => r.name === 'Meadow East');
  t.assert(east && east.gx === 1 && east.gy === 0 && east.layers.bg.every((id) => id === T.GRASS), `second overworld room east of the start (${JSON.stringify(east && { gx: east.gx, gy: east.gy })})`);
  t.assert((await snap(t)).room === east?.id, 'the new room is selected');

  // ---------------------------------------------------------------- dungeon world with two rooms
  await page.click('.qf-map-left__head .qf-map-iconbtn[title^="New world"]');
  await t.until(() => !!document.querySelector('.qf-modal'));
  await page.fill('.qf-modal .qf-field:has-text("Name") input', 'Ember Crypt');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(150);
  p = await project(t);
  const crypt = p.worlds.find((w) => w.name === 'Ember Crypt');
  t.assert(crypt?.kind === 'dungeon' && crypt.rooms.length === 1, `dungeon world created with an entrance (${crypt?.kind}, ${crypt?.rooms.length})`);
  const entrance = crypt?.rooms[0];
  await page.click('.qf-map-left__actions .qf-btn:has-text("Room")');
  await t.until(() => !!document.querySelector('.qf-modal .qf-map-size__grid'));
  await page.fill('.qf-modal .qf-field:has-text("Name") input', 'Treasury');
  // No border from the dialog: the Room tab stamps it below.
  await page.click('.qf-modal .qf-check:has-text("Wall border") input');
  await page.click('.qf-modal__footer .qf-btn--primary');
  await t.wait(150);
  p = await project(t);
  const treasury = p.worlds.find((w) => w.id === crypt.id).rooms.find((r) => r.name === 'Treasury');
  t.assert(treasury && treasury.gx === 1 && treasury.layers.bg[0] === T.DFLOOR, `second dungeon room without walls (${treasury?.gx}, bg0 ${treasury?.layers.bg[0]})`);

  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(100);
  await t.shot('room-tab-treasury');
  await page.click('.qf-map-props button:has-text("Stamp walls")');
  await t.wait(100);
  const walled = await layerAt(t, 'bg', [[0, 0], [5, 0], [15, 13], [0, 7], [5, 5]]);
  t.assert(walled[0] === T.DWALL_TL && walled[1] === T.DWALL_TOP && walled[2] === T.DWALL_BR && walled[3] === T.DWALL_LEFT && walled[4] === T.DFLOOR,
    `Stamp walls drew a dungeon border (${walled})`);
  t.assert((await snap(t)).undo === 'Stamp walls', 'stamping walls is one undo step');
  await t.shot('walls-stamped');

  t.log('ids', { ow, startRoom, east: east?.id, crypt: crypt?.id, entrance: entrance?.id, treasury: treasury?.id });
  const ids = { ow, startRoom, east: east.id, crypt: crypt.id, entrance: entrance.id, treasury: treasury.id };

  await paintOverworld(t, ids, T);
  const ents = await placeEntities(t, ids, T);
  await artEdits(t, ids, T);
  await playtest(t, ids, ents);
  await persistAndShare(t, ids);
  t.assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
}

/** Draw on the grass tile and recolour its palette in the Art tab; undo / redo; the map thumbnails follow. */
async function artEdits(t, ids, T) {
  const { page } = t;
  await openWorld(t, ids.ow);
  const overview = () => t.eval(() => document.querySelector('.qf-map-overview__canvas').toDataURL());
  const grass = () => t.eval((id) => JSON.stringify(window.__qf.editor.ctx.project.tiles.find((x) => x.id === id).frames), T.GRASS);
  const pal = () => t.eval((id) => {
    const p = window.__qf.editor.ctx.project;
    const tile = p.tiles.find((x) => x.id === id);
    return p.palettes.find((x) => x.id === tile.palette).colors.join(',');
  }, T.GRASS);
  const o0 = await overview();
  const g0 = await grass();
  const c0 = await pal();

  await page.click('#qf-tab-art');
  await t.until(() => !!document.querySelector('.qf-art-canvas'));
  await t.wait(150);
  await page.click(`.qf-art-list .qf-art-cell[data-id="${T.GRASS}"]`);
  await page.keyboard.press('Digit1');
  t.assert(await t.eval(() => window.__qf.editor.ctx.activeTab) === 'art', 'digit 1 picks a colour in the pixel editor (no tab switch)');
  const pt = (x, y) => t.eval(([px, py]) => {
    const c = document.querySelector('.qf-art-canvas');
    const r = c.getBoundingClientRect();
    const w = Number(/(\d+)×/.exec(document.querySelector('.qf-art-status').textContent)?.[1] ?? 16);
    const z = r.width / w;
    return { x: r.left + (px + 0.5) * z, y: r.top + (py + 0.5) * z };
  }, [x, y]);
  await drag(t, await pt(1, 7), await pt(14, 7), 8);
  await drag(t, await pt(7, 1), await pt(7, 14), 8);
  const g1 = await grass();
  t.assert(g1 !== g0, 'two strokes changed the grass tile');
  await t.shot('art-drawn');

  // Recolour index 1 through the hex field (real typing), committed with Enter.
  await page.click('.qf-art-props .qf-art-pe__sw[data-index="1"]');
  await page.fill('.qf-art-props .qf-art-pe__hex', '#f83800');
  await page.keyboard.press('Enter');
  await t.wait(80);
  const c1 = await pal();
  const want = await t.eval(async () => (await import('/src/gfx/palette.ts')).snapHex('#f83800'));
  t.assert(c1 !== c0 && c1.split(',')[1] === want, `palette colour 1 recoloured to the SNES-snapped red (${c1.split(',')[1]} = ${want})`);
  await t.shot('art-recoloured');

  // Undo / redo several steps with the shell shortcuts.
  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  t.assert(await pal() === c0, 'Ctrl+Z undoes the recolour');
  await page.keyboard.press('Control+KeyZ');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  t.assert(await grass() === g0, 'two more Ctrl+Z undo both strokes');
  await page.keyboard.press('Control+KeyY');
  await page.keyboard.press('Control+KeyY');
  await page.keyboard.press('Control+KeyY');
  await t.wait(60);
  t.assert(await grass() === g1 && await pal() === c1, 'three Ctrl+Y redo strokes and colour');
  // Keep the strokes but give colour 1 back its green, so the playtest still looks like grass.
  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);

  await page.click('#qf-tab-map');
  await t.wait(200);
  const o1 = await overview();
  t.assert(o1 !== o0, 'the world overview thumbnails show the edited grass');
  await t.shot('map-after-art');
}

/** Game helpers for the playtest overlay. */
const game = (t) => t.eval(() => {
  const s = window.__qf.game?.services;
  if (!s) return null;
  return { mode: s.mode, world: s.room.world.id, room: s.room.def.id, x: s.player.x, y: s.player.y, facing: s.player.facing, hp: s.save.hp, flags: s.save.flags };
});

/** Hold `key` until the page condition holds (or the timeout passes). */
async function walkUntil(t, key, cond, arg, timeout = 4000) {
  await t.page.keyboard.down(key);
  const ok = await t.until(cond, arg, timeout);
  await t.page.keyboard.up(key);
  await t.wait(50);
  return ok;
}

/** Playtest from the start room's context menu: talk to the NPC, walk east along the road into the warp, then Escape. */
async function playtest(t, ids, ents) {
  const { page } = t;
  let { cell } = await openRoom(t, 0, 0);
  await click(t, cell(8, 7), { button: 'right' });
  await t.until(() => !!document.querySelector('.qf-map-menu'));
  await page.click('.qf-map-menu__item:has-text("Playtest from here")');
  await t.until(() => window.__qf.game?.state === 'playing', undefined, 8000);
  await t.wait(300);
  let g = await game(t);
  t.assert(g?.room === ids.startRoom && g.x === 136 && g.y === 120, `playtest starts on the clicked tile (${JSON.stringify(g && [g.room, g.x, g.y])})`);
  await t.shot('playtest-start');

  // Up to the NPC, then talk.
  await t.hold('ArrowUp', 800);
  g = await game(t);
  t.assert(g.y < 92 && g.facing === 'up', `walked up to the NPC (${g.x}, ${g.y}, facing ${g.facing})`);
  await t.press('KeyX');
  const talked = await t.until(() => window.__qf.game.services.mode === 'dialogue', undefined, 2000);
  t.assert(talked, 'X in front of the NPC opens the dialogue');
  await t.wait(900);
  await t.shot('playtest-dialogue');
  for (let i = 0; i < 8 && (await game(t)).mode === 'dialogue'; i++) {
    await t.press('KeyX');
    await t.wait(350);
  }
  t.assert((await game(t)).mode === 'playing', 'the dialogue closes after reading it');

  // Down to the road, east into Meadow East, along the road into the warp.
  await walkUntil(t, 'ArrowDown', () => window.__qf.game.services.player.y >= 118);
  await walkUntil(t, 'ArrowRight', (room) => window.__qf.game.services.room.def.id === room && window.__qf.game.services.mode === 'playing', ids.east, 5000);
  t.assert((await game(t)).room === ids.east, 'walking off the east edge scrolls into Meadow East');
  await t.shot('playtest-east');
  await walkUntil(t, 'ArrowRight', (world) => window.__qf.game.services.room.world.id === world, ids.crypt, 5000);
  await t.until(() => window.__qf.game.services.mode === 'playing', undefined, 3000);
  g = await game(t);
  t.assert(g.world === ids.crypt && g.room === ids.entrance && g.x === 136 && g.y === 168, `the warp took the hero into the crypt (${JSON.stringify([g.room, g.x, g.y])})`);
  await t.wait(400);
  const place = await t.eval(() => document.querySelector('.qf-playtest__place')?.textContent);
  t.assert(place === 'Ember Crypt › Entrance', `the playtest bar names the room the hero is in (${place})`);
  await t.shot('playtest-crypt');

  // The key, then the locked door on the east wall.
  await walkUntil(t, 'ArrowLeft', (id) => window.__qf.game.services.save.flags[`pickup:${id}`] === true, ents.key, 3000);
  const keys = await t.eval((w) => window.__qf.game.services.save.dungeons[w]?.keys ?? 0, ids.crypt);
  t.assert(keys === 1, `picked up the small key (${keys})`);
  await walkUntil(t, 'ArrowUp', () => window.__qf.game.services.player.y <= 113);
  await walkUntil(t, 'ArrowRight', (link) => window.__qf.game.services.save.flags[`door:${link}`] === true, 'crypt-door', 4000);
  g = await game(t);
  t.assert(g.flags['door:crypt-door'] === true, 'walking into the locked door with the key opens it');
  await t.wait(300);
  await t.shot('playtest-door-open');
  await walkUntil(t, 'ArrowRight', (room) => window.__qf.game.services.room.def.id === room && window.__qf.game.services.mode === 'playing', ids.treasury, 4000);
  t.assert((await game(t)).room === ids.treasury, 'through the open door into the treasury');
  await t.wait(300);
  await t.shot('playtest-treasury');

  // Defeat the soldier (F2 = invincible, so the fight cannot end the test), the trigger shows the chest.
  await t.press('F2');
  const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  for (let i = 0; i < 80; i++) {
    const foe = await t.eval(() => {
      const s = window.__qf.game.services;
      const e = s.entities.find((x) => x.type === 'enemy.soldier' && !x.dead);
      return e ? { dx: e.x - s.player.x, dy: e.y - s.player.y } : null;
    });
    if (!foe) break;
    const dir = Math.abs(foe.dx) > Math.abs(foe.dy) ? (foe.dx > 0 ? 'right' : 'left') : (foe.dy > 0 ? 'down' : 'up');
    if (Math.hypot(foe.dx, foe.dy) > 26) await t.hold(KEY[dir], 120);
    else {
      await t.press(KEY[dir], 30);
      await t.press('KeyZ', 50);
      await t.wait(200);
    }
  }
  const shown = await t.until((id) => window.__qf.game.services.save.flags[`shown:${id}`] === true, ents.chest, 4000);
  t.assert(shown, 'defeating the only enemy fired the trigger: the chest is shown');
  await t.wait(600);
  await t.shot('playtest-chest-shown');

  // Open the chest from below (facing up) with the action button: the bow.
  const chestAt = await t.eval((id) => {
    const e = window.__qf.game.services.entities.find((x) => x.id === id);
    return e ? { x: e.x, y: e.y } : null;
  }, ents.chest);
  if (chestAt) {
    const alignX = async () => {
      for (let i = 0; i < 40; i++) {
        const dx = chestAt.x - (await game(t)).x;
        if (Math.abs(dx) <= 2) return;
        await t.hold(dx > 0 ? 'ArrowRight' : 'ArrowLeft', Math.min(120, Math.max(16, Math.abs(dx) * 11)));
      }
    };
    await alignX();
    await walkUntil(t, 'ArrowUp', (y) => window.__qf.game.services.player.y <= y, chestAt.y + 15, 4000);
    await t.press('KeyX');
    const opened = await t.until((id) => window.__qf.game.services.save.flags[`chest:${id}`] === true, ents.chest, 3000);
    t.assert(opened, 'X below the chest opens it');
    await t.wait(900);
    await t.shot('playtest-bow');
    for (let i = 0; i < 8 && (await game(t)).mode === 'dialogue'; i++) {
      await t.press('KeyX');
      await t.wait(350);
    }
    t.assert(await t.eval(() => window.__qf.game.services.save.items.bow === 1), 'the hero owns the bow from the chest');
  }

  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest') && !window.__qf.game, undefined, 4000);
  await t.wait(200);
  const back = await t.eval(() => ({ shell: !document.querySelector('.qf-shell')?.hidden, canvas: document.querySelector('.qf-map-canvas')?.width > 0 }));
  t.assert(back.shell && back.canvas, 'Escape returns to the editor');
  const p = await project(t);
  const chest = p.worlds.find((w) => w.id === ids.crypt).rooms.find((r) => r.id === ids.treasury).entities.find((e) => e.id === ents.chest);
  t.assert(chest?.props.hidden === true, 'playing never changes the edited project');
  await t.shot('back-in-editor');
}

/** Save, reload, check the project came back; export the file and import it again from the menu. */
async function persistAndShare(t, ids) {
  const { page } = t;
  await page.keyboard.press('Control+KeyS');
  await t.until(() => document.querySelector('.qf-shell__status-text')?.textContent === 'Saved', undefined, 5000);
  const before = await project(t);
  await page.reload();
  await t.until(() => window.__qf.ready && !!window.__qf.editor, undefined, 15000);
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);
  const after = await project(t);
  const strip = (p) => JSON.stringify({ ...p, modified: 0 });
  t.assert(strip(after) === strip(before), 'the reloaded project is exactly what was saved');
  t.assert(after.name === 'Emberfall Quest' && after.worlds.length === 2 && after.dialogues.length === 1, `reloaded: ${after.name}, ${after.worlds.length} worlds`);
  await t.shot('reloaded');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.qf-shell__bar button:has-text("Export")')]);
  const file = `${t.outDir}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  t.assert(download.suggestedFilename() === 'Emberfall Quest.questforge.json', `export file name (${download.suggestedFilename()})`);

  await page.click('.qf-shell__bar button:has-text("Menu")');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready, undefined, 8000);
  await t.until(() => document.querySelectorAll('.qf-menu-card').length === 2);
  await page.setInputFiles('.qf-menu-projects input[type="file"]', file);
  await t.until(() => document.querySelectorAll('.qf-menu-card').length === 3, undefined, 5000);
  await t.wait(400);
  await t.shot('imported');
  const imported = await t.eval(async (id) => {
    const { listProjects, loadProject } = await import('/src/core/storage.ts');
    const other = (await listProjects()).find((m) => m.id !== id);
    return other ? loadProject(other.id) : null;
  }, before.id);
  t.assert(imported && imported.id !== before.id, 'the import got a fresh id next to the original');
  if (imported) {
    const same = (p) => JSON.stringify({ ...p, id: '', name: '', modified: 0, created: 0 });
    t.assert(same(imported) === same(before), 'the imported copy matches the exported project');
    t.assert(imported.name === 'Emberfall Quest (imported)', `a second copy of a stored project is told apart by its name (${imported.name})`);
  }
  t.log('worlds', ids.ow, ids.crypt);
}

// ------------------------------------------------------------------ helpers for the later steps

const drag = async (t, a, b, steps = 4) => {
  await t.page.mouse.move(a.x, a.y);
  await t.page.mouse.down();
  await t.page.mouse.move(b.x, b.y, { steps });
  await t.page.mouse.up();
  await t.wait(40);
};

const click = async (t, a, opts) => {
  await t.page.mouse.click(a.x, a.y, opts);
  await t.wait(60);
};

const pickPalette = async (t, id) => {
  await t.page.click(`.qf-map-palette__scroll .qf-map-tile[data-tile="${id}"] >> nth=-1`);
  await t.wait(30);
};

/** Select a room by clicking its world-overview cell (the world must be shown), then calibrate the canvas. */
async function openRoom(t, gx, gy) {
  const c = await overviewCell(t, gx, gy);
  await t.page.mouse.click(c.x, c.y);
  await t.wait(200);
  return calibrate(t);
}

/** Show a world by clicking its row in the worlds list. */
async function openWorld(t, worldId) {
  await t.page.click(`.qf-map-world[data-world="${worldId}"]`);
  await t.wait(200);
}

const sideTab = (t, label) => t.page.click(`.qf-map-right .qf-tab:has-text("${label}")`);
/** A labelled field of the map's right sidebar. */
const field = (label) => `.qf-map-right .qf-field:has(> .qf-field__label:text-is("${label}"))`;

/** Terrain brushes, painting tools and the objects layer in the two overworld rooms. */
async function paintOverworld(t, ids, T) {
  const { page } = t;
  const p = await project(t);
  const terrain = (name) => p.terrains.find((x) => x.name === name);
  const water = terrain('Water');
  const path = terrain('Dirt path');
  const pieces = async (tr) => t.eval(async (id) => {
    const { terrainPieces } = await import('/src/core/autotile.ts');
    return [...terrainPieces(window.__qf.editor.ctx.project.terrains.find((x) => x.id === id))];
  }, tr.id);
  const waterIds = new Set(await pieces(water));
  const pathIds = new Set(await pieces(path));

  await openWorld(t, ids.ow);
  await sideTab(t, 'Tiles');
  let { cell } = await calibrate(t);
  t.assert((await snap(t)).room === ids.startRoom, 'the overworld opens on its start room');

  // Water: a 3x3 pond from three strokes; path: a 2-tile-wide road to the east edge.
  await page.click(`.qf-map-terrain[data-terrain="${water.id}"]`);
  for (const ty of [6, 7, 8]) await drag(t, cell(2, ty), cell(4, ty));
  await page.click(`.qf-map-terrain[data-terrain="${path.id}"]`);
  for (const ty of [7, 8]) await drag(t, cell(9, ty), cell(15, ty), 8);
  let got = await layerAt(t, 'bg', [[2, 6], [3, 7], [4, 8], [1, 7], [9, 7], [15, 8], [12, 6]]);
  t.assert(got.slice(0, 3).every((id) => waterIds.has(id)) && got[1] === water.center, `pond painted with the water terrain (${got.slice(0, 3)})`);
  t.assert(!waterIds.has(got[3]), 'the pond stays inside its strokes');
  t.assert(got.slice(4, 6).every((id) => pathIds.has(id)) && !pathIds.has(got[6]), `road painted with the path terrain (${got.slice(4)})`);
  await t.shot('start-terrain');

  // Meadow East: continue the road, then pencil / rectangle / fill / objects layer + eraser.
  ({ cell } = await openRoom(t, 1, 0));
  t.assert((await snap(t)).room === ids.east, 'clicking the overview cell opens Meadow East');
  await page.click(`.qf-map-terrain[data-terrain="${path.id}"]`);
  for (const ty of [7, 8]) await drag(t, cell(0, ty), cell(12, ty), 10);

  await pickPalette(t, T.FLOWERS);
  await page.keyboard.press('KeyP');
  await drag(t, cell(2, 2), cell(6, 2), 1);
  got = await layerAt(t, 'bg', [2, 3, 4, 5, 6].map((x) => [x, 2]));
  t.assert(got.every((id) => id === T.FLOWERS), `pencil stroke of flowers (${got})`);
  t.assert((await snap(t)).undo === 'Paint tiles', 'the pencil stroke is one undo step');

  await pickPalette(t, T.STONE_PATH);
  await page.keyboard.press('KeyR');
  await drag(t, cell(3, 10), cell(7, 12));
  await pickPalette(t, T.SAND);
  await page.keyboard.press('KeyF');
  await click(t, cell(5, 11));
  got = await layerAt(t, 'bg', [[3, 10], [7, 12], [5, 11], [8, 11], [2, 10]]);
  t.assert(got.slice(0, 3).every((id) => id === T.SAND) && got[3] === T.GRASS && got[4] === T.GRASS, `rectangle then fill made a sand plaza (${got})`);

  await page.keyboard.press(']');
  t.assert(await t.eval(() => window.__qf.editor.ctx.layer) === 'fg', '] selects the objects layer');
  await pickPalette(t, T.BUSH);
  await page.keyboard.press('KeyP');
  await drag(t, cell(10, 3), cell(13, 3));
  await page.keyboard.press('KeyE');
  await click(t, cell(11, 3));
  got = await layerAt(t, 'fg', [[10, 3], [11, 3], [12, 3], [13, 3]]);
  t.assert(got[0] === T.BUSH && got[1] === 0 && got[2] === T.BUSH && got[3] === T.BUSH, `bushes on the objects layer, one erased (${got})`);
  t.assert((await layerAt(t, 'bg', [[11, 3]]))[0] === T.GRASS, 'erasing a bush leaves the grass');
  // Undo / redo on the map: the erase, then the bush stroke, and both back.
  const bushes = () => layerAt(t, 'fg', [[10, 3], [11, 3], [12, 3], [13, 3]]);
  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  t.assert((await bushes()).every((id) => id === T.BUSH), 'Ctrl+Z brings the erased bush back');
  await page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  t.assert((await bushes()).every((id) => id === 0), 'a second Ctrl+Z removes the bush stroke');
  await page.keyboard.press('Control+KeyY');
  await page.keyboard.press('Control+KeyY');
  await t.wait(60);
  got = await bushes();
  t.assert(got[0] === T.BUSH && got[1] === 0 && got[2] === T.BUSH, `Ctrl+Y twice redoes the stroke and the erase (${got})`);
  await page.keyboard.press('[');
  const brushSub = await t.eval(() => document.querySelector('.qf-map-brush__sub')?.textContent ?? '');
  t.assert(/painting on ground$/.test(brushSub), `the brush panel follows the layer switch (${brushSub})`);
  await page.keyboard.press('KeyG');
  await t.wait(60);
  await t.shot('east-painted');
  await page.keyboard.press('KeyG');
}

/** Place and configure entities: NPC + dialogue, sign, warp across worlds, key, doors, chest, enemy, trigger. */
async function placeEntities(t, ids, T) {
  const { page } = t;
  const placed = async (type) => (await snap(t)).entities.filter((e) => e.type === type);
  const place = async (type, at) => {
    await sideTab(t, 'Entities');
    await page.click(`.qf-ent-item[data-type="${type}"]`);
    await page.mouse.move(at.x, at.y);
    await t.wait(60);
    await click(t, at);
    const s = await snap(t);
    const inst = s.entities.find((e) => e.id === s.entityId);
    t.assert(inst?.type === type, `placed ${type} (${JSON.stringify(inst && { x: inst.x, y: inst.y })})`);
    await page.keyboard.press('Escape');
    const after = await snap(t);
    t.assert(after.entityId === inst?.id && (await t.eval(() => window.__qf.editor.ctx.entityType)) === null,
      `Esc stops placing ${type} and keeps it selected`);
    return inst;
  };

  // ---- Start room: an NPC with a brand-new dialogue written in the Dialogue tab.
  let { cell } = await openRoom(t, 0, 0);
  t.assert((await snap(t)).room === ids.startRoom, 'the start room is open');
  const npc = await place('npc.person', cell(8, 4));
  t.assert(npc?.x === 136 && npc?.y === 72, `the NPC snapped to its tile centre (${npc?.x}, ${npc?.y})`);
  await page.fill(`${field('Name')} input`, 'Old Maren');
  await page.keyboard.press('Tab');
  await t.wait(80);
  await page.click(`${field('Dialogue')} button:has-text("New")`);
  await t.until(() => window.__qf.editor.ctx.activeTab === 'dialogue' && document.activeElement?.classList.contains('qf-dlg-page__text'));
  await page.keyboard.type('The crypt lies east, past the meadow. Take this road and mind the soldier inside!');
  // The speaker field sits above the text.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('Maren');
  await page.keyboard.press('Tab');
  await t.wait(100);
  let p = await project(t);
  const dlg = p.dialogues[0];
  t.assert(p.dialogues.length === 1 && dlg.pages[0].text.startsWith('The crypt lies east') && dlg.name === 'Old Maren',
    `a new dialogue named after the NPC holds the typed text (${dlg?.name}: ${dlg?.pages[0]?.text.slice(0, 20)}…)`);
  t.assert(dlg?.pages[0]?.speaker === 'Maren', `speaker typed after Tab (${dlg?.pages[0]?.speaker})`);
  // Rename it here: the map inspector must show the new name.
  await page.fill('.qf-dlg-name', 'Maren greets');
  await page.keyboard.press('Enter');
  await t.wait(60);
  await t.shot('dialogue-written');
  await page.click('#qf-tab-map');
  await t.wait(150);
  const shownName = await page.locator(`${field('Dialogue')} select`).evaluate((s) => s.selectedOptions[0]?.textContent ?? null);
  t.assert(shownName === 'Maren greets', `the inspector shows the renamed dialogue (${shownName})`);
  t.assert((await snap(t)).entityId === npc.id, 'the NPC is still selected after the dialogue round trip');

  // ---- A sign with plain text.
  const sign = await place('obj.sign', cell(11, 5));
  await page.fill(`${field('Text (if no dialogue)')} textarea`, 'East: the Ember Crypt.');
  await page.keyboard.press('Tab');
  await t.wait(60);
  p = await project(t);
  t.assert(p.worlds[0].rooms[0].entities.find((e) => e.id === sign?.id)?.props.text === 'East: the Ember Crypt.', 'sign text committed');
  await t.shot('start-entities');

  // ---- Meadow East: a warp (context menu) whose destination is picked in the crypt.
  ({ cell } = await openRoom(t, 1, 0));
  await click(t, cell(12, 7), { button: 'right' });
  await t.until(() => !!document.querySelector('.qf-map-menu'));
  await page.click('.qf-map-menu__item:has-text("Add warp here")');
  await t.wait(100);
  const warp = (await placed('marker.warp'))[0];
  t.assert(warp && warp.x === 200 && warp.y === 120, `"Add warp here" placed a warp on the tile (${JSON.stringify(warp && [warp.x, warp.y])})`);
  t.assert((await snap(t)).entityId === warp?.id, 'the new warp is selected');
  await sideTab(t, 'Entities');
  await page.click(`${field('Destination')} button:has-text("Pick on map")`);
  await t.until(() => !document.querySelector('.qf-map-pick')?.hidden);
  await t.shot('warp-pick-banner');
  await openWorld(t, ids.crypt);
  ({ cell } = await calibrate(t));
  t.assert((await snap(t)).room === ids.entrance, 'browsing to the crypt during the pick shows its entrance');
  await click(t, cell(8, 10));
  await t.wait(150);
  let s = await snap(t);
  const warpNow = s.entities.find((e) => e.id === warp?.id);
  t.assert(s.room === ids.east && s.entityId === warp?.id, `after the pick the warp's room and selection come back (${s.room}, ${s.entityId})`);
  t.assert(warpNow?.props.target?.world === ids.crypt && warpNow.props.target.room === ids.entrance && warpNow.props.target.x === 136 && warpNow.props.target.y === 168,
    `warp destination picked on the map (${JSON.stringify(warpNow?.props.target)})`);
  const summary = await page.locator(`${field('Destination')} .qf-ent-warp__summary`).textContent();
  t.assert(/Ember Crypt/.test(summary ?? ''), `the inspector summarises the destination (${summary})`);
  await t.shot('warp-set');

  // ---- Crypt entrance: a small key and a locked door on the east wall.
  await openWorld(t, ids.crypt);
  ({ cell } = await calibrate(t));
  const key = await place('obj.pickup', cell(4, 10));
  t.assert(key?.props.item === 'smallKey', 'item pickups default to a small key');
  const { px } = await calibrate(t);
  const door1 = await place('obj.door', px(250, 112));
  t.assert(door1?.x === 248 && door1?.y === 112 && door1?.props.dir === 'right' && door1?.props.kind === 'locked',
    `a locked door snapped onto the east wall (${JSON.stringify(door1 && [door1.x, door1.y, door1.props.dir, door1.props.kind])})`);
  await page.fill(`${field('Link')} input`, 'crypt-door');
  await page.keyboard.press('Tab');
  await t.wait(60);

  // ---- Treasury: the matching door, a soldier, and a chest with the bow.
  ({ cell } = await openRoom(t, 1, 0));
  t.assert((await snap(t)).room === ids.treasury, 'the treasury is open');
  const { px: tpx } = await calibrate(t);
  const door2 = await place('obj.door', tpx(6, 112));
  t.assert(door2?.x === 8 && door2?.y === 112 && door2?.props.dir === 'left', `the matching door on the west wall (${JSON.stringify(door2 && [door2.x, door2.y, door2.props.dir])})`);
  await page.fill(`${field('Link')} input`, 'crypt-door');
  await page.keyboard.press('Tab');
  await t.wait(60);
  const soldier = await place('enemy.soldier', cell(11, 9));
  const chest = await place('obj.chest', cell(8, 4));
  await page.selectOption(`${field('Contents')} select`, 'bow');
  await t.wait(60);
  s = await snap(t);
  t.assert(s.entities.find((e) => e.id === chest.id)?.props.item === 'bow', 'the chest holds the bow');
  await t.shot('treasury-entities');

  // ---- Trigger: all enemies defeated -> show the (hidden) chest + secret jingle.
  await sideTab(t, 'Triggers');
  await page.click('.qf-map-right .qf-ent-trig button:has-text("+ Add")');
  await t.wait(80);
  t.assert(await t.eval(() => document.activeElement?.dataset.fk === 'trig:name'), 'the new trigger name field has the caret');
  await page.keyboard.type('Treasure appears');
  await page.keyboard.press('Tab');
  await page.selectOption('.qf-map-right .qf-ent-trig-add >> nth=0', 'enemiesCleared');
  await t.wait(80);
  await page.selectOption('.qf-map-right .qf-ent-trig-add >> nth=1', 'showEntity');
  await t.wait(80);
  await page.selectOption(`.qf-map-right .qf-ent-trig-card:has-text("Show entity") ${field('Entity').replace('.qf-map-right ', '')} select`, chest.id);
  await t.wait(80);
  await page.click('.qf-map-right .qf-ent-trig-card button:has-text("Mark it Hidden")');
  await t.wait(80);
  await page.selectOption('.qf-map-right .qf-ent-trig-add >> nth=1', 'secret');
  await t.wait(120);
  p = await project(t);
  const room = p.worlds.find((w) => w.id === ids.crypt).rooms.find((r) => r.id === ids.treasury);
  const trig = room.triggers[0];
  t.assert(trig?.name === 'Treasure appears' && trig.on === 'auto' && trig.conditions[0]?.kind === 'enemiesCleared'
    && trig.actions[0]?.kind === 'showEntity' && trig.actions[0].target === chest.id && trig.actions[1]?.kind === 'secret',
  `trigger built from the panel (${JSON.stringify(trig)})`);
  t.assert(room.entities.find((e) => e.id === chest.id)?.props.hidden === true, '"Mark it Hidden" hid the chest');
  // Undo / redo reach the open trigger form.
  await page.keyboard.press('Control+KeyZ');
  await t.wait(120);
  t.assert(await page.locator('.qf-map-right .qf-ent-trig-card:has-text("Secret jingle")').count() === 0, 'Ctrl+Z removes the secret action from the form');
  await page.keyboard.press('Control+KeyY');
  await t.wait(120);
  t.assert(await page.locator('.qf-map-right .qf-ent-trig-card:has-text("Secret jingle")').count() === 1, 'Ctrl+Y puts it back');
  const issues = await t.eval(() => document.querySelector('.qf-map-right .qf-ent-trig-editor .qf-ent-warn')?.textContent ?? '');
  t.assert(issues === '', `the finished trigger has no warnings (${issues})`);
  await t.shot('trigger');
  const ents = { npc: npc.id, sign: sign.id, warp: warp.id, key: key.id, door1: door1.id, door2: door2.id, soldier: soldier.id, chest: chest.id };
  t.log('entities', ents);
  return ents;
}
