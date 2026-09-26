// Bosses: the Giant Worm in the sample adventure's lair (hollow_keep / kp_boss).
// Entering from the north shuts the north shutter behind the hero (the south
// one is shut already); the worm crawls, takes its tail hits and bursts; both
// shutters stay shut until it is gone, then open, and the heart container lies
// on open floor. Leaving south without the heart and coming back finds the
// worm still gone, the doors still open and the heart container waiting;
// once collected it never comes back. Hero invincible throughout.

const WORLD = 'hollow_keep';
const LAIR = 'kp_boss';
const SANCTUM = 'kp_pedestal';
const WORM = 'kp_boss_worm';
const HEART = `${WORM}-heart`;

/** Doors, worm and heart as the page sees them. */
const lair = (t) => t.eval(([wormId, heartId]) => {
  const s = window.__qf.game.services;
  const w = s.findEntity(wormId);
  const heart = s.entities.find((e) => e.id === heartId && !e.dead);
  const door = (id) => s.findEntity(id)?.solid ?? null;
  return {
    room: s.room.def.id,
    doors: { n: door('kp_boss_door_n'), s: door('kp_boss_door_s') },
    worm: w ? { hp: w.hp, x: w.x, y: w.y, dying: w.dying } : null,
    heart: heart ? { x: heart.x, y: heart.y, onFloor: !s.room.blocked(heart.hitbox(), 'walker') } : null,
    flag: s.flag(`defeated:${wormId}`),
  };
}, [WORM, HEART]);

const warp = (t, room, x, y, dir) => t.eval((to) => window.__qf.game.warpNow(to), { world: WORLD, room, x, y, dir });

/** Hit the tail with the hero as the source (damage lands unless the tail is reeling). */
const hitTail = (t) => t.eval((id) => {
  const s = window.__qf.game.services;
  const tail = s.findEntity(id).tail;
  const p = s.player;
  const len = Math.hypot(tail.x - p.x, tail.y - p.y) || 1;
  return tail.hurt({ damage: 1, kind: 'sword', source: p, dx: (tail.x - p.x) / len, dy: (tail.y - p.y) / len });
}, WORM);

/** Freeze the loop for a screenshot, so short-lived frames are caught. */
async function frozenShot(t, label) {
  await t.eval(() => window.__qf.game.stop());
  await t.shotCanvas(label);
  await t.eval(() => window.__qf.game.start());
}

/** Press the action button until the item fanfare's message is closed. */
async function closeFanfare(t) {
  const holdingUp = () => t.eval(() => window.__qf.game.services.player.state === 'itemGet');
  for (let i = 0; i < 12 && (await holdingUp()); i++) {
    await t.press('KeyX', 60);
    await t.wait(250);
  }
  t.assert(!(await holdingUp()), 'the heart container message closes');
}

export default async function (t) {
  await t.goto(`#/playtest/sample?w=${WORLD}&r=${LAIR}&x=128&y=30`);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });

  // ---- Entry: the north shutter is open behind the hero, the south one shut, the worm at the far end.
  let st = await lair(t);
  t.log('entry', st);
  t.assert(st.room === LAIR && st.worm && st.worm.hp === 10, `in the lair with a 10 HP worm (${JSON.stringify(st.worm)})`);
  t.assert(st.doors.n === false && st.doors.s === true, `north shutter open behind the hero, south shut (${JSON.stringify(st.doors)})`);
  await t.shotCanvas('lair-entry');

  // ---- A few steps in: the north shutter slams; the worm wakes and crawls.
  await t.hold(['ArrowDown'], 400);
  await t.wait(1200);
  st = await lair(t);
  t.assert(st.doors.n === true && st.doors.s === true, `both shutters shut once inside (${JSON.stringify(st.doors)})`);
  await frozenShot(t, 'lair-shut-in');

  // ---- Wear it down on the tail (hp 2 left), then the killing blow.
  await t.eval((id) => { window.__qf.game.services.findEntity(id).hp = 2; }, WORM);
  t.assert(await hitTail(t), 'a tail hit lands');
  await t.wait(600);
  t.assert(await hitTail(t), 'the last tail hit lands');
  await t.wait(400);
  st = await lair(t);
  t.assert(st.worm && st.worm.dying && st.doors.n && st.doors.s, `the shutters stay shut while it bursts (${JSON.stringify(st)})`);
  await frozenShot(t, 'lair-bursting');

  // ---- Gone: both shutters open, the heart container waits on open floor.
  await t.until((id) => !window.__qf.game.services.findEntity(id), WORM, 5000);
  await t.until(() => {
    const s = window.__qf.game.services;
    return !s.findEntity('kp_boss_door_n')?.solid && !s.findEntity('kp_boss_door_s')?.solid;
  }, undefined, 3000);
  await t.wait(400);
  st = await lair(t);
  t.log('cleared', st);
  t.assert(st.flag, 'defeated flag set');
  t.assert(st.heart && st.heart.onFloor, `heart container on open floor (${JSON.stringify(st.heart)})`);
  await t.shotCanvas('lair-cleared');

  // ---- Leave south without it, come back: worm gone, doors open, heart waiting.
  await warp(t, SANCTUM, 128, 40, 'down');
  await t.wait(300);
  t.assert((await lair(t)).room === SANCTUM, 'left for the sanctum');
  await warp(t, LAIR, 128, 190, 'up');
  await t.wait(500);
  st = await lair(t);
  t.log('back without the heart', st);
  t.assert(!st.worm, 'the worm stays defeated');
  t.assert(st.doors.n === false && st.doors.s === false, `both shutters stay open (${JSON.stringify(st.doors)})`);
  t.assert(st.heart && st.heart.onFloor, `the heart container waits (${JSON.stringify(st.heart)})`);
  await t.shotCanvas('lair-return-heart');
  if (!st.heart) return;

  // ---- Collect it; it never comes back.
  const maxHp = await t.eval(() => window.__qf.game.services.save.maxHp);
  await t.eval((h) => window.__qf.game.services.player.place(h.x, h.y + 4, 'up'), st.heart);
  await t.until((id) => window.__qf.game.services.flag(`pickup:${id}`), HEART, 3000);
  await t.wait(300);
  await t.shotCanvas('lair-heart-collected');
  await closeFanfare(t);
  const gained = await t.eval(() => window.__qf.game.services.save.maxHp);
  t.assert(gained === maxHp + 2, `the heart container adds a heart (max hp ${maxHp} -> ${gained})`);
  await warp(t, SANCTUM, 128, 40, 'down');
  await t.wait(200);
  await warp(t, LAIR, 128, 190, 'up');
  await t.wait(300);
  st = await lair(t);
  t.assert(!st.worm && !st.heart, `after collecting: no worm, no heart (${JSON.stringify(st)})`);
}
