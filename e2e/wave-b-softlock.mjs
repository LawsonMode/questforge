// Wave B soft-lock checks, played with the keyboard (fights and door walks are
// real input; warpNow only places the hero):
// - a key-carrying enemy leaves a placed key that never times out, and never a
//   second one once it was collected;
// - the Hollow Keep's Guard Hall shutter stays open from both sides once the
//   soldiers fell, even though they come back on every visit;
// - a key spent on a locked door opens both sides of its link for good;
// - dying in the Worm's Lair behind its slammed shutter continues at the keep's
//   entrance, and the lair seals again (worm alive) on the next visit.
// Screenshots land in e2e-out/wave-b-softlock/.
import { freezeHotReload, px, startSample, walkInto, warpTo } from './sample-opening.mjs';
import { fight, go, path } from './wave-b-playthrough.mjs';

const KEEP = 'hollow_keep';

/** Is the live door `id` open (null when not in this room)? */
const doorOpen = (t, id) => t.eval((d) => window.__qf.game.services.findEntity(d)?.isOpen ?? null, id);
/** Live entities of `type` that are not dead. */
const alive = (t, type) => t.eval((ty) => window.__qf.game.services.entities.filter((e) => e.type === ty && !e.dead).length, type);
/** Fire the equipped bow (facing it) until entity `id` is gone; true once it is. */
async function shootDown(t, id) {
  const gone = () => t.eval((e) => !window.__qf.game.services.findEntity(e) || window.__qf.game.services.findEntity(e).dead, id);
  for (let i = 0; i < 8 && !(await gone()); i++) {
    await t.press('KeyC');
    await t.wait(450);
  }
  return gone();
}
/** Wait until `seconds` of game time have passed. */
async function gameWait(t, seconds) {
  const t0 = await t.eval(() => window.__qf.game.services.time);
  await t.until((a) => window.__qf.game.services.time - a.t0 >= a.s, { t0, s: seconds }, seconds * 1000 + 8000);
}

async function keyCarrier(t) {
  await freezeHotReload(t);
  await t.goto('#/');
  await t.eval(async (cfg) => (await import('/src/dev/arena.ts')).startArena(cfg), {
    theme: 'dungeon', player: { x: 128, y: 184, dir: 'up' }, items: { bow: 1, arrows: 30 },
    entities: [{ type: 'enemy.soldier', id: 'carrier', x: 128, y: 56, props: { variant: 'green', behavior: 'guard', drop: 'smallKey' } }],
  });
  await t.until(() => !!window.__qf.game?.services?.findEntity('carrier'), undefined, 8000);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    s.save.equipped = 'bow';
  });
  // Shot from afar, so the key lands out of the hero's reach.
  t.assert(await shootDown(t, 'carrier'), 'shot the key carrier down with the bow');
  await t.wait(600);
  const key = () => t.eval(() => {
    const k = window.__qf.game.services.findEntity('carrier-key');
    return k && !k.dead ? { x: Math.round(k.x), y: Math.round(k.y), item: k.item, transient: k.transient } : null;
  });
  const dropped = await key();
  t.assert(dropped?.item === 'smallKey' && dropped.transient === false, `the carrier left a placed small key (${JSON.stringify(dropped)})`);
  await t.shotCanvas('carrier-key');
  await gameWait(t, 11);
  t.assert(!!(await key()), 'the key is still there after 11 s (loot would have vanished)');
  if (dropped) {
    await go(t, 'x', dropped.x);
    await go(t, 'y', dropped.y);
  }
  await t.wait(400);
  const got = await t.eval(() => ({ keys: window.__qf.game.services.dungeon?.keys, flag: !!window.__qf.game.services.save.flags['pickup:carrier-key'] }));
  t.assert(got.keys === 1 && got.flag, `walked onto the key (keys ${got.keys}, flag ${got.flag})`);
  // Next visit: the carrier is back, but its key is not.
  await warpTo(t, 'arena', 'arena_room', 128, 168, 'up');
  t.assert((await alive(t, 'enemy.soldier')) === 1, 'the carrier is back on the next visit');
  t.assert(await fight(t, 'Key carrier again'), 'beat the carrier again');
  await t.wait(600);
  t.assert(!(await key()), 'no second key');
  t.assert((await t.eval(() => window.__qf.game.services.dungeon?.keys)) === 1, 'still one key');
  await t.shotCanvas('carrier-no-second-key');
}

