// A whole session on #/play/sample with nothing but a (fake) Xbox pad: the title
// names the pad's buttons, Start opens the file select and name entry, the
// letter grid spells a name, the intro is read with the action button, then the
// hero walks with the stick, swings the sword (bottom face = A), places a bomb
// (left face = X) that rumbles the pad, and rumbles when hurt. The pause menu's
// CONTROLS page (LB from the items) turns vibration off (no more rumble) and
// swaps A/B (the bottom button then acts); unplugging the pad pauses the game
// with a notice; finally a key press switches every hint back to the keyboard.
// Screenshots land in e2e-out/pad-game/.
import { installFakePad, padPress, padStick, PAD, PAD_IDS } from './lib/fakepad.mjs';

const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);
const rumbles = (t) => t.eval(() => window.__fakePadRumble.length);
const hero = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  return { x: Math.round(s.player.x), y: Math.round(s.player.y), state: s.player.state, hp: s.save.hp, bombs: s.save.bombs };
});
const pause = (t) => t.eval(() => {
  const m = window.__qf.game.services.pauseMenu;
  return { page: m.page, row: m.controls.row, disconnected: m.disconnected, open: m.isOpen };
});
const prefs = (t) => t.eval(async () => (await import('/src/input/devices.ts')).controllerPrefs());

/** Hurt the hero once (as a monster's touch would) after the i-frames have run out. */
async function hurt(t) {
  await t.until(() => window.__qf.game.services.player.invuln <= 0, undefined, 3000);
  await t.eval(() => window.__qf.game.services.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: 1, knockback: 0 }));
  await t.wait(100);
}

