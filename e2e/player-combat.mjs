// Player combat: sword kills a slime, cutting bushes & tall grass, charge +
// spin attack, dashing into a wall (bonk). Screens are frozen on exact ticks
// (see armFreeze) so each screenshot shows the moment it names.
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
const player = (t) => t.eval(() => {
  const p = window.__qf.game.services.player;
  return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), st: p.state, facing: p.facing, anim: p.anim };
});

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
  await section(t, 'sword vs slime', async (check) => {
    // Swing from below until it dies.
    await arena(t, {
      theme: 'dungeon', player: { x: 128, y: 150, dir: 'up' },
      entities: [{ id: 'slime', type: 'enemy.slime', x: 128, y: 100, props: { split: false } }],
    });
    check(await t.eval(() => !!window.__qf.game.services.findEntity('slime')), 'enemy.slime is registered');
    await shotAt(t, check, 'swing-mid', "p.st === 'attack' && p.stT >= 0.06", async () => {
      await t.eval(() => {
        const s = window.__qf.game.services;
        const e = s.findEntity('slime');
        e.stun = 1;
        s.player.place(e.x, e.y + 18, 'up');
      });
      await t.press('KeyZ', 50);
    });
    let dead = false;
    for (let i = 0; i < 8 && !dead; i++) {
      await t.wait(350);
      const hp = await t.eval(() => {
        const s = window.__qf.game.services;
        const e = s.findEntity('slime');
        if (!e) return 0;
        e.stun = 1;
        s.player.place(e.x, e.y + 18, 'up');
        return e.hp;
      });
      if (hp <= 0) break;
      if (hp > 1) {
        await t.press('KeyZ', 50);
        continue;
      }
      // The killing blow: freeze while the poof plays.
      dead = await shotAt(t, check, 'slime-poof', "!s.findEntity('slime') && s.entities.some((e) => e.sprite === 'fx.poof' && e.animT > 0.07)", () => t.press('KeyZ', 50));
    }
    check(dead, 'slime killed with the sword');
  });

  await section(t, 'cutting', async (check) => {
    // Cut bushes and tall grass (sweep facing left, then down).
    await arena(t, {
      theme: 'grass', player: { x: 128, y: 120, dir: 'left' },
      tiles: [
        { tx: 6, ty: 7, tile: 'BUSH' }, { tx: 6, ty: 6, tile: 'BUSH' },
        { layer: 'bg', tx: 7, ty: 8, w: 3, h: 2, tile: 'TALL_GRASS' },
      ],
    });
    await shotAt(t, check, 'cut-bush-leaves', "p.st === 'attack' && p.stT >= 0.12", () => t.press('KeyZ', 50));
    await t.wait(300);
    await t.press('ArrowDown', 30);
    await t.wait(50);
    await t.press('KeyZ', 50);
    await t.wait(400);
    const cut = await t.eval(() => {
      const r = window.__qf.game.services.room;
      return { bush: r.tile('fg', 6, 7), grass: [r.tile('bg', 7, 8), r.tile('bg', 8, 8)] };
    });
    t.log('after cutting', cut);
    check(cut.bush === 1, 'bush in front was cut to grass');
    check(cut.grass.includes(1), 'tall grass below was cut');
    check((await sfx(t)).includes('cut'), 'cut sound');
    await t.shotCanvas('cut-result');
  });

  await section(t, 'charge and spin', async (check) => {
    // Bushes appear all around once charged (so the opening swing can't cut them).
    await arena(t, {
      theme: 'grass', player: { x: 120, y: 120, dir: 'down' },
      entities: [{ id: 'slime', type: 'enemy.slime', x: 120, y: 160, props: { drop: 'none', split: false } }],
    });
    await t.eval(() => { window.__qf.game.services.findEntity('slime').stun = 30; });
    await t.page.keyboard.down('KeyZ');
    await shotAt(t, check, 'charged-sparkle', 'p.charged === true && p.stT > 0.2', () => t.wait(50));
    await t.eval(() => {
      const room = window.__qf.game.services.room;
      for (const [tx, ty] of [[7, 6], [7, 8], [6, 7], [8, 7]]) room.setTile('fg', tx, ty, 6);
    });
    await armFreeze(t, "p.st === 'spin' && p.stT >= 0.16");
    await t.page.keyboard.up('KeyZ');
    check(await frozen(t), 'spin started on release');
    await t.shotCanvas('spin-mid');
    await thaw(t);
    await t.wait(500);
    const spin = await t.eval(() => {
      const r = window.__qf.game.services.room;
      return [r.tile('fg', 7, 6), r.tile('fg', 7, 8), r.tile('fg', 6, 7), r.tile('fg', 8, 7)];
    });
    t.log('bush tiles after spin (1 = cut)', spin);
    check(spin.every((id) => id === 1), 'spin cut the bushes on all four sides');
    check((await sfx(t)).includes('swordSpin'), 'spin sound');
    await t.shotCanvas('spin-after');
  });

  await section(t, 'dash bonk', async (check) => {
    await arena(t, { theme: 'dungeon', items: { boots: 1 }, player: { x: 128, y: 190, dir: 'up' } });
    await t.page.keyboard.down('KeyX');
    await shotAt(t, check, 'dash-windup', "p.st === 'dash' && p.stT >= 0.2");
    await shotAt(t, check, 'dash-run', "p.st === 'dash' && p.dashPhase === 'run' && p.y < 130");
    await shotAt(t, check, 'dash-bonk', "p.st === 'hurt'");
    await t.page.keyboard.up('KeyX');
    await t.wait(300);
    const after = await player(t);
    t.log('after bonk', after, (await sfx(t)).filter((x) => x === 'dash' || x === 'hit'));
    check(after.st === 'normal' && after.y > 24, 'bonked back and recovered');
    check((await sfx(t)).includes('hit'), 'bonk sound');
  });
}
