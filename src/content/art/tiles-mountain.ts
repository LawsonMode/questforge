// Mountain rock: a craggy, seamless rock mass built from vertically stretched
// periodic Voronoi chunks (lit top-left, dark crevices). The same chunk field
// textures the plateau cliff faces, cave mouths and cliff stairs, so all rock
// in the overworld reads as one material.
import type { PixelGrid } from './pixelgrid';
import {
  art, paintTile, rampAt, seeded, stamp, tileNoise, voronoi, type Cells, type Field, type PainterTable,
} from './tiles-kit';
import { grassTile } from './tiles-ground';
import { MOUNT, PAL } from './tiles-palettes';

/** Rock chunk layout shared by every rock surface (period 16). */
export function rockCells(): Cells {
  return voronoi([[2, 2], [8, 1], [13, 4], [5, 7], [10, 9], [1, 12], [15, 13], [7, 14], [12, 15.5]], 1, 0.62);
}

/** Fine grain shared by every rock surface. */
export const rockGrain = (): Field => tileNoise(seeded('mountain.grain'), 8);

/** How a rock surface is lit and which indices it uses. */
export interface RockStyle {
  /** Brightness offset (-0.3 shaded side .. +0.3 lit side). */
  light: number;
  /** Ramp from dark to light. */
  ramp: readonly number[];
  /** Index for the cracks between chunks, and for their deepest centre line. */
  crevice: number;
  deep: number;
}

/** Default overworld rock: the mountain ramp, neutral light. */
export const ROCK_STYLE: RockStyle = {
  light: 0,
  ramp: [MOUNT.R0, MOUNT.R1, MOUNT.R2, MOUNT.R3, MOUNT.R4],
  crevice: MOUNT.R0,
  deep: MOUNT.OUT,
};

/** Shade one rock pixel: bevelled chunk edges, top-left light, fine grain. */
export function rockPixel(cells: Cells, grain: Field, x: number, y: number, style: RockStyle = ROCK_STYLE): number {
  const e = cells.edge(x, y);
  if (e < 0.55) return style.deep;
  if (e < 1.1) return style.crevice;
  const id = cells.id(x, y);
  const r = style.ramp;
  const litEdge = cells.id(x - 1, y) !== id || cells.id(x, y - 1) !== id || cells.edge(x - 1, y - 1) < 1.1 || cells.edge(x, y - 1) < 1.1;
  if (litEdge) return rampAt(0.92 + style.light, r, x, y, 0.3);
  const darkEdge = cells.id(x + 1, y) !== id || cells.id(x, y + 1) !== id || cells.edge(x + 1, y + 1) < 1.1;
  if (darkEdge) return rampAt(0.25 + style.light, r, x, y, 0.3);
  const [ox, oy] = cells.offset(x, y);
  const v = 0.58 - ox * 0.035 - oy * 0.03 + (grain(x, y) - 0.5) * 0.3 + style.light;
  return rampAt(v, r, x, y, 0.6);
}

/** Seamless craggy rock mass. */
function mountainRock(): PixelGrid {
  const cells = rockCells();
  const grain = rockGrain();
  return paintTile((x, y) => rockPixel(cells, grain, x, y));
}

/** The fracture of the bombable rock wall: a main crack with one fork (tile px). */
const CRACK: readonly (readonly [number, number])[] = [
  [8, 2], [8, 3], [7, 4], [7, 5], [8, 6], [8, 7], [7, 8], [6, 9], [6, 10], [7, 11], [7, 12], [6, 13],
  [9, 8], [10, 9], [10, 10], [11, 11],
];

/**
 * MOUNTAIN_ROCK with a clearly readable (but small) fracture: the chunk seams
 * around it are smoothed over so it reads as one crack, cut in near-black
 * with a lit upper-left lip and a shaded lower-right one, and a little pale
 * rubble has fallen at its foot.
 */
function crackedRock(): PixelGrid {
  const g = mountainRock();
  const isCrack = (x: number, y: number): boolean => CRACK.some(([cx, cy]) => cx === x && cy === y);
  const smooth = new Set<number>([MOUNT.OUT, MOUNT.R0, MOUNT.R1]);
  for (const [cx, cy] of CRACK) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (smooth.has(g.get(cx + dx, cy + dy))) g.set(cx + dx, cy + dy, MOUNT.R2);
    }
  }
  for (const [cx, cy] of CRACK) {
    if (!isCrack(cx - 1, cy)) g.set(cx - 1, cy, MOUNT.R4);
    if (!isCrack(cx + 1, cy)) g.set(cx + 1, cy, MOUNT.R1);
  }
  for (const [cx, cy] of CRACK) g.set(cx, cy, MOUNT.VOID);
  stamp(g, ['.b..b', 'fa.f.'], 5, 14, { 0xb: MOUNT.R4, 0xa: MOUNT.R3, 0xf: MOUNT.M2 });
  return g;
}

