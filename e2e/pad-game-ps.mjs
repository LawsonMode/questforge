// PlayStation pad on #/play/sample: the title, file select and name entry name
// the pad's own buttons (cross / circle / square / triangle drawn by the bitmap
// font), the sound hint shows while audio is locked, and the name-entry grid is
// fully usable with the pad (d-pad with auto-repeat, circle picks, cross deletes,
// OPTIONS finishes). Screenshots land in e2e-out/pad-game-ps/.
import { installFakePad, padHold, padPress, PAD, PAD_IDS } from './lib/fakepad.mjs';

const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);
const fileSelect = (t) => t.eval(() => {
  const fs = window.__qf.game.fileSelect;
  return fs && { mode: fs.mode, name: fs.name, gx: fs.gx, gy: fs.gy };
});
const labels = (t) => t.eval(async () => {
  const d = await import('/src/input/devices.ts');
  return { device: d.currentControls().device, family: d.currentControls().family, b: d.buttonLabel('b'), a: d.buttonLabel('a'), start: d.buttonLabel('start') };
});

export default async function (t) {
  await installFakePad(t.page, { id: PAD_IDS.playstation });
  await t.goto('#/play/sample');
  // The harness lets audio start without a gesture: pretend it is still locked, as for a real pad player.
  await t.eval(async () => {
    const audio = (await import('/src/audio/audio.ts')).getAudio();
    Object.defineProperty(audio, 'status', { configurable: true, get: () => 'locked' });
  });
  await t.wait(400);
  // Touch the d-pad: the pad becomes the device in use (the title ignores the d-pad).
  await padPress(t, PAD.down);
  await t.wait(2000);
  const l = await labels(t);
  t.log('labels', l);
  t.assert(l.device === 'gamepad' && l.family === 'playstation', `the pad is in use (${JSON.stringify(l)})`);
  t.assert(l.b === '' && l.a === '' && l.start === 'OPTIONS', `PlayStation labels (${JSON.stringify(l)})`);
  const audio = await t.eval(async () => (await import('/src/audio/audio.ts')).getAudio().status);
  t.log('audio status', audio);
  t.assert((await state(t)) === 'title', 'still on the title');
  await t.shotCanvas('title-playstation');

  // OPTIONS (Start) opens the file select.
  await padPress(t, PAD.start);
  await t.until(() => window.__qf.game.state === 'fileSelect', undefined, 5000);
  await t.wait(300);
  await t.shotCanvas('file-select-playstation');
  // OPTIONS on an empty slot opens name entry.
  await padPress(t, PAD.start);
  await t.wait(200);
  let fs = await fileSelect(t);
  t.assert(fs && fs.mode === 'name', `the pad's Start opens name entry (${JSON.stringify(fs)})`);
  await t.shotCanvas('name-entry-playstation');

  // Holding right auto-repeats across the grid (~0.3 s delay, then every 0.1 s).
  await padHold(t, PAD.dright, 700);
  fs = await fileSelect(t);
  t.log('after holding right', fs);
  t.assert(fs.gx >= 3, `holding the d-pad repeats (column ${fs.gx})`);
  // Pick letters with circle (the right face = action), delete one with cross.
  await padPress(t, PAD.right);
  await padPress(t, PAD.dright);
  await padPress(t, PAD.right);
  await padPress(t, PAD.right);
  fs = await fileSelect(t);
  t.assert(fs.name.length === 3, `circle picks letters (${JSON.stringify(fs.name)})`);
  await padPress(t, PAD.bottom);
  fs = await fileSelect(t);
  t.assert(fs.name.length === 2, `cross deletes a letter (${JSON.stringify(fs.name)})`);
  await padPress(t, PAD.dleft);
  await padPress(t, PAD.right);
  await t.wait(100);
  await t.shotCanvas('name-typed');
  const name = (await fileSelect(t)).name;
  // OPTIONS finishes the name: the new game starts with the intro.
  await padPress(t, PAD.start);
  await t.until(() => ['dialogue', 'playing'].includes(window.__qf.game.state), undefined, 6000);
  const hero = await t.eval(() => window.__qf.game.services.save.name);
  t.assert(hero === name, `the file is named as entered (${hero} / ${name})`);
  // The intro's controls line names the pad's buttons.
  let text = null;
  for (let i = 0; i < 10 && (await state(t)) === 'dialogue'; i++) {
    await t.wait(900);
    text = await t.eval(() => {
      const db = window.__qf.game.services.dialogueBox;
      const box = db.current && db.current.boxes[db.boxIndex];
      return box ? box.lines.join(' ') : null;
    });
    if (text && text.includes('D-pad')) break;
    await padPress(t, PAD.right);
  }
  t.log('intro controls page', text);
  t.assert(!!text && text.includes('D-pad') && text.includes('') && text.includes('Options'), `intro names the pad buttons (${text})`);
  await t.shotCanvas('intro-controls-playstation');
}
