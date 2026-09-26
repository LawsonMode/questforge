// Actor art: toolkit helpers and invariants of the generated enemy/boss/NPC sprites.
import { describe, expect, it } from 'vitest';
import {
  actorPalette, art, bevel, compose, cylinder, FrameBank, OUT, RAMP_A, RAMP_B, sphere, swapPalette, type ActorColors,
} from '../src/content/art/actors-kit';
import { legs, figureFrame, overlay, walkFrame, type Figure } from '../src/content/art/actors-humanoid';
import { PixelGrid } from '../src/content/art/pixelgrid';
import { buildActorSpriteArt } from '../src/content/art/sprites-actors';
import { isCoreSprite } from '../src/content/art/build';
import { SPRITE_SPECS, VARIANT_PALETTES } from '../src/content/ids';

const COLORS: ActorColors = {
  outline: '#101010',
  a: ['#200000', '#400000', '#600000'],
  b: ['#002000', '#004000', '#006000'],
  c: ['#000020', '#000040', '#000060'],
  d: ['#202000', '#404000', '#606000'],
  white: '#ffffff',
  glow: '#ff00ff',
};

function indices(g: PixelGrid): Set<number> {
  return new Set(g.px);
}

describe('actors-kit', () => {
  it('art() maps the legend, ignores | guides and validates width', () => {
    const g = art(4, ['#a|Aw', '.x|yr']);
    expect([...g.px]).toEqual([1, 3, 4, 14, 0, 2, 5, 15]);
    expect(() => art(4, ['abc'])).toThrow(/3 px wide/);
    expect(() => art(4, ['aaaaa'])).toThrow(/expected 4/);
  });

  it('actorPalette lays colours out in the shared slot order', () => {
    const p = actorPalette('pal.a.test', 'Test', COLORS);
    expect(p.colors).toHaveLength(16);
    expect(p.colors[OUT]).toBe('#101010');
    expect(p.colors.slice(2, 5)).toEqual(['#200000', '#400000', '#600000']);
    expect(p.colors[14]).toBe('#ffffff');
    expect(p.colors[15]).toBe('#ff00ff');
    const swap = swapPalette('pal.test.alt', 'Alt', COLORS, { a: ['#000001', '#000002', '#000003'] });
    expect(swap.colors.slice(2, 5)).toEqual(['#000001', '#000002', '#000003']);
    expect(swap.colors.slice(5)).toEqual(p.colors.slice(5));
  });

  it('sphere shades only inside the ellipse with ramp indices, lighter toward the top-left', () => {
    const g = sphere(new PixelGrid(16, 16), 7.5, 7.5, 6, 6, RAMP_A);
    expect([...indices(g)].every((v) => v === 0 || RAMP_A.includes(v))).toBe(true);
    expect(g.get(0, 0)).toBe(0);
    expect(g.get(4, 4)).toBeGreaterThan(g.get(11, 11));
  });

  it('cylinder is lit on the left', () => {
    const g = cylinder(new PixelGrid(8, 4), 0, 0, 8, 4, RAMP_B);
    expect(g.get(1, 2)).toBeGreaterThan(g.get(7, 2));
  });

  it('bevel lights top-left edges and darkens bottom-right edges', () => {
    const g = new PixelGrid(6, 6);
    g.fill(1, 1, 4, 4, RAMP_A[1]);
    bevel(g, [RAMP_A]);
    expect(g.get(1, 1)).toBe(RAMP_A[2]);
    expect(g.get(4, 4)).toBe(RAMP_A[0]);
    expect(g.get(2, 2)).toBe(RAMP_A[1]);
  });

  it('compose outlines the stacked layers', () => {
    const a = new PixelGrid(5, 5).set(2, 2, 3);
    const g = compose(5, 5, [a]);
    expect(g.get(2, 2)).toBe(3);
    expect([g.get(1, 2), g.get(3, 2), g.get(2, 1), g.get(2, 3)]).toEqual([OUT, OUT, OUT, OUT]);
    expect(g.get(1, 1)).toBe(0);
  });

  it('FrameBank stores identical frames once and builds against the spec', () => {
    const bank = new FrameBank();
    const f = new PixelGrid(16, 16).set(8, 8, 3);
    bank.add('fly', f, f.clone().set(9, 9, 3)).add('rest', f);
    expect(bank.frames).toHaveLength(2);
    expect(bank.anims).toEqual({ fly: [0, 1], rest: [0] });
    const def = bank.build('enemy.bat', 'pal.a.bat');
    expect(def.anims.fly!.frames).toEqual([0, 1]);
    expect(() => new FrameBank().add('fly', f).build('enemy.bat', 'x')).toThrow(/spec needs 2/);
    expect(() => new FrameBank().add('fly', f, f).build('enemy.bat', 'x')).toThrow(/rest/);
  });
});

