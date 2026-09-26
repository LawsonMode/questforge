// Map editor quality pass: resizing a room moves the warps arriving at its
// doorways (toast, one undo step); a walled shrink names the trigger tile
// changes it drops; Delete on the map asks before removing an entity a trigger
// uses; Ctrl+D on a door starts the copy unlinked; the tile clipboard never
// pastes tile ids the project lacks (deleted tile, another project); the world
// overview stays small and fast with far-apart rooms; layer eyes have names;
// dungeon worlds get a prize name field; the intro dialogue "Go".

async function calibrate(t) {
  const box = await t.page.locator('.qf-map-canvas').boundingBox();
  const read = async (x, y) => {
    await t.page.mouse.move(x, y);
    await t.wait(40);
    return t.eval(() => {
      const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
      const m = /(-?\d+), (-?\d+) px/.exec(text);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });
  };
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const a = await read(x0, y0);
  const b = await read(x0 + 96, y0 + 96);
  const s = 96 / (b.x - a.x);
  const px = (x, y) => ({ x: x0 + (x - a.x - 0.5) * s, y: y0 + (y - a.y - 0.5) * s });
  return { px, cell: (tx, ty) => px(tx * 16 + 8, ty * 16 + 8) };
}

const newProject = async (t) => {
  await t.goto('#/');
  await t.page.click('.qf-menu-new-btn');
  await t.page.locator('.qf-modal').getByRole('button', { name: 'Create project' }).click();
  await t.until(() => window.__qf.editor && window.__qf.ready, null, 8000);
  await t.wait(400);
};

const toasts = (t) => t.eval(() => [...document.querySelectorAll('.qf-toast')].map((e) => e.textContent));
const modalText = (t) => t.eval(() => document.querySelector('.qf-modal')?.innerText ?? null);
const blur = (t) => t.eval(() => document.activeElement?.blur());

