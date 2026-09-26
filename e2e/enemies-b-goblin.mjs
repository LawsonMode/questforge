// Enemies B: spear goblin. Wanders along the four axes; lined up with the hero
// within ~6 tiles it plants its feet (throw pose) and hurls a spear (2 half-hearts,
// blockable by the shield), then stands a moment; a sword hit while it aims breaks
// the stance; contact damage 2; takes 4 hits.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

const gob = (t) => t.eval(() => {
  const e = window.__qf.game.services.findEntity('gob');
  return e ? { x: e.x, y: e.y, phase: e.phase, facing: e.facing, anim: e.anim, hp: e.hp, contact: e.contactDamage } : null;
});

const spears = (t) => t.eval(() => window.__qf.game.services.entities
  .filter((e) => e.sprite === 'proj.spear')
  .map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), vx: e.vx, vy: e.vy, anim: e.anim, deflected: e.isDeflected })));

/** Per-frame positions of entity `id` for `ms` real milliseconds. */
const track = (t, id, ms) => t.eval(({ eid, dur }) => new Promise((done) => {
  const out = [];
  const t0 = performance.now();
  const step = () => {
    const e = window.__qf.game?.services.findEntity(eid);
    if (e) out.push({ x: e.x, y: e.y });
    if (performance.now() - t0 < dur) requestAnimationFrame(step);
    else done(out);
  };
  step();
}), { eid: id, dur: ms });

const hp = (t) => t.eval(() => window.__qf.game.services.save.hp);

/** Per-frame "phase:anim:spears" of the goblin for `ms` real milliseconds (changes only). */
const trace = (t, ms) => t.eval((dur) => new Promise((done) => {
  const out = [];
  const t0 = performance.now();
  const step = () => {
    const s = window.__qf.game?.services;
    const e = s?.findEntity('gob');
    const v = e ? `${e.phase}:${e.anim}:${s.entities.filter((x) => x.sprite === 'proj.spear').length}` : 'gone';
    if (out.at(-1)?.v !== v) out.push({ v, t: Math.round(performance.now() - t0) });
    if (performance.now() - t0 < dur) requestAnimationFrame(step);
    else done(out);
  };
  step();
}), ms);

/**
 * Stop the game loop on the first frame that shows a shield-deflected spear (it blinks and
 * falls away within half a second), so a screenshot can catch it; resolves to the spear's
 * state, or null if none was deflected within 3 s. Restart with window.__qf.game.start().
 */
const freezeOnDeflect = (t) => t.eval(() => new Promise((done) => {
  const game = window.__qf.game;
  const t0 = performance.now();
  const step = () => {
    const e = game.services.entities.find((x) => x.sprite === 'proj.spear' && x.isDeflected);
    const drawn = e && !(e.invuln > 0 && e.hitFlash <= 0 && Math.floor(e.invuln * 30) % 2 === 0);
    if (drawn) {
      game.stop();
      done({ x: Math.round(e.x), y: Math.round(e.y), vx: Math.round(e.vx), z: Math.round(e.z) });
    } else if (performance.now() - t0 > 3000) done(null);
    else requestAnimationFrame(step);
  };
  step();
}));

