// Engine e2e: walking, wall collision, tall grass, edge scrolls between rooms
// (1x1 <-> 1x1 and 1x1 <-> 2x1), clamping at world edges, playtest debug keys & Escape.
const snap = () => {
  const g = window.__qf.game;
  const s = g && g.services;
  if (!s) return null;
  return {
    state: g.state, room: s.room.def.id, x: s.player.x, y: s.player.y, facing: s.player.facing,
    pstate: s.player.state, hp: s.save.hp, cam: [s.camera.x, s.camera.y],
  };
};

async function warp(t, target) {
  await t.eval((tg) => window.__qf.game.warpNow(tg), target);
  await t.wait(80);
}

async function walkUntilRoom(t, key, room, label, timeout = 4000) {
  await t.page.keyboard.down(key);
  const sawTransition = await t.page
    .waitForFunction(() => window.__qf.game.state === 'transition', null, { timeout })
    .then(() => true, () => false);
  t.assert(sawTransition, `${label}: a scroll transition started`);
  await t.wait(250);
  await t.shotCanvas(`${label}-mid-scroll`);
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  await t.page.keyboard.up(key);
  const s = await t.eval(snap);
  t.assert(s.room === room, `${label}: expected room ${room}, got ${s.room}`);
  await t.shotCanvas(`${label}-after`);
  return s;
}

