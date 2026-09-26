// Buildings: a shingled roof 9-slice (front slope seen from the south, ridge
// cap on top, verge boards at the sides, eave board with a cast shadow at the
// bottom), a timber-framed house front, castle stone walls and bridges. All
// repeating parts are 16-periodic so any roof/wall size >= 3x3 assembles cleanly.
import { PixelGrid } from './pixelgrid';
import { art, bayer, paintTile, seeded, stamp, tileNoise, type PainterTable } from './tiles-kit';
import { HOUSE, PAL, ROOF, STONE, WOOD } from './tiles-palettes';

// ---------------------------------------------------------------------------
// Roof
// ---------------------------------------------------------------------------

/**
 * Scalloped shingle course (8x4; digits index ROOF.S0..S4): each course comes
 * out from under the one above with a lit top edge and ends in a rounded tab
 * whose corners leave dark shadow notches; courses are offset by 4 px.
 */
const SHINGLE = ['44444443', '33333332', '12333321', '00122100'];

/**
 * Shingle pixel. `slope` shades the roof from ridge to eave: +1 on the top
 * row of tiles (lighter), 0 in the middle, -1 on the eave row (darker).
 */
function shingle(x: number, y: number, slope: number): number {
  const row = y >> 2;
  const v = y & 3;
  const u = (x + (row & 1) * 4) & 7;
  const step = Number(SHINGLE[v]![u]);
  // Lighter tab bodies near the ridge; darker top edges and bodies at the eave.
  const shift = (slope > 0 && v === 1) || (slope < 0 && v <= 1) ? slope : 0;
  return ROOF.S0 + Math.max(0, Math.min(4, step + shift));
}

interface RoofEdges { top: boolean; bottom: boolean; left: boolean; right: boolean }

/** Rolled ridge cap: half-round tiles 4 px long, lit on top and at their left ends. */
function ridge(x: number, y: number): number {
  if (y === 0 || y === 4) return ROOF.OUT;
  const u = x & 3;
  if (u === 3) return y === 1 ? ROOF.C1 : ROOF.C0;
  if (y === 1) return ROOF.C2;
  if (y === 2) return u === 0 ? ROOF.C2 : ROOF.C1;
  return ROOF.C0;
}

function roofTile(e: RoofEdges): PixelGrid {
  const slope = e.top ? 1 : e.bottom ? -1 : 0;
  return paintTile((x, y) => {
    // Verge boards (gable edges): lit on the left, shaded on the right.
    if (e.left && x <= 3) {
      if (x === 0) return ROOF.OUT;
      if (e.bottom && y >= 13) return y === 15 ? ROOF.OUT : ROOF.V1;
      return [ROOF.OUT, ROOF.V3, ROOF.V2, ROOF.OUT][x]!;
    }
    if (e.right && x >= 12) {
      if (x === 15) return ROOF.OUT;
      if (e.bottom && y >= 13) return y === 15 ? ROOF.OUT : ROOF.V0;
      return [ROOF.OUT, ROOF.V2, ROOF.V1, ROOF.OUT][x - 12]!;
    }
    if (e.top && y <= 4) return ridge(x, y);
    // Eave board and its shadow line.
    if (e.bottom && y >= 12) {
      if (y === 12) return ROOF.OUT;
      if (y === 13) return ROOF.V3;
      if (y === 14) return ROOF.V2;
      return ROOF.OUT;
    }
    // Shadow under the ridge / beside the verge boards.
    if (e.top && y === 5) return x & 1 ? ROOF.S0 : ROOF.OUT;
    if (e.left && x === 4) return ROOF.S1;
    return shingle(x, y, slope);
  });
}

/** ROOF_<part> painters; the part name (TL, T, TR, L, M, R, BL, B, BR) says which edges it carries. */
function roofPainters(): PainterTable {
  const table: PainterTable = {};
  for (const part of ['TL', 'T', 'TR', 'L', 'M', 'R', 'BL', 'B', 'BR']) {
    const edges = { top: part.startsWith('T'), bottom: part.startsWith('B'), left: part.endsWith('L'), right: part.endsWith('R') };
    table[`ROOF_${part}`] = () => art(PAL.roof, [roofTile(edges)]);
  }
  return table;
}

// ---------------------------------------------------------------------------
// House front
// ---------------------------------------------------------------------------

