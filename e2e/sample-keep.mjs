// The Hollow Keep, start to finish, on #/playtest/sample: the Guard Hall shutter,
// the Lantern, the Map and the key chest that appears in the West Wing, the first
// locked door, the block puzzle, the Compass and the stairs (taken with the
// direction kept held: one floor change each way), the dark hall, the torch puzzle (real lantern flames), the second locked door, the Big Key, the
// Bow from the big chest, the crystal switch (a real arrow), the boss door, the
// Giant Worm's shutters, the crystal and the trip home to the Elder.
// Fights are skipped by defeating enemies directly; everything else is played.
// Screenshots land in e2e-out/sample-keep/.
import { boxText, closeDialogues, mapShot, px, snap, startSample, talkFrom, walkInto, warpTo } from './sample-opening.mjs';

const KEEP = 'hollow_keep';

const warp = (t, room, x, y, dir) => warpTo(t, KEEP, room, x, y, dir);

/** Defeat every enemy that counts for "enemies cleared" (again for any that split); returns the first wave's size. */
async function defeatEnemies(t) {
  let first = -1;
  for (let i = 0; i < 6; i++) {
    const n = await t.eval(() => {
      const foes = window.__qf.game.services.entities.filter((e) => e.countsForClear && !e.dead);
      for (const e of foes) e.die();
      return foes.length;
    });
    if (first < 0) first = n;
    if (n === 0) break;
    await t.wait(150);
  }
  return first;
}

/** Stand below the chest at pixel x, tile row ty, and open it. */
async function openChest(t, room, x, ty) {
  await warp(t, room, x, px(ty + 1), 'up');
  await t.press('KeyX');
  await t.wait(400);
  await closeDialogues(t);
}

/** Press the item button until `torch` burns (the first press can land during a hurt flinch). */
async function lightTorch(t, torch) {
  for (let i = 0; i < 3; i++) {
    await t.press('KeyC');
    await t.wait(700);
    if (await t.eval((id) => window.__qf.game.services.findEntity(id)?.lit === true, torch)) return true;
  }
  return false;
}

/** Log where the hero is and flag a page reload (a reload restarts the playtest). */
async function trace(t, label) {
  const s = await t.eval(snap);
  const reloaded = await t.eval(() => window.__sampleRun !== true);
  t.assert(!reloaded, `no page reload before "${label}"`);
  t.log(label, `${s.state} ${s.room} (${s.x},${s.y}) hp ${s.hp}/${s.maxHp} keys ${s.keys}`);
}

const doorOpen = (t, id) => t.eval((d) => window.__qf.game.services.findEntity(d)?.isOpen ?? null, id);

/** Hold `key` for `ms` (through any warp it triggers); returns the rooms the hero played in, in order. */
async function holdThrough(t, key, ms) {
  const rooms = [];
  await t.page.keyboard.down(key);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const id = await t.eval(() => window.__qf.game.services.room.def.id);
    if (rooms[rooms.length - 1] !== id) rooms.push(id);
    await t.wait(50);
  }
  await t.page.keyboard.up(key);
  await t.wait(200);
  return rooms;
}

/** Take the stairs with the direction kept held (as players do): exactly one floor change each way. */
async function stairsHeld(t) {
  await warp(t, 'kp_blade_hall', px(2), px(4), 'up');
  const up = await holdThrough(t, 'ArrowUp', 3000);
  t.assert(up.join() === 'kp_blade_hall,kp_dark_hall', `holding UP climbs the stairs exactly once (${up.join(' -> ')})`);
  await t.shotCanvas('dark-hall-lantern');
  const off = await holdThrough(t, 'ArrowDown', 600);
  const s = await t.eval(snap);
  t.assert(off.join() === 'kp_dark_hall' && s.player !== 'fall' && s.y > px(5),
    `stepping DOWN off the landing walks onto the walkway, not into a pit (${off.join()} ${s.player} y=${s.y})`);
  await warp(t, 'kp_dark_hall', px(2), px(4), 'up');
  const down = await holdThrough(t, 'ArrowUp', 3000);
  t.assert(down.join() === 'kp_dark_hall,kp_blade_hall', `holding UP takes the stairs down exactly once (${down.join(' -> ')})`);
}

