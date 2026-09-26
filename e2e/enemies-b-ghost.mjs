// Enemies B: ghost. Drifts through walls toward the hero with a sine wobble and
// cycles visible (2.5 s) -> fading -> nearly invisible (1.5 s: untouchable and
// harmless, arrows fly through) -> fading in. 2 HP, contact damage 1 while
// visible; killed over a wall, its loot lands on the floor nearby.

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
}

const ghost = (t) => t.eval(() => {
  const e = window.__qf.game.services.findEntity('gh');
  return e ? { x: e.x, y: e.y, phase: e.phase, tangible: e.tangible, contact: e.contactDamage, hp: e.hp } : null;
});

/** Per-frame { x, y, phase } of the ghost for `ms` real milliseconds. */
const track = (t, ms) => t.eval((dur) => new Promise((done) => {
  const out = [];
  const t0 = performance.now();
  const step = () => {
    const e = window.__qf.game?.services.findEntity('gh');
    if (e) out.push({ x: e.x, y: e.y, phase: e.phase });
    if (performance.now() - t0 < dur) requestAnimationFrame(step);
    else done(out);
  };
  step();
}), ms);

const phaseIs = (t, phase, ms) => t.until((p) => window.__qf.game.services.findEntity('gh')?.phase === p, phase, ms);

