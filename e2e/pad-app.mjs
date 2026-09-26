// Controller on the menu hub: the banner and connect toast, d-pad and stick
// focus movement (with a visible ring), the New project dialog opened and
// closed with the pad (focus trapped inside), the button layout / vibration
// toggles, and "Play the sample adventure" started with the pad reaching the
// title screen (the held button must not skip it); no pad polling leaks into
// the game.
import { installFakePad, padPress, padStick, padHold, PAD, PAD_IDS } from './lib/fakepad.mjs';

/** The focused element, described for asserts. */
const focusInfo = () => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: 'body', ring: false, text: '' };
  return {
    tag: a.tagName.toLowerCase(),
    cls: a.className,
    text: (a.getAttribute('aria-label') || a.textContent || a.value || '').trim().slice(0, 40),
    ring: a.classList.contains('qf-pad-focus'),
    inModal: !!a.closest('.qf-modal'),
  };
};

export default async function (t) {
  await installFakePad(t.page, { id: PAD_IDS.xbox });
  await t.goto('#/');
  await t.until(() => !document.querySelector('.qf-menu-card[data-project-id="sample"] .qf-menu-card__thumb--loading'), null, 8000);

  // ---- connect toast + banner
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => /Controller connected: Xbox Wireless Controller/.test(n.textContent)));
  const toasts = await t.eval(() => [...document.querySelectorAll('.qf-toast')].filter((n) => /Controller connected/.test(n.textContent)).length);
  t.assert(toasts === 1, `one connect toast (${toasts})`);
  const banner = await t.eval(() => {
    const b = document.querySelector('.qf-menu-pad');
    return b && !b.hidden ? b.textContent : null;
  });
  t.log('banner', banner);
  t.assert(banner && /Xbox Wireless Controller connected/.test(banner), 'the controller banner names the pad');
  // Classic (SNES) layout: action = right face = "B" on an Xbox pad, back = bottom = "A".
  t.assert(/B select.*A back/.test(banner ?? ''), `banner shows the pad's own glyphs (${banner})`);
  await t.shot('hub-banner');

  // ---- d-pad: the first press focuses "Play the sample adventure"
  await padPress(t, PAD.down);
  let f = await t.eval(focusInfo);
  t.log('first press', f);
  t.assert(/Play the sample adventure/.test(f.text) && f.ring, `first d-pad press focuses the primary button with a ring (${f.text})`);
  const device = await t.eval(async () => (await import('/src/input/devices.ts')).currentControls().device);
  t.assert(device === 'gamepad', 'pad use on the hub makes the pad the current device');
  await t.shot('focus-play');

  await padPress(t, PAD.dright);
  f = await t.eval(focusInfo);
  t.assert(/Build your own/.test(f.text) && f.ring, `right moves to "Build your own" (${f.text})`);
  await t.shot('focus-build');

  await padPress(t, PAD.down);
  f = await t.eval(focusInfo);
  t.log('down from Build', f);
  t.assert(f.ring && f.tag === 'button', `down moves into the page (${f.text})`);
  await t.shot('focus-down');

  // ---- left stick moves focus too
  const before = f.text;
  await padStick(t, 0, 1, 120);
  f = await t.eval(focusInfo);
  t.log('stick down', f);
  t.assert(f.ring && f.text !== before, `the left stick moves focus (${before} -> ${f.text})`);
  await t.shot('focus-stick');

  // ---- key repeat: holding down keeps moving
  const path = await t.eval(async () => {
    const seen = [];
    window.__fakePad.set(13, true);
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      const a = document.activeElement;
      const k = a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30) : '';
      if (seen[seen.length - 1] !== k) seen.push(k);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.__fakePad.set(13, false);
    return seen;
  });
  t.log('repeat path', path);
  t.assert(path.length >= 3, `holding the d-pad repeats (${path.length} stops in 0.9 s)`);
  await t.wait(100);
  await t.shot('focus-after-repeat');
  const scrolled = await t.eval(() => document.querySelector('.qf-menu').scrollTop);
  t.log('scrollTop', scrolled);

  // ---- back to the top, open New project with the pad
  await t.eval(() => document.querySelector('.qf-menu-new-btn').focus());
  await padPress(t, PAD.up);
  await padPress(t, PAD.down);
  await t.eval(() => document.querySelector('.qf-menu-new-btn').focus());
  await padPress(t, PAD.right); // action ('a' = right face in the classic layout)
  await t.until(() => !!document.querySelector('.qf-modal .qf-menu-new'));
  f = await t.eval(focusInfo);
  t.log('dialog focus', f);
  t.assert(f.inModal, 'focus is inside the New project dialog');
  await t.shot('new-project-dialog');

  // Focus stays trapped in the dialog: many moves never leave it.
  const trapped = [];
  for (const b of [PAD.down, PAD.down, PAD.down, PAD.dright, PAD.down, PAD.down, PAD.dleft, PAD.up]) {
    await padPress(t, b);
    trapped.push(await t.eval(focusInfo));
  }
  t.log('in dialog', trapped.map((x) => x.text));
  t.assert(trapped.every((x) => x.inModal), 'pad focus never leaves the open dialog');
  await t.shot('dialog-focus-moved');

  // 'b' (bottom face in the classic layout) closes it; focus returns to "New project".
  await padPress(t, PAD.bottom);
  await t.until(() => !document.querySelector('.qf-modal'));
  f = await t.eval(focusInfo);
  t.log('after close', f);
  t.assert(/New project/.test(f.text), `focus returns to the New project button (${f.text})`);
  const route = await t.eval(() => window.__qf.route.view);
  t.assert(route === 'menu', 'closing the dialog stays on the menu');
  await t.shot('dialog-closed');

  // ---- banner toggles, driven by the pad: up from "New project" reaches the banner
  const banner2 = async () => t.eval(() => ({
    text: document.querySelector('.qf-menu-pad__msg')?.textContent ?? '',
    classic: document.querySelector('.qf-menu-pad__seg .qf-btn:first-child')?.getAttribute('aria-pressed'),
    swapped: document.querySelector('.qf-menu-pad__seg .qf-btn:last-child')?.getAttribute('aria-pressed'),
    vibration: document.querySelector('.qf-menu-pad__vibration')?.getAttribute('aria-pressed'),
    stored: JSON.parse(localStorage.getItem('questforge:controller') ?? 'null'),
  }));
  // From "Build your own", down is the banner's layout toggle.
  await t.eval(() => document.querySelectorAll('.qf-menu-cta')[1].focus());
  await padPress(t, PAD.down);
  f = await t.eval(focusInfo);
  t.assert(/Classic/.test(f.text), `down from "Build your own" reaches the layout toggle (${f.text})`);
  await padPress(t, PAD.dright);
  f = await t.eval(focusInfo);
  t.assert(/Swapped/.test(f.text), `the pad reaches the "Swapped" toggle (${f.text})`);
  await padPress(t, PAD.right); // classic layout: right face = select
  let b = await banner2();
  t.log('after swap', b);
  t.assert(b.swapped === 'true' && b.classic === 'false', 'the Swapped layout is on');
  t.assert(b.stored?.swapFaceButtons === true, 'the layout is stored in the controller setting');
  t.assert(/A select.*B back/.test(b.text), `swapped: the bottom button (A) selects now (${b.text})`);
  await t.shot('banner-swapped');
  // Swapped: the right face no longer selects; the bottom one does.
  await padPress(t, PAD.dright);
  f = await t.eval(focusInfo);
  t.assert(/Vibration/.test(f.text), `right moves to the vibration toggle (${f.text})`);
  const rumbleBefore = await t.eval(() => window.__fakePadRumble.length);
  await padPress(t, PAD.right);
  b = await banner2();
  t.assert(b.vibration === 'true', 'with swapped buttons the right face does not select');
  await padPress(t, PAD.bottom);
  b = await banner2();
  t.assert(b.vibration === 'false' && b.stored?.vibration === false, 'the bottom face turns vibration off');
  await t.shot('banner-vibration-off');
  await padPress(t, PAD.bottom);
  b = await banner2();
  const rumbleAfter = await t.eval(() => window.__fakePadRumble.length);
  t.assert(b.vibration === 'true', 'and back on');
  t.assert(rumbleAfter > rumbleBefore, `turning vibration on gives a short rumble (${rumbleBefore} -> ${rumbleAfter})`);
  // Back to the classic layout (left, then select with the bottom face while swapped).
  await padPress(t, PAD.dleft);
  await padPress(t, PAD.dleft);
  f = await t.eval(focusInfo);
  t.assert(/Classic/.test(f.text), `left reaches "Classic (SNES)" (${f.text})`);
  await padPress(t, PAD.bottom);
  b = await banner2();
  t.assert(b.classic === 'true' && /B select.*A back/.test(b.text), `classic layout again (${b.text})`);

  // ---- "Play the sample adventure" with the pad: a long press acts on release and lands on the title screen.
  for (let i = 0; i < 8; i++) {
    const at = await t.eval(focusInfo);
    if (/Play the sample adventure/.test(at.text)) break;
    await padPress(t, /Build your own/.test(at.text) ? PAD.dleft : PAD.up);
  }
  f = await t.eval(focusInfo);
  t.assert(/Play the sample adventure/.test(f.text), `up reaches "Play the sample adventure" (${f.text})`);
  await t.eval(() => window.__fakePad.set(1, true));
  await t.wait(500);
  const held = await t.eval(() => ({ route: window.__qf.route.view, pressed: document.activeElement?.classList.contains('qf-pad-pressed') }));
  t.assert(held.route === 'menu' && held.pressed, 'while the button is held nothing happens yet (pressed look shown)');
  await t.shot('play-held');
  await t.eval(() => window.__fakePad.set(1, false));
  await t.until(() => window.__qf.route?.view === 'play' && window.__qf.ready && !!window.__qf.game, null, 10000);
  await t.wait(1200);
  const title = await t.eval(async () => ({
    state: window.__qf.game.state,
    padNavs: (await import('/src/app/padNav.ts')).padNavCount(),
  }));
  t.log('game', title);
  t.assert(title.state === 'title', `the pad start lands on the title screen (${title.state})`);
  t.assert(title.padNavs === 0, `no menu pad polling runs during the game (${title.padNavs})`);
  await t.shotCanvas('title-screen');

  // ---- connect / disconnect toasts, once per event, also over the game
  await t.eval(() => window.__fakePad.disconnect());
  await t.until(() => [...document.querySelectorAll('.qf-toast')].some((n) => /Controller disconnected: Xbox Wireless Controller/.test(n.textContent)));
  await t.shot('toast-disconnected');
  await t.eval(() => window.__fakePad.connect());
  await t.until(() => [...document.querySelectorAll('.qf-toast:not(.qf-toast--out)')].some((n) => /Controller connected/.test(n.textContent)));
  const counts = await t.eval(() => {
    const all = [...document.querySelectorAll('.qf-toast')].map((n) => n.textContent);
    return { off: all.filter((x) => /disconnected/.test(x)).length, on: all.filter((x) => /Controller connected/.test(x)).length };
  });
  t.log('toasts', counts);
  t.assert(counts.off === 1, `one disconnect toast (${counts.off})`);
  await t.shot('toast-reconnected');

  // ---- back on the menu with the pad as the device: focus starts on "Play" with the ring
  await padPress(t, PAD.bottom); // device = gamepad again (the title screen ignores it or starts; either way we leave)
  await t.goto('#/');
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready && !!document.querySelector('.qf-menu'));
  await t.wait(200);
  f = await t.eval(focusInfo);
  t.assert(/Play the sample adventure/.test(f.text) && f.ring, `returning with a pad focuses "Play" (${f.text})`);
}