async function guardHallAndLantern(t) {
  t.assert(await walkInto(t, 'ArrowUp', 'kp_guard_hall'), 'walked into the Guard Hall');
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === false, 'the north shutter starts closed');
  await t.shotCanvas('guard-hall');
  t.assert((await defeatEnemies(t)) === 3, 'three soldiers stood guard');
  await t.wait(600);
  t.assert((await doorOpen(t, 'kp_g1_door_n')) === true, 'the shutter opens once the soldiers are gone');

  await trace(t, 'Beetle Pits');
  await warp(t, 'kp_guard_hall', 128, px(2), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_beetle_pits'), 'through the shutter into the Beetle Pits');
  await t.shotCanvas('beetle-pits');
  await openChest(t, 'kp_beetle_pits', 128, 2);
  t.assert((await t.eval(snap)).items.lantern === 1, 'found the Lantern');
}

async function westWingAndFirstDoor(t) {
  await trace(t, 'West Wing');
  await warp(t, 'kp_beetle_pits', px(1), 112, 'left');
  t.assert(await walkInto(t, 'ArrowLeft', 'kp_west_wing'), 'into the West Wing');
  t.assert(!(await t.eval(snap)).ids.includes('kp_w1_key'), 'the key chest is hidden at first');
  await openChest(t, 'kp_west_wing', px(2), 4);
  t.assert((await t.eval(snap)).map === true, 'found the Map');
  await defeatEnemies(t);
  await t.wait(900);
  t.assert((await t.eval(snap)).ids.includes('kp_w1_key'), 'the key chest appeared when the room was cleared');
  await t.shotCanvas('west-wing-key-chest');
  await openChest(t, 'kp_west_wing', 128, 2);
  t.assert((await t.eval(snap)).keys === 1, 'got the first small key');

  await trace(t, 'Locked east door');
  await warp(t, 'kp_guard_hall', px(14), 112, 'right');
  t.assert(await walkInto(t, 'ArrowRight', 'kp_block_room', 3500), 'walked through the locked east door');
  t.assert((await t.eval(snap)).keys === 0, 'the door took the key');
}

async function blockPuzzleAndStairs(t) {
  await trace(t, 'Block Room');
  // Slide the loose block aside, push the plug onto the switch. (No warps inside a
  // room from here on: a warp reloads the room and resets blocks and torches.)
  await warp(t, 'kp_block_room', px(11), px(8), 'up');
  await defeatEnemies(t);
  await t.hold('ArrowUp', 700);
  await t.wait(300);
  const stuck = await t.eval(() => Math.round(window.__qf.game.services.findEntity('kp_r4_block').y));
  t.assert(stuck === px(7), `the loose block cannot be shoved up into the chute (y=${stuck})`);
  await warp(t, 'kp_block_room', px(12), px(7), 'left');
  await defeatEnemies(t);
  await t.hold('ArrowLeft', 620);
  await t.wait(300);
  const loose = await t.eval(() => Math.round(window.__qf.game.services.findEntity('kp_r4_block').x));
  t.assert(loose === px(10), `the loose block slid left (x=${loose})`);
  await t.hold('ArrowUp', 1900);
  await t.wait(400);
  t.assert((await t.eval(snap)).flags.includes('door:kp_d_block_blade'), 'the plug on the switch opened the north shutter');
  await t.shotCanvas('block-puzzle-solved');

  await trace(t, 'Blade Hall');
  await warp(t, 'kp_block_room', 128, px(1), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_blade_hall'), 'through the shutter into the Blade Hall');
  await t.shotCanvas('blade-hall');
  await openChest(t, 'kp_blade_hall', 128, 3);
  t.assert((await t.eval(snap)).compass === true, 'found the Compass');
  await mapShot(t, 'keep-map');
  await stairsHeld(t);
}

async function torchPuzzleAndBigKey(t) {
  await trace(t, 'Torch Room');
  await warp(t, 'kp_dark_hall', 128, px(12), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'kp_torch_room'), 'crossed the dark hall into the Torch Room');
  await t.eval(() => { window.__qf.game.services.save.equipped = 'lantern'; });
  await warp(t, 'kp_torch_room', px(4), px(5), 'up');
  await defeatEnemies(t);
  t.assert(await lightTorch(t, 'kp_r8_torch_1'), 'the lantern lit the first torch');
  await t.hold('ArrowDown', 900);
  await t.hold('ArrowRight', 1270);
  await t.hold('ArrowUp', 150);
  t.assert(await lightTorch(t, 'kp_r8_torch_2'), 'the lantern lit the second torch');
  await t.wait(500);
  t.assert((await t.eval(snap)).ids.includes('kp_r8_key'), 'the key chest appeared when both torches burned');
  await t.shotCanvas('torches-lit');
  await openChest(t, 'kp_torch_room', px(8), 6);
  t.assert((await t.eval(snap)).keys === 1, 'got the second small key');

  await trace(t, 'The second locked door');
  await warp(t, 'kp_torch_room', px(1), 112, 'left');
  t.assert(await walkInto(t, 'ArrowLeft', 'kp_eye_gallery', 3500), 'unlocked the gallery door');
  t.assert((await t.eval(snap)).keys === 0, 'the gallery door took the key');
  await t.shotCanvas('eye-gallery');
  await openChest(t, 'kp_eye_gallery', px(1), 6);
  t.assert((await t.eval(snap)).bigKey === true, 'found the Big Key');
}

