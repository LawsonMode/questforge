// Giant worm boss (32x32, centred). The engine chains a head, several body
// segments and a tail; all three share the plum chitin + jade armour bands so
// the chain reads as one creature, while the tail is a hot, pulsing weak point.
// Legend: A = chitin, B = armour plates & mandibles, C = weak-point glow,
// D = maw, r = eyes.
import {
  actorPalette, bevel, FrameBank, GLOW, OUT, RAMP_A, RAMP_B, RAMP_C, RAMP_D, sphere, star, WHITE,
  type ActorColors, type ArtSet,
} from './actors-kit';
import { PixelGrid } from './pixelgrid';

const S = 32;
const C = 15.5;

const WORM: ActorColors = {
  outline: '#1c0824',
  a: ['#3c1850', '#702c88', '#b060c8'],
  b: ['#1c5848', '#2c9878', '#88e0b0'],
  c: ['#d03810', '#f88c20', '#ffe050'],
  d: ['#380810', '#781828', '#c04050'],
  white: '#ffffff',
  glow: '#f8f048',
};

/**
 * Paint armour bands over the chitin already in `g`: pixels whose distance
 * from (cx, cy) falls in one of `bands` and whose row is above `maxY`. Shaded
 * as part of a sphere centred at (sx, sy) so the plates share the body's light.
 */
function armourBands(
  g: PixelGrid, cx: number, cy: number, bands: readonly (readonly [number, number])[], maxY: number,
  sx: number, sy: number, r: number,
): void {
  const body = g.clone();
  const dist = (x: number, y: number): number => Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1);
  const inBand = (x: number, y: number): boolean => bands.some(([a, b]) => dist(x, y) >= a && dist(x, y) <= b);
  const lo = Math.min(...bands.map(([a]) => a));
  sphere(g, sx, sy, r, r, RAMP_B, { hi: WHITE, clip: (x, y) => y <= maxY && body.get(x, y) !== 0 && inBand(x, y) });
  // Shadowed seams between the plates.
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x < S; x++) {
      if (body.get(x, y) !== 0 && !inBand(x, y) && dist(x, y) > lo) g.set(x, y, RAMP_A[0]);
    }
  }
}

/** Quadratic Bezier point. */
function bez(p0: number, p1: number, p2: number, t: number): number {
  return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
}

/**
 * Sickle mandible from `root` bending through `ctrl` to `tip`, thick at the
 * root and tapering; returned as its own outlined layer so it reads in front
 * of the head.
 */
function mandible(root: readonly [number, number], ctrl: readonly [number, number], tip: readonly [number, number]): PixelGrid {
  const m = new PixelGrid(S, S);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = 1.9 - 1.4 * t;
    m.ellipse(bez(root[0], ctrl[0], tip[0], t), bez(root[1], ctrl[1], tip[1], t), r, r, RAMP_B[1]);
  }
  bevel(m, [RAMP_B]);
  m.set(Math.round(tip[0]), Math.round(tip[1]), RAMP_D[0]);
  return m.outline(OUT);
}

function wormHead(open: boolean): PixelGrid {
  const g = new PixelGrid(S, S);
  sphere(g, C, 14, 13.2, 12.6, RAMP_A, { hi: WHITE });
  // Crown plate and a second band, ridged, with spikes along the crest.
  armourBands(g, C, 26, [[12.6, 15.2], [16.2, 19.4], [20.4, 30]], 13, C, 10, 14);
  for (const [x, y] of [[7, 4], [11, 1], [20, 1], [24, 4]] as const) g.set(x, y, RAMP_B[2]).set(x, y + 1, RAMP_B[1]);
  // Four eyes under a dark brow: two big angry slits and two small ones.
  for (const [x, flip] of [[7, false], [21, true]] as const) {
    g.fill(x - 1, 14, 6, 1, RAMP_A[0]);
    g.fill(x, 15, 4, 2, GLOW);
    g.set(flip ? x : x + 3, 15, OUT).set(flip ? x + 3 : x, 16, RAMP_C[0]).set(flip ? x + 2 : x + 1, 15, WHITE);
  }
  g.fill(12, 15, 2, 1, GLOW).fill(18, 15, 2, 1, GLOW);
  // Fanged maw.
  const mh = open ? 4 : 2.6;
  sphere(g, C, 22, open ? 6 : 5, mh, [RAMP_D[0], RAMP_D[1], RAMP_D[2]]);
  const top = Math.round(22 - mh);
  for (let x = 10; x <= 21; x++) {
    if (g.get(x, top + 1) === 0) continue;
    if (x % 2 === 0) g.set(x, top + 1, WHITE);
    if (open && x % 2 === 1 && RAMP_D.includes(g.get(x, top + 6))) g.set(x, top + 6, WHITE);
  }
  if (open) g.set(12, top + 2, WHITE).set(19, top + 2, WHITE);
  const out = g.outline(OUT);
  // Sickle mandibles framing the maw (tips apart when open, crossing when shut).
  const tip: readonly [number, number] = open ? [9.5, 30] : [14, 29];
  const ctrl: readonly [number, number] = open ? [1, 27] : [3, 29];
  const left = mandible([6, 19], ctrl, tip);
  out.blit(left, 0, 0).blit(left.flipX(), 0, 0);
  return out;
}

function wormBody(): PixelGrid {
  const g = new PixelGrid(S, S);
  sphere(g, C, C, 9.8, 9.8, RAMP_A, { hi: WHITE });
  armourBands(g, C, 25, [[10.2, 13.6], [14.6, 20]], 17, C, 12, 11);
  return g.outline(OUT);
}

function wormTail(flash: boolean): PixelGrid {
  const g = new PixelGrid(S, S);
  // Chitin collar ringed by four jade armour plates (split on the diagonals),
  // matching the body's armour, around the glowing bulb.
  sphere(g, C, C, 7.2, 7.2, RAMP_A);
  const plate = (x: number, y: number): boolean => {
    const dx = Math.abs(x + 0.5 - C);
    const dy = Math.abs(y + 0.5 - C);
    return Math.hypot(dx, dy) > 5.4 && Math.abs(dx - dy) > 1;
  };
  sphere(g, C, C, 7.2, 7.2, RAMP_B, { clip: plate });
  const ramp = flash ? [RAMP_C[1], RAMP_C[2], WHITE, WHITE] : [RAMP_C[0], RAMP_C[1], RAMP_C[2], WHITE];
  sphere(g, C - 0.4, C - 0.4, 5.7, 5.7, ramp, { hi: WHITE });
  if (flash) {
    for (const [x, y] of [[6, 15], [25, 15], [15, 5], [16, 26]] as const) star(g, x, y, RAMP_C[2], WHITE);
  }
  return g.outline(OUT);
}

function wormSprite(): FrameBank {
  return new FrameBank()
    .add('head', wormHead(false), wormHead(true))
    .add('body', wormBody())
    .add('tail', wormTail(false), wormTail(true));
}

/** Giant worm sprite and palette. */
export function buildWormArt(): ArtSet {
  return {
    palettes: [actorPalette('pal.a.worm', 'Giant worm', WORM)],
    sprites: [wormSprite().build('boss.worm', 'pal.a.worm')],
  };
}
