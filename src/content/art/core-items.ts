// Floor pickups ('pickup'), inventory / item-get icons ('item') and the placed
// bomb (obj.bomb). All share pal.c.items so a pickup and its icon always match.
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { centred, pix, recolor, SpriteBuilder, type Legend } from './core-draw';
import { PAL } from './core-palettes';
import { boomerangShape, swordBladeNE } from './core-weapons';

/** pal.c.items layout. */
const IT = {
  o: 1, W: 2, G: 3, g: 4, h: 5, B: 6, b: 7, v: 8, R: 9, r: 10, p: 11, Y: 12, y: 13, n: 14, s: 15,
} as const satisfies Legend;
const O = 1;

/** Centre on a 16x16 frame and outline. */
function icon(g: PixelGrid, dx = 0, dy = 0): PixelGrid {
  return centred(g, 16, 16, dx, dy).outline(O);
}

// ============================================================================
// Gems (the currency, internal id `rupees`; 3-frame glint)
// ============================================================================

const RUPEE = pix([
  '...g...',
  '..hgG..',
  '.hhgGG.',
  'hhhgGGG',
  'hhggGGG',
  'hhggGGG',
  'hhggGGG',
  'hhggGGG',
  '.hhgGG.',
  '..hgG..',
  '...G...',
], IT);

const GLINTS: readonly [number, number][][] = [
  [],
  [[1, 3], [1, 4], [2, 2]],
  [[3, 1], [2, 4], [2, 5], [3, 6]],
];

/** Gem frames in one colour ramp (light, mid, dark). */
function rupeeFrames(light: number, mid: number, dark: number): PixelGrid[] {
  const base = recolor(RUPEE, { [IT.h]: light, [IT.g]: mid, [IT.G]: dark });
  return GLINTS.map((pts) => {
    const g = base.clone();
    for (const [x, y] of pts) g.set(x, y, IT.W);
    return icon(g);
  });
}

// ============================================================================
// Hearts
// ============================================================================

const HEART = pix([
  '.rr.rr.',
  'rWprrrR',
  'rprrrrR',
  '.rrrrR.',
  '..rRR..',
  '...R...',
], IT);

const HEART_BIG = pix([
  '..rrr...rrr..',
  '.rppWr.rrrrR.',
  'rppWrrrrrrrrR',
  'rpprrrrrrrrrR',
  'rprrrrrrrrrRR',
  'rrrrrrrrrrrRR',
  '.rrrrrrrrrRR.',
  '..rrrrrrrRR..',
  '...rrrrRRR...',
  '....rrRRR....',
  '.....rRR.....',
  '......R......',
], IT);

/** Heart piece: one red quarter, the other three greyed out and split by seams. */
const HEART_PIECE = pix([
  '..rrr...sss..',
  '.rppWr.sWsss.',
  'rppWrrossssss',
  'rpprrrossssss',
  'rprrrRossssss',
  'rrrrRRossssss',
  '.oooooooooos.',
  '..sssssosss..',
  '...sssosss...',
  '....ssoss....',
  '.....sos.....',
  '......s......',
], IT);

// ============================================================================
// Keys
// ============================================================================

const SMALL_KEY = pix([
  '.yyy.',
  'yY.Yy',
  'yY.YY',
  '.yYY.',
  '..yY.',
  '..yY.',
  '..yYY',
  '..yY.',
  '..yYY',
  '..YY.',
], IT);

const BIG_KEY = pix([
  '..yyyyY..',
  '.yyYYYyY.',
  'yyYrrRYyY',
  'yYrpRRRYY',
  'yYrRRRRYY',
  '.yYRRRYY.',
  '..yYYYY..',
  '...yyY...',
  '...yyY...',
  '...yyYYY.',
  '...yyYyY.',
  '...yyY...',
  '...yyYYY.',
  '...YYY...',
], IT);

// ============================================================================
// Ammo, jars, fairy, crystal
// ============================================================================

