// Art tab in isolation: mounts mountArtTab with a minimal EditorContext built in
// the page (no editor shell), then exercises drawing tools, undo, zoom, frames,
// palette editing, tile/sprite properties, palettes, terrains and deletion.

/** Build a project + minimal EditorContext and mount the art tab full-screen. */
async function mount(t) {
  await t.goto('#/');
  await t.eval(async () => {
    const [{ mountArtTab }, { createBlankProject }, { AssetCache }, { UndoStack }, { Emitter }, { T }] = await Promise.all([
      import('/src/editor/art/artTab.ts'), import('/src/core/project.ts'), import('/src/gfx/imageCache.ts'),
      import('/src/editor/undo.ts'), import('/src/core/events.ts'), import('/src/content/ids.ts'),
    ]);
    const project = createBlankProject('Art test');
    const assets = new AssetCache(project);
    const bus = new Emitter();
    const undo = new UndoStack();
    const log = { project: [], assets: [], toasts: [] };
    const world = project.worlds[0];
    const ctx = {
      project, assets, undo, bus,
      worldId: world.id, roomId: world.rooms[0].id, layer: 'bg', tile: T.BUSH, terrainId: null, entityType: null, entityId: null,
      selectRoom() {}, selectLayer() {},
      selectTile(id) { this.tile = id; bus.emit('selection', { what: 'tile' }); },
      selectTerrain(id) { this.terrainId = id; bus.emit('selection', { what: 'tile' }); },
      selectEntityType() {}, selectEntity() {},
      world: () => world, room: () => world.rooms[0],
      changed(what, id) { log.project.push({ what, id }); bus.emit('project', { what, id }); },
      assetsChanged(kind, id) {
        if (id === undefined || kind === 'all') assets.invalidateAll();
        else if (kind === 'tile') assets.invalidateTile(Number(id));
        else if (kind === 'sprite') assets.invalidateSprite(String(id));
        else assets.invalidatePalette(String(id));
        log.assets.push({ kind, id });
        bus.emit('assets', { kind, id });
      },
      switchTab() {}, playtest() {}, pickLocation: async () => null, setLocationPicker() {},
      save: async () => {}, toast(msg) { log.toasts.push(msg); },
    };
    const app = document.getElementById('app');
    app.replaceChildren();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column';
    app.appendChild(host);
    // Count undo steps through the public API (push / undo / redo).
    let depth = 0;
    const push = undo.push.bind(undo);
    undo.push = (cmd) => {
      depth++;
      push(cmd);
    };
    const panel = mountArtTab(host, ctx);
    const history = (cmd, delta) => {
      if (!cmd) return null;
      depth += delta;
      assets.invalidateAll();
      bus.emit('undo', { label: cmd.label });
      return cmd.label;
    };
    window.__art = {
      ctx, panel, project, log, T,
      undo: () => history(undo.undo(), -1),
      redo: () => history(undo.redo(), 1),
      /** Number of undo steps on the stack. */
      depth: () => depth,
    };
  });
  await t.wait(200);
}

/** Frame string of a tile / sprite frame. */
const frameOf = (t, kind, id, frame = 0) => t.eval(([k, i, f]) => {
  const p = window.__art.project;
  const def = k === 'tile' ? p.tiles.find((x) => x.id === i) : p.sprites.find((x) => x.id === i);
  return def ? def.frames[f] : null;
}, [kind, id, frame]);

const at = (s, w, x, y) => s[y * w + x];
const undoCount = (t) => t.eval(() => window.__art.depth());

/** Page coordinates of the centre of art pixel (x, y) on the pixel canvas. */
async function px(t, x, y) {
  const b = await t.eval(() => {
    const r = document.querySelector('.qf-art-canvas').getBoundingClientRect();
    const st = document.querySelector('.qf-art-status').textContent;
    return { x: r.left, y: r.top, w: r.width, aw: Number(/(\d+)×(\d+)/.exec(st)?.[1] ?? 16) };
  });
  const z = b.w / b.aw;
  return [b.x + (x + 0.5) * z, b.y + (y + 0.5) * z];
}

async function click(t, x, y, button = 'left') {
  const [cx, cy] = await px(t, x, y);
  await t.page.mouse.click(cx, cy, { button });
}

async function drag(t, from, to, opts = {}) {
  const [ax, ay] = await px(t, from[0], from[1]);
  const [bx, by] = await px(t, to[0], to[1]);
  if (opts.shift) await t.page.keyboard.down('Shift');
  await t.page.mouse.move(ax, ay);
  await t.page.mouse.down();
  await t.page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 });
  await t.page.mouse.move(bx, by, { steps: 4 });
  await t.page.mouse.up();
  if (opts.shift) await t.page.keyboard.up('Shift');
}

const tileDef = (t, id) => t.eval((i) => window.__art.project.tiles.find((x) => x.id === i), id);
const spriteDef = (t, id) => t.eval((i) => window.__art.project.sprites.find((x) => x.id === i), id);
const paletteColour = (t, id, i) => t.eval(([p, n]) => window.__art.project.palettes.find((x) => x.id === p).colors[n], [id, i]);

