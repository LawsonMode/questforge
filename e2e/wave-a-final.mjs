// Wave A integration showcase on #/playtest/test: the hero walking (animation
// frames advance), walking behind a tree canopy, feet hidden in tall grass, an
// edge scroll caught mid-slide, a ledge hop in the air, a dark room lit by the
// lantern, and the asset gallery's tiles and sprites.
// Screenshots land in e2e-out/wave-a-final/.
const snap = () => {
  const g = window.__qf.game;
  const s = g.services;
  return {
    state: g.state, room: s.room.def.id, x: s.player.x, y: s.player.y, z: s.player.z,
    pstate: s.player.state, anim: s.player.anim, invuln: s.player.invuln, dark: s.isDark(),
  };
};

async function warp(t, target) {
  await t.eval((tg) => window.__qf.game.warpNow(tg), target);
  await t.wait(120);
}

/** Distinct hero sprite frames shown over ~0.7 s (sampled while the caller holds a key). */
function sampleHeroFrames(t) {
  return t.eval(async () => {
    const { animFrameIndex, ownAnim } = await import('/src/gfx/imageCache.ts');
    const s = window.__qf.game.services;
    const p = s.player;
    const def = s.project.sprites.find((d) => d.id === p.sprite);
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const a = def && ownAnim(def, p.anim);
      if (a) seen.add(`${p.anim}:${animFrameIndex(a, p.animT)}`);
      await new Promise((r) => setTimeout(r, 60));
    }
    return [...seen];
  });
}

export default async function (t) {
  await t.goto('#/playtest/test');
  let reloads = 0;
  t.page.on('load', () => { reloads++; });
  await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000);
  await t.wait(200);

  // ---- 0. Cost of building the procedural default art (paid once per page load).
  const artMs = await t.eval(async () => {
    const [tiles, core, actors] = await Promise.all([
      import('/src/content/art/tiles.ts'), import('/src/content/art/sprites-core.ts'), import('/src/content/art/sprites-actors.ts'),
    ]);
    const t0 = performance.now();
    tiles.buildTileArt();
    const t1 = performance.now();
    core.buildCoreSpriteArt();
    const t2 = performance.now();
    actors.buildActorSpriteArt();
    const t3 = performance.now();
    return { tiles: Math.round(t1 - t0), core: Math.round(t2 - t1), actors: Math.round(t3 - t2) };
  });
  t.log('default art build ms', artMs);
  t.assert(artMs.tiles + artMs.core + artMs.actors < 1500, `default art builds quickly (${JSON.stringify(artMs)})`);

  // ---- 1. Walking in the meadow: the walk cycle advances through several frames.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 150, y: 96, dir: 'down' });
  await t.page.keyboard.down('ArrowDown');
  // Sample once the walk has started (under load the key-down can land a frame or two late).
  await t.until(() => window.__qf.game.services.player.anim.startsWith('walk'), undefined, 3000);
  const frames = await sampleHeroFrames(t);
  await t.shotCanvas('walk-meadow');
  await t.page.keyboard.up('ArrowDown');
  t.log('walk frames', frames);
  t.assert(frames.length >= 3 && frames.every((f) => f.startsWith('walk_down')), `walk_down cycles through frames (${frames.join(', ')})`);

  // ---- 2. Behind a tree canopy (over layer draws above the hero), walking right mid-stride.
  await warp(t, { world: 'ow', room: 'ow_field', x: 172, y: 86, dir: 'right' });
  // Walk until past x 196 (game time, not wall time: the machine may be busy).
  await t.page.keyboard.down('ArrowRight');
  await t.until(() => window.__qf.game.services.player.x > 196, undefined, 3000);
  await t.page.keyboard.up('ArrowRight');
  let s = await t.eval(snap);
  t.assert(s.room === 'ow_field' && s.x > 188 && s.x < 222 && s.y < 96, `hero under the canopy at (${s.x.toFixed(0)}, ${s.y.toFixed(0)})`);
  await t.shotCanvas('behind-canopy');

  // ---- 3. Tall grass hides the hero's feet.
  await warp(t, { world: 'ow', room: 'ow_field', x: 176, y: 150, dir: 'down' });
  await t.hold('ArrowLeft', 200);
  await t.shotCanvas('tall-grass');

  // ---- 4. Edge scroll meadow -> lake, caught mid-slide.
  await warp(t, { world: 'ow', room: 'ow_meadow', x: 226, y: 112, dir: 'right' });
  await t.page.keyboard.down('ArrowRight');
  const scrolled = await t.page
    .waitForFunction(() => window.__qf.game.state === 'transition', null, { timeout: 3000 })
    .then(() => true, () => false);
  t.assert(scrolled, 'walking off the east edge starts a scroll');
  await t.wait(260);
  await t.shotCanvas('edge-scroll-mid');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  await t.page.keyboard.up('ArrowRight');
  s = await t.eval(snap);
  t.assert(s.room === 'ow_lake', `scrolled into the lake room (${s.room})`);

  // ---- 5. Ledge hop, airborne with its shadow.
  await warp(t, { world: 'ow', room: 'ow_ledges', x: 72, y: 92, dir: 'down' });
  await t.page.keyboard.down('ArrowDown');
  const hopped = await t.page
    .waitForFunction(() => window.__qf.game.services.player.state === 'hop', null, { timeout: 2000 })
    .then(() => true, () => false);
  t.assert(hopped, 'walking down off the ledge starts a hop');
  await t.wait(110);
  s = await t.eval(snap);
  t.assert(s.z > 2, `airborne mid-hop (z=${s.z.toFixed(1)})`);
  await t.shotCanvas('ledge-hop');
  await t.page.keyboard.up('ArrowDown');
  await t.until(() => window.__qf.game.services.player.state === 'normal', undefined, 2000);

  // ---- 6. Dark room lit by the lantern, hero walking beside the pit.
  await t.eval(() => window.__qf.game.services.giveItem('lantern'));
  await warp(t, { world: 'dg', room: 'dg_dark', x: 72, y: 104, dir: 'right' });
  await t.hold('ArrowRight', 250);
  s = await t.eval(snap);
  t.assert(s.dark && s.room === 'dg_dark' && s.invuln === 0, `dark room with a visible hero (${JSON.stringify(s)})`);
  await t.shotCanvas('dark-room-lantern');

  // ---- 7. Scrolling from the dark hall into the lit entry hall.
  await warp(t, { world: 'dg', room: 'dg_dark', x: 24, y: 112, dir: 'left' });
  await t.page.keyboard.down('ArrowLeft');
  await t.until(() => window.__qf.game.state === 'transition', undefined, 3000);
  await t.wait(300);
  await t.shotCanvas('dungeon-scroll-mid');
  await t.until(() => window.__qf.game.state === 'playing', undefined, 3000);
  await t.page.keyboard.up('ArrowLeft');

  // ---- 8/9. Asset gallery: tiles and sprites.
  await t.goto('#/gallery?section=tiles');
  await t.until(() => !!document.querySelector('.qf-gal-section[data-section="tiles"]'), undefined, 5000);
  await t.wait(300);
  const issues = await t.eval(() => document.querySelectorAll('.qf-gal-issues li').length);
  t.assert(issues === 0, `gallery reports no broken art (${issues})`);
  await t.shot('gallery-tiles');
  await t.goto('#/gallery?section=sprites');
  await t.until(() => !!document.querySelector('.qf-gal-section[data-section="sprites"]'), undefined, 5000);
  await t.wait(300);
  await t.shot('gallery-sprites');
  t.log('page reloads during the run', reloads);
}