/** Round bomb body with fuse; `flash` swaps the blue ramp for red. */
function bomb(r: number, spark: 0 | 1 | 2, flash = false): PixelGrid {
  const size = 16;
  const g = new PixelGrid(size, size);
  const cx = 7.5;
  const cy = 10;
  const [dk, md, lt] = flash ? [IT.R, IT.r, IT.p] : [IT.B, IT.b, IT.v];
  g.circle(cx, cy, r, dk);
  g.circle(cx - 0.6, cy - 0.6, r - 1.1, md);
  g.circle(cx - r * 0.45, cy - r * 0.45, r * 0.3, lt);
  g.set(Math.round(cx - r * 0.55), Math.round(cy - r * 0.6), IT.W);
  const top = Math.round(cy - r);
  g.fill(7, top - 1, 2, 1, IT.s);
  g.set(9, top - 2, IT.n).set(10, top - 3, IT.n);
  if (spark === 1) g.set(11, top - 4, IT.y).set(10, top - 4, IT.W);
  if (spark === 2) {
    g.set(11, top - 4, IT.W).set(12, top - 4, IT.y).set(11, top - 5, IT.y).set(10, top - 4, IT.y).set(11, top - 3, IT.y);
  }
  return g.outline(O);
}

const ARROWS = pix([
  'Ws.......sW',
  'sWs.....sWs',
  '.sn.....ns.',
  '...n...n...',
  '....n.n....',
  '.....n.....',
  '....n.n....',
  '...n...n...',
  '..n.....n..',
  'rrn.....nrr',
  '.rr.....rr.',
  'r.r.....r.r',
], IT);

const JAR_SMALL = pix([
  '.nnn.',
  '..gG.',
  '.ghgG',
  'ghWgG',
  'ghggG',
  'gggGG',
  '.GGG.',
], IT);

const JAR_LARGE = pix([
  '..nnnn..',
  '..nYYn..',
  '...gG...',
  '..ghgG..',
  '.ghhggG.',
  'ghWhgggG',
  'ghWggggG',
  'ghhggggG',
  'gggggGGG',
  '.gggGGG.',
  '..GGGG..',
], IT);

const FAIRY = [
  pix([
    'Wv.....vW',
    'vWv...vWv',
    '.vvWpWvv.',
    '..vpppv..',
    '...pWp...',
    '..vpppv..',
    '.vv.p.vv.',
    '....W....',
  ], IT),
  pix([
    '.........',
    '....W....',
    '...WpW...',
    '.vvpppvv.',
    'vWvpWpvWv',
    'vvvpppvvv',
    '.vv.p.vv.',
    '....W....',
  ], IT),
];

/** Crystal half-widths per row at full width: a short upper pyramid over a long lower point. */
const CRYSTAL_PROFILE = [0.5, 1.5, 2.5, 3.5, 4.5, 4.5, 3.8, 3.2, 2.6, 2, 1.5, 1, 0.5];
const CRYSTAL_GIRDLE = 5;

/**
 * One frame of the spinning prism crystal (an octahedron with a pink heart). `width` scales the
 * silhouette as it turns; `ridge` is the front edge position in -1..1 (null = a face turned square on).
 */
function crystalFrame(width: number, ridge: number | null): PixelGrid {
  const g = new PixelGrid(9, 13);
  const cx = 4.5;
  CRYSTAL_PROFILE.forEach((full, y) => {
    const hw = Math.max(0.5, full * width);
    const top = y < CRYSTAL_GIRDLE;
    for (let x = 0; x < 9; x++) {
      const u = x + 0.5 - cx;
      if (Math.abs(u) > hw) continue;
      let c: number;
      if (ridge === null) c = u < -hw + 1 ? IT.W : top ? IT.v : IT.s;
      else if (Math.abs(u - ridge * hw) < 0.5) c = IT.W;
      else if (u < ridge * hw) c = top ? IT.W : IT.v;
      else c = top ? IT.v : IT.s;
      g.set(x, y, c);
    }
  });
  // The heart glows through every face.
  g.set(4, 5, IT.p).set(3, 6, IT.p).set(4, 6, IT.r).set(5, 6, IT.p).set(4, 7, IT.p);
  return g;
}

