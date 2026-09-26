// Art tab inside the real editor shell (#/edit/sample): draw on a tile, undo /
// redo through the shell shortcuts, recolour a palette and watch thumbnails
// update, add an animation frame, edit a sprite anim, and check that palette
// hotkeys do not trigger the shell's tab shortcuts. Also covers typing in a
// field and then clicking another control (the click must land), hotkeys with a
// dropdown focused, the map brush after deleting its tile, keyboard hand-back
// to the canvas, and the layout at the harness default 1024x896.

const project = (t, fn, arg) => t.eval(([src, a]) => {
  const p = window.__qf.editor.ctx.project;
  return new Function('p', 'a', `return (${src})(p, a);`)(p, a);
}, [fn.toString(), arg]);

const activeTool = (t) => t.eval(() => document.querySelector('.qf-art-toolbar .qf-btn--active[data-tool]')?.dataset.tool);
const brushExists = (t) => t.eval(() => {
  const ctx = window.__qf.editor.ctx;
  return ctx.project.tiles.some((x) => x.id === ctx.tile);
});

/** Type at the end of a props text field (real keyboard), leaving it focused and uncommitted. */
async function typeInto(t, selector, text) {
  await t.page.click(selector);
  await t.page.keyboard.press('End');
  await t.page.keyboard.type(text);
}

/** Commit a field by clicking another control: the click must still act on that control. */
async function commitThenClick(t, flowers, bush) {
  const tileOf = (id) => project(t, (p, i) => p.tiles.find((x) => x.id === i), id);
  const cut0 = !!(await tileOf(flowers)).cut;
  await typeInto(t, '.qf-art-props input[data-fk="name"]', ' X');
  await t.page.click('input[data-fk="beh-cut"]');
  let d = await tileOf(flowers);
  t.assert(d.name.endsWith(' X') && !!d.cut !== cut0, `typing a name then ticking a behaviour: both land (${d.name}, cut ${!!d.cut})`);
  await t.page.keyboard.press('KeyE');
  t.assert(await activeTool(t) === 'eraser', 'tool hotkeys work right after ticking a checkbox');
  await t.page.keyboard.press('KeyB');

  await typeInto(t, '.qf-art-props input[data-fk="name"]', 'Y');
  await t.page.click('.qf-art-props .qf-art-chips__input');
  await t.page.keyboard.type('zz');
  t.assert(await t.eval(() => document.activeElement?.classList.contains('qf-art-chips__input')), 'the tag field keeps focus after the name commits');
  t.assert(await activeTool(t) === 'pencil', 'typing in the tag field fires no tool hotkeys');
  await t.page.keyboard.press('Escape');

  await typeInto(t, '.qf-art-props input[data-fk="name"]', 'Z');
  await t.page.click('.qf-art-props .qf-btn:has-text("Use as map brush")');
  t.assert(await t.eval(() => window.__qf.editor.ctx.tile) === flowers, '"Use as map brush" works right after typing a name');

  await typeInto(t, '.qf-art-props input[data-fk="name"]', '!');
  await t.page.click(`.qf-art-list .qf-art-cell[data-id="${bush}"]`);
  t.assert(Number(await t.eval(() => document.querySelector('.qf-art-list .is-active')?.dataset.id)) === bush, 'clicking a tile right after renaming selects it');
  d = await tileOf(flowers);
  t.assert(d.name.endsWith(' XYZ!'), `every rename landed on the tile it was typed for (${d.name})`);

  // Enter commits and gives the keyboard back to the canvas; clearing a name restores it.
  await t.page.fill('.qf-art-props input[data-fk="name"]', '');
  await t.page.keyboard.press('Enter');
  const shown = await t.eval(() => document.querySelector('.qf-art-props input[data-fk="name"]').value);
  t.assert(shown === (await tileOf(bush)).name && shown.length > 0, `an emptied name field shows the name again (${shown})`);
  t.assert(await t.eval(() => document.activeElement?.classList.contains('qf-art-canvas')), 'Enter in a field hands the keyboard to the canvas');
  await t.page.keyboard.press('KeyL');
  t.assert(await activeTool(t) === 'line', 'tool hotkeys work right after Enter in a field');
  await t.page.keyboard.press('KeyB');
}

/**
 * A dropdown keeps focus after a pick (Chrome), so letters and digits must reach
 * the pixel editor instead of its type-ahead; a pointer pick hands the keyboard
 * straight back to the canvas.
 */
