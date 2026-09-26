// Engine e2e: play mode flow — title -> file select -> gameplay (works with the
// UI stubs, which advance on their own; with the real UI it presses Enter /
// types a name until gameplay starts), then pause/unpause and a save write.
export default async function (t) {
  await t.goto('#/play/test');
  // Full reloads mid-run (e.g. the dev server reacting to file edits) reset the game; count them for the report.
  let reloads = 0;
  t.page.on('load', () => { reloads++; });
  await t.wait(200);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const state = await t.eval(() => window.__qf.game && window.__qf.game.state);
    if (state && !seen.has(state)) {
      seen.add(state);
      await t.shotCanvas(`state-${state}`);
    }
    if (state === 'playing' || state === 'dialogue') break;
    if (state === 'fileSelect' && i % 4 === 3) await t.page.keyboard.type('HERO');
    await t.press('Enter', 60);
    await t.wait(200);
  }
  t.log('states seen', [...seen]);
  const s = await t.eval(() => {
    const g = window.__qf.game;
    const sv = g.services;
    return sv && { state: g.state, room: sv.room.def.id, name: sv.save.name, slot: sv.save.slot, hp: sv.save.hp };
  });
  t.log('gameplay', s);
  t.assert(!!s, 'gameplay started from the title screen');
  if (!s) return;
  t.assert(s.room === 'ow_meadow', `new game starts at project.start (${s.room})`);
  const stored = await t.eval(async (slot) => {
    const storage = await import('/src/core/storage.ts');
    const saves = await storage.listSaves('test');
    return saves[slot] && { name: saves[slot].name, projectId: saves[slot].projectId };
  }, s.slot);
  t.assert(!!stored && stored.projectId === 'test', `the new save file was written (${JSON.stringify(stored)})`);
  // Clear any intro text, then walk a little.
  for (let i = 0; i < 10 && (await t.eval(() => window.__qf.game.state)) === 'dialogue'; i++) {
    await t.press('KeyX');
    await t.wait(250);
  }
  await t.hold('ArrowLeft', 400);
  await t.shotCanvas('gameplay');
  const moved = await t.eval(() => window.__qf.game.services.player.x);
  t.assert(moved < 126, `the hero walks in play mode (x=${moved})`);

  // Pause opens (the real menu stays open until closed; the stub resumes at once).
  await t.press('Enter');
  await t.wait(200);
  await t.shotCanvas('after-start-button');
  const st = await t.eval(() => window.__qf.game.state);
  t.log('state after Start', st);
  if (st === 'paused') {
    await t.press('Enter');
    await t.wait(200);
  }
  const playTime = await t.eval(() => window.__qf.game.services.save.playTime);
  t.assert(playTime > 0.5, `play time accumulates (${playTime.toFixed(2)} s)`);
  t.log('page reloads during the run', reloads);
}
