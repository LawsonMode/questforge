// Controller basics: a fake Xbox pad moves the hero, swings the sword and is
// recognised as the current device (labels switch to the pad's glyphs).
import { installFakePad, padPress, padStick, PAD, PAD_IDS } from './lib/fakepad.mjs';

export default async function (t) {
  await installFakePad(t.page, { id: PAD_IDS.xbox });
  await t.goto('#/playtest/sample');
  await t.wait(600);
  const before = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  });
  await padStick(t, 0, 1, 500);
  const after = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  });
  t.log('stick moved hero', before, after);
  t.assert(after.y > before.y + 10, 'left stick moves the hero down');
  const device = await t.eval(async () => (await import('/src/input/devices.ts')).currentControls());
  t.log('device', device);
  t.assert(device.device === 'gamepad' && device.family === 'xbox', 'pad recognised as an Xbox controller');
  const label = await t.eval(async () => (await import('/src/input/devices.ts')).buttonLabel('b'));
  t.assert(label === 'A', `sword button labelled A on Xbox (got ${label})`);
  await padPress(t, PAD.bottom, 60);
  await t.wait(80);
  await t.shotCanvas('pad-sword');
}
