// Seamless overworld ground: the grass family (and grass-based decor), dirt,
// sand, mountain ground and flagstones. Every texture wraps at the tile edge.
import type { Rng } from '../../core/rng';
import { PixelGrid } from './pixelgrid';
import {
  art, composite, fbm, paintTile, rampAt, remap, scatter, seeded, stamp, tileNoise, voronoi, wset,
  wstamp, type PainterTable,
} from './tiles-kit';
import { EARTH, G, GRASS_SHADE, MEADOW, MOUNT, PAL, ROCK, SAND } from './tiles-palettes';

// ---------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------

/** Dark blade tufts (hex digits are grass indices: 2 shadow, 3 dark, 5 light, 6 highlight). */
const TUFTS: readonly (readonly string[])[] = [
  ['5.3', '.3.'],
  ['3.5', '.3.'],
  ['5..3', '.33.'],
  ['.5.', '3.3'],
  ['53', '.3'],
];

/** Light tufts for the GRASS_ALT variant. */
const LIGHT_TUFTS: readonly (readonly string[])[] = [
  ['.6.6.', '65.56', '.5.5.'],
  ['6.6', '.5.', '.3.'],
  ['.6..', '6.66', '.55.'],
];

/**
 * The meadow ground every grass-based tile starts from: a calm mid tone with
 * evenly scattered blade tufts and sparse specks (no large-scale features, so
 * repetition across a field is not noticeable).
 */
export function grassTile(): PixelGrid {
  const rng = seeded('ground.grass');
  const g = new PixelGrid(16, 16, G.MID);
  for (const [px, py] of scatter(rng, 11, 4.2)) wstamp(g, rng.pick(TUFTS), Math.floor(px), Math.floor(py));
  for (const [px, py] of scatter(rng, 10, 2.5)) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (g.get(x, y) === G.MID && g.get(x + 1, y) === G.MID) wset(g, x, y, rng.chance(0.55) ? G.LT : G.DK);
  }
  return g;
}

/** GRASS with a few light tufts placed inside the tile (mixes with GRASS). */
function grassTufts(): PixelGrid {
  const rng = seeded('ground.grass-alt');
  const g = grassTile();
  for (const [px, py] of scatter(rng, 3, 7, 3)) stamp(g, rng.pick(LIGHT_TUFTS), Math.floor(px) - 2, Math.floor(py) - 1);
  return g;
}

/** Forest-shade grass: the same pattern one step darker, plus deep shadow tufts. */
function grassDark(): PixelGrid {
  const rng = seeded('ground.grass-dark');
  const g = remap(grassTile(), { 3: G.SH, 4: G.DK, 5: G.MID, 6: G.LT });
  for (const [px, py] of scatter(rng, 4, 6)) wstamp(g, ['2.2', '.2.'], Math.floor(px), Math.floor(py));
  return g;
}

// Tall grass: dense clumps of blades (dark roots, lit tips), three per row at
// uneven spacing with 1 px vertical jitter and alternating mirror images, so a
// large field shows no regular lattice; the clumps wrap across tile edges.
const TALL_CLUMP = [
  '6.....6.',
  '5.6.6.5.',
  '45.5.54.',
  '4454544.',
  '3444443.',
  '2333332.',
  '.22222..',
];

/** The clump mirrored, for variety. */
const TALL_CLUMP_B = TALL_CLUMP.map((r) => [...r].reverse().join(''));

const TALL_SPOTS = [
  [0, 0, TALL_CLUMP], [5, 1, TALL_CLUMP_B], [11, -1, TALL_CLUMP],
  [2, 8, TALL_CLUMP_B], [8, 7, TALL_CLUMP], [13, 9, TALL_CLUMP_B],
] as const;

function tallGrass(): PixelGrid {
  const g = paintTile((x, y) => ((x + y * 3) % 5 === 0 ? G.SH : G.DK));
  const map = { 6: G.HI, 5: G.LT, 4: G.MID, 3: G.DK, 2: G.SH };
  for (const [x, y, clump] of TALL_SPOTS) wstamp(g, clump, x, y, map);
  return g;
}

// Flowers: small blossoms swaying in a gentle 3-frame loop (each flower its own phase).
interface Blossom { x: number; y: number; kind: 'white' | 'red' | 'yellow'; phase: number; dir: number }

