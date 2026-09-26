// House interiors and caves: plank floors, plaster-and-timber room walls (same
// band geometry as the dungeon walls), furniture, a crackling fireplace, and
// the cave floor, rock walls, boulders and exit light.
import { PixelGrid } from './pixelgrid';
import { FACE, TOP, classifyBands, pieceShape, type BandHit, type BandWidths, type PartSuffix } from './tiles-autotile';
import { WALL_PIECES } from './tiles-dungeon';
import {
  art, bayer, clayPot, composite, cylinderLight, dither, paintTile, rampAt, scatter, seeded, sphereLight, stamp, tileNoise, voronoi, wset, wstamp,
  type PainterTable,
} from './tiles-kit';
import { rockCells, rockPixel } from './tiles-mountain';
import { CAVE, FURN, HEARTH, INT, PAL, STONE, WF, WOOD_FLOOR_SHADE } from './tiles-palettes';

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** Butt-joint column of each 4 px plank row (null = a plank running through the whole tile). */
const PLANK_JOINTS = [5, null, 12, 2] as const;

/** Grain streaks: [plank row, first x, length] (wrapping); each dips one px after its first two, light or dark by row parity. */
const PLANK_GRAIN = [[0, 9, 3], [1, 2, 4], [1, 11, 2], [2, 6, 3], [3, 8, 4], [0, 1, 2], [2, 14, 3]] as const;

/**
 * Honey-toned floorboards: 4 px planks whose long dark seam is the only strong
 * line; butt joints are sparse and soft (some planks run through the tile),
 * and short grain streaks run along the boards.
 */
function woodFloor(): PixelGrid {
  const g = paintTile((x, y) => {
    const row = y >> 2;
    const v = y & 3;
    if (v === 3) return WF.D0;
    if (x === PLANK_JOINTS[row]) return WF.D1;
    return v === 0 ? WF.D3 : WF.D2;
  });
  for (const [row, x0, len] of PLANK_GRAIN) {
    for (let i = 0; i < len; i++) wset(g, x0 + i, row * 4 + (i < 2 ? 1 : 2), row % 2 ? WF.D1 : WF.D3);
  }
  return g;
}

/** Grey flagstones for cellars, castles and caves. */
function stoneFloor(): PixelGrid {
  const rng = seeded('interior.stone-floor');
  const cells = voronoi([[3, 3], [11, 3], [7, 9], [15, 10], [2, 12], [11, 14], [7, 1]]);
  const tone = Array.from({ length: cells.count }, () => rng.range(-0.1, 0.1));
  const grain = tileNoise(rng, 8);
  return paintTile((x, y) => {
    if (cells.edge(x, y) < 1.1) return STONE.S0;
    const id = cells.id(x, y);
    if (cells.id(x - 1, y) !== id || cells.id(x, y - 1) !== id || cells.edge(x - 1, y - 1) < 1.1) return STONE.S4;
    if (cells.id(x + 1, y) !== id || cells.id(x, y + 1) !== id || cells.edge(x + 1, y + 1) < 1.1) return STONE.S1;
    return rampAt(0.5 + tone[id]! + (grain(x, y) - 0.5) * 0.3, [STONE.S1, STONE.S2, STONE.S3], x, y, 0.7);
  });
}

