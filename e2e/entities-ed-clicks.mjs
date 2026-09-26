// Entities-ed, real editor + real mouse: the first click after typing in a
// field lands (text commits on blur inside that click's mousedown), list
// scroll positions survive edits and the selection is scrolled into view,
// unique trigger names, the drag grip, blank-answer hints, Play enablement and
// the Copy fallback. Targets are scrolled on screen before clicking, as a user
// would; scrolling does not blur the field being typed in.

export default async function (t) {
  const page = t.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await t.goto('#/edit/sample');
  await t.wait(600);
  const ctxEval = (fn, arg) => t.eval(fn, arg);

  /** Scroll `loc` on screen without moving focus, then click its centre with the mouse. */
  const clickOnScreen = async (loc) => {
    await loc.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    const box = await loc.boundingBox();
    t.assert(box && box.y >= 0 && box.y + box.height <= 900, `target is inside the viewport (${JSON.stringify(box)})`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await t.wait(120);
  };
  const activeFk = () => ctxEval(() => document.activeElement?.dataset?.fk ?? document.activeElement?.tagName);

  // ---------------------------------------------------------------- dialogue: type, then click another dialogue / Play
  await page.locator('.qf-shell__tab', { hasText: 'Dialogue' }).click();
  await t.until(() => document.querySelector('.qf-dlg-item'));
  const ids = await ctxEval(() => [...document.querySelectorAll('.qf-dlg-item')].map((n) => n.dataset.dialogue));
  await page.locator(`.qf-dlg-item[data-dialogue="${ids[0]}"]`).click();
  const text = page.locator('.qf-dlg-page__text').first();
  await text.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed');
  await clickOnScreen(page.locator(`.qf-dlg-item[data-dialogue="${ids[1]}"]`));
  const dlg = await ctxEval((id) => ({
    active: document.querySelector('.qf-dlg-item.qf-list__item--active')?.dataset.dialogue,
    committed: window.__qf.editor.ctx.project.dialogues.find((d) => d.id === id).pages[0].text,
  }), ids[0]);
  t.log('dialogue: typed, then clicked another dialogue ->', dlg.active, 'committed …', dlg.committed.slice(-6));
  t.assert(dlg.committed.endsWith(' typed'), 'page text committed on blur');
  t.assert(dlg.active === ids[1], `one click selects the other dialogue (${dlg.active})`);
  await t.shot('dialogue-typed-then-select');

  await text.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await clickOnScreen(page.locator('.qf-dlg-preview__bar .qf-btn', { hasText: 'Play' }));
  const playing = await ctxEval(() => document.querySelector('.qf-dlg-preview__bar .qf-btn')?.textContent);
  t.log('typed, then clicked ▶ Play ->', playing);
  t.assert(playing === '■ Stop', 'one click starts playback after typing (the commit does not cancel it)');
  await page.locator('.qf-dlg-preview__bar .qf-btn', { hasText: 'Stop' }).click();

  // ---------------------------------------------------------------- dialogue: "+ New" from a scrolled list, Play and Copy
  await page.locator('.qf-dlg-list').evaluate((n) => { n.scrollTop = n.scrollHeight; });
  await page.locator('.qf-dlg-listbar').getByRole('button', { name: '+ New' }).click();
  await t.wait(120);
  const fresh = await ctxEval(() => {
    const list = document.querySelector('.qf-dlg-list');
    const act = list.querySelector('.qf-list__item--active');
    const lr = list.getBoundingClientRect();
    const ar = act.getBoundingClientRect();
    return {
      name: act.querySelector('.qf-dlg-item__name').textContent,
      visible: ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1,
      focus: document.activeElement?.classList.contains('qf-dlg-page__text'),
      playDisabled: document.querySelector('.qf-dlg-preview__bar .qf-btn').disabled,
    };
  });
  t.log('+ New:', fresh);
  t.assert(fresh.visible, `the new dialogue (${fresh.name}) is scrolled into view`);
  t.assert(fresh.focus, 'caret is in its first page');
  t.assert(fresh.playDisabled, '▶ Play is disabled for an empty dialogue');
  await page.keyboard.type('Hello');
  t.assert(!(await ctxEval(() => document.querySelector('.qf-dlg-preview__bar .qf-btn').disabled)), '▶ Play enables while typing (before any commit)');
  await t.shot('dialogue-new-visible');

  await ctxEval(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.locator('.qf-dlg-head').getByRole('button', { name: 'Copy' }).click();
  await t.wait(80);
  const toasts = await ctxEval(() => [...document.querySelectorAll('.qf-toast')].map((n) => n.textContent));
  t.assert(toasts.includes('Could not access the clipboard.'), `Copy without a clipboard API says so (${toasts.join(' | ')})`);

  // ---------------------------------------------------------------- dialogue: blank choice answer hint
  const card = page.locator('.qf-dlg-page').first();
  await card.locator('.qf-check', { hasText: 'Ask a question' }).locator('input').check();
  await t.wait(100);
  const answer = page.locator('.qf-dlg-page').first().locator('.qf-dlg-choice__row input').first();
  await answer.fill('');
  const blankHint = () => ctxEval(() => [...document.querySelectorAll('.qf-dlg-choice .qf-ent-warn li')].map((n) => n.textContent));
  const hint1 = await blankHint();
  t.log('blank answer hint while typing:', hint1);
  t.assert(hint1.length === 1 && hint1[0].startsWith('Answer 1 is blank'), 'a blank answer is flagged as you type');
  await answer.press('Tab');
  await t.wait(80);
  t.assert((await blankHint()).length === 1, 'the hint stays after the commit rebuild');
  await t.shot('dialogue-blank-answer');
  await page.locator('.qf-dlg-page').first().locator('.qf-dlg-choice__row input').first().fill('Sure');
  t.assert((await blankHint()).length === 0, 'the hint goes away once the answer has text');

  // ---------------------------------------------------------------- inspector "New" dialogue: jump reveals + focuses it
  const npc = await ctxEval(() => {
    const ctx = window.__qf.editor.ctx;
    for (const w of ctx.project.worlds) {
      for (const r of w.rooms) {
        const n = r.entities.find((e) => e.type === 'npc.person');
        if (n) {
          ctx.selectRoom(w.id, r.id);
          ctx.selectEntity(n.id);
          return { id: n.id, room: r.id };
        }
      }
    }
    return null;
  });
  await page.locator('.qf-shell__tab', { hasText: 'Map' }).click();
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' }).click();
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-head__name')?.textContent === 'Person');
  await page.locator('.qf-map-right [data-fk="prop:dialogue:new"]').click();
  await t.until(() => document.querySelector('.qf-dlg-item.qf-list__item--active'));
  await t.wait(120);
  const jumped = await ctxEval((id) => {
    const ctx = window.__qf.editor.ctx;
    const inst = ctx.room().entities.find((e) => e.id === id);
    const list = document.querySelector('.qf-dlg-list');
    const act = list.querySelector('.qf-list__item--active');
    const lr = list.getBoundingClientRect();
    const ar = act.getBoundingClientRect();
    return {
      linked: act.dataset.dialogue === inst.props.dialogue,
      visible: ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1,
      focus: document.activeElement?.classList.contains('qf-dlg-page__text'),
    };
  }, npc.id);
  t.log('inspector New -> Dialogue tab:', jumped);
  t.assert(jumped.linked && jumped.visible && jumped.focus, 'the created dialogue is selected, in view, with the caret in its text');

  // ---------------------------------------------------------------- inspector: type sign text, then click Duplicate
  await page.locator('.qf-shell__tab', { hasText: 'Map' }).click();
  const before = await ctxEval(async () => {
    const ctx = window.__qf.editor.ctx;
    const { defaultProps } = await import('/src/core/catalog.ts');
    const room = ctx.room();
    const inst = { id: 'e_clicks_sign', type: 'obj.sign', x: 40, y: 40, props: { ...defaultProps('obj.sign'), text: '', dialogue: '' } };
    room.entities.push(inst);
    ctx.changed('entities', room.id);
    ctx.selectEntity(inst.id);
    return room.entities.length;
  });
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' }).click();
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-head__name')?.textContent === 'Sign');
  const signText = page.locator('.qf-map-right .qf-field', { hasText: 'Text' }).locator('textarea').first();
  await signText.click();
  await page.keyboard.type('Keep out!');
  const warnBefore = await ctxEval(() => document.querySelectorAll('.qf-map-right .qf-ent-warn li').length);
  await clickOnScreen(page.locator('.qf-map-right [data-fk="insp:dup"]'));
  const dup = await ctxEval((id) => {
    const ctx = window.__qf.editor.ctx;
    return {
      n: ctx.room().entities.length,
      text: ctx.room().entities.find((e) => e.id === id)?.props.text,
      warns: document.querySelectorAll('.qf-map-right .qf-ent-warn li').length,
    };
  }, 'e_clicks_sign');
  t.log('inspector: typed sign text, then clicked Duplicate ->', { before, ...dup, warnBefore });
  t.assert(dup.text === 'Keep out!', 'sign text committed');
  t.assert(dup.n === before + 1, `one click on Duplicate duplicates (${before} -> ${dup.n})`);
  t.assert(dup.warns < warnBefore, 'the "blank sign" warning went away after the click');
  await t.shot('inspector-typed-then-duplicate');

  // ---------------------------------------------------------------- triggers: type a name, then click another trigger
  const room = await ctxEval(() => {
    const ctx = window.__qf.editor.ctx;
    let best = null;
    for (const w of ctx.project.worlds) for (const r of w.rooms) if (!best || r.triggers.length > best.r.triggers.length) best = { w, r };
    ctx.selectRoom(best.w.id, best.r.id);
    return { ids: best.r.triggers.map((x) => x.id) };
  });
  await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).click();
  await t.until(() => document.querySelector('.qf-map-right .qf-ent-trig-item'));
  const trig = page.locator('.qf-map-right .qf-ent-trig');
  await trig.locator(`.qf-ent-trig-item[data-trigger="${room.ids[0]}"]`).click();
  await trig.locator('[data-fk="trig:name"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await clickOnScreen(trig.locator(`.qf-ent-trig-item[data-trigger="${room.ids[1]}"]`));
  const sel = await ctxEval((first) => ({
    shown: document.querySelector('.qf-map-right .qf-ent-trig-editor__bar .qf-ent-id')?.textContent,
    active: document.querySelector('.qf-map-right .qf-ent-trig-item.qf-list__item--active')?.dataset.trigger,
    renamed: window.__qf.editor.ctx.room().triggers.find((x) => x.id === first).name,
  }), room.ids[0]);
  t.log('trigger: typed name, then clicked another trigger ->', sel);
  t.assert(sel.shown === room.ids[1] && sel.active === room.ids[1], 'one click selects the other trigger (editor and list agree)');
  t.assert(sel.renamed.endsWith('!'), 'the name was committed');

  // ---------------------------------------------------------------- triggers: type a flag, then click ✕ of the next condition
  await trig.getByRole('button', { name: '+ Add' }).click();
  await trig.locator('.qf-ent-trig-add').nth(0).selectOption('flag');
  await trig.locator('.qf-ent-trig-add').nth(0).selectOption('torchesLit');
  await t.wait(80);
  await trig.locator('.qf-ent-trig-card', { hasText: 'Flag value' }).locator('input[type=text]').click();
  await page.keyboard.type('clicks_flag');
  await clickOnScreen(trig.locator('[data-fk="cond:1:del"]'));
  const conds = await ctxEval(() => window.__qf.editor.ctx.room().triggers.at(-1).conditions.map((c) => `${c.kind}:${c.flag ?? ''}`));
  t.log('trigger: typed flag, then clicked ✕ ->', conds);
  t.assert(conds.length === 1 && conds[0] === 'flag:clicks_flag', `one click on ✕ removes the condition (${conds})`);
  await t.shot('trigger-typed-then-remove');

  // ---------------------------------------------------------------- triggers: drag grip click leaves text selection working
  const flagCard = trig.locator('.qf-ent-trig-card', { hasText: 'Flag value' }).first();
  await flagCard.locator('.qf-ent-trig-card__grip').click();
  t.assert(!(await flagCard.evaluate((li) => li.draggable)), 'a plain click on the grip leaves the card not draggable');
  const flagIn = flagCard.locator('input[type=text]').first();
  await flagIn.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const fb = await flagIn.boundingBox();
  await page.mouse.move(fb.x + 4, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width - 8, fb.y + fb.height / 2, { steps: 8 });
  await page.mouse.up();
  const selection = await flagIn.evaluate((i) => i.selectionEnd - i.selectionStart);
  t.assert(selection > 0, `mouse drag selects text in the card's input (${selection} chars)`);

  // ---------------------------------------------------------------- triggers: list scroll survives edits; selection revealed
  await ctxEval(() => {
    const ctx = window.__qf.editor.ctx;
    const r = ctx.room();
    for (let i = r.triggers.length; i < 14; i++) r.triggers.push({ id: `t_clk${i}`, name: `Pad ${i}`, on: 'auto', once: true, conditions: [], actions: [{ kind: 'secret' }] });
    ctx.changed('triggers', r.id);
  });
  await t.wait(80);
  const listInfo = () => ctxEval(() => {
    const u = document.querySelector('.qf-map-right .qf-ent-trig-ul');
    const act = u.querySelector('.qf-list__item--active');
    const ur = u.getBoundingClientRect();
    const ar = act?.getBoundingClientRect();
    return {
      top: Math.round(u.scrollTop),
      max: u.scrollHeight - u.clientHeight,
      activeVisible: !!ar && ar.top >= ur.top - 1 && ar.bottom <= ur.bottom + 1,
      focus: document.activeElement?.dataset?.fk,
    };
  });
  const ulLoc = trig.locator('.qf-ent-trig-ul');
  await ulLoc.evaluate((n) => { n.scrollTop = n.scrollHeight; });
  const lastId = await ctxEval(() => window.__qf.editor.ctx.room().triggers.at(-1).id);
  await trig.locator(`.qf-ent-trig-item[data-trigger="${lastId}"]`).click();
  const s1 = await listInfo();
  await trig.locator('[data-fk="trig:name"]').fill('Pad renamed');
  await trig.locator('[data-fk="trig:name"]').press('Enter');
  await t.wait(80);
  const s2 = await listInfo();
  t.log('trigger list scroll: selected last', s1, 'after renaming it', s2);
  t.assert(s1.max > 0 && s1.top > 0, 'the list scrolls (setup)');
  t.assert(s2.top === s1.top && s2.activeVisible, 'renaming keeps the list scroll position and the selection in view');
  t.assert(s2.focus === 'trig:name', 'focus stays in the name field');
  await ulLoc.evaluate((n) => { n.scrollTop = 0; });
  await trig.getByRole('button', { name: '+ Add' }).click();
  await t.wait(80);
  const s3 = await listInfo();
  t.log('after + Add', s3);
  t.assert(s3.activeVisible && s3.focus === 'trig:name', 'a new trigger is scrolled into view with the caret in its name');
  await t.shot('trigger-list-after-add');

  // ---------------------------------------------------------------- triggers: names stay unique after delete + add + duplicate
  await trig.locator(`.qf-ent-trig-item[data-trigger="${room.ids[0]}"]`).scrollIntoViewIfNeeded();
  await trig.locator(`.qf-ent-trig-item[data-trigger="${room.ids[0]}"]`).click();
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: 'Delete' }).click();
  await trig.getByRole('button', { name: '+ Add' }).click();
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: 'Duplicate' }).click();
  await trig.locator('.qf-ent-trig-editor__bar').getByRole('button', { name: 'Duplicate' }).click();
  const names = await ctxEval(() => window.__qf.editor.ctx.room().triggers.map((x) => x.name));
  t.log('trigger names', names.slice(-5));
  t.assert(new Set(names).size === names.length, 'every trigger name in the room is unique');
  t.assert(!names.some((n) => n.includes('copy copy')), 'copies of copies do not stack "copy"');

  t.log('focus at end', await activeFk());
  t.assert(!(await ctxEval(() => window.__qf.error)), 'no editor error');
}
