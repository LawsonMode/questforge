// Actor sprite art through the real app: gallery sections for enemies, bosses and
// NPCs (every card draws, colour-swap rows are complete) and a 256x224 scene
// drawn with the real CanvasRenderer (tiles + actors, palette swaps, flipped
// anims, a chained worm) at native resolution, shown 3x.
import { join } from 'node:path';

const GROUPS = [['enemies', 'enemy.'], ['bosses', 'boss.'], ['npcs', 'npc.']];
const SWAPS = { 'enemy.soldier': 3, 'enemy.archer': 2, 'enemy.spitter': 2, 'enemy.slime': 3 };

export default async function (t) {
  for (const [label, filter] of GROUPS) {
    await t.goto(`#/gallery?section=sprites&filter=${encodeURIComponent(filter)}`);
    await t.wait(150);
    const info = await t.eval(() => {
      const cards = [...document.querySelectorAll('.qf-gal-sprite')];
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
    t.assert(info.ids.length > 0, `${label}: gallery shows sprites for "${filter}"`);
    t.assert(info.drawn === info.ids.length, `${label}: every card draws pixels (${info.drawn}/${info.ids.length})`);
    await t.shot(`gallery-${label}`);
  }

  for (const [id, n] of Object.entries(SWAPS)) {
    await t.goto(`#/gallery?section=sprites&filter=${encodeURIComponent(id)}`);
    await t.wait(100);
    const got = await t.eval((sid) => {
      const card = document.querySelector(`.qf-gal-sprite[data-id="${sid}"]`);
      return card ? card.querySelectorAll('.qf-gal-swaps canvas').length : -1;
    }, id);
    t.assert(got === n, `${id}: swap row shows ${n} palettes (got ${got})`);
  }

  // A scene drawn by the real renderer.
  await t.goto('#/');
  const res = await t.eval(async () => {
    const { createDefaultAssets } = await import('/src/content/art/index.ts');
    const { CanvasRenderer } = await import('/src/gfx/renderer.ts');
    const { T } = await import('/src/content/ids.ts');
    const assets = createDefaultAssets();
    const project = { palettes: assets.palettes, tiles: assets.tiles, terrains: assets.terrains, sprites: assets.sprites };
    const cv = document.createElement('canvas');
    cv.id = 'qf-actor-scene';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:768px;height:672px;z-index:9999;background:#000';
    document.body.appendChild(cv);
    const r = new CanvasRenderer(cv, project);
    r.clear('#000');
    for (let ty = 0; ty < 14; ty++) {
      for (let tx = 0; tx < 16; tx++) r.drawTile(ty < 7 ? T.GRASS : T.DFLOOR, tx * 16, ty * 16);
    }
    const sprite = (id) => project.sprites.find((s) => s.id === id);
    const at = (id, anim, frame, x, y, opts) => {
      const a = sprite(id).anims[anim];
      r.drawSpriteAnim(id, anim, (frame + 0.5) / a.fps, x, y, opts);
    };
    const row1 = [
      ['enemy.soldier', 'walk_down', {}], ['enemy.soldier', 'walk_down', { palette: 'pal.soldier.blue' }],
      ['enemy.soldier', 'walk_down', { palette: 'pal.soldier.red' }], ['enemy.archer', 'shoot_right', {}],
      ['enemy.goblin', 'walk_left', {}], ['npc.villager', 'idle_down', {}], ['npc.elder', 'walk_left', {}],
      ['npc.child', 'idle_down', {}], ['npc.guard', 'idle_down', {}], ['npc.merchant', 'walk_right', {}],
      ['npc.sage', 'idle_down', {}],
    ];
    row1.forEach(([id, anim, opts], i) => at(id, anim, i % 2, 12 + i * 22, 40, opts));
    const row2 = [
      ['enemy.spitter', 'walk_down', {}], ['enemy.spitter', 'walk_left', { palette: 'pal.spitter.blue' }],
      ['enemy.slime', 'idle', {}], ['enemy.slime', 'idle', { palette: 'pal.slime.red' }],
      ['enemy.slime', 'idle', { palette: 'pal.slime.blue' }], ['enemy.snake', 'walk_right', {}],
      ['enemy.beetle', 'walk', {}], ['enemy.bat', 'fly', {}], ['enemy.eye', 'sw', {}],
    ];
    row2.forEach(([id, anim, opts], i) => at(id, anim, i % 2, 14 + i * 26, 84, opts));
    const row3 = [['enemy.skeleton', 'walk'], ['enemy.ghost', 'float'], ['enemy.bladeTrap', 'idle'], ['enemy.eye', 'n']];
    row3.forEach(([id, anim], i) => at(id, anim, 0, 16 + i * 24, 132));
    // Chained worm crossing the lower floor.
    at('boss.worm', 'tail', 0, 20, 190);
    for (let i = 0; i < 3; i++) at('boss.worm', 'body', 0, 38 + i * 16, 186 - i * 3);
    at('boss.worm', 'head', 1, 100, 176);
    at('boss.knight', 'walk_down', 0, 160, 150);
    at('boss.knight', 'stun', 0, 200, 206);
    at('boss.knight', 'attack_left', 0, 224, 150);
    r.present();
    const d = r.backbuffer.getContext('2d').getImageData(0, 0, 256, 224).data;
    let colours = new Set();
    for (let i = 0; i < d.length; i += 4 * 7) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return { colours: colours.size, sprites: project.sprites.length };
  });
  t.log('scene', res);
  t.assert(res.colours > 40, `scene renders varied colours (${res.colours})`);
  await t.page.locator('#qf-actor-scene').screenshot({ path: join(t.outDir, 'scene-3x.png') });
}
