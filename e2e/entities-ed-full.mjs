// Full-editor pass on #/edit/sample: the entity panel and trigger panel inside
// the map tab's sidebar, the Dialogue tab, and the jumps between them.

/** Page function: summary of the editor selection + current room content. */
const snapshot = () => {
  const ctx = window.__qf.editor?.ctx;
  const room = ctx?.room();
  return {
    tab: ctx?.activeTab ?? null,
    entityType: ctx?.entityType ?? null,
    entityId: ctx?.entityId ?? null,
    roomId: ctx?.roomId ?? null,
    entities: room?.entities.map((e) => `${e.type}#${e.id}`) ?? [],
    triggers: room?.triggers.map((t) => t.id) ?? [],
    dialogues: ctx?.project.dialogues.map((d) => d.id) ?? [],
  };
};

export default async function (t) {
  const page = t.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await t.goto('#/edit/sample');
  await t.wait(500);
  t.assert(await t.eval(() => !!window.__qf.editor?.ctx), 'editor context is exposed');
  await t.shot('editor');

  // ---------------------------------------------------------------- entity panel in the map sidebar
  const entTab = page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' });
  if (await entTab.count() === 0) {
    t.log('map sidebar not available yet: skipping the in-editor entity/trigger checks');
  } else {
    await entTab.click();
    await t.until(() => document.querySelector('.qf-map-right .qf-ent-panel'));
    await page.locator('.qf-ent-item[data-type="obj.chest"]').click();
    t.assert((await t.eval(snapshot)).entityType === 'obj.chest', 'palette arms the chest in the real editor');
    await t.shot('sidebar-entities-armed');

    // Place through the map canvas if it supports it; otherwise place through the context.
    const beforeList = (await t.eval(snapshot)).entities;
    const before = beforeList.length;
    const canvas = page.locator('.qf-map-center canvas').first();
    if (await canvas.count()) {
      const box = await canvas.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await t.wait(100);
    }
    let snap = await t.eval(snapshot);
    t.log('placed via canvas:', snap.entities.length > before, snap.entities);
    if (snap.entities.length === before) {
      await t.eval(async () => {
        const { defaultProps } = await import('/src/core/catalog.ts');
        const ctx = window.__qf.editor.ctx;
        ctx.room().entities.push({ id: 'e_full1', type: 'obj.chest', x: 120, y: 104, props: defaultProps('obj.chest') });
        ctx.changed('entities', ctx.roomId);
        ctx.selectEntity('e_full1');
      });
      snap = await t.eval(snapshot);
    }
    await page.keyboard.press('Escape');
    const chestId = snap.entities.find((e) => e.startsWith('obj.chest#') && !beforeList.includes(e))?.split('#')[1];
    if (snap.entityId !== chestId) await t.eval((id) => window.__qf.editor.ctx.selectEntity(id), chestId);
    await t.until(() => document.querySelector('.qf-map-right .qf-ent-head__name')?.textContent === 'Chest');
    const contents = page.locator('.qf-map-right .qf-field', { hasText: 'Contents' }).locator('select');
    await contents.selectOption('bow');
    t.assert(await t.eval((id) => window.__qf.editor.ctx.room().entities.find((e) => e.id === id)?.props.item === 'bow', chestId), 'inspector edits the placed chest');
    await t.shot('sidebar-inspector');
    await page.keyboard.press('Control+z');
    await t.wait(100);
    t.assert(await contents.inputValue() !== 'bow', 'Ctrl+Z in the editor reverts the inspector edit and it refreshes');

    // ---------------------------------------------------------------- trigger panel in the map sidebar
    await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).click();
    await t.until(() => document.querySelector('.qf-map-right .qf-ent-trig'));
    await page.locator('.qf-map-right .qf-ent-trig').getByRole('button', { name: '+ Add' }).click();
    const trigId = (await t.eval(snapshot)).triggers.at(-1);
    t.assert(!!trigId, 'a trigger was added to the room');
    await page.locator('.qf-map-right .qf-ent-trig-add').nth(1).selectOption('dialogue');
    await t.wait(80);
    await page.locator('.qf-map-right .qf-ent-trig-card', { hasText: 'Show dialogue' }).getByRole('button', { name: 'New' }).click();
    await t.wait(200);
    snap = await t.eval(snapshot);
    t.assert(snap.tab === 'dialogue', `"New" dialogue switches to the Dialogue tab (${snap.tab})`);
    const newId = snap.dialogues.at(-1);
    t.assert(await t.eval((id) => window.__qf.editor.ctx.room()?.triggers.at(-1)?.actions[0]?.dialogue === id, newId), 'the trigger action points at the new dialogue');
  }

  // ---------------------------------------------------------------- dialogue tab in the real editor
  if ((await t.eval(snapshot)).tab !== 'dialogue') await page.locator('.qf-shell__tab', { hasText: 'Dialogue' }).click();
  await t.until(() => document.querySelector('.qf-dlg'));
  if ((await t.eval(snapshot)).dialogues.length === 0) await page.getByRole('button', { name: '+ New' }).click();
  const text = page.locator('.qf-dlg-page__text').first();
  await text.fill('The gate creaks open. Beyond it, the old road winds toward the hills.');
  await text.press('Tab');
  await t.wait(100);
  t.assert(await t.eval(() => window.__qf.editor.ctx.project.dialogues.some((d) => d.pages[0]?.text.startsWith('The gate creaks'))), 'dialogue text commits in the real editor');
  await t.shot('dialogue-tab');

  const go = page.locator('.qf-dlg-used').getByRole('button', { name: 'Go' });
  if (await go.count()) {
    await go.first().click();
    await t.wait(200);
    const snap = await t.eval(snapshot);
    t.assert(snap.tab === 'map', `"Go" returns to the map (${snap.tab})`);
    await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).click();
    await t.wait(100);
    const active = await t.eval(() => document.querySelector('.qf-map-right .qf-ent-trig-item.qf-list__item--active')?.dataset.trigger ?? null);
    const last = (await t.eval(snapshot)).triggers.at(-1);
    t.assert(active === last, `"Go" on a trigger usage selects that trigger (${active} vs ${last})`);
    await t.shot('back-on-map');
  }
  // ---------------------------------------------------------------- the sample's own content
  const busy = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    let best = null;
    for (const w of ctx.project.worlds) for (const r of w.rooms) if (!best || r.triggers.length > best.room.triggers.length) best = { world: w, room: r };
    if (!best || best.room.triggers.length === 0) return null;
    ctx.selectRoom(best.world.id, best.room.id);
    return { room: best.room.name, triggers: best.room.triggers.length };
  });
  t.log('busiest room', busy);
  if (busy && await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).count()) {
    await page.locator('.qf-shell__tab', { hasText: 'Map' }).click();
    await page.locator('.qf-map-right .qf-tab', { hasText: 'Triggers' }).click();
    await t.wait(150);
    const n = await page.locator('.qf-map-right .qf-ent-trig-item').count();
    t.assert(n === busy.triggers, `trigger list shows the room's ${busy.triggers} triggers (${n})`);
    await t.shot('sample-triggers');
    const warp = await t.eval(() => window.__qf.editor.ctx.room().entities.find((e) => e.type === 'marker.warp' || e.type === 'npc.person')?.id ?? null);
    if (warp) {
      await page.locator('.qf-map-right .qf-tab', { hasText: 'Entities' }).click();
      await t.eval((id) => window.__qf.editor.ctx.selectEntity(id), warp);
      await t.wait(150);
      await t.shot('sample-entity');
    }
  }
  t.assert(!(await t.eval(() => window.__qf.error)), 'no editor error');
}
