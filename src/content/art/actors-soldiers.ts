// Castle troops: the helmeted sword soldier (green / blue / red) and the
// archer (olive green / blue) in a round cowl with a face wrap, so it can't be
// mistaken for the hero. Shared legend: A = armour / tunic (the swap colour),
// B = leather & brass, C = steel, D = skin, r = crest / fletching.
import {
  art, actorPalette, swapPalette, stack, FrameBank, RAMP_A, RAMP_B, RAMP_C, type ActorColors, type ArtSet,
} from './actors-kit';
import type { PixelGrid } from './pixelgrid';
import { addWalk, figureFrame, overlay, type Facing, type Figure } from './actors-humanoid';

const W = 16;

// ---------------------------------------------------------------- palettes

const SOLDIER_GREEN: ActorColors = {
  outline: '#102818',
  a: ['#206830', '#38a040', '#80d058'],
  b: ['#683818', '#b07028', '#f0c048'],
  c: ['#586078', '#98a0b8', '#e0e8f0'],
  d: ['#a05830', '#e09868', '#f8d0a0'],
  white: '#f8f8f8',
  glow: '#e03028',
};
const BLUE_ARMOUR: Partial<ActorColors> = {
  outline: '#101838',
  a: ['#203088', '#3868d0', '#80b8f8'],
  glow: '#f8f8f8',
};
const RED_ARMOUR: Partial<ActorColors> = {
  outline: '#300c10',
  a: ['#881820', '#d03830', '#f88860'],
  glow: '#f8d038',
};

const ARCHER_GREEN: ActorColors = {
  ...SOLDIER_GREEN,
  outline: '#181c08',
  a: ['#343c18', '#5c6628', '#909a48'],
  glow: '#f04030',
};

// ---------------------------------------------------------------- soldier

const HELMET_FRONT = [
  '........|........',
  '.......r|r.......',
  '......rr|rr......',
  '....aAAr|raaa....',
  '...aAAAA|aaaax...',
  '..aAAAAA|aaaaax..',
  '..aAAAAa|aaaaxx..',
  '.zCCCCCC|ccccccz.',
  '..xakkkk|kkkkax..',
];

const SOLDIER_DOWN = art(W, [
  ...HELMET_FRONT,
  '..aaSS#S|S#Ssax..',
  '..xaSSSk|kSssax..',
  '...xa#ss|ss#ax...',
  '..aAAAAa|aaaaax..',
  '.cc#AAAA|aaax#cz.',
  '.Cc#aAAa|aaxx#cz.',
  '.bb#yyyB|byyy#by.',
  '.bb.xaaa|aaax.by.',
  '....xaxa|axax....',
]);

const SOLDIER_UP = art(W, [
  '........|........',
  '.......r|r.......',
  '......rr|rr......',
  '....aAAr|raaa....',
  '...aAAAr|raaax...',
  '..aAAAAr|raaaax..',
  '..aAAAar|raaaxx..',
  '.zCCCCCC|ccccccz.',
  '..xaAAAa|aaaaax..',
  '..aAAAaa|aaaaxx..',
  '..xaaaaa|aaaaxx..',
  '...xxaaa|aaxxx...',
  '..aAAAAa|aaaaax..',
  '.cc#AAAx|aaax#cz.',
  '.Cc#aAax|aaxx#cz.',
  '.bb#yyyy|yyyy#bb.',
  '.bb.xaaa|aaax.bb.',
  '....xaxa|axax....',
]);

const HELMET_SIDE = [
  '........|........',
  '......rr|r.......',
  '.....rrr|rr......',
  '....aAAr|raa.....',
  '...aAAAA|Aaaa....',
  '..aAAAAA|Aaaax...',
  '..aAAAAA|aaaax...',
  '.zcCCCCC|Ccccczz.',
  '..xaaaak|kkkkk...',
  '..xaaaa#|SS#SS...',
  '..xxaaa#|SSSSSs..',
  '...xxa#s|ssks....',
];

const SOLDIER_RIGHT = art(W, [
  ...HELMET_SIDE,
  '...aAAAA|Aaax....',
  '...xa#cC|c#aax...',
  '...xa#cC|c#axx...',
  '...yy#cc|bbbyy...',
  '....xaa#|bbaax...',
  '....xaxa|axax....',
]);

/** Two-handed downward thrust. */
const SOLDIER_ATTACK_DOWN = art(W, [
  ...HELMET_FRONT,
  '..aaS##S|S##sax..',
  '..xaSSkk|kkssax..',
  '...xa#ss|ss#ax...',
  '..aAAAAa|aaaaax..',
  '.cc#AAAA|aaax#cz.',
  '..cc#AAa|aax#cz..',
  '...cbBBb|bbbyc...',
  '....yBBb|bby.....',
  '....xaxC|Cxax....',
  '.......C|c.......',
  '.......C|c.......',
  '.......C|c.......',
  '.......C|c.......',
  '.......c|c.......',
]);

