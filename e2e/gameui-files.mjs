// Game UI e2e: file select with existing saves (name, hearts, gear, crystals,
// play time), the erase flow with its confirmation (NO keeps, YES erases),
// loading an existing file straight into gameplay, Escape never confirming (on
// the list, in name entry, in the erase confirmation) and B back to the title.
const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);
/** File select mode ('select' | 'name' | 'erase' | 'confirmErase'), from the game's screen internals. */
const mode = (t) => t.eval(() => window.__qf.game.fileSelect && window.__qf.game.fileSelect.mode);
const saveNames = (t) => t.eval(async () => (await (await import('/src/core/storage.ts')).listSaves('test')).map((s) => s && s.name));

export default async function (t) {
  await t.goto('#/');
  await t.eval(async () => {
    const storage = await import('/src/core/storage.ts');
    const { newSave } = await import('/src/game/state.ts');
    const { createTestProject } = await import('/src/content/testProject.ts');
    const project = createTestProject();
    const a = newSave(project, 0, 'Rowan');
    Object.assign(a, { maxHp: 22, hp: 19, crystals: 2, playTime: 5423, rupees: 120 });
    Object.assign(a.items, { sword: 2, shield: 1, bow: 1, boomerang: 1, hookshot: 1, lantern: 1, boots: 1, glove: 1, flippers: 1 });
    a.bombs = 4;
    a.items.bombs = 1;
    const c = newSave(project, 2, 'Mei');
    Object.assign(c, { playTime: 312 });
    c.items.sword = 1;
    await storage.writeSave(a);
    await storage.writeSave(c);
  });
  await t.goto('#/play/test');
  await t.wait(300);
  await t.press('Enter');
  await t.wait(150);
  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'fileSelect');
  await t.wait(300);
  await t.shotCanvas('slots');

  // ERASE A FILE -> pick file 3 -> NO keeps it.
  await t.press('ArrowUp');
  await t.wait(80);
  await t.press('KeyX');
  await t.wait(150);
  await t.shotCanvas('erase-mode');
  await t.press('ArrowDown');
  await t.press('ArrowDown');
  await t.wait(80);
  await t.press('KeyX');
  await t.wait(150);
  await t.shotCanvas('erase-confirm');
  await t.press('KeyX');
  await t.wait(200);
  let saves = await t.eval(async () => (await (await import('/src/core/storage.ts')).listSaves('test')).map((s) => s && s.name));
  t.assert(saves[2] === 'Mei', `NO keeps the file (${JSON.stringify(saves)})`);

  // Again (the cursor is still on file 3), choosing YES erases it.
  await t.press('KeyX');
  await t.wait(150);
  await t.press('ArrowDown');
  await t.wait(80);
  await t.shotCanvas('erase-confirm-yes');
  await t.press('KeyX');
  await t.wait(500);
  saves = await t.eval(async () => (await (await import('/src/core/storage.ts')).listSaves('test')).map((s) => s && s.name));
  t.assert(saves[2] === null, `YES erases the file (${JSON.stringify(saves)})`);
  await t.shotCanvas('after-erase');
  t.assert((await state(t)) === 'fileSelect', 'back on the slot list after erasing');

  // Load file 1 (the cursor stayed on the erased slot 3).
  await t.press('ArrowUp');
  await t.press('ArrowUp');
  await t.wait(80);
  await t.shotCanvas('slot-1-selected');
  await t.press('Enter');
  await t.until(() => ['playing', 'dialogue'].includes(window.__qf.game.state));
  const loaded = await t.eval(() => window.__qf.game.services.save.name);
  t.assert(loaded === 'Rowan', `the existing file is loaded (${loaded})`);
  await t.wait(300);
  await t.shotCanvas('loaded');

  // B on the file select returns to the title (restart the game through the menu route).
  await t.goto('#/');
  await t.goto('#/play/test');
  await t.wait(200);
  await t.press('Enter');
  await t.wait(150);
  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'fileSelect');
  await t.wait(150);

  // Escape never confirms: on an empty slot it opens no name entry...
  await t.press('ArrowDown');
  await t.wait(80);
  await t.press('Escape');
  await t.wait(150);
  const listEsc = { state: await state(t), mode: await mode(t) };
  t.log('Escape on the slot list', listEsc);
  t.assert(listEsc.state === 'title' || (listEsc.state === 'fileSelect' && listEsc.mode === 'select'), `Escape on an empty slot opens nothing (${JSON.stringify(listEsc)})`);
  if (listEsc.state === 'title') {
    // The title replays its fade-in: the first press may only skip it.
    for (let i = 0; i < 5 && (await state(t)) !== 'fileSelect'; i++) {
      await t.press('Enter');
      await t.wait(400);
    }
    t.assert((await state(t)) === 'fileSelect', 'Enter on the title reopens the file select');
    await t.wait(150);
    await t.press('ArrowDown');
  }
  // ...in name entry it never creates the file...
  await t.press('KeyX');
  await t.wait(150);
  t.assert((await mode(t)) === 'name', 'A on an empty slot opens name entry');
  await t.page.keyboard.type('Bob');
  await t.wait(100);
  await t.press('Escape');
  await t.wait(200);
  const nameEsc = { state: await state(t), mode: await mode(t), saves: await saveNames(t) };
  t.log('Escape in name entry', nameEsc);
  t.assert(nameEsc.state === 'fileSelect' && nameEsc.saves[1] === null, `Escape in name entry creates no file (${JSON.stringify(nameEsc)})`);
  if (nameEsc.mode === 'name') {
    // Backspace clears the typed name; after a grid move Z is the B button again (leave on an empty name).
    for (let i = 0; i < 3; i++) await t.press('Backspace');
    await t.press('ArrowRight');
    await t.press('KeyZ');
    await t.wait(100);
  }
  t.assert((await mode(t)) === 'select', 'name entry was left without creating a file');
  // ...and with YES highlighted in the erase confirmation it erases nothing.
  await t.press('ArrowUp');
  await t.press('ArrowUp');
  await t.wait(80);
  await t.press('KeyX');
  await t.wait(150);
  await t.press('KeyX');
  await t.wait(150);
  await t.press('ArrowDown');
  await t.wait(80);
  t.assert((await mode(t)) === 'confirmErase', 'the erase confirmation is up with YES highlighted');
  await t.press('Escape');
  await t.wait(300);
  const eraseEsc = { mode: await mode(t), saves: await saveNames(t) };
  t.log('Escape in the erase confirmation', eraseEsc);
  t.assert(eraseEsc.saves[0] === 'Rowan', `Escape in the erase confirmation keeps the file (${JSON.stringify(eraseEsc)})`);
  await t.shotCanvas('after-escapes');

  // B backs out of the erase flow, then from the slot list to the title.
  for (let i = 0; i < 3 && (await state(t)) === 'fileSelect'; i++) {
    await t.press('KeyZ');
    await t.wait(200);
  }
  t.assert((await state(t)) === 'title', 'B goes back to the title screen');
}
