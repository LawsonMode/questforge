// The hub's Controls card and controller banner per device: generic A/B/X/Y +
// Menu/View and no banner without a controller; a PlayStation pad shows its
// shapes (real Unicode in the DOM) and swapping the face buttons swaps the
// sword / action glyphs live; the message pages answer the pad too.
import { installFakePad, padPress, PAD, PAD_IDS } from './lib/fakepad.mjs';

const card = () => {
  const rows = [...document.querySelectorAll('.qf-menu-keys__row')].map((r) => ({
    what: r.querySelector('dd')?.textContent,
    kb: [...r.querySelectorAll('.qf-menu-keys__kb kbd')].map((k) => k.textContent).join(' '),
    pad: [...r.querySelectorAll('.qf-menu-keys__pad .qf-padbtn')].map((k) => k.textContent).join(' '),
  }));
  const banner = document.querySelector('.qf-menu-pad');
  return { rows, banner: banner && !banner.hidden ? banner.querySelector('.qf-menu-pad__msg')?.textContent : null };
};

export default async function (t) {
  // ---- no controller: generic labels, no banner
  await t.goto('#/');
  let c = await t.eval(card);
  t.log('no pad', c);
  const pad = (what) => c.rows.find((r) => r.what?.startsWith(what))?.pad;
  t.assert(c.banner === null, 'no controller banner without a controller');
  t.assert(pad('Sword') === 'A' && pad('Action') === 'B' && pad('Use item') === 'X', `generic face buttons (${pad('Sword')} ${pad('Action')} ${pad('Use item')})`);
  t.assert(pad('Pause') === 'Menu' && pad('Map') === 'View', `generic Menu / View (${pad('Pause')} ${pad('Map')})`);
  t.assert(c.rows.find((r) => r.what === 'Move')?.kb === 'Arrows WASD', 'keyboard column keeps Arrows / WASD');
  const shotBox = async (label) => {
    const box = await t.page.locator('.qf-menu-side__card').first().boundingBox();
    const p = `${t.outDir}/${label}.png`;
    await t.page.screenshot({ path: p, clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
    return p;
  };
  await shotBox('controls-no-pad');

  // ---- PlayStation pad
  await installFakePad(t.page, { id: PAD_IDS.playstation });
  await t.page.reload();
  await t.page.waitForFunction(() => window.__qf?.ready);
  await t.until(() => !!document.querySelector('.qf-menu-pad:not([hidden])'));
  c = await t.eval(card);
  t.log('playstation', c);
  t.assert(pad('Sword') === '✕' && pad('Action') === '○' && pad('Use item') === '□', `PlayStation shapes in Unicode (${pad('Sword')} ${pad('Action')} ${pad('Use item')})`);
  t.assert(pad('Pause') === 'Options' && pad('Map') === 'Create' && pad('Pause pages') === 'L1 R1', `PlayStation Options / Create / L1 R1 (${pad('Pause')} ${pad('Map')} ${pad('Pause pages')})`);
  t.assert(/DualSense Wireless Controller connected — ○ select · ✕ back/.test(c.banner ?? ''), `banner in PlayStation shapes (${c.banner})`);
  const privateUse = await t.eval(() => /[-]/.test(document.querySelector('.qf-menu').textContent));
  t.assert(!privateUse, 'no bitmap-font private-use glyphs leak into DOM text');
  await shotBox('controls-playstation');
  await t.shot('hub-playstation');

  // Swapped face buttons: sword and action trade glyphs at once.
  await padPress(t, PAD.down); // pad used: focus lands on "Play the sample adventure"
  await t.eval(async () => (await import('/src/input/devices.ts')).setControllerPrefs({ swapFaceButtons: true }));
  await t.wait(50);
  c = await t.eval(card);
  t.assert(pad('Sword') === '○' && pad('Action') === '✕', `swapped: sword ○, action ✕ (${pad('Sword')} ${pad('Action')})`);
  t.assert(/✕ select · ○ back/.test(c.banner ?? ''), `swapped banner (${c.banner})`);
  await shotBox('controls-playstation-swapped');
  await t.eval(async () => (await import('/src/input/devices.ts')).setControllerPrefs({ swapFaceButtons: false }));

  // ---- a message page: 'b' (bottom face = ✕) goes back to the menu, the pad moves between its buttons
  await t.goto('#/nowhere');
  const first = await t.eval(() => document.activeElement?.textContent);
  await padPress(t, PAD.dright);
  const moved = await t.eval(() => ({ text: document.activeElement?.textContent, ring: document.activeElement?.classList.contains('qf-pad-focus') }));
  t.log('message page', first, moved);
  t.assert(moved.text === 'Play the sample adventure' && moved.ring, `the pad moves between the message page buttons (${moved.text})`);
  await t.shot('not-found-pad');
  await padPress(t, PAD.bottom);
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);
  const padNavs = await t.eval(async () => (await import('/src/app/padNav.ts')).padNavCount());
  t.assert(padNavs === 1, `exactly one pad navigator runs on the menu (${padNavs})`);

  // ---- the right stick scrolls the hub
  await t.wait(300);
  const top0 = await t.eval(() => document.querySelector('.qf-menu').scrollTop);
  await t.eval(() => { window.__fakePad.pad.axes[3] = 1; });
  await t.wait(400);
  await t.eval(() => { window.__fakePad.pad.axes[3] = 0; });
  const top1 = await t.eval(() => document.querySelector('.qf-menu').scrollTop);
  t.log('right stick scroll', top0, top1);
  t.assert(top1 > top0 + 100, `the right stick scrolls the menu (${top0} -> ${top1})`);

  // ---- the gallery: the pad reaches its links, 'b' goes back to the menu
  await t.goto('#/gallery');
  await padPress(t, PAD.down);
  const gal = await t.eval(() => ({ tag: document.activeElement?.tagName, ring: document.activeElement?.classList.contains('qf-pad-focus') }));
  t.assert(gal.ring && gal.tag === 'A', `the pad focuses a gallery link (${gal.tag})`);
  await padPress(t, PAD.bottom);
  await t.until(() => window.__qf.route?.view === 'menu' && window.__qf.ready);

  // ---- a confirm dialog traps pad focus too; 'b' cancels and focus returns to the card's delete button
  await t.eval(async () => {
    const { saveProject } = await import('/src/core/storage.ts');
    const { createBlankProject } = await import('/src/core/project.ts');
    await saveProject(createBlankProject('Pad Quest', ''));
  });
  await t.goto('#/nowhere');
  await padPress(t, PAD.bottom); // back to the menu, which now lists "Pad Quest"
  await t.until(() => !!document.querySelector('.qf-menu-card__delete'));
  await t.eval(() => document.querySelector('.qf-menu-card__delete').focus());
  await padPress(t, PAD.right); // ○ = action = select
  await t.until(() => !!document.querySelector('.qf-modal'));
  const inConfirm = [];
  for (const b of [PAD.dright, PAD.up, PAD.down, PAD.dleft, PAD.dleft]) {
    await padPress(t, b);
    inConfirm.push(await t.eval(() => ({ text: document.activeElement?.textContent, inModal: !!document.activeElement?.closest('.qf-modal') })));
  }
  t.log('confirm dialog', inConfirm.map((x) => x.text));
  t.assert(inConfirm.every((x) => x.inModal), 'pad focus stays in the confirm dialog');
  t.assert(inConfirm[0].text === 'Delete', `right reaches Delete (${inConfirm[0].text})`);
  await t.shot('confirm-delete-pad');
  await padPress(t, PAD.bottom); // ✕ = back
  await t.until(() => !document.querySelector('.qf-modal'));
  const afterCancel = await t.eval(() => ({
    deleteFocused: document.activeElement?.classList.contains('qf-menu-card__delete'),
    card: !!document.querySelector('.qf-menu-card__name') && [...document.querySelectorAll('.qf-menu-card__name')].some((n) => n.textContent === 'Pad Quest'),
  }));
  t.assert(afterCancel.deleteFocused && afterCancel.card, 'cancelled: the project stays and focus is back on its delete button');
}
