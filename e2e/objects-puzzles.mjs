// Objects: dungeon puzzle pieces — a push block shoved onto a floor switch, a
// crystal switch flipping red/blue pegs (and the hero walking over lowered ones),
// and torches lit with ignite() brightening a dark room. Uses the real sword /
// push when the player supports them, else calls hurt()/onPush() directly (logged).

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const ent = (t, id) => t.eval((eid) => {
  const e = S().entities.find((x) => x.id === eid);
  return e ? { x: e.x, y: e.y, anim: e.anim, solid: e.solid, on: e.on ?? null, pushed: e.pushed ?? null, lit: e.lit ?? null, light: e.light } : null;
}, id);

/** Count calls to a hook on an entity (to tell real input from the direct fallback). */
const spy = (t, id, hook) => t.eval(([eid, h]) => {
  const e = S().findEntity(eid);
  const orig = e[h].bind(e);
  e.__calls = 0;
  e[h] = (...a) => { e.__calls++; return orig(...a); };
}, [id, hook]);
const calls = (t, id) => t.eval((eid) => S().entities.find((x) => x.id === eid)?.__calls ?? 0, id);

/** Mean brightness (0..255) of the displayed canvas. */
const brightness = (t) => t.eval(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / (d.length / 16) / 3;
});

/**
 * Other agents saving files mid-run make Vite full-reload the page; mock its HMR
 * socket for this page (kept open, no server) so the scenario can't be reloaded.
 */
const isolateFromHmr = (t) => t.page.routeWebSocket(() => true, () => {});