/** Right arm thrust straight up. */
const SOLDIER_ATTACK_UP = art(W, [
  '........|......C.',
  '.......r|r.....C.',
  '......rr|rr....C.',
  '....aAAr|raaa..C.',
  '...aAAAr|raaax.c.',
  '..aAAAAr|raaaxyBy',
  '..aAAAar|raaaxxb.',
  '.zCCCCCC|cccccbb.',
  '..xaAAAa|aaaaxcc.',
  '..aAAAaa|aaaaxcc.',
  '..xaaaaa|aaaaxc..',
  '...xxaaa|aaxxcc..',
  '..aAAAAa|aaaaxc..',
  '.cc#AAAx|aaaax...',
  '.Cc#aAax|aaaxx...',
  '.bb#yyyy|yyyyy...',
  '.bb.xaaa|aaax....',
  '....xaxa|axax....',
]);

/** An art row drawn 1px further back (left), for lunging poses. */
const leanBack = (row: string): string => `${row.replaceAll('|', '').slice(1)}.`;

/** Lunge: body drawn back 1px, sword arm thrust out level with a 5px blade. */
const SOLDIER_ATTACK_RIGHT = art(W, [
  ...HELMET_SIDE.slice(0, 11).map(leanBack),
  '..xxa#s#|#ks.....',
  '..aAAAAA|axB.....',
  '..xacCCc|bBBCCCCw',
  '..xaaaax|byy.....',
  '..yyyyyy|yy......',
  '...xaaaa|ax......',
  '...xaxax|ax......',
]);

/** Soldier's sword in the resting grip, per facing (drawn in front of the hand). */
const SOLDIER_SWORD: Record<Facing, PixelGrid> = {
  down: overlay([
    '.bBb....|........',
    '..C.....|........',
    '..C.....|........',
    '..C.....|........',
    '..c.....|........',
  ], 17),
  up: overlay([
    '........|....bBb.',
    '........|.....C..',
    '........|.....C..',
    '........|.....C..',
    '........|.....c..',
  ], 17),
  right: overlay([
    '........|...B....',
    '........|...bCC..',
    '........|...y.CC.',
    '........|......Cc',
  ], 14),
};

function soldierSprite(): FrameBank {
  const fig: Figure = {
    body: { down: SOLDIER_DOWN, up: SOLDIER_UP, right: SOLDIER_RIGHT },
    legs: { hip: 18, pants: RAMP_C, boots: RAMP_B },
    over: SOLDIER_SWORD,
    arms: { down: [[13, 14, 13, 17]], up: [[1, 2, 13, 17]] },
  };
  const bank = new FrameBank();
  addWalk(bank, fig);
  bank.add('attack_down', figureFrame(fig, 'down', 1, { body: SOLDIER_ATTACK_DOWN, over: null }));
  bank.add('attack_up', figureFrame(fig, 'up', 2, { body: SOLDIER_ATTACK_UP, over: null }));
  bank.add('attack_right', figureFrame(fig, 'right', 1, { body: SOLDIER_ATTACK_RIGHT, over: null }));
  return bank;
}

// ---------------------------------------------------------------- archer

const ARCHER_DOWN = art(W, [
  '........|........',
  '........|........',
  '........|........',
  '.....aAA|aaa.....',
  '....aAAA|Aaax....',
  '...aAAAA|aaaax...',
  '...aAkSS|SSkax...',
  '...aAS#S|S#sax...',
  '...aAAAA|Aaaax...',
  '...xaxaa|aaxax...',
  '...xaaxx|xxaax...',
  '..xaAAaa|aaaaax..',
  '.aAAAaaa|aaaaaxx.',
  '.ss#AAaa|aaax#sk.',
  '.Ss#aaaa|aaax#sk.',
  '.yb#yyyB|byyy#by.',
  '.Ss.aaaa|aaax.sk.',
  '...xaaaa|aaaax...',
  '...xaxaa|xaaxx...',
]);

const ARCHER_UP = art(W, [
  '........|........',
  '........|........',
  '........|........',
  '.....aAA|aaa.....',
  '....aAAA|Aaax....',
  '...aAAAA|aaaax...',
  '...aAAAa|aaaax...',
  '...aAAaa|aaaax...',
  '...aAaaa|aaaax...',
  '...xaaaa|aaaxx...',
  '...xxaaa|aaxxx...',
  '..xaAAaa|aaaaax..',
  '.aAAAaaa|aaaaaxx.',
  '.ss#AAaa|aaax#sk.',
  '.Ss#aaaa|aaax#sk.',
  '.yb#yyyy|yyyy#by.',
  '.Ss.aaaa|aaax.sk.',
  '...xaaaa|aaaax...',
  '...xaxaa|xaaxx...',
]);

