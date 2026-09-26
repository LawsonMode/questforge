// Placed objects: chests, push blocks, switches, crystal switches, pegs, torch,
// pot and sign. Doors live in core-doors.ts.
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { centred, pix, SpriteBuilder, type Legend } from './core-draw';
import { PAL } from './core-palettes';
import { clayPot } from './tiles-kit';

/** pal.c.wood layout. */
const WD = { o: 1, D: 2, m: 3, l: 4, Y: 5, y: 6, W: 7, i: 8, I: 9, C: 10, c: 11, k: 12, x: 13, r: 14, b: 15 } as const satisfies Legend;
/** pal.c.stone layout (K..H = the dungeon wall ramp, darkest to highlight). */
export const ST = { o: 1, K: 2, D: 3, M: 4, L: 5, H: 6, V: 7, w: 8, u: 9, Y: 10, y: 11, R: 12, F: 13, E: 14, X: 15 } as const satisfies Legend;
/** pal.c.crystal layout. */
const CR = { o: 1, R: 2, r: 3, p: 4, B: 5, b: 6, v: 7, W: 8, K: 9, D: 10, M: 11, L: 12, H: 13, y: 14 } as const satisfies Legend;
const O = 1;

// ============================================================================
// Chests
// ============================================================================

const CHEST_CLOSED = pix([
  '.YyllllllllyY.',
  'YyllllllllllyY',
  'YymmmmmmmmmmyY',
  'YymmmmmmmmmmyY',
  'YymmmmyymmmmyY',
  'DDDDDDyWDDDDDD',
  'YymmmmyxmmmmyY',
  'YymmmmYYmmmmyY',
  'YymmmmmmmmmmyY',
  'YyDDDDDDDDDDyY',
  'YymmmmmmmmmmyY',
  'YYDDDDDDDDDDYY',
], WD);

const CHEST_OPEN = pix([
  '.YyDDDDDDDDyY.',
  'YyDmmmmmmmmDyY',
  'YyDDDDDDDDDDyY',
  'YyxxxxxxxxxxyY',
  'YyxxxxxxxxxxyY',
  'DDDDDDDDDDDDDD',
  'YymmmmmmmmmmyY',
  'YymmmmyymmmmyY',
  'YymmmmYYmmmmyY',
  'YyDDDDDDDDDDyY',
  'YymmmmmmmmmmyY',
  'YYDDDDDDDDDDYY',
], WD);

export function buildChest(): SpriteDef {
  return new SpriteBuilder('obj.chest', PAL.wood)
    .anim('closed', [centred(CHEST_CLOSED, 16, 16, 0, 1).outline(O)])
    .anim('open', [centred(CHEST_OPEN, 16, 16, 0, 1).outline(O)])
    .build();
}

/** Big chest body (rows 12.. of the 32x24 frame): dark wood, gold frame, blue gems. */
function bigChestBody(g: PixelGrid, top: number): void {
  const bottom = 22;
  g.fill(3, top, 26, bottom - top + 1, WD.m);
  for (let y = top + 3; y < bottom; y += 3) g.fill(4, y, 24, 1, WD.D);
  // Gold frame and vertical bands.
  g.rect(3, top, 26, bottom - top + 1, WD.Y);
  g.fill(4, top, 24, 1, WD.y);
  for (const x of [7, 23]) {
    g.fill(x, top, 2, bottom - top + 1, WD.y);
    g.fill(x + 1, top, 1, bottom - top + 1, WD.Y);
  }
  // Gems on the bands.
  for (const x of [7, 23]) g.fill(x, top + 4, 2, 2, WD.b).set(x, top + 4, WD.W);
}

function bigChest(open: boolean): PixelGrid {
  const g = new PixelGrid(32, 24);
  if (open) {
    // Lid thrown back: its underside is visible above the dark, glowing interior.
    g.fill(4, 1, 24, 5, WD.D);
    g.fill(5, 2, 22, 3, WD.m);
    g.rect(4, 1, 24, 5, WD.Y);
    g.fill(4, 6, 24, 6, WD.x);
    g.fill(8, 8, 16, 3, WD.Y);
    g.fill(10, 7, 12, 2, WD.y);
    g.fill(13, 6, 6, 1, WD.W);
    bigChestBody(g, 12);
    g.fill(14, 13, 4, 3, WD.Y).fill(15, 13, 2, 2, WD.y);
  } else {
    // Rounded lid.
    g.fill(5, 2, 22, 1, WD.Y);
    g.fill(4, 3, 24, 9, WD.m);
    g.fill(4, 3, 24, 2, WD.l);
    g.fill(5, 2, 22, 1, WD.y);
    for (const x of [7, 23]) {
      g.fill(x, 2, 2, 10, WD.y);
      g.fill(x + 1, 3, 1, 9, WD.Y);
    }
    g.fill(4, 8, 24, 1, WD.D);
    g.fill(3, 11, 26, 1, WD.D);
    bigChestBody(g, 12);
    // Big lock plate with keyhole, straddling the seam.
    g.fill(13, 8, 6, 7, WD.y);
    g.fill(18, 8, 1, 7, WD.Y).fill(13, 14, 6, 1, WD.Y);
    g.fill(15, 10, 2, 2, WD.x).set(15, 12, WD.x).set(16, 12, WD.x);
    g.set(14, 9, WD.W);
    g.fill(15, 5, 2, 2, WD.b).set(15, 5, WD.W);
  }
  return g.outline(O);
}

