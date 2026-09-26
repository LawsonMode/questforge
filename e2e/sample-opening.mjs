// "The Hollow Crown" opening on #/playtest/sample: wake up in the hero's house,
// open the rupee chest, walk out into Ellendor, get turned back by the gate
// guard, receive the sword from Elder Rowan (the guard steps aside), leave
// through the gate, tour every overworld screen and walk into the Hollow Keep.
// Screenshots land in e2e-out/sample-opening/.
//
// Also exports the helpers the other sample-* scenarios share.

/** Pixel centre of tile `t`. */
export const px = (t) => t * 16 + 8;

/**
 * Mute the dev server's hot-reload socket in this page: other agents editing
 * sources mid-run would otherwise reload the page and restart the playtest.
 */
export async function freezeHotReload(t) {
  await t.page.addInitScript(() => {
    const Native = window.WebSocket;
    const Quiet = function (url, protocols) {
      const ws = new Native(url, protocols);
      if (protocols === 'vite-hmr') {
        const add = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, fn, opts) => (type === 'message' ? undefined : add(type, fn, opts));
      }
      return ws;
    };
    Quiet.prototype = Native.prototype;
    Object.assign(Quiet, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Quiet;
  });
}

/** Open the sample in playtest (`query` = '?w=&r=&x=&y=' start spot) and wait for gameplay. */
export async function startSample(t, query = '') {
  await freezeHotReload(t);
  await t.goto(`#/playtest/sample${query}`);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 8000);
  await t.eval(() => { window.__sampleRun = true; });
  await t.wait(400);
}

/** Where the hero is and what the save holds. */
export const snap = () => {
  const g = window.__qf.game;
  const s = g.services;
  const d = s.dungeon;
  return {
    state: g.state, world: s.room.world.id, room: s.room.def.id, x: Math.round(s.player.x), y: Math.round(s.player.y),
    player: s.player.state, rupees: s.save.rupees, bombs: s.save.bombs, arrows: s.save.arrows,
    hp: s.save.hp, maxHp: s.save.maxHp, heartPieces: s.save.heartPieces, items: { ...s.save.items },
    keys: d ? d.keys : null, map: d?.map, compass: d?.compass, bigKey: d?.bigKey,
    flags: Object.keys(s.save.flags), ids: s.entities.filter((e) => !e.dead).map((e) => e.id),
  };
};

/** Text of the dialogue box on screen, or null. */
export const boxText = (t) => t.eval(() => {
  const db = window.__qf.game.services.dialogueBox;
  const box = db.current && db.current.boxes[db.boxIndex];
  return box ? box.lines.join(' ') : null;
});

/** Talk to whoever stands in front of (x, y) facing `dir`; returns the first box of what they say. */
export async function talkFrom(t, world, room, x, y, dir) {
  await warpTo(t, world, room, x, y, dir);
  await t.press('KeyX');
  await t.wait(500);
  const text = await boxText(t);
  await closeDialogues(t);
  return text;
}

/** Teleport instantly (reloads the target room). */
export async function warpTo(t, world, room, x, y, dir) {
  await t.eval((tg) => window.__qf.game.warpNow(tg), { world, room, x, y, dir });
  await t.wait(200);
}

/** Press the action button until dialogue and item-get poses are over. */
export async function closeDialogues(t, max = 40) {
  for (let i = 0; i < max; i++) {
    const st = await t.eval(() => ({ state: window.__qf.game.state, p: window.__qf.game.services.player.state }));
    if (st.state === 'playing' && st.p !== 'itemGet') return;
    await t.press('KeyX', 60);
    await t.wait(250);
  }
}

/** Hold a direction until the hero plays in `room`; true if he got there within `ms`. */
export async function walkInto(t, key, room, ms = 3000) {
  await t.page.keyboard.down(key);
  const arrived = await t.page.waitForFunction(
    (id) => window.__qf.game.services.room.def.id === id && window.__qf.game.state === 'playing', room, { timeout: ms },
  ).then(() => true, () => false);
  await t.page.keyboard.up(key);
  await t.wait(250);
  return arrived;
}

/** Open the map (Shift), screenshot it, close it again. */
export async function mapShot(t, label) {
  await t.press('ShiftLeft');
  await t.wait(600);
  t.assert((await t.eval(() => window.__qf.game.state)) === 'paused', `the map opened (${label})`);
  await t.shotCanvas(label);
  await t.press('ShiftLeft');
  await t.page.waitForFunction(() => window.__qf.game.state === 'playing', undefined, { timeout: 3000 }).catch(() => {});
  t.assert((await t.eval(() => window.__qf.game.state)) === 'playing', `the map closed (${label})`);
}

