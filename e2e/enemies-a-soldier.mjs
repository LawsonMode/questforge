// Enemies A: soldier. Spawn grace (no instant contact hit); patrol notices the
// hero within 5 tiles in view -> alert beat ("!" + hop) -> chase at 1.4x; guard
// holds its post until the hero shows up in front; red deals a whole heart; the
// real boomerang stuns and freezes it; a swing into its thrust clashes (clink, no
// damage, both pushed apart - never into a pit), then its guard drops and the
// next swing lands; killed by the sword -> poof + a drop on the floor.

// ---------------------------------------------------------------- helpers (shared shape across enemies-a-*)
async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => {
    const s = window.__qf.game.services;
    window.__sfx = [];
    window.__drops = [];
    window.__fx = [];
    window.__pickups = [];
    if (!s.audio.__recorded) {
      s.audio.__recorded = true;
      const sfx = s.audio.sfx.bind(s.audio);
      s.audio.sfx = (id, o) => { window.__sfx.push(id); sfx(id, o); };
    }
    const spawn = s.spawn.bind(s);
    s.spawn = (e) => { if (e.type === 'obj.pickup') window.__pickups.push(e); return spawn(e); };
    const drop = s.dropLoot.bind(s);
    s.dropLoot = (x, y, k) => {
      window.__drops.push(k ?? 'random');
      drop(x, y, k);
      // swordKill: step the hero back (or aside) so the still-sweeping blade leaves the drop on the floor.
      const p = s.player;
      const spot = window.__keepDrop && [[0, 24], [-28, 0], [28, 0]].find(([dx, dy]) => s.room.collisionAt(p.x + dx, p.y + dy) === 'floor');
      if (spot) p.place(p.x + spot[0], p.y + spot[1], p.facing);
    };
    const fx = s.effect.bind(s);
    s.effect = (sp, an, x, y, o) => { window.__fx.push(sp); fx(sp, an, x, y, o); };
  });
}

const waitFor = (t, fn, arg, ms = 5000) => t.page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

const info = (t, id) => t.eval((eid) => {
  const e = window.__qf.game.services.findEntity(eid);
  return e ? { x: +e.x.toFixed(1), y: +e.y.toFixed(1), z: +e.z.toFixed(1), hp: e.hp, st: e.aiState, anim: e.anim, facing: e.facing, contact: e.contactDamage, palette: e.palette ?? null } : null;
}, id);

/** Real sword swings from below while a stun holds the enemy still (each swing must start). Returns the swings used. */
async function swordKill(t, id, maxSwings = 8) {
  await t.eval(() => {
    window.__keepDrop = true;
    window.__invWas = window.__qf.game.services.debug.invincible;
  });
  let swings = 0;
  for (; swings < maxSwings; swings++) {
    const alive = await t.eval((eid) => {
      const s = window.__qf.game.services;
      const e = s.findEntity(eid);
      if (!e || e.dead) return false;
      e.stun = 0.8;
      s.player.place(e.x, e.y + 18, 'up');
      // Debug invincibility, not i-frames: no contact hits and no flicker hiding the hero in screenshots.
      s.debug.invincible = true;
      return true;
    }, id);
    if (!alive) break;
    await t.press('KeyZ', 60);
    await t.wait(40);
    // A killing blow may already have stepped the hero back (arena's dropLoot hook).
    const swung = await t.eval((eid) => {
      const s = window.__qf.game.services;
      return s.player.state === 'attack' || !s.findEntity(eid);
    }, id);
    t.assert(swung, `${id}: sword swing ${swings + 1} starts`);
    if (!swung) break;
    await t.wait(320);
  }
  await t.eval(() => {
    window.__keepDrop = false;
    window.__qf.game.services.debug.invincible = window.__invWas;
  });
  return swings;
}

/** Pickup item and amount each named drop kind leaves on the floor. */
const DROP_ITEMS = {
  rupee: ['rupees', 1], rupee5: ['rupees', 5], rupee20: ['rupees', 20], heart: ['heart', 1],
  bombs: ['bombs', 4], arrows: ['arrows', 10], magic: ['magic', 16], smallKey: ['smallKey', 1],
};

