// Unit tests for the core sprite art (hero, fx, projectiles, items, objects, HUD, editor icons).
import { describe, expect, it } from 'vitest';
import { buildCoreSpriteArt, HERO_SWORD_POSES } from '../src/content/art/sprites-core';
import { isCoreSprite } from '../src/content/art/build';
import { buildTileArt } from '../src/content/art/tiles';
import { SPRITE_SPECS, T, VARIANT_PALETTES } from '../src/content/ids';
import type { Palette, SpriteDef } from '../src/core/types';

const art = buildCoreSpriteArt();
const pals = new Map<string, Palette>(art.palettes.map((p) => [p.id, p]));
const sprite = (id: string): SpriteDef => {
  const s = art.sprites.find((x) => x.id === id);
  if (!s) throw new Error(`missing sprite ${id}`);
  return s;
};

/** Palette index at (x, y) of a frame. */
function px(s: SpriteDef, frame: number, x: number, y: number): number {
  return parseInt(s.frames[frame]![y * s.w + x]!, 16);
}

/** Frame index `i` of anim `name`. */
function frameOf(s: SpriteDef, name: string, i = 0): number {
  return s.anims[name]!.frames[i]!;
}

function opaqueRows(s: SpriteDef, frame: number): number[] {
  const rows: number[] = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (px(s, frame, x, y) !== 0) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

/** Opaque-pixel mask of a frame as a string of 0/1. */
function mask(s: SpriteDef, frame: number): string {
  return s.frames[frame]!.replace(/[1-9a-f]/g, '1');
}

function maskDiff(s: SpriteDef, a: number, b: number): number {
  const ma = mask(s, a);
  const mb = mask(s, b);
  let n = 0;
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) n++;
  return n;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

describe('core sprite set', () => {
  it('has exactly one sprite per core spec, and no others', () => {
    const want = SPRITE_SPECS.filter(isCoreSprite).map((s) => s.id).sort();
    expect(art.sprites.map((s) => s.id).sort()).toEqual(want);
  });

  it('uses only pal.c.* palettes plus the required swaps', () => {
    const swaps = SPRITE_SPECS.filter(isCoreSprite).flatMap((s) => s.swaps ?? []);
    expect(swaps.sort()).toEqual(['pal.boomerang.2', 'pal.sword.2']);
    for (const p of art.palettes) expect(p.id.startsWith('pal.c.') || swaps.includes(p.id), p.id).toBe(true);
    for (const id of swaps) expect(pals.has(id), id).toBe(true);
    for (const s of art.sprites) expect(s.palette.startsWith('pal.c.'), s.id).toBe(true);
  });

  it('palettes are 16 lowercase hex colours with a dark but coloured outline at index 1', () => {
    for (const p of art.palettes) {
      expect(p.colors).toHaveLength(16);
      for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      const outline = p.colors[1]!;
      expect(outline, `${p.id} outline must not be pure black`).not.toBe('#000000');
      expect(luminance(outline), `${p.id} outline must be dark`).toBeLessThan(40);
    }
  });

  it('every frame only uses palette indices that have a real colour', () => {
    for (const s of art.sprites) {
      const pal = pals.get(s.palette)!;
      const used = new Set<number>();
      for (const f of s.frames) for (const ch of f) used.add(parseInt(ch, 16));
      used.delete(0);
      for (const i of used) expect(pal.colors[i], `${s.id} uses index ${i}`).not.toBe('#000000');
    }
  });

  it('swap palettes colour every index their sprite uses', () => {
    for (const [id, variants] of Object.entries(VARIANT_PALETTES)) {
      if (!art.sprites.some((s) => s.id === id)) continue;
      const s = sprite(id);
      const used = new Set<number>();
      for (const f of s.frames) for (const ch of f) used.add(parseInt(ch, 16));
      used.delete(0);
      for (const palId of Object.values(variants)) {
        if (!palId) continue;
        const pal = pals.get(palId)!;
        for (const i of used) expect(pal.colors[i], `${palId} index ${i}`).not.toBe('#000000');
      }
    }
  });

  it('no frame is blank and animated anims really change', () => {
    for (const s of art.sprites) {
      s.frames.forEach((f, i) => expect(/[1-9a-f]/.test(f), `${s.id} frame ${i} blank`).toBe(true));
      for (const [name, a] of Object.entries(s.anims)) {
        if (a.frames.length > 1) expect(new Set(a.frames).size, `${s.id}.${name} frames all identical`).toBeGreaterThan(1);
      }
    }
  });

  it('is deterministic', () => {
    expect(buildCoreSpriteArt()).toEqual(art);
  });
});

describe('hero', () => {
  const hero = sprite('hero');
  const facings = ['down', 'up', 'right'];

  it('stands with its feet on the bottom row, head room above the hitbox', () => {
    const standing = ['idle', 'walk', 'attack', 'push', 'lift', 'carry', 'use', 'hurt'];
    for (const f of facings) {
      for (const a of standing) {
        const anim = hero.anims[`${a}_${f}`]!;
        anim.frames.forEach((fr, i) => {
          const rows = opaqueRows(hero, fr);
          expect(rows.includes(23) || rows.includes(22), `${a}_${f}[${i}] feet on the bottom rows`).toBe(true);
          expect(Math.min(...rows), `${a}_${f}[${i}] head above the hitbox`).toBeLessThan(8);
        });
      }
    }
  });

  it('walk cycles alternate legs and bob the body by 1px', () => {
    for (const f of facings) {
      const [a, pass, b] = hero.anims[`walk_${f}`]!.frames as [number, number, number];
      expect(a).not.toBe(b);
      expect(Math.min(...opaqueRows(hero, pass))).toBe(Math.min(...opaqueRows(hero, a)) - 1);
    }
  });

  const OUT = 1;
  const FOAM = 13;
  const WATERLINE = 19;
  const inFrame = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < hero.w && y < hero.h;
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const swimFrames = new Set(['down', 'up', 'right'].flatMap((f) => hero.anims[`swim_${f}`]!.frames));

  it('outlines every frame once, inside the frame (no clipped edges, no 2px rims)', () => {
    hero.frames.forEach((_, fr) => {
      for (let y = 0; y < hero.h; y++) {
        for (let x = 0; x < hero.w; x++) {
          const v = px(hero, fr, x, y);
          if (v === 0) continue;
          const near = N4.map(([dx, dy]) => (inFrame(x + dx, y + dy) ? px(hero, fr, x + dx, y + dy) : 0));
          // Swim frames: foam, ripples and splashes are drawn on the water without an outline.
          if (swimFrames.has(fr) && v === FOAM && (y >= WATERLINE || near.every((n) => n === 0 || n === FOAM || n === OUT))) continue;
          // A swimmer's body meets the water at the waterline: that side is not a silhouette edge.
          const edge = N4.some(([dx, dy]) => (!swimFrames.has(fr) || y + dy < WATERLINE)
            && (!inFrame(x + dx, y + dy) || px(hero, fr, x + dx, y + dy) === 0));
          if (edge) expect(v, `frame ${fr}: silhouette pixel ${x},${y} must be outline`).toBe(OUT);
          if (v === OUT) expect(near.some((n) => n !== 0 && n !== OUT), `frame ${fr}: outline ${x},${y} touches no fill (double rim)`).toBe(true);
        }
      }
    });
  });

  it('animated anims change their silhouette on every frame step', () => {
    for (const [name, a] of Object.entries(hero.anims)) {
      if (a.flipX || a.frames.length < 2) continue;
      const steps = a.loop === false ? a.frames.length - 1 : a.frames.length;
      for (let i = 0; i < steps; i++) {
        const from = a.frames[i]!;
        const to = a.frames[(i + 1) % a.frames.length]!;
        expect(maskDiff(hero, from, to), `${name} frame ${i} -> ${(i + 1) % a.frames.length}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('mirrors left from right and has every special anim', () => {
    expect(hero.anims.walk_left!.flipX).toBe(true);
    expect(hero.anims.walk_left!.frames).toEqual(hero.anims.walk_right!.frames);
    for (const n of ['item_get', 'fall', 'die']) expect(hero.anims[n], n).toBeDefined();
  });

  it('shrinks while falling', () => {
    const sizes = hero.anims.fall!.frames.map((fr) => hero.frames[fr]!.replace(/0/g, '').length);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]).toBeGreaterThan(sizes[2]!);
  });
});

describe('sword blade and poses', () => {
  const blade = sprite('fx.sword');
  const DIRS: Record<string, [number, number]> = {
    n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
  };

  it('points each blade toward its named direction with the grip near the centre', () => {
    for (const [name, [dx, dy]] of Object.entries(DIRS)) {
      const f = frameOf(blade, name);
      let bx = 0;
      let by = 0;
      let bn = 0;
      let gx = 0;
      let gy = 0;
      let gn = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = px(blade, f, x, y);
          if (v >= 2 && v <= 4) {
            bx += x - 7.5; by += y - 7.5; bn++;
          } else if (v === 7 || v === 8) {
            gx += x - 7.5; gy += y - 7.5; gn++;
          }
        }
      }
      bx /= bn; by /= bn; gx /= gn; gy /= gn;
      if (dx !== 0) expect(Math.sign(bx), `${name} blade x`).toBe(dx);
      else expect(Math.abs(bx), `${name} blade x`).toBeLessThan(1);
      if (dy !== 0) expect(Math.sign(by), `${name} blade y`).toBe(dy);
      else expect(Math.abs(by), `${name} blade y`).toBeLessThan(1);
      expect(Math.hypot(gx, gy), `${name} grip near centre`).toBeLessThan(3);
    }
  });

  it('gives three attack poses per facing, left mirroring right', () => {
    const mirror: Record<string, string> = { n: 'n', ne: 'nw', e: 'w', se: 'sw', s: 's', sw: 'se', w: 'e', nw: 'ne' };
    for (const f of ['down', 'up', 'right', 'left'] as const) {
      expect(HERO_SWORD_POSES[f]).toHaveLength(3);
      for (const p of HERO_SWORD_POSES[f]) expect(blade.anims[p.blade], p.blade).toBeDefined();
    }
    HERO_SWORD_POSES.right.forEach((p, i) => {
      const l = HERO_SWORD_POSES.left[i]!;
      expect([l.dx, l.dy, l.blade, l.behind]).toEqual([-p.dx, p.dy, mirror[p.blade], p.behind]);
    });
  });

  /** Composite an attack frame with its blade like the player does; counts visible blade pixels and face hits. */
  function composite(facing: keyof typeof HERO_SWORD_POSES, i: number): { visible: number; steel: number; faceHits: number } {
    const hero = sprite('hero');
    const a = hero.anims[`attack_${facing}`]!;
    const fr = a.frames[i]!;
    const heroAt = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= hero.w || y >= hero.h ? 0 : px(hero, fr, a.flipX ? hero.w - 1 - x : x, y);
    const p = HERO_SWORD_POSES[facing][i]!;
    const bf = frameOf(blade, p.blade);
    const offX = hero.ox + p.dx - blade.ox;
    const offY = hero.oy + p.dy - blade.oy;
    let visible = 0;
    let steel = 0;
    let faceHits = 0;
    for (let y = 0; y < blade.h; y++) {
      for (let x = 0; x < blade.w; x++) {
        const v = px(blade, bf, x, y);
        if (v === 0) continue;
        const under = heroAt(x + offX, y + offY);
        if (p.behind && under !== 0) continue;
        visible++;
        if (v >= 2 && v <= 4) steel++;
        // Skin and hair (hero indices 6-9) in the head rows must not be painted over by the blade.
        if (!p.behind && under >= 6 && under <= 9 && y + offY <= 12) faceHits++;
      }
    }
    return { visible, steel, faceHits };
  }

  it('shows the blade clearly on every attack frame without covering the face', () => {
    for (const f of ['down', 'up', 'right', 'left'] as const) {
      for (let i = 0; i < 3; i++) {
        const c = composite(f, i);
        expect(c.visible, `${f}[${i}] visible blade pixels`).toBeGreaterThanOrEqual(20);
        expect(c.steel, `${f}[${i}] visible steel pixels`).toBeGreaterThanOrEqual(8);
        expect(c.faceHits, `${f}[${i}] blade over the face`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every blade the same apparent length', () => {
    const steelSpan = (name: string): number => {
      const f = frameOf(blade, name);
      const pts: [number, number][] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ([2, 3, 4].includes(px(blade, f, x, y))) pts.push([x, y]);
      let best = 0;
      for (const [ax, ay] of pts) for (const [bx, by] of pts) best = Math.max(best, Math.hypot(ax - bx, ay - by));
      return best;
    };
    const spans = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(steelSpan);
    expect(Math.max(...spans) / Math.min(...spans)).toBeLessThan(1.2);
  });
});

describe('items, objects and UI', () => {
  it('rupees glint over three distinct frames', () => {
    const p = sprite('pickup');
    for (const c of ['green', 'blue', 'red']) expect(new Set(p.anims[`rupee_${c}`]!.frames).size).toBe(3);
  });

  it('item icons for level-2 upgrades differ from level 1', () => {
    const it2 = sprite('item');
    for (const [a, b] of [['sword', 'sword2'], ['boomerang', 'boomerang2'], ['glove', 'glove2']]) {
      expect(it2.frames[frameOf(it2, a!)]).not.toBe(it2.frames[frameOf(it2, b!)]);
    }
  });

  it('doors are fully opaque so they replace the wall they sit on', () => {
    for (const id of ['obj.doorNS', 'obj.doorEW']) {
      const d = sprite(id);
      for (const [name, a] of Object.entries(d.anims)) {
        for (const fr of a.frames) expect(d.frames[fr]!.includes('0'), `${id}.${name}`).toBe(false);
      }
    }
  });

  it('cracked and bombed doors match the dungeon wall tiles they replace', () => {
    const tiles = buildTileArt();
    const tilePals = new Map(tiles.palettes.map((p) => [p.id, p]));
    const wallRgb = (key: string): ((x: number, y: number) => string) => {
      const t = tiles.tiles.find((d) => d.id === T[key])!;
      const pal = tilePals.get(t.palette)!;
      return (x, y) => pal.colors[parseInt(t.frames[0]![(y & 15) * 16 + (x & 15)]!, 16)]!;
    };
    const walls: Record<string, string> = { up: 'DWALL_TOP', down: 'DWALL_BOTTOM', left: 'DWALL_LEFT', right: 'DWALL_RIGHT' };
    const VOID = 7;
    for (const [id, sides] of [['obj.doorNS', ['up', 'down']], ['obj.doorEW', ['left', 'right']]] as const) {
      const d = sprite(id);
      const pal = pals.get(d.palette)!;
      for (const side of sides) {
        const rgb = wallRgb(walls[side]!);
        for (const kind of ['cracked', 'bombed']) {
          const fr = frameOf(d, `${kind}_${side}`);
          const voids: [number, number][] = [];
          for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (px(d, fr, x, y) === VOID) voids.push([x, y]);
          expect(voids.length, `${kind}_${side} has a crack / hole`).toBeGreaterThan(0);
          // A crack may touch its direct neighbours, a blast hole its rubble ring; everything else is plain wall.
          const reach = kind === 'cracked' ? 1 : 4;
          let checked = 0;
          for (let y = 0; y < d.h; y++) {
            for (let x = 0; x < d.w; x++) {
              if (voids.some(([vx, vy]) => Math.abs(vx - x) <= reach && Math.abs(vy - y) <= reach)) continue;
              checked++;
              expect(pal.colors[px(d, fr, x, y)], `${id} ${kind}_${side} at ${x},${y}`).toBe(rgb(x, y));
            }
          }
          expect(checked, `${kind}_${side} compared pixels`).toBeGreaterThan(d.w * d.h * 0.25);
        }
      }
    }
  });

  it('the crystal spins with its own silhouette, unlike any rupee', () => {
    const p = sprite('pickup');
    const crystal = p.anims.crystal!.frames;
    for (let i = 0; i < crystal.length; i++) {
      expect(maskDiff(p, crystal[i]!, crystal[(i + 1) % crystal.length]!), `crystal step ${i}`).toBeGreaterThanOrEqual(4);
    }
    for (const c of ['green', 'blue', 'red']) {
      for (const fr of crystal) expect(maskDiff(p, fr, p.anims[`rupee_${c}`]!.frames[0]!), `crystal vs ${c} rupee`).toBeGreaterThanOrEqual(12);
    }
  });

  it('HUD icons are 8x8 and every anim is distinct', () => {
    const hud = sprite('hud');
    expect([hud.w, hud.h]).toEqual([8, 8]);
    const frames = Object.values(hud.anims).map((a) => a.frames[0]);
    expect(new Set(frames).size).toBe(frames.length);
  });
});
