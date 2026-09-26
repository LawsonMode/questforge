// Enemies A: archer. Spots the hero, holds 4-6 tiles away, lines up on the
// hero's row, draws (shoot pose) and fires a blockable arrow that the hero's
// shield stops from the front; flees when the hero closes in; blue variant is
// tougher; killed by the sword -> poof + drop.

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
  // ---- Engage: moves into its band, lines up on the hero's row, shoots; the shield blocks it.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 56, y: 120, dir: 'right' },
    entities: [{ id: 'a', type: 'enemy.archer', x: 150, y: 96, props: { variant: 'green', facing: 'left', drop: 'arrows' } }],
  });
  const aimed = await waitFor(t, () => window.__qf.game.services.findEntity('a')?.aiState === 'aim', undefined, 6000);
  let e = await info(t, 'a');
  t.log('aiming', e);
  t.assert(aimed && e.anim === 'shoot_left', `archer draws facing the hero (${e.st}, ${e.anim})`);
  t.assert(Math.abs(e.y - 120) <= 4, `lined up on the hero's row (y=${e.y})`);
  const dist = Math.abs(e.x - 56);
  t.assert(dist >= 56 && dist <= 104, `keeps its distance (${dist.toFixed(0)} px)`);
  await t.shotCanvas('aim');
  const arrow = await waitFor(t, () => window.__qf.game.services.entities.some((x) => x.sprite === 'proj.arrow'), undefined, 2000);
  t.assert(arrow, 'an arrow is loosed');
  const shot = await t.eval(() => {
    const p = window.__qf.game.services.entities.find((x) => x.sprite === 'proj.arrow');
    return p ? { vx: p.vx, vy: p.vy, blockable: p.blockable, anim: p.anim } : null;
  });
  t.log('arrow', shot);
  t.assert(shot && shot.vx < -100 && shot.blockable && shot.anim === 'left', `arrow flies left, blockable (${JSON.stringify(shot)})`);
  await t.wait(150);
  await t.shotCanvas('arrow');
  const res = await shieldVs(t, 'proj.arrow');
  t.assert(res === 'blocked', `the hero's shield blocks the arrow (${res})`);
  await t.wait(120);
  await t.shotCanvas('blocked');
  const hp = await t.eval(() => window.__qf.game.services.save.hp);
  t.assert(hp === 20, `no damage through the shield (hp=${hp})`);

  // ---- Flee: the hero steps right next to it -> it backs away.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const a = s.findEntity('a');
    a.x = 128; a.y = 112;
    s.player.place(128, 136, 'up');
    s.debug.invincible = true;
  });
  await t.wait(100);
  const d0 = await t.eval(() => { const s = window.__qf.game.services; const a = s.findEntity('a'); return Math.hypot(a.x - s.player.x, a.y - s.player.y); });
  await t.wait(700);
  const d1 = await t.eval(() => { const s = window.__qf.game.services; const a = s.findEntity('a'); return Math.hypot(a.x - s.player.x, a.y - s.player.y); });
  e = await info(t, 'a');
  t.log('flee', d0.toFixed(1), d1.toFixed(1), e);
  t.assert(d1 > d0 + 20, `flees from a close hero (${d0.toFixed(0)} -> ${d1.toFixed(0)} px)`);
  await t.shotCanvas('flee');

  // ---- Kill with the sword: poof + its arrows drop.
  t.log('sword swings to kill', await swordKill(t, 'a'));
  await t.shotCanvas('dead');
  await checkDeath(t, 'a', 'arrows');

  // ---- Blue archer: 3 HP, blue palette.
  await arena(t, {
    theme: 'grass', player: { x: 40, y: 190, dir: 'up' },
    entities: [{ id: 'b', type: 'enemy.archer', x: 200, y: 40, props: { variant: 'blue' } }],
  });
  e = await info(t, 'b');
  t.assert(e.hp === 3 && e.palette === 'pal.archer.blue', `blue archer: 3 HP, blue palette (${e.hp}, ${e.palette})`);
  await t.wait(1200);
  await t.shotCanvas('blue');
}
