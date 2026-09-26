// Player lift / carry / throw / push: a placed pot (obj.pot) lifted, carried
// and thrown into a soldier; a bush tile and a dungeon pot tile lifted
// (ground masked out overhead) and thrown against walls; a push block pushed.
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
  await section(t, 'placed pot', async (check) => {
    // Lift, carry, throw into a stunned soldier (the hero stands right below the pot).
    await arena(t, {
      theme: 'dungeon', player: { x: 128, y: 142, dir: 'up' },
      entities: [
        { id: 'pot', type: 'obj.pot', x: 128, y: 128, props: { contents: 'rupee5' } },
        { id: 'sol', type: 'enemy.soldier', x: 128, y: 84, props: { drop: 'none' } },
      ],
    });
    check(await t.eval(() => !!window.__qf.game.services.findEntity('pot')), 'obj.pot is registered');
    const solHp0 = await t.eval(() => {
      const sol = window.__qf.game.services.findEntity('sol');
      sol.stun = 30;
      return sol.hp;
    });
    await shotAt(t, check, 'pot-lifting', "p.state === 'lift' && p.stT >= 0.1", () => t.press('KeyX', 50));
    await t.wait(300);
    const carrying = await t.eval(() => window.__qf.game.services.player.state);
    check(carrying === 'carry', `carrying the pot (${carrying})`);
    await t.hold(['ArrowLeft'], 120);
    await t.hold(['ArrowRight'], 120);
    await t.hold(['ArrowUp'], 30);
    await t.shotCanvas('pot-overhead');
    await shotAt(t, check, 'pot-in-flight', "p.carrying === null && s.entities.some((e) => e.type === 'thrown' && e.isFlying && e.y < p.y - 24)", () => t.press('KeyX', 50));
    const hit = await t.eval(() => new Promise((res, rej) => {
      const t0 = performance.now();
      const check = () => {
        const s = window.__qf?.game?.services;
        if (!s) {
          rej(new Error('the game went away'));
          return;
        }
        const sol = s.findEntity('sol');
        const flying = s.entities.some((e) => e.type === 'thrown' && !e.dead);
        if (!flying || performance.now() - t0 > 2000) res({ solHp: sol ? sol.hp : 0, flying });
        else requestAnimationFrame(check);
      };
      check();
    }));
    t.log('after the throw', hit);
    check(!hit.flying, 'thrown pot broke');
    check(hit.solHp < solHp0, `thrown pot hurt the soldier (${solHp0} -> ${hit.solHp})`);
    check((await sfx(t)).includes('shatter'), 'shatter sound');
    await t.wait(60);
    await t.shotCanvas('pot-shattered');
  });

  await section(t, 'bush tile', async (check) => {
    // Lift (ground stays behind), carry, throw at a wall.
    await arena(t, { theme: 'grass', walls: true, player: { x: 120, y: 120, dir: 'left' }, tiles: [{ tx: 6, ty: 7, tile: 'BUSH' }] });
    await t.press('KeyX', 50);
    await t.wait(350);
    const lifted = await t.eval(() => {
      const s = window.__qf.game.services;
      return { st: s.player.state, tile: s.room.tile('fg', 6, 7), carrying: s.player.carrying?.info ?? null };
    });
    t.log('bush lifted', lifted);
    check(lifted.st === 'carry' && lifted.tile === 1, 'bush lifted off, grass left behind');
    await t.hold(['ArrowDown'], 250);
    await t.shotCanvas('bush-overhead');
    await t.press('ArrowLeft', 30);
    await shotAt(t, check, 'bush-leaves', "s.entities.some((e) => e.sprite === 'fx.leaves' && e.animT > 0.05)", () => t.press('KeyX', 50));
  });

  await section(t, 'dungeon pot tile', async (check) => {
    await arena(t, {
      theme: 'dungeon', player: { x: 120, y: 120, dir: 'right' },
      tiles: [{ tx: 8, ty: 7, tile: 'DPOT' }],
    });
    await t.press('KeyX', 50);
    await t.wait(350);
    await t.hold(['ArrowUp'], 200);
    await t.shotCanvas('dpot-overhead');
    const potTile = await t.eval(() => window.__qf.game.services.room.tile('fg', 8, 7));
    check(potTile === 200, `pot tile left dungeon floor (${potTile})`);
  });

  await section(t, 'push block', async (check) => {
    await arena(t, {
      theme: 'dungeon', player: { x: 120, y: 150, dir: 'up' },
      entities: [{ id: 'blk', type: 'obj.block', x: 120, y: 120, props: { pushes: 'free' } }],
    });
    check(await t.eval(() => !!window.__qf.game.services.findEntity('blk')), 'obj.block is registered');
    await t.page.keyboard.down('ArrowUp');
    await shotAt(t, check, 'push-pose', "p.state === 'push'");
    await t.wait(700);
    await t.page.keyboard.up('ArrowUp');
    const block = await t.eval(() => {
      const b = window.__qf.game.services.findEntity('blk');
      return b ? { x: b.x, y: b.y } : null;
    });
    t.log('block after pushing', block);
    check(block && block.y <= 104, 'block moved at least one tile up');
    await t.shotCanvas('block-pushed');
  });
}