/** Talk to the Elder until the conversation (and any item-get) is over; true if the item-get pose showed. */
async function talkToElder(t, shotLabel) {
  await warpTo(t, 'ellendor', 'ow_village', px(13), px(11), 'up');
  await t.press('KeyX');
  await t.wait(700);
  await t.shotCanvas(shotLabel);
  let sawItemGet = false;
  for (let i = 0; i < 40; i++) {
    const st = await t.eval(() => ({ state: window.__qf.game.state, p: window.__qf.game.services.player.state }));
    if (st.p === 'itemGet' && !sawItemGet) {
      sawItemGet = true;
      await t.wait(300);
      await t.shotCanvas('item-get');
    }
    if (st.state === 'playing' && st.p !== 'itemGet' && i > 3) break;
    await t.press('KeyX', 60);
    await t.wait(260);
  }
  await closeDialogues(t);
  return sawItemGet;
}

export default async function (t) {
  await startSample(t);
  let s = await t.eval(snap);
  t.assert(s.room === 'in_hero_house', `starts in the hero's house (got ${s.room})`);
  t.assert(!s.items.sword && s.items.shield === 1, 'shield only at the start');
  await t.shotCanvas('hero-house');

  // ---- The rupee chest beside the shelves.
  await warpTo(t, 'ellendor_homes', 'in_hero_house', px(11), px(5), 'up');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas('chest-rupees');
  await closeDialogues(t);
  s = await t.eval(snap);
  t.assert(s.rupees === 20, `the chest held 20 rupees (have ${s.rupees})`);

  // ---- Out of the door onto the village road.
  await warpTo(t, 'ellendor_homes', 'in_hero_house', 128, px(10), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'ow_village'), 'left the house into the village');
  s = await t.eval(snap);
  t.assert(Math.abs(s.x - px(4)) < 12 && s.y > px(4), `stands on the hero's doorstep (${s.x}, ${s.y})`);
  await t.shotCanvas('village-doorstep');

  // ---- The gate guard will not let a swordless hero pass.
  await warpTo(t, 'ellendor', 'ow_village', 24 * 16, px(5), 'up');
  await t.hold('ArrowUp', 700);
  s = await t.eval(snap);
  t.assert(s.room === 'ow_village' && s.y > px(3), `the guard blocks the gate (${s.room} y=${s.y})`);
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('guard-blocks');
  await closeDialogues(t);

  // ---- Elder Rowan on the plaza hands over his sword.
  const sawItemGet = await talkToElder(t, 'elder-talks');
  await t.wait(300);
  s = await t.eval(snap);
  t.assert(s.items.sword === 1, `got the sword (level ${s.items.sword})`);
  t.assert(s.flags.includes('gotSword'), 'gotSword flag set');
  t.assert(sawItemGet, 'the sword came with the item-get pose');
  t.assert(!s.ids.includes('vil_guard') && s.ids.includes('vil_guard_aside'),
    `the guard stepped aside (${s.ids.filter((i) => i.startsWith('vil_guard'))})`);

  // ---- Talking again gives the hint, not a second sword.
  await talkToElder(t, 'elder-hint');
  t.assert((await t.eval(snap)).items.sword === 1, 'still one sword after the hint');

  // ---- Bram, now beside the road, has a word for the hero.
  const bram = await talkFrom(t, 'ellendor', 'ow_village', px(25), px(4), 'right');
  t.assert(bram !== null && bram.includes('sword'), `Bram waves the hero through (${bram})`);

  // ---- Through the gate to the Crossroads.
  await warpTo(t, 'ellendor', 'ow_village', 24 * 16, px(6), 'up');
  await t.shotCanvas('gate-open');
  t.assert(await walkInto(t, 'ArrowUp', 'ow_crossroads', 4000), 'walked north into the Crossroads');
  await t.shotCanvas('crossroads');

  // ---- Tour of the valley.
  const tour = [
    ['ow_meadow', px(6), px(8)], ['ow_cliffs', px(11), px(4)], ['ow_keep_gate', 128, px(6)],
    ['ow_deepwood', px(10), px(5)], ['ow_whisperwood', px(12), px(9)], ['ow_lake', px(12), px(7)],
  ];
  for (const [room, x, y] of tour) {
    await warpTo(t, 'ellendor', room, x, y, 'down');
    t.assert((await t.eval(snap)).room === room, `warped to ${room}`);
    await t.shotCanvas(room.replace('ow_', 'screen-'));
  }
  await mapShot(t, 'valley-map');

  // ---- A screen edge scroll: Crossroads -> Whisperwood across the east bridge.
  await warpTo(t, 'ellendor', 'ow_crossroads', px(11), 128, 'right');
  t.assert(await walkInto(t, 'ArrowRight', 'ow_whisperwood', 4000), 'crossed the bridge east into Whisperwood');

  // ---- Into the Hollow Keep through its arch, and back out.
  await warpTo(t, 'ellendor', 'ow_keep_gate', 128, px(6), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_entrance', 4000), 'entered the keep');
  await t.wait(400);
  await t.shotCanvas('keep-entrance');
  t.assert(await walkInto(t, 'ArrowDown', 'ow_keep_gate', 4000), 'walked back out of the keep');
}