async function dropdownKeys(t, flowers) {
  const tileOf = () => project(t, (p, i) => p.tiles.find((x) => x.id === i), flowers);
  const d0 = await tileOf();
  await t.page.focus('.qf-art-props select[data-fk="collision"]');
  await t.page.keyboard.press('KeyL');
  await t.page.keyboard.press('KeyS');
  let d = await tileOf();
  t.assert(d.collision === d0.collision && await activeTool(t) === 'line', `L / S in the focused collision dropdown: tool line, collision still ${d.collision}`);
  await t.page.focus('.qf-art-props select[data-fk="palette"]');
  await t.page.keyboard.press('Digit3');
  await t.page.keyboard.press('KeyB');
  d = await tileOf();
  const primary = await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index);
  t.assert(d.palette === d0.palette && primary === '3' && await activeTool(t) === 'pencil', `3 / B in the focused palette dropdown: colour 3, pencil, palette still ${d.palette}`);
  await t.page.keyboard.press('ArrowDown');
  t.assert((await tileOf()).palette !== d0.palette, 'arrow keys still change a focused dropdown');
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  t.assert((await tileOf()).palette === d0.palette, 'Ctrl+Z undoes the dropdown change');

  await t.page.click('.qf-art-props select[data-fk="collision"]');
  await t.page.selectOption('.qf-art-props select[data-fk="collision"]', 'solid');
  await t.wait(50);
  t.assert((await tileOf()).collision === 'solid' && await t.eval(() => document.activeElement?.classList.contains('qf-art-canvas')),
    'picking from a dropdown with the pointer hands the keyboard to the canvas');
  await t.page.keyboard.press('KeyE');
  t.assert(await activeTool(t) === 'eraser' && (await tileOf()).collision === 'solid', 'the next hotkey picks a tool, not an option');
  await t.page.keyboard.press('KeyB');
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  t.assert((await tileOf()).collision === d0.collision, 'collision restored');
}

/** Arrow keys on a props palette slider keep stepping it (focus survives each rebuild); Ctrl+Z steps back through them. */
async function sliderKeys(t, flowers) {
  const frame = () => project(t, (p, i) => p.tiles.find((x) => x.id === i).frames[0], flowers);
  const read = () => t.eval(() => ({
    v: Number(document.querySelector('.qf-art-props input[data-fk="pe-G"]').value),
    focus: document.activeElement?.dataset?.fk ?? document.activeElement?.tagName,
  }));
  const f0 = await frame();
  await t.page.focus('.qf-art-props input[data-fk="pe-G"]');
  const a = await read();
  const [key, sign] = a.v <= 28 ? ['ArrowRight', 1] : ['ArrowLeft', -1];
  for (let i = 0; i < 3; i++) {
    await t.page.keyboard.press(key);
    await t.wait(40);
  }
  const b = await read();
  t.assert(b.v === a.v + 3 * sign && b.focus === 'pe-G', `3 spaced ${key} presses step the slider 3 levels and keep focus (${a.v} -> ${b.v}, focus ${b.focus})`);
  t.assert(await frame() === f0 && await t.eval(() => window.__qf.editor.ctx.activeTab) === 'art', 'slider keys leave the pixels and the tab alone');
  for (let i = 0; i < 3; i++) await t.page.keyboard.press('Control+KeyZ');
  await t.wait(80);
  t.assert((await read()).v === a.v, `three Ctrl+Z step the colour back (${(await read()).v})`);
  await t.eval(() => document.activeElement?.blur());
}

/** The map brush never points at a deleted tile (delete, and undoing the New that made it). */
async function brushAfterDelete(t) {
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  const id = await t.eval(() => Math.max(...window.__qf.editor.ctx.project.tiles.map((x) => x.id)));
  await t.page.click('.qf-art-props .qf-btn:has-text("Use as map brush")');
  t.assert(await t.eval(() => window.__qf.editor.ctx.tile) === id, 'the new tile is the map brush');
  await t.page.click('.qf-art-browser__foot .qf-btn:has-text("Delete")');
  await t.page.click('.qf-modal .qf-btn--danger');
  t.assert(await brushExists(t), 'deleting the brush tile moves the brush to an existing tile');
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  await t.page.click(`.qf-art-list .qf-art-cell[data-id="${id}"]`);
  await t.page.click('.qf-art-props .qf-btn:has-text("Use as map brush")');
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  t.assert(await t.eval((i) => !window.__qf.editor.ctx.project.tiles.some((x) => x.id === i), id), 'Ctrl+Z undid the New');
  t.assert(await brushExists(t), 'undoing the New of the brush tile moves the brush to an existing tile');
}