function rug(): PixelGrid {
  return paintTile((x, y) => {
    const dx = Math.abs(x - 7.5);
    const dy = Math.abs(y - 7.5);
    const d = dx + dy;
    if (d < 2) return FURN.GOLD;
    if (d < 3) return FURN.BLUE0;
    if (d < 5) return (x + y) & 1 ? FURN.BLUE1 : FURN.BLUE0;
    if (d < 6) return FURN.GOLD;
    const c = Math.abs(dx - 7.5) + Math.abs(dy - 7.5);
    if (c < 1.5) return FURN.GOLD;
    if (c < 2.5) return FURN.BLUE1;
    // Field: plain red with a faint woven dot every few threads.
    return (x & 3) === 1 && (y & 3) === 3 ? FURN.F1 : FURN.RED;
  });
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

const IWALL_BANDS: BandWidths = {
  out: { n: 0, s: 0, e: 0, w: 0 },
  face: { n: 4, s: 12, e: 4, w: 4 },
};

/** Wall top seen from above: dark beam boards. */
function beamTop(x: number, y: number): number {
  if ((y & 3) === 3) return INT.OUT;
  return (x + (y >> 2) * 6) % 16 === 0 ? INT.OUT : (y & 3) === 0 ? INT.B1 : INT.B0;
}

/** Plaster face with a trim rail and a baseboard (back wall); thin plaster rims on the sides. */
function iwallFace(hit: BandHit, x: number, y: number): number {
  const { side, fromRim, fromBase } = hit;
  if (side === 's') {
    if (fromRim === 0) return INT.B2;
    if (fromRim === 1) return INT.P0;
    if (fromBase === 0) return INT.OUT;
    if (fromBase === 1) return INT.B1;
    if (fromBase === 2) return INT.B2;
    if (fromBase === 3) return INT.P0;
    return bayer(x, y) < 0.1 && (x * 3 + y) % 5 === 0 ? INT.P1 : INT.P2;
  }
  if (side === 'n') return fromBase === 0 ? INT.B2 : fromRim === 0 ? INT.OUT : INT.B1;
  if (fromRim === 0) return INT.B2;
  if (fromBase === 0) return INT.OUT;
  return side === 'w' ? INT.P2 : INT.P1;
}

function iwallTile(suffix: PartSuffix): PixelGrid {
  const shape = pieceShape(suffix);
  return paintTile((x, y) => {
    const hit = classifyBands(shape, IWALL_BANDS, x, y);
    if (hit.band === FACE) return iwallFace(hit, x, y);
    if (hit.band === TOP && classifyBands(shape, IWALL_BANDS, x, y + 1).band === FACE) return INT.B1;
    return beamTop(x, y);
  });
}

function iwallWindow(): PixelGrid {
  const g = iwallTile('_S');
  for (let y = 6; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      if (x === 4 || x === 11 || y === 6 || y === 11) g.set(x, y, INT.B0);
      else if (x === 8 || y === 8) g.set(x, y, INT.B1);
      else g.set(x, y, (x < 8 ? x - 5 : x - 9) + (y < 8 ? y - 7 : y - 9) <= 0 ? INT.SKY_HI : INT.SKY);
    }
  }
  for (let x = 3; x <= 12; x++) g.set(x, 12, x === 3 ? INT.B2 : INT.B1);
  return g;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

function onWood(obj: PixelGrid, contact?: readonly [number, number, number, number]): PixelGrid {
  return composite(woodFloor(), obj, { lut: WOOD_FLOOR_SHADE, dx: 1, dy: 1, ...(contact ? { ellipse: contact } : {}) });
}

function diningTable(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 2; y <= 12; y++) {
    for (let x = 1; x <= 14; x++) {
      if (y <= 10) obj.set(x, y, y === 2 || x === 1 ? FURN.F3 : (y - 2) % 4 === 0 ? FURN.F1 : FURN.F2);
      else obj.set(x, y, y === 11 ? FURN.F1 : FURN.F0);
    }
  }
  for (const lx of [2, 12]) for (let y = 13; y <= 14; y++) obj.set(lx, y, FURN.F1).set(lx + 1, y, FURN.F0);
  // A mug and a candle for scale.
  stamp(obj, ['.bb.', 'baab', '.aa.'], 4, 4, { 0xb: FURN.CLOTH, 0xa: FURN.BLUE1 });
  stamp(obj, ['f', 'c', 'c'], 10, 3, { 0xf: FURN.GOLD, 0xc: FURN.CLOTH });
  obj.outline(FURN.OUT);
  return onWood(obj);
}

function stool(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 9; y <= 12; y++) obj.set(4, y, FURN.F1).set(11, y, FURN.F0).set(8, y - 1, FURN.F0);
  for (let y = 4; y <= 9; y++) {
    for (let x = 3; x <= 12; x++) {
      const nx = (x + 0.5 - 8) / 5;
      const ny = (y + 0.5 - 6) / 2.6;
      if (nx * nx + ny * ny > 1) continue;
      obj.set(x, y, y >= 8 ? FURN.F1 : rampAt(0.35 + sphereLight(nx * 0.6, ny * 0.6) * 0.8, [FURN.F2, FURN.F3], x, y, 0.4));
    }
  }
  obj.outline(FURN.OUT);
  return onWood(obj, [8.5, 12.8, 5, 1.2]);
}

function bedTop(): PixelGrid {
  return onWood(paintBed(true));
}

