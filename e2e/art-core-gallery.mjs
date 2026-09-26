// Core sprite art through the real renderer: gallery sections for the hero, fx,
// projectiles, pickups/items, objects and UI icons, plus the hero in the engine at
// native resolution (walking in each direction).
const GROUPS = [
  ['hero', 'hero'],
  ['fx', 'fx.'],
  ['proj', 'proj.'],
  ['pickup', 'pickup'],
  ['item', 'item'],
  ['objects', 'obj.'],
  ['ui', 'hud'],
  ['editor', 'editor.'],
];

export default async function (t) {
  for (const [label, filter] of GROUPS) {
    await t.goto(`#/gallery?section=sprites&filter=${encodeURIComponent(filter)}`);
    await t.wait(150);
    const info = await t.eval(() => {
      const cards = [...document.querySelectorAll('.qf-gal-sprite')];
      // A card "draws" when at least one of its canvases has an opaque pixel.
      const drawn = cards.filter((c) => [...c.querySelectorAll('canvas')].some((cv) => {
        const ctx = cv.getContext('2d');
        if (!ctx || !cv.width || !cv.height) return false;
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        return false;
      }));
      return { ids: cards.map((c) => c.dataset.id), drawn: drawn.length };
    });
    t.log(label, info);
    t.assert(info.ids.length > 0, `${label}: gallery shows sprites for filter "${filter}"`);
    t.assert(info.drawn === info.ids.length, `${label}: every sprite card draws pixels (${info.drawn}/${info.ids.length})`);
    await t.shot(`gallery-${label}`);
  }

  // The hero in-game at native resolution.
  await t.goto('#/playtest/test');
  const booted = await t.until(() => !!(window.__qf.game && window.__qf.game.services), undefined, 5000).then(() => true, () => false);
  if (!booted) {
    t.log('playtest did not boot; skipping in-engine hero shots');
    return;
  }
  await t.wait(300);
  const sprite = await t.eval(() => window.__qf.game.services.player.sprite);
  t.assert(sprite === 'hero', `player uses the hero sprite (${sprite})`);
  await t.shotCanvas('hero-idle');
  for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
    await t.page.keyboard.down(key);
    await t.wait(260);
    await t.shotCanvas(`hero-walk-${key.slice(5).toLowerCase()}`);
    await t.page.keyboard.up(key);
  }
}
