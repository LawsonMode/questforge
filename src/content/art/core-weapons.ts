// Sword blade (fx.sword) and every projectile sprite (proj.*).
// fx.sword: the guard sits on the frame centre (the origin) with the grip just
// behind it, the blade runs toward the frame edge in the named direction; the
// player draws it at the hand (HERO_SWORD_POSES).
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { centred, pix, SpriteBuilder, type Legend } from './core-draw';
import { PAL } from './core-palettes';

// ============================================================================
// Sword blade
// ============================================================================

/** pal.c.sword / pal.sword.2 layout. */
const SW = { d: 2, m: 3, l: 4, G: 5, g: 6, R: 7, r: 8, j: 9 } as const satisfies Legend;

// Every blade is 7px of steel past the guard (the diagonal runs 5 diagonal
// steps, the same apparent length), so a swing does not shrink between frames.
const BLADE_E = pix([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......g........',
  '....jrrglllllll.',
  '....jRRGmmmmmd..',
  '.......G........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], SW);

const BLADE_N = pix([
  '................',
  '.......l........',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '......gggG......',
  '.......rR.......',
  '.......rR.......',
  '.......jj.......',
  '................',
  '................',
  '................',
  '................',
], SW);

const BLADE_NE = pix([
  '................',
  '................',
  '.............l..',
  '............lm..',
  '...........lm...',
  '..........lm....',
  '.......g.lm.....',
  '........gG......',
  '.......rRG......',
  '......rR........',
  '.....jj.........',
  '................',
  '................',
  '................',
  '................',
  '................',
], SW);

function outlined(g: PixelGrid): PixelGrid {
  return g.clone().outline(1);
}

/** Outlined NE-pointing blade in pal.c.sword indices (the item icon recolours it). */
export function swordBladeNE(): PixelGrid {
  return outlined(BLADE_NE);
}

export function buildSwordBlade(): SpriteDef {
  const e = outlined(BLADE_E);
  const n = outlined(BLADE_N);
  const ne = outlined(BLADE_NE);
  const nw = ne.flipX();
  return new SpriteBuilder('fx.sword', PAL.sword)
    .anim('n', [n]).anim('ne', [ne]).anim('e', [e]).anim('se', [ne.flipY()])
    .anim('s', [n.flipY()]).anim('sw', [nw.flipY()]).anim('w', [e.flipX()]).anim('nw', [nw])
    .build();
}

// ============================================================================
// Projectiles (pal.c.proj)
// ============================================================================

/** pal.c.proj layout. */
const PJ = { o: 1, W: 2, s: 3, m: 4, d: 5, w: 6, b: 7, B: 8, r: 9, y: 10, f: 11, R: 12, i: 13, I: 14, c: 15 } as const satisfies Legend;

const ARROW_R = pix([
  'r.r......s...',
  '.rr......sm..',
  'rbbbbbbbbsmmd',
  '.rr......md..',
  'r.r......d...',
], PJ);

const SPEAR_R = pix([
  '.........ms...',
  'wwwwwwwwBmsss.',
  'bbbbbbbbBmmmmd',
  '.........md...',
], PJ);

/** Horizontal (pointing right) shape -> {right, up, down} frames, outlined. */
function dirFrames(shape: PixelGrid): { right: PixelGrid; up: PixelGrid; down: PixelGrid } {
  const right = centred(shape).outline(1);
  const up = right.rotateCW().flipX().flipY();
  return { right, up, down: up.flipY() };
}

function buildArrowLike(id: 'proj.arrow' | 'proj.spear', shape: PixelGrid): SpriteDef {
  const f = dirFrames(shape);
  return new SpriteBuilder(id, PAL.proj).anim('up', [f.up]).anim('down', [f.down]).anim('right', [f.right]).build();
}

export function buildArrow(): SpriteDef {
  return buildArrowLike('proj.arrow', ARROW_R);
}

export function buildSpear(): SpriteDef {
  return buildArrowLike('proj.spear', SPEAR_R);
}

/** Tumbling rock: the light stays top-left while the lumpy outline and a surface pit turn. */
const ROCK = [
  pix(['.ssm..', 'sWsmmd', 'ssmdmd', 'mmmmdd', 'mmmddd', '.dddd.'], PJ),
  pix(['..ssm.', '.sWsmd', 'ssmmmd', 'smmmdd', 'mmdmdd', '.ddd..'], PJ),
];

export function buildRock(): SpriteDef {
  return new SpriteBuilder('proj.rock', PAL.proj).anim('fly', ROCK.map((g) => centred(g).outline(1))).build();
}

const FIREBALL = [
  pix([
    '..RfR...',
    '.RfyfR..',
    'RfyWyfR.',
    'fyWWWyfR',
    'RfyWyyfR',
    '.RfyyfR.',
    '..RffR..',
    '...RR...',
  ], PJ),
  pix([
    '...RfR..',
    '..RfyfR.',
    '.RfyWyfR',
    'RfyWWWyf',
    'RfyyWyfR',
    '.RfyyfR.',
    '..RffR..',
    '..RR....',
  ], PJ),
];

export function buildFireball(): SpriteDef {
  return new SpriteBuilder('proj.fireball', PAL.proj).anim('fly', FIREBALL.map((g) => centred(g).outline(1))).build();
}

const BEAM = [
  pix([
    '...c...',
    '..cWc..',
    '.cWWWc.',
    'cWWWWWc',
    '.cWWWc.',
    '..cWc..',
    '...c...',
  ], PJ),
  pix([
    'c..c..c',
    '.c.W.c.',
    '..WWW..',
    'cWWWWWc',
    '..WWW..',
    '.c.W.c.',
    'c..c..c',
  ], PJ),
];

export function buildBeam(): SpriteDef {
  return new SpriteBuilder('proj.beam', PAL.proj).anim('fly', BEAM.map((g) => centred(g).outline(1))).build();
}

const BONE_H = pix([
  'ii........ii',
  'iWiiiiiiiiiI',
  'iiIIIIIIIIiI',
  'II........II',
], PJ);

const BONE_D = pix([
  '.......ii.',
  '.......iWi',
  '......iiII',
  '.....iiI..',
  '....iiI...',
  '...iiI....',
  '..iiI.....',
  'iiiI......',
  'iWI.......',
  '.II.......',
], PJ);

export function buildBone(): SpriteDef {
  const h = centred(BONE_H).outline(1);
  const d = centred(BONE_D).outline(1);
  return new SpriteBuilder('proj.bone', PAL.proj).anim('spin', [h, d, h.rotateCW(), d.flipX()]).build();
}

const HOOK_R = pix([
  '........sms.',
  '.......md...',
  '.mm.ddmmmss.',
  'mddmmmmmWmms',
  '.mm.ddmmmdd.',
  '.......md...',
  '........dmd.',
], PJ);

const CHAIN = pix(['.ms.', 'm..s', 'd..m', '.dd.'], PJ);

export function buildHookshot(): SpriteDef {
  const f = dirFrames(HOOK_R);
  return new SpriteBuilder('proj.hookshot', PAL.proj)
    .anim('head_up', [f.up]).anim('head_down', [f.down]).anim('head_right', [f.right])
    .anim('chain', [centred(CHAIN).outline(1)])
    .build();
}

// ============================================================================
// Boomerang (own palette so pal.boomerang.2 can swap it)
// ============================================================================

/** pal.c.boomerang layout. */
const BM = { l: 2, m: 3, d: 4, t: 5, T: 6, W: 7 } as const satisfies Legend;

const BOOMERANG = pix([
  'tT........',
  'TltT......',
  '.Wllmd....',
  '..lmmmd...',
  '...lmmd...',
  '...lmmd...',
  '..lmmmd...',
  '.lllmd....',
  'tlmd......',
  'TT........',
], BM);

/** Un-outlined boomerang shape in pal.c.boomerang indices (the item icon recolours it). */
export function boomerangShape(): PixelGrid {
  return BOOMERANG.clone();
}

export function buildBoomerang(): SpriteDef {
  const a = centred(BOOMERANG, 16, 16, 1, 0).outline(1);
  const b = a.rotateCW();
  return new SpriteBuilder('proj.boomerang', PAL.boomerang).anim('spin', [a, b, b.rotateCW(), b.rotateCW().rotateCW()]).build();
}
