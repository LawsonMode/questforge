// One-shot effects (fx.*): poof, hit spark, splash, leaves, shatter, explosion,
// sparkle, dust and the looping flame. All share pal.c.fx.
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { centred, pix, SpriteBuilder, type Legend } from './core-draw';
import { PAL } from './core-palettes';

/** pal.c.fx layout. */
const FX = { o: 1, W: 2, p: 3, y: 4, f: 5, r: 6, k: 7, K: 8, D: 9, a: 10, A: 11, e: 12, E: 13, c: 14, C: 15 } as const satisfies Legend;
const O = 1;
const SMOKE_EDGE = FX.D;

/** Stamp several copies of `part` centred on the given points. */
function stamp(size: number, part: PixelGrid, points: readonly [number, number][]): PixelGrid {
  const g = new PixelGrid(size, size);
  for (const [x, y] of points) g.blit(part, Math.round(x - part.w / 2), Math.round(y - part.h / 2));
  return g;
}

/** Points on a ring of radius r around (c, c), starting at angle a0 (radians). */
function ring(c: number, r: number, n: number, a0 = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r] as [number, number];
  });
}

// ============================================================================
// Smoke: poof & dust
// ============================================================================

const PUFF3 = pix(['.k.', 'kWk', '.K.'], FX);
const PUFF5 = pix([
  '.kkk.',
  'kWWkK',
  'kWkkK',
  'kkkKK',
  '.KKK.',
], FX);
const PUFF7 = pix([
  '..kkk..',
  '.kWWkk.',
  'kWWkkkK',
  'kWkkkkK',
  'kkkkkKK',
  '.kkKKK.',
  '..KKK..',
], FX);
/** Fading puff: small, broken-up wisps. */
const PUFF_FADE = pix(['.k..', 'kWk.', '..kK', '.kK.'], FX);

export function buildPoof(): SpriteDef {
  const frames = [
    stamp(16, PUFF7, [[8, 8]]),
    stamp(16, PUFF5, [...ring(8, 4, 4, Math.PI / 4), [8, 8]]),
    stamp(16, PUFF5, ring(8, 5, 4, Math.PI / 4)),
    stamp(16, PUFF_FADE, ring(8, 5.5, 4, Math.PI / 4)),
  ].map((g) => g.outline(SMOKE_EDGE));
  return new SpriteBuilder('fx.poof', PAL.fx).anim('play', frames).build();
}

export function buildDust(): SpriteDef {
  const frames = [
    stamp(16, PUFF3, [[6, 12], [10, 12]]),
    stamp(16, PUFF5, [[5, 10], [11, 11]]),
    stamp(16, PUFF_FADE, [[4, 8], [12, 9]]),
  ].map((g) => g.outline(SMOKE_EDGE));
  return new SpriteBuilder('fx.dust', PAL.fx).anim('play', frames).build();
}

// ============================================================================
// Hit spark & sparkle
// ============================================================================

const HIT = [
  pix([
    '...W...',
    '...p...',
    '..pyp..',
    'WpyWypW',
    '..pyp..',
    '...p...',
    '...W...',
  ], FX),
  pix([
    'W.......W',
    '.y..W..y.',
    '..p.p.p..',
    '...pyp...',
    'WppyWyppW',
    '...pyp...',
    '..p.p.p..',
    '.y..W..y.',
    'W.......W',
  ], FX),
  pix([
    'f.....W.....f',
    '.............',
    '..y.......y..',
    '......p......',
    '.............',
    '.............',
    'W..p.....p..W',
    '.............',
    '.............',
    '......p......',
    '..y.......y..',
    '.............',
    'f.....W.....f',
  ], FX),
];

export function buildHit(): SpriteDef {
  const frames = HIT.map((g, i) => (i < 2 ? centred(g).outline(FX.f) : centred(g)));
  return new SpriteBuilder('fx.hit', PAL.fx).anim('play', frames).build();
}

