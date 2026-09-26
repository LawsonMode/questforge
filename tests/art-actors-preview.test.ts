// Visual preview of the actor sprites (skipped unless QF_SHEETS=1):
//   QF_SHEETS=1 npx vitest run tests/art-actors-preview.test.ts
// Writes e2e-out/sheets/actors-lineup.png: every enemy, boss and NPC standing on
// grass and dungeon floor (real tiles when the tile module is ready, flat colour
// otherwise), including the soldier colour swaps, a chained worm and the core
// hero beside its closest look-alikes, plus e2e-out/sheets/actors-motion.png
// with every anim frame side by side, e2e-out/sheets/actors-zoom-<id>.png: each
// sprite's authored frames at 5-8x, and actors-group-<name>.png: one row of
// authored frames per sprite in a family. Add QF_ACTOR=<id>[,<id>] for gridded
// actors-focus-<id>.png sheets plus hex dumps (see the 'focus' test).
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { buildActorSpriteArt } from '../src/content/art/sprites-actors';
import { T } from '../src/content/ids';
import type { Palette, SpriteDef, TileDef } from '../src/core/types';
import { Raster, drawFrame, writePng } from './tools/png';

const OUT = 'e2e-out/sheets';
const SCALE = 3;

interface Placed {
  sprite: string;
  anim: string;
  frame?: number;
  x: number;
  y: number;
  palette?: string;
}

async function loadTiles(): Promise<{ tiles: TileDef[]; palettes: Palette[] } | null> {
  try {
    const m = await import('../src/content/art/tiles');
    return m.buildTileArt();
  } catch {
    return null;
  }
}

/** The core hero sprite and palettes when that module is ready (for look-alike checks). */
async function loadHero(): Promise<{ sprite: SpriteDef; palettes: Palette[] } | null> {
  try {
    const m = await import('../src/content/art/sprites-core');
    const core = m.buildCoreSpriteArt();
    const sprite = core.sprites.find((s) => s.id === 'hero');
    return sprite ? { sprite, palettes: core.palettes } : null;
  } catch {
    return null;
  }
}

