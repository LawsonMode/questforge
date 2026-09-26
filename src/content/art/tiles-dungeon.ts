// Dungeon tiles: stone floors, carpet, 3/4-view room walls, stone furniture,
// spikes, stairs and pots. Room walls reuse the autotile band geometry with
// the floor as "outside": the top wall is a south-facing piece with a tall
// brick face, side and bottom walls show thin rims, and the room's inner
// corners are concave notches, so every wall piece joins its neighbours.
import { PixelGrid } from './pixelgrid';
import { FACE, TOP, classifyBands, pieceShape, type BandHit, type BandWidths, type PartSuffix } from './tiles-autotile';
import {
  art, clayPot, composite, cylinderLight, paintTile, rampAt, staircase, stamp, type PainterTable,
} from './tiles-kit';
import { DFLOOR_SHADE, DPROP, DUN, PAL } from './tiles-palettes';

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** Bevelled 8x8 flagstone grid: lit top/left edges, shaded bottom/right, dark seams. */
function bevelSquares(tone: (sx: number, sy: number) => number, speckle: (x: number, y: number) => boolean): PixelGrid {
  return paintTile((x, y) => {
    const u = x & 7;
    const v = y & 7;
    const t = tone(x >> 3, y >> 3);
    const ramp = [DUN.D0, DUN.D1, DUN.D2, DUN.D3, DUN.D4];
    if (u === 7 || v === 7) return DUN.D0;
    if (u === 0 || v === 0) return ramp[Math.min(4, t + 1)]!;
    if (u === 6 || v === 6) return ramp[Math.max(0, t - 1)]!;
    return speckle(x, y) ? ramp[Math.max(0, t - 1)]! : ramp[t]!;
  });
}

/** Plain dungeon floor (shared by pits, stairs and floor props). */
export function dungeonFloor(): PixelGrid {
  const wear = [[2, 3], [11, 12], [13, 4]] as const;
  return bevelSquares(() => 2, (x, y) => wear.some(([wx, wy]) => (x === wx && y === wy) || (x === wx + 1 && y === wy)));
}

function checkerFloor(): PixelGrid {
  return bevelSquares((sx, sy) => ((sx + sy) & 1 ? 1 : 3), () => false);
}

/** One large inlaid slab with a diamond rosette. */
function ornateFloor(): PixelGrid {
  return paintTile((x, y) => {
    if (x === 15 || y === 15) return DUN.D0;
    if (x === 0 || y === 0) return DUN.D3;
    if (x === 14 || y === 14) return DUN.D1;
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    if (d < 1.5) return DUN.GOLD;
    if (d < 2.5) return DUN.D1;
    if (d < 3.5) return x + y < 15 ? DUN.D4 : DUN.D3;
    if (d < 4.5) return DUN.D1;
    if (d < 6.5) return DUN.D2;
    if (d < 7.5) return x + y < 15 ? DUN.D3 : DUN.D1;
    const corner = (x < 4 || x > 11) && (y < 4 || y > 11);
    return corner && (x + y) % 2 === 0 ? DUN.D1 : DUN.D2;
  });
}

function crackedFloor(): PixelGrid {
  const g = dungeonFloor();
  stamp(g, [
    '0.......',
    '.0......',
    '.00.....',
    '...0....',
    '...0.0..',
    '....0.0.',
    '.....0..',
  ], 3, 2, { 0: DUN.D0 });
  stamp(g, ['0..', '.00', '...'], 10, 10, { 0: DUN.D0 });
  g.set(4, 2, DUN.D1).set(5, 4, DUN.D3).set(7, 6, DUN.D3).set(11, 11, DUN.D3).set(6, 5, DUN.VOID);
  return g;
}

