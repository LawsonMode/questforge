// gfx e2e: asset gallery sections (screenshots) + CanvasRenderer / AssetCache checks.
// Uses the real #/gallery route when the app boots cleanly; otherwise (sibling
// modules still stubs) it stubs src/main.ts and mounts the gallery directly from
// the default assets, so gfx can be verified in isolation. HiDPI behaviour is
// checked in extra browser contexts at deviceScaleFactor 2 and 1.25.
import { join } from 'node:path';

export default async function (t) {
  const mode = await chooseMode(t);
  t.log(`gallery mode: ${mode}`);
  await installHelpers(t);

  // ---------------------------------------------------------------- gallery sections
  for (const section of ['palettes', 'tiles', 'terrains', 'sprites']) {
    await showGallery(t, mode, `?section=${section}`);
    const n = await t.eval((s) => document.querySelectorAll(`.qf-gal-section[data-section="${s}"]`).length, section);
    t.assert(n === 1, `section ${section} rendered once (got ${n})`);
    await t.shot(`gallery-${section}`);
  }
  // Scroll further into the long sections.
  await showGallery(t, mode, '?section=tiles');
  await scrollGallery(t, 0.45);
  await t.shot('gallery-tiles-mid');
  await showGallery(t, mode, '?section=sprites&filter=hero');
  await t.shot('gallery-sprites-hero');
  await scrollGallery(t, 0.6);
  await t.shot('gallery-sprites-hero-lower');
  await showGallery(t, mode, '?section=sprites&filter=soldier');
  await t.shot('gallery-sprites-soldier');
  const stats = await t.eval(() => ({
    sections: document.querySelectorAll('.qf-gal-section').length,
    sprites: [...document.querySelectorAll('.qf-gal-sprite')].map((e) => e.dataset.id),
  }));
  t.assert(stats.sections === 1 && stats.sprites.length >= 1 && stats.sprites.every((id) => id.includes('soldier')),
    `filter=soldier keeps only soldier sprites (${stats.sprites.join(',')})`);
  const swapCanvases = await t.eval(() => document.querySelectorAll('.qf-gal-swaps canvas').length);
  t.assert(swapCanvases === 3, `soldier swap row shows base + 2 swaps (${swapCanvases})`);
  // Off-centre origins (HUD icons at 0,0) keep tight preview canvases when no anim is mirrored.
  await showGallery(t, mode, '?section=sprites&filter=hud');
  const hud = await t.eval(() => {
    const cv = document.querySelector('.qf-gal-sprite[data-id="hud"] .qf-gal-item canvas');
    return cv ? cv.width : -1;
  });
  t.assert(hud === -1 || hud === 8 * 3, `hud anim canvas is one frame wide (${hud})`);
  await t.shot('gallery-sprites-hud');
  await showGallery(t, mode, '?section=terrains');
  const stretched = await t.eval(() => [...document.querySelectorAll('.qf-gal-terrain canvas')]
    .filter((c) => c.getBoundingClientRect().width !== c.width).length);
  t.assert(stretched === 0, `terrain canvases drawn 1:1 in CSS px (${stretched} stretched)`);
  await t.shot('gallery-terrains-fixed');

  await showGallery(t, mode, '');
  const all = await t.eval(() => ({
    sections: [...document.querySelectorAll('.qf-gal-section')].map((e) => e.dataset.section),
    tiles: document.querySelectorAll('.qf-gal-section[data-section="tiles"] .qf-gal-item').length,
    palettes: document.querySelectorAll('.qf-gal-palette').length,
    swatches: document.querySelectorAll('.qf-gal-palette:first-child .qf-gal-swatch').length,
    projTiles: window.__gfxProject ? window.__gfxProject.tiles.length : -1,
    issues: [...document.querySelectorAll('.qf-gal-issues li')].map((li) => li.textContent),
    offCentre: (window.__gfxProject?.sprites ?? []).filter((s) => s.ox * 2 !== s.w).map((s) => `${s.id} ${s.w}x${s.h} o${s.ox},${s.oy}`),
  }));
  t.assert(all.sections.join(',') === 'palettes,tiles,terrains,sprites', `all sections in order (${all.sections})`);
  t.log(`gallery issues in the default assets: ${all.issues.length}`, all.issues.slice(0, 12));
  t.log(`sprites with an off-centre origin: ${all.offCentre.length}`, all.offCentre.slice(0, 12));
  t.assert(all.swatches === 16, `16 swatches per palette (${all.swatches})`);
  if (all.projTiles >= 0) t.assert(all.tiles === all.projTiles, `one cell per tile (${all.tiles}/${all.projTiles})`);
  await t.shot('gallery-all');

  // Animation loop: an animated tile canvas changes over time; unmount cancels & removes.
  const anim = await t.eval(async () => {
    const cv = document.querySelector('.qf-gal-section[data-section="tiles"] .qf-gal-item[data-id="4"] canvas');
    if (!cv) return { skipped: true };
    const snap = () => cv.toDataURL();
    const a = snap();
    const seen = new Set([a]);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 90));
      seen.add(snap());
    }
    return { distinct: seen.size };
  });
  if (!anim.skipped) t.assert(anim.distinct > 1, `animated FLOWERS tile animates (${anim.distinct} distinct frames)`);

  // Broken art is flagged (badge, tooltip, issue list, magenta missing frames).
  const invalid = await t.eval(invalidArtCheck, 'section=sprites&filter=hero');
  t.assert(invalid.brokenAnim && invalid.magenta, `broken hero anim is flagged and drawn magenta (${JSON.stringify(invalid)})`);
  await t.shot('gallery-invalid-sprite');
  const invalidTiles = await t.eval(invalidArtCheck, 'section=tiles');
  t.assert(invalidTiles.badTiles === 2 && invalidTiles.issues.length >= 2,
    `two broken tiles are flagged and listed (${JSON.stringify(invalidTiles)})`);
  await t.shot('gallery-invalid-tiles');
  await t.eval(() => window.__gfxInvalidUnmount?.());

  // Leave the route on a view without animations, then check mount/unmount hygiene directly.
  await showGallery(t, mode, '?section=palettes&filter=__none__');
  await t.eval(() => window.__gfxClear());
  const hygiene = await t.eval(unmountCheck);
  t.assert(hygiene.running, 'gallery starts a requestAnimationFrame loop when something animates');
  t.assert(hygiene.cleaned, `unmount cancels the loop and removes the DOM (${JSON.stringify(hygiene)})`);

  // ---------------------------------------------------------------- renderer
  const checks = await t.eval(renderChecks);
  for (const [name, ok] of Object.entries(checks.results)) t.assert(ok === true, `renderer check: ${name} -> ${JSON.stringify(ok)}`);
  t.log('renderer checks', Object.keys(checks.results).length, 'info', checks.info);
  await t.shot('renderer-scene');

  const dark = await t.eval(darknessScene);
  for (const [name, ok] of Object.entries(dark)) t.assert(ok === true, `darkness check: ${name} -> ${JSON.stringify(ok)}`);
  await t.shot('renderer-darkness');

  const present = await t.eval(presentChecks);
  for (const [name, ok] of Object.entries(present)) t.assert(ok === true, `present check: ${name} -> ${JSON.stringify(ok)}`);
  await t.shot('renderer-present-small');

  const transform = await t.eval(transformChecks);
  for (const [name, ok] of Object.entries(transform)) t.assert(ok === true, `transform check: ${name} -> ${JSON.stringify(ok)}`);

  const cache = await t.eval(cacheChecks);
  for (const [name, ok] of Object.entries(cache)) t.assert(ok === true, `cache check: ${name} -> ${JSON.stringify(ok)}`);

  const wrapped = await t.eval(fontSpecimen);
  t.assert(wrapped.every((w) => w <= 232), `wrapped specimen lines fit 232px (${wrapped.join(',')})`);
  await t.shot('renderer-font');

  await hidpiChecks(t);
}