const SPARKLE = [
  pix(['.p.', 'pWp', '.p.'], FX),
  pix([
    '....W....',
    '....p....',
    '...pWp...',
    '..y.p.y..',
    'WpWpWpWpW',
    '..y.p.y..',
    '...pWp...',
    '....p....',
    '....W....',
  ], FX),
  pix([
    'p...p',
    '.pWp.',
    '.WWW.',
    '.pWp.',
    'p...p',
  ], FX),
];

export function buildSparkle(): SpriteDef {
  return new SpriteBuilder('fx.sparkle', PAL.fx).anim('play', SPARKLE.map((g) => centred(g))).build();
}

// ============================================================================
// Splash, leaves, shatter
// ============================================================================

const SPLASH = [
  pix([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......a..a......',
    '....a.Wa.aW.a...',
    '....AaWA.AWaA...',
    '...aAAaAAAaAAa..',
    '...AaWWaaWWaA...',
    '....AAAAAAAA....',
    '................',
    '................',
    '................',
    '................',
  ], FX),
  pix([
    '................',
    '....W......W....',
    '...a...aa...a...',
    '.....aW..Wa.....',
    '..a..aW..Wa..a..',
    '.....AaW.aA.....',
    '....aAaWWaAa....',
    '....AAaWaaAA....',
    '...AaAAaaAAaA...',
    '..aAaWaAAaWaAa..',
    '..AaWWAaaAWWaA..',
    '...AAAAAAAAAA...',
    '................',
    '................',
    '................',
    '................',
  ], FX),
  pix([
    '................',
    '................',
    '..a..........a..',
    '................',
    '....a......a....',
    '................',
    '.a............a.',
    '................',
    '....AAAAAAAA....',
    '..AAa......aAA..',
    '.Aa..........aA.',
    '.AW..........WA.',
    '..AAa......aAA..',
    '....AAAAAAAA....',
    '................',
    '................',
  ], FX),
];

export function buildSplash(): SpriteDef {
  return new SpriteBuilder('fx.splash', PAL.fx).anim('play', SPLASH.map((g) => g.clone().outline(O))).build();
}

const LEAF_A = pix(['ee.', 'eEE', '.EE'], FX);
const LEAF_B = pix(['.eE', 'eEE', 'eE.'], FX);
const LEAF_S = pix(['eE'], FX);

/** Leaves burst outward and flutter down; alternating leaf orientation reads as spinning. */
export function buildLeaves(): SpriteDef {
  const spots = (r: number, drop: number): [number, number][] =>
    ring(8, r, 6, 0.3).map(([x, y]) => [x, y + drop] as [number, number]);
  const frames = [
    stamp(16, LEAF_S, spots(2.5, 0)),
    stamp(16, LEAF_B, spots(4.5, 0)),
    stamp(16, LEAF_A, spots(6, 1)),
    stamp(16, LEAF_S, spots(6.5, 2.5)),
  ].map((g) => g.outline(O));
  return new SpriteBuilder('fx.leaves', PAL.fx).anim('play', frames).build();
}

const SHARD_A = pix(['cc', 'cC'], FX);
const SHARD_B = pix(['c.', 'cC', 'CC'], FX);
const SHARD_C = pix(['ccC', '.C.'], FX);

export function buildShatter(): SpriteDef {
  const shards = [SHARD_A, SHARD_B, SHARD_C];
  const frame = (r: number, drop: number, turn: number): PixelGrid => {
    const g = new PixelGrid(16, 16);
    ring(8, r, 6, 0.5).forEach(([x, y], i) => {
      const s = shards[(i + turn) % shards.length]!;
      // Pieces fly up and outward, then fall.
      g.blit(s, Math.round(x - s.w / 2), Math.round(y - s.h / 2 + drop * (i % 2 === 0 ? 1 : 0.6)));
    });
    return g.outline(O);
  };
  return new SpriteBuilder('fx.shatter', PAL.fx)
    .anim('play', [frame(2, 0, 0), frame(4, -1, 1), frame(5.5, 1, 2), frame(6.5, 3, 0)])
    .build();
}