describe('actors-humanoid', () => {
  const st = { hip: 18, pants: RAMP_A, boots: RAMP_B } as const;

  const lowest = (g: PixelGrid, x0: number, x1: number): number => {
    for (let y = g.h - 1; y >= 0; y--) for (let x = x0; x <= x1; x++) if (g.get(x, y)) return y;
    return -1;
  };
  const leftmost = (g: PixelGrid, y: number): number => {
    for (let x = 0; x < g.w; x++) if (g.get(x, y)) return x;
    return -1;
  };

  it('legs put the feet on row 22 and lift one foot 2px (1px under a robe), tucked in', () => {
    const stand = legs('down', 0, st);
    expect(lowest(stand, 0, 7)).toBe(22);
    expect(lowest(stand, 8, 15)).toBe(22);
    const s1 = legs('down', 1, st);
    const s2 = legs('down', 2, st);
    expect([lowest(s1, 0, 7), lowest(s1, 8, 15)]).toEqual([22, 20]);
    expect([lowest(s2, 0, 7), lowest(s2, 8, 15)]).toEqual([20, 22]);
    expect(leftmost(s2, 20)).toBe(leftmost(stand, 22) + 1);
    const robed = legs('down', 1, { ...st, robe: 18 });
    expect([lowest(robed, 0, 7), lowest(robed, 8, 15)]).toEqual([22, 21]);
    expect(legs('right', 1, st).toData()).not.toBe(legs('right', 2, st).toData());
  });

  it('walkFrame dips the body and held items on the stride, swings free arms and sways robes', () => {
    const rows = ['......aa|aa......', '.....aaa|aaa.....', '..a.aaaa|aaaa.a..', '..a.aaaa|aaaa.a..', '..a.....|.....a..'];
    const body = overlay(rows, 10);
    const staff = overlay(Array<string>(13).fill('........|......c.'), 10);
    const fig: Figure = {
      body: { down: body, up: body, right: body }, legs: st, over: { down: staff },
      arms: { down: [[2, 2, 12, 15], [13, 13, 12, 15]] },
    };
    const top = (g: PixelGrid): number => g.px.findIndex((v) => v !== 0 && v !== OUT);
    const stride = walkFrame(fig, 'down', 1);
    const passing = walkFrame(fig, 'down', 2);
    expect(Math.floor(top(stride) / 16)).toBe(Math.floor(top(passing) / 16) + 1);
    // The held staff moves down with the body but never past the feet.
    expect(stride.get(14, 22)).toBe(9);
    expect(stride.get(14, 23)).toBe(OUT);
    // Arms swing in opposite directions (1px each way) and swap between the frames.
    const hand = (g: PixelGrid, x: number): number => {
      for (let y = g.h - 1; y >= 0; y--) if (g.get(x, y) === 3) return y;
      return -1;
    };
    expect([hand(passing, 2), hand(passing, 13)]).toEqual([13, 15]);
    expect([hand(stride, 2), hand(stride, 13)]).toEqual([16, 14]);
    // A robe hem sways right, then left.
    const robed: Figure = { ...fig, legs: { ...st, robe: 12 }, arms: {} };
    expect(leftmost(walkFrame(robed, 'down', 2), 13)).toBe(leftmost(walkFrame(robed, 'down', 1), 13) - 2);
  });

  it('figureFrame stacks legs, body and overlays and outlines the result', () => {
    const body = overlay(['......aa|aa......'], 10);
    const fig: Figure = { body: { down: body, up: body, right: body }, legs: st };
    const g = figureFrame(fig, 'down', 0, { over: overlay(['a.......|........'], 0) });
    expect(g.get(7, 10)).toBe(3);
    expect(g.get(7, 9)).toBe(OUT);
    expect(g.get(0, 0)).toBe(3);
    expect(g.get(5, 23)).toBe(OUT);
  });
});

