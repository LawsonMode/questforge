// Player edge cases: the sword's downward reach against a soldier's body, a
// pot / a charged sword / a dash carried through an edge scroll, attacks at an
// open room edge (air, not a wall), the hookshot pull sliding round a block
// corner, a bomb dropped over a pit, a charged blade poking a wall, and a dash
// re-aimed during its wind-up.
// Each section retries from scratch when the page reloads under it (the dev
// server reloads on every file save); its checks count only once it completes.

// ---------------------------------------------------------------- helpers
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyZ', 'KeyX', 'KeyC'];

async function section(t, name, fn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const checks = [];
    try {
      await fn((cond, msg) => checks.push([cond, msg]));
      for (const [cond, msg] of checks) t.assert(cond, `${name}: ${msg}`);
      return;
    } catch (e) {
      t.log(`section ${name}: attempt ${attempt} interrupted (${String(e).slice(0, 140)})`);
      await Promise.all(KEYS.map((k) => t.page.keyboard.up(k))).catch(() => {});
      t.booted = false;
      await t.wait(1000);
    }
  }
  t.assert(false, `section ${name} could not complete (the page kept reloading)`);
}

async function recordSfx(t) {
  await t.eval(() => {
    const s = window.__qf.game.services;
    window.__sfx = [];
    // The audio object is shared by every game in the page: wrap it once.
    if (!s.audio.__recorded) {
      s.audio.__recorded = true;
      const sfx = s.audio.sfx.bind(s.audio);
      s.audio.sfx = (id, o) => { window.__sfx.push(id); sfx(id, o); };
    }
  });
}

async function boot(t) {
  if (t.booted) return;
  await t.goto('#/');
  // Let the app shell finish mounting its menu, or it may replace the first arena.
  await t.wait(600);
  t.booted = true;
}

/** The running game survives a moment (the shell or a dev-server reload did not replace it). */
async function settled(t, check) {
  await t.wait(250);
  if (!(await t.eval(check))) return false;
  await t.wait(200);
  return t.eval(check);
}

async function start(t, fn, cfg, check) {
  await boot(t);
  for (let i = 0; i < 4; i++) {
    await t.eval(fn, cfg);
    if (await settled(t, check)) {
      await recordSfx(t);
      return;
    }
  }
  throw new Error('the arena did not start');
}

const arena = (t, cfg) => start(
  t,
  async (c) => (await import('/src/dev/arena.ts')).startArena(c),
  cfg,
  () => !!window.__qf.game?.services && !!document.querySelector('canvas.qf-game-canvas'),
);

/** A grass arena with an identical empty room east of it (an open edge shared by two screens). */
const twoRooms = (t, cfg) => start(
  t,
  async (c) => {
    const { buildArenaProject } = await import('/src/dev/arena.ts');
    const { Game } = await import('/src/game/game.ts');
    const project = buildArenaProject({ theme: 'grass', ...c });
    const east = structuredClone(project.worlds[0].rooms[0]);
    Object.assign(east, { id: 'room2', name: 'Room 2', gx: 1, entities: [] });
    project.worlds[0].rooms.push(east);
    window.__qf.game?.destroy();
    const root = document.getElementById('app') ?? document.body;
    root.textContent = '';
    const host = document.createElement('div');
    host.className = 'qf-game-host';
    const canvas = document.createElement('canvas');
    canvas.className = 'qf-game-canvas';
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    root.appendChild(host);
    const game = new Game(canvas, project, { mode: 'playtest' });
    window.__qf.game = game;
    game.start();
    canvas.focus();
  },
  cfg,
  () => window.__qf.game?.services?.room.def.id === 'arena_room',
);