// ============================================================================
// Explosion (32x32)
// ============================================================================

/** Concentric fire ball: red rim -> orange -> yellow -> white core. */
function fireBall(g: PixelGrid, cx: number, cy: number, r: number, core = true): void {
  g.circle(cx, cy, r, FX.r);
  if (r > 1.5) g.circle(cx - 0.4, cy - 0.4, r * 0.78, FX.f);
  if (r > 2.5) g.circle(cx - 0.8, cy - 0.8, r * 0.52, FX.y);
  if (core && r > 3.5) g.circle(cx - 1, cy - 1, r * 0.26, FX.W);
}

/** Smoke ball: dark rim, mid body, light top-left. */
function smokeBall(g: PixelGrid, cx: number, cy: number, r: number): void {
  g.circle(cx, cy, r, FX.D);
  g.circle(cx - 0.5, cy - 0.5, r * 0.8, FX.K);
  g.circle(cx - 1, cy - 1, r * 0.45, FX.k);
}

export function buildExplosion(): SpriteDef {
  const c = 16;
  const f0 = new PixelGrid(32, 32);
  fireBall(f0, c, c, 5);
  for (const [x, y] of ring(c, 8, 8)) f0.set(x, y, FX.y);

  const f1 = new PixelGrid(32, 32);
  fireBall(f1, c, c, 10);

  const f2 = new PixelGrid(32, 32);
  for (const [x, y] of ring(c, 7, 5, 0.4)) fireBall(f2, x, y, 7, false);
  fireBall(f2, c, c, 9);

  const f3 = new PixelGrid(32, 32);
  for (const [x, y] of ring(c, 9, 6, 0.9)) {
    smokeBall(f3, x, y, 5.5);
    fireBall(f3, x - 0.5, y - 0.5, 3, false);
  }
  fireBall(f3, c, c, 4, false);

  const f4 = new PixelGrid(32, 32);
  for (const [x, y] of ring(c, 11, 6, 1.4)) smokeBall(f4, x, y, 4);
  for (const [x, y] of ring(c, 4, 3, 0.2)) f4.blit(PUFF3, Math.round(x - 1), Math.round(y - 1));

  const frames = [f0, f1, f2, f3, f4].map((g) => g.outline(O));
  return new SpriteBuilder('fx.explosion', PAL.fx).anim('play', frames).build();
}

// ============================================================================
// Flame (loops; origin 8,12 = the flame's base)
// ============================================================================

const FLAME = [
  pix([
    '.....r....',
    '.....rr...',
    '....rfr...',
    '..r.rffr..',
    '..rrffyfr.',
    '..rffyyfr.',
    '.rffyWyfr.',
    '.rfyWWyffr',
    'rffyWWWyfr',
    'rfyyWWyyfr',
    '.rfyyyyfr.',
    '..rrffrr..',
  ], FX),
  pix([
    '....r.....',
    '...rr.....',
    '...rfr..r.',
    '..rffr..r.',
    '..rfyfrrr.',
    '.rffyyffr.',
    '.rfyyWyfr.',
    'rffyWWyfr.',
    'rfyWWWyffr',
    'rfyyWWyyfr',
    '.rfyyyyfr.',
    '..rrffrr..',
  ], FX),
  pix([
    '......r...',
    '.r...rr...',
    '.r..rffr..',
    '.rr.rfyr..',
    '..rrffyfr.',
    '..rfyyyfr.',
    '.rffyWyfr.',
    '.rfyWWyffr',
    'rffyWWWyfr',
    'rfyyWWyyfr',
    '.rfyyyyfr.',
    '..rrffrr..',
  ], FX),
];

export function buildFlame(): SpriteDef {
  return new SpriteBuilder('fx.flame', PAL.fx).anim('play', FLAME.map((g) => new PixelGrid(16, 16).blit(g, 3, 2))).build();
}
