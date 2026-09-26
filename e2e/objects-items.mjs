// Objects x the hero's real items: a placed bomb blows open a bombable wall and
// flips a crystal switch, the lantern flame lights a torch (ignite), arrows strike
// a crystal switch, the boomerang fetches a key pickup (collect), and the hookshot
// latches onto a chest (hookable) and pulls the hero over.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  // Page-side shorthand used inside t.eval callbacks.
  await t.eval(() => { window.S = () => window.__qf.game.services; });
  await t.wait(150);
}

const equip = (t, item) => t.eval((i) => { S().save.equipped = i; }, item);

/**
 * Other agents saving files mid-run make Vite full-reload the page; mock its HMR
 * socket for this page (kept open, no server) so the scenario can't be reloaded.
 */
const isolateFromHmr = (t) => t.page.routeWebSocket(() => true, () => {});

export default async function (t) {
  await isolateFromHmr(t);
  // ---------------------------------------------------------------- bomb vs bombable wall + crystal
  await arena(t, {
    theme: 'dungeon', player: { x: 222, y: 112, dir: 'right' }, items: { bombs: 5 },
    entities: [
      { id: 'crack', type: 'obj.door', x: 248, y: 112, props: { dir: 'right', kind: 'bombable' } },
      { id: 'cs', type: 'obj.crystalSwitch', x: 232, y: 136 },
      { id: 'chest', type: 'obj.chest', x: 232, y: 88, props: { item: 'map' } },
    ],
  });
  await equip(t, 'bombs');
  await t.press('KeyC', 60);
  await t.wait(100);
  const placed = await t.eval(() => S().entities.some((e) => e.type === 'bomb'));
  t.assert(placed, 'a bomb was placed');
  await t.hold(['ArrowLeft'], 700);
  await t.shotCanvas('bomb-fuse');
  await t.until(() => !S().entities.some((e) => e.type === 'bomb'), undefined, 3000).catch(() => {});
  await t.wait(80);
  await t.shotCanvas('bomb-exploded');
  await t.wait(400);
  const res = await t.eval(() => ({
    door: S().findEntity('crack').isOpen, pegs: S().pegState(), chest: !!S().findEntity('chest'), chestOpen: S().findEntity('chest')?.isOpen,
  }));
  t.assert(res.door, `the bomb blast opened the cracked wall (${JSON.stringify(res)})`);
  t.assert(res.pegs === true, 'the bomb blast flipped the crystal switch');
  t.assert(res.chest && !res.chestOpen, 'the chest in the blast is unharmed and still closed');
  await t.shotCanvas('wall-bombed-open');

  // ---------------------------------------------------------------- lantern vs torch, arrows vs crystal
  await arena(t, {
    theme: 'dungeon', dark: true, player: { x: 128, y: 78, dir: 'up' }, items: { lantern: 1, bow: 1, arrows: 10 },
    entities: [
      { id: 'torch', type: 'obj.torch', x: 128, y: 56 },
      { id: 'cs', type: 'obj.crystalSwitch', x: 200, y: 150 },
      { id: 'peg', type: 'obj.peg', x: 56, y: 150, props: { color: 'blue' } },
    ],
  });
  await equip(t, 'lantern');
  await t.press('KeyC', 60);
  await t.wait(500);
  const torch = await t.eval(() => ({ lit: S().findEntity('torch').lit, light: S().findEntity('torch').light }));
  t.assert(torch.lit && torch.light === 48, `the lantern flame lit the torch (${JSON.stringify(torch)})`);
  await t.shotCanvas('lantern-lit-torch');
  await equip(t, 'bow');
  await t.eval(() => S().player.place(120, 150, 'right'));
  await t.wait(100);
  await t.press('KeyC', 60);
  await t.wait(700);
  const arrow = await t.eval(() => ({ pegs: S().pegState(), peg: S().findEntity('peg').raised, arrows: S().save.arrows }));
  t.assert(arrow.arrows === 9 && arrow.pegs === true && arrow.peg === true, `an arrow flipped the crystal switch (${JSON.stringify(arrow)})`);
  await t.shotCanvas('arrow-hit-crystal');

  // ---------------------------------------------------------------- boomerang fetch, hookshot to a chest
  await arena(t, {
    theme: 'dungeon', player: { x: 40, y: 112, dir: 'right' }, items: { boomerang: 1, hookshot: 1 },
    entities: [
      { id: 'key', type: 'obj.pickup', x: 120, y: 112, props: { item: 'smallKey', amount: 1 } },
      { id: 'chest', type: 'obj.chest', x: 128, y: 40, props: { item: 'rupees', amount: 5 } },
    ],
  });
  await equip(t, 'boomerang');
  await t.press('KeyC', 60);
  await t.wait(1400);
  const fetched = await t.eval(() => ({ keys: S().dungeon.keys, key: !!S().findEntity('key'), flag: S().flag('pickup:key') }));
  t.assert(fetched.keys === 1 && !fetched.key && fetched.flag, `the boomerang fetched the key (${JSON.stringify(fetched)})`);
  await equip(t, 'hookshot');
  await t.eval(() => S().player.place(128, 130, 'up'));
  await t.wait(100);
  await t.press('KeyC', 60);
  await t.wait(250);
  await t.shotCanvas('hookshot-latched');
  await t.wait(1200);
  const pulled = await t.eval(() => ({ y: S().player.y, st: S().player.state }));
  t.assert(pulled.y < 80, `the hookshot latched onto the chest and pulled the hero (${JSON.stringify(pulled)})`);
  await t.shotCanvas('hookshot-pulled');
}
