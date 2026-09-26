// Wave B playthrough: "The Hollow Crown" from the title screen to the Elder's
// thanks on #/play/sample, played with the keyboard. warpNow only hops between
// key spots; every critical interaction is real input: file creation and name
// entry, chests (walk up into them + X), the Elder's sword, fights with the
// sword (a small bot: walk up to the nearest foe, face it, swing), the Guard
// Hall shutter, the West Wing key chest, both locked doors, the block puzzle,
// the dark hall crossed by lantern light, both torches lit with the lantern,
// the Big Key, the Bow, arrows from thrown pots, equipping through the pause
// menu, an arrow into the crystal switch, the big-key door, the Giant Worm,
// its heart container, the crystal and the dungeon-complete flow, and the
// Elder's reward. The hero is debug-invincible (fights are real, deaths aren't
// the point). Screenshots land in e2e-out/wave-b-playthrough/.
import { boxText, closeDialogues, freezeHotReload, mapShot, px, snap, walkInto, warpTo } from './sample-opening.mjs';

const KEEP = 'hollow_keep';
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

// ---------------------------------------------------------------- helpers

/** A step the rest of the run depends on: record the failure and stop the playthrough. */
function must(t, cond, msg) {
  t.assert(cond, msg);
  if (!cond) throw new Error(`playthrough stopped: ${msg}`);
}

/** Log where the hero is; flags a page reload (which would restart the game). */
async function trace(t, label) {
  const reloaded = await t.eval(() => window.__ptRun !== true);
  t.assert(!reloaded, `no page reload before "${label}"`);
  const s = await t.eval(snap);
  t.log(`${label}: ${s.state}/${s.player} ${s.room} (${s.x},${s.y}) hp ${s.hp}/${s.maxHp} keys ${s.keys} rupees ${s.rupees}`);
}

/** Hold one arrow until the hero's centre reaches `to` on `axis`; false if it never gets there. */
export async function go(t, axis, to, ms = 6000) {
  const from = await t.eval((a) => window.__qf.game.services.player[a], axis);
  const d = to - from;
  if (Math.abs(d) <= 1.5) return true;
  const key = axis === 'x' ? (d > 0 ? KEY.right : KEY.left) : (d > 0 ? KEY.down : KEY.up);
  await t.page.keyboard.down(key);
  const ok = await t.page.waitForFunction(({ a, to, s }) => {
    const p = window.__qf.game && window.__qf.game.services && window.__qf.game.services.player;
    return !!p && (s > 0 ? p[a] >= to - 1.5 : p[a] <= to + 1.5);
  }, { a: axis, to, s: Math.sign(d) }, { timeout: ms, polling: 16 }).then(() => true, () => false);
  await t.page.keyboard.up(key);
  await t.wait(50);
  return ok;
}

/** Walk a path of [axis, px] legs; asserts (with the hero's spot) when a leg is blocked. */
export async function path(t, label, legs) {
  for (const [axis, to] of legs) {
    if (await go(t, axis, to)) continue;
    const s = await t.eval(snap);
    t.assert(false, `${label}: blocked walking ${axis} -> ${to} at (${s.x},${s.y}) in ${s.room} (${s.player})`);
    return false;
  }
  return true;
}

/** Hold `keys` until the page function `fn(arg)` holds (game time can lag wall time under load). */
async function holdUntil(t, keys, fn, arg, ms = 5000) {
  for (const k of keys) await t.page.keyboard.down(k);
  const ok = await t.page.waitForFunction(fn, arg, { timeout: ms, polling: 16 }).then(() => true, () => false);
  for (const k of [...keys].reverse()) await t.page.keyboard.up(k);
  await t.wait(50);
  return ok;
}

/** Walk in direction `dir` until the hero faces it and has not moved for 0.15 s of game time (flush with something). */
export async function pushInto(t, dir, ms = 3000) {
  await t.eval(() => { window.__still = null; });
  return holdUntil(t, [KEY[dir]], (d) => {
    const s = window.__qf.game.services;
    const p = s.player;
    const w = window.__still;
    if (!w || Math.abs(w.x - p.x) > 0.2 || Math.abs(w.y - p.y) > 0.2) {
      window.__still = { x: p.x, y: p.y, t: s.time };
      return false;
    }
    return p.facing === d && s.time - w.t >= 0.15;
  }, dir, ms);
}