// ------------------------------------------------------------------ HiDPI (extra browser contexts)

async function hidpiChecks(t) {
  const browser = t.page.context().browser();
  for (const dpr of [2, 1.25]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 896 }, deviceScaleFactor: dpr });
    await context.route('**/src/main.ts', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: 'window.__qf = { route: null, game: null, editor: null, ready: true, error: null };',
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${t.base}/`);
    await page.waitForFunction(() => window.__qf && window.__qf.ready);
    const res = await page.evaluate(hidpiPage);
    for (const [name, ok] of Object.entries(res.checks)) t.assert(ok === true, `dpr ${dpr} check: ${name} -> ${JSON.stringify(ok)}`);
    t.log(`dpr ${dpr}`, res.info);
    t.assert(errors.length === 0, `dpr ${dpr}: no page/console errors (${errors.join(' | ')})`);
    if (dpr === 2) await page.screenshot({ path: join(t.outDir, '90-hidpi-dpr2.png') });
    await context.close();
  }
}

// ------------------------------------------------------------------ boot helpers

async function chooseMode(t) {
  const probe = await t.page.context().newPage();
  const errors = [];
  probe.on('pageerror', (e) => errors.push(e.message));
  probe.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let ok = false;
  try {
    await probe.goto(`${t.base}/#/gallery?section=palettes`);
    await probe.waitForFunction(() => window.__qf && (window.__qf.ready || window.__qf.error), null, { timeout: 10000 });
    ok = !(await probe.evaluate(() => window.__qf.error)) && (await probe.locator('.qf-gal').count()) > 0;
  } catch (e) {
    errors.push(String(e).split('\n')[0]);
  }
  await probe.close();
  if (ok && errors.length === 0) {
    await t.goto('#/gallery?section=palettes');
    return 'route';
  }
  t.log(`real route not usable yet (${(errors[0] ?? 'gallery did not mount').slice(0, 140)}) -> isolated mode`);
  await t.page.route('**/src/main.ts', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.__qf = { route: null, game: null, editor: null, ready: true, error: null };',
  }));
  await t.page.goto(`${t.base}/#/gallery`);
  await t.page.waitForFunction(() => window.__qf && window.__qf.ready);
  return 'isolated';
}

async function installHelpers(t) {
  await t.eval(async () => {
    async function loadAssets() {
      try {
        const m = await import('/src/content/art/index.ts');
        return { ...m.createDefaultAssets(), source: 'default' };
      } catch (err) {
        console.warn('default assets unavailable, using placeholders:', String(err));
        const p = await import('/src/content/art/placeholder.ts');
        const { SPRITE_SPECS } = await import('/src/content/ids.ts');
        const swaps = SPRITE_SPECS.flatMap((s) => s.swaps ?? []);
        return { palettes: p.placeholderPalettes(swaps), tiles: p.placeholderTiles(), sprites: p.placeholderSprites(() => true), terrains: [], source: 'placeholder' };
      }
    }
    const a = await loadAssets();
    window.__gfxProject = {
      format: 'questforge', version: 1, id: 'gfx-e2e', name: 'gfx e2e', author: '', description: '', created: 0, modified: 0,
      settings: { title: 'gfx', subtitle: '', startHearts: 3, startItems: {}, titleMusic: 'title' },
      palettes: a.palettes, tiles: a.tiles, terrains: a.terrains, sprites: a.sprites,
      worlds: [], dialogues: [], flags: [], start: { world: '', room: '', x: 0, y: 0 },
    };
    window.__gfxAssetSource = a.source;
    window.__gfxClear = () => {
      window.__gfxUnmount?.();
      window.__gfxUnmount = null;
      document.getElementById('app').textContent = '';
      document.getElementById('gfx-test')?.remove();
    };
  });
}