/** Four spin steps: the front ridge sweeps left to right while the silhouette narrows and widens. */
function crystalFrames(): PixelGrid[] {
  return [crystalFrame(1, 0), crystalFrame(0.9, 0.45), crystalFrame(0.72, null), crystalFrame(0.9, -0.45)].map((g) => icon(g));
}

// ============================================================================
// Equipment icons
// ============================================================================

/** Sword icon = the in-game NE blade recoloured into the item palette. */
function swordIcon(level: 1 | 2): PixelGrid {
  const blade = level === 1 ? { 2: IT.s, 3: IT.W, 4: IT.W } : { 2: IT.b, 3: IT.v, 4: IT.W };
  const g = recolor(swordBladeNE(), { 1: O, ...blade, 5: IT.Y, 6: IT.y, 7: IT.n, 8: IT.n, 9: IT.r });
  return new PixelGrid(16, 16).blit(g, -1, 2);
}

function boomerangIcon(level: 1 | 2): PixelGrid {
  const map = level === 1
    ? { 2: IT.y, 3: IT.Y, 4: IT.n, 5: IT.p, 6: IT.r, 7: IT.W }
    : { 2: IT.v, 3: IT.b, 4: IT.B, 5: IT.p, 6: IT.r, 7: IT.W };
  return icon(recolor(boomerangShape(), map), 1);
}

function shieldIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.circle(7.5, 7.5, 6.5, IT.n);
  g.circle(7.5, 7.5, 5.2, IT.Y);
  g.circle(6.5, 6.5, 3.2, IT.y);
  g.circle(7.5, 7.5, 3.2, IT.Y);
  // Leaf emblem (the same gold sprout the hero carries).
  g.blit(pix(['...yy', '..yWy', '.yyyn', '.yyn.', 'n.n..'], IT), 5, 5);
  g.set(4, 3, IT.W).set(3, 4, IT.W).set(5, 3, IT.W);
  return g.outline(O);
}

const BOW = pix([
  '.Yy......',
  '.Wnn.....',
  '.W.nn....',
  '.W..nn...',
  '.W...nn..',
  '.W....nn.',
  '.W....YY.',
  '.W....yY.',
  '.W....nn.',
  '.W...nn..',
  '.W..nn...',
  '.W.nn....',
  '.Wnn.....',
  '.Yy......',
], IT);

const HOOKSHOT = pix([
  '..........s...',
  '...........s..',
  '.ssssssss.sWs.',
  'sWWWWWWWsWWWWs',
  'sssssssssssWs.',
  '.rrR......s...',
  '.rrR.....s....',
  '.RR...........',
], IT);

const LANTERN = pix([
  '...nnnn...',
  '..n....n..',
  '..n....n..',
  '.YYyyyyYY.',
  '..YyyyyY..',
  '.YvvyyvvY.',
  '.YvyWWyvY.',
  '.YvyWWyvY.',
  '.YvvyyvvY.',
  '.YvvrrvvY.',
  '..YYYYYY..',
  '.YYyyyyYY.',
  '..nnnnnn..',
], IT);

const BOOTS = pix([
  '...nnnn.....',
  '...yyyy.....',
  'W..nYnn.....',
  'WW.nYnn.....',
  'WWWnYnn.....',
  '.WWnYnn.....',
  '...nYnnn....',
  '...nYYnnnn..',
  '..nnYYYYnnn.',
  '..nnnnnnnnnn',
  '..oooooooooo',
], IT);

const GLOVE = pix([
  '..n.n.n....',
  '.nYnYnYn...',
  '.nYnYnYn.n.',
  '.nYnYnYnnYn',
  '.nYYYYYnYYn',
  '.nYYYYYYYn.',
  '.nYYYYYYn..',
  '.nnYYYYYn..',
  '..nnnnnn...',
  '.yyyyyyyy..',
  '.yYYyYYYy..',
  '.yyyyyyyy..',
], IT);