const BLOSSOMS: readonly Blossom[] = [
  { x: 2, y: 2, kind: 'white', phase: 0, dir: 1 },
  { x: 10, y: 3, kind: 'red', phase: 1, dir: -1 },
  { x: 5, y: 9, kind: 'red', phase: 2, dir: 1 },
  { x: 12, y: 11, kind: 'white', phase: 1, dir: -1 },
  { x: 1, y: 12, kind: 'yellow', phase: 2, dir: -1 },
];

const SWAY = [0, 1, 0] as const;

function blossomColors(kind: Blossom['kind']): [petal: number, shade: number, centre: number] {
  if (kind === 'red') return [MEADOW.RED, MEADOW.RED_DK, MEADOW.YELLOW];
  if (kind === 'yellow') return [MEADOW.YELLOW, MEADOW.RED_DK, MEADOW.WHITE];
  return [MEADOW.WHITE, MEADOW.BLUE, MEADOW.YELLOW];
}

function flowers(): PixelGrid[] {
  const base = grassTile();
  return [0, 1, 2].map((f) => {
    const g = base.clone();
    for (const b of BLOSSOMS) {
      const sway = SWAY[(f + b.phase) % 3]! * b.dir;
      const [petal, shade, centre] = blossomColors(b.kind);
      // Leaves and stem stay put; the head sways.
      g.set(b.x, b.y + 3, G.DK).set(b.x + 2, b.y + 3, G.DK).set(b.x + 1, b.y + 3, MEADOW.B0).set(b.x + 1, b.y + 4, G.SH);
      g.set(b.x + 1 + (sway > 0 ? 1 : 0), b.y + 2, MEADOW.B0);
      const hx = b.x + sway;
      g.set(hx + 1, b.y - 1, petal).set(hx, b.y, petal).set(hx + 1, b.y, centre).set(hx + 2, b.y, shade).set(hx + 1, b.y + 1, shade);
    }
    return g;
  });
}

// Pebbles: a few small stones with lit tops and grass shadows.
const PEBBLE_SHAPES: readonly (readonly string[])[] = [
  ['.ba.', 'b98a', '.87.'],
  ['ba', '87'],
  ['.b.', 'a98', '.7.'],
];

function pebbles(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  const spots = [[2, 3, 0], [10, 2, 1], [6, 8, 2], [12, 10, 0], [3, 12, 1]] as const;
  for (const [x, y, s] of spots) {
    stamp(obj, PEBBLE_SHAPES[s]!, x, y, { 0xb: ROCK.S4, 0xa: ROCK.S3, 9: ROCK.S2, 8: ROCK.S1, 7: ROCK.S0 });
  }
  return composite(grassTile(), obj, { lut: GRASS_SHADE, dx: 1, dy: 1 });
}

// ---------------------------------------------------------------------------
// Earth, sand, mountain ground, flagstones
// ---------------------------------------------------------------------------

/** Brown earth with soft patches, dark pebbles and light specks. */
function dirtTile(): PixelGrid {
  const rng = seeded('ground.dirt');
  const n = fbm(rng, [[4, 1], [8, 0.4]]);
  const g = paintTile((x, y) => rampAt(0.15 + n(x, y) * 0.85, [EARTH.E1, EARTH.E2, EARTH.E2, EARTH.E3], x, y, 0.9));
  speckle(g, rng, 6, [['3', '1'], ['43', '21']], { 4: EARTH.E4, 3: EARTH.E3, 2: EARTH.E1, 1: EARTH.E0 });
  speckle(g, rng, 5, [['4'], ['4.', '.3']], { 4: EARTH.E4, 3: EARTH.E3 });
  return g;
}

/** Stamp `count` wrapped glyphs at scattered positions. */
function speckle(g: PixelGrid, rng: Rng, count: number, glyphs: readonly (readonly string[])[], map: Record<number, number>): void {
  for (const [x, y] of scatter(rng, count, 4)) wstamp(g, rng.pick(glyphs), Math.floor(x), Math.floor(y), map);
}

