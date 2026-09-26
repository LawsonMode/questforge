// Engine e2e: GameServices rules with a throwaway enemy type registered from the
// page — contact damage, knockback & i-frames, enemiesCleared bookkeeping, death
// -> game over -> continue, item-get pose, low-health beep, hidden/shown spawn
// rules, iris warp.
const snap = () => {
  const g = window.__qf.game;
  const s = g.services;
  return {
    state: g.state, room: s.room.def.id, x: s.player.x, y: s.player.y, pstate: s.player.state,
    hp: s.save.hp, invuln: s.player.invuln, deaths: s.save.deaths, count: s.entities.length,
  };
};

async function warp(t, target) {
  await t.eval((tg) => window.__qf.game.warpNow(tg), target);
  await t.wait(80);
}

/** Spawn the dummy enemy at (x, y); returns its id. */
const spawnDummy = (t, x, y) => t.eval(([px, py]) => {
  const s = window.__qf.game.services;
  const e = s.spawn(new window.__QfDummy(s, null));
  e.x = px;
  e.y = py;
  return e.id;
}, [x, y]);

export default async function (t) {
  await t.goto('#/playtest/test');
  // Full reloads mid-run (e.g. the dev server reacting to file edits) reset the game; count them for the report.
  let reloads = 0;
  t.page.on('load', () => { reloads++; });
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(async () => {
    const { Entity } = await import('/src/game/entity.ts');
    const { registerEntity } = await import('/src/game/registry.ts');
    class Dummy extends Entity {
      constructor(game, inst) {
        super(game, inst, 'test.dummy');
        this.team = 'enemy';
        this.contactDamage = 1;
        this.countsForClear = true;
        this.sprite = 'enemy.slime';
        this.anim = 'idle';
      }
    }
    window.__QfDummy = Dummy;
    registerEntity('test.dummy', (game, inst) => new Dummy(game, inst));
    const a = window.__qf.game.services.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
  t.allowConsole(/no behaviour registered/);

  // ---- Contact damage, knockback away from the enemy, i-frames.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 128, y: 150, dir: 'right' });
  const id = await spawnDummy(t, 138, 150);
  await t.wait(260);
  // Read the state before the screenshot: a slow screenshot would eat into the i-frames.
  let s = await t.eval(snap);
  await t.shotCanvas('hit');
  t.log('after contact', s);
  t.assert(s.hp === 5, `contact damage takes half a heart (hp=${s.hp})`);
  t.assert(s.x < 118, `knocked back away from the enemy (x=${s.x.toFixed(1)})`);
  t.assert(s.invuln > 0.5, `i-frames running (${s.invuln.toFixed(2)})`);
  await t.hold('ArrowRight', 150);
  s = await t.eval(snap);
  t.assert(s.hp === 5, `no damage during i-frames (hp=${s.hp})`);
  const sfx = await t.eval(() => window.__sfx.slice());
  t.assert(sfx.includes('hurt'), `hurt sound played (${sfx.join(',')})`);

  // ---- enemiesCleared bookkeeping.
  const cleared = await t.eval((eid) => {
    const sv = window.__qf.game.services;
    const before = sv.enemiesRemaining();
    sv.findEntity(eid).hurt({ damage: 9, kind: 'sword', source: sv.player, dx: 1, dy: 0 });
    return { before, after: sv.enemiesRemaining(), cleared: sv.enemiesCleared() };
  }, id);
  t.assert(cleared.before === 1 && cleared.after === 0 && cleared.cleared, `enemiesCleared tracks defeats (${JSON.stringify(cleared)})`);
  await t.wait(60);
  await t.shotCanvas('enemy-poof');

  // ---- Low-health beep (every ~0.8 s at <= 1 heart).
  await t.eval(() => { window.__qf.game.services.save.hp = 2; window.__sfx.length = 0; });
  await t.wait(1900);
  const beeps = await t.eval(() => window.__sfx.filter((x) => x === 'lowHealth').length);
  t.assert(beeps >= 2 && beeps <= 3, `low-health beep about every 0.8 s (${beeps} in 1.9 s)`);

  // ---- Death -> game over -> continue (the stub game-over screen continues at once).
  await t.eval(() => { window.__qf.game.services.save.hp = 1; window.__qf.game.services.player.invuln = 0; });
  await warp(t, { world: 'ow', room: 'ow_lake', x: 60, y: 150, dir: 'right' });
  await spawnDummy(t, 66, 150);
  await t.until(() => window.__qf.game.services.player.state === 'dead', undefined, 2000);
  await t.wait(300);
  await t.shotCanvas('dying');
  await t.until(() => window.__qf.game.services.save.deaths === 1, undefined, 4000);
  for (let i = 0; i < 20 && (await t.eval(() => window.__qf.game.state)) === 'gameOver'; i++) {
    await t.shotCanvas('game-over');
    await t.press('Enter');
    await t.wait(300);
  }
  await t.until(() => window.__qf.game.state === 'playing', undefined, 4000);
  s = await t.eval(snap);
  t.log('after continue', s);
  t.assert(s.hp === 6 && s.deaths === 1, `continue restores hearts (hp=${s.hp}, deaths=${s.deaths})`);
  t.assert(s.room === 'ow_meadow' && s.pstate === 'normal', `respawned at save.respawn (${s.room}, ${s.pstate})`);

  // ---- Item get pose.
  await t.eval(() => window.__qf.game.services.giveItem('bow', 1, { fanfare: true }));
  await t.wait(50);
  const pose = await t.eval(() => window.__qf.game.services.player.state);
  const state = await t.eval(() => window.__qf.game.state);
  t.assert(pose === 'itemGet', `item-get pose (${pose}, game ${state})`);
  await t.shotCanvas('item-get');
  for (let i = 0; i < 10 && (await t.eval(() => window.__qf.game.state)) === 'dialogue'; i++) {
    await t.press('KeyX');
    await t.wait(300);
  }
  await t.until(() => window.__qf.game.services.player.state === 'normal', undefined, 3000);
  t.assert(await t.eval(() => window.__qf.game.services.hasItem('bow')), 'bow owned after giveItem');

  // ---- Hidden / shown / hidden-by-trigger spawn rules.
  await t.eval(() => {
    const room = window.__qf.game.services.room.def;
    room.entities.push({ id: 'dummy_hidden', type: 'test.dummy', x: 40, y: 60, props: { hidden: true } });
  });
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 128, y: 150, dir: 'down' });
  const rules = await t.eval(async () => {
    const sv = window.__qf.game.services;
    const out = { initially: !!sv.findEntity('dummy_hidden') };
    sv.showEntity('dummy_hidden');
    out.shown = !!sv.findEntity('dummy_hidden');
    sv.hideEntity('dummy_hidden');
    await new Promise((r) => setTimeout(r, 100));
    out.hidden = !!sv.findEntity('dummy_hidden');
    window.__qf.game.warpNow({ world: 'ow', room: 'ow_meadow', x: 128, y: 150 });
    out.afterReentry = !!sv.findEntity('dummy_hidden');
    sv.showEntity('dummy_hidden');
    window.__qf.game.warpNow({ world: 'ow', room: 'ow_meadow', x: 128, y: 150 });
    out.shownAfterReentry = !!sv.findEntity('dummy_hidden');
    return out;
  });
  t.assert(JSON.stringify(rules) === JSON.stringify({ initially: false, shown: true, hidden: false, afterReentry: false, shownAfterReentry: true }),
    `spawn rules ${JSON.stringify(rules)}`);

  // ---- Effects expire; unknown drops are harmless.
  const fx = await t.eval(async () => {
    const sv = window.__qf.game.services;
    const n0 = sv.entities.length;
    sv.effect('fx.poof', 'play', 100, 100);
    const n1 = sv.entities.length;
    await new Promise((r) => setTimeout(r, 700));
    return { n0, n1, n2: sv.entities.length };
  });
  t.assert(fx.n1 === fx.n0 + 1 && fx.n2 === fx.n0, `effect spawns then removes itself (${JSON.stringify(fx)})`);

  // ---- Iris warp.
  await t.eval(() => window.__qf.game.services.warp({ world: 'dg', room: 'dg_entry', x: 128, y: 184, dir: 'up' }, 'iris'));
  await t.until(() => window.__qf.game.state === 'transition', undefined, 2000);
  await t.wait(220);
  await t.shotCanvas('iris-closing');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  s = await t.eval(snap);
  t.assert(s.room === 'dg_entry', `iris warp arrived (${s.room})`);

  // ---- An entity that throws stops the loop with a message on the canvas (last: the game stays stopped).
  t.allowConsole(/stopped after an error/);
  await t.eval(() => {
    const sv = window.__qf.game.services;
    const e = sv.spawn(new window.__QfDummy(sv, null));
    e.contactDamage = 0;
    e.update = () => { throw new Error('test entity exploded'); };
  });
  await t.wait(200);
  const stoppedAt = await t.eval(() => window.__qf.game.services.time);
  await t.wait(200);
  t.assert(await t.eval((t0) => window.__qf.game.services.time === t0, stoppedAt), 'loop stops after an uncaught error');
  await t.shotCanvas('game-stopped');
  t.log('page reloads during the run', reloads);
}
