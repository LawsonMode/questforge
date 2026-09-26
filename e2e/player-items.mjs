// Player items: arrows into a wall (and an enemy), boomerang out & back
// (stunning a soldier), hookshot to a chest across a pit, a bomb opening a
// cracked wall, the lantern lighting a torch in a dark room, plus the shield
// blocking a spitter's rock.
// Each section retries from scratch when the page reloads under it (the dev
// server reloads on every file save); its checks count only once it completes.

// ---------------------------------------------------------------- helpers (shared shape across player-*)
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

/** The arena survives a moment (the shell or a dev-server reload did not replace it). */
async function settled(t) {
  const running = () => !!window.__qf.game?.services && !!document.querySelector('canvas.qf-game-canvas');
  await t.wait(250);
  if (!(await t.eval(running))) return false;
  await t.wait(200);
  return t.eval(running);
}

async function arena(t, cfg) {
  await boot(t);
  for (let i = 0; i < 4; i++) {
    await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
    if (await settled(t)) {
      await recordSfx(t);
      return;
    }
  }
  throw new Error('the arena did not start');
}

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

/** Freeze when `src` holds (after `act`), screenshot, thaw; checks that it froze. */
async function shotAt(t, check, name, src, act) {
  await armFreeze(t, src);
  if (act) await act();
  const ok = await frozen(t);
  check(ok, `froze for ${name} (${src})`);
  await t.shotCanvas(name);
  await thaw(t);
  return ok;
}