function bedBottom(): PixelGrid {
  return onWood(paintBed(false));
}

/** The bed spans two tiles; paint its 16x32 whole and take the requested half. */
function paintBed(head: boolean): PixelGrid {
  const b = new PixelGrid(16, 32);
  // Frame: headboard, side rails, footboard.
  for (let y = 0; y <= 30; y++) {
    for (let x = 1; x <= 14; x++) {
      if (y <= 3) b.set(x, y, y === 0 || x === 1 ? FURN.F3 : y === 3 ? FURN.F0 : FURN.F2);
      else if (y >= 27) b.set(x, y, y === 27 ? FURN.F3 : x === 1 ? FURN.F2 : y === 30 ? FURN.F0 : FURN.F1);
      else if (x === 1 || x === 14) b.set(x, y, x === 1 ? FURN.F2 : FURN.F0);
      else if (y <= 11) b.set(x, y, FURN.CLOTH);
      else if (y <= 13) b.set(x, y, y === 12 ? FURN.CLOTH : FURN.BLUE0);
      else b.set(x, y, x === 2 || (x + y) % 11 === 0 ? FURN.BLUE0 : FURN.BLUE1);
    }
  }
  // Pillow: a plump rounded cushion with a cool shadow along its lower right.
  stamp(b, [
    '.111111111.',
    '1bbbbbbbbb1',
    '1bbbbbbbba1',
    '1bbbbbbbba1',
    '1abbbbbbaa1',
    '.111111111.',
  ], 2, 4, { 1: FURN.OUT, 0xb: FURN.CLOTH, 0xa: FURN.BLUE1 });
  // Blanket folds.
  for (let x = 3; x <= 12; x++) b.set(x, 19, (x & 1) === 0 ? FURN.BLUE0 : FURN.BLUE1);
  for (let y = 14; y <= 26; y++) b.set(13, y, FURN.BLUE0);
  b.outline(FURN.OUT);
  return b.crop(0, head ? 0 : 16, 16, 16);
}

const BOOK_COLORS = [FURN.RED, FURN.BLUE1, FURN.GOLD, FURN.F3, FURN.BLUE0, FURN.CLOTH, FURN.RED];

function shelf(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  const rng = seeded('interior.shelf');
  for (let y = 0; y <= 15; y++) {
    for (let x = 1; x <= 14; x++) {
      const frame = x === 1 || x === 14 || y === 0 || y === 15 || y === 5 || y === 10;
      obj.set(x, y, frame ? (y === 0 || x === 1 ? FURN.F3 : y === 15 ? FURN.F0 : FURN.F2) : FURN.F0);
    }
  }
  for (const top of [1, 6, 11]) {
    let x = 2;
    while (x <= 12) {
      const w = rng.chance(0.3) ? 2 : 1;
      const h = rng.int(2, 4);
      const c = rng.pick(BOOK_COLORS);
      for (let k = 0; k < w && x + k <= 13; k++) {
        for (let y = top + 4 - h; y <= top + 3; y++) obj.set(x + k, y, c);
      }
      x += w + (rng.chance(0.2) ? 1 : 0);
    }
  }
  obj.outline(FURN.OUT);
  return onWood(obj);
}

function barrel(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 5; y <= 14; y++) {
    for (let x = 2; x <= 13; x++) {
      const band = y === 7 || y === 12;
      const stave = (x - 2) % 3 === 2 ? -0.15 : 0;
      const wood = rampAt(cylinderLight((x + 0.5 - 8) / 6) + stave, [FURN.F0, FURN.F1, FURN.F2, FURN.F3], x, y, 0.4);
      obj.set(x, y, band ? (x < 6 ? FURN.F1 : FURN.OUT) : wood);
    }
  }
  for (let y = 1; y <= 5; y++) {
    for (let x = 2; x <= 13; x++) {
      const nx = (x + 0.5 - 8) / 6;
      const ny = (y + 0.5 - 3.5) / 2.6;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      obj.set(x, y, d > 0.62 ? FURN.F1 : (x & 1) === 0 ? FURN.F2 : FURN.F3);
    }
  }
  obj.outline(FURN.OUT);
  return onWood(obj, [8.5, 14.5, 6, 1.2]);
}