async function showGallery(t, mode, query) {
  if (mode === 'route') {
    await t.eval((q) => { location.hash = `#/gallery${q}`; }, query);
    await t.until(() => window.__qf.ready && document.querySelector('.qf-gal'));
  } else {
    await t.eval(async (q) => {
      window.__gfxClear();
      history.replaceState(null, '', `#/gallery${q}`);
      const { mountGallery } = await import('/src/gfx/gallery.ts');
      window.__gfxUnmount = mountGallery(document.getElementById('app'), window.__gfxProject);
    }, query);
  }
  await t.wait(450);
}

async function scrollGallery(t, fraction) {
  await t.eval((f) => {
    const g = document.querySelector('.qf-gal');
    g.scrollTop = (g.scrollHeight - g.clientHeight) * f;
  }, fraction);
  await t.wait(250);
}

// ------------------------------------------------------------------ page-side checks (serialised into the page)

async function unmountCheck() {
  const { mountGallery } = await import('/src/gfx/gallery.ts');
  const host = document.createElement('div');
  document.body.append(host);
  const live = new Set();
  const origRequest = window.requestAnimationFrame;
  const origCancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    const id = origRequest((ts) => { live.delete(id); cb(ts); });
    live.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { live.delete(id); origCancel(id); };
  history.replaceState(null, '', '#/gallery?section=tiles&filter=flowers');
  const unmount = mountGallery(host, window.__gfxProject);
  await new Promise((r) => setTimeout(r, 120));
  const running = live.size > 0;
  unmount();
  await new Promise((r) => setTimeout(r, 120));
  const cleaned = live.size === 0 && host.childElementCount === 0;
  window.requestAnimationFrame = origRequest;
  window.cancelAnimationFrame = origCancel;
  host.remove();
  return { running, cleaned, live: live.size };
}

