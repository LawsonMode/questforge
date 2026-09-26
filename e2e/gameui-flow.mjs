// Game UI e2e: title screen -> file select -> name entry (typing + letter grid)
// -> gameplay; the HUD with items given through services.giveItem (rolling
// counters); dialogue with a speaker, typewriter, auto-split long pages and a
// choice list resolved through services.dialogue.
const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);

/** Resolves once the current dialogue box has revealed all of its text (DialogueBox internals, read-only). */
const revealed = (t) => t.until(() => {
  const db = window.__qf.game.services.dialogueBox;
  const b = db.current && db.current.boxes[db.boxIndex];
  return !b || db.reveal >= b.lines.reduce((n, l) => n + l.length, 0);
}, undefined, 6000);

const boxInfo = (t) => t.eval(() => {
  const db = window.__qf.game.services.dialogueBox;
  const c = db.current;
  if (!c) return null;
  const b = c.boxes[db.boxIndex];
  return { index: db.boxIndex, count: c.boxes.length, options: !!b.options };
});

/** A little over the dialogue box's CHOICE_DELAY (0.25 s). */
const CHOICE_LOCK_MS = 300;

export default async function (t) {
  await t.goto('#/play/test');
  await t.wait(500);
  await t.shotCanvas('title-fading-in');
  await t.wait(1600);
  await t.shotCanvas('title');
  t.assert((await state(t)) === 'title', 'the title screen shows first');

  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'fileSelect');
  await t.wait(300);
  await t.shotCanvas('file-select');

  // Empty slot 1 -> name entry.
  await t.press('Enter');
  await t.wait(200);
  await t.shotCanvas('name-entry-empty');
  // An empty name is refused.
  await t.press('Enter');
  await t.wait(100);
  t.assert((await state(t)) === 'fileSelect', 'an empty name cannot be confirmed');
  await t.page.keyboard.type('Ana');
  await t.wait(100);
  // Grid: move right + down (to "O") and pick it with the action key; X must not type an "x" here.
  await t.press('ArrowRight');
  await t.press('ArrowDown');
  await t.press('KeyX');
  await t.wait(150);
  await t.shotCanvas('name-entry');
  await t.press('Enter');
  await t.until(() => ['playing', 'dialogue'].includes(window.__qf.game.state));
  const name = await t.eval(() => window.__qf.game.services.save.name);
  t.assert(name === 'AnaO', `the typed + picked name is used (${name})`);

  // Clear the intro dialogue if the project has one.
  for (let i = 0; i < 12 && (await state(t)) === 'dialogue'; i++) {
    await t.press('KeyX');
    await t.wait(200);
  }
  await t.wait(300);
  await t.shotCanvas('hud-start');

  // HUD: items, ammo, rupees rolling up, more hearts.
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.giveItem('bow', 1);
    s.giveItem('arrows', 25);
    s.giveItem('bombs', 8);
    s.giveItem('rupees', 250);
    s.save.maxHp = 28;
    s.save.hp = 17;
    s.save.magic = 20;
    s.save.equipped = 'bow';
  });
  await t.wait(120);
  await t.shotCanvas('hud-rolling');
  const shown = await t.eval(async () => (await import('/src/game/ui/hud.ts')).hudCounters(window.__qf.game.services.save).rupees);
  t.assert(shown > 0 && shown < 250, `the rupee counter rolls up gradually (${shown} shown mid-roll)`);
  await t.wait(1500);
  await t.shotCanvas('hud-items');

  // Low health: hearts pulse.
  await t.eval(() => { window.__qf.game.services.save.hp = 2; });
  await t.wait(200);
  await t.shotCanvas('hud-low-health');
  await t.eval(() => { window.__qf.game.services.save.hp = 12; });

  // Dialogue with a speaker, a long page (split into boxes) and a choice.
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.project.dialogues.push({
      id: 'e2e_sage', name: 'Sage',
      pages: [
        { speaker: 'Old Sage', text: 'Ah, {name}! The wind told me you would come. The shrine to the north has been silent for a hundred winters, and its guardian sleeps no more. Few who enter return, yet you carry a spark I have not seen in many years.' },
        { speaker: 'Old Sage', text: 'Will you climb to the shrine?', choice: { options: ['Of course!', 'Not yet...'] } },
      ],
    });
    window.__choice = undefined;
    s.dialogue('e2e_sage').then((i) => { window.__choice = i; });
  });
  await t.wait(350);
  await t.shotCanvas('dialogue-typing');
  t.assert((await state(t)) === 'dialogue', 'dialogue state while the box is open');
  let info = await boxInfo(t);
  t.assert(!!info && info.count >= 3, `the long page was split into several boxes (${info && info.count})`);
  while (info && !info.options) {
    await revealed(t);
    await t.shotCanvas(`dialogue-box-${info.index}`);
    await t.press('KeyX');
    await t.wait(120);
    info = await boxInfo(t);
  }
  await revealed(t);
  // Options take no input for a moment after they appear (so mashed text skips never answer).
  await t.wait(CHOICE_LOCK_MS);
  await t.press('ArrowDown');
  await t.wait(150);
  await t.shotCanvas('dialogue-choice');
  await t.press('KeyX');
  await t.until(() => window.__choice !== undefined, undefined, 3000).catch(() => {});
  const choice = await t.eval(() => window.__choice);
  t.assert(choice === 1, `the second option resolves the promise with 1 (${choice})`);
  await t.wait(200);
  t.assert((await state(t)) === 'playing', 'gameplay resumes after the dialogue');

  // A three-option choice keeps its question line (4 tighter rows).
  await t.eval(() => {
    const s = window.__qf.game.services;
    s.project.dialogues.push({ id: 'e2e_paths', name: 'Paths', pages: [{ text: 'Which way, {name}?', choice: { options: ['North', 'East', 'West'] } }] });
    window.__choice = undefined;
    s.dialogue('e2e_paths').then((i) => { window.__choice = i; });
  });
  await t.wait(200);
  await revealed(t);
  await t.wait(CHOICE_LOCK_MS);
  await t.press('ArrowUp');
  await t.wait(120);
  await t.shotCanvas('dialogue-three-options');
  await t.press('KeyX');
  await t.until(() => window.__choice !== undefined, undefined, 3000).catch(() => {});
  const third = await t.eval(() => window.__choice);
  t.assert(third === 2, `up from the first option wraps to the last (${third})`);
}