export default async function (t) {
  await isolateFromHmr(t);
  // ---------------------------------------------------------------- block onto a switch
  await arena(t, {
    theme: 'dungeon', player: { x: 128, y: 120, dir: 'up' },
    entities: [
      { id: 'sw', type: 'obj.switch', x: 128, y: 72, props: { mode: 'once' } },
      { id: 'blk', type: 'obj.block', x: 128, y: 88, props: { pushes: 'once' } },
      { id: 'heavy', type: 'obj.block', x: 200, y: 88, props: { heavy: true, pushes: 'free' } },
    ],
  });
  await t.shotCanvas('block-before');
  await spy(t, 'blk', 'onPush');
  await t.hold(['ArrowUp'], 1000);
  let how = 'push';
  if ((await calls(t, 'blk')) === 0) {
    how = 'direct';
    await t.eval(() => S().findEntity('blk').onPush('up'));
  }
  t.log('block pushed via', how);
  await t.wait(500);
  // Step aside so the block and switch are not hidden behind the hero.
  await t.eval(() => S().player.place(96, 100, 'right'));
  await t.wait(100);
  const blk = await ent(t, 'blk');
  const sw = await ent(t, 'sw');
  t.assert(blk.y === 72 && blk.x === 128 && blk.pushed, `block moved exactly one tile onto the switch (${JSON.stringify(blk)})`);
  t.assert(sw.on && sw.anim === 'down', `switch held down by the block (${JSON.stringify(sw)})`);
  const again = await t.eval(() => S().findEntity('blk').onPush('up'));
  t.assert(again === false, 'a once-block locks after its push');
  const heavy = await t.eval(() => S().findEntity('heavy').onPush('left'));
  t.assert(heavy === false, 'heavy block will not budge without the glove');
  await t.shotCanvas('block-on-switch');
  await t.eval(() => S().giveItem('glove', 1));
  const heavyMoved = await t.eval(() => S().findEntity('heavy').onPush('left'));
  await t.wait(90);
  await t.shotCanvas('heavy-block-sliding');
  await t.wait(300);
  const hv = await ent(t, 'heavy');
  t.assert(heavyMoved && hv.x === 184, `with the glove the heavy block slides one tile (${JSON.stringify(hv)})`);

  // ---------------------------------------------------------------- crystal switch + pegs
  const pegs = [];
  for (let i = 0; i < 4; i++) {
    pegs.push({ id: `red${i}`, type: 'obj.peg', x: 136 + i * 16, y: 72, props: { color: 'red' } });
    pegs.push({ id: `blue${i}`, type: 'obj.peg', x: 136 + i * 16, y: 136, props: { color: 'blue' } });
  }
  await arena(t, {
    theme: 'dungeon', player: { x: 56, y: 126, dir: 'up' },
    entities: [{ id: 'cs', type: 'obj.crystalSwitch', x: 56, y: 104 }, ...pegs],
  });
  await t.wait(200);
  let red = await ent(t, 'red0');
  let blue = await ent(t, 'blue0');
  t.assert(red.solid && red.anim === 'red_up' && !blue.solid && blue.anim === 'blue_down', 'red pegs start raised, blue lowered');
  await t.shotCanvas('pegs-red-up');
  await spy(t, 'cs', 'hurt');
  await t.press('KeyZ', 60);
  await t.wait(350);
  how = 'sword';
  if ((await calls(t, 'cs')) === 0) {
    how = 'direct';
    await t.eval(() => S().findEntity('cs').hurt({ damage: 1, kind: 'sword', source: S().player, dx: 0, dy: -1 }));
  }
  t.log('crystal struck via', how);
  await t.wait(100);
  red = await ent(t, 'red0');
  blue = await ent(t, 'blue0');
  const cs = await ent(t, 'cs');
  const state = await t.eval(() => S().pegState());
  t.assert(state === true, `peg state flipped (${state})`);
  t.assert(!red.solid && red.anim === 'red_down' && blue.solid && blue.anim === 'blue_up', `pegs swapped (${JSON.stringify({ red, blue })})`);
  t.assert(cs.anim === 'blue', `crystal shows blue (${cs.anim})`);
  await t.shotCanvas('pegs-blue-up');
  // Walk up through the lowered red pegs.
  await t.eval(() => S().player.place(152, 100, 'up'));
  await t.hold(['ArrowUp'], 500);
  const py = await t.eval(() => S().player.y);
  t.assert(py < 64, `hero walks over lowered pegs (y=${py.toFixed(1)})`);
  // Blue pegs now block the way down.
  await t.eval(() => S().player.place(152, 112, 'down'));
  await t.hold(['ArrowDown'], 500);
  const py2 = await t.eval(() => S().player.y);
  t.assert(py2 <= 122.5, `raised blue pegs block the hero (y=${py2.toFixed(1)})`);
  await t.shotCanvas('blue-pegs-block-hero');
  await t.eval(() => S().findEntity('cs').hurt({ damage: 1, kind: 'arrow', source: null, dx: 0, dy: -1 }));
  await t.wait(100);
  t.assert((await t.eval(() => S().pegState())) === false, 'a second hit after the cooldown flips them back');

  // ---------------------------------------------------------------- torches in a dark room
  await arena(t, {
    theme: 'dungeon', dark: true, player: { x: 128, y: 150, dir: 'up' },
    entities: [
      { id: 't1', type: 'obj.torch', x: 56, y: 56 },
      { id: 't2', type: 'obj.torch', x: 200, y: 56, props: { burnTime: 1 } },
      { id: 'chest', type: 'obj.chest', x: 128, y: 56, props: { item: 'map' } },
    ],
  });
  await t.wait(300);
  const dark = await brightness(t);
  await t.shotCanvas('dark-room-unlit');
  const lit = await t.eval(() => [S().findEntity('t1').ignite(), S().findEntity('t2').ignite(), S().findEntity('t1').ignite()]);
  t.assert(lit[0] && lit[1] && !lit[2], `ignite lights each torch once (${lit})`);
  await t.wait(300);
  const bright = await brightness(t);
  const t1 = await ent(t, 't1');
  t.assert(t1.lit && t1.light === 48 && t1.anim === 'lit', `torch lit with light 48 (${JSON.stringify(t1)})`);
  t.assert(bright > dark + 2, `lit torches brighten the dark room (${dark.toFixed(1)} -> ${bright.toFixed(1)})`);
  await t.shotCanvas('dark-room-lit');
  await t.wait(1000);
  const t2 = await ent(t, 't2');
  t.assert(!t2.lit && t2.anim === 'unlit', `torch with burnTime 1 went out (${JSON.stringify(t2)})`);
  await t.shotCanvas('one-torch-burnt-out');
}