async function renderChecks() {
  const { CanvasRenderer } = await import('/src/gfx/renderer.ts');
  const { measureText } = await import('/src/gfx/font.ts');
  const { T } = await import('/src/content/ids.ts');
  const project = window.__gfxProject;
  const cv = document.createElement('canvas');
  cv.id = 'gfx-test';
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;background:#000;z-index:10';
  document.body.append(cv);
  const r = new CanvasRenderer(cv, project);
  window.__gfxRenderer = r;
  const ctx = r.ctx;
  const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  const region = (x, y, w, h) => ctx.getImageData(x, y, w, h).data;
  const results = {};
  const info = { assets: window.__gfxAssetSource };

  // --- isolated probes on a flat backdrop -------------------------------------------------
  const BG = [16, 32, 48];
  r.clear('#102030');
  // Camera: world (40, 24) lands on screen (0, 0).
  r.camX = 40.4; r.camY = 23.6;
  r.fillRect(40, 24, 2, 2, '#ff0000');
  results.cameraOffset = JSON.stringify(px(0, 0)) === '[255,0,0]' && JSON.stringify(px(2, 2)) === JSON.stringify(BG);
  r.camX = 0; r.camY = 0;
  r.clear('#102030');

  // Flip: hero idle_down drawn plain vs flipX must mirror exactly (origin at the frame centre).
  const hero = project.sprites.find((s) => s.id === 'hero');
  r.drawSpriteFrame('hero', 0, 8 + hero.ox, 8 + hero.oy);
  r.drawSpriteFrame('hero', 0, 40 + hero.ox, 8 + hero.oy, { flipX: true });
  const A = region(8, 8, hero.w, hero.h);
  const B = region(40, 8, hero.w, hero.h);
  let mirrored = true;
  let asym = false;
  for (let y = 0; y < hero.h; y++) {
    for (let x = 0; x < hero.w; x++) {
      for (let c = 0; c < 3; c++) {
        const a = A[(y * hero.w + x) * 4 + c];
        if (a !== B[(y * hero.w + (hero.w - 1 - x)) * 4 + c]) mirrored = false;
        if (a !== A[(y * hero.w + (hero.w - 1 - x)) * 4 + c]) asym = true;
      }
    }
  }
  results.flipXMirrors = mirrored;
  info.heroAsymmetric = asym;

  // Anim flipX XOR opts.flipX: walk_left (flipX anim) + opts.flipX == walk_right frame.
  r.clear('#102030');
  r.drawSpriteAnim('hero', 'walk_right', 0, 8 + hero.ox, 8 + hero.oy);
  r.drawSpriteAnim('hero', 'walk_left', 0, 40 + hero.ox, 8 + hero.oy, { flipX: true });
  r.drawSpriteAnim('hero', 'walk_left', 0, 72 + hero.ox, 8 + hero.oy);
  const R0 = region(8, 8, hero.w, hero.h).join();
  results.animFlipXor = R0 === region(40, 8, hero.w, hero.h).join() && (!asym || R0 !== region(72, 8, hero.w, hero.h).join());

  // Palette swap changes colours; flash is a pure white silhouette.
  r.clear('#102030');
  const sol = project.sprites.find((s) => s.id === 'enemy.soldier');
  r.drawSpriteFrame('enemy.soldier', 0, 8 + sol.ox, 8 + sol.oy);
  r.drawSpriteFrame('enemy.soldier', 0, 40 + sol.ox, 8 + sol.oy, { palette: 'pal.soldier.blue' });
  r.drawSpriteFrame('enemy.soldier', 0, 72 + sol.ox, 8 + sol.oy, { flash: true });
  results.paletteSwap = region(8, 8, sol.w, sol.h).join() !== region(40, 8, sol.w, sol.h).join();
  const F = region(72, 8, sol.w, sol.h);
  let flashOk = true;
  let flashInk = 0;
  for (let i = 0; i < F.length; i += 4) {
    const isBg = F[i] === BG[0] && F[i + 1] === BG[1] && F[i + 2] === BG[2];
    const isWhite = F[i] === 255 && F[i + 1] === 255 && F[i + 2] === 255;
    if (isWhite) flashInk++;
    else if (!isBg) flashOk = false;
  }
  results.flashWhite = flashOk && flashInk > 20;
  // Unknown palette override falls back to the base palette.
  r.drawSpriteFrame('enemy.soldier', 0, 104 + sol.ox, 8 + sol.oy, { palette: 'pal.nope' });
  results.unknownPaletteFallsBack = region(8, 8, sol.w, sol.h).join() === region(104, 8, sol.w, sol.h).join();

  // Alpha: half-transparent white over the backdrop blends.
  r.clear('#000000');
  r.fillRect(0, 0, 4, 4, '#ffffff', { alpha: 0.5, screen: true });
  const half = px(1, 1)[0];
  results.alphaBlend = half > 110 && half < 145;

  // Missing sprite / anim -> magenta placeholder centred on the point; never throws.
  r.clear('#000000');
  r.drawSpriteFrame('no.such.sprite', 0, 20, 20);
  r.drawSpriteAnim('hero', 'no_such_anim', 0, 40, 20);
  r.drawSpriteFrame('hero', 999, 60, 20);
  results.placeholder = JSON.stringify(px(20, 20)) === '[255,0,255]' && JSON.stringify(px(40, 20)) === '[255,0,255]'
    && JSON.stringify(px(60, 20)) === '[255,0,255]';
  r.drawTile(0, 0, 0);
  r.drawTile(987654, 0, 0);
  r.drawSpriteFrame('hero', 0, 5000, -5000);
  results.noThrowUnknown = true;

  // animDuration / tile animation by r.time.
  results.animDuration = Math.abs(r.animDuration('hero', 'attack_down') - 3 / 20) < 1e-9 && r.animDuration('nope', 'x') === 0;

  // Text: exact width, alignment, shadow at +1,+1.
  r.clear('#000000');
  const text = 'HELLO Hero 42';
  r.drawText(text, 10, 10, { shadow: false, color: '#ffffff' });
  const bbox = (x0, y0, w, h, pred) => {
    const d = region(x0, y0, w, h);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (pred(d[i], d[i + 1], d[i + 2])) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    return { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
  const white = (a, b, c) => a === 255 && b === 255 && c === 255;
  const tb = bbox(0, 0, 256, 40, white);
  info.textBox = tb;
  results.textWidthExact = tb.x === 10 && tb.w === measureText(text) && tb.y === 10;
  r.clear('#000000');
  r.drawText('CENTER', 128, 50, { align: 'center', shadow: false });
  r.drawText('RIGHT', 200, 70, { align: 'right', shadow: false });
  const cb = bbox(0, 40, 256, 20, white);
  const rb = bbox(0, 60, 256, 20, white);
  results.textCenter = Math.abs(cb.x + cb.w / 2 - 128) <= 1;
  results.textRight = rb.x + rb.w === 200;
  r.clear('#000000');
  r.drawText('I', 10, 100, { color: '#ff0000' });
  results.textShadow = JSON.stringify(px(10, 100)) === '[255,0,0]' && JSON.stringify(px(11, 101)) === '[255,0,0]'
    && JSON.stringify(px(13, 101)) === '[0,0,0]';

  // strokeRect is a crisp 1px outline.
  r.clear('#000000');
  r.strokeRect(100, 100, 10, 6, '#00ff00', { screen: true });
  results.strokeCrisp = JSON.stringify(px(100, 100)) === '[0,255,0]' && JSON.stringify(px(109, 105)) === '[0,255,0]'
    && JSON.stringify(px(101, 101)) === '[0,0,0]' && JSON.stringify(px(110, 100)) === '[0,0,0]';

  // Overlay tints the whole screen.
  r.clear('#000000');
  r.overlay('#ffffff', 1);
  results.overlay = JSON.stringify(px(255, 223)) === '[255,255,255]';

  // --- the showcase scene -----------------------------------------------------------------
  drawScene(r, project, T);
  r.present();
  return { results, info };

  function drawScene(r, project, T) {
    r.clear('#000');
    r.time = 0.3;
    r.camX = 8; r.camY = 8;
    const has = (id) => project.tiles.some((t) => t.id === id);
    const water = project.terrains.find((x) => x.id === 'water');
    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 18; tx++) {
        const alt = (tx * 7 + ty * 3) % 11 === 0;
        r.drawTile(alt && has(T.GRASS_ALT) ? T.GRASS_ALT : T.GRASS, tx * 16, ty * 16);
      }
    }
    for (let tx = 0; tx < 18; tx++) r.drawTile(T.PATH ?? T.DIRT, tx * 16, 9 * 16);
    if (water) {
      const pond = [[water.nw, water.n, water.n, water.ne], [water.w, water.center, water.center, water.e], [water.sw, water.s, water.s, water.se]];
      pond.forEach((row, y) => row.forEach((id, x) => r.drawTile(id, (11 + x) * 16, (2 + y) * 16)));
    }
    [[2, 2, T.FLOWERS], [3, 2, T.FLOWERS], [5, 12, T.BUSH], [6, 12, T.ROCK], [9, 12, T.TALL_GRASS], [10, 12, T.TALL_GRASS]]
      .forEach(([x, y, id]) => r.drawTile(id, x * 16, y * 16));
    // A 2x2 tree: trunk on fg, canopy on over.
    r.drawTile(T.TREE_BL, 1 * 16, 6 * 16); r.drawTile(T.TREE_BR, 2 * 16, 6 * 16);
    // Sprites (origins at the feet / centre).
    r.drawShadow(64, 118, 14);
    r.drawSpriteAnim('hero', 'idle_down', 0, 64, 114);
    r.drawSpriteAnim('hero', 'walk_left', 0.1, 92, 114);
    r.drawSpriteAnim('hero', 'walk_right', 0.1, 120, 114, { flipX: true });
    r.drawSpriteAnim('hero', 'walk_up', 0.2, 148, 114, { alpha: 0.5 });
    r.drawSpriteAnim('enemy.soldier', 'walk_down', 0, 64, 170);
    r.drawSpriteAnim('enemy.soldier', 'walk_down', 0, 92, 170, { palette: 'pal.soldier.blue' });
    r.drawSpriteAnim('enemy.soldier', 'walk_down', 0, 120, 170, { palette: 'pal.soldier.red' });
    r.drawSpriteAnim('enemy.soldier', 'walk_down', 0, 148, 170, { flash: true });
    r.drawSpriteAnim('enemy.slime', 'idle', 0, 176, 170, { flipY: true });
    r.drawSpriteAnim('pickup', 'rupee_green', 0, 200, 120);
    r.drawShadow(224, 124, 10);
    r.drawSpriteAnim('pickup', 'heart', 0, 224, 110);
    r.drawSpriteFrame('missing.sprite', 0, 200, 170);
    r.drawTile(T.TREE_TL, 1 * 16, 5 * 16); r.drawTile(T.TREE_TR, 2 * 16, 5 * 16);
    // HUD & text (screen space).
    r.fillRect(4, 4, 248, 20, '#000000', { screen: true, alpha: 0.55 });
    r.strokeRect(4, 4, 248, 20, '#f0c040', { screen: true });
    r.drawText('Questforge renderer test', 8, 7, { color: '#f8f8f8' });
    r.drawText('HP 3/8  x099  Lv.2', 8, 15, { color: '#f0c040' });
    r.drawText('centred', 128, 200, { align: 'center' });
    r.drawText('right', 250, 212, { align: 'right', color: '#80d0ff' });
    r.drawText('left', 6, 212, { color: '#a0f080', shadow: '#204010' });
  }
}

