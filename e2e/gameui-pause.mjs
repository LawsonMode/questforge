// Game UI e2e: pause menu. Items page (equip with the cursor, passive gear,
// hearts & pieces, crystals, play time; a playtest never saves, so its options
// are Quit / Sound / Resume, and Sound opens the volume panel), the map
// page on the overworld (mini-map), in the test dungeon (schematic floor map:
// explored rooms only and no paper grid without the Dungeon Map; all rooms with
// map + compass), indoors (the sample's overworld with the doorway marked; NO MAP
// HERE for an interior no overworld warp leads into), page switching and closing.
const state = (t) => t.eval(() => window.__qf.game.state);

export default async function (t) {
  await t.goto('#/playtest/test');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.giveItem('bow', 1);
    s.giveItem('arrows', 20);
    s.giveItem('boomerang', 1);
    s.giveItem('bombs', 6);
    s.giveItem('lantern', 1);
    s.giveItem('boots', 1);
    s.giveItem('glove', 2);
    s.save.items.sword = 2;
    s.save.heartPieces = 3;
    s.save.crystals = 2;
    s.save.maxHp = 16;
    s.save.hp = 13;
    s.save.playTime = 3725;
    s.save.equipped = 'bow';
  });
  await t.wait(300);

  await t.press('Enter');
  await t.wait(60);
  await t.shotCanvas('items-sliding');
  await t.wait(300);
  t.assert((await state(t)) === 'paused', 'Start opens the pause menu');
  await t.shotCanvas('items-page');

  // Right moves to the boomerang and equips it.
  await t.press('ArrowRight');
  await t.wait(100);
  let equipped = await t.eval(() => window.__qf.game.services.save.equipped);
  t.assert(equipped === 'boomerang', `the cursor equips as it moves (${equipped})`);
  // Down -> lantern row (bombs / lantern), then down again -> options.
  await t.press('ArrowDown');
  await t.wait(100);
  equipped = await t.eval(() => window.__qf.game.services.save.equipped);
  t.assert(equipped === 'lantern' || equipped === 'bombs', `down moves to the second row (${equipped})`);
  await t.shotCanvas('items-second-row');
  await t.press('ArrowDown');
  await t.wait(100);
  await t.shotCanvas('items-options');
  const opts = await t.eval(() => window.__qf.game.services.pauseMenu.options.map((o) => o[0]));
  t.assert(JSON.stringify(opts) === '["QUIT","SOUND","RESUME"]', `a playtest offers no SAVE (${JSON.stringify(opts)})`);
  // SOUND opens the volume panel in the options window; B goes back and keeps the menu open.
  await t.press('ArrowDown');
  await t.wait(80);
  await t.press('KeyX');
  await t.wait(120);
  await t.shotCanvas('items-sound');
  const row = await t.eval(() => window.__qf.game.services.pauseMenu.soundRow);
  t.assert(row === 0, `the sound panel opened (${row})`);
  await t.press('KeyZ');
  await t.wait(100);
  t.assert((await state(t)) === 'paused', 'B leaves the sound panel and keeps the menu open');

  // Map page (overworld).
  await t.press('KeyE');
  await t.wait(150);
  await t.shotCanvas('map-overworld');

  // Back to items and close.
  await t.press('KeyQ');
  await t.wait(100);
  await t.press('Enter');
  await t.wait(150);
  t.assert((await state(t)) === 'playing', 'Start closes the menu');

  // Dungeon map: warp in, walk the first room, then open the map directly (Shift).
  await t.eval(() => window.__qf.game.warpNow({ world: 'dg', room: 'dg_entry', x: 128, y: 160, dir: 'up' }));
  await t.wait(200);
  await t.press('ShiftLeft');
  await t.wait(300);
  t.assert((await state(t)) === 'paused', 'Select opens the pause menu on the map');
  await t.shotCanvas('map-dungeon-explored');
  await t.press('Enter');
  await t.wait(100);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.giveItem('map', 1);
    s.giveItem('compass', 1);
    s.giveItem('smallKey', 2);
  });
  await t.wait(100);
  await t.press('ShiftLeft');
  await t.wait(300);
  await t.shotCanvas('map-dungeon-with-map');
  await t.press('Enter');
  await t.wait(150);
  await t.shotCanvas('dungeon-hud-keys');
  t.assert((await state(t)) === 'playing', 'the menu closes again');

  // Compass marks: a two-screen dungeon arena with a chest and a (hidden) boss.
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), {
    theme: 'dungeon', gw: 2,
    entities: [
      { id: 'c1', type: 'obj.chest', x: 360, y: 60, props: { item: 'bow', amount: 1 } },
      { id: 'b1', type: 'boss.knight', x: 120, y: 100, props: { hidden: true } },
    ],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.giveItem('compass', 1);
    s.giveItem('map', 1);
  });
  await t.press('ShiftLeft');
  await t.wait(300);
  await t.shotCanvas('map-compass');
  await t.press('Enter');

  // Indoors: the sample starts in a house; its map shows the overworld at the doorway.
  await t.goto('#/playtest/sample');
  await t.until(() => window.__qf.game && window.__qf.game.state === 'playing');
  await t.wait(300);
  await t.press('ShiftLeft');
  await t.wait(300);
  const indoor = await t.eval(() => {
    const s = window.__qf.game.services;
    const view = s.pauseMenu.map.view;
    return { here: s.room.world.kind, shows: view && view.world.kind, room: view && view.room.id, heroAt: view && view.heroAt };
  });
  t.log('indoor map', indoor);
  t.assert(indoor.here !== 'interior' || (indoor.shows === 'overworld' && !!indoor.heroAt), `an interior shows the overworld at its doorway (${JSON.stringify(indoor)})`);
  await t.shotCanvas('map-indoors');
  await t.press('ShiftLeft');

  // An interior with no overworld warp into it has no map.
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), { theme: 'interior', worldKind: 'interior' });
  await t.until(() => window.__qf.game && window.__qf.game.state === 'playing');
  await t.press('ShiftLeft');
  await t.wait(300);
  const noMap = await t.eval(() => window.__qf.game.services.pauseMenu.map.view);
  t.assert(noMap === null, 'an unreachable interior shows NO MAP HERE');
  await t.shotCanvas('map-none');
  await t.press('ShiftLeft');
}