async function drawing(t) {
  // New blank tile (palette of the selected BUSH tile).
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  const id = await t.eval(() => Math.max(...window.__art.project.tiles.map((x) => x.id)));
  t.assert(id === 1000, `new tile gets id 1000 (got ${id})`);
  const tile = await tileDef(t, id);
  t.assert(tile.palette === 'pal.t.meadow' && /^0{256}$/.test(tile.frames[0]), 'new tile: blank 16x16 frame with the selected tile palette');

  const u0 = await undoCount(t);
  await click(t, 2, 2);
  let f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 2, 2) === '1', 'pencil paints the primary index');
  t.assert(await undoCount(t) === u0 + 1, 'a click is one undo step');

  // Secondary colour: right-click swatch 5, then right-click paint.
  await t.page.click('.qf-art-strip .qf-art-sw[data-index="5"]', { button: 'right' });
  await click(t, 3, 2, 'right');
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 3, 2) === '5', 'right mouse paints the secondary index');

  // A drag stroke = one undo step.
  const u1 = await undoCount(t);
  await drag(t, [0, 5], [15, 5]);
  f = await frameOf(t, 'tile', id);
  t.assert(f.slice(5 * 16, 6 * 16) === '1'.repeat(16), 'pencil drag paints a full row');
  t.assert(await undoCount(t) === u1 + 1, 'a drag stroke is one undo step');

  // Hotkeys: 3 = primary index 3, L = line.
  await t.page.keyboard.press('Digit3');
  await t.page.keyboard.press('KeyL');
  t.assert(await t.eval(() => document.querySelector('[data-tool="line"]').classList.contains('qf-btn--active')), 'L selects the line tool');
  await drag(t, [0, 0], [15, 15]);
  f = await frameOf(t, 'tile', id);
  t.assert([0, 7, 15].every((i) => at(f, 16, i, i) === '3'), 'line tool draws the diagonal with index 3');

  // Filled rectangle (Shift).
  await t.page.keyboard.press('KeyR');
  await drag(t, [9, 8], [12, 11], { shift: true });
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 10, 9) === '3' && at(f, 16, 9, 8) === '3' && at(f, 16, 12, 11) === '3', 'shift-rectangle is filled');

  // Ellipse outline.
  await t.page.keyboard.press('Digit7');
  await t.page.keyboard.press('KeyO');
  await drag(t, [1, 7], [6, 12]);
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 3, 7) === '7' && at(f, 16, 3, 9) !== '7', 'ellipse outline (hollow)');

  // Flood fill the background region at the bottom-left corner.
  await t.page.keyboard.press('Digit9');
  await t.page.keyboard.press('KeyG');
  await click(t, 0, 15);
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 0, 15) === '9' && at(f, 16, 4, 14) === '9', 'fill floods the connected area');
  t.assert(at(f, 16, 3, 9) !== '9', 'fill stops at the ellipse outline');

  // Eyedropper: pick index 5 from (3, 2).
  await t.page.keyboard.press('KeyI');
  await click(t, 3, 2);
  t.assert(await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index) === '5', 'eyedropper picks the primary colour');

  // Alt = temporary eyedropper with any tool; the tool stays selected.
  await t.page.keyboard.press('KeyB');
  await t.page.keyboard.down('Alt');
  await click(t, 0, 5);
  await t.page.keyboard.up('Alt');
  t.assert(await t.eval(() => document.querySelector('.qf-art-strip .qf-art-sw.is-primary')?.dataset.index) === '1', 'Alt+click picks a colour');
  t.assert(await t.eval(() => document.querySelector('[data-tool="pencil"]').classList.contains('qf-btn--active')), 'the pencil stays selected after Alt');
  // Double-clicking a strip swatch opens that colour in the palette editor.
  await t.page.dblclick('.qf-art-strip .qf-art-sw[data-index="12"]');
  t.assert(await t.eval(() => document.querySelector('.qf-art-props .qf-art-pe__sw.is-active')?.dataset.index) === '12', 'strip double-click selects the colour for editing');
  await t.page.click('.qf-art-strip .qf-art-sw[data-index="5"]');

  // Mirror X drawing.
  await t.page.click('[data-toggle="mirrorX"]');
  await click(t, 1, 13);
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 1, 13) === '5' && at(f, 16, 14, 13) === '5', 'mirror X paints the symmetric pixel');
  await t.page.click('[data-toggle="mirrorX"]');
  await t.shot('drawn');

  // Select + move: marquee over the filled rect, drag it 2 px left, nudge up.
  await t.page.keyboard.press('KeyM');
  await drag(t, [9, 8], [12, 11]);
  await drag(t, [10, 9], [8, 9]);
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 7, 8) === '3' && at(f, 16, 12, 8) !== '3', 'dragging the selection moves its pixels');
  await t.page.keyboard.press('ArrowUp');
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 7, 7) === '3', 'arrow keys nudge the selection');
  await t.shot('selection-moved');
  // Escape while dragging the selection puts it back where the drag started.
  const held = await frameOf(t, 'tile', id);
  const u3 = await undoCount(t);
  const [mx, my] = await px(t, 8, 8);
  const [nx, ny] = await px(t, 3, 12);
  await t.page.mouse.move(mx, my);
  await t.page.mouse.down();
  await t.page.mouse.move(nx, ny, { steps: 4 });
  await t.page.keyboard.press('Escape');
  await t.page.mouse.up();
  const status = await t.eval(() => document.querySelector('.qf-art-status').textContent);
  t.assert(await frameOf(t, 'tile', id) === held && await undoCount(t) === u3, 'Escape mid-drag abandons the move');
  t.assert(status.includes('selection 4×4 at 7,7'), `the selection returns to its place (${status})`);
  await t.page.keyboard.press('Escape');

  // Flip / shift (Ctrl+arrow wraps).
  const beforeFlip = await frameOf(t, 'tile', id);
  await t.page.keyboard.press('Shift+KeyH');
  f = await frameOf(t, 'tile', id);
  t.assert(at(f, 16, 15, 5) === at(beforeFlip, 16, 0, 5) && at(f, 16, 13, 2) === at(beforeFlip, 16, 2, 2), 'Shift+H flips horizontally');
  await t.page.keyboard.press('Control+ArrowRight');
  const shifted = await frameOf(t, 'tile', id);
  t.assert(at(shifted, 16, 0, 2) === at(f, 16, 15, 2) && at(shifted, 16, 14, 2) === at(f, 16, 13, 2), 'Ctrl+Right shifts with wrap');

  // Undo twice restores the pre-flip frame; redo re-applies.
  await t.eval(() => { window.__art.undo(); window.__art.undo(); });
  await t.wait(50);
  t.assert(await frameOf(t, 'tile', id) === beforeFlip, 'undo restores the frame');
  await t.eval(() => window.__art.redo());
  await t.wait(50);
  t.assert(await frameOf(t, 'tile', id) === f, 'redo re-applies');

  // Zoom with the wheel.
  const z0 = await t.eval(() => document.querySelector('.qf-art-zoom').textContent);
  const [cx, cy] = await px(t, 8, 8);
  await t.page.mouse.move(cx, cy);
  await t.page.mouse.wheel(0, 200);
  await t.wait(50);
  const z1 = await t.eval(() => document.querySelector('.qf-art-zoom').textContent);
  t.assert(z0 !== z1, `wheel zooms (${z0} -> ${z1})`);
  return id;
}