async function darknessScene() {
  const r = window.__gfxRenderer;
  const out = {};
  // Flat white field, darken, one light at world (100, 100) with the camera offset.
  r.camX = 20; r.camY = 10;
  r.clear('#ffffff');
  r.darkness(0.8, [{ x: 100, y: 100, r: 40 }, { x: 5000, y: 5000, r: 30 }]);
  const px = (x, y) => Array.from(r.ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  const centre = px(80, 90)[0];
  const far = px(250, 220)[0];
  const edge = px(80 + 34, 90)[0];
  out.lightCentreClear = centre === 255;
  out.farDark = far > 40 && far < 62;
  out.softEdge = edge > far && edge < 255;
  out.levelZeroNoop = (() => { r.clear('#ffffff'); r.darkness(0, []); return px(5, 5)[0] === 255; })();
  // Showcase: the scene again under darkness with two lights.
  r.clear('#000');
  r.camX = 8; r.camY = 8;
  const { T } = await import('/src/content/ids.ts');
  for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 18; tx++) r.drawTile(T.DFLOOR, tx * 16, ty * 16);
  r.drawSpriteAnim('obj.torch', 'lit', 0.2, 200, 60);
  r.drawSpriteAnim('hero', 'idle_down', 0, 90, 120);
  r.darkness(0.92, [{ x: 90, y: 112, r: 48 }, { x: 200, y: 60, r: 28 }]);
  r.drawText('Dark room: lantern + torch', 128, 206, { align: 'center' });
  r.present();
  return out;
}

async function presentChecks() {
  const r = window.__gfxRenderer;
  const cv = document.getElementById('gfx-test');
  const out = {};
  const nextFrames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  // Full-viewport canvas (1024x896 at dpr 1) -> backing store matches, scale 4, no letterbox.
  r.present();
  out.backingFullSize = cv.width === cv.clientWidth * (window.devicePixelRatio || 1) && cv.height === cv.clientHeight * (window.devicePixelRatio || 1);
  // A CSS change is picked up by the ResizeObserver (no explicit resize() call, no per-frame layout reads).
  cv.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:460px;display:block;z-index:10';
  await nextFrames();
  r.present();
  out.observedResize = cv.width === 600 && cv.height === 460;
  // resize() re-measures synchronously. Odd size: 700x500 CSS -> scale 2 (512x448), centred with black bars.
  cv.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:500px;display:block;z-index:10';
  r.resize();
  r.clear('#ff0000');
  r.present();
  const d = cv.getContext('2d');
  const at = (x, y) => Array.from(d.getImageData(x, y, 1, 1).data.slice(0, 3)).join();
  out.resized = cv.width === 700 && cv.height === 500;
  out.letterboxLeft = at(10, 250) === '0,0,0' && at(93, 250) === '0,0,0';
  out.imageStartsAtOffset = at(94, 250) === '255,0,0' && at(605, 250) === '255,0,0' && at(606, 250) === '0,0,0';
  out.topBar = at(350, 25) === '0,0,0' && at(350, 26) === '255,0,0';
  // Draw again so the screenshot shows a letterboxed frame.
  r.clear('#284878');
  r.drawText('present(): 700x500 -> scale 2', 128, 100, { align: 'center' });
  r.present();
  return out;
}