export function buildBigChest(): SpriteDef {
  return new SpriteBuilder('obj.bigChest', PAL.wood).anim('closed', [bigChest(false)]).anim('open', [bigChest(true)]).build();
}

// ============================================================================
// Push block, floor switch
// ============================================================================

/** Bevelled 16x16 stone block; `heavy` = darker, iron-banded with rivets. */
function block(heavy: boolean): PixelGrid {
  const [face, lit, hi, shade, deep] = heavy
    ? [ST.D, ST.M, ST.L, ST.K, ST.o]
    : [ST.M, ST.L, ST.H, ST.D, ST.K];
  const g = new PixelGrid(16, 16, ST.o);
  g.fill(1, 1, 14, 14, face);
  g.fill(1, 1, 14, 2, lit).fill(1, 1, 2, 14, lit);
  g.fill(1, 1, 14, 1, hi).fill(1, 1, 1, 14, hi);
  g.fill(1, 13, 14, 2, shade).fill(13, 1, 2, 14, shade);
  g.fill(2, 14, 13, 1, deep).fill(14, 2, 1, 13, deep);
  g.set(2, 13, lit).set(13, 2, lit);
  if (heavy) {
    // Iron bands and rivets.
    g.fill(3, 7, 10, 2, ST.K).fill(7, 3, 2, 10, ST.K);
    g.fill(3, 7, 10, 1, ST.M).fill(7, 3, 1, 10, ST.M);
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]] as const) g.set(x, y, ST.H).set(x + 1, y + 1, ST.K);
  } else {
    // Carved diamond.
    const d = pix([
      '...KK...',
      '..KHLK..',
      '.KHMMLK.',
      'KHM..DLK',
      'KLD..MDK',
      '.KLMMDK.',
      '..KLDK..',
      '...KK...',
    ].map((r) => r.replace(/\./g, 'M')), ST);
    g.blit(d, 4, 4);
  }
  return g;
}

export function buildBlock(): SpriteDef {
  return new SpriteBuilder('obj.block', PAL.stone).anim('idle', [block(false)]).anim('heavy', [block(true)]).build();
}

function floorSwitch(down: boolean): PixelGrid {
  const g = new PixelGrid(16, 16);
  // Recessed frame in the floor.
  g.fill(1, 2, 14, 13, ST.K);
  g.rect(1, 2, 14, 13, ST.o);
  if (down) {
    g.fill(3, 4, 10, 9, ST.D);
    g.fill(3, 4, 10, 1, ST.K).fill(3, 4, 1, 9, ST.K);
    g.fill(6, 7, 4, 3, ST.M);
  } else {
    g.fill(3, 2, 10, 10, ST.L);
    g.fill(3, 2, 10, 1, ST.H).fill(3, 2, 1, 10, ST.H);
    g.fill(3, 11, 10, 2, ST.D);
    g.fill(12, 3, 1, 9, ST.M);
    g.fill(6, 5, 4, 3, ST.H).fill(7, 6, 2, 1, ST.X);
    g.rect(2, 1, 12, 13, ST.o);
  }
  return g;
}

export function buildSwitch(): SpriteDef {
  return new SpriteBuilder('obj.switch', PAL.stone).anim('up', [floorSwitch(false)]).anim('down', [floorSwitch(true)]).build();
}

// ============================================================================
// Crystal switch & colour pegs
// ============================================================================

const PEDESTAL = pix([
  '..HLLLLLLLLD..',
  '.LMMMMMMMMMMD.',
  '.DDDDDDDDDDDK.',
  '..LMMMMMMMDK..',
  '..DDDDDDDDKK..',
], CR);

function crystalSwitch(red: boolean, phase: 0 | 1): PixelGrid {
  const [dk, md, lt] = red ? [CR.R, CR.r, CR.p] : [CR.B, CR.b, CR.v];
  const g = new PixelGrid(16, 16);
  g.blit(PEDESTAL, 1, 10);
  g.circle(7.5, 6, 5, dk);
  g.circle(7, 5.5, 4, md);
  g.circle(6, 4.5, 2, lt);
  if (phase === 0) g.set(5, 3, CR.W).set(6, 3, CR.W).set(5, 4, CR.W);
  else g.set(6, 4, CR.W).set(9, 8, lt).set(10, 7, lt).set(4, 2, CR.W);
  return g.outline(O);
}

