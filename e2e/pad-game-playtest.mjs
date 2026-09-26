// Gamepad odds and ends with a (fake) Nintendo-layout pad: a playtest is left by
// holding Start + Select for a second (a progress bar shows first; letting go
// early keeps playing) and Escape still works; on the title, locked browser
// audio makes the pad player see "CLICK OR PRESS A KEY FOR SOUND"; one key press
// switches the title back to keyboard names. Screenshots land in
// e2e-out/pad-game-playtest/.
import { installFakePad, padPress, PAD, PAD_IDS } from './lib/fakepad.mjs';

const hash = (t) => t.eval(() => location.hash);
const hold = (t, down) => t.eval((d) => { window.__fakePad.set(9, d); window.__fakePad.set(8, d); }, down);

export default async function (t) {
  await installFakePad(t.page, { id: PAD_IDS.nintendo });
  await t.goto('#/playtest/sample');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  await padPress(t, PAD.dright);

  // A short hold shows the progress bar, and letting go keeps the playtest running.
  // The loop is frozen for the screenshot: a slow screenshot would otherwise run the
  // chord past its second and leave (stop() keeps the last frame; after start() the
  // still-held buttons are ignored until let go).
  await hold(t, true);
  await t.until(() => window.__qf.game.exitHold >= 0.45, null, 4000);
  const mid = await t.eval(() => { window.__qf.game.stop(); return window.__qf.game.exitHold; });
  await t.shotCanvas('exit-chord-progress');
  await hold(t, false);
  await t.eval(() => window.__qf.game.start());
  await t.wait(300);
  t.assert(mid > 0.3 && mid < 1, `the chord is counting (${mid})`);
  t.assert((await hash(t)).startsWith('#/playtest/'), 'letting go early stays in the playtest');
  const st = await t.eval(() => window.__qf.game.state);
  t.log('state after the short hold', st);
  await t.shotCanvas('after-short-hold');

  // Holding it for a second leaves (main.ts routes onExit to the menu).
  await hold(t, true);
  await t.page.waitForFunction(() => location.hash === '#/' || location.hash === '', undefined, { timeout: 4000 }).catch(() => {});
  await hold(t, false);
  t.assert(['#/', ''].includes(await hash(t)), `holding Start + Select leaves the playtest (${await hash(t)})`);

  // Escape still leaves a playtest.
  await t.goto('#/playtest/sample');
  await t.until(() => window.__qf.game && window.__qf.game.services);
  await t.wait(300);
  await t.press('Escape');
  await t.page.waitForFunction(() => location.hash === '#/' || location.hash === '', undefined, { timeout: 4000 }).catch(() => {});
  t.assert(['#/', ''].includes(await hash(t)), `Escape leaves the playtest (${await hash(t)})`);

  // Title with the audio still locked: the pad player is told how to get sound.
  await t.goto('#/play/sample');
  await t.eval(async () => {
    const audio = (await import('/src/audio/audio.ts')).getAudio();
    Object.defineProperty(audio, 'status', { configurable: true, get: () => 'locked' });
  });
  await padPress(t, PAD.dleft);
  await t.wait(2200);
  const pad = await t.eval(async () => {
    const d = await import('/src/input/devices.ts');
    return { device: d.currentControls().device, start: d.buttonLabel('start'), sword: d.buttonLabel('b'), action: d.buttonLabel('a') };
  });
  t.assert(pad.device === 'gamepad' && pad.start === '+' && pad.sword === 'B' && pad.action === 'A', `Nintendo labels (${JSON.stringify(pad)})`);
  await t.shotCanvas('title-nintendo-sound-hint');

  // A key press: the keyboard names are back, the sound hint goes (a key can unlock audio).
  await t.press('ArrowDown');
  await t.wait(300);
  const kb = await t.eval(async () => (await import('/src/input/devices.ts')).currentControls().device);
  t.assert(kb === 'keyboard', `the title follows the keyboard (${kb})`);
  await t.shotCanvas('title-keyboard');
  await t.eval(async () => delete (await import('/src/audio/audio.ts')).getAudio().status);
}