const FLIPPER = pix([
  '.BBB.',
  'B.b.B',
  '.bvb.',
  '.bvb.',
  'bbvbb',
  'bvbvb',
  'bvbvb',
  'vbvbv',
  'vbvbv',
  'v.v.v',
], IT);

const MAP = pix([
  'yyyyyyyyyyY.',
  'yWyyynyyyyyY',
  'yyyynyyyyyyY',
  'yyynyyyrryyY',
  'yynyyyyrryyY',
  'yyynnyyyyyyY',
  'yyyyynyggyyY',
  'yggyyyngggyY',
  'ygggyyynyyyY',
  'YYYYYYYYYYYY',
], IT);

function compassIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.fill(7, 1, 2, 2, IT.Y);
  g.circle(7.5, 8.5, 6, IT.Y);
  g.circle(7, 8, 5.2, IT.y);
  g.circle(7.5, 8.5, 4.2, IT.W);
  g.fill(7, 5, 2, 3, IT.r);
  g.fill(7, 10, 2, 2, IT.b);
  g.fill(7, 8, 2, 2, IT.s);
  return g.outline(O);
}

function flippersIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.blit(FLIPPER, 2, 3).blit(FLIPPER, 8, 4);
  return g.outline(O);
}

// ============================================================================
// Sprites
// ============================================================================

export function buildPickups(): SpriteDef {
  const heart = icon(HEART);
  return new SpriteBuilder('pickup', PAL.items)
    .anim('rupee_green', rupeeFrames(IT.h, IT.g, IT.G))
    .anim('rupee_blue', rupeeFrames(IT.v, IT.b, IT.B))
    .anim('rupee_red', rupeeFrames(IT.p, IT.r, IT.R))
    .anim('heart', [heart])
    .anim('smallKey', [icon(SMALL_KEY)])
    .anim('bigKey', [icon(BIG_KEY)])
    .anim('bombs', [bomb(4, 1)])
    .anim('arrows', [icon(ARROWS)])
    .anim('magic_small', [icon(JAR_SMALL, 0, 1)])
    .anim('magic_large', [icon(JAR_LARGE)])
    .anim('heartContainer', [icon(HEART_BIG)])
    .anim('heartPiece', [icon(HEART_PIECE)])
    .anim('fairy', FAIRY.map((g) => icon(g)))
    .anim('crystal', crystalFrames())
    .build();
}

export function buildItemIcons(): SpriteDef {
  const icons: Record<string, PixelGrid> = {
    sword: swordIcon(1),
    sword2: swordIcon(2),
    shield: shieldIcon(),
    bow: icon(BOW),
    boomerang: boomerangIcon(1),
    boomerang2: boomerangIcon(2),
    hookshot: icon(HOOKSHOT),
    bombs: bomb(5, 1),
    lantern: icon(LANTERN),
    boots: icon(BOOTS),
    glove: icon(GLOVE),
    glove2: icon(recolor(GLOVE, { [IT.n]: IT.Y, [IT.Y]: IT.y, [IT.y]: IT.r })),
    flippers: flippersIcon(),
    arrows: icon(ARROWS),
    rupees: rupeeFrames(IT.h, IT.g, IT.G)[1]!,
    heart: icon(HEART),
    heartContainer: icon(HEART_BIG),
    heartPiece: icon(HEART_PIECE),
    magic: icon(JAR_LARGE),
    fairy: icon(FAIRY[0]!),
    smallKey: icon(SMALL_KEY),
    bigKey: icon(BIG_KEY),
    map: icon(MAP),
    compass: compassIcon(),
    crystal: crystalFrames()[0]!,
  };
  const b = new SpriteBuilder('item', PAL.items);
  for (const [name, g] of Object.entries(icons)) b.anim(name, [g]);
  return b.build();
}

export function buildBomb(): SpriteDef {
  return new SpriteBuilder('obj.bomb', PAL.items)
    .anim('idle', [bomb(5, 1)])
    .anim('fuse', [bomb(5, 2), bomb(5, 1, true)])
    .build();
}
