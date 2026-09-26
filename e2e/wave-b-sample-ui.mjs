// Wave B UI pass on #/play/sample, all with the keyboard: title -> file select
// -> name entry -> intro; the HUD; the pause menu with nothing equippable and
// its map page indoors; a villager's talk trigger; buying bombs at Juno's shop
// and being refused when broke; SAVE from the pause menu; a real death, the
// game-over screen and CONTINUE; SAVE & QUIT back to the menu; then the file
// select showing the saved file and loading it where the hero left off.
// Screenshots land in e2e-out/wave-b-sample-ui/.
import { boxText, closeDialogues, freezeHotReload, px, snap, walkInto, warpTo } from './sample-opening.mjs';
import { path, pushInto } from './wave-b-playthrough.mjs';

const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);
/** Pause-menu option focus: -1 grid, 0 SAVE, 1 SAVE & QUIT, 2 SOUND, 3 RESUME (menu internals, read-only). */
const option = (t) => t.eval(() => window.__qf.game.services.pauseMenu.option);

/** Open the pause menu and move the focus to option `index` (see `option`). */
async function pauseOn(t, index) {
  await t.press('Enter');
  await t.wait(350);
  for (let i = 0; i < 6; i++) {
    const at = await option(t);
    if (at === index) break;
    // Down leaves the item grid for the options; within them up/down move.
    await t.press(at !== -1 && at > index ? 'ArrowUp' : 'ArrowDown');
    await t.wait(90);
  }
  t.assert((await option(t)) === index, `pause focus on option ${index}`);
}

/** Press Enter on the title until the file select opens (the first press may only end the fade-in). */
async function toFileSelect(t) {
  for (let i = 0; i < 5 && (await state(t)) !== 'fileSelect'; i++) {
    await t.press('Enter');
    await t.wait(400);
  }
  t.assert((await state(t)) === 'fileSelect', 'the title leads to the file select');
}

/**
 * Talk to a (wandering) villager: stand flush against a free side of them,
 * facing them, and press the action button at once; if they stepped away first
 * (and the button lifted a bush instead), put it down and try again. Returns
 * the first box shown.
 */
async function talkTo(t, id) {
  for (let i = 0; i < 6; i++) {
    const placed = await t.eval((npc) => {
      const g = window.__qf.game;
      const sv = g.services;
      const e = sv.findEntity(npc);
      const p = sv.player;
      const gx = e.w / 2 + p.w / 2 + 1;
      const gy = e.h / 2 + p.h / 2 + 1;
      const sides = [[0, gy, 'up'], [-gx, 0, 'right'], [gx, 0, 'left'], [0, -gy, 'down']];
      for (const [dx, dy, dir] of sides) {
        const x = e.x + dx;
        const y = e.y + dy;
        g.warpNow({ world: sv.room.world.id, room: sv.room.def.id, x, y, dir });
        if (Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1) return dir;
      }
      return null;
    }, id);
    if (!placed) return null;
    await t.press('KeyX', 30);
    await t.wait(500);
    const text = await boxText(t);
    if (text) return text;
    if ((await t.eval(() => window.__qf.game.services.player.state)) === 'carry') {
      await t.press('KeyX');
      await t.wait(600);
    }
  }
  return null;
}

/** Escape backs out: name entry -> file list (no file made) -> title. */
async function escapeBack(t) {
  const mode = () => t.eval(() => window.__qf.game.fileSelect?.mode ?? null);
  await t.press('Enter');
  await t.wait(200);
  t.assert((await mode()) === 'name', 'Enter on an empty slot starts name entry');
  await t.page.keyboard.type('Zed');
  await t.press('Escape');
  await t.wait(200);
  t.assert((await mode()) === 'select', 'Escape leaves name entry for the file list');
  t.assert(await t.eval(() => !window.__qf.game.fileSelect.saves.some(Boolean)), 'Escape made no file');
  await t.press('Escape');
  await t.wait(300);
  t.assert((await state(t)) === 'title', 'Escape on the file list goes back to the title');
  await toFileSelect(t);
}

async function newFile(t) {
  await freezeHotReload(t);
  await t.goto('#/play/sample');
  await toFileSelect(t);
  await escapeBack(t);
  await t.press('Enter');
  await t.wait(200);
  await t.page.keyboard.type('Ana');
  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'dialogue', undefined, 5000);
  await closeDialogues(t);
  await t.wait(200);
  await t.shotCanvas('hud-start');
  const s = await t.eval(snap);
  t.assert(s.hp === 6 && s.maxHp === 6 && s.items.shield === 1, `a new file starts with 3 hearts and the shield (${s.hp}/${s.maxHp})`);
}

async function pauseIndoors(t) {
  await t.press('Enter');
  await t.wait(400);
  t.assert((await state(t)) === 'paused', 'Enter opens the pause menu');
  t.assert((await option(t)) === 3, 'with nothing to equip the focus starts on RESUME');
  await t.shotCanvas('pause-items-empty');
  await t.press('KeyE');
  await t.wait(300);
  await t.shotCanvas('pause-map-indoors');
  await t.press('KeyQ');
  await t.wait(150);
  await t.press('Enter');
  await t.page.waitForFunction(() => window.__qf.game.state === 'playing', undefined, { timeout: 3000 }).catch(() => {});
  t.assert((await state(t)) === 'playing', 'Enter closes the pause menu');
}