/** Clicking an anim row shows one of its frames on the canvas. */
async function animRowJumps(t) {
  const target = await project(t, (p) => {
    const s = p.sprites.find((x) => x.id === 'enemy.soldier');
    return Object.entries(s.anims).find(([, a]) => !a.frames.includes(0))?.[0];
  });
  await t.page.click('.qf-art-frame[data-frame="0"]');
  await t.page.click(`tr[data-anim="${target}"] td:first-child`);
  const want = await project(t, (p, n) => p.sprites.find((x) => x.id === 'enemy.soldier').anims[n].frames[0], target);
  const got = Number(await t.eval(() => document.querySelector('.qf-art-frame.is-active')?.dataset.frame));
  t.assert(got === want, `clicking the ${target} row shows its first frame (${got} vs ${want})`);
}

/** Right edge of a descendant never passes its container's (no clipped controls). */
const fits = (t, inner, outer) => t.eval(([a, b]) => {
  const i = document.querySelector(a)?.getBoundingClientRect();
  const o = document.querySelector(b)?.getBoundingClientRect();
  return !!i && !!o && i.right <= o.right + 0.5;
}, [inner, outer]);

async function layout1024(t) {
  await t.page.setViewportSize({ width: 1024, height: 896 });
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Sprites")');
  await t.page.fill('.qf-art-browser__filters input', '');
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  await t.wait(150);
  const bar = await t.eval(() => document.querySelector('.qf-toolbar.qf-art-toolbar').getBoundingClientRect().height);
  t.assert(bar <= 40, `the toolbar stays on one row at 1024 px (${bar} px)`);
  t.assert(await fits(t, '.qf-art-props input[data-fk="h"]', '.qf-art-props .qf-art-sec:nth-child(2)'), 'the frame size row fits the properties column');
  await t.shot('custom-sprite-1024');
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Terrains")');
  await t.wait(150);
  t.assert(await fits(t, '.qf-art-tslot[data-piece="ise"]', '.qf-art-tv'), 'all 13 terrain slots fit the centre at 1024 px');
  t.assert(await fits(t, '.qf-art-tslots', '.qf-art-tv__body > .qf-art-sec'), 'the slot grid stays inside its section');
  await t.shot('terrains-1024');
  // Tile picker: an empty search says so; hiding the tab closes the popover.
  await t.page.click('.qf-art-tslot[data-piece="n"] .qf-art-tpick');
  await t.page.fill('.qf-art-pop input', 'no such tile');
  t.assert(await t.eval(() => !!document.querySelector('.qf-art-pop .qf-art-pop__empty')), 'an empty tile search shows a message');
  await t.shot('picker-empty');
  await t.eval(() => window.__qf.editor.ctx.switchTab('map'));
  await t.wait(100);
  t.assert(await t.eval(() => !document.querySelector('.qf-art-pop')), 'switching tabs closes the tile picker');
  await t.eval(() => window.__qf.editor.ctx.switchTab('art'));
  await t.wait(100);
}

async function pixelPoint(t, x, y) {
  return t.eval(([px, py]) => {
    const c = document.querySelector('.qf-art-canvas');
    const r = c.getBoundingClientRect();
    const w = Number(/(\d+)×/.exec(document.querySelector('.qf-art-status').textContent)?.[1] ?? 16);
    const z = r.width / w;
    return [r.left + (px + 0.5) * z, r.top + (py + 0.5) * z];
  }, [x, y]);
}

/** Keys pressed while the pen is down wait for it: Ctrl+Z and digits neither undo nor switch tabs; Escape abandons the stroke. */
async function midStrokeKeys(t, flowers, drawn) {
  const frame0 = () => project(t, (p, id) => p.tiles.find((x) => x.id === id).frames[0], flowers);
  const stroke = async (row, keys) => {
    const [ax, ay] = await pixelPoint(t, 2, row);
    const [bx, by] = await pixelPoint(t, 13, row);
    await t.page.mouse.move(ax, ay);
    await t.page.mouse.down();
    await t.page.mouse.move(bx, by, { steps: 6 });
    for (const k of keys) await t.page.keyboard.press(k);
    await t.page.mouse.up();
  };
  await stroke(6, ['Control+KeyZ', 'Digit2']);
  const painted = await frame0();
  t.assert(painted.slice(6 * 16 + 2, 6 * 16 + 14) === '1'.repeat(12) && painted.slice(2 * 16 + 2, 2 * 16 + 14) === '1'.repeat(12),
    'Ctrl+Z during a stroke is held back: the earlier stroke stays and the new one lands');
  t.assert(await t.eval(() => window.__qf.editor.ctx.activeTab) === 'art', 'a digit during a stroke does not switch tabs');
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  t.assert(await frame0() === drawn, 'the next Ctrl+Z undoes exactly that stroke');
  const depth = await t.eval(() => window.__qf.editor.ctx.undo.peekUndo());
  await stroke(9, ['Escape']);
  t.assert(await frame0() === drawn, 'Escape during a stroke abandons it');
  t.assert(await t.eval(() => window.__qf.editor.ctx.undo.peekUndo()) === depth, 'an abandoned stroke records no undo step');
}

