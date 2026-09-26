// Tile art: catalog coverage, palette rules, transparency, animation, seamless
// ground, and exact edge compatibility of every autotile / room-wall piece.
import { describe, expect, it } from 'vitest';
import { buildTileArt, tilePainters } from '../src/content/art/tiles';
import { PIECES, type PartSuffix, type PieceShape } from '../src/content/art/tiles-autotile';
import { WALL_PIECES } from '../src/content/art/tiles-dungeon';
import { memoField, snap8 } from '../src/content/art/tiles-kit';
import { GRASS_SHADE, WATER } from '../src/content/art/tiles-palettes';
import { TILE_SPECS } from '../src/content/ids';
import type { TileDef } from '../src/core/types';

const { palettes, tiles } = buildTileArt();
const byKey = new Map(tiles.map((t) => [t.key, t]));
const pals = new Map(palettes.map((p) => [p.id, p]));

const tile = (key: string): TileDef => {
  const t = byKey.get(key);
  if (!t) throw new Error(`missing tile ${key}`);
  return t;
};

/** Hex colour of pixel (x, y) in frame f ('' for transparent). */
function color(t: TileDef, x: number, y: number, f = 0): string {
  const v = parseInt(t.frames[f % t.frames.length]![y * 16 + x]!, 16);
  return v === 0 ? '' : pals.get(t.palette)!.colors[v]!;
}

function luma(c: string): number {
  if (!c) return 0;
  const n = parseInt(c.slice(1), 16);
  return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
}

type Edge = 'top' | 'bottom' | 'left' | 'right';
const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

function edgePixels(t: TileDef, edge: Edge, f = 0): string[] {
  return Array.from({ length: 16 }, (_, i) => {
    const [x, y] = edge === 'top' ? [i, 0] : edge === 'bottom' ? [i, 15] : edge === 'left' ? [0, i] : [15, i];
    return color(t, x, y, f);
  });
}

describe('tile art contract', () => {
  it('has exactly one painter and one TileDef per spec', () => {
    const painters = tilePainters();
    expect(Object.keys(painters).sort()).toEqual(TILE_SPECS.map((s) => s.key).sort());
    expect(tiles.map((t) => t.id)).toEqual(TILE_SPECS.map((s) => s.id));
  });

  it('uses SNES-style tile palettes (pal.t.*, 16 colours, channels on multiples of 8)', () => {
    for (const p of palettes) {
      expect(p.id.startsWith('pal.t.'), p.id).toBe(true);
      expect(p.colors).toHaveLength(16);
      for (const c of p.colors) expect(snap8(c), `${p.id} ${c}`).toBe(c);
    }
    for (const t of tiles) expect(pals.has(t.palette), `${t.key} -> ${t.palette}`).toBe(true);
  });

  it('only indexes authored palette colours', () => {
    for (const t of tiles) {
      const colors = pals.get(t.palette)!.colors;
      for (const f of t.frames) {
        for (const ch of new Set(f)) {
          const v = parseInt(ch, 16);
          if (v !== 0) expect(colors[v], `${t.key} index ${v}`).not.toBe('#000000');
        }
      }
    }
  });

  it('animates exactly the animated specs with 2-4 frames', () => {
    for (const spec of TILE_SPECS) {
      const t = tile(spec.key);
      if (spec.animated) {
        expect(t.frames.length, spec.key).toBeGreaterThanOrEqual(2);
        expect(t.frames.length, spec.key).toBeLessThanOrEqual(4);
      } else expect(t.frames.length, spec.key).toBe(1);
    }
    expect(tile('WATER').frameTime).toBeCloseTo(0.25);
    expect(tile('FLOWERS').frameTime!).toBeGreaterThan(0.3);
  });

  it('keeps every deep-water piece in sync (same frames, static shore)', () => {
    const pieces = PIECES.map(([suffix]) => tile(`WATER${suffix}`));
    for (const t of pieces) {
      expect(t.frames.length).toBe(tile('WATER').frames.length);
      expect(t.frameTime).toBe(tile('WATER').frameTime);
    }
    // Grass and shore pixels never change between frames; only water does.
    const waterish = new Set(['9', 'a', 'b', 'c', 'd', 'e']);
    for (const t of pieces) {
      for (let i = 0; i < 256; i++) {
        const vals = new Set(t.frames.map((f) => f[i]));
        if (vals.size > 1) for (const v of vals) expect(waterish.has(v!), `${t.key} px ${i} = ${v}`).toBe(true);
      }
    }
  });

  it('uses transparency only on tiles drawn above the ground (tree canopy / trunks, small tree)', () => {
    const layered = new Set(['TREE_TL', 'TREE_TR', 'TREE_BL', 'TREE_BR', 'TREE_SMALL']);
    for (const t of tiles) {
      const transparent = t.frames.some((f) => f.includes('0'));
      expect(transparent, t.key).toBe(layered.has(t.key));
    }
  });

  it('is deterministic', () => {
    expect(buildTileArt()).toEqual({ palettes, tiles });
  });
});

