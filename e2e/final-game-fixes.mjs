// Final quality pass, game bucket: the fixes that need a real browser to be
// seen. (1) A bomb flips a crystal switch while the hero stands in a thick
// field of lowered pegs: they rise under him, and he walks off across the tops.
// (2) Talking to a villager just below the hero puts the box at the top.
// (3) Shops: the hero stops back from the goods so icon and price stay in view,
// and buying still works. (4) Playtest pause: QUIT / SOUND / RESUME (no fake
// SAVE), the SOUND panel, and the hero is 'Hero' in playtest. (5) The title
// screen names the controls, and says a keyboard or gamepad is needed on a
// touch-only device. (6) A dash into a room edge with no neighbour bonks.
// (7) Walkers placed half inside a wall walk out.

const arena = (t, cfg) => t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
const svc = (t, fn, arg) => t.eval(fn, arg);
const hero = (t) => svc(t, () => {
  const s = window.__qf.game.services;
  const p = s.player;
  return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), state: p.state, blocked: p.isBlockedAt(p.x, p.y) };
});

async function holdFor(t, key, ms) {
  await t.hold(key, ms);
  await t.wait(60);
}

export default async function (t) {
  await t.goto('#/');

  // (1) Pegs rising under the hero, real gameplay: a bomb beside the switch, then into the lowered field.
  const pegs = [];
  for (let ty = 5; ty <= 9; ty++) for (let tx = 6; tx <= 10; tx++) pegs.push({ type: 'obj.peg', id: `p${tx}_${ty}`, x: tx * 16 + 8, y: ty * 16 + 8, props: { color: 'red' } });
  await arena(t, {
    theme: 'dungeon', player: { x: 60, y: 120, dir: 'left' }, items: { bombs: 10 },
    entities: [{ type: 'obj.crystalSwitch', id: 'cs', x: 32, y: 120 }, ...pegs],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await svc(t, () => { const s = window.__qf.game.services; s.setFlag('pegs:arena', true); s.save.equipped = 'bombs'; });
  await t.wait(300);
  await t.press('KeyC');
  await t.wait(100);
  await holdFor(t, 'ArrowRight', 900);
  await holdFor(t, 'ArrowDown', 120);
  const onField = await hero(t);
  await t.wait(1700);
  const afterBlast = await svc(t, () => window.__qf.game.services.pegState());
  const raised = await svc(t, () => window.__qf.game.services.entities.filter((e) => e.type === 'obj.peg' && e.solid).length);
  t.log('pegs', { onField, afterBlast, raised });
  t.assert(afterBlast === false && raised === 25, `the blast raised every red peg, under the hero too (pegState ${afterBlast}, raised ${raised})`);
  await t.shotCanvas('hero-on-raised-pegs');
  await holdFor(t, 'ArrowDown', 900);
  const off = await hero(t);
  t.log('walked off', off);
  t.assert(!off.blocked && off.y > 10 * 16, `the hero walked off the tops of the field (${JSON.stringify(off)})`);
  await holdFor(t, 'ArrowUp', 400);
  const back = await hero(t);
  t.assert(back.y >= 10 * 16 + 5, `from outside, the raised field blocks again (${JSON.stringify(back)})`);
  await t.shotCanvas('off-the-field');

  // (2) A villager just below the hero: the box goes to the top.
  await arena(t, {
    theme: 'grass', player: { x: 128, y: 136, dir: 'down' },
    dialogues: [{ id: 'd1', name: 'D1', pages: [{ text: 'Fine weather for it, {name}.' }] }],
    entities: [{ type: 'npc.person', id: 'tom', x: 128, y: 152, props: { facing: 'up', dialogue: 'd1', name: 'Farmer Tom' } }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(500);
  await t.press('KeyX');
  await t.wait(900);
  const box = await svc(t, () => {
    const db = window.__qf.game.services.dialogueBox;
    return db.current ? { position: db.current.position, text: db.current.boxes[db.boxIndex].text } : null;
  });
  t.log('dialogue', box);
  t.assert(box && box.position === 'top', `the box sits at the top, clear of the speaker below (${JSON.stringify(box)})`);
  t.assert(box && box.text.includes('Hero'), `a playtest hero is called Hero (${box && box.text})`);
  await t.shotCanvas('speaker-below');
  await t.hold(['KeyX'], 250);

  // (3) The shop counter.
  await arena(t, {
    theme: 'interior', player: { x: 128, y: 150, dir: 'up' }, items: { rupees: 50 },
    entities: [{ type: 'obj.shopItem', id: 'heartForSale', x: 128, y: 96, props: { item: 'bombs', amount: 5, price: 30 } }],
  });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  await holdFor(t, 'ArrowUp', 900);
  const buyer = await hero(t);
  t.log('shopper', buyer);
  t.assert(buyer.y >= 96 + 26 - 0.5, `the hero stops back from the goods (y ${buyer.y}, the icon ends at 104)`);
  await t.shotCanvas('shop-icon-and-price-visible');
  await t.press('KeyX');
  await t.wait(400);
  const bought = await svc(t, () => ({ rupees: window.__qf.game.services.save.rupees, bombs: window.__qf.game.services.save.bombs }));
  t.assert(bought.rupees === 20 && bought.bombs === 5, `buying from the counter works (${JSON.stringify(bought)})`);

  // (4) Playtest pause menu: no SAVE; the SOUND panel keeps its levels per browser.
  await t.goto('#/playtest/sample');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(400);
  const name = await svc(t, () => window.__qf.game.services.save.name);
  t.assert(name === 'Hero', `the playtest hero is called Hero (${name})`);
  await t.press('Enter');
  await t.wait(400);
  const opts = await svc(t, () => window.__qf.game.services.pauseMenu.options.map((o) => o[0]));
  t.assert(JSON.stringify(opts) === JSON.stringify(['QUIT', 'SOUND', 'RESUME']), `playtest options (${JSON.stringify(opts)})`);
  await t.shotCanvas('playtest-pause-options');
  // Cursor: the sample start has no equippable items, so it starts on RESUME; up = SOUND.
  await t.press('ArrowUp');
  await t.wait(80);
  await t.press('KeyX');
  await t.wait(150);
  await t.press('ArrowLeft');
  await t.wait(80);
  await t.press('ArrowDown');
  await t.wait(80);
  await t.press('ArrowLeft');
  await t.wait(80);
  await t.press('ArrowLeft');
  await t.wait(150);
  await t.shotCanvas('sound-panel');
  const stored = await svc(t, () => localStorage.getItem('questforge:sound'));
  t.assert(stored === JSON.stringify({ music: 3, sfx: 2, muted: false }), `sound levels stored (${stored})`);
  await t.press('KeyZ');
  await t.wait(100);
  const back2 = await svc(t, () => ({ row: window.__qf.game.services.pauseMenu.soundRow, state: window.__qf.game.state }));
  t.assert(back2.row === -1 && back2.state === 'paused', `B leaves the sound panel, the menu stays open (${JSON.stringify(back2)})`);
  await svc(t, () => localStorage.removeItem('questforge:sound'));

  // (5) Title screen: the controls line; a touch-only device is told it needs a keyboard or gamepad.
  await t.goto('#/play/sample');
  await t.wait(2200);
  await t.shotCanvas('title-controls');
  const page2 = await t.page.context().newPage();
  await page2.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (q === '(pointer: coarse)') return { matches: true, media: q, addEventListener() {}, removeEventListener() {} };
      if (q === '(any-pointer: fine)') return { matches: false, media: q, addEventListener() {}, removeEventListener() {} };
      return real(q);
    };
  });
  await page2.setViewportSize({ width: 390, height: 844 });
  await page2.goto(`${t.base}/#/play/sample`);
  await page2.waitForFunction(() => window.__qf && (window.__qf.ready || window.__qf.error), null, { timeout: 15000 });
  await page2.waitForTimeout(2200);
  const touchShot = `${t.outDir}/99-title-touch-only.png`;
  await page2.screenshot({ path: touchShot });
  const touchState = await page2.evaluate(() => window.__qf.game.title.touchOnly);
  t.assert(touchState === true, 'the title screen knows the device is touch-only');
  await page2.close();

  // (6) A dash into an edge with no neighbour bonks.
  await arena(t, { theme: 'grass', items: { boots: 1 }, player: { x: 180, y: 112, dir: 'right' } });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  await svc(t, () => {
    window.__states = [];
    const g = window.__qf.game;
    const tick = () => {
      if (!g.services) return;
      window.__states.push(g.services.player.state);
      if (window.__states.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await holdFor(t, 'KeyX', 1600);
  const states = await svc(t, () => [...new Set(window.__states)]);
  t.log('dash states', states);
  t.assert(states.includes('dash') && states.includes('hurt'), `the dash bonks at the closed edge (${JSON.stringify(states)})`);

  // (7) Walkers placed half inside the top wall walk out and chase.
  const foes = ['enemy.soldier', 'enemy.archer', 'enemy.skeleton', 'enemy.goblin'].map((type, i) => ({
    type, id: `f${i}`, x: 48 + i * 48, y: 20, props: { behavior: 'chase', drop: 'none' },
  }));
  await arena(t, { theme: 'dungeon', player: { x: 128, y: 190, dir: 'up' }, entities: foes });
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(2500);
  const moved = await svc(t, () => window.__qf.game.services.entities.filter((e) => e.id.startsWith('f'))
    .map((e) => ({ id: e.id, type: e.type, y: +e.y.toFixed(1), blocked: e.isBlockedAt(e.x, e.y) })));
  t.log('walkers', moved);
  t.assert(moved.every((m) => !m.blocked && m.y !== 20), `every walker stepped out of the wall (${JSON.stringify(moved)})`);
  // The archer keeps its distance by design; the others come for the hero.
  t.assert(moved.filter((m) => m.type !== 'enemy.archer').every((m) => m.y > 40), `the melee walkers left the wall behind (${JSON.stringify(moved)})`);
  await t.shotCanvas('walkers-out-of-the-wall');
}