export default async function (t) {
  const { page } = t;

  // ---- resize: the Keep Gate warp follows the Entrance Hall's south door
  await t.goto('#/edit/sample');
  const warpY = () => t.eval(() => {
    const p = window.__qf.editor.ctx.project;
    const gate = p.worlds.flatMap((w) => w.rooms).find((r) => r.id === 'ow_keep_gate');
    return gate.entities.find((e) => e.id === 'kg_keep_door').props.target.y;
  });
  const y0 = await warpY();
  await t.eval(() => window.__qf.editor.ctx.selectRoom('hollow_keep', 'kp_entrance'));
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await page.selectOption('.qf-map-right select[data-key="gh"]', '2');
  await t.wait(300);
  const grown = { y: await warpY(), toasts: await toasts(t), door: await t.eval(() => window.__qf.editor.ctx.room().entities.find((e) => e.id === 'kp_e1_door_s').y) };
  t.log('entrance hall grown', { y0, ...grown });
  t.assert(grown.y === y0 + 224 && grown.door - grown.y === 216 - y0, `the Keep Gate warp keeps its place above the south door (${y0} -> ${grown.y}, door ${grown.door})`);
  t.assert(grown.toasts.some((s) => /Moved 1 arrival point/.test(s)), `a toast says the arrival point moved (${grown.toasts.join(' | ')})`);
  await blur(t);
  await page.keyboard.press('Control+z');
  await t.wait(200);
  t.assert((await warpY()) === y0, 'one Ctrl+Z puts the room and the warp back');

  // ---- Delete on the map asks when a trigger uses the entity
  const sign = await t.eval(() => {
    const p = window.__qf.editor.ctx.project;
    for (const w of p.worlds) for (const r of w.rooms) {
      const e = r.entities.find((x) => x.id === 'vil_sign_celebrate');
      if (e) return { world: w.id, room: r.id, x: e.x, y: e.y };
    }
    return null;
  });
  await t.eval(([w, r]) => window.__qf.editor.ctx.selectRoom(w, r), [sign.world, sign.room]);
  await t.wait(300);
  await blur(t);
  await page.keyboard.press('KeyN');
  await t.wait(100);
  let cal = await calibrate(t);
  let pt = cal.px(sign.x, sign.y);
  await page.mouse.click(pt.x, pt.y);
  await t.wait(150);
  t.assert((await t.eval(() => window.__qf.editor.ctx.entityId)) === 'vil_sign_celebrate', 'the sign is selected on the map');
  await page.keyboard.press('Delete');
  await t.until(() => !!document.querySelector('.qf-modal'), null, 2000);
  const ask = await modalText(t);
  await t.shot('delete-asks');
  t.assert(/is used by/.test(ask ?? '') && /Crystal returned/.test(ask ?? ''), `Delete names the trigger that uses the sign (${ask})`);
  const focusOnCancel = await t.eval(() => document.activeElement?.textContent);
  t.assert(focusOnCancel === 'Cancel', `focus starts on Cancel (${focusOnCancel})`);
  await page.keyboard.press('Enter');
  await t.wait(150);
  const stillThere = () => t.eval(() => window.__qf.editor.ctx.room().entities.some((e) => e.id === 'vil_sign_celebrate'));
  t.assert(await stillThere(), 'Enter (Cancel) keeps the sign');
  // The right-click menu's Delete asks the same, and "Delete" then removes it.
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.locator('.qf-map-menu, .qf-ctxmenu, [role="menu"]').getByText('Delete', { exact: true }).click();
  await t.until(() => !!document.querySelector('.qf-modal'), null, 2000);
  await page.locator('.qf-modal .qf-modal__footer').getByRole('button', { name: 'Delete', exact: true }).click();
  await t.wait(150);
  t.assert(!(await stillThere()), 'confirming Delete removes the sign');
  await page.keyboard.press('Control+z');
  await t.wait(150);
  t.assert(await stillThere(), 'Ctrl+Z brings the sign back');

  // ---- Ctrl+D on a locked door: the copy has no link
  await t.eval(() => window.__qf.editor.ctx.selectRoom('hollow_keep', 'kp_guard_hall'));
  await t.wait(300);
  await blur(t);
  await page.keyboard.press('KeyN');
  cal = await calibrate(t);
  pt = cal.px(248, 112);
  await page.mouse.click(pt.x, pt.y);
  await t.wait(150);
  const doorSel = await t.eval(() => window.__qf.editor.ctx.entityId);
  await page.keyboard.press('Control+d');
  await t.wait(200);
  const dup = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const room = ctx.room();
    const copy = room.entities.find((e) => e.id === ctx.entityId);
    const orig = room.entities.find((e) => e.id === 'kp_g1_door_e');
    return { copyLink: copy.props.link, copyKind: copy.props.kind, origLink: orig.props.link, copyId: copy.id };
  });
  t.log('duplicated door', { doorSel, ...dup });
  t.assert(doorSel === 'kp_g1_door_e' && dup.copyId !== 'kp_g1_door_e', 'Ctrl+D made a copy of the door');
  t.assert(dup.copyLink === '' && dup.origLink !== '' && dup.copyKind === 'locked', `the copy is unlinked, the original keeps its link (${JSON.stringify(dup)})`);
  await page.keyboard.press('Control+z');

  // ---- walled shrink: the confirm names the trigger tile changes it drops
  await t.eval(async () => {
    const ctx = window.__qf.editor.ctx;
    const { addWorld } = await import('/src/editor/map/worldOps.ts');
    const { resizeRoomUndoable } = await import('/src/editor/map/roomOps.ts');
    const w = addWorld(ctx, 'Crypt', 'dungeon', 'dungeon');
    const room = w.rooms[0];
    resizeRoomUndoable(ctx, w.id, room.id, 2, 1);
    const r = ctx.project.worlds.find((x) => x.id === w.id).rooms[0];
    r.triggers.push({ id: 't_open', name: 'Open', on: 'enter', conditions: [], once: false, actions: [{ kind: 'setTile', layer: 'bg', tx: 20, ty: 7, tile: 0 }] });
    ctx.changed('triggers', r.id);
  });
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(200);
  // The Crypt is a dungeon world: it has a prize name field (the overworld has none).
  const prize = await t.eval(() => {
    const input = document.querySelector('input[aria-label="Prize name"]');
    return { shown: !!input && !input.closest('[hidden]'), placeholder: input?.placeholder };
  });
  t.assert(prize.shown && prize.placeholder === 'Crypt Crystal', `a dungeon world shows the prize field (${JSON.stringify(prize)})`);
  await page.fill('input[aria-label="Prize name"]', '  Moon Shard ');
  await page.press('input[aria-label="Prize name"]', 'Tab');
  await t.wait(100);
  t.assert((await t.eval(() => window.__qf.editor.ctx.world().prizeName)) === 'Moon Shard', 'the prize name is stored (trimmed)');
  await t.shot('prize-field');
  page.once('dialog', () => {});
  await page.selectOption('.qf-map-right select[data-key="gw"]', '1');
  await t.until(() => !!document.querySelector('.qf-modal'), null, 2000);
  const shrinkAsk = await modalText(t);
  t.assert(/1 trigger tile change/.test(shrinkAsk ?? ''), `the shrink confirm names the trigger tile change (${shrinkAsk})`);
  await page.locator('.qf-modal .qf-modal__footer').getByRole('button', { name: 'Shrink' }).click();
  await t.wait(150);
  const acts = await t.eval(() => window.__qf.editor.ctx.room().triggers[0].actions.length);
  t.assert(acts === 0, `the dropped set-tile action is gone (${acts} left)`);
  await t.eval(() => window.__qf.editor.ctx.selectRoom('ellendor', window.__qf.editor.ctx.project.worlds[0].rooms[0].id));
  await t.wait(150);
  t.assert(await t.eval(() => !!document.querySelector('input[aria-label="Prize name"]')?.closest('[hidden]')), 'the overworld has no prize field');

  // ---- layer eyes: named toggles
  const eyes = await t.eval(() => [...document.querySelectorAll('.qf-map-eye')].map((b) => `${b.getAttribute('aria-label')}|${b.getAttribute('aria-pressed')}`));
  t.log('eyes', eyes);
  t.assert(eyes.join(',') === 'Hide Ground layer|false,Hide Objects layer|false,Hide Overhead layer|false,Hide Entities layer|false', `each eye names its layer (${eyes.join(', ')})`);
  await page.click('.qf-map-eye[data-eye="fg"]');
  const fgEye = await t.eval(() => { const b = document.querySelector('.qf-map-eye[data-eye="fg"]'); return `${b.getAttribute('aria-label')}|${b.getAttribute('aria-pressed')}`; });
  t.assert(fgEye === 'Hide Objects layer|true', `a hidden layer's eye keeps its name and is pressed (${fgEye})`);
  await page.click('.qf-map-eye[data-eye="fg"]');

  // ---- intro dialogue problem: "Go" focuses the Intro dialogue setting
  await t.eval(() => { const ctx = window.__qf.editor.ctx; ctx.project.settings.introDialogue = 'd_gone'; ctx.changed('settings'); });
  await page.click('#qf-tab-project');
  await t.until(() => !!document.querySelector('.qf-proj-problem'), null, 4000);
  const go = page.locator('.qf-proj-problem:has-text("Intro dialogue") .qf-btn');
  const goTitle = await go.getAttribute('title');
  await go.click();
  await t.wait(200);
  const focused = await t.eval(() => ({ tab: window.__qf.editor.ctx.activeTab, label: document.activeElement?.getAttribute('aria-label') }));
  t.assert(goTitle === 'Show the intro dialogue setting' && focused.tab === 'project' && focused.label === 'Intro dialogue',
    `Go focuses the Intro dialogue setting (${goTitle}; ${JSON.stringify(focused)})`);

  // ---- tile clipboard: a deleted tile is skipped; another project gets a copy of the tile, not its own tile 1000
  await newProject(t);
  const A = await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const p = ctx.project;
    const grass = p.tiles.find((x) => x.key === 'GRASS');
    const tile = { ...structuredClone(grass), id: 1000, key: 'TILE_1000', name: 'A custom', tags: ['custom'], frames: [grass.frames[0].replace(/./g, (c, i) => (i % 3 ? c : '1'))] };
    p.tiles.push(tile);
    ctx.changed('tiles');
    ctx.assetsChanged('tile', 1000);
    const room = ctx.room();
    for (const i of [4 * 16 + 4, 4 * 16 + 5, 4 * 16 + 6]) room.layers.bg[i] = 1000;
    room.layers.bg[4 * 16 + 7] = p.tiles.find((x) => x.key === 'SAND').id;
    ctx.changed('room', room.id);
    return { frames: tile.frames };
  });
  await t.wait(200);
  await blur(t);
  cal = await calibrate(t);
  await page.keyboard.press('KeyS');
  let s0 = cal.cell(4, 4); let s1 = cal.cell(7, 4);
  await page.mouse.move(s0.x, s0.y); await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Control+x');
  await t.wait(150);
  await t.eval(() => { const ctx = window.__qf.editor.ctx; ctx.project.tiles = ctx.project.tiles.filter((x) => x.id !== 1000); ctx.changed('tiles'); ctx.assetsChanged('all'); });
  await page.keyboard.press('Control+v');
  let d = cal.cell(8, 8);
  await page.mouse.move(d.x, d.y);
  await page.mouse.click(d.x, d.y);
  await page.keyboard.press('Escape');
  await t.wait(200);
  const same = await t.eval(async () => {
    const r = window.__qf.editor.ctx.room();
    const { validateProject } = await import('/src/core/validate.ts');
    return {
      ids: r.layers.bg.slice(8 * 16 + 7, 8 * 16 + 11),
      unknown: validateProject(window.__qf.editor.ctx.project).filter((x) => /unknown tile/i.test(x.message)).length,
      toasts: [...document.querySelectorAll('.qf-toast')].map((e) => e.textContent),
    };
  });
  t.log('same project paste after the tile was deleted', same);
  t.assert(!same.ids.includes(1000) && same.unknown === 0, `no deleted tile ids are pasted (${same.ids})`);
  t.assert(same.toasts.some((s) => /skipped 3 cells/.test(s)), `the paste says what it skipped (${same.toasts.join(' | ')})`);

  // Copy again (with the tile back), then paste in project B that has its own, different tile 1000.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // undo the cut
  await t.eval((frames) => {
    const ctx = window.__qf.editor.ctx;
    const grass = ctx.project.tiles.find((x) => x.key === 'GRASS');
    ctx.project.tiles.push({ ...structuredClone(grass), id: 1000, key: 'TILE_1000', name: 'A custom', tags: ['custom'], frames });
    ctx.changed('tiles'); ctx.assetsChanged('all');
  }, A.frames);
  await t.wait(150);
  await page.keyboard.press('KeyS');
  await page.mouse.move(s0.x, s0.y); await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Control+c');
  await t.wait(100);
  await newProject(t);
  await t.eval(() => {
    const ctx = window.__qf.editor.ctx;
    const water = ctx.project.tiles.find((x) => x.key === 'WATER') ?? ctx.project.tiles[1];
    ctx.project.tiles.push({ ...structuredClone(water), id: 1000, key: 'TILE_1000', name: 'B own', tags: ['custom'] });
    ctx.changed('tiles'); ctx.assetsChanged('all');
  });
  await blur(t);
  cal = await calibrate(t);
  await page.keyboard.press('KeyS');
  await page.keyboard.press('Control+v');
  d = cal.cell(8, 8);
  await page.mouse.move(d.x, d.y);
  await t.wait(100);
  await page.mouse.click(d.x, d.y);
  await page.keyboard.press('Escape');
  await t.wait(250);
  const other = await t.eval(async (frames) => {
    const ctx = window.__qf.editor.ctx;
    const r = ctx.room();
    const ids = r.layers.bg.slice(8 * 16 + 7, 8 * 16 + 11);
    const t1 = ctx.project.tiles.find((x) => x.id === ids[0]);
    const { validateProject } = await import('/src/core/validate.ts');
    return {
      ids, name: t1?.name, sameArt: JSON.stringify(t1?.frames) === JSON.stringify(frames),
      unknown: validateProject(ctx.project).filter((x) => /unknown tile/i.test(x.message)).length,
      undo: ctx.undo.peekUndo(),
    };
  }, A.frames);
  t.log('paste into another project', other);
  await t.shot('other-project-paste');
  t.assert(other.ids[0] === 1001 && other.ids[1] === 1001 && other.ids[2] === 1001 && other.sameArt, `the other project gets a copy of the tile under a free id (${JSON.stringify(other)})`);
  t.assert(other.unknown === 0 && other.undo === 'Paste tiles', 'no unknown ids, one undo step');
  await blur(t);
  await page.keyboard.press('Control+z');
  await t.wait(150);
  const undone = await t.eval(() => ({ has1001: window.__qf.editor.ctx.project.tiles.some((x) => x.id === 1001), cell: window.__qf.editor.ctx.room().layers.bg[8 * 16 + 7] }));
  t.assert(!undone.has1001 && undone.cell !== 1001, `undoing the paste removes the brought-along tile too (${JSON.stringify(undone)})`);

  // ---- animated tiles: a tick (row runs, pattern fills, only the cells in view) paints exactly what a full redraw does
  const anim = await t.eval(async () => {
    const { LayerCache } = await import('/src/editor/map/roomRender.ts');
    const assets = window.__qf.editor.ctx.assets;
    const p = window.__qf.editor.ctx.project;
    const water = p.tiles.find((x) => x.key === 'WATER' && x.frames.length > 1) ?? p.tiles.find((x) => x.frames.length > 1);
    const other = p.tiles.find((x) => x.frames.length > 1 && x.id !== water.id) ?? water;
    const cols = 64;
    const rows = 56;
    const data = Array.from({ length: cols * rows }, (_, i) => (i % 7 === 3 ? 1 : i % 11 === 5 ? other.id : water.id));
    let t1 = 0;
    while (assets.tileFrameAt(water.id, t1) === assets.tileFrameAt(water.id, 0) && t1 < 5) t1 += 0.05;
    const pixels = (c) => c.canvas.getContext('2d').getImageData(0, 0, cols * 16, rows * 16).data;
    const diff = (a, b, box) => {
      let n = 0;
      for (let y = 0; y < rows * 16; y++) {
        for (let x = 0; x < cols * 16; x++) {
          if (box && !(x >= box.x0 * 16 && x < box.x1 * 16 && y >= box.y0 * 16 && y < box.y1 * 16)) continue;
          const k = (y * cols * 16 + x) * 4;
          if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2] || a[k + 3] !== b[k + 3]) n++;
        }
      }
      return n;
    };
    const ticked = new LayerCache(assets);
    ticked.build(data, cols, rows, 0);
    const before = pixels(ticked);
    const area = { x0: 3, y0: 2, x1: 40, y1: 30 };
    const t0 = performance.now();
    const changed = ticked.tick(data, t1, area);
    const ms = performance.now() - t0;
    const fresh = new LayerCache(assets);
    fresh.build(data, cols, rows, t1);
    const after = pixels(ticked);
    const inside = diff(after, pixels(fresh), area);
    const outsideKept = diff(after, before) - diff(after, before, area);
    ticked.tick(data, t1, undefined); // nothing flipped since: no work
    const again = ticked.tick(data, t1 + 0.001);
    return { t1, changed, ms, inside, outsideKept, again, animatedChanged: diff(before, pixels(fresh)) > 0 };
  });
  t.log('animated tile tick vs full redraw', anim);
  t.assert(anim.changed && anim.animatedChanged && anim.inside === 0, `a tick paints the cells in view exactly like a full redraw (${JSON.stringify(anim)})`);
  t.assert(anim.outsideKept === 0 && anim.again === false, 'cells out of view are left alone and a tick with no flip does nothing');

  // ---- world overview: far-apart rooms keep the canvas small and redraws quick
  await page.click('.qf-map-right .qf-tab:has-text("Room")');
  await t.wait(150);
  await page.fill('.qf-map-right input[data-key="gx"]', '3000');
  await page.press('.qf-map-right input[data-key="gx"]', 'Enter');
  await t.wait(200);
  const clamped = await t.eval(() => window.__qf.editor.ctx.room().gx);
  t.assert(clamped === 256, `the X position is limited to the grid (${clamped})`);
  const far = await t.eval(async () => {
    const ctx = window.__qf.editor.ctx;
    const w = ctx.project.worlds[0];
    const { buildRoom } = await import('/src/editor/map/roomOps.ts');
    // As a crafted import could have it: rooms 20000 screens apart.
    w.rooms.push(buildRoom({ name: 'Far', gx: 20000, gy: 20000, gw: 1, gh: 1, floor: 0, fill: 1, walls: null }));
    const t0 = performance.now();
    ctx.changed('rooms');
    await new Promise((r) => requestAnimationFrame(() => r()));
    const refresh = performance.now() - t0;
    const canvas = document.querySelector('.qf-map-overview__canvas');
    const box = document.querySelector('.qf-map-overview');
    const rect = canvas.getBoundingClientRect();
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 5 + i * 7, clientY: rect.top + 5 + i * 3, bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r()));
    const hover = performance.now() - t1;
    box.scrollTop = box.scrollHeight;
    box.scrollLeft = box.scrollWidth;
    await new Promise((r) => requestAnimationFrame(() => r()));
    const px = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return { refresh, hover, w: canvas.width, h: canvas.height, boxW: box.clientWidth, scrollW: box.scrollWidth, px: [...px] };
  });
  t.log('overview with rooms 20000 screens apart', far);
  await t.shot('overview-far');
  t.assert(far.w <= far.boxW + 2 && far.h <= 400, `the overview canvas stays viewport-sized (${far.w}x${far.h})`);
  t.assert(far.scrollW > 100000, `the panel still scrolls across the whole grid (${far.scrollW})`);
  t.assert(far.refresh < 500 && far.hover < 500, `refresh and hover stay quick (${Math.round(far.refresh)} / ${Math.round(far.hover)} ms)`);
  t.assert(far.px[3] === 255, `the far corner still draws (${far.px})`);

  // Opened like that (e.g. an imported file): the first layout is small too.
  await blur(t);
  await page.keyboard.press('Control+s');
  await t.until(() => !window.__qf.editor.autosave.pending, null, 4000);
  await page.reload();
  await page.waitForFunction(() => window.__qf && window.__qf.ready && window.__qf.editor, null, { timeout: 15000 });
  await t.wait(300);
  const reopened = await t.eval(() => {
    const canvas = document.querySelector('.qf-map-overview__canvas');
    return { w: canvas.width, h: canvas.height, boxW: document.querySelector('.qf-map-overview').clientWidth };
  });
  t.assert(reopened.w <= reopened.boxW + 2 && reopened.h <= 400, `reopening keeps the overview canvas small (${JSON.stringify(reopened)})`);
}
