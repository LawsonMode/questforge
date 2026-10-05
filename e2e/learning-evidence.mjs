// Learning layer end to end: a student builds a trigger in the editor (through
// the editor context, as the trigger form does), opens "Show as code",
// playtests, opens "Under the hood" on the Art tab, then My Learning shows the
// recorded work with proposed levels and exports it.
export default async function (t) {
  await t.goto('#/edit/sample');
  await t.until(() => window.__qf.editor?.ctx);
  await t.eval(() => indexedDB.deleteDatabase('questforge-learning'));

  // Build a trigger in the village (enter → if flag and has Gems → dialogue, give, set flag).
  await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    ctx.selectRoom('ellendor', 'ow_village');
    const room = ctx.room();
    room.triggers.push({
      id: 't_e2e', name: 'Reward', on: 'enter', once: true,
      conditions: [{ kind: 'flag', flag: 'gotSword', value: true }, { kind: 'hasItem', item: 'rupees', min: 5 }],
      actions: [{ kind: 'dialogue', dialogue: ctx.project.dialogues[0].id }, { kind: 'giveItem', item: 'rupees', amount: 20 }, { kind: 'setFlag', flag: 'rewarded', value: true }],
    });
    ctx.changed('triggers', room.id);
  });

  // The trigger panel's code box shows it as code.
  await t.eval(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Triggers')?.click());
  await t.until(() => document.querySelector('details.qf-trig-code'));
  await t.eval(() => {
    const items = [...document.querySelectorAll('.qf-ent-trig-item')];
    items.find((li) => li.dataset.trigger === 't_e2e')?.click();
  });
  await t.wait(300);
  await t.eval(() => {
    const d = document.querySelector('details.qf-trig-code');
    if (!d.open) d.querySelector('summary').click();
    d.scrollIntoView({ block: 'end' });
  });
  const code = await t.eval(() => document.querySelector('details.qf-trig-code pre')?.textContent ?? '');
  t.assert(code.includes('when room.enter:') && code.includes('if flag("gotSword") and count("Gems") >= 5:'), `code view: ${code}`);
  t.assert(!/rupees/.test(code), 'code view uses display item names');
  await t.shot('trigger-code');

  // Playtest (records the pending trigger first), then come back.
  await t.wait(1700);
  await t.eval(() => window.__qf.editor.ctx.playtest());
  await t.until(() => window.__qf.game);
  await t.wait(500);
  await t.press('Escape');
  await t.until(() => !window.__qf.editor.playtesting);

  // Under the hood on the Art tab, hovering a pixel.
  await t.eval(() => window.__qf.editor.ctx.switchTab('art'));
  await t.until(() => document.querySelector('details.qf-hood'));
  await t.eval(() => {
    const d = document.querySelector('details.qf-hood');
    if (!d.open) d.querySelector('summary').click();
  });
  await t.wait(400);
  const box = await t.page.locator('.qf-art-canvas').boundingBox();
  await t.page.mouse.move(box.x + box.width / 2 - 8, box.y + box.height / 2 - 8);
  await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await t.until(() => document.querySelector('.qf-hood__table'));
  const hood = await t.eval(() => document.querySelector('.qf-hood__facts').innerText);
  t.assert(/256 pixels/.test(hood) && /As 15 bits/.test(hood), `under the hood: ${hood}`);
  await t.shot('under-the-hood');

  // My Learning.
  await t.goto('#/learning');
  await t.until(() => document.querySelectorAll('.qf-learn-skill').length === 6);
  await t.until(() => document.querySelectorAll('.qf-learn__timeline li').length >= 4);
  const levels = await t.eval(() => Object.fromEntries([...document.querySelectorAll('.qf-learn-skill')]
    .map((s) => [s.dataset.skill, Number(/Level (\d)/.exec(s.querySelector('.qf-learn-skill__lvl').textContent)[1])])));
  t.log('levels', levels);
  t.assert(levels['prog.selection'] === 3, `selection level ${levels['prog.selection']}`);
  t.assert(levels['prog.sequence'] === 3, `sequence level ${levels['prog.sequence']}`);
  t.assert(levels['prog.trace'] >= 1, 'trace level');
  t.assert(levels['prog.debug'] >= 1, 'debug level');
  t.assert(levels['data.images'] >= 1, 'images level');
  await t.shot('my-learning');

  const [download] = await Promise.all([
    t.page.waitForEvent('download'),
    t.eval(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export for my teacher').click()),
  ]);
  t.assert(/^questforge-learning-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
}