/** Red carpet: a calm diamond lattice with gold studs at the crossings. */
function carpet(): PixelGrid {
  return paintTile((x, y) => {
    const a = (x + y) & 7;
    const b = (x - y + 16) & 7;
    const stud = ((x + y) & 15) === 0;
    if (a === 0 && b === 0) return stud ? DPROP.GOLD : DPROP.R0;
    if (stud && ((a === 0 && b === 1) || (a === 1 && b === 0))) return DPROP.C3;
    if (a === 0 || b === 0) return DPROP.R0;
    if (a === 4 && b === 4) return DPROP.R2;
    return DPROP.R1;
  });
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

const WALL_BANDS: BandWidths = {
  out: { n: 0, s: 0, e: 0, w: 0 },
  face: { n: 4, s: 11, e: 4, w: 4 },
};

/** Room-wall key -> autotile piece (the wall mass is the terrain, the floor is outside). */
export const WALL_PIECES: Readonly<Record<string, PartSuffix>> = {
  TOP: '_S', BOTTOM: '_N', LEFT: '_E', RIGHT: '_W',
  TL: '_ISE', TR: '_ISW', BL: '_INE', BR: '_INW',
  OTL: '_NW', OTR: '_NE', OBL: '_SW', OBR: '_SE',
  FILL: '',
};

/**
 * Wall top seen from above: flat dark stone with a faint broken diagonal
 * hatch and a few worn specks; no courses or seams, so it never reads as a
 * vertical brick face and a wall mass of any size stays calm.
 */
function wallMass(x: number, y: number): number {
  if (((x + y) & 3) === 0 && ((x - y + 32) & 7) < 3) return DUN.K1;
  return (x * 5 + y * 11) % 37 === 0 ? DUN.OUT : DUN.K0;
}

/**
 * Brick face of the room's back wall (the tall south-facing face): a bright
 * coping rim, two courses of mid-tone bricks (the lower one darker) with dark
 * mortar, and a dark base line where the wall meets the floor.
 */
function backWallFace(x: number, fromRim: number, fromBase: number): number {
  if (fromRim === 0) return DUN.K4;
  if (fromBase === 0) return DUN.OUT;
  if (fromBase === 1) return DUN.K0;
  const course = (fromRim - 1) >> 2;
  const row = (fromRim - 1) & 3;
  const u = (x + (course & 1) * 4) & 7;
  if (row === 3 || u === 7) return DUN.K0;
  const low = course > 0 ? 1 : 0;
  if (row === 0 || u === 0) return [DUN.K3, DUN.K2][low]!;
  return [DUN.K2, DUN.K1][low]!;
}

/**
 * Face of a dungeon wall, by the side it faces: the tall back wall, lit
 * (west-facing) and shaded (east-facing) side walls with 4 px brick courses,
 * and the near (bottom) wall, whose face is hidden so only its lit top edge shows.
 */
function wallFace(hit: BandHit, x: number, y: number): number {
  const { side, fromRim, fromBase } = hit;
  if (side === 's') return backWallFace(x, fromRim, fromBase);
  if (fromBase === 0) return DUN.OUT;
  if (side === 'n') return fromBase === 1 ? DUN.K3 : DUN.K1;
  const lit = side === 'w';
  if (fromRim === 0) return lit ? DUN.K4 : DUN.K2;
  if ((y & 3) === 3) return DUN.K0;
  return lit ? ((y & 3) === 0 ? DUN.K4 : DUN.K3) : (y & 3) === 0 ? DUN.K2 : DUN.K1;
}

function wallTile(suffix: PartSuffix): PixelGrid {
  const shape = pieceShape(suffix);
  return paintTile((x, y) => {
    const hit = classifyBands(shape, WALL_BANDS, x, y);
    if (hit.band === FACE) return wallFace(hit, x, y);
    // A dark joint separates the wall top from the bright coping of the back wall.
    if (hit.band === TOP) {
      const below = classifyBands(shape, WALL_BANDS, x, y + 1);
      if (below.band === FACE && below.side === 's') return DUN.OUT;
    }
    return wallMass(x, y);
  });
}

/** The fracture across the cracked wall top: a jagged zig-zag with one branch (tile px). */
const WALL_CRACK: readonly (readonly [number, number])[] = [
  [3, 2], [4, 3], [4, 4], [5, 5], [6, 5], [7, 6], [7, 7], [8, 8], [9, 8], [9, 9], [10, 10], [11, 11], [11, 12], [12, 13],
  [8, 7], [9, 6], [10, 5], [11, 5],
];

/** DWALL_FILL with a jagged crack (lit upper-left lip, shaded lower-right) and two displaced chips of stone along it. */
function crackedWall(): PixelGrid {
  const g = wallTile('');
  const isCrack = (x: number, y: number): boolean => WALL_CRACK.some(([cx, cy]) => cx === x && cy === y);
  for (const [cx, cy] of WALL_CRACK) {
    if (!isCrack(cx - 1, cy)) g.set(cx - 1, cy, DUN.K2);
    if (!isCrack(cx, cy - 1) && !isCrack(cx - 1, cy - 1)) g.set(cx, cy - 1, DUN.K2);
    if (!isCrack(cx + 1, cy)) g.set(cx + 1, cy, DUN.OUT);
  }
  for (const [cx, cy] of WALL_CRACK) g.set(cx, cy, DUN.VOID);
  // Displaced block edges along the crack.
  stamp(g, ['43', '3.'], 5, 8, { 4: DUN.K3, 3: DUN.K2 });
  stamp(g, ['.4', '43'], 12, 9, { 4: DUN.K3, 3: DUN.K2 });
  return g;
}

// ---------------------------------------------------------------------------
// Stone furniture, spikes, stairs, pots
// ---------------------------------------------------------------------------

function onFloor(obj: PixelGrid, contact?: readonly [number, number, number, number]): PixelGrid {
  return composite(dungeonFloor(), obj, { lut: DFLOOR_SHADE, dx: 1, dy: 1, ...(contact ? { ellipse: contact } : {}) });
}

const STONE = [DUN.K0, DUN.K1, DUN.K2, DUN.K3, DUN.K4];

function pillar(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  // Plinth, shaft (cylinder) and capital.
  for (let x = 2; x <= 13; x++) {
    obj.set(x, 12, DUN.K3).set(x, 13, x < 4 ? DUN.K2 : DUN.K1).set(x, 14, DUN.K1);
  }
  for (let y = 3; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const flute = x === 6 || x === 9 ? -0.12 : 0;
      obj.set(x, y, rampAt(cylinderLight((x + 0.5 - 8) / 4) + flute, STONE, x, y, 0.3));
    }
  }
  for (let x = 3; x <= 12; x++) obj.set(x, 1, DUN.K4).set(x, 2, x < 5 ? DUN.K3 : DUN.K2);
  obj.outline(DUN.OUT);
  return onFloor(obj, [9, 14.8, 6.5, 1.2]);
}

