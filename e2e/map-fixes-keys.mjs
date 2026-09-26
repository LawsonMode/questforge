// Map tab review fixes, interaction side, on #/edit/sample: Room-tab edits keep
// keyboard focus (and arrowing through the music list is one undo step), the
// worlds list and the world overview work from the keyboard, the Room tab
// stays on the room a pit pick is for, trackpad scrolling pans while wheel
// notches and pinches zoom, and the status bar follows edits under a still cursor.

const holdHmr = (t) => t.page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      if (args[1] !== 'vite-hmr') return new target(...args);
      return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} });
    },
  });
});

/** Room pixel under a client point, read from the status bar (null off the room). */
async function pixelAt(t, x, y) {
  await t.page.mouse.move(x, y);
  await t.wait(40);
  return t.eval(() => {
    const text = [...document.querySelectorAll('.qf-map-status__item')].map((e) => e.textContent).join('|');
    const m = /(-?\d+), (-?\d+) px/.exec(text);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
}

const select = (t, world, room) => t.eval(([w, r]) => window.__qf.editor.ctx.selectRoom(w, r), [world, room]);
const sel = (t) => t.eval(() => ({ w: window.__qf.editor.ctx.worldId, r: window.__qf.editor.ctx.roomId }));
const focused = (t) => t.eval(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, key: a?.dataset?.key ?? null, world: a?.dataset?.world ?? null, cls: a?.className ?? '' };
});
const undoLabel = (t) => t.eval(() => window.__qf.editor.ctx.undo.peekUndo());
const zoom = (t) => t.eval(() => document.querySelector('.qf-map-zoom__label').textContent);

