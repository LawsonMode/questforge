// Map tab layout: the editor opens on the map tab with the worlds list, the
// world overview, the room canvas (toolbar, zoom widget, status bar) and the
// sidebar tabs; the collision overlay + legend and the grid toggle render; the
// Room tab shows the room's properties.

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

export default async function (t) {
  await holdHmr(t);
  await t.goto('#/edit/sample');
  await t.until(() => document.querySelector('.qf-map-canvas') && document.querySelector('.qf-map-overview__canvas'));
  await t.wait(300);
  const info = await t.eval(() => {
    const c = document.querySelector('.qf-map-canvas');
    const r = c.getBoundingClientRect();
    return {
      canvas: { w: c.width, h: c.height, cssW: r.width, cssH: r.height },
      worlds: document.querySelectorAll('.qf-map-world').length,
      tiles: document.querySelectorAll('.qf-map-tile').length,
      terrains: document.querySelectorAll('.qf-map-terrain').length,
      tabs: [...document.querySelectorAll('.qf-map-right .qf-tab')].map((b) => b.textContent),
      zoom: document.querySelector('.qf-map-zoom__label').textContent,
    };
  });
  t.log(info);
  t.assert(info.canvas.w > 300 && info.canvas.h > 300, 'room canvas has a real size');
  t.assert(info.worlds >= 1, 'worlds list shows the project worlds');
  t.assert(info.tiles > 50, 'tile palette lists the default tiles');
  t.assert(info.terrains >= 4, 'terrain brushes are listed');
  t.assert(info.tabs.join(',') === 'Tiles,Entities,Triggers,Room', 'sidebar has the four tabs');
  t.assert(/^\d+%$/.test(info.zoom), 'zoom widget shows a percentage');
  await t.shot('map-tab');

  // Hover the canvas: the status bar reports the cell under the cursor.
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await t.wait(100);
  const status = await t.eval(() => document.querySelector('.qf-map-status').textContent);
  t.log('status', status);
  t.assert(/Tile \d+, \d+/.test(status), 'status bar shows the hovered tile');

  // Collision overlay (C) with legend, grid (G).
  await t.press('KeyC');
  await t.press('KeyG');
  await t.wait(150);
  const overlays = await t.eval(() => ({
    legend: !document.querySelector('.qf-map-legend').hidden,
    grid: document.querySelector('[data-toggle="grid"]').classList.contains('qf-map-tool--active'),
  }));
  t.assert(overlays.legend, 'collision legend appears with the overlay');
  t.assert(overlays.grid, 'grid toggle is active');
  await t.shot('collision-grid');
  await t.press('KeyC');
  await t.press('KeyG');

  // Room properties tab.
  await t.page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(150);
  const props = await t.eval(() => document.querySelector('.qf-map-props__title')?.textContent ?? '');
  t.assert(props.length > 0, 'Room tab shows the room name');
  await t.shot('room-tab');

  // Another world: its rooms (from the start room when it holds the start) fill the overview;
  // clicking a room in the overview selects it and the canvas follows.
  await t.page.click('.qf-map-world >> nth=0');
  await t.wait(200);
  const sel = await t.eval(() => ({ world: window.__qf.editor.ctx.worldId, first: window.__qf.editor.ctx.project.worlds[0].id, room: window.__qf.editor.ctx.room()?.name }));
  t.assert(sel.world === sel.first, 'clicking a world selects it');
  await t.page.click('.qf-map-right .qf-tab:has-text("Tiles")');
  const withEntities = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const room = ctx.world().rooms.find((r) => r.entities.some((e) => !e.type.startsWith('marker.'))) ?? ctx.room();
    ctx.selectRoom(ctx.worldId, room.id);
    const inst = room.entities.find((e) => !e.type.startsWith('marker.'));
    if (inst) ctx.selectEntity(inst.id);
    return { room: room.name, entity: inst?.type ?? null };
  });
  t.log('overworld room', withEntities);
  await t.wait(250);
  await t.shot('overworld-selected-entity');

  // Animated tiles (flowers, water) keep ticking while the editor is otherwise idle.
  await t.page.mouse.move(5, 5);
  const hash = () => t.eval(() => {
    const c = document.querySelector('.qf-map-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i]) | 0;
    return h;
  });
  const frames = new Set();
  for (let i = 0; i < 6; i++) {
    frames.add(await hash());
    await t.wait(150);
  }
  t.assert(frames.size > 1, `animated tiles redraw while idle (${frames.size} distinct frames)`);

  // Leaving the tab and coming back keeps the canvas sized and drawn.
  await t.eval(() => window.__qf.editor.ctx.switchTab('art'));
  await t.wait(150);
  await t.page.click('#qf-tab-map');
  await t.wait(200);
  const back = await t.eval(() => {
    const c = document.querySelector('.qf-map-canvas');
    return { w: c.width, h: c.height, zoom: document.querySelector('.qf-map-zoom__label').textContent };
  });
  t.assert(back.w > 300 && back.h > 300, `canvas intact after a tab round-trip (${JSON.stringify(back)})`);

  // A dungeon world (if the project has one): the busiest room shows doors, objects and markers.
  const dungeon = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const w = ctx.project.worlds.find((x) => x.kind === 'dungeon');
    if (!w) return null;
    const room = [...w.rooms].sort((a, b) => b.entities.length - a.entities.length)[0];
    ctx.selectRoom(w.id, room.id);
    return { world: w.name, room: room.name, entities: room.entities.length, floors: [...new Set(w.rooms.map((r) => r.floor))] };
  });
  t.log('dungeon', dungeon);
  if (dungeon) {
    await t.wait(250);
    const floorShown = await t.eval(() => !document.querySelector('.qf-map-left__row:has(.qf-select[title^="Floor"])').hidden);
    t.assert(floorShown, 'dungeon worlds show the floor selector');
    await t.shot('dungeon-room');
  }

  // Keys reference.
  await t.page.click('.qf-map-tool--text');
  await t.until(() => !!document.querySelector('.qf-map-help'));
  await t.shot('keys-help');
  await t.page.keyboard.press('Escape');
}