async function cacheChecks() {
  const { AssetCache } = await import('/src/gfx/imageCache.ts');
  const project = structuredClone(window.__gfxProject);
  const c = new AssetCache(project);
  const out = {};
  const T = { FLOWERS: 4, GRASS: 1 };
  out.nullUnknown = c.tile(0, 0) === null && c.tile(424242, 0) === null && c.sprite('nope', 0) === null
    && c.spriteFlash('nope', 0) === null && c.sprite('hero', 9999) === null && c.animFrame('hero', 'nope', 0) === -1;
  out.cacheHit = c.tile(T.GRASS, 0) === c.tile(T.GRASS, 0) && c.sprite('hero', 0) === c.sprite('hero', 0);
  out.tileSize = c.tile(T.GRASS, 0)?.width === 16 && c.tile(T.GRASS, 0)?.height === 16;
  out.tileFrameWraps = c.tile(T.GRASS, 5) === c.tile(T.GRASS, 0);

  const flowers = project.tiles.find((t) => t.id === T.FLOWERS);
  const ft = flowers.frameTime ?? 0.25;
  const nf = flowers.frames.length;
  out.tileFrameAt = c.tileFrameAt(T.FLOWERS, 0) === 0 && c.tileFrameAt(T.FLOWERS, ft) === 1 % nf
    && c.tileFrameAt(T.FLOWERS, ft * nf) === 0 && c.tileFrameAt(T.GRASS, 12.3) === 0;

  const hero = project.sprites.find((s) => s.id === 'hero');
  const walk = hero.anims.walk_down;
  const atk = hero.anims.attack_down;
  out.animLoopWraps = c.animFrame('hero', 'walk_down', 0) === walk.frames[0]
    && c.animFrame('hero', 'walk_down', 1 / walk.fps) === walk.frames[1]
    && c.animFrame('hero', 'walk_down', walk.frames.length / walk.fps) === walk.frames[0];
  out.animOnceClamps = c.animFrame('hero', 'attack_down', 10) === atk.frames[atk.frames.length - 1]
    && c.animFrame('hero', 'attack_down', -1) === atk.frames[0];

  // Palette edit invalidates every asset using it as base...
  const pix = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data).join();
  const firstInk = (data) => { for (let i = 0; i < data.length; i++) if (data[i] !== '0') return i; return -1; };
  const hi = firstInk(hero.frames[0]);
  const hx = hi % hero.w;
  const hy = Math.floor(hi / hero.w);
  const idx = parseInt(hero.frames[0][hi], 16);
  const before = c.sprite('hero', 0);
  const pal = project.palettes.find((p) => p.id === hero.palette);
  pal.colors[idx] = '#123456';
  c.invalidatePalette(pal.id);
  const after = c.sprite('hero', 0);
  out.paletteInvalidatesBase = after !== before && pix(after, hx, hy) === '18,52,86,255';
  // ...and as a swap.
  const sol = project.sprites.find((s) => s.id === 'enemy.soldier');
  const si = firstInk(sol.frames[0]);
  const sidx = parseInt(sol.frames[0][si], 16);
  const swapBefore = c.sprite('enemy.soldier', 0, 'pal.soldier.blue');
  const baseBefore = c.sprite('enemy.soldier', 0);
  const swapPal = project.palettes.find((p) => p.id === 'pal.soldier.blue');
  swapPal.colors[sidx] = '#654321';
  c.invalidatePalette('pal.soldier.blue');
  const swapAfter = c.sprite('enemy.soldier', 0, 'pal.soldier.blue');
  out.paletteInvalidatesSwap = swapAfter !== swapBefore && pix(swapAfter, si % sol.w, Math.floor(si / sol.w)) === '101,67,33,255'
    && c.sprite('enemy.soldier', 0) === (sol.palette === 'pal.soldier.blue' ? c.sprite('enemy.soldier', 0) : baseBefore);

  // Tile edit + invalidateTile; new tiles are picked up; flash silhouettes are white.
  const grass = project.tiles.find((t) => t.id === T.GRASS);
  const g0 = c.tile(T.GRASS, 0);
  grass.frames[0] = '0'.repeat(255) + '1';
  c.invalidateTile(T.GRASS);
  const g1 = c.tile(T.GRASS, 0);
  out.invalidateTile = g1 !== g0 && pix(g1, 0, 0) === '0,0,0,0' && pix(g1, 15, 15).endsWith(',255');
  project.tiles.push({ ...grass, id: 1000, key: 'USER_1', frames: ['2'.repeat(256)] });
  out.newTilePickedUp = c.tile(1000, 0) !== null;
  const fl = c.spriteFlash('hero', 0);
  out.flashWhite = pix(fl, hx, hy) === '255,255,255,255';
  c.invalidateAll();
  out.invalidateAll = c.tile(1000, 0) !== g1 && c.sprite('hero', 0) !== after;

  // Editor helpers draw scaled with smoothing off.
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  c.drawTileTo(ctx, 1000, 0, 0, 2);
  c.drawSpriteTo(ctx, 'hero', 0, 32, 0, 1, { flipX: true });
  c.drawTileTo(ctx, 5555, 0, 0, 2);
  out.drawTileTo = pix(cv, 31, 31) === pix(c.tile(1000, 0), 15, 15) && ctx.imageSmoothingEnabled === false;
  return out;
}