export default async function (t) {
  await t.goto('#/playtest/test');
  // Full reloads mid-run (e.g. the dev server reacting to file edits) reset the game; count them for the report.
  let reloads = 0;
  t.page.on('load', () => { reloads++; });
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.wait(300);
  let s = await t.eval(snap);
  t.log('start', s);
  t.assert(s && s.room === 'ow_meadow', 'starts in the meadow');
  t.assert(s && s.state === 'playing', `state is playing (${s && s.state})`);
  await t.shotCanvas('start');

  // Walk up into the stone wall (row 4, y 64..80): must stop with the hitbox flush below it.
  await t.hold('ArrowUp', 1100);
  s = await t.eval(snap);
  t.log('after walking up into the wall', s);
  t.assert(s.y >= 85.5 && s.y <= 87, `wall stops the hero at y~86 (got ${s.y})`);
  t.assert(s.facing === 'up', 'faces up');
  await t.shotCanvas('wall-stop');

  // Corner sliding: overlapping the wall's end by 4 px, walking up slides around it.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 178, y: 100, dir: 'up' });
  await t.hold('ArrowUp', 900);
  s = await t.eval(snap);
  t.assert(s.y < 70 && s.x >= 181.9 && s.x <= 183, `slides around the wall corner (x=${s.x}, y=${s.y})`);

  // Walk speed: ~88 px/s on one axis.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 60, y: 110, dir: 'right' });
  const x0 = (await t.eval(snap)).x;
  await t.hold('ArrowRight', 500);
  const dx = (await t.eval(snap)).x - x0;
  t.log('walked px in 0.5 s', dx);
  t.assert(dx > 30 && dx < 56, `walk speed ~88 px/s (moved ${dx.toFixed(1)} px in 0.5 s)`);

  // Diagonal: slower per axis, facing keeps the first held direction.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 110, y: 110, dir: 'down' });
  await t.page.keyboard.down('ArrowDown');
  await t.wait(100);
  await t.page.keyboard.down('ArrowRight');
  await t.wait(300);
  await t.page.keyboard.up('ArrowRight');
  await t.page.keyboard.up('ArrowDown');
  s = await t.eval(snap);
  t.assert(s.facing === 'down', `diagonal keeps the original facing (${s.facing})`);

  // Tall grass hides the feet.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 64, y: 150, dir: 'down' });
  await t.shotCanvas('tall-grass');

  // World edge with no neighbour (north), walls off via noclip: clamped inside the room.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 128, y: 36, dir: 'up' });
  await t.eval(() => { window.__qf.game.services.debug.noclip = true; });
  await t.hold('ArrowUp', 600);
  s = await t.eval(snap);
  await t.eval(() => { window.__qf.game.services.debug.noclip = false; });
  t.assert(s.room === 'ow_meadow' && Math.abs(s.y - 6) < 0.01, `no-neighbour edge clamps the hitbox inside (y=${s.y})`);

  // Meadow -> Lake (right edge, rows 5-8 open).
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 232, y: 110, dir: 'right' });
  s = await walkUntilRoom(t, 'ArrowRight', 'ow_lake', 'meadow-to-lake');
  t.assert(Math.abs(s.y - 110) < 2, `y kept across the scroll (${s.y})`);
  t.assert(s.x > 8 && s.x < 40, `carried into the lake room (x=${s.x})`);

  // Lake -> Meadow (left).
  s = await walkUntilRoom(t, 'ArrowLeft', 'ow_meadow', 'lake-to-meadow');

  // Meadow -> Ledges (down through the path gap).
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 128, y: 196, dir: 'down' });
  s = await walkUntilRoom(t, 'ArrowDown', 'ow_ledges', 'meadow-to-ledges');
  t.assert(Math.abs(s.x - 128) < 2, `x kept (${s.x})`);

  // Crossroads (1,1) -> Long field (2x1, right half).
  await warp(t, { world: 'ow', room: 'ow_cross', x: 120, y: 196, dir: 'down' });
  s = await walkUntilRoom(t, 'ArrowDown', 'ow_field', 'cross-to-field');
  t.assert(Math.abs(s.x - 376) < 2, `lands in the right half of the 2x1 room (x=${s.x})`);

  // Walk left inside the 2x1 room: the camera scrolls with the hero.
  const camBefore = (await t.eval(snap)).cam[0];
  await t.hold('ArrowLeft', 1200);
  s = await t.eval(snap);
  t.log('2x1 camera', camBefore, '->', s.cam[0]);
  t.assert(s.cam[0] < camBefore, 'camera follows inside a wide room');
  await t.shotCanvas('wide-room-scrolled');

  // Long field (camera between screens) -> Crossroads: the view slides sideways over the Ledges room.
  await warp(t, { world: 'ow', room: 'ow_field', x: 360, y: 40, dir: 'up' });
  s = await walkUntilRoom(t, 'ArrowUp', 'ow_cross', 'field-to-cross');
  t.assert(Math.abs(s.x - 104) < 2, `lands above the gap (x=${s.x})`);

  // An edge whose far side is walled off (rock over the lake's entry): the hero lands on free ground, not in the rock.
  await t.eval(async () => {
    const { T } = await import('/src/content/ids.ts');
    const lake = window.__qf.game.services.project.worlds.find((w) => w.id === 'ow').rooms.find((r) => r.id === 'ow_lake');
    for (let ty = 4; ty < 10; ty++) for (let tx = 0; tx < 2; tx++) lake.layers.fg[ty * 16 + tx] = T.MOUNTAIN_ROCK;
  });
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 232, y: 110, dir: 'right' });
  s = await walkUntilRoom(t, 'ArrowRight', 'ow_lake', 'meadow-to-walled-lake');
  const free = await t.eval(() => {
    const p = window.__qf.game.services.player;
    return !p.isBlockedAt(p.x, p.y);
  });
  t.assert(free && s.x >= 38, `lands clear of the rock (x=${s.x}, free=${free})`);
  await t.hold('ArrowRight', 300);
  const moved = (await t.eval(snap)).x - s.x;
  t.assert(moved > 10, `can walk on after landing (moved ${moved.toFixed(1)} px)`);

  // Playtest debug keys & Escape.
  await t.press('F1');
  await t.press('F4');
  await t.wait(150);
  await t.shotCanvas('debug-overlay');
  const dbg = await t.eval(() => ({ ...window.__qf.game.services.debug }));
  t.assert(dbg.hitboxes && dbg.fps, 'F1/F4 toggle debug flags');
  await t.press('Escape');
  await t.until(() => location.hash === '#/' || location.hash === '', undefined, 3000);
  t.log('page reloads during the run', reloads);
}