/** Turn to face `dir` with a one-tick tap (the input latch makes it count). */
async function face(t, dir) {
  await t.press(KEY[dir], 16);
  await t.wait(60);
}

/** Walk up into whatever is above (a chest), then press the action button and clear the item message. */
async function openAbove(t, label) {
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas(label);
  await closeDialogues(t);
}

/** Walk onto the live entity `id` (x first, then y) until it is gone; true once it was collected. */
async function collect(t, id) {
  const at = await t.eval((i) => {
    const e = window.__qf.game.services.findEntity(i);
    return e ? { x: Math.round(e.x), y: Math.round(e.y) } : null;
  }, id);
  if (!at) return false;
  const present = () => t.eval((i) => !!window.__qf.game.services.findEntity(i), id);
  for (const [axis, to] of [['x', at.x], ['y', at.y]]) {
    if (!(await present())) break;
    await go(t, axis, to);
  }
  await t.wait(300);
  return !(await present());
}

/** Current dungeon/save numbers. */
const save = (t) => t.eval(snap);

/** Nearest live target: 'clear' = enemies that count for enemiesCleared, 'tail' = the worm's tail. */
const scan = (targets) => {
  const g = window.__qf.game;
  const sv = g && g.services;
  if (!sv) return null;
  const p = sv.player;
  const wanted = (e) => !e.dead && (targets === 'tail' ? e.type === 'boss.worm.tail' : e.countsForClear && e.team === 'enemy');
  let foe = null;
  let best = Infinity;
  let n = 0;
  for (const e of sv.entities) {
    if (!wanted(e)) continue;
    n++;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < best) {
      best = d;
      foe = e;
    }
  }
  return {
    state: g.state, st: p.state, x: p.x, y: p.y, f: p.facing, n, room: sv.room.def.id, w: sv.room.width, h: sv.room.height,
    foe: foe && { x: foe.x, y: foe.y, w: foe.w, h: foe.h, type: foe.type },
  };
};

/** Room edges the fight bot never walks through (px from the edge). */
const EDGE_MARGIN = 14;

/** Drop arrow keys that would carry the hero out of the room (a fight must stay in its room). */
function inside(keys, s) {
  return keys.filter((k) => !(
    (k === KEY.left && s.x < EDGE_MARGIN) || (k === KEY.right && s.x > s.w - EDGE_MARGIN)
    || (k === KEY.up && s.y < EDGE_MARGIN) || (k === KEY.down && s.y > s.h - EDGE_MARGIN)));
}

/**
 * Fight with the real sword until no target is left: walk up to the nearest
 * foe (axis-aligned), turn to face it and swing; side-steps when stuck.
 * Returns true when the room was cleared within `maxMs`.
 */