function crate(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 1; y <= 14; y++) {
    for (let x = 1; x <= 14; x++) {
      if (y <= 4) obj.set(x, y, y === 1 || x === 1 ? FURN.F3 : (x & 3) === 0 ? FURN.F1 : FURN.F2);
      else {
        const frame = x <= 2 || x >= 13 || y === 5 || y >= 13;
        const brace = Math.abs(x - 2 - (y - 5) * (10 / 8)) < 1;
        obj.set(x, y, frame ? (x <= 2 ? FURN.F2 : FURN.F1) : brace ? FURN.F2 : (y & 1) === 0 ? FURN.F0 : FURN.F1);
      }
    }
  }
  obj.outline(FURN.OUT);
  return onWood(obj);
}

// Fireplace: stone surround with a mantel; the fire flickers over 3 frames.
const FLAMES: readonly (readonly string[])[] = [
  ['...1....', '..121.1.', '.12321..', '.13431.1', '1234321.', '12344321'],
  ['.....1..', '.1..121.', '..12321.', '.134321.', '.1234431', '12344321'],
  ['..1.....', '.121..1.', '.1232.1.', '.123431.', '1234431.', '12344321'],
];

function fireplace(): PixelGrid[] {
  const base = new PixelGrid(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const u = (x + ((y >> 2) & 1) * 3) % 6;
      const mortar = (y & 3) === 3 || u === 5;
      base.set(x, y, mortar ? HEARTH.S0 : x === 0 || (y & 3) === 0 ? HEARTH.S3 : u === 4 ? HEARTH.S1 : HEARTH.S2);
    }
  }
  for (let x = 0; x < 16; x++) base.set(x, 1, WF.D3).set(x, 2, WF.D2).set(x, 3, HEARTH.OUT);
  for (let y = 5; y <= 14; y++) {
    for (let x = 3; x <= 12; x++) {
      const arch = y > 6 || Math.hypot(x + 0.5 - 8, y + 0.5 - 7.5) < 5.2;
      if (!arch) continue;
      base.set(x, y, x === 3 || x === 12 ? HEARTH.OUT : HEARTH.SOOT);
    }
  }
  for (let x = 2; x <= 13; x++) base.set(x, 15, HEARTH.S3);
  for (let x = 4; x <= 11; x++) base.set(x, 14, x % 3 === 0 ? WF.D1 : WF.D2);
  const map = { 1: HEARTH.F0, 2: HEARTH.F1, 3: HEARTH.F2, 4: HEARTH.F3 };
  return FLAMES.map((flame) => stamp(base.clone(), flame, 4, 8, map));
}

// ---------------------------------------------------------------------------
// Exit mat
// ---------------------------------------------------------------------------

/**
 * A woven doormat in the doorway gap: red border, straw basket weave, a
 * fringe along its outer edge and daylight spilling in from outside.
 */
function exitMat(): PixelGrid {
  const g = woodFloor();
  for (let y = 3; y <= 12; y++) {
    for (let x = 2; x <= 13; x++) {
      if (x === 2 || x === 13 || y === 3 || y === 12) g.set(x, y, INT.OUT);
      else if (x === 3 || x === 12 || y === 4 || y === 11) g.set(x, y, INT.MAT);
      else g.set(x, y, ((x >> 1) + (y >> 1)) & 1 ? INT.P1 : (x + y) & 1 ? INT.P2 : INT.P0);
    }
  }
  for (let x = 3; x <= 12; x += 2) g.set(x, 13, INT.P1);
  // Daylight spilling in through the doorway.
  for (let y = 14; y <= 15; y++) for (let x = 2; x <= 13; x++) if (bayer(x, y) < (y === 15 ? 0.75 : 0.35)) g.set(x, y, INT.P2);
  return g;
}

// ---------------------------------------------------------------------------
// Cave
// ---------------------------------------------------------------------------

/** Hairline cracks and grit for the cave floor, scattered at varied sizes. */
const CAVE_MARKS: readonly (readonly string[])[] = [
  ['11..', '..11'], ['1.', '.1'], ['43', '21'], ['4', '1'], ['4'], ['.1', '1.'], ['3', '1'],
];

/** Packed earth: soft patches with hairline cracks and grit scattered at varied sizes (no rows). */
function caveFloor(): PixelGrid {
  const rng = seeded('cave.floor');
  const n = tileNoise(rng, 4);
  const g = paintTile((x, y) => rampAt(0.15 + n(x, y) * 0.7, [CAVE.D1, CAVE.D2, CAVE.D2, CAVE.D3], x, y, 0.35));
  for (const [x, y] of scatter(rng, 8, 3.8)) {
    wstamp(g, rng.pick(CAVE_MARKS), Math.floor(x), Math.floor(y), { 4: CAVE.D4, 3: CAVE.D3, 2: CAVE.D1, 1: CAVE.D0 });
  }
  return g;
}

