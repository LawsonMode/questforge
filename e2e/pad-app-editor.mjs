// Controllers and the editor: no pad polling runs there (pad presses change
// nothing); the dialogue preview renders {btn:x} codes for the device in use
// or the one picked under "Buttons as"; "Insert button" puts a code at the
// caret; the help lists the controller's buttons; the playtest bar names the
// controller's way back next to Escape.
import { installFakePad, padHold, padPress, PAD, PAD_IDS } from './lib/fakepad.mjs';

export default async function (t) {
  t.allowConsole(/\[editor\] the (map|art|dialogue|project) tab failed to load/);
  await installFakePad(t.page, { id: PAD_IDS.playstation });
  const { page } = t;
  await t.goto('#/edit/sample');
  await t.until(() => !!window.__qf.editor && !!document.querySelector('.qf-shell'), null, 10000);
  await t.wait(400);

  // ---- no pad navigation in the editor
  const padNavs = async () => t.eval(async () => (await import('/src/app/padNav.ts')).padNavCount());
  t.assert(await padNavs() === 0, 'no menu pad navigator runs in the editor');
  const before = await t.eval(() => ({ focus: document.activeElement?.outerHTML.slice(0, 80), tab: window.__qf.editor.ctx.activeTab, modal: !!document.querySelector('.qf-modal') }));
  for (const b of [PAD.down, PAD.dright, PAD.right, PAD.bottom, PAD.start]) await padPress(t, b);
  const after = await t.eval(() => ({ focus: document.activeElement?.outerHTML.slice(0, 80), tab: window.__qf.editor.ctx.activeTab, modal: !!document.querySelector('.qf-modal') }));
  t.assert(JSON.stringify(before) === JSON.stringify(after), 'pad presses do nothing in the editor');
  t.assert(await t.eval(() => window.__qf.route.view) === 'edit', 'still in the editor');

  // ---- Dialogue tab: {btn:x} codes in the preview
  await page.keyboard.press('Digit3');
  await t.until(() => !!document.querySelector('.qf-dlg-page__text'), null, 8000);
  await t.wait(300);
  const help = await t.eval(() => document.querySelector('.qf-dlg-codes')?.textContent ?? '');
  t.log('codes help', help);
  for (const code of ['{name}', '{btn:a}', '{btn:b}', '{btn:y}', '{btn:start}', '{btn:select}', '{btn:l}', '{btn:r}', '{btn:move}']) {
    t.assert(help.includes(code), `the codes help documents ${code}`);
  }
  t.assert(!help.includes('{btn:x}'), 'the unused top button is not offered');
  const text = 'Press {btn:a} to talk, {btn:b} to swing. Walk with {btn:move}; {btn:start} pauses.';
  await page.fill('.qf-dlg-page__text >> nth=0', text);
  await page.evaluate(() => document.activeElement?.blur());
  await t.wait(300);
  const grab = () => t.eval(() => document.querySelector('.qf-dlg-preview__canvas').toDataURL());
  const shotPreview = async (label) => {
    const box = await page.locator('.qf-dlg-preview').boundingBox();
    const p = `${t.outDir}/${label}.png`;
    await page.screenshot({ path: p, clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } });
  };
  const keyboardPreview = await grab();
  await shotPreview('preview-device-keyboard');
  await t.shot('dialogue-tab');

  const setAs = async (value) => {
    await page.selectOption('.qf-dlg-preview__as', value);
    await t.wait(150);
    return grab();
  };
  const psPreview = await setAs('playstation');
  t.assert(psPreview !== keyboardPreview, 'PlayStation button names change the preview');
  await shotPreview('preview-playstation');
  const nintendoPreview = await setAs('nintendo');
  t.assert(nintendoPreview !== psPreview, 'Nintendo-layout names change the preview again');
  await shotPreview('preview-nintendo');
  const xboxPreview = await setAs('xbox');
  await shotPreview('preview-xbox');
  const kbPreview = await setAs('keyboard');
  t.assert(kbPreview === keyboardPreview && xboxPreview !== kbPreview, 'keyboard names match the device in use (keyboard)');
  await setAs('auto');

  // Device in use changes -> the preview follows ("auto").
  await t.eval(async () => (await import('/src/input/devices.ts')).notePad(0, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
  await t.wait(150);
  t.assert(await grab() === psPreview, 'with the PlayStation pad in use, the preview shows its shapes');
  await t.eval(async () => (await import('/src/input/devices.ts')).noteKeyboard());
  await t.wait(150);
  t.assert(await grab() === keyboardPreview, 'back on the keyboard, the preview shows keys again');

  // ---- Insert button at the caret (one undo step)
  await page.click('.qf-dlg-page__text >> nth=0');
  await t.eval(() => {
    const ta = document.querySelector('.qf-dlg-page__text');
    ta.setSelectionRange(6, 6); // after "Press "
  });
  await page.selectOption('.qf-dlg-insert >> nth=0', '{btn:y}');
  await t.wait(200);
  const inserted = await t.eval(() => ({
    value: document.querySelector('.qf-dlg-page__text').value,
    focus: document.activeElement?.classList.contains('qf-dlg-page__text'),
    picker: document.querySelector('.qf-dlg-insert').value,
    undo: window.__qf.editor.ctx.undo.peekUndo(),
  }));
  t.log('inserted', inserted);
  t.assert(inserted.value.startsWith('Press {btn:y}{btn:a}'), `the code lands at the caret (${inserted.value.slice(0, 30)})`);
  t.assert(inserted.focus && inserted.picker === '', 'focus goes back to the text, the picker resets');
  t.assert(inserted.undo === 'Edit text', `the insert is an undo step (${inserted.undo})`);
  await t.shot('dialogue-inserted');

  // ---- help: the controller's buttons for playtesting (the PlayStation pad is connected)
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Shift+Slash');
  await t.until(() => !!document.querySelector('.qf-help'));
  const helpInfo = await t.eval(() => ({
    pad: [...document.querySelectorAll('.qf-help__game .qf-help__pad')].map((n) => n.textContent),
    exit: document.querySelector('.qf-help dt.qf-help__pad')?.textContent ?? '',
  }));
  t.log('help', helpInfo);
  t.assert(helpInfo.pad.includes('✕') && helpInfo.pad.includes('○') && helpInfo.pad.includes('Options'), 'help lists the PlayStation buttons');
  t.assert(/hold\s*Options\s*\+\s*Create/.test(helpInfo.exit), `help names the controller's way back (${helpInfo.exit})`);
  await t.shot('help');
  await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-help'));

  // ---- playtest bar: Esc or hold Options + Create
  await page.keyboard.press('F5');
  await t.until(() => !!document.querySelector('.qf-playtest') && !!window.__qf.game, null, 8000);
  await t.wait(600);
  const bar = await t.eval(() => {
    const hint = document.querySelector('.qf-playtest__padhint');
    return { hidden: hint?.hidden, text: document.querySelector('.qf-playtest__return')?.textContent ?? '', title: document.querySelector('.qf-playtest__close')?.title };
  });
  t.log('bar', bar);
  t.assert(!bar.hidden && /Esc\s*or hold\s*Options\s*\+\s*Create\s*to return/.test(bar.text), `the bar names the controller's way back (${bar.text})`);
  t.assert(/hold Options \+ Create/.test(bar.title ?? ''), 'the return button says so too');
  const barBox = await page.locator('.qf-playtest__bar').boundingBox();
  await page.screenshot({ path: `${t.outDir}/playtest-bar.png`, clip: { x: 0, y: 0, width: barBox.width, height: barBox.height + 60 } });
  t.assert(await padNavs() === 0, 'no menu pad navigator during the playtest');
  // What the bar promises: holding Start + Select (Options + Create) returns to the editor.
  await padHold(t, [PAD.start, PAD.select], 1400);
  const left = await t.until(() => !document.querySelector('.qf-playtest'), null, 3000);
  if (!left) await page.keyboard.press('Escape');
  await t.until(() => !document.querySelector('.qf-playtest') && !document.querySelector('.qf-shell').hidden, null, 5000);
}