const ARCHER_RIGHT = art(W, [
  '........|........',
  '........|........',
  '........|........',
  '.....aAA|aa......',
  '....aAAA|Aaaa....',
  '...aAAAA|Aaaax...',
  '..aaAAAa|kkkka...',
  '.xaaAAa#|SS#Ss...',
  '.xaaAaa#|AAAAax..',
  '..xaaaa#|aaxxx...',
  '...xaaaa|#xx.....',
  '...aAAAa|aaax....',
  '...aAAAA|Aaaax...',
  '...xa#sS|s#aax...',
  '...xa#sS|s#axx...',
  '...yy#bb|byyyy...',
  '....xaa#|SSsax...',
  '...xaaaa|aaaax...',
  '...xaxaa|xaaxx...',
]);

/** Quiver strapped to the back (visible from behind). */
const ARCHER_QUIVER_UP = overlay([
  '........|..rw....',
  '........|.rwrw...',
  '........|.yby....',
  '........|.bby....',
  '........|byy.....',
  '........|bby.....',
  '.......b|by......',
  '.......b|y.......',
], 7);

/** Bow carried at the side per facing (down view includes the gripping hand). */
const ARCHER_BOW: Record<Facing, PixelGrid> = {
  down: overlay([
    '...B....|........',
    '..bw....|........',
    '..bw....|........',
    '.b.w....|........',
    '.b.w....|........',
    '.b.w....|........',
    '.Ssw....|........',
    '.b.w....|........',
    '..bw....|........',
    '..bw....|........',
    '...y....|........',
  ], 10),
  up: overlay([
    '........|.....B..',
    '........|.....wb.',
    '........|.....wb.',
    '........|.....w.b',
    '........|.....w.b',
    '........|.....w.b',
    '........|.....w.b',
    '........|.....w.b',
    '........|.....wb.',
    '........|.....wb.',
    '........|.....y..',
  ], 10),
  right: overlay([
    '........|...B....',
    '........|...wb...',
    '........|...w.b..',
    '........|...w.b..',
    '........|...w.b..',
    '........|...w.b..',
    '........|...w.b..',
    '........|...w.b..',
    '........|...wb...',
    '........|...y....',
  ], 10),
};

/** Bow drawn, arrow pointing down (toward the viewer). */
const ARCHER_SHOOT_DOWN = overlay([
  '.......C|........',
  '.......c|........',
  '..yBBBbc|bbbby...',
  '.b.wwwwc|wwww.b..',
  '.b....wc|w....b..',
  '.......c|........',
  '.......c|........',
  '.......C|........',
  '......Cw|C.......',
  '.......C|........',
], 13);

/** Bow raised overhead, arrow pointing up. */
const ARCHER_SHOOT_UP = overlay([
  '.......C|........',
  '......Cw|C.......',
  '.......C|........',
  '..b....c|.....b..',
  '..b.www.|www..b..',
  '...ybBBc|Bbby....',
  '.......c|........',
  '.......c|........',
], 0);

/** Bow held out front, arrow level. */
const ARCHER_SHOOT_RIGHT = overlay([
  '........|.....B..',
  '........|....wb..',
  '........|...w..b.',
  '........|..w...b.',
  '.......s|sw....b.',
  '......Ss|zccccCwC',
  '........|..w...b.',
  '........|...w..b.',
  '........|....wb..',
  '........|.....y..',
], 8);

function archerSprite(): FrameBank {
  const fig: Figure = {
    body: { down: ARCHER_DOWN, up: ARCHER_UP, right: ARCHER_RIGHT },
    legs: { hip: 19, pants: RAMP_A, boots: RAMP_B },
    over: { down: ARCHER_BOW.down, up: stack(ARCHER_QUIVER_UP, ARCHER_BOW.up), right: ARCHER_BOW.right },
    arms: { down: [[13, 14, 13, 17]], up: [[1, 2, 13, 17]] },
  };
  const bank = new FrameBank();
  addWalk(bank, fig);
  bank.add('shoot_down', figureFrame(fig, 'down', 0, { over: ARCHER_SHOOT_DOWN }));
  bank.add('shoot_up', figureFrame(fig, 'up', 0, { over: stack(ARCHER_QUIVER_UP, ARCHER_SHOOT_UP) }));
  bank.add('shoot_right', figureFrame(fig, 'right', 1, { over: ARCHER_SHOOT_RIGHT }));
  return bank;
}

// ---------------------------------------------------------------- export

/** Soldier + archer sprites and their colour swaps. */
export function buildSoldierArt(): ArtSet {
  return {
    palettes: [
      actorPalette('pal.a.soldier', 'Soldier (green)', SOLDIER_GREEN),
      swapPalette('pal.soldier.blue', 'Soldier (blue)', SOLDIER_GREEN, BLUE_ARMOUR),
      swapPalette('pal.soldier.red', 'Soldier (red)', SOLDIER_GREEN, RED_ARMOUR),
      actorPalette('pal.a.archer', 'Archer (green)', ARCHER_GREEN),
      swapPalette('pal.archer.blue', 'Archer (blue)', ARCHER_GREEN, { ...BLUE_ARMOUR, glow: '#f8d038' }),
    ],
    sprites: [
      soldierSprite().build('enemy.soldier', 'pal.a.soldier'),
      archerSprite().build('enemy.archer', 'pal.a.archer'),
    ],
  };
}