/** Dark arched cave mouth set into the rock, framed by a worn stone lip. */
function caveEntrance(): PixelGrid {
  const g = mountainRock();
  const [cx, cy, r] = [7.5, 8.5, 5.6];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.hypot(dx, Math.min(0, y + 0.5 - cy));
      if (d < r - 0.3) g.set(x, y, y === 15 ? MOUNT.R0 : MOUNT.VOID);
      else if (d < r + 0.7) g.set(x, y, MOUNT.OUT);
      else if (d < r + 2.2) g.set(x, y, dx < -1 ? (y < cy ? MOUNT.R4 : MOUNT.R3) : dx < 1.5 ? MOUNT.R3 : y < cy ? MOUNT.R2 : MOUNT.R1);
    }
  }
  // A keystone above the arch.
  stamp(g, ['1441', '1321'], 6, 0, { 1: MOUNT.OUT, 4: MOUNT.R4, 3: MOUNT.R3, 2: MOUNT.R2 });
  return g;
}

/** One step darker along the mountain rock ramp (R0 falls to the outline colour). */
const DARKER: Readonly<Record<number, number>> = {
  [MOUNT.R4]: MOUNT.R3, [MOUNT.R3]: MOUNT.R2, [MOUNT.R2]: MOUNT.R1, [MOUNT.R1]: MOUNT.R0, [MOUNT.R0]: MOUNT.OUT,
};
const darker = (idx: number, when = true): number => (when ? DARKER[idx] ?? idx : idx);

/** Nose columns of each step that are chipped (irregular front edges). */
const chipped = (x: number, step: number): boolean => (x * 7 + step * 5) % 6 === 0;

/**
 * Four steps cut into the rock face, rising toward the top of the tile: grainy
 * treads with chipped front edges over craggy shaded risers, framed by rock side
 * walls; the lowest step is a shade darker where it meets the ground.
 */
function cliffStairs(): PixelGrid {
  const cells = rockCells();
  const grain = rockGrain();
  const riser: RockStyle = { light: -0.3, ramp: [MOUNT.R0, MOUNT.R0, MOUNT.R1, MOUNT.R1, MOUNT.R2], crevice: MOUNT.R0, deep: MOUNT.R0 };
  return paintTile((x, y) => {
    if (x < 3 || x > 12) {
      const right = x > 12;
      const sx = right ? 15 - x : x;
      return sx === 2 ? MOUNT.OUT : rockPixel(cells, grain, x, y, { ...ROCK_STYLE, light: right ? -0.2 : 0.05 });
    }
    const step = y >> 2;
    const low = step === 3;
    switch (y & 3) {
      case 0: return darker(chipped(x, step) ? MOUNT.R3 : MOUNT.R4, low);
      case 1: return darker(grain(x, y) > 0.6 ? MOUNT.R2 : MOUNT.R3, low);
      case 2: return darker(rockPixel(cells, grain, x, y, riser), low);
      default: return darker(MOUNT.R0, low);
    }
  });
}

/** Rows y = 3..13 of the sunken stairwell: the dark far wall, then three steps fading into the dark. */
const STAIRWELL_ROWS = [
  MOUNT.R0, MOUNT.VOID, MOUNT.VOID, MOUNT.VOID,
  MOUNT.R0, MOUNT.OUT,
  MOUNT.R2, MOUNT.R1,
  MOUNT.R4, MOUNT.R3, MOUNT.R2,
] as const;

/** Curb stone of the stairwell (dusty mountain stone): `along` runs around the rim; joints every 5 px. */
const curb = (along: number, tone: number): number => (along % 5 === 4 ? MOUNT.R1 : tone);

/**
 * Stone steps sunk into the meadow, descending (northward) into darkness: a
 * block curb frames the opening on three sides, each lower step is darker until
 * the far end is lost in black, and the lit east wall and shaded west wall
 * (casting a shadow onto the treads) make the well read as concave.
 */
function stairsDown(): PixelGrid {
  const grass = grassTile();
  return paintTile((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return grass.get(x, y);
    if (x === 1 || x === 14 || y === 1 || y === 14) return MOUNT.OUT;
    if (y === 2) return curb(x, MOUNT.M2);
    if (x === 2) return curb(y + 2, MOUNT.M1);
    if (x === 13) return curb(y, MOUNT.M0);
    const row = STAIRWELL_ROWS[y - 3]!;
    if (y <= 6) return row;
    if (x === 3) return y < 11 ? MOUNT.VOID : MOUNT.OUT;
    if (x === 12) return y < 9 ? MOUNT.OUT : y < 11 ? MOUNT.R0 : MOUNT.R2;
    const nose = y === 7 || y === 9 || y === 11;
    return darker(row, (nose && chipped(x, y)) || x === 4);
  });
}

/** Mountain painters by tile key. */
export function mountainPainters(): PainterTable {
  return {
    MOUNTAIN_ROCK: () => art(PAL.mount, [mountainRock()]),
    CRACKED_ROCKWALL: () => art(PAL.mount, [crackedRock()]),
    CAVE_ENTRANCE: () => art(PAL.mount, [caveEntrance()]),
    CLIFF_STAIRS: () => art(PAL.mount, [cliffStairs()]),
    STAIRS_DOWN: () => art(PAL.mount, [stairsDown()]),
  };
}