describe('seamless ground', () => {
  /** Largest luminance jump between adjacent interior columns (or rows). */
  function interiorMax(t: TileDef, vertical: boolean): number {
    let max = 0;
    for (let a = 0; a < 15; a++) {
      let sum = 0;
      for (let b = 0; b < 16; b++) {
        const [x0, y0, x1, y1] = vertical ? [b, a, b, a + 1] : [a, b, a + 1, b];
        sum += Math.abs(luma(color(t, x0, y0)) - luma(color(t, x1, y1)));
      }
      max = Math.max(max, sum / 16);
    }
    return max;
  }

  /** Mean luminance jump across the seam where `a` meets `b` (a left of / above b). */
  function seam(a: TileDef, b: TileDef, vertical: boolean): number {
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const ca = vertical ? color(a, i, 15) : color(a, 15, i);
      const cb = vertical ? color(b, i, 0) : color(b, 0, i);
      sum += Math.abs(luma(ca) - luma(cb));
    }
    return sum / 16;
  }

  // DFLOOR_ORNATE is a bordered slab: its grout line sits on the tile edge by design, so it is not listed.
  const SEAMLESS = ['GRASS', 'GRASS_ALT', 'GRASS_DARK', 'TALL_GRASS', 'DIRT', 'SAND', 'MOUNTAIN_GROUND', 'STONE_PATH', 'MOUNTAIN_ROCK',
    'DFLOOR', 'DFLOOR_TILE', 'CARPET', 'DWALL_FILL', 'WOOD_FLOOR', 'STONE_FLOOR', 'RUG', 'CAVE_FLOOR', 'CAVE_WALL',
    'WATER', 'PATH', 'PIT', 'PLATEAU', 'SHALLOW_WATER', 'STONE_WALL', 'ROOF_M'];

  /** A wrapped texture's seam is no harsher than its harshest interior column/row step (small slack for sparse specks). */
  const tolerance = (m: number): number => m * 1.2 + 4;

  it.each(SEAMLESS)('%s tiles with itself', (key) => {
    const t = tile(key);
    expect(seam(t, t, false), 'horizontal seam').toBeLessThanOrEqual(tolerance(interiorMax(t, false)));
    expect(seam(t, t, true), 'vertical seam').toBeLessThanOrEqual(tolerance(interiorMax(t, true)));
  });

  it('grass variants mix with each other in any arrangement', () => {
    const grass = ['GRASS', 'GRASS_ALT', 'GRASS_DARK'].map(tile);
    for (const a of grass.slice(0, 2)) {
      for (const b of grass.slice(0, 2)) {
        const limit = tolerance(Math.max(interiorMax(a, false), interiorMax(b, false)));
        expect(seam(a, b, false), `${a.key}|${b.key}`).toBeLessThanOrEqual(limit);
        expect(seam(a, b, true), `${a.key}/${b.key}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('paints objects on the shared meadow so they sit naturally in grass', () => {
    const onGrass = ['FLOWERS', 'BUSH', 'ROCK', 'HEAVY_ROCK', 'STUMP', 'FENCE_H', 'FENCE_V', 'FENCE_POST', 'GRAVESTONE', 'STATUE', 'HOLE',
      'PEBBLES', 'LEDGE_S', 'LEDGE_N', 'LEDGE_E', 'LEDGE_W'];
    const grass = tile('GRASS');
    for (const key of onGrass) {
      const t = tile(key);
      let same = 0;
      let total = 0;
      for (const edge of EDGES) {
        const a = edgePixels(t, edge);
        const b = edgePixels(grass, edge);
        a.forEach((c, i) => {
          total++;
          if (c === b[i]) same++;
        });
      }
      expect(same / total, key).toBeGreaterThan(0.45);
    }
  });
});

describe('autotile and wall pieces join exactly', () => {
  /**
   * Along an edge the piece does not border outside, it must match the piece
   * with the same edge condition: e.g. the top row of an E, SE or INE piece
   * equals the top row of the E piece.
   */
  function canonical(shape: PieceShape, edge: Edge): PartSuffix | 'outside' {
    const has = (side: 'n' | 's' | 'e' | 'w', notch: PieceShape['notch']): boolean => shape[side] || shape.notch === notch;
    switch (edge) {
      case 'top': return shape.n ? 'outside' : has('e', 'ne') ? '_E' : has('w', 'nw') ? '_W' : '';
      case 'bottom': return shape.s ? 'outside' : has('e', 'se') ? '_E' : has('w', 'sw') ? '_W' : '';
      case 'left': return shape.w ? 'outside' : has('n', 'nw') ? '_N' : has('s', 'sw') ? '_S' : '';
      case 'right': return shape.e ? 'outside' : has('n', 'ne') ? '_N' : has('s', 'se') ? '_S' : '';
    }
  }

  interface PieceSet {
    name: string;
    key: (s: PartSuffix) => string | undefined;
    /** Ground the outside border must match exactly, on these edges. */
    ground?: string;
    outsideSides?: readonly Edge[];
    /**
     * Cliffs/walls whose faces differ in width per side: where two faces meet
     * in a concave notch one of them has to win, so the notch's edge pixels
     * may differ from the neighbour piece within this many px of the corner.
     */
    notchSlack?: number;
  }

  const SETS: readonly PieceSet[] = [
    { name: 'water', key: (s) => `WATER${s}`, ground: 'GRASS', outsideSides: EDGES },
    { name: 'path', key: (s) => `PATH${s}`, ground: 'GRASS', outsideSides: EDGES },
    { name: 'pit', key: (s) => `PIT${s}`, ground: 'DFLOOR', outsideSides: EDGES },
    { name: 'plateau', key: (s) => `PLATEAU${s}`, ground: 'GRASS', outsideSides: ['top', 'left', 'right'], notchSlack: 6 },
    { name: 'dungeon walls', key: (s) => wallKey('DWALL', s), notchSlack: 12 },
    { name: 'house walls', key: (s) => wallKey('IWALL', s), notchSlack: 13 },
  ];

  /** Pixel positions along `edge` that lie within `slack` px of the notch corner. */
  function nearNotch(shape: PieceShape, edge: Edge, i: number, slack: number): boolean {
    if (!shape.notch) return false;
    const vert = shape.notch[0] === 'n' ? 'top' : 'bottom';
    const horiz = shape.notch[1] === 'e' ? 'right' : 'left';
    if (edge === vert) return horiz === 'right' ? i >= 16 - slack : i < slack;
    if (edge === horiz) return vert === 'bottom' ? i >= 16 - slack : i < slack;
    return false;
  }

  function wallKey(prefix: string, suffix: PartSuffix): string | undefined {
    const name = Object.entries(WALL_PIECES).find(([, p]) => p === suffix)?.[0];
    const key = name && `${prefix}_${name}`;
    return key && byKey.has(key) ? key : undefined;
  }

  it.each(SETS)('$name', ({ key, ground, outsideSides, notchSlack = 0 }) => {
    for (const [suffix, shape] of PIECES) {
      const k = key(suffix);
      if (!k) continue;
      const t = tile(k);
      for (const edge of EDGES) {
        const c = canonical(shape, edge);
        for (let f = 0; f < t.frames.length; f++) {
          if (c === 'outside') {
            if (ground && outsideSides?.includes(edge)) {
              expect(edgePixels(t, edge, f), `${k} ${edge} vs ${ground}`).toEqual(edgePixels(tile(ground), edge));
            }
            continue;
          }
          const ck = key(c);
          if (!ck || ck === k) continue;
          const keep = (_: string, i: number): boolean => !nearNotch(shape, edge, i, notchSlack);
          expect(edgePixels(t, edge, f).filter(keep), `${k} ${edge} frame ${f} vs ${ck}`)
            .toEqual(edgePixels(tile(ck), edge, f).filter(keep));
        }
      }
    }
  });
});

describe('shores, cliffs and animation read cleanly', () => {
  /** Palette index of pixel (x, y) in frame f. */
  const idx = (t: TileDef, x: number, y: number, f = 0): number => parseInt(t.frames[f]![y * 16 + x]!, 16);

  /** Rows (or columns) holding the shore outline, per column (or row). */
  function outlineRuns(t: TileDef, vertical: boolean): Set<number>[] {
    return Array.from({ length: 16 }, (_, a) => {
      const set = new Set<number>();
      for (let b = 0; b < 16; b++) if (idx(t, vertical ? b : a, vertical ? a : b) === WATER.OUT) set.add(b);
      return set;
    });
  }

  it.each(['WATER_N', 'WATER_S', 'WATER_E', 'WATER_W'])('%s has an unbroken shore outline (also across its own seam)', (key) => {
    const vertical = key.endsWith('E') || key.endsWith('W');
    const runs = outlineRuns(tile(key), vertical);
    runs.forEach((run, a) => {
      const next = runs[(a + 1) % 16]!;
      expect(run.size, `${key} line ${a}`).toBeGreaterThan(0);
      expect([...run].some((v) => next.has(v)), `${key} gap between ${a} and ${(a + 1) % 16}`).toBe(true);
    });
  });

  it('shows the earth bank only on the far (north) shore', () => {
    for (const key of ['WATER_E', 'WATER_W', 'WATER_S', 'WATER_ISE', 'WATER_ISW']) {
      const t = tile(key);
      for (let i = 0; i < 256; i++) expect([WATER.BANK0, WATER.BANK1], `${key} px ${i}`).not.toContain(idx(t, i % 16, i >> 4));
    }
    expect(tile('WATER_N').frames[0]).toContain(WATER.BANK0.toString(16));
  });

  it('grounds south cliff faces with a shadow on the meadow at their foot', () => {
    const grass = tile('GRASS');
    for (const key of ['PLATEAU_S', 'PLATEAU_SE', 'PLATEAU_SW']) {
      const t = tile(key);
      let shaded = 0;
      for (let x = 0; x < 16; x++) {
        const g = idx(grass, x, 15);
        const v = idx(t, x, 15);
        expect([g, GRASS_SHADE[g] ?? g], `${key} x ${x}`).toContain(v);
        if (v !== g) shaded++;
      }
      expect(shaded, key).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps the plateau middle identical to GRASS (grass-based objects sit on it seamlessly)', () => {
    expect(tile('PLATEAU').frames).toEqual(tile('GRASS').frames);
  });

  it('animates water gently (a modest share of pixels changes per frame)', () => {
    for (const key of ['WATER', 'SHALLOW_WATER']) {
      const t = tile(key);
      t.frames.forEach((f, i) => {
        const next = t.frames[(i + 1) % t.frames.length]!;
        const changed = [...f].filter((c, k) => c !== next[k]).length;
        expect(changed, `${key} frame ${i}`).toBeGreaterThanOrEqual(8);
        expect(changed, `${key} frame ${i}`).toBeLessThanOrEqual(64);
      });
    }
  });

  it('makes the bombable rock wall discoverable (a real crack, not a few pixels)', () => {
    const rock = tile('MOUNTAIN_ROCK').frames[0]!;
    const cracked = tile('CRACKED_ROCKWALL').frames[0]!;
    expect([...cracked].filter((c, i) => c !== rock[i]).length).toBeGreaterThanOrEqual(30);
  });
});

describe('generation speed helpers', () => {
  it('memoField caches a field on the padded tile grid without changing any value', () => {
    let calls = 0;
    const f = (x: number, y: number): number => {
      calls++;
      return Math.sin(x * 1.3) + y * 0.25;
    };
    const m = memoField(f, 2);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = -2; y < 18; y++) for (let x = -2; x < 18; x++) expect(m(x, y)).toBe(f(x, y));
    }
    calls = 0;
    for (let y = -2; y < 18; y++) for (let x = -2; x < 18; x++) m(x, y);
    expect(calls).toBe(0);
    // Outside the padded grid, or between pixels, it just calls through.
    const want = [f(0.5, 3), f(40, -9)];
    calls = 0;
    expect([m(0.5, 3), m(40, -9)]).toEqual(want);
    expect(calls).toBe(2);
  });

  it('builds the same tileset every time (the cached fields keep painters pure)', () => {
    expect(JSON.stringify(buildTileArt().tiles)).toBe(JSON.stringify(tiles));
  });
});