/** Direct sword-strength hit from the hero's side (exact hit counting, no swing timing). */
const hit = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  const e = s.findEntity('gob');
  return e ? e.hurt({ damage: 1, kind: 'sword', source: s.player, dx: 1, dy: 0 }) : false;
});

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  // ---- Wander: hero far away in a corner -> walks along the axes, never throws.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 32, y: 32, dir: 'down' },
    entities: [{ id: 'gob', type: 'enemy.goblin', x: 200, y: 170 }],
  });
  const path = await track(t, 'gob', 2000);
  await t.shotCanvas('wander');
  const end = path.at(-1);
  const steps = path.slice(1).map((p, i) => ({ dx: Math.abs(p.x - path[i].x), dy: Math.abs(p.y - path[i].y) }));
  const moving = steps.filter((d) => d.dx + d.dy > 0.05);
  const axial = moving.filter((d) => d.dx < 0.05 || d.dy < 0.05).length / Math.max(1, moving.length);
  t.log('wander', `${path.length} frames, ${moving.length} moving, ${(axial * 100).toFixed(0)}% axial, end ${end.x.toFixed(0)},${end.y.toFixed(0)}`);
  t.assert(moving.length > 30, 'goblin walks around');
  t.assert(axial >= 0.85, 'goblin walks along one axis at a time');
  t.assert((await spears(t)).length === 0, 'no spear without a line to the hero');
  t.assert((await gob(t)).hp === 4, `4 HP (${(await gob(t)).hp})`);

  // ---- Lined up (5 tiles, same row): plants its feet, throws; the spear hits for 2.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 176, y: 112, dir: 'up' },
    entities: [{ id: 'gob', type: 'enemy.goblin', x: 96, y: 112, props: { facing: 'down' } }],
  });
  await t.until(() => window.__qf.game.services.findEntity('gob')?.phase === 'aim', undefined, 3000);
  let g = await gob(t);
  t.log('aim', g);
  t.assert(g.facing === 'right' && g.anim === 'throw_right', `throw pose toward the hero (${g.facing}, ${g.anim})`);
  await t.shotCanvas('aim');
  const planted = { x: g.x, y: g.y };
  await t.until(() => window.__qf.game.services.entities.some((e) => e.sprite === 'proj.spear'), undefined, 2000);
  const flying = await spears(t);
  g = await gob(t);
  t.log('spear', flying);
  t.assert(flying.length === 1 && flying[0].vx > 100 && flying[0].vy === 0 && flying[0].anim === 'right', 'spear flies right');
  t.assert(g.x === planted.x && g.y === planted.y, 'feet stay planted while throwing');
  t.assert(g.phase === 'recover' && g.anim === 'walk_right', `stands (no second raised spear) while it flies (${g.phase}, ${g.anim})`);
  await t.shotCanvas('spear-flight');
  await t.until(() => window.__qf.game.services.save.hp < 20, undefined, 2000);
  t.assert((await hp(t)) === 18, `spear takes a whole heart (hp=${await hp(t)})`);
  await t.shotCanvas('spear-hit');

  // ---- Facing the goblin: the shield deflects the spear, which bounces back and falls away.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 176, y: 112, dir: 'left' },
    entities: [{ id: 'gob', type: 'enemy.goblin', x: 96, y: 112, props: { facing: 'down' } }],
  });
  await t.until(() => window.__qf.game.services.entities.some((e) => e.sprite === 'proj.spear'), undefined, 3000);
  const deflected = await freezeOnDeflect(t);
  t.log('deflected', deflected);
  await t.shotCanvas('shield-deflect');
  await t.eval(() => window.__qf.game.start());
  t.assert(deflected && deflected.vx < 0, `the shield deflects the spear (${JSON.stringify(deflected)})`);
  t.assert((await hp(t)) === 20, `shield block costs no health (hp=${await hp(t)})`);

  // ---- A real sword hit while it aims breaks the stance: back to walking, no spear for a while.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 176, y: 112, dir: 'left' },
    entities: [{ id: 'gob', type: 'enemy.goblin', x: 96, y: 112, props: { facing: 'down' } }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await t.until(() => window.__qf.game.services.findEntity('gob')?.phase === 'aim', undefined, 3000);
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('gob');
    s.player.place(e.x + 20, e.y, 'left');
  });
  await t.press('KeyZ', 40);
  const states = await trace(t, 700);
  t.log('stance', states.map((x) => `${x.t}ms ${x.v}`).join(' | '));
  t.assert((await gob(t)).hp === 3, `the sword landed (hp ${(await gob(t)).hp})`);
  t.assert(states.some((x) => x.v.startsWith('walk:')), 'the hit knocks it out of its throw stance');
  t.assert(states.every((x) => !x.v.endsWith(':1')), 'no point-blank spear right after the hit');

  // ---- Contact damage 2 (whole heart), then four hits kill it.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 150, dir: 'up' },
    entities: [{ id: 'gob', type: 'enemy.goblin', x: 128, y: 144 }],
  });
  await t.wait(650);
  t.assert((await hp(t)) === 18, `contact takes a whole heart (hp=${await hp(t)})`);
  await t.eval(() => { const s = window.__qf.game.services; s.player.place(40, 40, 'down'); });
  for (let i = 1; i <= 3; i++) {
    t.assert(await hit(t), `hit ${i} lands`);
    await t.wait(400);
  }
  g = await gob(t);
  t.assert(g && g.hp === 1, `alive with 1 HP after three hits (${g?.hp})`);
  await hit(t);
  await t.wait(100);
  t.assert(!(await gob(t)), 'removed after the fourth hit');
  await t.shotCanvas('defeated');
}
