// Enemies B: eye statue. An invulnerable pillar whose eye sweeps clockwise
// through the eight directions; a hero inside the current view cone with a
// clear line of sight gets a charge flash, then a fast unblockable beam
// (2 half-hearts) at where they stood when it locked on - a quick sidestep
// dodges it - then the statue rests for its cooldown. Walls hide the hero.
// A 'facing' prop sets where the sweep starts; without one, statues in the
// same room start in directions seeded from their ids (no lockstep).

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => {
    const a = window.__qf.game.services.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
}

const eye = (t) => t.eval(() => {
  const e = window.__qf.game.services.findEntity('eye');
  return e ? { dir: e.eyeDir, charging: e.isCharging, solid: e.solid, clear: e.countsForClear, dead: e.dead } : null;
});

/** Start the sweep looking south (the 'facing' prop). */
const SOUTH = { facing: 'down' };

const beams = (t) => t.eval(() => window.__qf.game.services.entities
  .filter((e) => e.sprite === 'proj.beam')
  .map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), vx: Math.round(e.vx), vy: Math.round(e.vy), blockable: e.blockable })));

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  // ---- Hero straight below the statue (facing 'down': the eye starts looking south): flash, beam, hit.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 176, dir: 'up' },
    entities: [{ id: 'eye', type: 'enemy.eye', x: 128, y: 80, props: SOUTH }],
  });
  await t.until(() => window.__qf.game.services.findEntity('eye')?.isCharging, undefined, 2000);
  let e = await eye(t);
  t.log('charging', e);
  t.assert(e.dir === 's', `looking south (${e.dir})`);
  t.assert(e.solid && !e.clear, 'solid, and not needed to clear the room');
  await t.shotCanvas('charge-flash');
  await t.until(() => window.__qf.game.services.entities.some((x) => x.sprite === 'proj.beam'), undefined, 1500);
  const shot = await beams(t);
  t.log('beam', shot);
  t.assert(shot.length === 1 && shot[0].vy > 150 && Math.abs(shot[0].vx) < 2, 'fast beam straight at the hero');
  t.assert(shot[0] && shot[0].blockable === false, 'the shield cannot block the beam');
  await t.shotCanvas('beam');
  await t.until(() => window.__qf.game.services.save.hp < 20, undefined, 1500);
  t.assert((await t.eval(() => window.__qf.game.services.save.hp)) === 18, 'beam takes a whole heart');
  await t.shotCanvas('beam-hit');
  // Cooldown (2 s): no second beam straight away.
  await t.wait(900);
  t.assert((await t.eval(() => window.__sfx.filter((s) => s === 'magic').length)) === 1, 'rests during its cooldown');

  // ---- Locked aim: the hero sidesteps during the charge flash and the beam misses.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 176, dir: 'up' },
    entities: [{ id: 'eye', type: 'enemy.eye', x: 128, y: 80, props: SOUTH }],
  });
  await t.until(() => window.__qf.game.services.findEntity('eye')?.isCharging, undefined, 2000);
  const dodge = t.hold(['ArrowRight'], 380);
  await t.until(() => window.__qf.game.services.entities.some((x) => x.sprite === 'proj.beam'), undefined, 1500);
  const locked = await beams(t);
  await dodge;
  t.log('dodged beam', locked, 'hero x', await t.eval(() => Math.round(window.__qf.game.services.player.x)));
  t.assert(locked[0] && Math.abs(locked[0].vx) < 2 && locked[0].vy > 150, 'the beam keeps the aim it locked on the eye axis');
  await t.wait(150);
  await t.shotCanvas('dodged-beam');
  await t.wait(500);
  t.assert((await t.eval(() => window.__qf.game.services.save.hp)) === 20, 'a sidestep during the flash dodges the beam');

  // ---- A stone wall between them: the eye keeps sweeping and never fires.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 176, dir: 'up' },
    tiles: [{ tx: 1, ty: 8, w: 14, tile: 'DBLOCK' }],
    entities: [{ id: 'eye', type: 'enemy.eye', x: 128, y: 80 }],
  });
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    seen.add((await eye(t)).dir);
    if (i === 8) await t.shotCanvas('sweep-behind-wall');
    await t.wait(220);
  }
  t.log('directions seen', [...seen].join(','));
  t.assert(seen.size >= 6, `the eye sweeps round (${[...seen].join(',')})`);
  t.assert((await beams(t)).length === 0 && (await t.eval(() => window.__qf.game.services.save.hp)) === 20, 'no beam through the wall');

  // ---- Hero up and to the left: the sweep reaches north-west, then it fires diagonally.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 60, y: 40, dir: 'right' },
    entities: [{ id: 'eye', type: 'enemy.eye', x: 128, y: 80, props: SOUTH }],
  });
  await t.wait(700);
  t.assert(!(await eye(t)).charging, 'does not see the hero while looking elsewhere');
  await t.until(() => window.__qf.game.services.findEntity('eye')?.isCharging, undefined, 4000);
  e = await eye(t);
  t.assert(e.dir === 'nw', `spots the hero when the eye reaches north-west (${e.dir})`);
  await t.until(() => window.__qf.game.services.entities.some((x) => x.sprite === 'proj.beam'), undefined, 1500);
  const diag = await beams(t);
  t.log('diagonal beam', diag);
  t.assert(diag[0] && diag[0].vx < -100 && diag[0].vy < -50, 'beam flies up-left at the hero');
  await t.wait(120);
  await t.shotCanvas('diagonal-beam');

  // ---- Weapons glance off.
  const hurt = await t.eval(() => {
    const s = window.__qf.game.services;
    const x = s.findEntity('eye');
    return x.hurt({ damage: 4, kind: 'sword', source: s.player, dx: 1, dy: 0 });
  });
  t.assert(hurt === false && !(await eye(t)).dead, 'invulnerable');
  t.assert((await t.eval(() => window.__sfx.slice())).includes('swordTink'), 'sword tinks off the stone');

  // ---- Two statues without a facing prop, the hero boxed in out of sight: they don't sweep in lockstep.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 24, y: 200, dir: 'up' },
    tiles: [{ tx: 1, ty: 11, w: 3, tile: 'DBLOCK' }, { tx: 3, ty: 12, h: 1, tile: 'DBLOCK' }],
    entities: [{ id: 'kp_r9_eye_1', type: 'enemy.eye', x: 72, y: 72 }, { id: 'kp_r9_eye_2', type: 'enemy.eye', x: 184, y: 120 }],
  });
  const pairs = await t.eval(() => new Promise((done) => {
    const out = [];
    const t0 = performance.now();
    const step = () => {
      const s = window.__qf.game?.services;
      if (s) out.push(`${s.findEntity('kp_r9_eye_1').eyeDir}/${s.findEntity('kp_r9_eye_2').eyeDir}`);
      if (performance.now() - t0 < 2500) requestAnimationFrame(step);
      else done(out.filter((v, i) => i === 0 || v !== out[i - 1]));
    };
    step();
  }));
  t.log('two statues', pairs.join(' '));
  t.assert(pairs.some((p) => p.split('/')[0] !== p.split('/')[1]), `statues look different ways (${pairs.join(' ')})`);
  await t.shotCanvas('two-statues');
}