export default async function (t) {
  await holdHmr(t);
  const { page } = t;
  await t.goto('#/edit/sample');
  await t.until(() => document.querySelector('.qf-map-canvas')?.width > 0);
  await t.wait(300);

  // ---- Room tab: focus survives edits; arrowing through the music list is one undo step
  await select(t, 'hollow_keep', 'kp_guard_hall');
  await page.click('.qf-map-right .qf-tab >> text=Room');
  await t.wait(150);
  await page.locator('.qf-map-props [data-key="dark"]').focus();
  await page.keyboard.press('Space');
  await t.wait(80);
  t.assert((await focused(t)).key === 'dark', `Space on "Dark room" keeps focus there (${JSON.stringify(await focused(t))})`);
  t.assert(await t.eval(() => window.__qf.editor.ctx.room().dark === true), 'and made the room dark');
  await page.locator('.qf-map-props [data-key="music"]').focus();
  const labelBefore = await undoLabel(t);
  const depth = await t.eval(() => window.__qf.editor.ctx.undo.done.length);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await t.wait(60);
  }
  t.assert((await focused(t)).key === 'music', 'the music list keeps focus while arrowing');
  const steps = await t.eval(() => window.__qf.editor.ctx.undo.done.length);
  t.assert(steps === depth + 1 && await undoLabel(t) === 'Room music', `three music changes are one undo step (${depth} -> ${steps}, before: ${labelBefore})`);
  const name = page.locator('.qf-map-props [data-key="name"]');
  await name.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' II');
  await page.keyboard.press('Tab');
  await t.wait(80);
  const afterTab = await focused(t);
  t.assert(afterTab.key === 'gw', `Tab from Name lands on the width select (${JSON.stringify(afterTab)})`);
  t.assert(await t.eval(() => window.__qf.editor.ctx.room().name) === 'Guard Hall II', 'the rename applied');
  await t.shot('room-tab-focus');

  // ---- worlds list from the keyboard
  await page.locator('.qf-map-world--active').focus();
  t.assert((await focused(t)).world === 'hollow_keep', 'the shown world is the list\'s Tab stop');
  await page.keyboard.press('Home');
  t.assert((await focused(t)).world === 'ellendor', 'Home goes to the first world');
  await page.keyboard.press('ArrowDown');
  t.assert((await focused(t)).world === 'ellendor_homes', 'ArrowDown moves focus');
  await page.keyboard.press('Enter');
  await t.wait(150);
  t.assert((await sel(t)).w === 'ellendor_homes', 'Enter opens the focused world');
  t.assert((await focused(t)).world === 'ellendor_homes', 'focus stays on its row after the list re-renders');
  await page.keyboard.press('Tab');
  t.assert((await focused(t)).cls.includes('qf-map-world__more'), `Tab reaches the row's actions button (${(await focused(t)).cls})`);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+F10');
  await t.until(() => !!document.querySelector('.qf-map-menu'));
  await t.shot('world-menu-keyboard');
  await page.keyboard.press('Escape');
  await t.wait(50);
  t.assert((await focused(t)).world === 'ellendor_homes', 'Escape returns focus to the row');
  await page.keyboard.press('Alt+ArrowUp');
  await t.wait(100);
  t.assert(await t.eval(() => window.__qf.editor.ctx.project.worlds[0].id) === 'ellendor_homes', 'Alt+ArrowUp moves the world up');
  t.assert((await focused(t)).world === 'ellendor_homes', 'and keeps focus on it');
  await page.keyboard.press('Control+z');
  await t.wait(100);
  t.assert(await t.eval(() => window.__qf.editor.ctx.project.worlds[1].id) === 'ellendor_homes', 'Ctrl+Z on the list undoes the reorder');
  await page.keyboard.press('F2');
  await t.until(() => !!document.querySelector('.qf-modal input'));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Homes');
  await page.keyboard.press('Enter');
  await t.wait(120);
  t.assert(await t.eval(() => window.__qf.editor.ctx.world().name) === 'Homes', 'F2 renames the world');
  t.assert((await focused(t)).world === 'ellendor_homes', 'focus comes back to the row after the dialog');

  // ---- world overview from the keyboard
  await select(t, 'hollow_keep', 'kp_entrance');
  await t.wait(150);
  const overview = page.locator('.qf-map-overview__canvas');
  await overview.focus();
  const rooms = await t.eval(() => Object.fromEntries(window.__qf.editor.ctx.world().rooms.map((r) => [r.id, [r.gx, r.gy, r.floor]])));
  await page.keyboard.press('ArrowUp');
  await t.wait(100);
  const up = (await sel(t)).r;
  t.assert(up !== 'kp_entrance' && rooms[up][1] < rooms.kp_entrance[1], `ArrowUp selects the room above (${up})`);
  await page.keyboard.press('ArrowDown');
  await t.wait(100);
  t.assert((await sel(t)).r === 'kp_entrance', 'ArrowDown comes back');
  await page.keyboard.press('Alt+ArrowDown');
  await t.wait(100);
  const moved = await t.eval(() => window.__qf.editor.ctx.room().gy);
  t.assert(moved === rooms.kp_entrance[1] + 1, `Alt+ArrowDown moves the room one screen down (${rooms.kp_entrance[1]} -> ${moved})`);
  await page.keyboard.press('Control+z');
  await t.wait(100);
  t.assert(await t.eval(() => window.__qf.editor.ctx.room().gy) === rooms.kp_entrance[1], 'undo puts it back');
  t.assert((await focused(t)).cls.includes('qf-map-overview__canvas'), 'the overview keeps focus');
  await t.shot('overview-keyboard');

  // ---- a pit pick keeps the Room tab on its room and names it
  await page.click('.qf-map-right .qf-tab >> text=Room');
  await t.wait(100);
  await page.click('.qf-map-props [data-key="pick"]');
  await t.wait(100);
  const banner = await t.eval(() => document.querySelector('.qf-map-pick').textContent);
  t.assert(banner.includes('Entrance Hall'), `the canvas banner names the room (${banner})`);
  await select(t, 'hollow_keep', 'kp_guard_hall');
  await t.wait(150);
  const pinned = await t.eval(() => ({
    title: document.querySelector('.qf-map-props__title')?.textContent,
    notice: document.querySelector('.qf-map-props__picking')?.textContent ?? '',
  }));
  t.assert(pinned.title === 'Entrance Hall' && pinned.notice.includes('Entrance Hall'), `the Room tab stays on the room being edited (${JSON.stringify(pinned)})`);
  await t.shot('pick-pinned');
  await page.keyboard.press('Escape');
  await t.wait(100);
  t.assert(await t.eval(() => !document.querySelector('.qf-map-props__picking') && document.querySelector('.qf-map-props__title')?.textContent !== 'Entrance Hall'),
    'Esc ends the pick and the tab follows the selection again');

  // ---- wheel: trackpad scrolling pans, mouse notches and pinches zoom
  await select(t, 'hollow_keep', 'kp_beetle_pits');
  await t.wait(200);
  const box = await page.locator('.qf-map-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const z0 = await zoom(t);
  const p0 = await pixelAt(t, cx, cy);
  await t.eval(([x, y]) => {
    const c = document.querySelector('.qf-map-canvas');
    for (let i = 0; i < 4; i++) c.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaX: 12, deltaY: 6, deltaMode: 0, bubbles: true, cancelable: true }));
  }, [cx, cy]);
  await t.wait(60);
  const p1 = await pixelAt(t, cx, cy);
  t.assert(await zoom(t) === z0 && p1.x > p0.x && p1.y > p0.y, `a two-finger scroll pans without zooming (${JSON.stringify([z0, p0, p1])})`);
  await page.mouse.wheel(0, -100);
  await t.wait(60);
  const z1 = await zoom(t);
  t.assert(z1 !== z0, `a mouse wheel notch zooms (${z0} -> ${z1})`);
  await t.eval(([x, y]) => {
    const c = document.querySelector('.qf-map-canvas');
    for (let i = 0; i < 6; i++) c.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: 9, ctrlKey: true, deltaMode: 0, bubbles: true, cancelable: true }));
  }, [cx, cy]);
  await t.wait(60);
  t.assert(await zoom(t) === z0, `a pinch (ctrl + small deltas) zooms back out (${await zoom(t)})`);

  // ---- the status bar follows a click edit under a still cursor
  await page.click('.qf-map-status');
  await page.keyboard.press('p');
  const T = await t.eval(async () => (await import('/src/content/ids.ts')).T);
  await t.eval((sand) => window.__qf.editor.ctx.selectTile(sand), T.SAND);
  await page.mouse.move(cx, cy);
  await t.wait(50);
  await page.mouse.down();
  await page.mouse.up();
  await t.wait(80);
  const tileText = await t.eval(() => document.querySelector('.qf-map-status__tile').textContent);
  t.assert(tileText.startsWith('Sand'), `the status bar shows the painted tile without moving the mouse (${tileText})`);
  await page.keyboard.press('Control+z');
  await t.wait(80);
  t.assert(!(await t.eval(() => document.querySelector('.qf-map-status__tile').textContent)).startsWith('Sand'), 'and the restored tile after undo');

  // ---- the keys reference lists the new keyboard controls
  await page.click('.qf-map-tool--text');
  await t.until(() => !!document.querySelector('.qf-map-help'));
  const sections = await t.eval(() => [...document.querySelectorAll('.qf-map-help__title')].map((h) => h.textContent));
  t.assert(sections.includes('Worlds & overview'), `the help lists the worlds & overview keys (${sections})`);
  await t.shot('help');
  await page.keyboard.press('Escape');
}
