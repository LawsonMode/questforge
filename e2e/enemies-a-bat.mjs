// Enemies A: bat. A sleeping bat rests until the hero comes within 3 tiles, then
// swoops erratically (airborne, over pits), resting now and then; contact hurts;
// killed by the sword -> poof + a drop on the floor; the real boomerang downs one.

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
  // ---- Sleeping bat over a pit field: rests while the hero is far away.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 196, dir: 'up' },
    tiles: [{ layer: 'bg', tx: 1, ty: 7, w: 14, h: 4, tile: 'PIT' }],
    entities: [{ id: 'bat', type: 'enemy.bat', x: 128, y: 56, props: { sleeping: true, drop: 'heart' } }],
  });
  await t.wait(1500);
  let e = await info(t, 'bat');
  t.log('asleep', e);
  t.assert(e.st === 'sleep' && e.anim === 'rest' && e.x === 128 && e.y === 56, `sleeps while the hero is far (${e.st}, ${e.anim}, ${e.x},${e.y})`);
  t.assert(e.hp === 1, `1 HP (${e.hp})`);
  await t.shotCanvas('asleep');

  // ---- Hero comes within 3 tiles -> takes off and swoops after the hero, across the pit band.
  // The shared gameplay RNG is seeded so the flight is reproducible run to run.
  await t.eval(async () => {
    const m = await import('/src/core/rng.ts');
    const seeded = new m.Rng(0xba7);
    m.rng.next = () => seeded.next();
  });
  await t.eval(() => window.__qf.game.services.player.place(128, 96, 'up'));
  await waitFor(t, () => window.__qf.game.services.findEntity('bat')?.aiState === 'fly', undefined, 1500);
  e = await info(t, 'bat');
  t.assert(e.st === 'fly', `wakes when the hero is near (${e.st})`);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.player.place(128, 200, 'up');
    s.debug.invincible = true;
    window.__batTrack = { pit: false, maxZ: 0, dist: 0, headings: new Set(), last: null };
    const bat = s.findEntity('bat');
    const tick = () => {
      if (bat.dead || !window.__batTrack) return;
      const tr = window.__batTrack;
      tr.maxZ = Math.max(tr.maxZ, bat.z);
      if (s.room.collisionAt(bat.x, bat.y) === 'pit') tr.pit = true;
      if (tr.last) {
        const dx = bat.x - tr.last.x;
        const dy = bat.y - tr.last.y;
        tr.dist += Math.hypot(dx, dy);
        if (dx !== 0 || dy !== 0) tr.headings.add((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8);
      }
      tr.last = { x: bat.x, y: bat.y };
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 4; i++) {
    await t.wait(600);
    await t.shotCanvas(`swoop-${i}`);
  }
  await t.wait(2400);
  const track = await t.eval(() => { const tr = window.__batTrack; return { pit: tr.pit, maxZ: tr.maxZ, dist: Math.round(tr.dist), headings: tr.headings.size }; });
  t.log('flight', track);
  t.assert(track.maxZ >= 2, `flies above the ground (max z ${track.maxZ.toFixed(1)})`);
  t.assert(track.dist > 120, `covers ground while swooping (${track.dist} px)`);
  t.assert(track.headings >= 5, `erratic: flies in many directions (${track.headings} of 8)`);
  t.assert(track.pit, 'crosses the pit field');

  // ---- Contact hurts once it is awake (brought to the hero, who stays on solid floor).
  await t.eval(() => {
    const s = window.__qf.game.services;
    const bat = s.findEntity('bat');
    s.debug.invincible = false;
    bat.x = s.player.x;
    bat.y = s.player.y;
  });
  await waitFor(t, () => window.__qf.game.services.save.hp < 20, undefined, 3000);
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 19, `bat contact takes half a heart (hp=${hp})`);

  // ---- Kill with the sword (back over solid floor, clear of the pits and the wall).
  await t.eval(() => Object.assign(window.__qf.game.services.findEntity('bat'), { x: 128, y: 56 }));
  t.log('sword swings to kill', await swordKill(t, 'bat'));
  await t.shotCanvas('dead');
  await checkDeath(t, 'bat', 'heart');

  // ---- The real boomerang (C) knocks a bat out of the air (a sleeping one holds still for the throw).
  await arena(t, {
    theme: 'dungeon', hearts: 10, items: { boomerang: 1 }, player: { x: 128, y: 130, dir: 'up' },
    entities: [{ id: 'b2', type: 'enemy.bat', x: 128, y: 66, props: { sleeping: true, drop: 'none' } }],
  });
  await t.eval(() => { window.__qf.game.services.save.equipped = 'boomerang'; });
  await t.wait(500);
  await t.press('KeyC', 60);
  const downed = await waitFor(t, () => !window.__qf.game.services.findEntity('b2'), undefined, 2000);
  const sfx = await t.eval(() => window.__sfx.slice());
  t.assert(downed && sfx.includes('enemyDie'), `the boomerang kills the bat (${sfx.join(',')})`);
  await t.shotCanvas('boomerang-kill');
}
