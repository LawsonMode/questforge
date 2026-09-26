// Enemies B: snake. Slithers about at random with short pauses; when the hero
// shares its row or column within 5 tiles with a clear view it dashes fast in a
// straight line until it hits a wall. 1 HP, contact damage 1.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

const snake = (t) => t.eval(() => {
  const e = window.__qf.game.services.findEntity('sn');
  return e ? { x: e.x, y: e.y, top: e.top, phase: e.phase, facing: e.facing, anim: e.anim } : null;
});

/** Per-frame { x, y, phase } of the snake for `ms` real milliseconds. */
const track = (t, ms) => t.eval((dur) => new Promise((done) => {
  const out = [];
  const t0 = performance.now();
  const step = () => {
    const e = window.__qf.game?.services.findEntity('sn');
    if (e) out.push({ x: e.x, y: e.y, phase: e.phase });
    if (performance.now() - t0 < dur) requestAnimationFrame(step);
    else done(out);
  };
  step();
}), ms);

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  // ---- Hero far away: random slithering with pauses, never a dash.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 32, y: 32, dir: 'down' },
    entities: [{ id: 'sn', type: 'enemy.snake', x: 180, y: 160 }],
  });
  const roam = await track(t, 2500);
  await t.shotCanvas('slither');
  const phases = new Set(roam.map((p) => p.phase));
  const far = Math.max(...roam.map((p) => Math.hypot(p.x - 180, p.y - 160)));
  t.log('roam', [...phases].join(','), `max ${far.toFixed(0)} px from spawn`);
  t.assert(far > 16, 'slithers around');
  t.assert(phases.has('slither') && phases.has('pause'), 'slithers in bursts with pauses');
  t.assert(!phases.has('dash'), 'no dash without a line to the hero');

  // ---- Same column, 4 tiles away: dashes straight up through the hero to the wall.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('sn');
    e.x = 128;
    e.y = 150;
    s.player.place(128, 86, 'left');
  });
  await t.until(() => window.__qf.game.services.findEntity('sn')?.phase === 'dash', undefined, 2000);
  let e = await snake(t);
  t.log('dash', e);
  t.assert(e.facing === 'up', `dashes toward the hero (${e.facing})`);
  await t.wait(120);
  await t.shotCanvas('dash');
  await t.until(() => window.__qf.game.services.findEntity('sn')?.phase === 'rest', undefined, 2000);
  e = await snake(t);
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.log('rest', e, 'hp', hp);
  t.assert(Math.abs(e.x - 128) < 0.5, `straight line (x ${e.x})`);
  t.assert(Math.abs(e.top - 16) < 0.5, `stopped at the top wall (top ${e.top})`);
  t.assert(hp === 19, `the dash hit the hero for half a heart (hp=${hp})`);
  await t.shotCanvas('hit-wall');

  // ---- Lined up but behind a stone wall: never dashes.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 40, dir: 'down' },
    tiles: [{ tx: 1, ty: 4, w: 14, tile: 'DBLOCK' }],
    entities: [{ id: 'sn', type: 'enemy.snake', x: 128, y: 104 }],
  });
  const hidden = await track(t, 2000);
  t.assert(!hidden.some((p) => p.phase === 'dash'), 'no dash through a wall');
  await t.shotCanvas('behind-wall');

  // ---- One real sword hit kills it.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const x = s.findEntity('sn');
    x.wakeT = 99; // hold it still for the swing
    x.x = 128;
    x.y = 104;
    s.debug.invincible = true;
    s.player.place(128, 88, 'down');
  });
  await t.wait(50);
  await t.press('KeyZ', 50);
  await t.wait(400);
  t.assert(!(await snake(t)), '1 HP: one sword hit');
  await t.shotCanvas('sword-kill');
}