/** Freeze gameplay on the first tick after which `src` (an expression over s = services, p = player) holds. */
async function armFreeze(t, src, ms = 4000) {
  await t.eval(({ src: code, ms: limit }) => {
    const s = window.__qf.game.services;
    const proto = Object.getPrototypeOf(s);
    const cond = new Function('s', 'p', `return (${code});`);
    window.__frozen = new Promise((resolve) => {
      const timer = setTimeout(() => { delete s.tick; resolve(false); }, limit);
      s.tick = (dt) => {
        proto.tick.call(s, dt);
        if (cond(s, s.player)) {
          clearTimeout(timer);
          s.tick = () => {};
          resolve(true);
        }
      };
    });
  }, { src, ms });
}
const frozen = (t) => t.eval(() => window.__frozen);
const thaw = (t) => t.eval(() => { delete window.__qf.game.services.tick; });
const sfx = (t) => t.eval(() => window.__sfx);
const equip = (t, item) => t.eval((it) => { window.__qf.game.services.save.equipped = it; }, item);
const hero = (t) => t.eval(() => {
  const s = window.__qf.game.services;
  const p = s.player;
  return { room: s.room.def.id, x: +p.x.toFixed(1), y: +p.y.toFixed(1), st: p.state, facing: p.facing, anim: p.anim };
});
/** Wait (in page) until `src` holds, up to `ms`; throws if the game went away meanwhile. */
const waitFor = (t, src, ms = 3000) => t.eval(({ src: code, ms: limit }) => new Promise((res, rej) => {
  const cond = new Function('s', 'p', `return (${code});`);
  const t0 = performance.now();
  const check = () => {
    const s = window.__qf?.game?.services;
    if (!s) rej(new Error('the game went away'));
    else if (cond(s, s.player)) res(true);
    else if (performance.now() - t0 > limit) res(false);
    else requestAnimationFrame(check);
  };
  check();
}), { src, ms });

/** Freeze when `src` holds (after `act`), screenshot, thaw. Returns whether it froze. */
async function shotAt(t, name, src, act, ms) {
  await armFreeze(t, src, ms);
  if (act) await act();
  const ok = await frozen(t);
  await t.shotCanvas(name);
  await thaw(t);
  return ok;
}

const down = (t, ...keys) => Promise.all(keys.map((k) => t.page.keyboard.down(k)));
const up = (t, ...keys) => Promise.all(keys.map((k) => t.page.keyboard.up(k)));
const SCROLLING = "s.mode === 'transition' && s.transition && s.transition.progress > 0.45";