/** After swordKill: gone, death sound, poof, the expected drop kind, and that drop on the floor (checkPickup). */
async function checkDeath(t, id, drop) {
  const st = await t.eval((eid) => ({
    alive: !!window.__qf.game.services.findEntity(eid), sfx: window.__sfx.slice(), fx: window.__fx.slice(), drops: window.__drops.slice(),
  }), id);
  t.assert(!st.alive, `${id} removed after its last hit`);
  t.assert(st.sfx.includes('enemyDie'), `${id}: death sound`);
  t.assert(st.fx.includes('fx.poof'), `${id}: death poof`);
  t.assert(st.drops.includes(drop), `${id}: drops ${drop} (${st.drops.join(',')})`);
  await checkPickup(t, id, drop);
}

/** The latest loot pickup matches `drop`, rests on the floor (screenshot), and walking onto it collects it. */
async function checkPickup(t, id, drop) {
  await t.wait(700);
  const p = await t.eval(() => {
    const s = window.__qf.game.services;
    const e = window.__pickups[window.__pickups.length - 1];
    if (!e) return null;
    window.__saveSnap = () => JSON.stringify([s.save.rupees, s.save.hp, s.save.arrows, s.save.bombs, s.save.magic]);
    // Room to heal, so a heart shows up in the save too.
    s.save.hp = Math.max(2, s.save.maxHp - 4);
    return { item: e.item, amount: e.amount, onFloor: !e.dead && s.entities.includes(e), z: +e.z.toFixed(1), save: window.__saveSnap() };
  });
  t.log(`${id} drop`, p);
  const want = DROP_ITEMS[drop];
  t.assert(p && p.item === want[0] && p.amount === want[1], `${id}: the drop is a ${want[1]}x ${want[0]} pickup (${JSON.stringify(p)})`);
  t.assert(p && p.onFloor && p.z < 1, `${id}: the drop rests on the floor`);
  if (!p?.onFloor) return;
  await t.shotCanvas(`${id.replace(/[^a-z0-9]+/gi, '-')}-drop`);
  await t.eval(() => {
    const e = window.__pickups[window.__pickups.length - 1];
    window.__qf.game.services.player.place(e.x, e.y + 4, 'up');
  });
  await t.wait(250);
  const after = await t.eval(() => ({ gone: window.__pickups[window.__pickups.length - 1].dead, save: window.__saveSnap() }));
  t.assert(after.gone && after.save !== p.save, `${id}: the hero collects the drop (${p.save} -> ${after.save})`);
}

