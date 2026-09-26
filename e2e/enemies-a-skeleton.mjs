// Enemies A: skeleton. Hops toward the hero in short arcs, leaps backward from a
// nearby sword swing so the blade misses it (a quick second swing inside the
// dodge cooldown lands), throws spinning blockable bones from mid range - across
// a pit moat it can't hop over (the shield stops them); killed by the sword ->
// poof + a drop on the floor.

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

/** The hero swings the real sword once (it must start). */
async function swing(t) {
  await t.press('KeyZ', 60);
  const swung = await t.eval(() => window.__qf.game.services.player.state === 'attack');
  t.assert(swung, 'the sword swing starts');
}

/** Stand the skeleton 24 px in front of the hero (well inside the blade's reach), idle and unhurt. */
const standoff = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  const sk = s.findEntity('sk');
  Object.assign(sk, { x: 128, y: 126, z: 0, vz: 0, hp: 2, invuln: 0, kbTime: 0, st: 'wait', timer: 5 });
  s.player.place(128, 150, 'up');
  window.__skDodged = false;
  const tick = () => {
    if (window.__skDodged || sk.dead) return;
    window.__skDodged = sk.aiState === 'dodge';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ---------------------------------------------------------------- scenario
export default async function (t) {
  // ---- Hops toward the hero in arcs (throws off to watch the hopping alone).
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 190, dir: 'up' },
    entities: [{ id: 'sk', type: 'enemy.skeleton', x: 128, y: 56, props: { throws: false, drop: 'bombs' } }],
  });
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    window.__skTrack = { maxZ: 0 };
    const sk = s.findEntity('sk');
    const tick = () => { if (!sk.dead && window.__skTrack) { window.__skTrack.maxZ = Math.max(window.__skTrack.maxZ, sk.z); requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
  });
  let e = await info(t, 'sk');
  t.assert(e.hp === 2, `2 HP (${e.hp})`);
  const y0 = e.y;
  await waitFor(t, () => window.__qf.game.services.findEntity('sk').z > 4, undefined, 3000);
  await t.shotCanvas('hop');
  await t.wait(1500);
  e = await info(t, 'sk');
  const maxZ = await t.eval(() => window.__skTrack.maxZ);
  t.log('hopping', e, maxZ);
  t.assert(maxZ > 5, `hops in arcs (max z ${maxZ.toFixed(1)})`);
  t.assert(e.y > y0 + 30, `hops toward the hero (${y0} -> ${e.y})`);
  await t.shotCanvas('approach');

  // ---- Dodge: the hero swings with the skeleton inside the blade's reach -> it leaps
  // backward and the blade misses it (the roll fails 1 time in 5, so retry).
  let dodged = null;
  for (let i = 0; i < 6 && !dodged; i++) {
    await standoff(t);
    await t.wait(150);
    await swing(t);
    await t.wait(80);
    await t.shotCanvas(`dodge-${i}`);
    await t.wait(400);
    const r = await t.eval(() => { const sk = window.__qf.game.services.findEntity('sk'); return { y: +sk.y.toFixed(1), hp: sk.hp, dodged: window.__skDodged }; });
    t.log(`swing ${i}`, r);
    if (r.dodged) dodged = r;
    else await t.wait(1200);
  }
  t.assert(dodged, 'dodges a close sword swing');
  t.assert(dodged && dodged.y < 126 - 16, `leaps backward (y ${dodged?.y})`);
  t.assert(dodged && dodged.hp === 2, `the blade misses it during the leap (hp ${dodged?.hp})`);

  // ---- Persistence pays: a second swing within the dodge cooldown lands.
  await standoff(t);
  await t.wait(100);
  await swing(t);
  await t.wait(300);
  const follow = await t.eval(() => { const sk = window.__qf.game.services.findEntity('sk'); return { hp: sk.hp, dodged: window.__skDodged }; });
  t.log('follow-up swing', follow);
  t.assert(!follow.dodged && follow.hp === 1, `a quick second swing connects (${JSON.stringify(follow)})`);

  // ---- Bone thrower across a pit moat (it can't hop over, bones fly over): a spinning
  // bone, blocked by the shield.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 128, y: 190, dir: 'up' },
    tiles: [{ layer: 'bg', tx: 1, ty: 7, w: 14, h: 2, tile: 'PIT' }],
    entities: [{ id: 'bt', type: 'enemy.skeleton', x: 128, y: 72, props: { throws: true, drop: 'bombs' } }],
  });
  const res = await shieldVs(t, 'proj.bone', 8000);
  t.assert(res === 'blocked', `the shield blocks the bone (${res})`);
  const bone = await t.eval(() => ({ anim: window.__shot.anim, blockable: window.__shot.blockable }));
  t.assert(bone.anim === 'spin' && bone.blockable, `bone spins and is blockable (${JSON.stringify(bone)})`);
  await t.shotCanvas('bone-blocked');

  // ---- Kill with the sword (away from the moat, so the hero stands on floor).
  await t.eval(() => Object.assign(window.__qf.game.services.findEntity('bt'), { x: 128, y: 56 }));
  t.log('sword swings to kill', await swordKill(t, 'bt'));
  await t.shotCanvas('dead');
  await checkDeath(t, 'bt', 'bombs');
}