/** Plaster panel between timber: eave shadow on top, timber post at the left, stone footing. */
function houseWall(): PixelGrid {
  const n = tileNoise(seeded('building.plaster'), 8);
  return paintTile((x, y) => {
    if (y >= 12) {
      // Stone footing: two courses of blocks.
      if (y === 12) return HOUSE.T0;
      const u = (x + (y < 14 ? 0 : 4)) & 7;
      if (u === 7 || y === 15) return HOUSE.OUT;
      return u === 0 || y === 13 ? HOUSE.F1 : HOUSE.F0;
    }
    if (y <= 1) return y === 0 ? HOUSE.OUT : HOUSE.T0;
    if (x <= 1) return x === 0 ? HOUSE.T2 : HOUSE.T0;
    if (y === 2) return HOUSE.T1;
    if (y === 3) return HOUSE.P0;
    if (y === 11) return HOUSE.P1;
    const v = n(x, y);
    if (v > 0.7 && bayer(x, y) < 0.4) return HOUSE.P3;
    if (v < 0.3 && bayer(x, y) < 0.4) return HOUSE.P1;
    return x === 2 ? HOUSE.P1 : HOUSE.P2;
  });
}

/** Wall with a lamp-lit window: shutters, dark frame, cross mullion, sill. */
function houseWindow(): PixelGrid {
  const g = houseWall();
  for (let y = 3; y <= 10; y++) {
    g.set(2, y, HOUSE.T2).set(3, y, y % 3 === 0 ? HOUSE.T0 : HOUSE.T1);
    g.set(12, y, y % 3 === 0 ? HOUSE.T0 : HOUSE.T1).set(13, y, HOUSE.T0);
    for (let x = 4; x <= 11; x++) {
      if (x === 4 || x === 11 || y === 3 || y === 10 || x === 8 || y === 6) {
        g.set(x, y, x === 8 || y === 6 ? HOUSE.T1 : HOUSE.OUT);
        continue;
      }
      // Each pane glows brighter toward its top-left.
      const px = x < 8 ? x - 5 : x - 9;
      const py = y < 6 ? y - 4 : y - 7;
      g.set(x, y, px + py === 0 ? HOUSE.L2 : px + py >= 3 ? HOUSE.L0 : HOUSE.L1);
    }
  }
  for (let x = 3; x <= 12; x++) g.set(x, 11, x === 3 ? HOUSE.T2 : HOUSE.T1);
  return g;
}

/**
 * Wall with a tall open doorway (10 px wide, 12 px high, hero-sized): lintel
 * and posts, a dark interior with a glimpse of floor, and a stone threshold
 * in place of the footing so the doorway meets the ground.
 */