async function guardHallShutter(t) {
  await startSample(t);
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = true;
    s.save.items.sword = 1;
  });
  await warpTo(t, KEEP, 'kp_guard_hall', 128, px(12), 'up');
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === false, 'the Guard Hall shutter starts closed');
  t.assert(await fight(t, 'Guard Hall'), 'beat the soldiers');
  await t.wait(700);
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === true, 'the shutter opened');
  await path(t, 'to the shutter', [['x', 128], ['y', px(3)]]);
  t.assert(await walkInto(t, 'ArrowUp', 'kp_beetle_pits', 5000), 'through the shutter');
  t.assert(await walkInto(t, 'ArrowDown', 'kp_guard_hall', 5000), 'back into the Guard Hall');
  t.assert((await alive(t, 'enemy.soldier')) === 3, 'the soldiers are back');
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === true, 'the shutter stays open behind the hero');
  await t.shotCanvas('guard-hall-back-from-north');
  await path(t, 'to the south door', [['x', 128], ['y', px(12)]]);
  t.assert(await walkInto(t, 'ArrowDown', 'kp_entrance', 5000), 'out to the entrance hall');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_guard_hall', 5000), 'in from the south again');
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === true, 'the shutter is still open from the south');
}

async function lockedDoorLink(t) {
  await t.eval(() => { window.__qf.game.services.dungeon.keys = 1; });
  await warpTo(t, KEEP, 'kp_guard_hall', px(13), 112, 'right');
  t.assert(await walkInto(t, 'ArrowRight', 'kp_block_room', 6000), 'the key opened the east door');
  t.assert((await t.eval(() => window.__qf.game.services.dungeon.keys)) === 0, 'the door took the key');
  t.assert((await doorOpen(t, 'kp_r4_door_w')) === true, 'the Block Room side of the link is open too');
  await warpTo(t, KEEP, 'kp_guard_hall', 128, 112, 'right');
  t.assert((await doorOpen(t, 'kp_g1_door_e')) === true, 'the Guard Hall side stays open on the next visit');
  await t.shotCanvas('east-door-open');
}

async function lairDeath(t) {
  // Enter the keep through its real entrance (the warp sets the respawn point).
  await warpTo(t, 'ellendor', 'ow_keep_gate', 128, px(6), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_entrance', 5000), 'walked into the keep');
  await warpTo(t, KEEP, 'kp_boss', 128, px(1), 'down');
  await path(t, 'into the lair', [['y', px(4)]]);
  await t.wait(500);
  t.assert((await doorOpen(t, 'kp_boss_door_n')) === false, 'the lair shutter slammed shut');
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.debug.invincible = false;
    s.save.hp = 1;
    s.player.hurtPlayer({ damage: 2, kind: 'contact', source: null, dx: 0, dy: 1 });
  });
  const died = await t.page.waitForFunction(() => window.__qf.game.state === 'gameOver', undefined, { timeout: 8000 })
    .then(() => true, () => false);
  t.assert(died, 'the hero died in the sealed lair');
  await t.wait(2800);
  await t.shotCanvas('lair-game-over');
  await t.press('KeyX');
  await t.page.waitForFunction(() => window.__qf.game.state === 'playing', undefined, { timeout: 6000 }).catch(() => {});
  const s = await t.eval(() => ({ room: window.__qf.game.services.room.def.id, hp: window.__qf.game.services.save.hp }));
  t.assert(s.room === 'kp_entrance' && s.hp === 6, `CONTINUE starts at the keep's entrance with full hearts (${s.room}, hp ${s.hp})`);
  await t.shotCanvas('continued-at-entrance');
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await warpTo(t, KEEP, 'kp_boss', 128, px(1), 'down');
  await path(t, 'into the lair again', [['y', px(4)]]);
  await t.wait(500);
  t.assert((await doorOpen(t, 'kp_boss_door_n')) === false, 'the lair seals again while the worm lives');
  t.assert((await alive(t, 'boss.worm')) === 1, 'the worm is back');
}

export default async function (t) {
  await keyCarrier(t);
  await guardHallShutter(t);
  await lockedDoorLink(t);
  await lairDeath(t);
}