// ---------------------------------------------------------------- scenario
export default async function (t) {
  await section(t, 'reach down', async (check) => {
    // Facing down, the blade reaches a soldier whose feet are 16 px below the hero's (its body is hit, not just its feet).
    // The soldier guards its post facing away (it never turns to the hero above), so it is still in
    // reach however long the harness takes; the stun is only a second line of defence.
    await arena(t, {
      theme: 'dungeon', player: { x: 128, y: 90, dir: 'down' },
      entities: [{ id: 'sol', type: 'enemy.soldier', x: 128, y: 118, props: { drop: 'none', behavior: 'guard', facing: 'down' } }],
    });
    await t.eval(() => { window.__qf.game.services.findEntity('sol').stun = 30; });
    const post = await t.eval(() => { const e = window.__qf.game.services.findEntity('sol'); return { x: e.x, y: e.y }; });
    check(Math.abs(post.x - 128) < 1 && Math.abs(post.y - 118) < 1, `the soldier is still at its post (${JSON.stringify(post)})`);
    const hp0 = await t.eval(() => window.__qf.game.services.findEntity('sol').hp);
    check(await shotAt(t, 'reach-down-hit', "p.state === 'attack' && p.swordRect() && s.findEntity('sol').hitFlash > 0", () => t.press('KeyZ', 60)), 'froze on the hit');
    await t.wait(300);
    const hp1 = await t.eval(() => window.__qf.game.services.findEntity('sol')?.hp ?? 0);
    check(hp1 < hp0, `down swing hit the soldier 16 px below (${hp0} -> ${hp1})`);
  });

  await section(t, 'carry scroll', async (check) => {
    // Carrying a pot through an edge scroll: overhead the whole way.
    await twoRooms(t, { player: { x: 222, y: 120, dir: 'right' }, entities: [{ id: 'pot', type: 'obj.pot', x: 240, y: 120 }] });
    await t.press('KeyX', 60);
    check(await waitFor(t, "p.state === 'carry'"), 'pot lifted');
    await down(t, 'ArrowRight');
    await armFreeze(t, SCROLLING);
    const scrolled = await frozen(t);
    await up(t, 'ArrowRight');
    check(scrolled, 'froze mid-scroll with the pot');
    const potMid = await t.eval(() => {
      const s = window.__qf.game.services;
      const c = s.player.carrying;
      return c ? { x: c.x, y: c.y, px: s.player.x, py: s.player.y, inRoom: s.entities.includes(c) } : null;
    });
    t.log('pot mid-scroll', potMid);
    check(potMid && potMid.x === potMid.px && potMid.y === potMid.py && potMid.inRoom, 'pot moved with the hero into the new room');
    await t.shotCanvas('carry-mid-scroll');
    await thaw(t);
    check(await waitFor(t, "s.mode === 'playing' && s.room.def.id === 'room2' && p.state === 'carry'"), 'still carrying in room 2');
  });

  await section(t, 'charge scroll', async (check) => {
    // A charged sword through an edge scroll: still charged on arrival, releasing spins.
    await twoRooms(t, { player: { x: 200, y: 120, dir: 'right' } });
    await down(t, 'KeyZ');
    check(await waitFor(t, "p.state === 'charge' && s.input.heldTime('b') > 0.9"), 'charged');
    await down(t, 'ArrowRight');
    await armFreeze(t, SCROLLING, 5000);
    const scrolled = await frozen(t);
    await up(t, 'ArrowRight');
    check(scrolled, 'froze mid-scroll with the charged sword');
    await t.shotCanvas('charge-mid-scroll');
    await thaw(t);
    check(await waitFor(t, "s.mode === 'playing' && s.room.def.id === 'room2'"), 'arrived in room 2');
    const arrived = await hero(t);
    t.log('charged on arrival', arrived);
    check(arrived.st === 'charge', `still charging after the scroll (${arrived.st})`);
    await recordSfx(t);
    await up(t, 'KeyZ');
    check(await waitFor(t, "p.state === 'spin'", 1000), 'released into a spin');
    check((await sfx(t)).includes('swordSpin'), 'spin sound');
  });

  await section(t, 'open edge', async (check) => {
    // The shared edge is open air: no tink, the arrow flies off the screen, the boomerang turns back quietly.
    await twoRooms(t, { items: { bow: 1, arrows: 5, boomerang: 1 }, player: { x: 244, y: 120, dir: 'right' } });
    await t.press('KeyZ', 60);
    await t.wait(400);
    await equip(t, 'bow');
    check(await shotAt(t, 'arrow-leaving', "s.entities.some((e) => e.type === 'arrow' && e.x > 254)", () => t.press('KeyC', 50)), 'froze with the arrow at the edge');
    check(await waitFor(t, "!s.entities.some((e) => e.type === 'arrow')", 1000), 'arrow gone off the screen');
    await t.eval(() => window.__qf.game.services.player.place(200, 120, 'right'));
    await equip(t, 'boomerang');
    await t.press('KeyC', 50);
    check(await waitFor(t, "!s.entities.some((e) => e.type === 'boomerang')", 3000), 'boomerang back');
    const edgeSfx = await sfx(t);
    t.log('edge sounds', edgeSfx);
    check(!edgeSfx.includes('swordTink') && !edgeSfx.includes('arrowHit'), 'no tink or arrow-hit at the open edge');
  });

  await section(t, 'hookshot corner', async (check) => {
    // Hookshot pull past a block corner the claw slipped by: the hero slides round it, never inside it.
    await arena(t, {
      theme: 'dungeon', items: { hookshot: 1 }, player: { x: 128, y: 184, dir: 'up' },
      tiles: [{ layer: 'bg', tx: 5, ty: 8, w: 6, h: 3, tile: 'PIT' }],
      entities: [
        { id: 'chest', type: 'obj.chest', x: 128, y: 56, props: { item: 'rupees', amount: 5 } },
        { id: 'blk', type: 'obj.block', x: 116, y: 104 },
      ],
    });
    await equip(t, 'hookshot');
    // Count ticks with the hero inside the block, freezing once beside it for a screenshot.
    await t.eval(() => {
      const s = window.__qf.game.services;
      const proto = Object.getPrototypeOf(s);
      window.__clip = 0;
      window.__hold = 'armed';
      s.tick = (dt) => {
        if (window.__hold === 'frozen') return;
        proto.tick.call(s, dt);
        const a = s.player.hitbox();
        const b = s.findEntity('blk').hitbox();
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) window.__clip++;
        if (window.__hold === 'armed' && s.player.state === 'hookshot' && s.player.y < 110) window.__hold = 'frozen';
      };
    });
    await t.press('KeyC', 50);
    check(await waitFor(t, "window.__hold === 'frozen'"), 'pulled past the block');
    await t.shotCanvas('hookshot-slide-by-block');
    await t.eval(() => { window.__hold = 'done'; });
    check(await waitFor(t, "p.state === 'normal'"), 'pull finished');
    await t.eval(() => { delete window.__qf.game.services.tick; });
    const pulled = await hero(t);
    const clips = await t.eval(() => window.__clip);
    t.log('after the pull', pulled, 'ticks inside the block', clips);
    check(clips === 0, `never inside the block (${clips} ticks)`);
    check(Math.abs(pulled.y - 70) < 1.5, `landed below the chest (y=${pulled.y})`);
    await t.shotCanvas('hookshot-landed');
  });

  await section(t, 'bomb over pit', async (check) => {
    // A bomb placed over a pit drops in: no blast.
    await arena(t, {
      theme: 'dungeon', items: { bombs: 3 }, player: { x: 128, y: 150, dir: 'up' },
      tiles: [{ layer: 'bg', tx: 7, ty: 7, w: 2, h: 2, tile: 'PIT' }],
    });
    await equip(t, 'bombs');
    await t.press('KeyC', 50);
    await t.wait(2500);
    const bombs = await t.eval(() => ({ left: window.__qf.game.services.save.bombs, live: window.__qf.game.services.entities.filter((e) => e.type === 'bomb').length }));
    t.log('bomb over the pit', bombs, await sfx(t));
    check(bombs.left === 2 && bombs.live === 0, 'bomb used and gone');
    check(!(await sfx(t)).includes('explode'), 'no blast from the pit');
  });

  await section(t, 'charged poke', async (check) => {
    // A charged blade walked into a wall pokes it again and again.
    await arena(t, { theme: 'dungeon', player: { x: 128, y: 70, dir: 'up' } });
    await down(t, 'KeyZ');
    await t.wait(400);
    await down(t, 'ArrowUp');
    check(await shotAt(t, 'charged-poke', "window.__sfx.includes('swordTink') && p.state === 'charge'"), 'froze on the first poke');
    await t.wait(1200);
    await up(t, 'ArrowUp', 'KeyZ');
    const tinks = (await sfx(t)).filter((id) => id === 'swordTink').length;
    t.log('pokes', tinks);
    check(tinks >= 3, `the held blade poked the wall repeatedly (${tinks})`);
  });

  await section(t, 'dash re-aim', async (check) => {
    // The dash wind-up can be re-aimed: press left while running in place.
    await arena(t, { theme: 'dungeon', items: { boots: 1 }, player: { x: 160, y: 120, dir: 'up' } });
    await down(t, 'KeyX');
    await t.wait(100);
    await down(t, 'ArrowLeft');
    check(await shotAt(t, 'dash-reaimed', "p.state === 'dash' && p.x < 140"), 'froze mid-dash');
    const dashed = await hero(t);
    await up(t, 'ArrowLeft', 'KeyX');
    t.log('re-aimed dash', dashed);
    check(dashed.facing === 'left' && Math.abs(dashed.y - 120) < 0.5, 'dashed left, not up');
  });
}