async function bowAndPegs(t) {
  await trace(t, 'Big Chest Room');
  await warp(t, 'kp_eye_gallery', 128, px(1), 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'kp_big_chest'), 'into the Big Chest Room');
  await defeatEnemies(t);
  await warp(t, 'kp_big_chest', 128, px(6), 'up');
  await t.press('KeyX');
  await t.wait(500);
  await t.shotCanvas('big-chest-bow');
  await closeDialogues(t);
  t.assert((await t.eval(snap)).items.bow === 1, 'the big chest held the Bow');

  await trace(t, 'Peg Room');
  await t.eval(() => {
    const sv = window.__qf.game.services;
    sv.giveItem('arrows', 10);
    sv.save.equipped = 'bow';
  });
  await warp(t, 'kp_big_chest', px(1), 112, 'left');
  t.assert(await walkInto(t, 'ArrowLeft', 'kp_peg_room'), 'into the Peg Room');
  await t.shotCanvas('peg-room-red');
  await warp(t, 'kp_peg_room', 128, px(10), 'up');
  await t.press('KeyC');
  await t.wait(1200);
  t.assert((await t.eval(snap)).flags.includes(`pegs:${KEEP}`), 'the arrow flipped the crystal switch (red pegs lowered)');
  await t.shotCanvas('peg-room-blue');
}

