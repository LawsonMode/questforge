// Enemies B: shell beetle. Creeps toward the hero and shoves them on contact
// (1 half-heart + knockback); weapons deal no damage but knock it ~48 px back
// with a tink; the moment a knockback carries its centre over a pit it drops in
// (shrink, poof, defeated) - the only way to clear it, so in a room without a
// pit it does not hold the room's enemies-cleared condition. Ledges stop a
// shove like walls do (it never ends up stranded on one).

async function arena(t, cfg) {
  await t.goto('#/');
  await t.eval(async (c) => (await import('/src/dev/arena.ts')).startArena(c), cfg);
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.eval(() => {
    const a = window.__qf.game.services.audio;
    const orig = a.sfx.bind(a);
    window.__sfx = [];
    a.sfx = (id, o) => { window.__sfx.push(id); orig(id, o); };
  });
}

/** A w x h pit (PIT terrain pieces on bg) with its top-left tile at (tx, ty). */
function pit(tx, ty, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = y === 0 ? 'N' : y === h - 1 ? 'S' : '';
      const e = x === 0 ? 'W' : x === w - 1 ? 'E' : '';
      out.push({ layer: 'bg', tx: tx + x, ty: ty + y, tile: n || e ? `PIT_${n}${e}` : 'PIT' });
    }
  }
  return out;
}

const beetle = (t) => t.eval(() => {
  const e = window.__qf.game.services.findEntity('bug');
  return e ? { x: e.x, y: e.y, hp: e.hp, falling: e.falling, mover: e.mover, contact: e.contactDamage } : null;
});

/** Swing the real sword (arena heroes start with one); true if the swing started. */
async function strike(t) {
  await t.press('KeyZ', 60);
  await t.wait(30);
  return t.eval(() => window.__qf.game.services.player.state === 'attack');
}