function houseDoor(): PixelGrid {
  const g = houseWall();
  for (let y = 2; y <= 15; y++) {
    for (let x = 2; x <= 13; x++) {
      if (y === 2) g.set(x, y, x === 2 ? HOUSE.T2 : HOUSE.T1);
      else if (x === 2) g.set(x, y, HOUSE.T2);
      else if (x === 13) g.set(x, y, HOUSE.T0);
      else if (y === 15) g.set(x, y, x === 3 ? HOUSE.F0 : HOUSE.F1);
      else if (y === 3 || x === 3) g.set(x, y, HOUSE.OUT);
      else g.set(x, y, y >= 12 ? HOUSE.D1 : HOUSE.D0);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Castle stone
// ---------------------------------------------------------------------------

/** Running-bond ashlar blocks (8x4), lit top/left, with a few moss patches. */
function stoneWall(): PixelGrid {
  const n = tileNoise(seeded('building.stone'), 8);
  const g = paintTile((x, y) => {
    const course = y >> 2;
    const u = (x + (course & 1) * 4) & 7;
    const v = y & 3;
    if (v === 3 || u === 7) return STONE.S0;
    if (v === 0) return u === 0 ? STONE.S5 : STONE.S4;
    if (u === 0) return STONE.S3;
    if (u === 6 || v === 2) return STONE.S2;
    return n(x, y) > 0.68 && bayer(x, y) < 0.5 ? STONE.S2 : STONE.S3;
  });
  stamp(g, ['.9.', '989', '.8.'], 11, 6, { 9: STONE.MOSS1, 8: STONE.MOSS0 });
  stamp(g, ['98', '8.'], 2, 14, { 9: STONE.MOSS1, 8: STONE.MOSS0 });
  return g;
}

/**
 * Top of a castle wall seen from above, drawn as a single-row parapet walk
 * (the merlons are part of the tile, so it caps one row of STONE_WALL): worn
 * square flagstones on the wall's 8 px module with a hairline crack and moss,
 * and a crenellated parapet along the front.
 */
function stoneWallTop(): PixelGrid {
  const n = tileNoise(seeded('building.wall-top'), 8);
  const g = paintTile((x, y) => {
    if (y <= 8) {
      if (y === 8) return STONE.S0;
      const u = x & 7;
      if (y === 7 || u === 7) return STONE.S1;
      if (y === 0 || u === 0) return STONE.S4;
      const wear = n(x, y);
      if (wear > 0.66 && bayer(x, y) < 0.3) return STONE.S2;
      return wear < 0.25 && bayer(x, y) < 0.2 ? STONE.S4 : STONE.S3;
    }
    const merlon = (x >= 1 && x <= 6) || (x >= 9 && x <= 14);
    if (!merlon) return y === 15 ? STONE.OUT : y === 9 ? STONE.S0 : STONE.M0;
    const left = x === 1 || x === 9;
    const right = x === 6 || x === 14;
    if (y === 9) return STONE.S5;
    if (y === 10) return left ? STONE.S5 : STONE.S4;
    if (y === 15) return STONE.OUT;
    if (y === 14) return STONE.S1;
    return left ? STONE.S3 : right ? STONE.S1 : STONE.S2;
  });
  stamp(g, ['1..', '.11', '...1'], 10, 2, { 1: STONE.S1 });
  stamp(g, ['98'], 3, 6, { 9: STONE.MOSS1, 8: STONE.MOSS0 });
  return g;
}

// ---------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------

/** Rail rows across the bridge (from its outer edge inward) and the posts that rise above them every 8 px. */
const RAIL = [WOOD.OUT, WOOD.W4, WOOD.W1, WOOD.OUT] as const;
const isPost = (along: number): boolean => (along & 7) === 2 || (along & 7) === 3;

/**
 * Deck boards laid across the direction of travel between two rails. Each rail
 * is a dark beam with a lit top, set off from the deck by a dark gap, with
 * posts every 8 px; the far side ends in a shadow line on the water.
 * Painted for the horizontal bridge (along = x, across = y) and transposed.
 */
function bridge(horizontal: boolean): PixelGrid {
  return paintTile((xx, yy) => {
    const [along, across] = horizontal ? [xx, yy] : [yy, xx];
    const post = isPost(along);
    const lit = (along & 7) === 2;
    if (across <= 3) return post ? (across === 0 ? WOOD.W4 : lit ? WOOD.W3 : WOOD.W1) : RAIL[across]!;
    if (across >= 12) {
      const r = 15 - across;
      if (post) return r === 3 ? WOOD.OUT : lit ? WOOD.W3 : WOOD.W1;
      return [WOOD.OUT, WOOD.W1, WOOD.W4, WOOD.OUT][r]!;
    }
    // Boards 4 px wide: lit leading edge, body, dark seam; a nail near each rail.
    const board = along >> 2;
    const u = along & 3;
    if (u === 3) return WOOD.W0;
    if (u === 0) return WOOD.W3;
    if ((across === 5 || across === 10) && u === 1) return WOOD.W1;
    const [body, grain] = board & 1 ? [WOOD.W2, WOOD.W1] : [WOOD.W3, WOOD.W2];
    return (board * 5 + across * 3) % 7 === 0 ? grain : body;
  });
}

/** Building painters by tile key. */
export function buildingPainters(): PainterTable {
  return {
    ...roofPainters(),
    HOUSE_WALL: () => art(PAL.house, [houseWall()]),
    HOUSE_WINDOW: () => art(PAL.house, [houseWindow()]),
    HOUSE_DOOR: () => art(PAL.house, [houseDoor()]),
    STONE_WALL: () => art(PAL.stone, [stoneWall()]),
    STONE_WALL_TOP: () => art(PAL.stone, [stoneWallTop()]),
    BRIDGE_H: () => art(PAL.wood, [bridge(true)]),
    BRIDGE_V: () => art(PAL.wood, [bridge(false)]),
  };
}
