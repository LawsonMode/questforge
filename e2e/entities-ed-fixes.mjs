// Real-editor checks (#/edit/sample, 1280x720) for the review fixes: palette
// category chips, shutter-only door fields, no false door-link warnings on
// the sample's boss room, the unset "Show dialogue" default, keyboard
// navigation of the dialogue list and flag names typed with stray spaces.

/** Room + entity of the sample by entity id (page function). */
const locate = (id) => {
  const ctx = window.__qf.editor.ctx;
  for (const w of ctx.project.worlds) for (const r of w.rooms) {
    if (r.entities.some((e) => e.id === id)) return { world: w.id, room: r.id };
  }
  return null;
};

/** Visible text of the map sidebar's inspector warnings. */
const inspectorWarnings = () => [...document.querySelectorAll('.qf-map-right .qf-ent-insp .qf-ent-warn li')].map((li) => li.textContent);

export default async function (t) {
  const page = t.page;
  await page.setViewportSize({ width: 1280, height: 720 });
  await t.goto('#/edit/sample');
  await t.wait(500);
  if (!(await t.eval(() => !!window.__qf.editor?.ctx))) {
    t.assert(false, 'editor context is exposed');
    return;
  }

  // ---------------------------------------------------------------- palette chips
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' }).click();
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-cats'));
  const warpVisible = () => {
    const list = document.querySelector('.qf-map-right .qf-ent-palette__list');
    const item = list?.querySelector('.qf-ent-item[data-type="marker.warp"]');
    if (!list || !item) return false;
    const a = list.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  };
  const boss = await t.eval(locate, 'kp_boss_door_n');
  t.assert(!!boss, 'the sample has the boss room door');
  await t.eval((b) => {
    const ctx = window.__qf.editor.ctx;
    ctx.selectRoom(b.world, b.room);
    ctx.selectEntity('kp_boss_door_n');
  }, boss);
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-head__name')?.textContent === 'Door');
  t.assert(!(await t.eval(warpVisible)), 'with an entity selected the Warp marker starts below the fold');
  await page.locator('.qf-map-right .qf-ent-cat-chip', { hasText: 'Markers' }).click();
  await t.wait(80);
  t.assert(await t.eval(warpVisible), 'the Markers chip scrolls the palette to the Warp marker');
  await page.locator('.qf-map-right .qf-ent-search').fill('warp');
  const chips = await t.eval(() => [...document.querySelectorAll('.qf-map-right .qf-ent-cat-chip')]
    .map((c) => `${c.firstChild?.textContent}:${c.querySelector('.qf-ent-cat-chip__n')?.textContent}:${c.disabled ? 'off' : 'on'}`));
  t.log('chips while searching "warp"', chips);
  t.assert(chips.includes('Markers:1:on') && chips.includes('Enemies:0:off'), 'chips count the search matches and disable empty groups');
  await page.locator('.qf-map-right .qf-ent-search').fill('');
  await t.shot('boss-door-inspector');

  // ---------------------------------------------------------------- boss door: no link advice, shutter fields shown
  const bossWarn = await t.eval(inspectorWarnings);
  t.log('boss shutter warnings', bossWarn);
  t.assert(bossWarn.length === 0, 'the close-on-enter boss shutter gets no link warning');
  const fieldLabels = () => [...document.querySelectorAll('.qf-map-right .qf-ent-insp .qf-field__label')].map((l) => l.textContent);
  t.assert((await t.eval(fieldLabels)).includes('Shutter closes on enter'), 'a shutter shows its shutter fields');
  const bigKey = await t.eval(locate, 'kp_r11_door_s');
  await t.eval((b) => {
    const ctx = window.__qf.editor.ctx;
    ctx.selectRoom(b.world, b.room);
    ctx.selectEntity('kp_r11_door_s');
  }, bigKey);
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-id')?.textContent === 'kp_r11_door_s');
  const keyWarn = await t.eval(inspectorWarnings);
  t.log('big-key door warnings', keyWarn);
  t.assert(keyWarn.length === 0, 'the big-key door facing the boss shutter gets no link warning');
  const keyLabels = await t.eval(fieldLabels);
  t.assert(!keyLabels.includes('Shutter opens when') && !keyLabels.includes('Shutter closes on enter'), 'a big-key door hides the shutter-only fields');
  await page.locator('.qf-map-right .qf-field', { hasText: 'Kind' }).locator('select').selectOption('shutter');
  await t.wait(80);
  t.assert((await t.eval(fieldLabels)).includes('Shutter opens when'), 'switching the kind to shutter shows its fields');
  await t.shot('door-now-shutter');
  await page.keyboard.press('Control+z');
  await t.wait(80);

  // ---------------------------------------------------------------- undo of an inspector Delete selects the entity again
  const pot = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const e = ctx.room().entities.find((x) => x.type === 'obj.pot');
    if (e) ctx.selectEntity(e.id);
    return e?.id ?? null;
  });
  t.assert(!!pot, 'the peg room has a pot');
  await t.until((id) => document.querySelector('.qf-map-right .qf-ent-id')?.textContent === id, pot);
  await page.locator('.qf-map-right .qf-ent-insp').getByRole('button', { name: 'Delete' }).click();
  await t.wait(80);
  const gone = await t.eval((id) => ({ sel: window.__qf.editor.ctx.entityId, has: window.__qf.editor.ctx.room().entities.some((e) => e.id === id) }), pot);
  t.assert(gone.sel === null && !gone.has, 'Delete removes the pot and clears the selection');
  await page.keyboard.press('Control+z');
  await t.wait(120);
  const back = await t.eval(() => ({ sel: window.__qf.editor.ctx.entityId, head: document.querySelector('.qf-map-right .qf-ent-id')?.textContent }));
  t.log('after undoing the delete', back);
  t.assert(back.sel === pot && back.head === pot, 'undoing the Delete selects the restored pot in the inspector');
  await page.keyboard.press('Control+y');
  await t.wait(120);
  t.assert(await t.eval(() => window.__qf.editor.ctx.entityId) === null, 'redoing the Delete leaves nothing selected');

  // ---------------------------------------------------------------- new "Show dialogue" action starts unset
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).click();
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-trig'));
  await page.locator('.qf-map-right .qf-ent-trig').getByRole('button', { name: '+ Add' }).click();
  await page.locator('.qf-map-right .qf-ent-trig-add').nth(1).selectOption('dialogue');
  await t.wait(80);
  const act = await t.eval(() => {
    const r = window.__qf.editor.ctx.room();
    return r.triggers.at(-1).actions[0];
  });
  const hints = await t.eval(() => [...document.querySelectorAll('.qf-map-right .qf-ent-trig-editor .qf-ent-warn li')].map((li) => li.textContent));
  t.log('new dialogue action', act, hints);
  t.assert(act.kind === 'dialogue' && act.dialogue === '', 'a new "Show dialogue" action has no dialogue yet');
  t.assert(hints.some((h) => h.includes('pick a dialogue')), 'the trigger asks for a dialogue');
  await t.shot('new-dialogue-action');

  // ---------------------------------------------------------------- dialogue list: arrow keys
  await page.locator('.qf-shell__tab', { hasText: 'Dialogue' }).click();
  await t.until(() => document.querySelector('.qf-dlg-item'));
  const shown = await t.eval(() => [...document.querySelectorAll('.qf-dlg-item')].map((n) => n.dataset.dialogue));
  await page.locator(`.qf-dlg-item[data-dialogue="${shown[0]}"]`).click();
  await page.locator(`.qf-dlg-item[data-dialogue="${shown[0]}"]`).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await t.wait(80);
  const nav = await t.eval(() => ({
    active: document.querySelector('.qf-dlg-item.qf-list__item--active')?.dataset.dialogue,
    focused: document.activeElement?.dataset?.dialogue,
    tab: window.__qf.editor.ctx.activeTab,
  }));
  t.log('after ↓ ↓ ↑', nav);
  t.assert(nav.active === shown[1] && nav.focused === shown[1], 'arrow keys move the selection and focus through the displayed list');
  t.assert(nav.tab === 'dialogue', 'arrow keys stay in the Dialogue tab');

  // ---------------------------------------------------------------- flag names are trimmed
  await page.locator('.qf-dlg-flags__add input').fill('  lit_beacon  ');
  await page.locator('.qf-dlg-flags__add').getByRole('button', { name: 'Add' }).click();
  await t.wait(80);
  const flags = await t.eval(() => window.__qf.editor.ctx.project.flags.map((f) => f.name));
  t.assert(flags.includes('lit_beacon'), `a flag typed with spaces is added trimmed (${flags.join(', ')})`);
  await t.shot('dialogue-tab');
  t.assert(!(await t.eval(() => window.__qf.error)), 'no editor error');
}