export default async function (t) {
  // Mock Vite's HMR socket so edits elsewhere in the repo can't reload the page mid-scenario.
  await t.page.routeWebSocket(/./, () => {});
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 184, y: 120, dir: 'left' },
    tiles: pit(3, 6, 3, 3),
    entities: [{ id: 'bug', type: 'enemy.beetle', x: 140, y: 120 }],
  });

  // ---- Creeps toward the hero, then shoves them (1 half-heart).
  await t.wait(1000);
  let b = await beetle(t);
  t.log('creep', b);
  t.assert(b.x > 145, `creeps toward the hero (x ${b.x.toFixed(1)})`);
  t.assert(b.contact === 1, `contact damage 1 once awake (${b.contact})`);
  await t.shotCanvas('creep');
  const heroX0 = await t.eval(() => window.__qf.game.services.player.x);
  await t.until(() => window.__qf.game.services.save.hp < 20, undefined, 4000);
  await t.wait(200);
  const after = await t.eval(() => ({ hp: window.__qf.game.services.save.hp, x: window.__qf.game.services.player.x }));
  t.log('contact', after);
  t.assert(after.hp === 19, `contact costs half a heart (hp=${after.hp})`);
  t.assert(after.x > heroX0 + 8, `hero shoved back (${heroX0.toFixed(1)} -> ${after.x.toFixed(1)})`);
  await t.shotCanvas('shove');

  // ---- A weapon hit: no damage, a tink and a ~48 px slide (floor, no pit yet).
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('bug');
    e.x = 170;
    e.y = 120;
    s.player.place(188, 120, 'left');
    s.debug.invincible = true;
  });
  await t.wait(50);
  t.assert(await strike(t), 'the sword swings');
  await t.wait(450);
  b = await beetle(t);
  const sfx = await t.eval(() => window.__sfx.slice());
  t.log('knocked', b);
  t.assert(b && !b.falling && b.hp === 1, `no damage from the hit (${JSON.stringify(b)})`);
  t.assert(Math.abs(b.x - 122) <= 3, `slides ~48 px (x ${b.x.toFixed(1)})`);
  t.assert(sfx.includes('swordTink'), `tink (${sfx.join(',')})`);
  t.assert(!(await t.eval(() => window.__qf.game.services.enemiesCleared())), 'counts toward clearing the room');
  await t.shotCanvas('knocked');

  // ---- Knocked over the pit: drops in, shrinks, poofs, room cleared.
  await t.eval(() => {
    const s = window.__qf.game.services;
    const e = s.findEntity('bug');
    s.player.place(e.x + 18, e.y, 'left');
  });
  t.assert(await strike(t), 'the sword swings again');
  await t.until(() => window.__qf.game.services.findEntity('bug')?.falling, undefined, 1500);
  await t.wait(150);
  b = await beetle(t);
  t.log('falling', b);
  t.assert(b && b.falling && b.x > 48 && b.x < 96, `dropping into the pit (${JSON.stringify(b)})`);
  t.assert(b && b.contact === 0, 'harmless while falling');
  await t.shotCanvas('falling');
  await t.until(() => !window.__qf.game.services.findEntity('bug'), undefined, 2000);
  t.assert(await t.eval(() => window.__qf.game.services.enemiesCleared()), 'room cleared once it fell');
  t.assert((await t.eval(() => window.__sfx.slice())).includes('fall'), 'fall sound');
  await t.shotCanvas('gone');

  // ---- Real sword, beetle on the rim of a 2-wide pit: it drops in mid-slide, not across.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 138, y: 120, dir: 'left' },
    tiles: pit(5, 6, 2, 3),
    entities: [{ id: 'bug', type: 'enemy.beetle', x: 120, y: 120 }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await t.wait(450);
  t.assert(await strike(t), 'the real sword swings');
  await t.until(() => window.__qf.game.services.findEntity('bug')?.falling, undefined, 1000);
  await t.wait(80);
  b = await beetle(t);
  t.log('2-wide pit', b);
  t.assert(b && b.falling && b.x > 80 && b.x < 112, `drops into the 2-wide pit (${JSON.stringify(b)})`);
  await t.shotCanvas('two-wide-pit');
  await t.until(() => !window.__qf.game.services.findEntity('bug'), undefined, 2000);

  // ---- Shoved toward a ledge: it stops flush above it like at a wall, then keeps creeping.
  await arena(t, {
    theme: 'grass', walls: true, hearts: 10, player: { x: 128, y: 50, dir: 'down' },
    tiles: [{ layer: 'bg', tx: 1, ty: 7, w: 14, tile: 'LEDGE_S' }],
    entities: [{ id: 'bug', type: 'enemy.beetle', x: 128, y: 72 }],
  });
  await t.eval(() => { window.__qf.game.services.debug.invincible = true; });
  await t.wait(450);
  t.assert(await strike(t), 'the sword swings down');
  await t.wait(450);
  const ledge0 = await t.eval(() => {
    const e = window.__qf.game.services.findEntity('bug');
    return { x: e.x, y: e.y, bottom: e.bottom };
  });
  t.log('ledge shove', ledge0);
  t.assert(ledge0.y > 90 && ledge0.bottom === 112, `stops flush above the ledge (bottom ${ledge0.bottom})`);
  await t.shotCanvas('ledge-stop');
  await t.eval(() => { window.__qf.game.services.player.place(40, 96, 'right'); });
  await t.wait(2000);
  const ledge1 = await t.eval(() => {
    const e = window.__qf.game.services.findEntity('bug');
    return { x: e.x, y: e.y, bottom: e.bottom };
  });
  t.log('after the ledge', ledge1);
  t.assert(ledge1.x < ledge0.x - 15 && ledge1.bottom <= 112, `keeps creeping, off the ledge (${JSON.stringify(ledge1)})`);
  await t.shotCanvas('ledge-creep');

  // ---- No pit or deep water anywhere: it cannot be beaten, so it doesn't hold the room.
  await arena(t, {
    theme: 'dungeon', hearts: 10, player: { x: 40, y: 40, dir: 'down' },
    entities: [{ id: 'bug', type: 'enemy.beetle', x: 180, y: 150 }],
  });
  await t.wait(200);
  const dry = await t.eval(() => {
    const s = window.__qf.game.services;
    return { counts: s.findEntity('bug').countsForClear, cleared: s.enemiesCleared() };
  });
  t.log('pitless room', dry);
  t.assert(!dry.counts && dry.cleared, 'a beetle in a room without pits does not block enemiesCleared');
}