async function fontSpecimen() {
  const { wrapText, LINE_H } = await import('/src/gfx/font.ts');
  const r = window.__gfxRenderer;
  const cv = document.getElementById('gfx-test');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;background:#000;z-index:10';
  r.camX = 0; r.camY = 0;
  r.clear('#182048');
  let chars = '';
  for (let c = 32; c <= 126; c++) chars += String.fromCharCode(c);
  const rows = [chars.slice(0, 32), chars.slice(32, 64), chars.slice(64)];
  rows.forEach((row, i) => r.drawText(row, 8, 8 + i * LINE_H, { color: '#f8f8f8' }));
  r.drawText('Gold', 8, 44, { color: '#f0c040' });
  r.drawText('Sky', 40, 44, { color: '#80d0ff' });
  r.drawText('Leaf', 64, 44, { color: '#88e070' });
  r.drawText('Rose', 96, 44, { color: '#f07080' });
  r.drawText('no shadow', 136, 44, { shadow: false });
  r.fillRect(8, 60, 240, 72, '#000000', { screen: true, alpha: 0.6 });
  r.strokeRect(8, 60, 240, 72, '#f8f8f8', { screen: true });
  const msg = 'Elder: The Hollow Crown was lost when the old keep fell. Seek the three crystals beyond the Whispering Wood, {name}.\nWill you go?';
  const lines = wrapText(msg, 232);
  lines.forEach((l, i) => r.drawText(l, 14, 65 + i * LINE_H));
  r.drawText('left', 8, 150);
  r.drawText('center', 128, 150, { align: 'center' });
  r.drawText('right', 248, 150, { align: 'right' });
  r.drawText('Multi-line\ncentred\ntext', 128, 170, { align: 'center', color: '#f0c040' });
  r.drawText('CRLF\r\nline\ttab', 200, 170, { color: '#80d0ff' });
  r.resize();
  r.present();
  return lines.map((l) => r.measureText(l));
}

async function transformChecks() {
  const r = window.__gfxRenderer;
  const project = window.__gfxProject;
  const hero = project.sprites.find((s) => s.id === 'hero');
  const ctx = r.ctx;
  const out = {};
  const region = (x, y) => ctx.getImageData(x, y, hero.w, hero.h).data.join();
  r.camX = 0; r.camY = 0;
  r.clear('#102030');
  r.drawSpriteFrame('hero', 0, 8 + hero.ox, 8 + hero.oy, { flipX: true });
  r.drawSpriteFrame('hero', 0, 40 + hero.ox, 8 + hero.oy);
  const flipped = region(8, 8);
  const plain = region(40, 8);
  r.clear('#102030');
  ctx.save();
  ctx.translate(100, 0);
  r.drawSpriteFrame('hero', 0, 8 + hero.ox, 8 + hero.oy, { flipX: true });
  r.drawSpriteFrame('hero', 0, 40 + hero.ox, 8 + hero.oy);
  const m = ctx.getTransform();
  out.callerTransformKept = m.e === 100 && m.f === 0 && m.a === 1 && m.d === 1;
  ctx.restore();
  out.flipHonoursTranslate = region(108, 8) === flipped;
  out.plainHonoursTranslate = region(140, 8) === plain;
  // Hostile anim names draw the placeholder instead of throwing.
  r.clear('#000000');
  let threw = false;
  try {
    for (const name of ['constructor', 'toString', '__proto__']) r.drawSpriteAnim('hero', name, 0, 20, 20);
  } catch {
    threw = true;
  }
  out.prototypeAnimNames = !threw && Array.from(ctx.getImageData(20, 20, 1, 1).data.slice(0, 3)).join() === '255,0,255';
  // A light bigger than the old 128px cap still reaches the corners it covers.
  r.clear('#ffffff');
  r.darkness(1, [{ x: 128, y: 112, r: 200 }]);
  out.bigLightReaches = ctx.getImageData(0, 0, 1, 1).data[0] > 0 && ctx.getImageData(128, 112, 1, 1).data[0] === 255;
  return out;
}

async function invalidArtCheck(query) {
  window.__gfxInvalidUnmount?.();
  const { mountGallery } = await import('/src/gfx/gallery.ts');
  const p = structuredClone(window.__gfxProject);
  const tiles = [...p.tiles].sort((a, b) => a.id - b.id);
  tiles[0].frames = [tiles[0].frames[0].slice(10)];
  tiles[1].palette = 'pal.gone';
  const hero = p.sprites.find((s) => s.id === 'hero');
  hero.anims.broken = { frames: [0, 999], fps: 2, loop: true };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:30;background:#14121c';
  document.body.append(host);
  const prevHash = location.hash;
  history.replaceState(null, '', `#/gallery?${query}`);
  const unmount = mountGallery(host, p);
  history.replaceState(null, '', prevHash);
  window.__gfxInvalidUnmount = () => { unmount(); host.remove(); window.__gfxInvalidUnmount = null; };
  await new Promise((res) => setTimeout(res, 700));
  const broken = host.querySelector('.qf-gal-sprite[data-id="hero"] .qf-gal-item[data-anim="broken"]');
  broken?.scrollIntoView({ block: 'center' });
  let magenta = false;
  if (broken) {
    // The strip's second canvas shows missing frame 999.
    const strip = broken.querySelectorAll('.qf-gal-frames canvas')[1];
    magenta = !!strip && Array.from(strip.getContext('2d').getImageData(1, 1, 1, 1).data.slice(0, 3)).join() === '255,0,255';
  }
  return {
    brokenAnim: !!broken && broken.classList.contains('is-invalid') && broken.title.includes('999'),
    magenta,
    badTiles: [tiles[0].id, tiles[1].id]
      .filter((id) => host.querySelector(`.qf-gal-item.is-invalid[data-id="${id}"]`)).length,
    issues: [...host.querySelectorAll('.qf-gal-issues li')].map((li) => li.textContent),
  };
}