async function palette(t) {
  // BUSH uses pal.t.meadow like the new tile: its browser thumbnail must follow colour edits.
  const bushThumb = () => t.eval(() => document.querySelector('.qf-art-list .qf-art-cell[data-id="6"] canvas').toDataURL());
  const before = await bushThumb();
  const u0 = await undoCount(t);
  await t.page.click('.qf-art-props .qf-art-pe__sw[data-index="1"]');
  await t.eval(() => {
    const r = document.querySelectorAll('.qf-art-props .qf-art-pe__range')[0];
    for (const v of [20, 26, 31]) {
      r.value = String(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await t.wait(80);
  const colour = await paletteColour(t, 'pal.t.meadow', 1);
  t.assert(colour.startsWith('#ff'), `R slider at 31 sets the red channel to ff (got ${colour})`);
  t.assert(await undoCount(t) === u0 + 1, 'a slider drag is one undo step');
  t.assert(await bushThumb() !== before, 'thumbnails of other tiles using the palette update');
  // Hex input snaps to 5-bit.
  await t.eval(() => {
    const hex = document.querySelector('.qf-art-props .qf-art-pe__hex');
    hex.value = '#123456';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await t.wait(50);
  const snapped = await paletteColour(t, 'pal.t.meadow', 1);
  t.assert(snapped === '#103152', `hex input snaps to SNES steps (got ${snapped})`);
  await t.shot('palette-edited');
  // Duplicate & assign gives this tile its own palette in one undo step.
  const u1 = await undoCount(t);
  await t.page.click('.qf-art-props .qf-btn:has-text("Duplicate & assign")');
  await t.wait(50);
  const pal = (await tileDef(t, 1000)).palette;
  t.assert(pal === 'pal.t.meadow.copy', `duplicate & assign (got ${pal})`);
  t.assert(await undoCount(t) === u1 + 1, 'duplicate & assign is one undo step');
}

async function frames(t, id) {
  await t.page.click('.qf-art-frames .qf-btn:has-text("+ Blank")');
  t.assert((await tileDef(t, id)).frames.length === 2, 'add blank frame');
  await t.page.click('.qf-art-frame[data-frame="0"]');
  await t.page.click('.qf-art-frames .qf-btn:has-text("Duplicate")');
  const tile = await tileDef(t, id);
  t.assert(tile.frames.length === 3 && tile.frames[1] === tile.frames[0], 'duplicate inserts a copy after the frame');
  t.assert(await t.eval(() => document.querySelector('.qf-art-frame.is-active')?.dataset.frame) === '1', 'the duplicate becomes the edited frame');
  await t.page.click('[data-toggle="onion"]');
  await t.page.keyboard.press('KeyB');
  await t.page.keyboard.press('Digit2');
  await click(t, 8, 1);
  await t.shot('frames-onion');
  await t.page.click('.qf-art-frames .qf-btn:has-text("Delete")');
  t.assert((await tileDef(t, id)).frames.length === 2, 'delete frame');
  await t.page.click('[data-toggle="onion"]');
}

async function tileProps(t, id) {
  await t.page.selectOption('.qf-art-props select[data-fk="collision"]', 'solid');
  await t.page.click('.qf-art-mask__q[data-bit="0"]');
  let d = await tileDef(t, id);
  t.assert(d.collision === 'solid' && d.solidMask === 14, `collision solid + mask toggle (mask ${d.solidMask})`);
  await t.page.click('input[data-fk="beh-cut"]');
  d = await tileDef(t, id);
  t.assert(!!d.cut && typeof d.cut.to === 'number', 'enable cut behaviour');
  await t.page.click('input[data-fk="beh-lift"]');
  await t.page.selectOption('.qf-art-props select[data-fk="beh-weight"]', '2');
  d = await tileDef(t, id);
  t.assert(d.lift?.weight === 2, 'lift weight');
  // Pick the cut target through the thumbnail popover.
  await t.page.click('[data-fk="beh-cut-to"]');
  await t.page.click('.qf-art-pop__cell[title^="200 "]');
  d = await tileDef(t, id);
  t.assert(d.cut?.to === 200, `cut target picked from the popover (got ${d.cut?.to})`);
  // Rename + key (custom tile).
  await t.page.fill('.qf-art-props input[data-fk="name"]', 'Mossy block');
  await t.page.keyboard.press('Tab');
  await t.page.fill('.qf-art-props input[data-fk="key"]', 'mossy block');
  await t.page.keyboard.press('Enter');
  d = await tileDef(t, id);
  t.assert(d.name === 'Mossy block' && d.key === 'MOSSY_BLOCK', `name + key (${d.name}, ${d.key})`);
  await t.shot('tile-props');
}

async function sprites(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Sprites")');
  await t.wait(50);
  t.assert(await t.eval(() => document.querySelector('.qf-art-row.is-active')?.dataset.id) === 'hero', 'hero is selected by default');
  await t.shot('sprite-hero');
  t.assert(await t.eval(() => document.querySelector('tr[data-anim="idle_down"] .qf-btn').disabled), 'required anim delete is disabled');
  // Add an anim through the prompt.
  await t.page.click('.qf-art-props .qf-btn:has-text("+ Add")');
  await t.page.fill('.qf-modal input', 'wave');
  await t.page.keyboard.press('Enter');
  await t.wait(50);
  let anims = (await spriteDef(t, 'hero')).anims;
  t.assert(!!anims.wave, 'anim added');
  await t.page.fill('tr[data-anim="wave"] input[data-fk="anim-wave-frames"]', '0, 1,2 1');
  await t.page.keyboard.press('Enter');
  anims = (await spriteDef(t, 'hero')).anims;
  t.assert(anims.wave?.frames.join(',') === '0,1,2,1', `anim frame list parsed (${anims.wave?.frames})`);
  await t.page.fill('tr[data-anim="wave"] input[data-fk="anim-wave-fps"]', '4');
  await t.page.keyboard.press('Enter');
  anims = (await spriteDef(t, 'hero')).anims;
  t.assert(anims.wave?.fps === 4, 'anim fps');
  await t.page.click('tr[data-anim="walk_down"] td:first-child');
  await t.wait(300);
  await t.shot('sprite-anim');
  await t.page.click('tr[data-anim="wave"] .qf-btn');
  anims = (await spriteDef(t, 'hero')).anims;
  t.assert(!anims.wave, 'custom anim deleted');

  // Custom sprite: resize pads frames around the bottom centre, origin follows.
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  const sid = await t.eval(() => document.querySelector('.qf-art-row.is-active')?.dataset.id);
  t.assert(sid === 'custom.sprite1', `new sprite id (${sid})`);
  await t.page.keyboard.press('Digit4');
  await click(t, 8, 15);
  await t.page.fill('.qf-art-props input[data-fk="w"]', '24');
  await t.page.keyboard.press('Enter');
  let s = await spriteDef(t, sid);
  t.assert(s.w === 24 && s.frames[0].length === 24 * 16 && s.ox === 12, `resize to 24x16 (ox ${s.ox})`);
  t.assert(s.frames[0][15 * 24 + 12] === '4', 'art stays bottom-centred after resize');
  // Origin tool drag (the origin snaps to pixel corners). Hotkeys need focus outside the size field.
  await t.eval(() => document.activeElement.blur());
  await t.page.keyboard.press('KeyP');
  const [ax, ay] = await px(t, 12, 8);
  const [bx, by] = await px(t, 5, 13);
  const half = (bx - ax) / (5 - 12) / 2;
  await t.page.mouse.move(ax, ay);
  await t.page.mouse.down();
  await t.page.mouse.move(bx - half, by - half, { steps: 5 });
  await t.page.mouse.up();
  s = await spriteDef(t, sid);
  t.assert(s.ox === 5 && s.oy === 13, `origin dragged to (5, 13) (got ${s.ox}, ${s.oy})`);
  await t.shot('sprite-custom');
  await t.page.keyboard.press('KeyB');
}

async function palettes(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Palettes")');
  await t.page.fill('.qf-art-browser__filters input', 'meadow');
  await t.page.click('.qf-art-row[data-id="pal.t.meadow"]');
  t.assert(await t.eval(() => document.querySelectorAll('.qf-art-pv__usage .qf-art-cell').length) >= 5, 'palette view lists the tiles that use it');
  await t.page.click('.qf-art-pv .qf-art-pe__sw[data-index="4"]');
  await t.eval(() => {
    const hex = document.querySelector('.qf-art-pv .qf-art-pe__hex');
    hex.value = '#e05030';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await t.wait(50);
  const c = await paletteColour(t, 'pal.t.meadow', 4);
  t.assert(c === '#de5231', `palette colour edited and snapped (${c})`);
  await t.shot('palette-view');
  await t.page.fill('.qf-art-browser__filters input', '');
}

async function terrains(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Terrains")');
  await t.wait(80);
  await t.shot('terrain-water');
  await t.page.click('.qf-art-tslot[data-piece="n"] .qf-art-tpick');
  const path = await t.eval(() => window.__art.T.PATH);
  await t.page.fill('.qf-art-pop input', 'path');
  await t.page.click(`.qf-art-pop__cell[title^="${path} "]`);
  const n = await t.eval(() => window.__art.project.terrains.find((x) => x.id === 'water').n);
  t.assert(n === path, `slot set through the picker (${n} vs PATH ${path})`);
  await t.shot('terrain-slot');
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  t.assert(await t.eval(() => window.__art.project.terrains.some((x) => x.id === 'terrain1')), 'new terrain');
  await t.page.click('.qf-art-browser__foot .qf-btn--danger');
  await t.page.click('.qf-modal .qf-btn--danger');
  t.assert(await t.eval(() => !window.__art.project.terrains.some((x) => x.id === 'terrain1')), 'terrain deleted');
}

async function deletion(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Tiles")');
  await t.page.click('.qf-art-list .qf-art-cell[data-id="6"]');
  t.assert(await t.eval(() => document.querySelector('.qf-art-browser__foot .qf-btn--danger').disabled), 'built-in tiles cannot be deleted');
  await t.page.click('.qf-art-list .qf-art-cell[data-id="1000"]');
  await t.page.click('.qf-art-browser__foot .qf-btn--danger');
  await t.page.click('.qf-modal .qf-btn--danger');
  t.assert(await t.eval(() => !window.__art.project.tiles.some((x) => x.id === 1000)), 'unused custom tile deleted');
  await t.eval(() => window.__art.undo());
  await t.wait(50);
  t.assert(await t.eval(() => window.__art.project.tiles.some((x) => x.id === 1000)), 'undo restores the deleted tile');
}

const status = (t) => t.eval(() => document.querySelector('.qf-art-status').textContent);
const selectionText = (s) => s.split('  ·  ').find((x) => x.startsWith('selection')) ?? 'none';
const zoomText = (t) => t.eval(() => document.querySelector('.qf-art-zoom').textContent);
const canvasFocused = (t) => t.eval(() => document.activeElement?.classList.contains('qf-art-canvas') ?? false);

/** Undo / redo put the marquee back with the pixels; a deselect in between is respected. */
async function selectionUndo(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Tiles")');
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  const id = await t.eval(() => Math.max(...window.__art.project.tiles.map((x) => x.id)));
  await t.page.keyboard.press('Digit6');
  await t.page.keyboard.press('KeyR');
  await drag(t, [1, 1], [4, 4], { shift: true });
  const block = await frameOf(t, 'tile', id);
  await t.page.keyboard.press('KeyM');
  await drag(t, [1, 1], [4, 4]);
  await drag(t, [2, 2], [8, 6]);
  const moved = await frameOf(t, 'tile', id);
  t.assert(at(moved, 16, 7, 5) === '6' && at(moved, 16, 1, 1) === '0', 'the block moved by (6, 4)');
  await t.eval(() => window.__art.undo());
  await t.wait(50);
  let s = await status(t);
  t.assert(await frameOf(t, 'tile', id) === block && s.includes('selection 4×4 at 1,1'), `undoing a move puts pixels and marquee back (${selectionText(s)})`);
  await t.shot('selection-undone');
  await t.eval(() => window.__art.redo());
  await t.wait(50);
  s = await status(t);
  t.assert(await frameOf(t, 'tile', id) === moved && s.includes('selection 4×4 at 7,5'), `redo moves both again (${selectionText(s)})`);
  await t.eval(() => window.__art.undo());
  await t.wait(50);
  await t.page.keyboard.press('ArrowRight');
  const nudged = await frameOf(t, 'tile', id);
  t.assert(at(nudged, 16, 5, 1) === '6' && at(nudged, 16, 1, 1) === '0', 'a nudge after undo moves the block that is shown selected');
  // Deselect, then undo the nudge: pixels go back, no old marquee reappears.
  await t.page.keyboard.press('Escape');
  await t.eval(() => window.__art.undo());
  await t.wait(50);
  s = await status(t);
  t.assert(await frameOf(t, 'tile', id) === block && !s.includes('selection'), `undo after a deselect restores pixels only (${selectionText(s)})`);
  // Undo of a paste drops the pasted marquee back to the selection it replaced.
  await drag(t, [1, 1], [4, 4]);
  await t.page.keyboard.press('Control+KeyC');
  await t.page.keyboard.press('Escape');
  await drag(t, [10, 10], [11, 11]);
  await t.page.keyboard.press('Control+KeyV');
  t.assert(selectionText(await status(t)) === 'selection 4×4 at 10,10', 'paste lands at the selection');
  await t.eval(() => window.__art.undo());
  await t.wait(50);
  s = await status(t);
  t.assert(await frameOf(t, 'tile', id) === block && selectionText(s) === 'selection 2×2 at 10,10', `undoing a paste restores the earlier marquee (${selectionText(s)})`);
  await t.page.keyboard.press('Escape');
  await t.page.keyboard.press('KeyB');
  return id;
}

/** Buttons give the keyboard back to the canvas; Space pans instead of repeating a click; the wheel only zooms vertically. */
async function viewKeys(t, id) {
  const u0 = await undoCount(t);
  await t.page.click('.qf-art-toolbar .qf-art-tb[title^="Flip horizontally"]');
  t.assert(await canvasFocused(t), 'a toolbar click hands the keyboard to the canvas');
  await t.page.keyboard.press('Space');
  await t.page.keyboard.press('Enter');
  t.assert(await undoCount(t) === u0 + 1, 'Space / Enter after a toolbar click do not repeat it');
  await t.page.click('.qf-art-frames .qf-btn:has-text("+ Blank")');
  await t.page.keyboard.press('Space');
  t.assert((await tileDef(t, id)).frames.length === 2, 'Space after "+ Blank" adds no second frame');
  await t.eval(() => { window.__art.undo(); window.__art.undo(); });
  await t.wait(50);

  // Sideways wheel (Shift+wheel, trackpad pan) leaves the zoom alone; a vertical notch is one step.
  const [cx, cy] = await px(t, 8, 8);
  await t.page.mouse.move(cx, cy);
  const z0 = await zoomText(t);
  await t.page.mouse.wheel(120, 0);
  await t.wait(50);
  t.assert(await zoomText(t) === z0, `a sideways wheel does not zoom (${z0} -> ${await zoomText(t)})`);
  await t.page.mouse.wheel(0, 30);
  await t.wait(30);
  t.assert(await zoomText(t) === z0, 'a small trackpad delta alone does not zoom');
  for (let i = 0; i < 3; i++) await t.page.mouse.wheel(0, 30);
  await t.wait(30);
  const z1 = await zoomText(t);
  t.assert(z1 !== z0, `trackpad-sized deltas add up to one zoom step (${z0} -> ${z1})`);

  // Pointer leaves: the status forgets the hover pixel.
  await t.page.mouse.move(cx + 3, cy + 3);
  t.assert(/^x \d+, y \d+/.test(await status(t)), 'hovering shows the pixel under the pointer');
  await t.page.mouse.move(5, 450);
  await t.wait(30);
  t.assert(!/^x \d+, y \d+/.test(await status(t)), 'the hover pixel leaves the status with the pointer');

  // Space + drag pans the zoomed hero sprite without painting, even with the clicked asset row still focused.
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Sprites")');
  await t.page.fill('.qf-art-browser__filters input', 'hero');
  await t.page.click('.qf-art-row[data-id="hero"]');
  const [hx, hy] = await px(t, 8, 12);
  await t.page.mouse.move(hx, hy);
  for (let i = 0; i < 12; i++) await t.page.mouse.wheel(0, -100);
  await t.wait(50);
  const scroll = () => t.eval(() => document.querySelector('.qf-art-view').scrollTop);
  const frame = await frameOf(t, 'sprite', 'hero');
  const u1 = await undoCount(t);
  const top0 = await scroll();
  const [gx, gy] = await px(t, 8, 12);
  await t.page.mouse.move(gx, gy);
  await t.page.keyboard.down('Space');
  const grab = await t.eval(() => document.querySelector('.qf-art-canvas').style.cursor);
  await t.page.mouse.down();
  await t.page.mouse.move(gx, gy + (top0 > 0 ? 120 : -120), { steps: 6 });
  await t.page.mouse.up();
  await t.page.keyboard.up('Space');
  const top1 = await scroll();
  t.assert(grab === 'grab' && top1 !== top0, `Space + drag pans the view (cursor ${grab}, scrollTop ${top0} -> ${top1})`);
  t.assert(await frameOf(t, 'sprite', 'hero') === frame && await undoCount(t) === u1, 'panning paints nothing');
  await t.shot('panned');
  await t.page.click('.qf-art-statusbar .qf-art-tb[title^="Fit"]');
}

/** Number fields refuse empty / fractional sizes; Escape in a text field puts its value back. */
async function fieldEntry(t) {
  await t.page.fill('.qf-art-browser__filters input', 'custom');
  await t.page.click('.qf-art-row[data-id="custom.sprite1"]');
  await t.page.fill('.qf-art-browser__filters input', '');
  const s0 = await spriteDef(t, 'custom.sprite1');
  const u0 = await undoCount(t);
  await t.page.fill('.qf-art-props input[data-fk="w"]', '');
  await t.page.keyboard.press('Enter');
  let s = await spriteDef(t, 'custom.sprite1');
  const shown = await t.eval(() => document.querySelector('.qf-art-props input[data-fk="w"]').value);
  t.assert(s.w === s0.w && await undoCount(t) === u0 && shown === String(s0.w), `an emptied width changes nothing (w ${s.w}, field "${shown}")`);
  await t.page.fill('.qf-art-props input[data-fk="w"]', '10.5');
  await t.page.keyboard.press('Enter');
  s = await spriteDef(t, 'custom.sprite1');
  t.assert(s.w === 11 && s.frames.every((f) => f.length === 11 * s.h), `a fractional width rounds to whole pixels (w ${s.w})`);
  await t.page.fill('.qf-art-props input[data-fk="oy"]', '');
  await t.page.keyboard.press('Enter');
  t.assert((await spriteDef(t, 'custom.sprite1')).oy === s.oy, 'an emptied origin keeps its value');
  await t.page.fill('tr[data-anim="idle"] input[data-fk="anim-idle-fps"]', '');
  await t.page.keyboard.press('Enter');
  t.assert((await spriteDef(t, 'custom.sprite1')).anims.idle.fps === s.anims.idle.fps, 'an emptied fps keeps its value');

  const name = s.name;
  await t.page.click('.qf-art-props input[data-fk="name"]');
  await t.page.keyboard.press('End');
  await t.page.keyboard.type('zz');
  await t.page.keyboard.press('Escape');
  await t.wait(50);
  const field = await t.eval(() => document.querySelector('.qf-art-props input[data-fk="name"]').value);
  t.assert((await spriteDef(t, 'custom.sprite1')).name === name && field === name, `Escape cancels a rename (${field})`);
  t.assert(await canvasFocused(t), 'Escape hands the keyboard back to the canvas');
  await t.page.click('input[data-fk="anim-idle-frames"]');
  await t.page.keyboard.press('End');
  await t.page.keyboard.type(',0');
  await t.page.keyboard.press('Escape');
  await t.page.click('.qf-art-props input[data-fk="name"]');
  await t.wait(50);
  t.assert((await spriteDef(t, 'custom.sprite1')).anims.idle.frames.join(',') === s.anims.idle.frames.join(','), 'Escape cancels an anim frame-list edit (no commit on the next blur)');
  await t.eval(() => document.activeElement?.blur());
}

const listedIds = (t) => t.eval(() => [...document.querySelectorAll('.qf-art-list [data-id]')].map((x) => x.dataset.id));
const activeId = (t) => t.eval(() => document.querySelector('.qf-art-list .is-active')?.dataset.id ?? null);
const searchText = (t) => t.eval(() => document.querySelector('.qf-art-browser__filters input').value);
const newestTile = (t) => t.eval(() => String(Math.max(...window.__art.project.tiles.map((x) => x.id))));

/** New / Duplicate / outside picks clear a filter that would hide them; Delete keeps the filter and moves to a listed neighbour. */
async function browserFilters(t) {
  await t.page.selectOption('.qf-art-tagsel', 'dungeon');
  await t.wait(50);
  const n0 = (await listedIds(t)).length;
  await t.page.click('.qf-art-browser__foot .qf-btn--primary');
  await t.wait(80);
  const id = await newestTile(t);
  const tag = await t.eval(() => document.querySelector('.qf-art-tagsel').value);
  t.assert((await listedIds(t)).includes(id) && await activeId(t) === id && tag === '',
    `+ New under the tag filter "dungeon" (${n0} listed) lists and highlights the new tile ${id} (filter now "${tag}")`);
  await t.shot('new-under-tag-filter');

  const grass = await t.eval(() => String(window.__art.T.GRASS));
  await t.page.fill('.qf-art-browser__filters input', 'grass');
  await t.page.click(`.qf-art-list .qf-art-cell[data-id="${grass}"]`);
  await t.page.fill('.qf-art-browser__filters input', 'zzz-nothing');
  await t.page.click('.qf-art-browser__foot .qf-btn:has-text("Duplicate")');
  await t.wait(80);
  const dup = await newestTile(t);
  t.assert((await listedIds(t)).includes(dup) && await activeId(t) === dup && await searchText(t) === '',
    `Duplicate under a search that hides it lists and highlights the copy ${dup}`);

  // A copy the search still matches keeps the search; deleting it moves to a listed tile, filter kept.
  await t.page.fill('.qf-art-browser__filters input', 'grass');
  await t.page.click(`.qf-art-list .qf-art-cell[data-id="${grass}"]`);
  await t.page.click('.qf-art-browser__foot .qf-btn:has-text("Duplicate")');
  await t.wait(80);
  const copy = await newestTile(t);
  t.assert(await searchText(t) === 'grass' && await activeId(t) === copy, `a copy the search matches keeps the search "${await searchText(t)}"`);
  await t.page.click('.qf-art-browser__foot .qf-btn--danger');
  await t.page.click('.qf-modal .qf-btn--danger');
  await t.wait(80);
  const after = await activeId(t);
  t.assert(await searchText(t) === 'grass' && after !== null && after !== copy && (await listedIds(t)).includes(after),
    `deleting under a search selects a listed neighbour (${after}) and keeps the search`);

  // Opening a tile from the palette view un-hides it in the Tiles list.
  await t.page.fill('.qf-art-browser__filters input', 'zzz-nothing');
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Palettes")');
  await t.page.click('.qf-art-row[data-id="pal.t.meadow"]');
  await t.page.click(`.qf-art-pv__usage .qf-art-cell[title^="${grass} "]`);
  await t.wait(80);
  t.assert(await activeId(t) === grass && await searchText(t) === '', 'a tile opened from the palette view is listed and highlighted');
  await t.eval(() => document.activeElement?.blur());
}

/** Arrow keys on a palette slider in the tile properties keep stepping it (focus survives the rebuild) and never reach the canvas. */
async function sliderKeys(t) {
  const grass = await t.eval(() => window.__art.T.GRASS);
  await t.page.keyboard.press('KeyM');
  await drag(t, [2, 2], [9, 9]);
  const f0 = await frameOf(t, 'tile', grass);
  await t.page.click('.qf-art-props .qf-art-pe__sw[data-index="3"]');
  const read = () => t.eval(() => ({
    v: Number(document.querySelector('.qf-art-props input[data-fk="pe-G"]').value),
    focus: document.activeElement?.dataset?.fk ?? document.activeElement?.tagName,
  }));
  await t.page.focus('.qf-art-props input[data-fk="pe-G"]');
  const a = await read();
  const [key, sign] = a.v <= 27 ? ['ArrowRight', 1] : ['ArrowLeft', -1];
  const u0 = await undoCount(t);
  const focus = [];
  for (let i = 0; i < 4; i++) {
    await t.page.keyboard.press(key);
    await t.wait(40);
    focus.push((await read()).focus);
  }
  await t.wait(60);
  const b = await read();
  t.assert(b.v === a.v + 4 * sign, `4 spaced ${key} presses step the G slider 4 levels (${a.v} -> ${b.v}; focus ${focus.join(',')})`);
  t.assert(await frameOf(t, 'tile', grass) === f0, 'slider arrows leave the tile pixels (and the marquee) alone');
  t.assert(await undoCount(t) === u0 + 4, `each slider step is one undo step (${(await undoCount(t)) - u0})`);
  await t.page.keyboard.press('Tab');
  t.assert((await read()).focus === 'pe-B', 'Tab from a slider moves on to the next slider');
  await t.eval(() => document.activeElement?.blur());
  await t.page.keyboard.press('KeyB');
}

/** Ctrl+Z during a slider drag: the drag's undo step starts from the restored colours (no undone edit comes back). */
async function sliderUndo(t) {
  // Stand-in for the shell's Ctrl+Z / Ctrl+Y (bubble phase on document, skips handled keys).
  await t.eval(() => document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !e.ctrlKey || (e.code !== 'KeyZ' && e.code !== 'KeyY')) return;
    e.preventDefault();
    if (e.code === 'KeyZ') window.__art.undo();
    else window.__art.redo();
  }));
  const colour = () => paletteColour(t, 'pal.t.meadow', 3);
  const original = await colour();
  const u0 = await undoCount(t);
  await t.page.fill('.qf-art-props input[data-fk="pe-hex"]', '#f80000');
  await t.page.keyboard.press('Enter');
  await t.wait(60);
  const edited = await colour();
  const r = await t.page.locator('.qf-art-props .qf-art-pe__range').nth(2).boundingBox();
  await t.page.mouse.move(r.x + r.width * 0.1, r.y + r.height / 2);
  await t.page.mouse.down();
  await t.page.mouse.move(r.x + r.width * 0.3, r.y + r.height / 2, { steps: 3 });
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  const midUndo = await colour();
  await t.page.mouse.move(r.x + r.width * 0.6, r.y + r.height / 2, { steps: 3 });
  await t.page.mouse.up();
  await t.wait(60);
  const dragged = await colour();
  await t.page.keyboard.press('Control+KeyZ');
  await t.wait(60);
  const undone = await colour();
  await t.page.keyboard.press('Control+KeyY');
  await t.wait(60);
  const redone = await colour();
  t.log({ original, edited, midUndo, dragged, undone, redone });
  t.assert(midUndo === original, `Ctrl+Z mid-drag undoes the hex edit (${midUndo} vs ${original})`);
  t.assert(undone === original && await undoCount(t) === u0 + 1, `undoing the drag gives the original colour back, not the undone edit (${undone})`);
  t.assert(redone === dragged, `redo brings the dragged colour back (${redone})`);
}

/** The palette editor's index labels sit on a dark chip (readable on light colours). */
async function swatchLabels(t) {
  await t.page.click('.qf-art-kinds .qf-tab:has-text("Tiles")');
  await t.page.click('.qf-art-list .qf-art-cell[data-id="1"]');
  const chip = await t.eval(() => getComputedStyle(document.querySelector('.qf-art-props .qf-art-pe__sw'), '::before').backgroundColor);
  t.assert(/rgba\(0, 0, 0, 0\.[5-9]/.test(chip), `swatch index labels have a dark backing (${chip})`);
  const full = await t.shot('swatch-labels');
  await t.page.locator('.qf-art-props .qf-art-pe').screenshot({ path: full.replace(/\.png$/, '-zoom.png') });
}

export default async function (t) {
  await t.page.setViewportSize({ width: 1440, height: 900 });
  await mount(t);
  await t.shot('mounted');
  const id = await drawing(t);
  await palette(t);
  await frames(t, id);
  await tileProps(t, id);
  await sprites(t);
  await palettes(t);
  await terrains(t);
  await deletion(t);
  const blank = await selectionUndo(t);
  await viewKeys(t, blank);
  await fieldEntry(t);
  // Review fixes on a fresh project.
  await mount(t);
  await browserFilters(t);
  await sliderKeys(t);
  await sliderUndo(t);
  await swatchLabels(t);
}