const CAVE_ROCK = { light: -0.08, ramp: [CAVE.K0, CAVE.K1, CAVE.K2, CAVE.K3, CAVE.K4], crevice: CAVE.K0, deep: CAVE.OUT };

function caveWall(): PixelGrid {
  const cells = rockCells();
  const grain = tileNoise(seeded('cave.grain'), 8);
  return paintTile((x, y) => rockPixel(cells, grain, x + 5, y + 3, CAVE_ROCK));
}

function caveRocks(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  const ramp = [CAVE.K1, CAVE.K2, CAVE.K3, CAVE.K4];
  for (const [cx, cy, rx, ry] of [[5, 6, 4.2, 3.6], [11, 7.5, 4, 3.4], [7.5, 11, 5, 3.8]] as const) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        obj.set(x, y, rampAt(sphereLight(Math.round(nx * 2) / 2, Math.round(ny * 2) / 2), ramp, x, y, 0.3));
      }
    }
  }
  obj.outline(CAVE.OUT);
  return composite(caveFloor(), obj, { lut: { 3: 2, 4: 3, 5: 4, 6: 5 }, dx: 1, dy: 1 });
}

/** Daylight pouring in through an opening at the bottom edge of the tile. */
function caveExit(): PixelGrid {
  const g = caveFloor();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Distance from a point below the tile: brightest at the bottom centre.
      const d = Math.hypot((x + 0.5 - 8) * 1.05, y + 0.5 - 18);
      const k = (16 - d) / 7.5;
      if (k <= 0) continue;
      const v = k > 0.72 ? CAVE.L0 : k > 0.5 ? (dither(k - 0.5 + 0.3, x, y) ? CAVE.L0 : CAVE.L1)
        : k > 0.28 ? (dither((k - 0.28) * 3.5, x, y) ? CAVE.L1 : CAVE.L2)
          : dither(k * 3.5, x, y) ? CAVE.L2 : -1;
      if (v >= 0) g.set(x, y, v);
    }
  }
  return g;
}

/** Interior & cave painters by tile key. */
export function interiorPainters(): PainterTable {
  const table: PainterTable = {
    WOOD_FLOOR: () => art(PAL.interior, [woodFloor()]),
    STONE_FLOOR: () => art(PAL.stone, [stoneFloor()]),
    IWALL_WINDOW: () => art(PAL.interior, [iwallWindow()]),
    TABLE: () => art(PAL.furniture, [diningTable()]),
    STOOL: () => art(PAL.furniture, [stool()]),
    BED_TOP: () => art(PAL.furniture, [bedTop()]),
    BED_BOTTOM: () => art(PAL.furniture, [bedBottom()]),
    SHELF: () => art(PAL.furniture, [shelf()]),
    RUG: () => art(PAL.furniture, [rug()]),
    FIREPLACE: () => art(PAL.hearth, fireplace(), 0.14),
    IPOT: () => art(PAL.furniture, [composite(woodFloor(), clayPot([FURN.F0, FURN.F1, FURN.F2, FURN.F3], FURN.OUT), {
      lut: WOOD_FLOOR_SHADE, dx: 1, dy: 1, ellipse: [9, 14.6, 6, 1.3],
    })]),
    BARREL: () => art(PAL.furniture, [barrel()]),
    CRATE: () => art(PAL.furniture, [crate()]),
    EXIT_MAT: () => art(PAL.interior, [exitMat()]),
    CAVE_FLOOR: () => art(PAL.cave, [caveFloor()]),
    CAVE_WALL: () => art(PAL.cave, [caveWall()]),
    CAVE_ROCKS: () => art(PAL.cave, [caveRocks()]),
    CAVE_EXIT: () => art(PAL.cave, [caveExit()]),
  };
  for (const [name, suffix] of Object.entries(WALL_PIECES)) {
    if (name === 'FILL' || name.startsWith('O')) continue;
    table[`IWALL_${name}`] = () => art(PAL.interior, [iwallTile(suffix)]);
  }
  return table;
}