/** Pale sand with two wind-ripple crests per tile (lit crest, shaded trough) and scattered grains. */
export function sandTile(): PixelGrid {
  const rng = seeded('ground.sand');
  const n = fbm(rng, [[4, 1], [8, 0.3]]);
  const crest = (x: number, base: number, amp: number, phase: number): number =>
    base + Math.round(amp * Math.sin((2 * Math.PI * x) / 16 + phase));
  const g = paintTile((x, y) => {
    for (const c of [crest(x, 3, 1.5, 0), crest(x, 11, 1.2, 2.2)]) {
      if (y === c) return SAND.S3;
      if (y === c + 1) return SAND.S1;
    }
    return rampAt(0.3 + n(x, y) * 0.5, [SAND.S1, SAND.S2, SAND.S2, SAND.S3], x, y, 0.6);
  });
  speckle(g, rng, 5, [['1'], ['0'], ['1.', '.0']], { 1: SAND.S1, 0: SAND.S0 });
  speckle(g, rng, 3, [['4']], { 4: SAND.S4 });
  stamp(g, ['c4', 'cc'], 12, 6, { 0xc: SAND.SHELL, 4: SAND.S4 });
  return g;
}

/**
 * Dusty mountain ground: an even mid tone speckled with lighter dust and dark
 * grit (fine noise over a narrow range, so no feature exceeds a few px), small
 * stones and two hairline cracks.
 */
function mountainGround(): PixelGrid {
  const rng = seeded('ground.mountain');
  const n = fbm(rng, [[8, 1], [16, 0.5]]);
  const g = paintTile((x, y) => rampAt(0.5 + (n(x, y) - 0.5) * 0.95, [MOUNT.M0, MOUNT.M1, MOUNT.M2], x, y, 0.9));
  speckle(g, rng, 5, [['ba', '87'], ['.b', 'a8'], ['a', '8']], { 0xb: MOUNT.R4, 0xa: MOUNT.R3, 8: MOUNT.R1, 7: MOUNT.R0 });
  // Two short hairline cracks running different ways.
  const cracks = [[[0, 0], [1, 0], [2, 1], [3, 1]], [[0, 1], [1, 0], [2, 0], [3, -1]]] as const;
  scatter(rng, 2, 7).forEach(([x, y], i) => {
    for (const [dx, dy] of cracks[i]!) wset(g, Math.floor(x) + dx, Math.floor(y) + dy, MOUNT.M0);
  });
  return g;
}

/** Irregular flagstones with grassy joints. */
function stonePath(): PixelGrid {
  const rng = seeded('ground.stone-path');
  const cells = voronoi([[3, 3], [11, 2], [7, 8], [15, 9], [2, 12], [10, 14], [6.5, 1]]);
  const tone = Array.from({ length: cells.count }, () => rng.range(-0.12, 0.12));
  const grain = tileNoise(rng, 8);
  return paintTile((x, y) => {
    const e = cells.edge(x, y);
    if (e < 1.1) return grain(x, y) > 0.55 ? G.DK : ROCK.S0;
    const id = cells.id(x, y);
    // Bevel: the joint above/left lights the stone edge, below/right shades it.
    if (cells.id(x - 1, y) !== id || cells.id(x, y - 1) !== id || cells.edge(x - 1, y - 1) < 1.1) return ROCK.S3;
    if (cells.id(x + 1, y) !== id || cells.id(x, y + 1) !== id || cells.edge(x + 1, y + 1) < 1.1) return ROCK.S1;
    return rampAt(0.5 + tone[id]! + (grain(x, y) - 0.5) * 0.35, [ROCK.S1, ROCK.S2, ROCK.S3], x, y, 0.8);
  });
}

/** Ground painters by tile key. */
export const groundPainters: PainterTable = {
  GRASS: () => art(PAL.meadow, [grassTile()]),
  GRASS_ALT: () => art(PAL.meadow, [grassTufts()]),
  GRASS_DARK: () => art(PAL.meadow, [grassDark()]),
  FLOWERS: () => art(PAL.meadow, flowers(), 0.42),
  TALL_GRASS: () => art(PAL.meadow, [tallGrass()]),
  PEBBLES: () => art(PAL.rock, [pebbles()]),
  DIRT: () => art(PAL.earth, [dirtTile()]),
  SAND: () => art(PAL.sand, [sandTile()]),
  MOUNTAIN_GROUND: () => art(PAL.mount, [mountainGround()]),
  STONE_PATH: () => art(PAL.rock, [stonePath()]),
};
