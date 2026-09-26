// Enemies A: slime. Squashes and hops toward the hero in bursts; a big slime
// splits into two small ones on death (the halves share its drop without
// duplicating it); variants use their palettes; killed by the sword.

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

const slimes = (t) => t.eval(() => window.__qf.game.services.entities
  .filter((e) => e.type === 'enemy.slime')
  .map((e) => ({ id: e.id, hp: e.hp, w: e.w, anim: e.anim, palette: e.palette ?? null, drop: e.inst?.props?.drop })));

// ---------------------------------------------------------------- scenario
export default async function (t) {
  // ---- Big green slime: squash, hop toward the hero.
  await arena(t, {
    theme: 'grass', hearts: 10, player: { x: 128, y: 190, dir: 'up' },
    entities: [{ id: 'sl', type: 'enemy.slime', x: 128, y: 64, props: { variant: 'green', size: 'big', split: true, drop: 'rupee20' } }],
  });
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    window.__slTrack = { maxZ: 0, anims: new Set() };
    const sl = s.findEntity('sl');
    const tick = () => {
      if (sl.dead || !window.__slTrack) return;
      window.__slTrack.maxZ = Math.max(window.__slTrack.maxZ, sl.z);
      window.__slTrack.anims.add(sl.anim);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  let e = await info(t, 'sl');
  t.assert(e.hp === 2 && e.palette === null, `big green slime: 2 HP, base palette (${e.hp}, ${e.palette})`);
  const y0 = e.y;
  await waitFor(t, () => window.__qf.game.services.findEntity('sl').aiState === 'squash', undefined, 3000);
  await t.shotCanvas('squash');
  await waitFor(t, () => window.__qf.game.services.findEntity('sl').z > 4, undefined, 2000);
  await t.shotCanvas('hop');
  await t.wait(2000);
  e = await info(t, 'sl');
  const tr = await t.eval(() => ({ maxZ: window.__slTrack.maxZ, anims: [...window.__slTrack.anims] }));
  t.log('hopping', e, tr);
  t.assert(tr.maxZ > 4 && tr.anims.includes('hop') && tr.anims.includes('idle'), `hops with squash/hop anims (${JSON.stringify(tr)})`);
  t.assert(e.y > y0 + 24, `bounces toward the hero (${y0} -> ${e.y})`);

  // ---- Kill the big one: it splits into two small slimes; only one carries the drop.
  await swordKill(t, 'sl');
  let list = await slimes(t);
  t.log('after split', list);
  t.assert(list.length === 2 && list.every((s) => s.hp === 1 && s.w === 8 && s.anim.startsWith('small_')), `splits into two small slimes (${JSON.stringify(list)})`);
  t.assert(list.map((s) => s.drop).sort().join(',') === 'none,rupee20', `the halves share the drop (${list.map((s) => s.drop).join(',')})`);
  const drops0 = await t.eval(() => window.__drops.slice());
  t.assert(drops0.length === 0, `the big slime itself drops nothing (${drops0.join(',')})`);
  await t.eval(() => window.__qf.game.services.player.place(40, 196, 'up'));
  await t.wait(250);
  await t.shotCanvas('split');
  await t.wait(600);
  await t.shotCanvas('halves-hop');
  // Debug hitboxes on grounded, stunned halves: the small art sits on its 8x8 box (artLift).
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.hitboxes = true;
    for (const e of s.entities) if (e.type === 'enemy.slime') e.stun = 2;
  });
  const grounded = await waitFor(t, () => window.__qf.game.services.entities.filter((e) => e.type === 'enemy.slime').every((e) => e.z === 0), undefined, 2000);
  t.assert(grounded, 'the stunned halves land');
  await t.shotCanvas('halves-hitboxes');
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.hitboxes = false;
    for (const e of s.entities) if (e.type === 'enemy.slime') e.stun = 0;
  });

  // ---- Kill both halves: the carrier leaves the rupee20 on the floor, the other drops
  // nothing; exactly one drop in total, all gone.
  const carrier = list.find((s) => s.drop === 'rupee20');
  const plain = list.find((s) => s.drop === 'none');
  await swordKill(t, carrier.id);
  await checkDeath(t, carrier.id, 'rupee20');
  await swordKill(t, plain.id);
  list = await slimes(t);
  const drops = await t.eval(() => window.__drops.slice());
  t.log('after halves', list, drops);
  t.assert(list.length === 0, 'both halves defeated');
  t.assert(drops.join(',') === 'rupee20', `one drop in total (${drops.join(',')})`);
  await t.shotCanvas('cleared');

  // ---- Variants and a non-splitting big slime.
  await arena(t, {
    theme: 'dungeon', player: { x: 40, y: 190, dir: 'up' },
    entities: [
      { id: 'red', type: 'enemy.slime', x: 90, y: 60, props: { variant: 'red', size: 'small' } },
      { id: 'blue', type: 'enemy.slime', x: 170, y: 60, props: { variant: 'blue', split: false } },
    ],
  });
  list = await slimes(t);
  t.assert(list.find((s) => s.id === 'red')?.palette === 'pal.slime.red', 'red slime palette');
  t.assert(list.find((s) => s.id === 'blue')?.palette === 'pal.slime.blue', 'blue slime palette');
  await t.wait(900);
  await t.shotCanvas('variants');
  await swordKill(t, 'blue');
  list = await slimes(t);
  t.assert(list.length === 1 && list[0].id === 'red', `a non-splitting big slime just dies (${list.map((s) => s.id).join(',')})`);
}
