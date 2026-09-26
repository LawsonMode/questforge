// Engine e2e: ledge hop (and ledges blocking from below), pit fall (damage +
// respawn at the room entry point), deep/shallow water & bridge, dark room
// lighting, dungeon room scroll.
const snap = () => {
  const g = window.__qf.game;
  const s = g.services;
  return {
    state: g.state, room: s.room.def.id, x: s.player.x, y: s.player.y, z: s.player.z,
    pstate: s.player.state, hp: s.save.hp, dark: s.isDark(),
  };
};

async function warp(t, target) {
  await t.eval((tg) => window.__qf.game.warpNow(tg), target);
  await t.wait(80);
}

export default async function (t) {
  await t.goto('#/playtest/test');
  // Full reloads mid-run (e.g. the dev server reacting to file edits) reset the game; count them for the report.
  let reloads = 0;
  t.page.on('load', () => { reloads++; });
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.wait(200);

  // ---- Ledge hop down (LEDGE_S band on row 7, y 112..128).
  await warp(t, { world: 'ow', room: 'ow_ledges', x: 72, y: 92, dir: 'down' });
  await t.page.keyboard.down('ArrowDown');
  const hopped = await t.page
    .waitForFunction(() => window.__qf.game.services.player.state === 'hop', null, { timeout: 2000 })
    .then(() => true, () => false);
  t.assert(hopped, 'walking down into the ledge starts a hop');
  await t.wait(120);
  const mid = await t.eval(snap);
  t.assert(mid.z > 2, `airborne mid-hop (z=${mid.z.toFixed(1)})`);
  await t.shotCanvas('ledge-mid-hop');
  await t.page.keyboard.up('ArrowDown');
  await t.until(() => window.__qf.game.services.player.state === 'normal', undefined, 2000);
  let s = await t.eval(snap);
  t.log('after hop', s);
  t.assert(s.y >= 143.5, `landed a tile past the ledge (y=${s.y})`);
  await t.shotCanvas('ledge-landed');

  // ---- Ledges block from below.
  await t.hold('ArrowUp', 800);
  s = await t.eval(snap);
  t.assert(s.y >= 133.5, `ledge blocks walking up (y=${s.y})`);
  t.assert(s.pstate === 'normal' || s.pstate === 'push', `no hop against the ledge direction (${s.pstate})`);

  // ---- A wall right below the ledge: no hop through it.
  const setLedgeWall = (on) => t.eval(async (wall) => {
    const { T } = await import('/src/content/ids.ts');
    const room = window.__qf.game.services.project.worlds.find((w) => w.id === 'ow').rooms.find((r) => r.id === 'ow_ledges');
    for (let tx = 1; tx <= 10; tx++) room.layers.fg[8 * 16 + tx] = wall ? T.STONE_WALL : 0;
  }, on);
  await setLedgeWall(true);
  await warp(t, { world: 'ow', room: 'ow_ledges', x: 72, y: 92, dir: 'down' });
  await t.page.keyboard.down('ArrowDown');
  const hoppedWall = await t.page
    .waitForFunction(() => window.__qf.game.services.player.state === 'hop', null, { timeout: 900 })
    .then(() => true, () => false);
  await t.page.keyboard.up('ArrowDown');
  s = await t.eval(snap);
  t.assert(!hoppedWall && s.y <= 106.5, `no hop over a wall below the ledge (hopped=${hoppedWall}, y=${s.y})`);
  await t.shotCanvas('ledge-walled');
  await setLedgeWall(false);

  // ---- Pit: fall, lose one heart, respawn at the entry point.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 160, y: 152, dir: 'right' });
  const hp0 = (await t.eval(snap)).hp;
  await t.page.keyboard.down('ArrowRight');
  const fell = await t.page
    .waitForFunction(() => window.__qf.game.services.player.state === 'fall', null, { timeout: 2000 })
    .then(() => true, () => false);
  await t.page.keyboard.up('ArrowRight');
  t.assert(fell, 'walking over the hole makes the hero fall');
  await t.wait(150);
  await t.shotCanvas('pit-falling');
  await t.until(() => window.__qf.game.services.player.state === 'normal', undefined, 3000);
  s = await t.eval(snap);
  t.log('after pit', s, 'hp before', hp0);
  t.assert(s.hp === hp0 - 2, `pit costs one heart (${hp0} -> ${s.hp})`);
  t.assert(Math.abs(s.x - 160) < 1 && Math.abs(s.y - 152) < 1, `respawned at the entry point (${s.x}, ${s.y})`);
  await t.shotCanvas('pit-respawned');

  // ---- Pit with a pitTarget: fade to the target instead of damage.
  await t.eval(() => {
    window.__qf.game.services.room.def.pitTarget = { world: 'dg', room: 'dg_entry', x: 128, y: 120, dir: 'down' };
  });
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 160, y: 152, dir: 'right' });
  const hpTarget = (await t.eval(snap)).hp;
  await t.page.keyboard.down('ArrowRight');
  await t.until(() => window.__qf.game.services.player.state === 'fall', undefined, 2000);
  await t.page.keyboard.up('ArrowRight');
  await t.until(() => window.__qf.game.services.room.def.id === 'dg_entry' && window.__qf.game.state === 'playing', undefined, 4000);
  s = await t.eval(snap);
  t.assert(s.hp === hpTarget && Math.abs(s.y - 120) < 1, `pitTarget lands below without damage (hp ${hpTarget} -> ${s.hp})`);
  await t.eval(() => {
    const p = window.__qf.game.services.project;
    delete p.worlds.find((w) => w.id === 'ow').rooms.find((r) => r.id === 'ow_meadow').pitTarget;
  });

  // ---- Deep water blocks, shallow water is walkable, the bridge crosses the lake.
  await warp(t, { world: 'ow', room: 'ow_lake', x: 96, y: 104, dir: 'right' });
  await t.hold('ArrowRight', 900);
  s = await t.eval(snap);
  t.assert(s.x > 110 && s.x <= 122.5, `wades through shallow water, stops at deep water (x=${s.x})`);
  await t.shotCanvas('deep-water-stop');
  await warp(t, { world: 'ow', room: 'ow_lake', x: 110, y: 72, dir: 'right' });
  await t.hold('ArrowRight', 1300);
  s = await t.eval(snap);
  t.assert(s.x > 200, `bridge crosses the lake (x=${s.x})`);
  await t.shotCanvas('bridge');

  // ---- Flippers: deep water becomes swimmable.
  await t.eval(() => window.__qf.game.services.giveItem('flippers'));
  await warp(t, { world: 'ow', room: 'ow_lake', x: 104, y: 104, dir: 'right' });
  await t.hold('ArrowRight', 700);
  s = await t.eval(snap);
  t.assert(s.pstate === 'swim' && s.x > 130, `swims into deep water with flippers (${s.pstate}, x=${s.x})`);
  await t.shotCanvas('swimming');
  await t.hold('ArrowDown', 700);
  s = await t.eval(snap);
  t.assert(s.pstate === 'normal', `climbs out onto the shallows (${s.pstate})`);

  // ---- Cliff stairs lead back up past the ledge band (slower).
  await warp(t, { world: 'ow', room: 'ow_ledges', x: 192, y: 150, dir: 'up' });
  await t.hold('ArrowUp', 1000);
  s = await t.eval(snap);
  t.assert(s.y < 105, `stairs cross the ledge band (y=${s.y})`);

  // ---- Spikes hurt (half a heart, i-frames).
  await warp(t, { world: 'dg', room: 'dg_dark', x: 164, y: 152, dir: 'right' });
  const hpSpikes = (await t.eval(snap)).hp;
  await t.hold('ArrowRight', 300);
  s = await t.eval(snap);
  t.assert(s.hp === hpSpikes - 1, `spikes cost half a heart (${hpSpikes} -> ${s.hp})`);

  // ---- Dark room: tiny light without the lantern, larger with it.
  await warp(t, { world: 'dg', room: 'dg_dark', x: 40, y: 120, dir: 'right' });
  // Let the spike i-frames run out so the flicker never hides the hero in the shots below.
  await t.until(() => window.__qf.game.services.player.invuln <= 0, undefined, 3000);
  s = await t.eval(snap);
  t.assert(s.dark, 'dg_dark is dark');
  await t.shotCanvas('dark-no-lantern');
  await t.eval(() => window.__qf.game.services.giveItem('lantern'));
  await t.wait(100);
  await t.shotCanvas('dark-lantern');

  // ---- Dungeon scroll: dark hall -> entry hall through the west door.
  await warp(t, { world: 'dg', room: 'dg_dark', x: 24, y: 112, dir: 'left' });
  await t.page.keyboard.down('ArrowLeft');
  await t.until(() => window.__qf.game.state === 'transition', undefined, 3000);
  await t.wait(280);
  await t.shotCanvas('dungeon-mid-scroll');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  await t.page.keyboard.up('ArrowLeft');
  s = await t.eval(snap);
  t.assert(s.room === 'dg_entry', `scrolled into the entry hall (${s.room})`);
  await t.shotCanvas('dungeon-entry');

  // ---- And back into the dark hall: the light hole stays on the hero while sliding in.
  await t.page.keyboard.down('ArrowRight');
  await t.until(() => window.__qf.game.state === 'transition', undefined, 3000);
  await t.wait(200);
  await t.shotCanvas('into-dark-mid-scroll');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  await t.page.keyboard.up('ArrowRight');
  s = await t.eval(snap);
  t.assert(s.room === 'dg_dark', `scrolled back into the dark hall (${s.room})`);

  // ---- Fade warp via services.warp.
  await t.eval(() => window.__qf.game.services.warp({ world: 'ow', room: 'ow_cross', x: 56, y: 170, dir: 'down' }));
  await t.until(() => window.__qf.game.state === 'transition', undefined, 2000);
  await t.wait(120);
  await t.shotCanvas('fade-warp');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  s = await t.eval(snap);
  t.assert(s.room === 'ow_cross', `fade warp arrived (${s.room})`);
  await t.shotCanvas('crossroads');
  t.log('page reloads during the run', reloads);
}