/** Knight statue bearing a shield with a gold cross (o outline, 1-5 stone ramp, g gold). */
const KNIGHT = [
  '......oooo......',
  '.....o4443o.....',
  '....o444332o....',
  '....o4oooo2o....',
  '....o433221o....',
  '..ooo433221ooo..',
  '.o4oooooooooo1o.',
  '.o4o54444443o1o.',
  '.o4o544gg443o1o.',
  '.o4o5gggggg3o1o.',
  '.o4o433gg332o1o.',
  '.o3oo43gg32oo1o.',
  '...o.oo22oo.o...',
  '.o444444444443o.',
  '.o332222222221o.',
  '.oooooooooooooo.',
];

function dStatue(): PixelGrid {
  const obj = PixelGrid.rows(KNIGHT, { o: DUN.OUT, 1: DUN.K0, 2: DUN.K1, 3: DUN.K2, 4: DUN.K3, 5: DUN.K4, g: DUN.GOLD });
  return onFloor(obj);
}

function spikes(): PixelGrid {
  const g = dungeonFloor();
  for (let y = 1; y <= 14; y++) for (let x = 1; x <= 14; x++) g.set(x, y, x === 1 || y === 1 ? DUN.D1 : DUN.D0);
  const spike = [
    '..e..',
    '.edd.',
    '.eddd',
    'edddd',
    '1dd11',
  ];
  for (const [sx, sy] of [[2, 2], [9, 2], [2, 9], [9, 9]] as const) {
    stamp(g, spike, sx, sy, { 0xe: DUN.MET_HI, 0xd: DUN.MET, 1: DUN.OUT });
    g.set(sx + 5, sy + 4, DUN.OUT);
  }
  return g;
}

