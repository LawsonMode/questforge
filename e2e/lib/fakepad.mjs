// Fake gamepads for e2e scenarios (headless Chrome has no real pads).
//
//   import { installFakePad, padPress, padHold, padStick, PAD, PAD_IDS } from './lib/fakepad.mjs';
//   await installFakePad(t.page, { id: PAD_IDS.playstation });   // BEFORE the first t.goto(...)
//   await t.goto('#/');
//   await padPress(t, PAD.right);             // tap a button (standard-mapping index)
//   await padHold(t, [PAD.start, PAD.select], 1200);
//   await padStick(t, 1, 0, 400);             // push the left stick right for 400 ms
//   await t.eval(() => window.__fakePad.disconnect());
//   await t.eval(() => window.__fakePadRumble);  // rumble effects played so far
//
// The pad starts CONNECTED and a 'gamepadconnected' event fires on load (like a
// pad already plugged in when the page opens, once the user presses a button).
// Files in e2e/lib/ are not scenarios (the harness only runs top-level e2e/*.mjs).

/** Standard-mapping button indices. */
export const PAD = {
  bottom: 0, right: 1, left: 2, top: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9,
  up: 12, down: 13, dleft: 14, dright: 15,
};

/** Realistic Gamepad.id strings per family (Chrome formatting). */
export const PAD_IDS = {
  xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  playstation: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  nintendo: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  generic: 'USB Gamepad (STANDARD GAMEPAD Vendor: 0079 Product: 0011)',
};

/** Install a fake pad in every page the context opens from now on. */
export async function installFakePad(page, { id = PAD_IDS.xbox, index = 0, rumble = true } = {}) {
  await page.addInitScript(({ id, index, rumble }) => {
    const button = (down) => ({ pressed: down, touched: down, value: down ? 1 : 0 });
    const pad = {
      id, index, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => button(false)),
      axes: [0, 0, 0, 0],
    };
    window.__fakePadRumble = [];
    if (rumble) {
      pad.vibrationActuator = {
        effects: ['dual-rumble'],
        playEffect(type, params) {
          window.__fakePadRumble.push({ type, ...params, at: performance.now() });
          return Promise.resolve('complete');
        },
      };
    }
    const fire = (type) => {
      const ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: pad });
      window.dispatchEvent(ev);
    };
    window.__fakePad = {
      pad,
      set(i, down) { pad.buttons[i] = button(!!down); pad.timestamp = performance.now(); },
      stick(x, y) { pad.axes[0] = x; pad.axes[1] = y; pad.timestamp = performance.now(); },
      release() { pad.buttons = pad.buttons.map(() => button(false)); pad.axes = [0, 0, 0, 0]; },
      connect() { pad.connected = true; fire('gamepadconnected'); },
      disconnect() { pad.connected = false; fire('gamepaddisconnected'); },
    };
    const slots = [null, null, null, null];
    slots[index] = pad;
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () => slots.map((p) => (p && p.connected ? p : null)),
    });
    window.addEventListener('load', () => fire('gamepadconnected'), { once: true });
  }, { id, index, rumble });
}

/** Tap a button for `ms` milliseconds. */
export async function padPress(t, i, ms = 90) {
  await t.eval((i) => window.__fakePad.set(i, true), i);
  await t.wait(ms);
  await t.eval((i) => window.__fakePad.set(i, false), i);
  await t.wait(40);
}

/** Hold several buttons together for `ms`. */
export async function padHold(t, buttons, ms) {
  const list = Array.isArray(buttons) ? buttons : [buttons];
  await t.eval((l) => l.forEach((i) => window.__fakePad.set(i, true)), list);
  await t.wait(ms);
  await t.eval((l) => l.forEach((i) => window.__fakePad.set(i, false)), list);
  await t.wait(40);
}

/** Push the left stick to (x, y) in -1..1 for `ms`, then centre it. */
export async function padStick(t, x, y, ms) {
  await t.eval(([x, y]) => window.__fakePad.stick(x, y), [x, y]);
  await t.wait(ms);
  await t.eval(() => window.__fakePad.stick(0, 0));
  await t.wait(40);
}
