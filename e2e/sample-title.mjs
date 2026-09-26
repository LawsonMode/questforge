// What a player sees first on #/play/sample: the title screen, file select,
// naming the hero, the intro (with the chosen name) and waking up at home with
// three hearts and a shield. Screenshots land in e2e-out/sample-title/.
import { boxText, freezeHotReload, px, snap } from './sample-opening.mjs';

const state = (t) => t.eval(() => window.__qf.game && window.__qf.game.state);

/** Wait until the typewriter has revealed the whole box. */
const revealed = (t) => t.until(() => {
  const db = window.__qf.game.services.dialogueBox;
  const box = db.current && db.current.boxes[db.boxIndex];
  return !box || db.reveal >= box.lines.reduce((n, l) => n + l.length, 0);
}, undefined, 8000);

export default async function (t) {
  await freezeHotReload(t);
  await t.goto('#/play/sample');
  await t.wait(2200);
  t.assert((await state(t)) === 'title', 'the title screen shows first');
  await t.shotCanvas('title');

  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'fileSelect');
  await t.wait(300);
  await t.shotCanvas('file-select');
  await t.press('Enter');
  await t.wait(200);
  await t.page.keyboard.type('Wren');
  await t.press('Enter');
  await t.until(() => window.__qf.game.state === 'dialogue', undefined, 6000);

  const pages = [];
  for (let i = 0; i < 12 && (await state(t)) === 'dialogue'; i++) {
    await revealed(t);
    pages.push(await boxText(t));
    await t.shotCanvas(`intro-${i + 1}`);
    await t.press('KeyX');
    await t.wait(250);
  }
  t.log('intro', pages);
  t.assert(pages.length >= 3, `the intro has its pages (${pages.length})`);
  t.assert(pages.some((p) => p && p.includes('Wren')), 'the intro greets the hero by name');

  await t.until(() => window.__qf.game.state === 'playing', undefined, 4000);
  await t.wait(300);
  const s = await t.eval(snap);
  t.assert(s.room === 'in_hero_house' && s.x === px(5) && s.y === px(4), `wakes up beside the bed (${s.room} ${s.x},${s.y})`);
  t.assert(s.maxHp === 6 && s.hp === 6, `three hearts (${s.hp}/${s.maxHp})`);
  t.assert(JSON.stringify(s.items) === '{"shield":1}', `a shield and nothing else (${JSON.stringify(s.items)})`);
  await t.shotCanvas('wake-up');
}