// ---------------------------------------------------------------- scenario
export default async function (t) {
  await section(t, 'bow', async (check) => {
    // An arrow into the wall past a soldier, then one into the soldier.
    await arena(t, {
      theme: 'dungeon', items: { bow: 1, arrows: 10 }, player: { x: 128, y: 170, dir: 'up' },
      entities: [{ id: 'sol', type: 'enemy.soldier', x: 72, y: 60, props: { drop: 'none' } }],
    });
    await equip(t, 'bow');
    await t.eval(() => { window.__qf.game.services.findEntity('sol').stun = 30; });
    await shotAt(t, check, 'arrow-flying', "s.entities.some((e) => e.type === 'arrow' && !e.stuck && e.y < 120)", () => t.press('KeyC', 50));
    check(await waitFor(t, "s.entities.some((e) => e.type === 'arrow' && e.stuck)"), 'arrow stuck in the wall');
    await t.shotCanvas('arrow-stuck');
    const arrows = await t.eval(() => window.__qf.game.services.save.arrows);
    check(arrows === 9, `one arrow used (${arrows} left)`);
    check((await sfx(t)).includes('arrowHit'), 'arrow hit sound');
    await t.wait(400);
    await t.eval(() => window.__qf.game.services.player.place(72, 150, 'up'));
    const solHp = await t.eval(() => window.__qf.game.services.findEntity('sol')?.hp ?? 0);
    await t.press('KeyC', 50);
    await t.wait(500);
    const solAfter = await t.eval(() => window.__qf.game.services.findEntity('sol')?.hp ?? 0);
    check(solAfter < solHp, `arrow hurt the soldier (${solHp} -> ${solAfter})`);
  });

  await section(t, 'boomerang', async (check) => {
    // Out (stuns a soldier) and back.
    await arena(t, {
      theme: 'dungeon', items: { boomerang: 1 }, player: { x: 128, y: 170, dir: 'up' },
      entities: [{ id: 'sol', type: 'enemy.soldier', x: 128, y: 100, props: { drop: 'none' } }],
    });
    await equip(t, 'boomerang');
    await t.eval(() => { window.__qf.game.services.player.invuln = 0; });
    await shotAt(t, check, 'boomerang-out', "s.entities.some((e) => e.type === 'boomerang' && e.y < 140)", () => t.press('KeyC', 50));
    check(await waitFor(t, "(s.findEntity('sol')?.stun ?? 0) > 1"), 'boomerang stunned the soldier');
    // Past the soldier it can only be on its way home: back below it means it is returning.
    await shotAt(t, check, 'boomerang-back', "s.entities.some((e) => e.type === 'boomerang' && e.y > 130)");
    check(await waitFor(t, "!s.entities.some((e) => e.type === 'boomerang')"), 'boomerang caught');
  });

  await section(t, 'hookshot', async (check) => {
    // To a chest across a pit (one row of floor in front of the chest).
    await arena(t, {
      theme: 'dungeon', items: { hookshot: 1 }, player: { x: 120, y: 184, dir: 'up' },
      tiles: [{ layer: 'bg', tx: 5, ty: 5, w: 5, h: 5, tile: 'PIT' }],
      entities: [{ id: 'chest', type: 'obj.chest', x: 120, y: 56, props: { item: 'rupees', amount: 20 } }],
    });
    await equip(t, 'hookshot');
    check(await t.eval(() => !!window.__qf.game.services.findEntity('chest')), 'obj.chest is registered');
    await shotAt(t, check, 'hookshot-chain', "s.entities.some((e) => e.type === 'hookshot' && e.y < 110)", () => t.press('KeyC', 50));
    await shotAt(t, check, 'hookshot-pulled-over-pit', "p.state === 'hookshot' && s.entities.some((e) => e.type === 'hookshot' && e.phase === 'pull') && p.y < 130");
    check(await waitFor(t, "p.state !== 'hookshot'"), 'pull finished');
    const at = await t.eval(() => {
      const s = window.__qf.game.services;
      return { x: s.player.x, y: s.player.y, st: s.player.state };
    });
    t.log('after the pull', at);
    check(at.y > 60 && at.y < 76 && at.st === 'normal', 'hero landed right below the chest');
    await t.wait(300);
    const stood = await t.eval(() => window.__qf.game.services.player.state);
    check(stood === 'normal', `hero stands on the floor in front of the chest (${stood})`);
    await t.shotCanvas('hookshot-arrived');
    await t.press('KeyX', 50);
    await t.wait(400);
    await t.shotCanvas('chest-opened');
  });

  await section(t, 'bomb', async (check) => {
    // Next to a cracked wall.
    await arena(t, {
      theme: 'dungeon', items: { bombs: 3 }, player: { x: 120, y: 40, dir: 'up' },
      tiles: [{ tx: 7, ty: 0, tile: 'CRACKED_WALL' }, { tx: 7, ty: 1, tile: 'CRACKED_WALL' }],
    });
    await equip(t, 'bombs');
    await t.press('KeyC', 50);
    await t.wait(100);
    await t.hold(['ArrowDown'], 500);
    await t.shotCanvas('bomb-fuse');
    await shotAt(t, check, 'bomb-explosion', "s.entities.some((e) => e.sprite === 'fx.explosion' && e.animT > 0.1)");
    await t.wait(500);
    const wall = await t.eval(() => {
      const s = window.__qf.game.services;
      return { tile: s.room.tile('fg', 7, 1), flag: Object.keys(s.save.flags).filter((k) => k.startsWith('tile:')) };
    });
    t.log('after the blast', wall);
    check(wall.tile === 200, 'cracked wall opened into floor');
    check(wall.flag.length > 0, 'opening persisted as a tile flag');
    check((await sfx(t)).includes('explode'), 'explosion sound');
    await t.shotCanvas('wall-opened');
  });

  await section(t, 'lantern', async (check) => {
    // Lights a torch in a dark room.
    await arena(t, {
      theme: 'dungeon', dark: true, items: { lantern: 1 }, player: { x: 138, y: 120, dir: 'right' },
      entities: [{ id: 'torch', type: 'obj.torch', x: 152, y: 120 }, { id: 'torch2', type: 'obj.torch', x: 88, y: 72 }],
    });
    await equip(t, 'lantern');
    await t.shotCanvas('dark-before');
    await shotAt(t, check, 'lantern-flame', "s.entities.some((e) => e.type === 'flame' && e.animT > 0.15)", () => t.press('KeyC', 50));
    await t.wait(400);
    const lit = await t.eval(() => {
      const s = window.__qf.game.services;
      return { light: s.findEntity('torch')?.light ?? -1, magic: s.save.magic };
    });
    t.log('torch after the flame', lit);
    check(lit.light > 0, 'torch lit');
    check((await sfx(t)).includes('lantern'), 'lantern sound');
    await t.shotCanvas('torch-lit');
  });

  await section(t, 'shield', async (check) => {
    // Blocks a spitter's rock from the front.
    await arena(t, {
      theme: 'dungeon', player: { x: 128, y: 170, dir: 'up' },
      entities: [{ id: 'sp', type: 'enemy.spitter', x: 128, y: 60, props: { drop: 'none' } }],
    });
    const blocked = await waitFor(t, "window.__sfx.includes('shield')", 8000);
    const save = await t.eval(() => window.__qf.game.services.save);
    t.log('shield', { blocked, hp: save.hp, max: save.maxHp });
    check(blocked && save.hp === save.maxHp, 'rock blocked by the shield without damage');
  });
}