describe.skipIf(!process.env.QF_SHEETS)('actor art preview', () => {
  const art = buildActorSpriteArt();
  const sprites = new Map(art.sprites.map((s) => [s.id, s]));
  const pals = new Map(art.palettes.map((p) => [p.id, p]));

  function place(r: Raster, p: Placed, ox = 0, oy = 0): void {
    const s = sprites.get(p.sprite);
    if (!s) throw new Error(`missing sprite ${p.sprite}`);
    const a = s.anims[p.anim];
    if (!a) throw new Error(`missing anim ${p.sprite}.${p.anim}`);
    const pal = pals.get(p.palette ?? s.palette)!;
    const fi = a.frames[(p.frame ?? 0) % a.frames.length]!;
    drawFrame(r, s.frames[fi]!, s.w, s.h, pal, (ox + p.x - s.ox) * SCALE, (oy + p.y - s.oy) * SCALE, SCALE, !!a.flipX);
  }

  async function backdrop(r: Raster, tileKey: string, flat: [number, number, number], x0: number, y0: number, cols: number, rows: number): Promise<void> {
    const set = await loadTiles();
    const tile = set?.tiles.find((t) => t.id === T[tileKey]);
    const pal = tile && set?.palettes.find((p) => p.id === tile.palette);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const px = (x0 + tx * 16) * SCALE;
        const py = (y0 + ty * 16) * SCALE;
        if (tile && pal) drawFrame(r, tile.frames[0]!, 16, 16, pal, px, py, SCALE);
        else r.fill(px, py, 16 * SCALE, 16 * SCALE, flat);
      }
    }
  }

  it('lineup', async () => {
    const cols = 20;
    const W = cols * 16;
    const bands = [
      { tile: 'GRASS', flat: [72, 152, 56] as [number, number, number], rows: 3 },
      { tile: 'GRASS', flat: [72, 152, 56] as [number, number, number], rows: 3 },
      { tile: 'DFLOOR', flat: [70, 78, 104] as [number, number, number], rows: 3 },
      { tile: 'DFLOOR', flat: [70, 78, 104] as [number, number, number], rows: 4 },
      { tile: 'GRASS', flat: [72, 152, 56] as [number, number, number], rows: 3 },
      { tile: 'GRASS', flat: [72, 152, 56] as [number, number, number], rows: 2 },
    ];
    const H = bands.reduce((n, b) => n + b.rows * 16, 0);
    const r = new Raster(W * SCALE, H * SCALE);
    let y = 0;
    const tops: number[] = [];
    for (const b of bands) {
      await backdrop(r, b.tile, b.flat, 0, y, cols, b.rows);
      tops.push(y);
      y += b.rows * 16;
    }
    const row = (band: number, list: Omit<Placed, 'y'>[], feet = 36): void => {
      for (const p of list) place(r, { ...p, y: tops[band]! + feet });
    };
    // Overworld troops (colour swaps) and creatures.
    row(0, [
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 12 },
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 30, palette: 'pal.soldier.blue' },
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 48, palette: 'pal.soldier.red' },
      { sprite: 'enemy.soldier', anim: 'walk_right', x: 68 },
      { sprite: 'enemy.soldier', anim: 'walk_up', x: 86, palette: 'pal.soldier.blue' },
      { sprite: 'enemy.soldier', anim: 'attack_right', x: 104, palette: 'pal.soldier.red' },
      { sprite: 'enemy.soldier', anim: 'walk_left', x: 124 },
      { sprite: 'enemy.archer', anim: 'walk_down', x: 146 },
      { sprite: 'enemy.archer', anim: 'walk_down', x: 164, palette: 'pal.archer.blue' },
      { sprite: 'enemy.archer', anim: 'shoot_right', x: 182 },
      { sprite: 'enemy.archer', anim: 'walk_up', x: 200 },
      { sprite: 'enemy.goblin', anim: 'walk_down', x: 222 },
      { sprite: 'enemy.goblin', anim: 'walk_right', x: 242 },
      { sprite: 'enemy.goblin', anim: 'throw_right', x: 262 },
      { sprite: 'enemy.goblin', anim: 'walk_up', x: 282 },
      { sprite: 'enemy.goblin', anim: 'throw_down', x: 302 },
    ]);
    row(1, [
      { sprite: 'enemy.spitter', anim: 'walk_down', x: 12 },
      { sprite: 'enemy.spitter', anim: 'walk_right', x: 32, palette: 'pal.spitter.blue' },
      { sprite: 'enemy.spitter', anim: 'walk_up', x: 52 },
      { sprite: 'enemy.snake', anim: 'walk_right', x: 74 },
      { sprite: 'enemy.snake', anim: 'walk_down', x: 94 },
      { sprite: 'enemy.snake', anim: 'walk_up', x: 114 },
      { sprite: 'enemy.slime', anim: 'idle', x: 136 },
      { sprite: 'enemy.slime', anim: 'idle', x: 156, palette: 'pal.slime.red' },
      { sprite: 'enemy.slime', anim: 'idle', x: 176, palette: 'pal.slime.blue' },
      { sprite: 'enemy.slime', anim: 'small_idle', x: 192 },
      { sprite: 'enemy.slime', anim: 'small_idle', x: 204, palette: 'pal.slime.red' },
      { sprite: 'enemy.beetle', anim: 'walk', x: 224 },
      { sprite: 'enemy.bat', anim: 'fly', x: 246 },
      { sprite: 'enemy.bat', anim: 'fly', frame: 1, x: 266 },
      { sprite: 'enemy.eye', anim: 'sw', x: 290 },
    ], 30);
    // Dungeon dwellers.
    row(2, [
      { sprite: 'enemy.skeleton', anim: 'walk', x: 14 },
      { sprite: 'enemy.skeleton', anim: 'jump', x: 34 },
      { sprite: 'enemy.ghost', anim: 'float', x: 56 },
      { sprite: 'enemy.ghost', anim: 'float', frame: 1, x: 76 },
      { sprite: 'enemy.eye', anim: 's', x: 98 },
      { sprite: 'enemy.eye', anim: 'e', x: 118 },
      { sprite: 'enemy.bladeTrap', anim: 'idle', x: 140 },
      { sprite: 'enemy.bat', anim: 'rest', x: 160 },
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 180, palette: 'pal.soldier.red' },
      { sprite: 'boss.knight', anim: 'walk_down', x: 210 },
      { sprite: 'boss.knight', anim: 'charge', x: 246 },
      { sprite: 'boss.knight', anim: 'stun', x: 284 },
    ], 30);
    // Bosses: chained worm (head, 3 body segments, tail) and knight poses.
    const wormY = tops[3]! + 30;
    const chain: Placed[] = [
      { sprite: 'boss.worm', anim: 'tail', x: 20, y: wormY + 10 },
      { sprite: 'boss.worm', anim: 'body', x: 36, y: wormY + 6 },
      { sprite: 'boss.worm', anim: 'body', x: 52, y: wormY + 2 },
      { sprite: 'boss.worm', anim: 'body', x: 68, y: wormY },
      { sprite: 'boss.worm', anim: 'head', x: 88, y: wormY - 2 },
    ];
    for (const p of chain) place(r, p);
    place(r, { sprite: 'boss.worm', anim: 'tail', frame: 1, x: 118, y: wormY });
    place(r, { sprite: 'boss.worm', anim: 'head', frame: 1, x: 148, y: wormY });
    row(3, [
      { sprite: 'boss.knight', anim: 'walk_right', x: 188 },
      { sprite: 'boss.knight', anim: 'walk_up', x: 222 },
      { sprite: 'boss.knight', anim: 'attack_down', x: 256 },
      { sprite: 'boss.knight', anim: 'attack_left', x: 294 },
    ], 46);
    // Villagers.
    const npcs = ['villager', 'elder', 'child', 'guard', 'merchant', 'sage'];
    row(4, npcs.flatMap((n, i) => [
      { sprite: `npc.${n}`, anim: 'idle_down', x: 12 + i * 52 },
      { sprite: `npc.${n}`, anim: 'walk_right', x: 30 + i * 52 },
      { sprite: `npc.${n}`, anim: 'idle_up', x: 48 + i * 52 },
    ]));
    // The hero beside the troops and the friendly guard: none should be mistaken for another.
    row(5, [
      { sprite: 'enemy.archer', anim: 'walk_down', x: 36 },
      { sprite: 'enemy.archer', anim: 'walk_right', x: 54 },
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 72 },
      { sprite: 'enemy.soldier', anim: 'walk_down', x: 90, palette: 'pal.soldier.blue' },
      { sprite: 'npc.guard', anim: 'idle_down', x: 108 },
      { sprite: 'npc.guard', anim: 'walk_right', x: 126 },
    ], 26);
    const hero = await loadHero();
    const idle = hero?.sprite.anims.idle_down ?? hero?.sprite.anims.walk_down;
    const heroPal = hero?.palettes.find((p) => p.id === hero.sprite.palette);
    if (hero && idle && heroPal) {
      const s = hero.sprite;
      drawFrame(r, s.frames[idle.frames[0]!]!, s.w, s.h, heroPal, (14 - s.ox) * SCALE, (tops[5]! + 26 - s.oy) * SCALE, SCALE);
    }
    writePng(`${OUT}/actors-lineup.png`, r);
  });

  it('motion', () => {
    // Every anim of every actor, frames left to right (anims separated by a gap).
    const maxW = 300;
    interface Cell { anim: string; frame: number; x: number }
    const lines: { s: SpriteDef; cells: Cell[] }[] = [];
    for (const s of art.sprites) {
      let cells: Cell[] = [];
      let x = 2;
      for (const anim of Object.keys(s.anims)) {
        const n = s.anims[anim]!.frames.length;
        if (x + n * (s.w + 2) > maxW && cells.length) {
          lines.push({ s, cells });
          cells = [];
          x = 2;
        }
        for (let f = 0; f < n; f++, x += s.w + 2) cells.push({ anim, frame: f, x });
        x += 6;
      }
      if (cells.length) lines.push({ s, cells });
    }
    const H = lines.reduce((n, l) => n + l.s.h + 4, 0);
    const r = new Raster(maxW * SCALE, H * SCALE);
    let y = 0;
    lines.forEach((l, li) => {
      r.fill(0, y * SCALE, r.w, (l.s.h + 4) * SCALE, li % 2 ? [70, 78, 104] : [72, 152, 56]);
      for (const c of l.cells) place(r, { sprite: l.s.id, anim: c.anim, frame: c.frame, x: c.x + l.s.ox, y: y + 2 + l.s.oy });
      y += l.s.h + 4;
    });
    writePng(`${OUT}/actors-motion.png`, r);
  });

  it('zoom', () => {
    for (const s of art.sprites) {
      const z = s.w > 16 ? 5 : 8;
      const names = Object.keys(s.anims).filter((n) => !s.anims[n]!.flipX);
      const cells = names.flatMap((n) => s.anims[n]!.frames.map((fi) => fi));
      const perRow = s.w > 16 ? 4 : 6;
      const rowsN = Math.ceil(cells.length / perRow);
      const r = new Raster(perRow * (s.w + 2) * z, rowsN * (s.h + 2) * z, [96, 104, 88]);
      const pal = pals.get(s.palette)!;
      cells.forEach((fi, i) => {
        drawFrame(r, s.frames[fi]!, s.w, s.h, pal, (i % perRow) * (s.w + 2) * z + z, Math.floor(i / perRow) * (s.h + 2) * z + z, z);
      });
      writePng(`${OUT}/actors-zoom-${s.id}.png`, r);
    }
  });

  // QF_ACTOR=enemy.goblin[,boss.knight] writes actors-focus-<id>.png (every
  // authored frame at 12x over grass with a pixel grid, a bright line every 4 px) and
  // actors-focus-<id>.txt (each frame as hex rows for pixel-exact editing).
  it.skipIf(!process.env.QF_ACTOR)('focus', () => {
    for (const id of (process.env.QF_ACTOR ?? '').split(',')) {
      const dump: string[] = [];
      const s = sprites.get(id);
      if (!s) throw new Error(`missing sprite ${id}`);
      const z = 12;
      const names = Object.keys(s.anims).filter((n) => !s.anims[n]!.flipX);
      const cells = names.flatMap((n) => s.anims[n]!.frames.map((fi, k) => ({ name: `${n}#${k}`, fi })));
      const perRow = Math.min(cells.length, s.w > 16 ? 3 : 6);
      const cw = (s.w + 2) * z;
      const ch = (s.h + 2) * z;
      const r = new Raster(perRow * cw, Math.ceil(cells.length / perRow) * ch, [60, 64, 72]);
      const pal = pals.get(s.palette)!;
      cells.forEach(({ name, fi }, i) => {
        const x0 = (i % perRow) * cw + z;
        const y0 = Math.floor(i / perRow) * ch + z;
        r.fill(x0, y0, s.w * z, s.h * z, [72, 152, 56]);
        drawFrame(r, s.frames[fi]!, s.w, s.h, pal, x0, y0, z);
        for (let k = 0; k <= s.w; k++) r.fill(x0 + k * z, y0, 1, s.h * z, k % 4 ? [40, 40, 48] : [230, 80, 200]);
        for (let k = 0; k <= s.h; k++) r.fill(x0, y0 + k * z, s.w * z, 1, k % 4 ? [40, 40, 48] : [230, 80, 200]);
        const rows = s.frames[fi]!.match(new RegExp(`.{${s.w}}`, 'g'))!.map((row, y) => `${String(y).padStart(2)} ${row.replaceAll('0', '.')}`);
        dump.push(`${id} ${name} (frame ${fi})\n   ${'0123456789abcdefghijklmnopqrstuv'.slice(0, s.w)}\n${rows.join('\n')}\n`);
      });
      writePng(`${OUT}/actors-focus-${id}.png`, r);
      writeFileSync(`${OUT}/actors-focus-${id}.txt`, dump.join('\n'));
    }
  });

  it('groups', () => {
    const groups: Record<string, string[]> = {
      npcs: ['npc.villager', 'npc.elder', 'npc.child', 'npc.guard', 'npc.merchant', 'npc.sage'],
      troops: ['enemy.soldier', 'enemy.archer', 'enemy.goblin'],
      critters: ['enemy.slime', 'enemy.spitter', 'enemy.bat', 'enemy.beetle', 'enemy.snake'],
      dungeon: ['enemy.skeleton', 'enemy.ghost', 'enemy.eye', 'enemy.bladeTrap'],
    };
    const z = 6;
    for (const [name, ids] of Object.entries(groups)) {
      const list = ids.map((id) => sprites.get(id)!);
      const cells = list.map((s) => Object.keys(s.anims).filter((n) => !s.anims[n]!.flipX).flatMap((n) => s.anims[n]!.frames));
      const cw = Math.max(...list.map((s) => s.w)) + 2;
      const ch = Math.max(...list.map((s) => s.h)) + 2;
      const r = new Raster(Math.max(...cells.map((c) => c.length)) * cw * z, list.length * ch * z, [96, 104, 88]);
      list.forEach((s, row) => {
        const pal = pals.get(s.palette)!;
        cells[row]!.forEach((fi, i) => drawFrame(r, s.frames[fi]!, s.w, s.h, pal, (i * cw + 1) * z, (row * ch + 1) * z, z));
      });
      writePng(`${OUT}/actors-group-${name}.png`, r);
    }
  });
});
