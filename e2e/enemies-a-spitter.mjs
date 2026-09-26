// Enemies A: rock spitter. Lines up with the hero, puffs and spits a blockable
// rock that the shield stops from the front; unshielded from behind it hurts;
// blue spits 3-rock bursts; killed by the sword -> poof + drop.

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

/**
 * The hero faces the next `sprite` enemy shot on course for them (the real shield):
 * returns how it ended ('blocked' | 'hit' | 'missed' | 'none').
 */
async function shieldVs(t, sprite, ms = 8000) {
  const seen = await waitFor(t, (sp) => {
    const s = window.__qf.game.services;
    const p = s.player;
    // Only shots on course for the hero: moving toward them, passing within 10 px.
    const onCourse = (e) => {
      const rx = p.x - e.x;
      const ry = p.y - e.y;
      const v = Math.hypot(e.vx, e.vy) || 1;
      return rx * e.vx + ry * e.vy > 0 && Math.abs(rx * e.vy - ry * e.vx) / v < 10;
    };
    const shot = s.entities.find((e) => e.sprite === sp && typeof e.isDeflected === 'boolean' && !e.dead && !e.isDeflected && onCourse(e));
    if (shot) { window.__shot = shot; window.__hp0 = s.save.hp; }
    return !!shot;
  }, sprite, ms);
  if (!seen) return 'none';
  await waitFor(t, () => window.__shot.dead || window.__shot.isDeflected, undefined, 4000);
  const res = await t.eval(() => (window.__shot.isDeflected ? 'blocked' : window.__qf.game.services.save.hp < window.__hp0 ? 'hit' : 'missed'));
  t.log(`${sprite} vs the shield: ${res}`);
  return res;
}


// ---------------------------------------------------------------- scenario
export default async function (t) {
  // ---- Red spitter on the hero's column: puffs, spits down; the shield (facing up) blocks it.
  await arena(t, {
    theme: 'grass', hearts: 10, player: { x: 128, y: 176, dir: 'up' },
    entities: [{ id: 's', type: 'enemy.spitter', x: 128, y: 72, props: { variant: 'red', drop: 'rupee' } }],
  });
  let e = await info(t, 's');
  t.assert(e.hp === 1 && e.palette === null, `red spitter: 1 HP, base palette (${e.hp}, ${e.palette})`);
  const puffed = await waitFor(t, () => window.__qf.game.services.findEntity('s')?.aiState === 'puff', undefined, 5000);
  e = await info(t, 's');
  t.log('puff', e);
  t.assert(puffed, `puffs up before spitting (${e.st})`);
  await t.shotCanvas('puff');
  const res = await shieldVs(t, 'proj.rock');
  t.assert(res === 'blocked', `the shield blocks the rock (${res})`);
  await t.wait(100);
  await t.shotCanvas('blocked');
  let hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 20, `no damage through the shield (hp=${hp})`);

  // ---- From behind the shield does nothing: the next rock hurts. The spitter roams at
  // random, so the hero is kept lined up 5 tiles away (back turned) until it fires.
  await t.eval(() => {
    window.__follow = setInterval(() => {
      const s = window.__qf.game.services;
      const sp = s.findEntity('s');
      if (!sp) return;
      const below = sp.y + 80 < 200;
      const y = below ? sp.y + 80 : sp.y - 80;
      if (Math.abs(s.player.x - sp.x) > 2 || Math.abs(s.player.y - y) > 2) s.player.place(sp.x, y, below ? 'down' : 'up');
    }, 250);
  });
  const behind = await shieldVs(t, 'proj.rock', 10000);
  await t.eval(() => clearInterval(window.__follow));
  t.assert(behind === 'hit', `a rock from behind hurts (${behind})`);
  hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 18 || hp === 19, `rock damage taken (hp=${hp})`);

  // ---- Kill with the sword.
  t.log('sword swings to kill', await swordKill(t, 's'));
  await t.shotCanvas('dead');
  await checkDeath(t, 's', 'rupee');

  // ---- Blue spitter: 2 HP, blue palette, 3-rock bursts (the hero stands on its column,
  // inside its 8-tile targeting range, so it aims at once instead of spitting at random).
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 170, dir: 'up' },
    entities: [{ id: 'b', type: 'enemy.spitter', x: 128, y: 56, props: { variant: 'blue' } }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  e = await info(t, 'b');
  t.assert(e.hp === 2 && e.palette === 'pal.spitter.blue', `blue spitter: 2 HP, blue palette (${e.hp}, ${e.palette})`);
  // Count every rock spawned (the shield may already have knocked the first ones away).
  await t.eval(() => {
    const s = window.__qf.game.services;
    window.__rocks = new Set();
    const tick = () => {
      if (!window.__rocks) return;
      for (const e of s.entities) if (e.sprite === 'proj.rock') window.__rocks.add(e);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const first = await waitFor(t, () => window.__rocks.size > 0, undefined, 6000);
  t.assert(first, 'blue spitter fires');
  await t.wait(250);
  await t.shotCanvas('burst');
  await t.wait(350);
  const burst = await t.eval(() => window.__rocks.size);
  t.assert(burst === 3, `one volley = three rocks (${burst})`);
}