function peg(red: boolean, up: boolean): PixelGrid {
  const [dk, md, lt] = red ? [CR.R, CR.r, CR.p] : [CR.B, CR.b, CR.v];
  const g = new PixelGrid(16, 16);
  if (up) {
    // Raised post: coloured top, stone sides.
    g.fill(2, 2, 12, 8, md);
    g.fill(2, 2, 12, 1, lt).fill(2, 2, 1, 8, lt);
    g.fill(4, 4, 8, 4, dk).fill(5, 5, 6, 2, md);
    g.fill(2, 10, 12, 4, CR.M);
    g.fill(2, 10, 12, 1, CR.L).fill(2, 13, 12, 1, CR.D).fill(13, 10, 1, 4, CR.D);
    g.rect(1, 1, 14, 14, CR.o);
    g.fill(1, 10, 14, 1, CR.o);
  } else {
    // Lowered: a flat coloured tile flush with the floor.
    g.fill(2, 3, 12, 11, CR.K);
    g.fill(3, 4, 10, 9, dk);
    g.fill(4, 5, 8, 7, md);
    g.fill(4, 5, 8, 1, dk);
    g.rect(2, 3, 12, 11, CR.o);
  }
  return g;
}

export function buildCrystalSwitch(): SpriteDef {
  return new SpriteBuilder('obj.crystalSwitch', PAL.crystal)
    .anim('red', [crystalSwitch(true, 0), crystalSwitch(true, 1)])
    .anim('blue', [crystalSwitch(false, 0), crystalSwitch(false, 1)])
    .build();
}

export function buildPeg(): SpriteDef {
  return new SpriteBuilder('obj.peg', PAL.crystal)
    .anim('red_up', [peg(true, true)]).anim('red_down', [peg(true, false)])
    .anim('blue_up', [peg(false, true)]).anim('blue_down', [peg(false, false)])
    .build();
}

// ============================================================================
// Torch (stone brazier)
// ============================================================================

/** Stone brazier in 3/4 view: an elliptical rim around a bed of coals ('V', embers 'a'), a rounded bowl, stem and foot. */
const BRAZIER = [
  '..HHHHHHHH..',
  '.LKVVaVVVKL.',
  'LMKVaVVVaKML',
  'LMMKKKKKKMMD',
  '.LMMMMMMMMD.',
  '..DMMMMMMD..',
  '....DKKD....',
  '....LMDK....',
  '..LLMMMDDK..',
];

const TORCH_FLAMES = [
  pix([
    '...R....',
    '..RR..R.',
    '..RFR.R.',
    '.RFFRRR.',
    '.RFEFFR.',
    'RFEEXEFR',
    'RFEXXEFR',
    '.RFEEFR.',
  ], ST),
  pix([
    '....R...',
    '.R..RR..',
    '.R.RFR..',
    '.RRFFR..',
    '.RFFEFR.',
    'RFEXEEFR',
    'RFEXXEFR',
    '.RFEEFR.',
  ], ST),
  pix([
    '..R.....',
    '..RR.R..',
    '.RFR.RR.',
    '.RFRRFR.',
    '.RFEEFR.',
    'RFEEXEFR',
    'RFEXXEFR',
    '.RFEEFR.',
  ], ST),
];

function torch(flame: PixelGrid | null): PixelGrid {
  const g = new PixelGrid(16, 16);
  // Unlit: dark ash with grey specks. Lit: glowing coals under the flame.
  g.blit(pix(BRAZIER, flame ? { ...ST, V: ST.R, a: ST.F } : { ...ST, V: ST.V, a: ST.D }), 2, 6);
  g.outline(O);
  if (flame) g.blit(flame, 4, 1);
  return g;
}

export function buildTorch(): SpriteDef {
  return new SpriteBuilder('obj.torch', PAL.stone)
    .anim('unlit', [torch(null)])
    .anim('lit', TORCH_FLAMES.map((f) => torch(f)))
    .build();
}

// ============================================================================
// Pot & sign
// ============================================================================

/** The same clay pot as the dungeon DPOT tile (shared painter), so a lifted pot keeps its design. */
export function buildPot(): SpriteDef {
  return new SpriteBuilder('obj.pot', PAL.wood).anim('idle', [clayPot([WD.D, WD.C, WD.c, WD.k], O)]).build();
}

const SIGN = pix([
  'lllllllllllllD',
  'lmmmmmmmmmmmmD',
  'lmDDDmDDDDmmmD',
  'lmmmmmmmmmmmmD',
  'lmDDDDmDDDDmmD',
  'lmmmmmmmmmmmmD',
  'lmDDmDDDmmmmmD',
  'DDDDDDDDDDDDDD',
  '......mD......',
  '......mD......',
  '......mD......',
  '......mD......',
  '.....DmDD.....',
], WD);

export function buildSign(): SpriteDef {
  return new SpriteBuilder('obj.sign', PAL.wood).anim('idle', [centred(SIGN, 16, 16, 0, 0).outline(O)]).build();
}