// ---------------------------------------------------------------- scenario
export default async function (t) {
  // ---- Patrol soldier: grace, notices the hero 70 px ahead, alert beat, chase, contact.
  await arena(t, {
    theme: 'grass', hearts: 10, items: { boomerang: 1 }, player: { x: 128, y: 132, dir: 'up' },
    entities: [{ id: 'sol', type: 'enemy.soldier', x: 128, y: 62, props: { variant: 'green', behavior: 'patrol', facing: 'down' } }],
  });
  let e = await info(t, 'sol');
  t.assert(e && e.contact === 0, `no contact damage during the spawn grace (${e?.contact})`);
  await waitFor(t, () => ['alert', 'chase'].includes(window.__qf.game.services.findEntity('sol')?.aiState), undefined, 3000);
  e = await info(t, 'sol');
  t.log('noticed', e);
  t.assert(e.st === 'alert', `soldier noticed the hero within 5 tiles (${e.st})`);
  await t.shotCanvas('alert');
  const y0 = e.y;
  await waitFor(t, () => window.__qf.game.services.findEntity('sol')?.aiState === 'chase', undefined, 2000);
  await t.wait(300);
  e = await info(t, 'sol');
  t.log('chasing', e);
  t.assert(e.st === 'chase' && e.y > y0 + 10, `chases toward the hero (${y0} -> ${e.y}, ${e.st})`);
  t.assert(e.contact === 1, `green contact damage 1 once awake (${e.contact})`);
  await t.shotCanvas('chase');
  await waitFor(t, () => window.__qf.game.services.save.hp < 20, undefined, 4000);
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 19, `contact takes half a heart (hp=${hp})`);
  await t.shotCanvas('contact');

  // ---- The real boomerang (C) stuns it: frozen in place, anim and all, no damage.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e2 = s.findEntity('sol');
    s.save.equipped = 'boomerang';
    s.debug.invincible = true;
    Object.assign(e2, { x: 128, y: 60 });
    s.player.place(128, 130, 'up');
  });
  await t.press('KeyC', 60);
  const stunnedBy = await waitFor(t, () => (window.__qf.game.services.findEntity('sol')?.stun ?? 0) > 1, undefined, 2000);
  const boom = await t.eval(() => ({ hp: window.__qf.game.services.findEntity('sol').hp, flying: window.__qf.game.services.entities.some((e) => e.type === 'boomerang') }));
  t.assert(stunnedBy && boom.hp === 2, `the thrown boomerang stuns it without damage (${JSON.stringify(boom)})`);
  const s0 = await info(t, 'sol');
  await t.wait(500);
  await t.shotCanvas('stunned');
  const s1 = await info(t, 'sol');
  t.assert(Math.abs(s1.x - s0.x) < 0.5 && Math.abs(s1.y - s0.y) < 0.5 && s1.anim === s0.anim, `stunned soldier holds still (${s0.x},${s0.y} -> ${s1.x},${s1.y})`);

  // ---- Guard: stays put while the hero is behind it; hero steps in front -> alert.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 40, y: 190, dir: 'up' },
    entities: [{ id: 'g', type: 'enemy.soldier', x: 200, y: 60, props: { variant: 'blue', behavior: 'guard', facing: 'down' } }],
  });
  await t.wait(1500);
  e = await info(t, 'g');
  t.log('guard idle', e);
  t.assert(Math.abs(e.x - 200) < 0.5 && Math.abs(e.y - 60) < 0.5 && e.st === 'guard', `guard holds its post (${e.x},${e.y},${e.st})`);
  t.assert(e.palette === 'pal.soldier.blue' && e.hp === 4, `blue palette and 4 HP (${e.palette}, ${e.hp})`);
  await t.shotCanvas('guard-post');
  await t.eval(() => window.__qf.game.services.player.place(200, 120, 'up'));
  await waitFor(t, () => window.__qf.game.services.findEntity('g')?.aiState === 'alert', undefined, 2000);
  e = await info(t, 'g');
  t.assert(e.st === 'alert' || e.st === 'chase', `guard alerted (${e.st})`);
  await t.shotCanvas('guard-alert');

  // ---- Red soldier: 6 HP, faster, a whole heart on contact.
  await arena(t, {
    theme: 'grass', hearts: 10, player: { x: 128, y: 150, dir: 'up' },
    entities: [{ id: 'r', type: 'enemy.soldier', x: 128, y: 70, props: { variant: 'red', behavior: 'chase' } }],
  });
  await waitFor(t, () => window.__qf.game.services.save.hp < 20, undefined, 4000);
  const hpRed = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hpRed === 18, `red contact takes a whole heart (hp=${hpRed})`);
  e = await info(t, 'r');
  t.assert(e.hp === 6 && e.palette === 'pal.soldier.red', `red: 6 HP, red palette (${e.hp}, ${e.palette})`);
  await t.shotCanvas('red');

  // ---- Blades meet: a swing into a chasing soldier's thrust clashes (no damage, clink,
  // both pushed apart); its guard then drops, so the follow-up swing lands without any
  // recoil. Stunned, it takes a plain hit.
  await arena(t, {
    theme: 'grass', hearts: 10, player: { x: 128, y: 130, dir: 'up' },
    entities: [{ id: 'k', type: 'enemy.soldier', x: 128, y: 108, props: { variant: 'blue', behavior: 'guard', facing: 'down', drop: 'rupee5' } }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  const thrusting = await waitFor(t, () => {
    const k = window.__qf.game.services.findEntity('k');
    return k.aiState === 'chase' && k.anim === 'attack_down';
  }, undefined, 3000);
  t.assert(thrusting, 'the alerted guard chases in its thrust pose');
  await t.shotCanvas('thrust');
  const frontHit = async (label) => {
    const before = await t.eval(() => {
      const s = window.__qf.game.services;
      const k = s.findEntity('k');
      window.__kTrack = { minY: k.y, maxHeroY: s.player.y };
      const tick = () => {
        const tr = window.__kTrack;
        if (!tr || k.dead) return;
        tr.minY = Math.min(tr.minY, k.y);
        tr.maxHeroY = Math.max(tr.maxHeroY, s.player.y);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return { y: k.y, heroY: s.player.y, hp: k.hp, sfx: window.__sfx.length };
    });
    await t.press('KeyZ', 60);
    await t.wait(40);
    const swung = await t.eval(() => window.__qf.game.services.player.state === 'attack');
    t.assert(swung, `${label}: the sword swing starts`);
    await t.wait(300);
    const after = await t.eval((n) => {
      const tr = window.__kTrack;
      window.__kTrack = null;
      return { hp: window.__qf.game.services.findEntity('k').hp, minY: tr.minY, maxHeroY: tr.maxHeroY, sfx: window.__sfx.slice(n) };
    }, before.sfx);
    const res = {
      hp: after.hp - before.hp, knock: +(before.y - after.minY).toFixed(1), recoil: +(after.maxHeroY - before.heroY).toFixed(1),
      tink: after.sfx.includes('swordTink'), sfx: after.sfx,
    };
    t.log(label, res);
    return res;
  };
  const clash = await frontHit('clash');
  t.assert(clash.hp === 0, `blades meet: no damage (hp ${clash.hp})`);
  t.assert(clash.tink && !clash.sfx.includes('enemyHit'), `the clash clinks (${clash.sfx.join(',')})`);
  t.assert(clash.knock >= 10, `the soldier is pushed back (${clash.knock} px)`);
  t.assert(clash.recoil >= 4 && clash.recoil <= 10, `the hero recoils a little (${clash.recoil} px)`);
  await t.shotCanvas('clash');
  await t.eval(() => {
    const s = window.__qf.game.services;
    Object.assign(s.findEntity('k'), { x: 128, y: 108, facing: 'down' });
    s.player.place(128, 130, 'up');
  });
  const guardDown = await frontHit('guard down');
  t.assert(guardDown.hp === -1 && !guardDown.tink, `the follow-up swing lands (hp ${guardDown.hp}, tink ${guardDown.tink})`);
  t.assert(guardDown.recoil < 2, `landing a hit never pushes the hero back (${guardDown.recoil} px)`);
  await t.eval(() => {
    const s = window.__qf.game.services;
    const k = s.findEntity('k');
    Object.assign(k, { x: 128, y: 108, facing: 'down', stun: 1.2, invuln: 0 });
    s.player.place(128, 130, 'up');
  });
  await t.wait(100);
  const stunned = await frontHit('stunned front hit');
  t.assert(stunned.hp === -1, `the stunned soldier is hit (hp ${stunned.hp})`);
  t.assert(stunned.knock > 10 && stunned.knock < 20, `plain knockback while stunned (${stunned.knock} px)`);
  t.assert(stunned.recoil < 2, `no hero recoil against a stunned soldier (${stunned.recoil} px)`);
  t.log('sword swings to kill', await swordKill(t, 'k'));
  await t.shotCanvas('dead');
  await checkDeath(t, 'k', 'rupee5');

  // ---- A clash at a pit's edge: the recoil stops short of the hole.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 139, dir: 'up' },
    tiles: [{ layer: 'bg', tx: 5, ty: 9, w: 6, h: 2, tile: 'PIT' }],
    entities: [{ id: 'k', type: 'enemy.soldier', x: 128, y: 117, props: { variant: 'blue', behavior: 'chase', facing: 'down' } }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await waitFor(t, () => window.__qf.game.services.findEntity('k').anim === 'attack_down', undefined, 3000);
  const edge = await frontHit('clash at the pit edge');
  await t.wait(400);
  const hero = await t.eval(() => {
    const s = window.__qf.game.services;
    return { st: s.player.state, y: +s.player.y.toFixed(1), under: s.room.collisionAt(s.player.x, s.player.y) };
  });
  t.log('hero after the edge clash', hero);
  t.assert(edge.tink && edge.hp === 0, `it clashed (${JSON.stringify(edge)})`);
  t.assert(hero.st !== 'fall' && hero.under !== 'pit', `the recoil never drops the hero into the pit (${JSON.stringify(hero)})`);
  await t.shotCanvas('pit-edge');
}