async function bossAndCrystal(t) {
  await trace(t, 'The boss door');
  await warp(t, 'kp_peg_room', 128, px(11), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'kp_boss', 4000), 'through the big-key door into the lair');
  await t.hold('ArrowDown', 500);
  await t.wait(500);
  t.assert((await doorOpen(t, 'kp_boss_door_n')) === false, 'the shutter slammed shut behind the hero');
  await t.shotCanvas('boss-worm');
  await defeatEnemies(t);
  await t.wait(2500);
  t.assert((await doorOpen(t, 'kp_boss_door_s')) === true, 'the way to the crystal opens after the worm falls');
  const music = () => t.eval(() => window.__qf.game.services.audio.currentMusic);
  t.assert((await music()) === 'dungeon', `the boss theme stops with the worm (${await music()})`);
  await t.shotCanvas('boss-defeated');

  await trace(t, 'The Sun Crystal');
  await warp(t, 'kp_boss', 128, px(12), 'down');
  t.assert(await walkInto(t, 'ArrowDown', 'kp_pedestal'), 'into the Crystal Sanctum');
  await t.shotCanvas('crystal-pedestal');
  await warp(t, 'kp_pedestal', 128, px(5), 'up');
  await t.press('KeyX');
  await t.wait(500);
  const plaque = await boxText(t);
  t.assert(plaque !== null && plaque.includes('SUN CRYSTAL'), `the inscription names the Sun Crystal (${plaque})`);
  await closeDialogues(t);
  await warp(t, 'kp_boss', 128, px(8), 'down');
  await t.wait(300);
  t.assert((await music()) === 'dungeon', `a cleared lair plays the dungeon theme, not the boss theme (${await music()})`);
  await warp(t, 'kp_pedestal', 128, px(9), 'up');
  await t.hold('ArrowUp', 500);
  await t.wait(1500);
  await t.shotCanvas('crystal-get');
  const boxes = [];
  for (let i = 0; i < 30; i++) {
    if ((await t.eval(snap)).room === 'ow_keep_gate') break;
    const text = await t.eval(() => {
      const box = window.__qf.game.services.dialogueBox;
      const cur = box?.current;
      return cur ? cur.boxes[box.boxIndex].text : null;
    });
    if (text && boxes.at(-1) !== text) boxes.push(text);
    await t.press('KeyX', 60);
    await t.wait(300);
  }
  t.log('crystal boxes', boxes);
  t.assert(boxes.length === 1 && boxes[0].includes('You got the Sun Crystal!'), `one crystal message, naming the Sun Crystal (${JSON.stringify(boxes)})`);
  await t.until(() => window.__qf.game.state === 'playing', undefined, 4000);
  const s = await t.eval(snap);
  t.assert(s.flags.includes(`crystal:${KEEP}`), 'the crystal is ours');
  t.assert(s.room === 'ow_keep_gate', `the dungeon-complete flow carried the hero outside (${s.room})`);
  await t.shotCanvas('back-outside');
}

async function homeToTheElder(t) {
  await trace(t, 'Home to the Elder');
  const before = (await t.eval(snap)).maxHp;
  await warpTo(t, 'ellendor', 'ow_village', px(13), px(11), 'up');
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('elder-thanks');
  const music = () => t.eval(() => window.__qf.game.services.audio.currentMusic);
  // The heart container's fanfare is the celebration here (the victory jingle played at the crystal).
  t.assert((await music()) === 'village', `the village tune plays under the thanks (${await music()})`);
  await closeDialogues(t);
  await t.wait(400);
  await closeDialogues(t);
  await t.wait(1500);
  t.assert((await music()) === 'village', `the village tune plays on after the fanfare (${await music()})`);
  const s = await t.eval(snap);
  t.assert(s.flags.includes('questDone'), 'quest done');
  t.assert(s.maxHp === before + 2, `the Elder's heart container (${before} -> ${s.maxHp})`);
  t.assert(s.ids.includes('vil_sign_celebrate'), 'the celebration sign went up');
  await warpTo(t, 'ellendor', 'ow_village', px(11), px(9), 'up');
  await t.press('KeyX');
  await t.wait(700);
  await t.shotCanvas('celebration-sign');
  await closeDialogues(t);
  const bram = await talkFrom(t, 'ellendor', 'ow_village', px(25), px(4), 'right');
  t.assert(bram !== null && bram.includes('Back in one piece'), `Bram has new words after the quest (${bram})`);
}

export default async function (t) {
  await startSample(t, `?w=${KEEP}&r=kp_entrance&x=128&y=${px(11)}`);
  // As in normal play: the Elder's sword (and its flag) come before the keep.
  await t.eval(() => {
    const sv = window.__qf.game.services;
    sv.giveItem('sword', 1);
    sv.setFlag('gotSword', true);
    // Enemies respawn whenever a warp reloads a room; keep the scripted hero alive meanwhile.
    sv.debug.invincible = true;
  });
  await t.wait(300);
  await guardHallAndLantern(t);
  await westWingAndFirstDoor(t);
  await blockPuzzleAndStairs(t);
  await torchPuzzleAndBigKey(t);
  await bowAndPegs(t);
  await bossAndCrystal(t);
  await homeToTheElder(t);
}