export default async function (t) {
  await installFakePad(t.page, { id: PAD_IDS.xbox });
  await t.goto('#/play/sample');
  await t.wait(300);
  await padPress(t, PAD.up); // the pad is now the device in use
  await t.wait(2000);
  await t.shotCanvas('title-xbox');
  const title = await t.eval(async () => {
    const d = await import('/src/input/devices.ts');
    return { device: d.currentControls().device, start: d.buttonLabel('start'), sword: d.buttonLabel('b') };
  });
  t.assert(title.device === 'gamepad' && title.start === 'MENU' && title.sword === 'A', `Xbox labels on the title (${JSON.stringify(title)})`);

  // Title -> file select -> name entry, all with the pad.
  await padPress(t, PAD.start);
  await t.until(() => window.__qf.game.state === 'fileSelect', undefined, 5000);
  await t.wait(250);
  await t.shotCanvas('file-select-xbox');
  await padPress(t, PAD.right); // B (the right face) = action / confirm
  await t.wait(150);
  t.assert((await t.eval(() => window.__qf.game.fileSelect.mode)) === 'name', 'B on an empty slot opens name entry');
  // "Ada": A, then d-pad down twice to lowercase row, d (3 right), then a.
  await padPress(t, PAD.right);
  await padPress(t, PAD.down);
  await padPress(t, PAD.down);
  for (let i = 0; i < 3; i++) await padPress(t, PAD.dright);
  await padPress(t, PAD.right);
  for (let i = 0; i < 3; i++) await padPress(t, PAD.dleft);
  await padPress(t, PAD.right);
  await t.wait(100);
  const typed = await t.eval(() => window.__qf.game.fileSelect.name);
  t.assert(typed === 'Ada', `the grid spells a name with the pad (${typed})`);
  await t.shotCanvas('name-entry-xbox');
  await padPress(t, PAD.start); // MENU = done
  await t.until(() => ['dialogue', 'playing'].includes(window.__qf.game.state), undefined, 6000);

  // Read the intro with the action button.
  for (let i = 0; i < 40 && (await state(t)) !== 'playing'; i++) {
    await padPress(t, PAD.right, 60);
    await t.wait(220);
  }
  t.assert((await state(t)) === 'playing', 'the intro was read with the pad');
  t.assert((await t.eval(() => window.__qf.game.services.save.name)) === 'Ada', 'the new file is Ada\'s');

  // Walk with the stick.
  const h0 = await hero(t);
  await padStick(t, 0, 1, 500);
  const h1 = await hero(t);
  t.assert(h1.y > h0.y + 20, `the stick walks the hero (${h0.y} -> ${h1.y})`);

  // Sword on the bottom face (A).
  await t.eval(() => window.__qf.game.services.giveItem('sword'));
  await t.eval(() => window.__fakePad.set(0, true));
  // Poll rather than sample once: a busy machine can delay the first game tick after the press.
  let swing = await hero(t);
  for (let i = 0; i < 12 && swing.state !== 'attack'; i++) {
    await t.wait(40);
    swing = await hero(t);
  }
  await t.eval(() => window.__fakePad.set(0, false));
  t.assert(swing.state === 'attack', `A swings the sword (${swing.state})`);
  await t.shotCanvas('sword-xbox');
  await t.wait(400);

  // A bomb on the item button (X): placed ahead, the hero backs off, the blast rumbles the pad hard.
  await t.eval(() => window.__qf.game.services.giveItem('bombs', 3));
  await t.eval(() => { window.__qf.game.services.save.equipped = 'bombs'; });
  const before = await hero(t);
  const rumbleBefore = await rumbles(t);
  await padPress(t, PAD.left);
  await t.wait(200);
  t.assert((await hero(t)).bombs === before.bombs - 1, 'X placed a bomb');
  await padStick(t, 0, -1, 300);
  await t.wait(1800);
  const blast = await t.eval((n) => window.__fakePadRumble.slice(n), rumbleBefore);
  t.log('rumble after the bomb', blast);
  t.assert(blast.some((e) => e.strongMagnitude === 1), `a bomb going off nearby rumbles hard (${JSON.stringify(blast)})`);

  // Hurt: a 'hit' rumble.
  let n = await rumbles(t);
  await hurt(t);
  let fx = await t.eval((k) => window.__fakePadRumble.slice(k), n);
  t.assert(fx.length === 1 && fx[0].strongMagnitude > 0.4 && fx[0].strongMagnitude < 1, `getting hurt rumbles once (${JSON.stringify(fx)})`);

  // Pause (MENU) -> LB -> CONTROLS page.
  await padPress(t, PAD.start);
  await t.wait(300);
  await padPress(t, PAD.lb);
  await t.wait(250);
  let p = await pause(t);
  t.assert(p.open && p.page === 'controls', `LB from the items shows the CONTROLS page (${JSON.stringify(p)})`);
  await t.shotCanvas('pause-controls-xbox');
  // Vibration off (B flips the selected option), close, get hurt: no rumble.
  await padPress(t, PAD.right);
  await t.wait(100);
  t.assert((await prefs(t)).vibration === false, 'vibration switched off');
  await t.shotCanvas('pause-controls-vibration-off');
  await padPress(t, PAD.start);
  await t.wait(200);
  n = await rumbles(t);
  await hurt(t);
  t.assert((await rumbles(t)) === n, 'with vibration off, getting hurt does not rumble');

  // Swap A/B on (down, B), then the bottom button (A) acts instead of swinging.
  await padPress(t, PAD.start);
  await t.wait(300);
  t.assert((await pause(t)).page === 'items', 'the menu opens on the items again');
  await padPress(t, PAD.rb);
  await padPress(t, PAD.rb); // items -> map -> controls
  await t.wait(150);
  t.assert((await pause(t)).page === 'controls', 'RB twice reaches the CONTROLS page');
  await padPress(t, PAD.right); // vibration back on
  await padPress(t, PAD.down);
  await padPress(t, PAD.right); // swap on: B is now the sword button...
  await t.wait(100);
  t.assert((await prefs(t)).swapFaceButtons === true && (await prefs(t)).vibration === true, 'swap on, vibration back on');
  t.assert((await state(t)) === 'paused', 'letting go of the button that turned the swap on does not close the menu');
  await t.shotCanvas('pause-controls-swapped');
  await padPress(t, PAD.start);
  await t.wait(200);
  await t.eval(() => window.__fakePad.set(0, true));
  await t.wait(60);
  const held = await t.eval(() => ({ a: window.__qf.game.services.input.held('a'), b: window.__qf.game.services.input.held('b') }));
  await t.eval(() => window.__fakePad.set(0, false));
  t.assert(held.a && !held.b, `with the swap the bottom button is the action button (${JSON.stringify(held)})`);
  await t.wait(200);
  // Swap back off from the menu (the bottom button now confirms).
  await padPress(t, PAD.start);
  await t.wait(300);
  await padPress(t, PAD.lb);
  await padPress(t, PAD.down);
  await padPress(t, PAD.bottom);
  await t.wait(100);
  t.assert((await prefs(t)).swapFaceButtons === false, 'swap back off');
  await padPress(t, PAD.start);
  await t.wait(200);
  t.assert((await state(t)) === 'playing', 'back in the game');

  // Unplug the pad mid-game: the menu opens with the notice until a button is pressed.
  await t.eval(() => window.__fakePad.disconnect());
  await t.wait(150);
  p = await pause(t);
  t.assert((await state(t)) === 'paused' && p.disconnected, `unplugging the pad pauses with a notice (${JSON.stringify(p)})`);
  await t.shotCanvas('pad-disconnected');
  await t.eval(() => window.__fakePad.connect());
  await padPress(t, PAD.right);
  await t.wait(100);
  p = await pause(t);
  t.assert(!p.disconnected && (await state(t)) === 'paused', `a press after reconnecting dismisses the notice (${JSON.stringify(p)})`);

  // Keyboard: one key and every hint names keys again.
  await t.press('KeyQ'); // L: previous page (items -> controls)
  await t.wait(200);
  const kb = await t.eval(async () => (await import('/src/input/devices.ts')).currentControls().device);
  t.assert(kb === 'keyboard', `a key switches to the keyboard (${kb})`);
  t.assert((await pause(t)).page === 'controls', 'Q shows the CONTROLS page');
  await t.shotCanvas('pause-controls-keyboard');
  await t.press('KeyE');
  await t.wait(200);
  t.assert((await pause(t)).page === 'items', 'E flips on to the items');
  await t.shotCanvas('pause-items-keyboard');
  await t.press('Enter');
  await t.wait(200);
  t.assert((await state(t)) === 'playing', 'Enter closes the menu');
}
