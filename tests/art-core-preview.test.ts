// Visual previews of the core sprite art -> e2e-out/sheets/core-*.png. Skipped unless QF_SHEETS=1:
//   QF_SHEETS=1 npx vitest run tests/art-core-preview.test.ts
// Output:
//   core-hero-<facing>.png   every hero anim for that facing, 6x (swim frames over water)
//   core-hero-misc.png       item_get / fall / die, 6x
//   core-attacks.png         every attack frame with its fx.sword blade placed via HERO_SWORD_POSES, 8x,
//                            on grass (top) and dungeon floor (bottom)
//   core-scene-grass.png / core-scene-stone.png   hero walk + attack (with fx.sword blades placed via
//                            HERO_SWORD_POSES) and rows of pickups/objects over grass and dungeon floor, 3x
//   core-dungeon-room.png    doors on all four walls of a room built from the real dungeon wall tiles, 3x
//   core-<group>.png         montages of every other core sprite (weapons, fx, items, objects, doors, hud, editor)
import { describe, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { buildCoreSpriteArt, HERO_SWORD_POSES } from '../src/content/art/sprites-core';
import type { Palette, SpriteDef } from '../src/core/types';
import { Raster, drawFrame, renderScene, writePng } from './tools/png';
import { T } from '../src/content/ids';

const OUT = 'e2e-out/sheets';

type RGB = [number, number, number];

interface Cell {
  sprite: SpriteDef;
  frame: number;
  flipX?: boolean;
  palette?: string;
  /** Backdrop override for this cell. */
  bg?: RGB;
}

const GRASS: RGB = [88, 168, 64];
const FLOOR: RGB = [52, 58, 80];
const WATER: RGB = [48, 108, 184];

describe.skipIf(!process.env.QF_SHEETS)('core sprite previews', () => {
  const art = buildCoreSpriteArt();
  const pals = new Map<string, Palette>(art.palettes.map((p) => [p.id, p]));
  const byId = new Map(art.sprites.map((s) => [s.id, s]));
  const sprite = (id: string): SpriteDef => byId.get(id)!;
  mkdirSync(OUT, { recursive: true });

  /** Grid of cells; each row is a list of cells (null = gap). */
  function grid(rows: (Cell | null)[][], scale: number, cw: number, ch: number, bg?: RGB): Raster {
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const r = new Raster(cols * (cw * scale + 4) + 4, rows.length * (ch * scale + 4) + 4);
    rows.forEach((row, y) => row.forEach((c, x) => {
      const px = 4 + x * (cw * scale + 4);
      const py = 4 + y * (ch * scale + 4);
      const back = c?.bg ?? bg;
      if (back) r.fill(px, py, cw * scale, ch * scale, back);
      else r.checker(px, py, cw * scale, ch * scale, scale * 2);
      if (!c) return;
      const pal = pals.get(c.palette ?? c.sprite.palette);
      if (!pal) return;
      drawFrame(r, c.sprite.frames[c.frame]!, c.sprite.w, c.sprite.h, pal, px, py, scale, !!c.flipX);
    }));
    return r;
  }

  function animCells(s: SpriteDef, names: string[], palette?: string, bg?: RGB): Cell[] {
    return names.flatMap((n) => {
      const a = s.anims[n]!;
      return a.frames.map((f) => ({ sprite: s, frame: f, flipX: a.flipX, palette, bg }));
    });
  }

  it('hero sheets', () => {
    const hero = sprite('hero');
    for (const f of ['down', 'up', 'right', 'left']) {
      const rows = [
        animCells(hero, [`idle_${f}`, `walk_${f}`, `attack_${f}`]),
        animCells(hero, [`push_${f}`, `lift_${f}`, `carry_${f}`, `use_${f}`]),
        [...animCells(hero, [`swim_${f}`], undefined, WATER), ...animCells(hero, [`hurt_${f}`])],
      ];
      for (const bg of [GRASS, FLOOR]) writePng(`${OUT}/core-hero-${f}${bg === GRASS ? '' : '-dark'}.png`, grid(rows, 6, 16, 24, bg));
    }
    writePng(`${OUT}/core-hero-misc.png`, grid([animCells(hero, ['item_get', 'fall', 'die'])], 6, 16, 24, GRASS));
  });

  it('attack composites', () => {
    const scale = 8;
    const cell = 40;
    const facings = ['down', 'up', 'right', 'left'] as const;
    const r = new Raster(12 * cell * scale, 2 * cell * scale);
    [GRASS, FLOOR].forEach((bg, row) => {
      r.fill(0, row * cell * scale, r.w, cell * scale, bg);
      facings.forEach((f, fi) => {
        for (let i = 0; i < 3; i++) {
          const x = (fi * 3 + i) * cell + 20;
          drawAttack(r, f, i, x, row * cell + 26, scale);
        }
      });
    });
    writePng(`${OUT}/core-attacks.png`, r);
  });

  function drawSprite(r: Raster, s: SpriteDef, anim: string, i: number, x: number, y: number, scale: number, palette?: string): void {
    const a = s.anims[anim]!;
    const pal = pals.get(palette ?? s.palette);
    if (!pal) return;
    drawFrame(r, s.frames[a.frames[i % a.frames.length]!]!, s.w, s.h, pal, (x - s.ox) * scale, (y - s.oy) * scale, scale, !!a.flipX);
  }

  /** Attack frame `i` of `facing` with its blade, as the player draws it; (x, y) = entity position. */
  function drawAttack(r: Raster, facing: keyof typeof HERO_SWORD_POSES, i: number, x: number, y: number, scale: number, palette?: string): void {
    const p = HERO_SWORD_POSES[facing][i]!;
    const blade = (): void => drawSprite(r, sprite('fx.sword'), p.blade, 0, x + p.dx, y + p.dy, scale, palette);
    if (p.behind) blade();
    drawSprite(r, sprite('hero'), `attack_${facing}`, i, x, y, scale);
    if (!p.behind) blade();
  }

  function scene(name: string, ground: (x: number, y: number) => RGB): void {
    const scale = 3;
    const w = 256;
    const h = 176;
    const r = new Raster(w * scale, h * scale);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.fill(x * scale, y * scale, scale, scale, ground(x, y));
    const hero = sprite('hero');
    // Row 1: walk cycles for each facing.
    let x = 16;
    for (const f of ['down', 'up', 'right', 'left']) {
      for (let i = 0; i < 4; i++) {
        drawSprite(r, hero, `walk_${f}`, i, x, 30, scale);
        x += 16;
      }
      x += 4;
    }
    // Row 2: attack frames with blades.
    x = 20;
    for (const f of ['down', 'up', 'right', 'left'] as const) {
      for (let i = 0; i < 3; i++) {
        drawAttack(r, f, i, x, 72, scale, i === 2 && f === 'left' ? 'pal.sword.2' : undefined);
        x += 20;
      }
      x += 4;
    }
    // Row 3: pickups.
    const pickup = sprite('pickup');
    x = 12;
    for (const n of Object.keys(pickup.anims)) {
      drawSprite(r, pickup, n, 0, x, 104, scale);
      x += 17;
    }
    // Row 4: objects.
    x = 12;
    const objs: [string, string][] = [['obj.chest', 'closed'], ['obj.chest', 'open'], ['obj.block', 'idle'], ['obj.block', 'heavy'],
      ['obj.switch', 'up'], ['obj.switch', 'down'], ['obj.crystalSwitch', 'red'], ['obj.crystalSwitch', 'blue'], ['obj.peg', 'red_up'],
      ['obj.peg', 'blue_down'], ['obj.torch', 'unlit'], ['obj.torch', 'lit'], ['obj.pot', 'idle'], ['obj.sign', 'idle'], ['obj.bomb', 'idle']];
    for (const [id, anim] of objs) {
      drawSprite(r, sprite(id), anim, 0, x, 132, scale);
      x += 17;
    }
    drawSprite(r, sprite('obj.bigChest'), 'closed', 0, 30, 160, scale);
    drawSprite(r, sprite('obj.bigChest'), 'open', 0, 66, 160, scale);
    drawSprite(r, sprite('obj.doorNS'), 'locked_up', 0, 110, 160, scale);
    drawSprite(r, sprite('obj.doorNS'), 'open_down', 0, 146, 160, scale);
    drawSprite(r, sprite('obj.doorEW'), 'shutter_left', 0, 176, 158, scale);
    drawSprite(r, sprite('obj.doorEW'), 'bigKey_right', 0, 196, 158, scale);
    drawSprite(r, sprite('hero'), 'idle_down', 0, 226, 164, scale);
    drawSprite(r, sprite('hero'), 'carry_right', 0, 244, 164, scale);
    writePng(`${OUT}/core-scene-${name}.png`, r);
  }

  it('scenes over grass and stone', () => {
    scene('grass', (x, y) => ((x * 7 + y * 13) % 29 === 0 ? [64, 136, 48] : (x + y * 3) % 23 === 0 ? [120, 192, 80] : [88, 168, 64]));
    scene('stone', (x, y) => (x % 16 === 0 || y % 16 === 0 ? [36, 40, 58] : (x + y) % 16 === 1 ? [74, 82, 108] : [56, 62, 86]));
  });

  it('dungeon room with doors', async () => {
    let tiles;
    try {
      tiles = (await import('../src/content/art/tiles')).buildTileArt();
    } catch {
      return; // tile art mid-edit: skip the room preview
    }
    const cols = 12;
    const rows = 9;
    const bg: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const l = x === 0;
        const r = x === cols - 1;
        const t = y === 0;
        const b = y === rows - 1;
        const key = t && l ? 'DWALL_TL' : t && r ? 'DWALL_TR' : b && l ? 'DWALL_BL' : b && r ? 'DWALL_BR'
          : t ? 'DWALL_TOP' : b ? 'DWALL_BOTTOM' : l ? 'DWALL_LEFT' : r ? 'DWALL_RIGHT' : 'DFLOOR';
        bg.push(T[key]!);
      }
    }
    const scale = 3;
    const r = renderScene(tiles.tiles, [...tiles.palettes, ...art.palettes], { bg }, cols, rows, scale);
    const put = (id: string, anim: string, x: number, y: number): void => drawSprite(r, sprite(id), anim, 0, x, y, scale);
    put('obj.doorNS', 'locked_up', 48, 8);
    put('obj.doorNS', 'bigKey_up', 128, 8);
    put('obj.doorNS', 'open_down', 48, 136);
    put('obj.doorNS', 'cracked_down', 128, 136);
    put('obj.doorEW', 'shutter_left', 8, 48);
    put('obj.doorEW', 'bombed_left', 8, 104);
    put('obj.doorEW', 'open_right', 184, 48);
    put('obj.doorEW', 'cracked_right', 184, 104);
    put('obj.chest', 'closed', 40, 40);
    put('obj.block', 'idle', 72, 40);
    put('obj.pot', 'idle', 104, 40);
    put('obj.torch', 'lit', 152, 40);
    put('obj.crystalSwitch', 'blue', 40, 104);
    put('obj.peg', 'red_up', 72, 104);
    put('obj.peg', 'blue_down', 88, 104);
    put('obj.switch', 'up', 152, 104);
    put('pickup', 'rupee_blue', 120, 104);
    put('hero', 'walk_right', 104, 80);
    put('obj.bigChest', 'closed', 144, 76);
    writePng(`${OUT}/core-dungeon-room.png`, r);
  });

  /** One montage per sprite group: each row = every frame of one sprite (optionally a palette swap). */
  const GROUPS: Record<string, { size: [number, number]; scale: number; rows: [string, string?][] }> = {
    weapons: {
      size: [16, 16], scale: 6,
      rows: [['fx.sword'], ['fx.sword', 'pal.sword.2'], ['proj.arrow'], ['proj.spear'], ['proj.rock'], ['proj.boomerang'],
        ['proj.boomerang', 'pal.boomerang.2'], ['proj.hookshot'], ['proj.fireball'], ['proj.beam'], ['proj.bone']],
    },
    fx: {
      size: [16, 16], scale: 6,
      rows: [['fx.poof'], ['fx.hit'], ['fx.splash'], ['fx.leaves'], ['fx.shatter'], ['fx.sparkle'], ['fx.dust'], ['fx.flame']],
    },
    explosion: { size: [32, 32], scale: 5, rows: [['fx.explosion']] },
    items: { size: [16, 16], scale: 5, rows: [['pickup'], ['item'], ['obj.bomb']] },
    objects: {
      size: [16, 16], scale: 6,
      rows: [['obj.chest'], ['obj.block'], ['obj.switch'], ['obj.crystalSwitch'], ['obj.peg'], ['obj.torch'], ['obj.pot'], ['obj.sign']],
    },
    bigchest: { size: [32, 24], scale: 5, rows: [['obj.bigChest']] },
    doorsNS: { size: [32, 16], scale: 4, rows: [['obj.doorNS']] },
    doorsEW: { size: [16, 32], scale: 4, rows: [['obj.doorEW']] },
    hud: { size: [8, 8], scale: 10, rows: [['hud']] },
    editor: { size: [16, 16], scale: 6, rows: [['editor.icons']] },
  };

  it('group montages', () => {
    for (const [name, g] of Object.entries(GROUPS)) {
      const perRow = Math.max(4, Math.floor(1200 / (g.size[0] * g.scale + 4)));
      const rows: Cell[][] = [];
      for (const [id, pal] of g.rows) {
        const s = sprite(id);
        const cells = animCells(s, Object.keys(s.anims), pal).filter((c) => !c.flipX);
        for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow));
      }
      writePng(`${OUT}/core-${name}.png`, grid(rows, g.scale, g.size[0], g.size[1]));
    }
  });
});