describe('buildActorSpriteArt', () => {
  const { palettes, sprites } = buildActorSpriteArt();
  const pals = new Map(palettes.map((p) => [p.id, p]));
  const actorSpecs = SPRITE_SPECS.filter((s) => !isCoreSprite(s));

  it('provides exactly one sprite per actor spec on a pal.a.* palette', () => {
    expect(sprites.map((s) => s.id).sort()).toEqual(actorSpecs.map((s) => s.id).sort());
    for (const s of sprites) {
      expect(s.palette.startsWith('pal.a.'), s.id).toBe(true);
      expect(pals.has(s.palette), s.id).toBe(true);
    }
  });

  it('includes every required swap with the base palette layout', () => {
    for (const spec of actorSpecs) {
      const base = pals.get(sprites.find((s) => s.id === spec.id)!.palette)!;
      for (const id of spec.swaps ?? []) {
        const sw = pals.get(id);
        expect(sw, id).toBeDefined();
        expect(sw!.colors).toHaveLength(base.colors.length);
        expect(sw!.colors, id).not.toEqual(base.colors);
      }
    }
    for (const [sprite, variants] of Object.entries(VARIANT_PALETTES)) {
      if (!sprite.startsWith('enemy.')) continue;
      for (const id of Object.values(variants)) if (id) expect(pals.has(id), id).toBe(true);
    }
  });

  it('never paints with an unassigned palette slot', () => {
    for (const s of sprites) {
      const pal = pals.get(s.palette)!;
      const used = new Set<number>();
      for (const f of s.frames) for (const ch of f) used.add(parseInt(ch, 16));
      for (const v of used) if (v > 0) expect(pal.colors[v], `${s.id} uses empty slot ${v}`).not.toBe('#000000');
    }
  });

  it('gives every silhouette a 1px dark outline', () => {
    for (const s of sprites) {
      s.frames.forEach((f, fi) => {
        const g = PixelGrid.from(f, s.w, s.h);
        for (let y = 0; y < s.h; y++) {
          for (let x = 0; x < s.w; x++) {
            const v = g.get(x, y);
            if (v === 0 || v === OUT) continue;
            const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
              const nx = x + dx!;
              const ny = y + dy!;
              return g.inBounds(nx, ny) && g.get(nx, ny) === 0;
            });
            expect(open, `${s.id} frame ${fi} pixel ${x},${y} touches transparency`).toBe(false);
          }
        }
      });
    }
  });

  it('stands 16x24 characters and the knight on the bottom row', () => {
    for (const s of sprites) {
      const standing = s.h === 24 || s.id === 'boss.knight';
      if (!standing) continue;
      for (const [name, a] of Object.entries(s.anims)) {
        for (const fi of a.frames) {
          const g = PixelGrid.from(s.frames[fi]!, s.w, s.h);
          let bottom = -1;
          for (let y = s.h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < s.w; x++) if (g.get(x, y)) bottom = y;
          expect(bottom, `${s.id}.${name}`).toBe(s.h - 1);
        }
      }
    }
  });

  it('centres 16x16 creatures in their frame (small slimes sit low by spec)', () => {
    for (const s of sprites) {
      if (s.w !== 16 || s.h !== 16) continue;
      const anims = Object.entries(s.anims).filter(([n]) => !n.startsWith('small_'));
      for (const fi of new Set(anims.flatMap(([, a]) => a.frames))) {
        const g = PixelGrid.from(s.frames[fi]!, 16, 16);
        let x0 = 16, x1 = -1, y0 = 16, y1 = -1;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (g.get(x, y)) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        expect(Math.abs((x0 + x1) / 2 - 7.5), `${s.id} frame ${fi} x`).toBeLessThanOrEqual(2);
        expect(Math.abs((y0 + y1) / 2 - 7.5), `${s.id} frame ${fi} y`).toBeLessThanOrEqual(2.5);
      }
    }
  });

  it('moves the upper body, not just the feet, in every 16x24 walk', () => {
    for (const s of sprites.filter((sp) => sp.h === 24)) {
      for (const [name, a] of Object.entries(s.anims)) {
        if (!name.startsWith('walk_') || a.flipX) continue;
        const [f0, f1] = a.frames.map((i) => s.frames[i]!);
        const upper = [...f0!.slice(0, 16 * 17)].filter((c, i) => c !== f1![i]).length;
        expect(upper, `${s.id}.${name}`).toBeGreaterThan(20);
      }
    }
  });

  it('animates every multi-frame anim with distinct frames', () => {
    for (const s of sprites) {
      for (const [name, a] of Object.entries(s.anims)) {
        if (a.frames.length < 2) continue;
        expect(new Set(a.frames.map((i) => s.frames[i])).size, `${s.id}.${name}`).toBe(a.frames.length);
      }
    }
  });

  it('keeps the six NPCs visually distinct', () => {
    const npcs = sprites.filter((s) => s.id.startsWith('npc.'));
    expect(npcs).toHaveLength(6);
    const faces = new Set(npcs.map((s) => s.frames[s.anims.idle_down!.frames[0]!]));
    expect(faces.size).toBe(6);
    expect(new Set(npcs.map((s) => pals.get(s.palette)!.colors.slice(2, 8).join())).size).toBe(6);
  });
});