async function villageTalk(t) {
  await path(t, 'to the chest', [['y', px(5)], ['x', px(11)]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(400);
  await closeDialogues(t);
  await path(t, 'to the door', [['x', px(10)], ['y', px(10)], ['x', 128]]);
  t.assert(await walkInto(t, 'ArrowDown', 'ow_village'), 'out into the village');
  await t.press('ShiftLeft');
  await t.wait(400);
  await t.shotCanvas('map-overworld');
  await t.press('ShiftLeft');
  await t.wait(300);
  const text = await talkTo(t, 'vil_marta');
  await t.shotCanvas('marta-talks');
  t.assert(text !== null && text.length > 0, `Marta answers through her talk trigger (${text})`);
  await closeDialogues(t);
}

async function shop(t) {
  await warpTo(t, 'ellendor', 'ow_village', px(18), px(5) + 2, 'up');
  t.assert(await walkInto(t, 'ArrowUp', 'in_shop', 4000), 'walked into Juno\'s shop');
  await t.wait(300);
  await t.shotCanvas('shop');
  // The goods stand on a counter: the hero stops 26 px below an item (its icon and price stay in view).
  const counter = px(7) + 26;
  await path(t, 'to the bombs', [['y', counter], ['x', px(5)]]);
  t.assert(await pushInto(t, 'up'), 'stands at the bombs, facing them');
  t.log('at the bombs', await t.eval(() => {
    const s = window.__qf.game.services;
    return { p: [s.player.x, s.player.y, s.player.facing, s.player.state], rupees: s.save.rupees, mode: window.__qf.game.state };
  }));
  await t.press('KeyX');
  await t.wait(600);
  await t.shotCanvas('bought-bombs');
  await closeDialogues(t);
  let s = await t.eval(snap);
  t.assert(s.bombs === 5 && s.rupees === 0, `bought 5 bombs for 20 rupees (bombs ${s.bombs}, rupees ${s.rupees})`);
  await path(t, 'to the heart', [['y', counter], ['x', px(10)]]);
  await pushInto(t, 'up');
  await t.press('KeyX');
  await t.wait(500);
  const refusal = await boxText(t);
  await t.shotCanvas('shop-refusal');
  t.assert(refusal !== null && /Gems|full/.test(refusal), `the shopkeeper refuses (${refusal})`);
  await closeDialogues(t);
  s = await t.eval(snap);
  t.assert(s.rupees === 0, 'nothing was charged');
}

async function saveAndDie(t) {
  await pauseOn(t, 0);
  await t.press('KeyX');
  await t.wait(150);
  await t.shotCanvas('pause-saved');
  await t.press('Enter');
  await t.wait(300);
  const respawn = await t.eval(() => window.__qf.game.services.save.respawn.room);
  // Walk out and meet the meadow's enemies with one half-heart left.
  await warpTo(t, 'ellendor', 'ow_meadow', px(13), px(11), 'up');
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.save.hp = 1;
    const slime = s.entities.find((e) => e.countsForClear && !e.dead);
    slime.x = s.player.x;
    slime.y = s.player.y - 12;
  });
  const died = await t.page.waitForFunction(() => window.__qf.game.state === 'gameOver', undefined, { timeout: 8000 })
    .then(() => true, () => false);
  t.assert(died, 'the hero died');
  await t.wait(900);
  await t.shotCanvas('game-over-falling');
  await t.wait(1800);
  await t.shotCanvas('game-over-menu');
  await t.press('KeyX');
  await t.page.waitForFunction(() => window.__qf.game.state === 'playing', undefined, { timeout: 5000 }).catch(() => {});
  const s = await t.eval(snap);
  t.assert(s.state === 'playing' && s.hp === 6, `CONTINUE revives the hero with 3 hearts (${s.state}, hp ${s.hp})`);
  t.assert(s.room === respawn, `...at the last respawn point (${s.room}, expected ${respawn})`);
  await t.shotCanvas('continued');
}

async function saveQuitAndLoad(t) {
  const respawn = await t.eval(() => window.__qf.game.services.save.respawn.room);
  await pauseOn(t, 1);
  await t.press('KeyX');
  const left = await t.page.waitForFunction(() => location.hash === '#/' || location.hash === '', undefined, { timeout: 5000 })
    .then(() => true, () => false);
  t.assert(left, 'SAVE & QUIT goes back to the menu');
  await t.wait(500);
  await t.shot('menu-after-quit');
  await t.goto('#/play/sample');
  await toFileSelect(t);
  await t.shotCanvas('file-select-saved');
  await t.press('Enter');
  await t.until(() => ['playing', 'dialogue'].includes(window.__qf.game.state), undefined, 5000);
  await t.wait(400);
  const s = await t.eval(snap);
  t.assert(s.room === respawn && s.bombs === 5 && s.items.shield === 1, `the file loads where it was saved (${s.room}, bombs ${s.bombs})`);
  t.assert(await t.eval(() => window.__qf.game.services.save.name === 'Ana'), 'the file keeps its name');
  await t.shotCanvas('loaded');
}

export default async function (t) {
  await newFile(t);
  await pauseIndoors(t);
  await villageTalk(t);
  await shop(t);
  await saveAndDie(t);
  await saveQuitAndLoad(t);
}