/** Side walls of a stairwell: a lit left wall and a shaded right wall with dark outer edges. */
function stairSide(x: number, y: number, right: boolean): number {
  if (x === 0) return DUN.OUT;
  if (x === 2) return right ? DUN.K0 : DUN.OUT;
  return right ? ((y & 3) === 3 ? DUN.K0 : DUN.K1) : (y & 3) === 3 ? DUN.K2 : DUN.K3;
}

/** Stairs rising away from the viewer: treads brighten toward the top. */
function stairsUp(): PixelGrid {
  return staircase({
    nose: [DUN.MET_HI, DUN.D4, DUN.D4, DUN.D3],
    tread: [DUN.D4, DUN.D3, DUN.D3, DUN.D2],
    riser: [DUN.D2, DUN.D1, DUN.D1, DUN.D0],
    riserDark: [DUN.D1, DUN.D0, DUN.D0, DUN.OUT],
    sideW: 3,
    side: stairSide,
  });
}

/** Stairs descending away from the viewer: the far steps sink into darkness. */
function stairsDown(): PixelGrid {
  return staircase({
    nose: [DUN.VOID, DUN.D1, DUN.D2, DUN.D4],
    tread: [DUN.VOID, DUN.D0, DUN.D2, DUN.D3],
    riser: [DUN.VOID, DUN.OUT, DUN.D0, DUN.D1],
    riserDark: [DUN.OUT, DUN.VOID, DUN.OUT, DUN.D0],
    sideW: 3,
    side: stairSide,
  });
}

function dPot(): PixelGrid {
  return onFloor(clayPot([DPROP.C0, DPROP.C1, DPROP.C2, DPROP.C3], DPROP.OUT), [9, 14.6, 6, 1.3]);
}

/**
 * Immovable carved stone block in the floor's stone: a lit top face and a
 * bevelled front face (lit top-left edges, shaded bottom-right) carved with a
 * diamond (dark upper-left cut, lit lower-right lip).
 */
function dBlock(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 1; y <= 14; y++) {
    for (let x = 1; x <= 14; x++) {
      if (y <= 4) obj.set(x, y, y === 1 || x === 1 ? DUN.MET_HI : x === 14 || y === 4 ? DUN.D3 : DUN.D4);
      else obj.set(x, y, x === 1 || y === 5 ? DUN.D2 : x === 14 || y === 14 ? DUN.D0 : DUN.D1);
    }
  }
  for (let y = 6; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 9.5) * 1.35;
      if (d > 4.6) continue;
      if (d > 3.6) obj.set(x, y, x + y < 17 ? DUN.OUT : DUN.D3);
      else if (d < 1.6) obj.set(x, y, DUN.D2);
    }
  }
  obj.outline(DUN.OUT);
  return onFloor(obj);
}

/** Dungeon painters by tile key. */
export function dungeonPainters(): PainterTable {
  const table: PainterTable = {
    DFLOOR: () => art(PAL.dungeon, [dungeonFloor()]),
    DFLOOR_TILE: () => art(PAL.dungeon, [checkerFloor()]),
    DFLOOR_ORNATE: () => art(PAL.dungeon, [ornateFloor()]),
    DFLOOR_CRACKED: () => art(PAL.dungeon, [crackedFloor()]),
    CARPET: () => art(PAL.dprop, [carpet()]),
    CRACKED_WALL: () => art(PAL.dungeon, [crackedWall()]),
    PILLAR: () => art(PAL.dungeon, [pillar()]),
    DSTATUE: () => art(PAL.dungeon, [dStatue()]),
    SPIKES: () => art(PAL.dungeon, [spikes()]),
    DSTAIRS_UP: () => art(PAL.dungeon, [stairsUp()]),
    DSTAIRS_DOWN: () => art(PAL.dungeon, [stairsDown()]),
    DPOT: () => art(PAL.dprop, [dPot()]),
    DBLOCK: () => art(PAL.dungeon, [dBlock()]),
  };
  for (const [name, suffix] of Object.entries(WALL_PIECES)) table[`DWALL_${name}`] = () => art(PAL.dungeon, [wallTile(suffix)]);
  return table;
}