export async function fight(t, label, { targets = 'clear', maxMs = 60000 } = {}) {
  const t0 = Date.now();
  let swings = 0;
  let anchor = null;
  let anchorAt = Date.now();
  let dodge = 1;
  let room = null;
  while (Date.now() - t0 < maxMs) {
    const s = await t.eval(scan, targets);
    if (!s || s.state !== 'playing') {
      await t.wait(120);
      continue;
    }
    room ??= s.room;
    if (s.room !== room) {
      t.log(`${label}: the fight left ${room} for ${s.room}`);
      return false;
    }
    if (s.n === 0) {
      t.log(`${label}: cleared with ${swings} swings in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return true;
    }
    const { foe } = s;
    const dx = foe.x - s.x;
    const dy = foe.y - s.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const major = horiz ? dx : dy;
    const minor = horiz ? dy : dx;
    const reach = 16 + (horiz ? foe.w : foe.h) / 2;
    const want = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (Math.abs(major) <= reach && Math.abs(minor) <= 10) {
      if (s.f !== want) await t.press(KEY[want], 25);
      await t.press('KeyZ', 50);
      swings++;
      await t.wait(170);
      continue;
    }
    if (!anchor || Math.hypot(s.x - anchor.x, s.y - anchor.y) > 3) {
      anchor = { x: s.x, y: s.y };
      anchorAt = Date.now();
    } else if (Date.now() - anchorAt > 1200) {
      // Stuck on something: step sideways for a moment.
      dodge = -dodge;
      const side = inside([horiz ? (dodge > 0 ? KEY.down : KEY.up) : (dodge > 0 ? KEY.right : KEY.left)], s);
      if (side.length > 0) await t.hold(side, 350);
      anchorAt = Date.now();
      continue;
    }
    const keys = [];
    if (Math.abs(major) > reach - 4) keys.push(KEY[want]);
    if (Math.abs(minor) > 6) keys.push(KEY[horiz ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left')]);
    if (keys.length === 0) keys.push(KEY[want]);
    const safe = inside(keys, s);
    if (safe.length > 0) await t.hold(safe, 110);
    else await t.wait(110);
  }
  const left = await t.eval(scan, targets);
  t.log(`${label}: NOT cleared after ${swings} swings (${left && left.n} left)`);
  return false;
}

/** Open the pause menu, cycle the item cursor right until `item` is equipped, close it. */
async function equip(t, item, shotLabel) {
  await t.press('Enter');
  await t.wait(400);
  for (let i = 0; i < 6; i++) {
    if ((await t.eval(() => window.__qf.game.services.save.equipped)) === item) break;
    await t.press(KEY.right);
    await t.wait(150);
  }
  if (shotLabel) await t.shotCanvas(shotLabel);
  await t.press('Enter');
  await t.page.waitForFunction(() => window.__qf.game.state === 'playing', undefined, { timeout: 3000 }).catch(() => {});
  t.assert((await t.eval(() => window.__qf.game.services.save.equipped)) === item, `equipped the ${item} in the pause menu`);
}

/** Is the live door `id` open (null when not in this room)? */
const doorOpen = (t, id) => t.eval((d) => {
  const e = window.__qf.game.services.findEntity(d);
  return e ? e.isOpen : null;
}, id);

const warp = (t, room, x, y, dir) => warpTo(t, KEEP, room, x, y, dir);

// ---------------------------------------------------------------- sections

/** Title, file select, name entry, the intro dialogue. */
async function newGame(t) {
  await freezeHotReload(t);
  await t.goto('#/play/sample');
  await t.eval(() => { window.__ptRun = true; });
  await t.wait(1800);
  await t.shotCanvas('title');
  t.assert((await t.eval(() => window.__qf.game.state)) === 'title', 'the title screen shows first');
  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'fileSelect');
  await t.wait(300);
  await t.shotCanvas('file-select');
  await t.press('Enter');
  await t.wait(200);
  await t.page.keyboard.type('Hero');
  await t.wait(150);
  await t.shotCanvas('name-entry');
  await t.press('Enter');
  await t.until(() => ['playing', 'dialogue'].includes(window.__qf.game.state), undefined, 5000);
  await t.wait(900);
  await t.shotCanvas('intro-dialogue');
  t.assert((await t.eval(() => window.__qf.game.state)) === 'dialogue', 'a new file opens with the intro');
  await closeDialogues(t);
  const s = await save(t);
  t.assert(s.room === 'in_hero_house' && !s.items.sword, `wakes up in the hero's house, swordless (${s.room})`);
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await t.shotCanvas('hero-house');
}

/** The rupee chest beside the shelves, then out of the door. */
async function heroHouse(t) {
  await trace(t, 'Hero house');
  await path(t, 'to the chest', [['y', px(5)], ['x', px(11)]]);
  await openAbove(t, 'house-chest');
  t.assert((await save(t)).rupees === 20, 'the house chest held 20 rupees');
  await path(t, 'to the door', [['x', px(10)], ['y', px(10)], ['x', 128]]);
  must(t, await walkInto(t, KEY.down, 'ow_village'), 'walked out of the door into the village');
  await t.shotCanvas('village');
}

/** Elder Rowan's sword; the guard steps aside. */
async function elderSword(t) {
  await trace(t, 'Elder');
  await warpTo(t, 'ellendor', 'ow_village', px(13), px(12), 'up');
  await path(t, 'up to the Elder', [['y', px(11)]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(700);
  await t.shotCanvas('elder-talks');
  const top = await t.eval(() => window.__qf.game.services.dialogueBox.current?.position);
  t.assert(top === 'top', `the box moves to the top while the hero stands low on screen (${top})`);
  let sawItemGet = false;
  for (let i = 0; i < 40; i++) {
    const st = await t.eval(() => ({ state: window.__qf.game.state, p: window.__qf.game.services.player.state }));
    if (st.p === 'itemGet' && !sawItemGet) {
      sawItemGet = true;
      await t.wait(300);
      await t.shotCanvas('sword-get');
    }
    if (st.state === 'playing' && st.p !== 'itemGet' && i > 3) break;
    await t.press('KeyX', 60);
    await t.wait(260);
  }
  await closeDialogues(t);
  const s = await save(t);
  must(t, s.items.sword === 1 && s.flags.includes('gotSword'), 'the Elder gave the sword');
  t.assert(sawItemGet, 'the sword came with the item-get pose');
  t.assert(s.ids.includes('vil_guard_aside') && !s.ids.includes('vil_guard'), 'the gate guard stepped aside');
}

/** Through the gate; a real fight on the Crossroads. */
async function leaveVillage(t) {
  await trace(t, 'Gate');
  await warpTo(t, 'ellendor', 'ow_village', 24 * 16, px(6), 'up');
  must(t, await walkInto(t, KEY.up, 'ow_crossroads', 4000), 'walked through the gate to the Crossroads');
  await t.wait(300);
  await t.shotCanvas('crossroads');
  const before = await t.eval(() => window.__qf.game.services.entities.filter((e) => e.countsForClear && !e.dead).length);
  t.assert(before > 0, `the Crossroads has enemies (${before})`);
  t.assert(await fight(t, 'Crossroads'), 'cleared the Crossroads with the sword');
  await t.shotCanvas('crossroads-cleared');
}

/** The Keep Gate and the entrance arch. */
async function enterKeep(t) {
  await trace(t, 'Keep Gate');
  await warpTo(t, 'ellendor', 'ow_keep_gate', 128, px(6), 'up');
  await t.shotCanvas('keep-gate');
  must(t, await walkInto(t, KEY.up, 'kp_entrance', 4000), 'walked into the Hollow Keep');
  await t.wait(500);
  await t.shotCanvas('keep-entrance');
}

/** Guard Hall: three soldiers keep the north shutter shut. */
async function guardHall(t) {
  await trace(t, 'Guard Hall');
  await path(t, 'up the entrance hall', [['x', 128]]);
  must(t, await walkInto(t, KEY.up, 'kp_guard_hall', 5000), 'walked into the Guard Hall');
  await t.wait(300);
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === false, 'the north shutter starts closed');
  await t.shotCanvas('guard-hall');
  t.assert(await fight(t, 'Guard Hall'), 'beat the three soldiers with the sword');
  await t.wait(700);
  must(t, (await doorOpen(t, 'kp_g1_door_n')) === true, 'the shutter opened once the soldiers were gone');
  await t.shotCanvas('guard-hall-open');
}

/** Beetle Pits: the Lantern chest between the pits. */
async function beetlePits(t) {
  await trace(t, 'Beetle Pits');
  await path(t, 'to the shutter', [['x', 128], ['y', px(3)]]);
  must(t, await walkInto(t, KEY.up, 'kp_beetle_pits', 5000), 'through the shutter into the Beetle Pits');
  await t.shotCanvas('beetle-pits');
  await path(t, 'between the pits', [['x', 128], ['y', px(3)]]);
  await openAbove(t, 'lantern-chest');
  const s = await save(t);
  must(t, s.items.lantern === 1, 'found the Lantern');
}

/** West Wing: the Map, then beat everything for the key chest. */
async function westWing(t) {
  await trace(t, 'West Wing');
  await path(t, 'to the west door', [['y', 112]]);
  must(t, await walkInto(t, KEY.left, 'kp_west_wing', 5000), 'into the West Wing');
  await t.shotCanvas('west-wing');
  t.assert(!(await save(t)).ids.includes('kp_w1_key'), 'the key chest is hidden at first');
  t.assert(await fight(t, 'West Wing'), 'beat the skeletons and the slime with the sword');
  await t.wait(900);
  must(t, (await save(t)).ids.includes('kp_w1_key'), 'the key chest appeared when the room was cleared');
  await t.shotCanvas('west-wing-cleared');
  await path(t, 'to the map chest', [['y', px(6)], ['x', px(2)], ['y', px(5)]]);
  await openAbove(t, 'map-chest');
  must(t, (await save(t)).map === true, 'found the Map');
  await path(t, 'to the key chest', [['y', px(6)], ['x', 128], ['y', px(3)]]);
  await openAbove(t, 'key-chest');
  must(t, (await save(t)).keys === 1, 'got the first small key');
  await mapShot(t, 'map-with-map');
}

/** Back to the Guard Hall's locked east door. */
async function firstLockedDoor(t) {
  await trace(t, 'Locked east door');
  await path(t, 'back to the east door', [['y', 112]]);
  must(t, await walkInto(t, KEY.right, 'kp_beetle_pits', 5000), 'back into the Beetle Pits');
  await path(t, 'down the pits', [['x', 128]]);
  must(t, await walkInto(t, KEY.down, 'kp_guard_hall', 5000), 'back into the Guard Hall');
  await path(t, 'across the guard hall', [['y', 112]]);
  must(t, await walkInto(t, KEY.right, 'kp_block_room', 6000), 'the key opened the east door');
  t.assert((await save(t)).keys === 0, 'the door took the key');
  await t.shotCanvas('block-room');
}

/** Block Room: slide the loose block aside, push the plug up onto the switch. */
async function blockPuzzle(t) {
  await trace(t, 'Block Room');
  await path(t, 'beside the loose block', [['y', px(8)], ['x', px(12)], ['y', px(7)]]);
  await holdUntil(t, [KEY.left], () => window.__qf.game.services.findEntity('kp_r4_block').x <= 168);
  await t.wait(300);
  const loose = await t.eval(() => Math.round(window.__qf.game.services.findEntity('kp_r4_block').x));
  t.assert(loose === px(10), `the loose block slid left (x=${loose})`);
  await path(t, 'under the plug', [['y', px(8)], ['x', px(11)]]);
  await holdUntil(t, [KEY.up], () => window.__qf.game.services.findEntity('kp_r4_plug').y <= 72, undefined, 8000);
  await t.wait(400);
  const plug = await t.eval(() => Math.round(window.__qf.game.services.findEntity('kp_r4_plug').y));
  t.assert(plug === px(4), `the plug sits on the switch (y=${plug})`);
  must(t, (await doorOpen(t, 'kp_r4_door_n')) === true, 'the switch opened the north shutter');
  await t.shotCanvas('block-puzzle-solved');
}

/** Blade Hall: the Compass, then the stairs up. */
async function bladeHall(t) {
  await trace(t, 'Blade Hall');
  await path(t, 'to the north shutter', [['y', px(8)], ['x', px(9)], ['y', px(3)], ['x', 128]]);
  must(t, await walkInto(t, KEY.up, 'kp_blade_hall', 5000), 'through the shutter into the Blade Hall');
  await t.shotCanvas('blade-hall');
  await path(t, 'up the safe lane', [['x', 128], ['y', px(4)]]);
  await openAbove(t, 'compass-chest');
  t.assert((await save(t)).compass === true, 'found the Compass');
  await path(t, 'to the stairs', [['y', px(5)], ['x', px(2)], ['y', px(4)]]);
  must(t, await walkInto(t, KEY.up, 'kp_dark_hall', 4000), 'climbed the stairs');
  await t.wait(400);
  await t.shotCanvas('dark-hall');
}

/** Dark Hall: find the way between the pits by lantern light. */
async function darkHall(t) {
  await trace(t, 'Dark Hall');
  const legs = [['x', 64], ['y', 128], ['x', 192], ['y', 192], ['x', 128]];
  await path(t, 'across the dark hall', legs.slice(0, 3));
  await t.shotCanvas('dark-hall-walkway');
  await path(t, 'across the dark hall', legs.slice(3));
  const s = await save(t);
  t.assert(s.room === 'kp_dark_hall' && s.player !== 'fall', `still on the walkway (${s.room} ${s.player})`);
  must(t, await walkInto(t, KEY.down, 'kp_torch_room', 4000), 'crossed into the Torch Room');
}

/** Torch Room: light both torches with the lantern, take the key. */
async function torchRoom(t) {
  await trace(t, 'Torch Room');
  await t.shotCanvas('torch-room');
  const lit = (id) => t.eval((i) => window.__qf.game.services.findEntity(i)?.lit === true, id);
  const light = async (id) => {
    for (let i = 0; i < 3 && !(await lit(id)); i++) {
      await pushInto(t, 'up');
      await t.press('KeyC');
      await t.wait(700);
    }
    return lit(id);
  };
  await path(t, 'below the first torch', [['y', px(5)], ['x', px(4)]]);
  t.assert(await light('kp_r8_torch_1'), 'the lantern lit the first torch');
  await path(t, 'below the second torch', [['y', px(10)], ['x', px(11)]]);
  t.assert(await light('kp_r8_torch_2'), 'the lantern lit the second torch');
  await t.wait(600);
  must(t, (await save(t)).ids.includes('kp_r8_key'), 'the key chest appeared when both torches burned');
  await t.shotCanvas('torches-lit');
  await path(t, 'below the key chest', [['x', px(8)], ['y', px(7)]]);
  await openAbove(t, 'torch-key-chest');
  must(t, (await save(t)).keys === 1, 'got the second small key');
}

/** The second locked door, the Eye Gallery and the Big Key. */
async function eyeGallery(t) {
  await trace(t, 'Second locked door');
  await path(t, 'to the west door', [['x', px(6)], ['y', 112]]);
  must(t, await walkInto(t, KEY.left, 'kp_eye_gallery', 6000), 'unlocked the gallery door');
  t.assert((await save(t)).keys === 0, 'the gallery door took the key');
  await t.shotCanvas('eye-gallery');
  await path(t, 'along the gallery', [['y', px(7)], ['x', px(1)]]);
  await openAbove(t, 'big-key-chest');
  must(t, (await save(t)).bigKey === true, 'found the Big Key');
  await mapShot(t, 'map-2f-compass');
}

/** Big Chest Room: the Bow; arrows from the pots. */
async function bigChest(t) {
  await trace(t, 'Big Chest Room');
  await path(t, 'to the north door', [['x', 128], ['y', px(2)]]);
  must(t, await walkInto(t, KEY.up, 'kp_big_chest', 5000), 'into the Big Chest Room');
  await path(t, 'up the carpet', [['x', 128], ['y', px(6)]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('bow-get');
  await closeDialogues(t);
  must(t, (await save(t)).items.bow === 1, 'the big chest held the Bow');
  // Lift a pot, throw it at the wall: its arrows drop where it breaks.
  await path(t, 'to the arrow pot', [['y', px(11)], ['x', px(4)]]);
  await pushInto(t, 'left');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas('pot-lifted');
  t.assert((await t.eval(() => window.__qf.game.services.player.state)) === 'carry', 'lifted the pot');
  await face(t, 'right');
  await t.press('KeyX');
  await t.wait(900);
  const drop = await t.eval(() => window.__qf.game.services.entities.find((x) => x.type === 'obj.pickup' && !x.dead)?.id);
  // The room's wandering goblin may stand right beside the hero: the pot then breaks on it at his
  // feet and the arrows are collected at once, leaving no pickup on the floor. Either way the pot's
  // arrows must end up in the quiver.
  if (drop) t.assert(await collect(t, drop), 'walked onto the drop');
  else t.log('the pot broke next to the hero; its drop was collected at once');
  const arrows = (await save(t)).arrows;
  must(t, arrows > 0, `picked up arrows from the pot (${arrows})`);
  await equip(t, 'bow', 'pause-equip-bow');
}

/** Peg Room: an arrow into the crystal switch lowers the red pegs. */
async function pegRoom(t) {
  await trace(t, 'Peg Room');
  await path(t, 'to the west door', [['y', 112]]);
  must(t, await walkInto(t, KEY.left, 'kp_peg_room', 5000), 'into the Peg Room');
  await t.shotCanvas('peg-room');
  await path(t, 'round the walkway', [['x', px(13) + 8], ['y', px(10)], ['x', 128]]);
  await face(t, 'up');
  const before = await t.eval(() => window.__qf.game.services.pegState());
  await t.press('KeyC');
  await t.wait(1200);
  const after = await t.eval(() => window.__qf.game.services.pegState());
  must(t, before === false && after === true, `the arrow flipped the crystal switch (${before} -> ${after})`);
  await t.shotCanvas('pegs-lowered');
}

/** The big-key door and the Giant Worm. */
async function boss(t) {
  await trace(t, 'Boss door');
  must(t, await walkInto(t, KEY.down, 'kp_boss', 6000), 'the Big Key opened the boss door');
  await path(t, 'into the lair', [['y', px(4)]]);
  await t.wait(400);
  t.assert((await doorOpen(t, 'kp_boss_door_n')) === false, 'the shutter slammed shut behind the hero');
  await t.shotCanvas('boss-worm');
  const won = await fight(t, 'Giant Worm', { targets: 'tail', maxMs: 150000 });
  t.assert(won, 'beat the Giant Worm with the sword');
  if (!won) await t.eval(() => window.__qf.game.services.findEntity('kp_boss_worm')?.die());
  await t.wait(300);
  await t.shotCanvas('worm-bursting');
  await t.until(() => window.__qf.game.services.findEntity('kp_boss_worm-heart'), undefined, 8000);
  await t.shotCanvas('heart-container');
  const hpBefore = (await save(t)).maxHp;
  must(t, await collect(t, 'kp_boss_worm-heart'), 'walked onto the heart container');
  await t.shotCanvas('heart-container-get');
  await closeDialogues(t);
  t.assert((await save(t)).maxHp === hpBefore + 2, 'the heart container added a heart');
  must(t, (await doorOpen(t, 'kp_boss_door_s')) === true, 'the south shutter opened after the worm fell');
}

/** The Sun Crystal and the dungeon-complete flow. */
async function crystal(t) {
  await trace(t, 'Crystal');
  await path(t, 'to the south door', [['x', 128], ['y', px(12)]]);
  must(t, await walkInto(t, KEY.down, 'kp_pedestal', 5000), 'into the Crystal Sanctum');
  await t.shotCanvas('crystal-sanctum');
  // The plaque stands between the door and the pedestal: round it, then read it from below.
  await path(t, 'round the plaque', [['x', px(9)], ['y', px(5)], ['x', 128]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(900);
  const plaque = await boxText(t);
  t.assert(!!plaque && plaque.includes('SUN CRYSTAL'), `the plaque names the Sun Crystal (${plaque})`);
  await t.shotCanvas('crystal-plaque');
  await closeDialogues(t);
  must(t, await collect(t, 'kp_ped_crystal'), 'walked onto the crystal');
  await t.wait(900);
  await t.shotCanvas('crystal-get');
  let sawComplete = false;
  for (let i = 0; i < 40; i++) {
    const s = await save(t);
    if (s.room === 'ow_keep_gate' && s.state === 'playing') break;
    const text = await boxText(t);
    if (text && text.includes('You got the Sun Crystal!') && !sawComplete) {
      sawComplete = true;
      await t.shotCanvas('dungeon-complete');
    }
    await t.press('KeyX', 60);
    await t.wait(300);
  }
  const s = await save(t);
  t.assert(sawComplete, 'the crystal message named the Sun Crystal');
  must(t, s.flags.includes(`crystal:${KEEP}`), 'the crystal is ours');
  t.assert(s.room === 'ow_keep_gate', `the dungeon-complete flow carried the hero outside (${s.room})`);
  const respawn = await t.eval(() => window.__qf.game.services.save.respawn.world);
  t.assert(respawn !== KEEP, `the respawn point left the finished keep (${respawn})`);
  await t.shotCanvas('outside-with-crystal');
}

/** Home to the Elder: thanks, a heart container, the celebration sign. */
async function elderThanks(t) {
  await trace(t, 'Home');
  const before = (await save(t)).maxHp;
  await warpTo(t, 'ellendor', 'ow_village', px(13), px(12), 'up');
  await path(t, 'up to the Elder', [['y', px(11)]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(700);
  await t.shotCanvas('elder-thanks');
  await closeDialogues(t);
  await t.wait(400);
  await closeDialogues(t);
  await t.wait(1500);
  const s = await save(t);
  t.assert(s.flags.includes('questDone'), 'quest done');
  t.assert(s.maxHp === before + 2, `the Elder's heart container (${before} -> ${s.maxHp})`);
  t.assert(s.ids.includes('vil_sign_celebrate'), 'the celebration sign went up');
  await t.shotCanvas('the-end');
}

/** The playthrough in order (exported so a run can be resumed mid-way while debugging). */
export const SECTIONS = [
  newGame, heroHouse, elderSword, leaveVillage, enterKeep, guardHall, beetlePits, westWing, firstLockedDoor,
  blockPuzzle, bladeHall, darkHall, torchRoom, eyeGallery, bigChest, pegRoom, boss, crystal, elderThanks,
];

export default async function (t) {
  for (const section of SECTIONS) await section(t);
}