export default async function (t) {
  await t.page.setViewportSize({ width: 1440, height: 900 });
  await t.goto('#/edit/sample');
  await t.until(() => !!window.__qf.editor);
  await t.page.click('#qf-tab-art');
  await t.until(() => !!document.querySelector('.qf-art-canvas'));
  await t.wait(200);
  await t.shot('art-tab');

  // Draw on the flowers tile.
  const flowers = await t.eval(async () => (await import('/src/content/ids.ts')).T.FLOWERS);
  await t.page.click(`.qf-art-list .qf-art-cell[data-id="${flowers}"]`);
  const before = await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames[0], flowers);
  await t.page.keyboard.press('Digit1');
  const [ax, ay] = await pixelPoint(t, 2, 2);
  const [bx, by] = await pixelPoint(t, 13, 2);
  await t.page.mouse.move(ax, ay);
  await t.page.mouse.down();
  await t.page.mouse.move(bx, by, { steps: 8 });
  await t.page.mouse.up();
  const drawn = await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames[0], flowers);
  t.assert(drawn !== before && drawn.slice(2 * 16 + 2, 2 * 16 + 14) === '1'.repeat(12), 'stroke painted on the tile');
  t.assert(await t.eval(() => window.__qf.editor.ctx.activeTab) === 'art', 'digit 1 picked a colour instead of switching tabs');
  t.assert(await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index) === '1', 'digit 1 = primary colour 1');

  // Undo / redo with the shell shortcuts.
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(50);
  t.assert(await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames[0], flowers) === before, 'Ctrl+Z undoes the stroke');
  await t.page.keyboard.press('Control+KeyY');
  await t.wait(50);
  t.assert(await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames[0], flowers) === drawn, 'Ctrl+Y redoes it');
  await midStrokeKeys(t, flowers, drawn);
  await t.shot('drawn');

  // Recolour index 4 of the tile's palette: the browser thumbnails follow.
  const thumb = () => t.eval((id) => document.querySelector(`.qf-art-list .qf-art-cell[data-id="${id}"] canvas`).toDataURL(), flowers);
  const t0 = await thumb();
  await t.page.click('.qf-art-props .qf-art-pe__sw[data-index="4"]');
  await t.eval(() => {
    const r = document.querySelectorAll('.qf-art-props .qf-art-pe__range')[2];
    r.value = '31';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await t.wait(80);
  t.assert(await thumb() !== t0, 'palette edit updates the tile thumbnail');
  t.assert(await t.eval(() => window.__qf.editor.ctx.undo.peekUndo()?.startsWith('Edit colour 4')), 'colour edit is on the shell undo stack');
  await t.shot('recoloured');
  await sliderKeys(t, flowers);

  // Add an animation frame to the tile.
  const n0 = await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames.length, flowers);
  await t.page.click('.qf-art-frames .qf-btn:has-text("Duplicate")');
  const n1 = await project(t, (p, id) => p.tiles.find((x) => x.id === id).frames.length, flowers);
  t.assert(n1 === n0 + 1, `frame added (${n0} -> ${n1})`);
  await dropdownKeys(t, flowers);

  const bush = await t.eval(async () => (await import('/src/content/ids.ts')).T.BUSH);
  await commitThenClick(t, flowers, bush);
  await brushAfterDelete(t);

  // Edit a sprite anim.
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Sprites")');
  await t.page.fill('.qf-art-browser__filters input', 'soldier');
  await t.page.click('.qf-art-row[data-id="enemy.soldier"]');
  await t.page.fill('tr[data-anim="walk_down"] input[data-fk="anim-walk_down-fps"]', '10');
  await t.page.keyboard.press('Enter');
  const fps = await project(t, (p) => p.sprites.find((s) => s.id === 'enemy.soldier').anims.walk_down.fps);
  t.assert(fps === 10, `sprite anim fps edited (${fps})`);
  await t.page.click('tr[data-anim="walk_down"] td:first-child');
  await t.wait(300);
  await t.shot('sprite');
  await animRowJumps(t);

  // Leave and come back: the tab refreshes cleanly.
  await t.page.click('#qf-tab-map');
  await t.wait(100);
  await t.page.click('#qf-tab-art');
  await t.wait(100);
  t.assert(await t.eval(() => document.querySelector('.qf-art-row.is-active')?.dataset.id) === 'enemy.soldier', 'selection survives a tab switch');

  await layout1024(t);
  t.assert(await t.eval(() => window.__qf.error) === null, 'no crash reported');
}