const hit = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  return s.findEntity('gh').hurt({ damage: 1, kind: 'sword', source: s.player, dx: 0, dy: -1 });
});

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  // ---- Drifts down through a stone wall toward the hero, wobbling side to side.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 184, dir: 'up' },
    tiles: [{ tx: 1, ty: 6, w: 14, tile: 'DBLOCK' }],
    entities: [{ id: 'gh', type: 'enemy.ghost', x: 128, y: 56 }],
  });
  const path = await track(t, 3500);
  const end = path.at(-1);
  const wobble = Math.max(...path.map((p) => Math.abs(p.x - 128)));
  const phases = [...new Set(path.map((p) => p.phase))];
  t.log('drift', `y 56 -> ${end.y.toFixed(1)}, wobble ${wobble.toFixed(1)} px, phases ${phases.join(',')}`);
  t.assert(end.y > 112, `passed through the wall (y ${end.y.toFixed(1)})`);
  t.assert(wobble > 1.5, `wobbles sideways (${wobble.toFixed(1)} px)`);
  await t.shotCanvas('through-wall');

  // ---- The visibility cycle: faded = untouchable & harmless, visible = hittable.
  // The hero stays invulnerable here (the ghost drifts onto them), so the touch check below starts clean.
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  // From the fade-out, so the checks land early in the invisible phase (the drift may end late in one).
  await phaseIs(t, 'fadeOut', 6000);
  await phaseIs(t, 'invisible', 1000);
  await t.wait(100);
  let g = await ghost(t);
  t.log('invisible', g);
  t.assert(g.phase === 'invisible' && !g.tangible && g.contact === 0, `harmless while faded (${g.phase})`);
  t.assert((await hit(t)) === false, 'weapons pass through it while faded');
  await t.shotCanvas('invisible');
  await phaseIs(t, 'fadeIn', 2000);
  await t.wait(250);
  await t.shotCanvas('fading-in');
  await phaseIs(t, 'visible', 1000);
  g = await ghost(t);
  t.assert(g.tangible && g.contact === 1, 'solid again once visible');
  await t.shotCanvas('visible');
  t.assert((await hit(t)) === true, 'hit lands while visible');
  await t.wait(400);
  t.assert((await ghost(t)).hp === 1, '2 HP');

  // ---- Touching the hero while visible costs half a heart (from a clean baseline).
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('gh');
    s.save.hp = 20;
    s.debug.invincible = false;
    s.player.place(Math.min(220, Math.max(36, e.x)), Math.min(190, e.y + 22), 'up');
  });
  await t.until(() => window.__qf.game.services.save.hp < 20, undefined, 6000);
  // The hero's i-frames outlast this short wait, so exactly one touch counts.
  await t.wait(100);
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 19, `ghost touch costs half a heart (hp=${hp})`);
  await t.shotCanvas('touch');

  // ---- Second hit (when visible) finishes it.
  await phaseIs(t, 'visible', 6000);
  await hit(t);
  await t.wait(100);
  t.assert(!(await ghost(t)), 'gone after its second hit');

  // ---- A real arrow flies straight through a faded ghost.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 40, y: 190, dir: 'up' },
    entities: [{ id: 'gh', type: 'enemy.ghost', x: 128, y: 100 }],
  });
  await phaseIs(t, 'invisible', 6000);
  await t.wait(100);
  const arrow = await t.eval(async () => {
    const s = window.__qf.game.services;
    const { Arrow } = await import('/src/game/projectiles/arrow.ts');
    const g = s.findEntity('gh');
    const a = s.spawn(new Arrow(s, g.x, g.y + 40, 'up'));
    const gy = g.y;
    return await new Promise((done) => {
      const step = () => {
        if (a.dead || a.stuck || a.y < gy - 24) done({ gy, ay: Math.round(a.y), dead: a.dead, hp: g.hp });
        else requestAnimationFrame(step);
      };
      step();
    });
  });
  t.log('arrow vs faded ghost', arrow);
  t.assert(arrow.ay < arrow.gy - 20 && arrow.hp === 2, `the arrow passes through (${JSON.stringify(arrow)})`);
  await t.shotCanvas('arrow-through');

  // ---- Killed while floating over a stone wall: the loot lands on the floor.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 40, y: 190, dir: 'up' },
    tiles: [{ tx: 1, ty: 5, w: 14, tile: 'DBLOCK' }],
    entities: [{ id: 'gh', type: 'enemy.ghost', x: 128, y: 88, props: { drop: 'rupee5' } }],
  });
  await t.until(() => window.__qf.game.services.findEntity('gh')?.tangible, undefined, 6000);
  const loot = await t.eval(async () => {
    const s = window.__qf.game.services;
    const g = s.findEntity('gh');
    g.x = 128;
    g.y = 88;
    g.hurt({ damage: 2, kind: 'arrow', source: s.player, dx: 0, dy: -1, knockback: 0 });
    await new Promise((r) => setTimeout(r, 100));
    return s.entities.filter((e) => e.type === 'obj.pickup').map((e) => ({ x: e.x, y: e.y, c: s.room.collisionAt(e.x, e.y) }));
  });
  t.log('loot', loot);
  t.assert(loot.length === 1 && loot[0].c !== 'solid', `loot on walkable ground (${JSON.stringify(loot)})`);
  await t.shotCanvas('loot-beside-wall');

  // ---- The real sword: a visible ghost takes the hit, a faded one lets the blade pass (no tink).
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 130, dir: 'up' },
    entities: [{ id: 'gh', type: 'enemy.ghost', x: 128, y: 114 }],
  });
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    const g = s.findEntity('gh');
    g.wakeT = 99; // hold it in place (the fade cycle still runs)
    g.cycleT = 0;
    const a = s.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
  await t.wait(100);
  await t.press('KeyZ', 50);
  await t.wait(400);
  t.assert((await ghost(t)).hp === 1, 'the real sword hits a visible ghost');
  await t.eval(() => {
    const g = window.__qf.game.services.findEntity('gh');
    g.x = 128;
    g.y = 114;
    g.cycleT = 3.3;
    window.__sfx.length = 0;
  });
  await t.wait(100);
  await t.press('KeyZ', 50);
  await t.wait(100);
  await t.shotCanvas('sword-through-faded');
  await t.wait(300);
  const faded = await t.eval(() => ({ hp: window.__qf.game.services.findEntity('gh').hp, sfx: window.__sfx.slice() }));
  t.log('sword vs faded ghost', faded);
  t.assert(faded.hp === 1 && faded.sfx.includes('sword') && !faded.sfx.includes('swordTink'), `the blade passes a faded ghost without a tink (${JSON.stringify(faded)})`);
}