async function hidpiPage() {
  const { CanvasRenderer } = await import('/src/gfx/renderer.ts');
  const { presentLayout } = await import('/src/gfx/layout.ts');
  const { createDefaultAssets } = await import('/src/content/art/index.ts');
  const a = createDefaultAssets();
  const project = {
    format: 'questforge', version: 1, id: 'gfx-hidpi', name: 'gfx hidpi', author: '', description: '', created: 0, modified: 0,
    settings: { title: 'gfx', subtitle: '', startHearts: 3, startItems: {}, titleMusic: 'title' },
    palettes: a.palettes, tiles: a.tiles, terrains: a.terrains, sprites: a.sprites,
    worlds: [], dialogues: [], flags: [], start: { world: '', room: '', x: 0, y: 0 },
  };
  const frames = (n) => new Promise((res) => {
    let i = 0;
    const step = () => (++i >= n ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const dpr = window.devicePixelRatio;
  const checks = {};
  const info = { dpr };

  // 1. A canvas with no CSS size must not grow frame after frame (feedback loop).
  const bare = document.createElement('canvas');
  bare.style.cssText = 'position:fixed;left:0;top:0';
  document.body.append(bare);
  const r1 = new CanvasRenderer(bare, project);
  const sizes = [];
  for (let i = 0; i < 6; i++) {
    r1.clear('#204060');
    r1.present();
    sizes.push(`${bare.width}x${bare.height}`);
    await frames(1);
  }
  info.intrinsicSizes = sizes;
  checks.intrinsicStable = new Set(sizes.slice(-3)).size === 1;
  checks.intrinsicCrisp = Math.abs(bare.width - 300 * dpr) <= 1 && Math.abs(bare.height - 150 * dpr) <= 1
    && bare.clientWidth === 300 && bare.clientHeight === 150;
  bare.remove();

  // 2. CSS-sized canvas: backing = CSS x DPR, integer scale, centred, black bars.
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:500px;display:block';
  document.body.append(cv);
  const r = new CanvasRenderer(cv, project);
  r.clear('#ff0000');
  r.present();
  checks.backingIsCssTimesDpr = Math.abs(cv.width - 700 * dpr) <= 1 && Math.abs(cv.height - 500 * dpr) <= 1;
  const L = presentLayout(cv.width, cv.height, { scale: 0, x: 0, y: 0, w: 0, h: 0 });
  info.layout = { ...L, backing: `${cv.width}x${cv.height}` };
  const d = cv.getContext('2d');
  const at = (x, y) => Array.from(d.getImageData(x, y, 1, 1).data.slice(0, 3)).join();
  const midY = L.y + (L.h >> 1);
  checks.imageCentred = at(L.x, midY) === '255,0,0' && at(L.x + L.w - 1, midY) === '255,0,0'
    && (L.x === 0 || (at(L.x - 1, midY) === '0,0,0' && at(L.x + L.w, midY) === '0,0,0'));
  if (dpr === 2) checks.dpr2Scale4 = L.scale === 4 && L.x === 188 && L.y === 52;

  // 3. Fractional sizes use the exact device-pixel box (no browser resampling).
  const odd = document.createElement('canvas');
  odd.style.cssText = 'position:fixed;left:0;top:520px;width:1023px;height:301px;display:block';
  document.body.append(odd);
  const exact = await new Promise((res) => {
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e.devicePixelContentBoxSize?.[0];
      ro.disconnect();
      res(box ? [box.inlineSize, box.blockSize] : [Math.round(1023 * dpr), Math.round(301 * dpr)]);
    });
    try { ro.observe(odd, { box: 'device-pixel-content-box' }); } catch { ro.observe(odd); }
  });
  const r3 = new CanvasRenderer(odd, project);
  r3.clear('#00ff00');
  r3.present();
  await frames(3);
  r3.present();
  // Chromium's DPR emulation reports device-pixel boxes at 1x; the renderer then falls back to CSS x DPR.
  const expectAxis = (dev, css) => (Math.abs(dev - css * dpr) <= 1 ? dev : Math.round(css * dpr));
  const expected = [expectAxis(exact[0], 1023), expectAxis(exact[1], 301)];
  info.fractional = { exact, expected, backing: [odd.width, odd.height] };
  checks.exactDevicePixels = odd.width === expected[0] && odd.height === expected[1];
  odd.remove();

  // Showcase frame for the screenshot.
  r.clear('#284878');
  r.camX = 0; r.camY = 0;
  const { T } = await import('/src/content/ids.ts');
  for (let tx = 0; tx < 16; tx++) for (let ty = 8; ty < 14; ty++) r.drawTile(T.GRASS, tx * 16, ty * 16);
  r.drawShadow(96, 150, 14);
  r.drawSpriteAnim('hero', 'idle_down', 0, 96, 146);
  r.drawSpriteAnim('hero', 'walk_left', 0.1, 128, 146);
  r.drawSpriteAnim('enemy.soldier', 'walk_down', 0, 160, 170, { palette: 'pal.soldier.blue' });
  r.drawText(`present() at devicePixelRatio ${dpr}`, 128, 40, { align: 'center' });
  r.drawText(`backing ${cv.width}x${cv.height}, scale ${L.scale}`, 128, 52, { align: 'center', color: '#f0c040' });
  r.present();
  return { checks, info };
}
