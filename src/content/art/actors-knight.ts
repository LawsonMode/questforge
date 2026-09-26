// Iron knight boss (32x32, origin 16,22 — feet on row 30). A hulking suit of
// warm gunmetal iron (it stands out from the cool blue dungeon floor) with a
// crimson plume and tabard, a gold-trimmed kite shield and a spiked flail.
// Built from shaded primitives (cylinders / spheres) plus ASCII details.
// Legend: A = iron, B = crimson cloth, C = gold, D = dark flail iron,
// r = visor glow.
import {
  actorPalette, art, cylinder, FrameBank, GLOW, OUT, RAMP_A, RAMP_B, RAMP_C, RAMP_D, sphere, star, WHITE,
  type ActorColors, type ArtSet,
} from './actors-kit';
import { PixelGrid } from './pixelgrid';

const S = 32;
/** Last interior row of the feet (outline on row 31). */
const FOOT = 30;

const KNIGHT: ActorColors = {
  outline: '#140c0c',
  a: ['#352c2e', '#6c6062', '#bcb0aa'],
  b: ['#600c1c', '#a82030', '#e85048'],
  c: ['#785010', '#c89028', '#f8d860'],
  d: ['#20202c', '#44444f', '#7c7c8c'],
  white: '#ffffff',
  glow: '#ff9020',
};

type Facing = 'down' | 'up' | 'right';
type Phase = 0 | 1 | 2;
type Pt = readonly [number, number];

// ---------------------------------------------------------------- parts

/** Armoured legs for a facing; phase 1/2 lift one foot, `spread` widens the stance. */
function legs(g: PixelGrid, f: Facing, phase: Phase, spread = 0): void {
  if (f === 'right') {
    const fwd = phase === 0 ? 0 : 3 + spread;
    const back = phase === 0 ? 0 : -3 - spread;
    const [near, far] = phase === 2 ? [back, fwd] : [fwd, back];
    const leg = (dx: number, dark: boolean, lift: number): void => {
      cylinder(g, 13 + dx, 22, 5, FOOT - 23 - lift, dark ? [RAMP_A[0], RAMP_A[0], RAMP_A[1]] : RAMP_A);
      cylinder(g, 13 + dx, FOOT - 1 - lift, 7, 2, dark ? [RAMP_D[0], RAMP_D[1]] : RAMP_D);
    };
    leg(far, true, far < 0 ? 1 : 0);
    leg(near, false, near < 0 ? 1 : 0);
    return;
  }
  for (const side of [-1, 1] as const) {
    const lifted = phase !== 0 && (phase === 1 ? side > 0 : side < 0);
    const lift = lifted ? 2 : 0;
    const x = side < 0 ? 10 - spread : 17 + spread;
    cylinder(g, x, 22, 5, FOOT - 23 - lift, RAMP_A);
    g.fill(x, 25 - lift, 5, 1, RAMP_C[1]);
    cylinder(g, x - (side < 0 ? 1 : 0), FOOT - 1 - lift, 6, 2, RAMP_D);
  }
}

/** Great helm centred at column cx with its top at row y; `lit` = visor glow on. */
function helm(g: PixelGrid, cx: number, y: number, f: Facing, lit = true): void {
  cylinder(g, cx - 6, y + 2, 12, 9, RAMP_A, { hi: WHITE });
  sphere(g, cx, y + 3, 6, 3.2, RAMP_A, { hi: WHITE, clip: (_x, yy) => yy <= y + 3 });
  const eye = lit ? GLOW : RAMP_A[0];
  if (f === 'down') {
    g.fill(cx - 5, y + 6, 10, 2, OUT);
    g.fill(cx - 4, y + 6, 2, 1, eye).fill(cx + 2, y + 6, 2, 1, eye);
    for (let yy = y + 1; yy <= y + 10; yy++) if (yy < y + 6 || yy > y + 7) g.set(cx - 1, yy, RAMP_A[2]);
    for (const dx of [-3, -1, 1, 3]) g.set(cx + dx, y + 9, OUT);
  } else if (f === 'right') {
    g.fill(cx, y + 6, 6, 2, OUT);
    g.fill(cx + 2, y + 6, 2, 1, eye);
    for (const dx of [2, 4]) g.set(cx + dx, y + 9, OUT);
  }
  // Gold circlet under the dome.
  for (let x = cx - 6; x < cx + 6; x++) if (g.get(x, y + 3) !== 0) g.set(x, y + 3, x < cx - 1 ? RAMP_C[2] : x < cx + 3 ? RAMP_C[1] : RAMP_C[0]);
}

const PLUME: Record<'front' | 'side' | 'droop', readonly string[]> = {
  front: [
    '.....yBb.....',
    '....ybBBb....',
    '...ybBBBby...',
    '..ybBb.bBby..',
    '..yb.....by..',
  ],
  side: [
    '....bBBb.',
    '..bBBBbby',
    '.bBbbyy..',
    'yBby.....',
    'yb.......',
    'y........',
  ],
  droop: [
    '.............',
    '.....yBb.....',
    '...yybBBy....',
    '..ybBb.bBy...',
    '..yb....bby..',
  ],
};

/** Crimson plume on the helm crest (left edge at column x, top at row y). */
function plume(g: PixelGrid, x: number, y: number, kind: keyof typeof PLUME): void {
  const rows = PLUME[kind];
  g.blit(art(rows[0]!.length, rows), x, y);
}

/** Round pauldron with a gold rim. */
function pauldron(g: PixelGrid, cx: number, cy: number, r = 4.6): void {
  sphere(g, cx, cy, r, r * 0.85, RAMP_A, { hi: WHITE });
  const y = Math.round(cy + r * 0.85) - 1;
  for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (g.get(x, y) !== 0) g.set(x, y, RAMP_C[1]);
}

/** Kite shield: flat top at `top`, point at `top + h`. */
function shield(g: PixelGrid, x0: number, top: number, w: number, h: number): void {
  const cx = x0 + (w - 1) / 2;
  const straight = Math.round(h * 0.55);
  for (let y = top; y < top + h; y++) {
    const t = y - top;
    const half = t < straight ? w / 2 : (w / 2) * (1 - (t - straight) / (h - straight));
    for (let x = x0; x < x0 + w; x++) {
      const dx = x - cx;
      if (Math.abs(dx) > half) continue;
      const edge = Math.abs(dx) > half - 1.2 || t === 0;
      const v = edge ? (dx < 0 || t === 0 ? RAMP_C[2] : RAMP_C[0]) : dx < -w / 6 ? RAMP_B[2] : dx < w / 6 ? RAMP_B[1] : RAMP_B[0];
      g.set(x, y, v);
    }
  }
  // Gold chevron emblem.
  const ex = Math.round(cx);
  g.set(ex, top + 3, RAMP_C[2]).set(ex + 1, top + 3, RAMP_C[1]);
  for (let i = 0; i < 4; i++) g.set(ex - i, top + 4 + i, RAMP_C[2]).set(ex + 1 + i, top + 4 + i, RAMP_C[1]);
}

/** Spiked flail head centred at (cx, cy). */
function flailBall(g: PixelGrid, cx: number, cy: number): void {
  for (const [dx, dy] of [[0, -4], [0, 4], [-4, 0], [4, 0], [-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
    g.set(Math.round(cx + dx), Math.round(cy + dy), RAMP_D[2]);
  }
  sphere(g, cx, cy, 3.2, 3.2, RAMP_D, { hi: WHITE });
}

/** Chain links from the hand to the ball. */
function chain(g: PixelGrid, from: Pt, to: Pt): void {
  const n = Math.max(2, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2));
  for (let i = 1; i < n; i++) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * i) / n);
    const y = Math.round(from[1] + ((to[1] - from[1]) * i) / n);
    g.set(x, y, i % 2 ? RAMP_D[2] : RAMP_D[1]);
  }
}

/** Flail on its chain from the hand to the ball. */
function flail(g: PixelGrid, hand: Pt, ball: Pt): void {
  chain(g, hand, ball);
  flailBall(g, ball[0], ball[1]);
}

/** Gauntleted arm hanging from the shoulder at column x down to the fist row. */
function arm(g: PixelGrid, x: number, top: number, fistY: number): void {
  cylinder(g, x, top, 4, fistY - top, RAMP_A);
  sphere(g, x + 2, fistY + 0.5, 2.2, 2, RAMP_A, { hi: WHITE });
}

/** Gauntleted arm raised from the shoulder (row `shoulderY`) up to the fist at `fist`. */
function raisedArm(g: PixelGrid, fist: Pt, shoulderY: number): void {
  cylinder(g, fist[0] - 2, fist[1], 4, shoulderY - fist[1], RAMP_A);
  sphere(g, fist[0], fist[1], 2.4, 2.2, RAMP_A, { hi: WHITE });
}

/** Twinkling stars circling above the helm (phase rotates them). */
function dazeStars(g: PixelGrid, phase: 0 | 1): void {
  const spots: readonly Pt[] = phase === 0 ? [[9, 4], [23, 3], [16, 1]] : [[12, 2], [21, 5], [7, 3]];
  for (const [x, y] of spots) star(g, x, y, RAMP_C[2], WHITE);
}

/** Dust clouds kicked up around the feet (drawn behind the knight). */
function dust(phase: 0 | 1): PixelGrid {
  const d = new PixelGrid(S, S);
  const puffs: readonly Pt[] = phase === 0 ? [[4, 29], [27, 28], [7, 26], [25, 25]] : [[3, 27], [28, 29], [6, 29], [24, 28]];
  for (const [x, y] of puffs) sphere(d, x, y, 2.2, 1.7, [RAMP_D[1], RAMP_D[2], WHITE]);
  return d;
}

// ---------------------------------------------------------------- poses

/** A flail swing: where the fist and ball are, and the motion arc just swept. */
interface Swing {
  fist: Pt;
  ball: Pt;
  /** Arc centre, radius and start / end angles in degrees (0 = right, 90 = down). */
  arc: { c: Pt; r: number; from: number; to: number };
  /** Fist raised above the shoulder (front view overhead swing). */
  raised?: boolean;
}

interface Pose {
  /** Body offset (walk dip / slump). */
  dy?: number;
  /** Head and plume offset (leaning into a swing, dazed wobble). */
  lean?: number;
  swing?: Swing;
  /** Charging behind the raised shield. */
  charge?: 0 | 1;
  /** Dazed: dim visor, drooping plume, dropped flail, stars. */
  dazed?: 0 | 1;
}

/**
 * Motion arc behind a swung ball: a bright 2px crescent (white outside, pale
 * iron inside) that thins out toward where the swing began.
 */
function motionArc(g: PixelGrid, { c, r, from, to }: Swing['arc']): void {
  const steps = Math.ceil(Math.abs(to - from) / 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = ((from + (to - from) * t) * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    if (t > 0.25 || i % 2 === 0) g.set(c[0] + r * cos, c[1] + r * sin, WHITE);
    if (t > 0.45) g.set(c[0] + (r - 1) * cos, c[1] + (r - 1) * sin, RAMP_D[2]);
  }
}

function knightDown(phase: Phase, pose: Pose = {}): PixelGrid {
  const g = pose.charge !== undefined ? dust(pose.charge) : new PixelGrid(S, S);
  const dy = pose.dy ?? 0;
  const dazed = pose.dazed !== undefined;
  const swing = pose.swing;
  if (swing) motionArc(g, swing.arc);
  legs(g, 'down', phase, pose.charge !== undefined ? 1 : 0);
  // Flail hanging from the right fist (viewer's left), dropped when dazed.
  if (!swing) flail(g, [6, 21 + dy], dazed ? [4, 29] : [4, 27]);
  // Tabard and breastplate with a gold belt.
  cylinder(g, 11, 19 + dy, 10, 7, RAMP_B);
  g.fill(11, 25 + dy, 10, 1, RAMP_C[1]);
  cylinder(g, 10, 12 + dy, 12, 8, RAMP_A, { hi: WHITE });
  g.fill(10, 19 + dy, 12, 1, RAMP_C[0]).fill(15, 19 + dy, 2, 1, RAMP_C[2]);
  if (swing?.raised) raisedArm(g, swing.fist, 13 + dy);
  else if (swing) arm(g, 4, 14 + dy, swing.fist[1]);
  else arm(g, 4, 15 + dy, 21 + dy);
  pauldron(g, 7.5, 13.5 + dy);
  pauldron(g, 24.5, 13.5 + dy);
  const hx = 16 + (pose.lean ?? 0);
  helm(g, hx, 2 + dy, 'down', !dazed);
  plume(g, hx - 6, dy + (dazed ? 1 : 0), dazed ? 'droop' : 'front');
  if (swing) flail(g, swing.fist, swing.ball);
  if (pose.charge !== undefined) shield(g, 9, 12 + dy, 14, 16);
  else if (dazed) shield(g, 21, 18 + dy, 10, 13);
  else shield(g, 20, 14 + dy, 10, 14);
  if (pose.dazed !== undefined) dazeStars(g, pose.dazed);
  return g.outline(OUT);
}

function knightUp(phase: Phase, pose: Pose = {}): PixelGrid {
  const g = new PixelGrid(S, S);
  const dy = pose.dy ?? 0;
  if (pose.swing) motionArc(g, pose.swing.arc);
  legs(g, 'up', phase);
  // Shield on the left arm (viewer's left when seen from behind).
  shield(g, 2, 14 + dy, 10, 14);
  // Cape over the back with folds.
  cylinder(g, 9, 13 + dy, 14, 13, RAMP_B);
  for (let x = 10; x < 23; x += 3) g.set(x, 25 + dy, RAMP_B[0]).set(x, 24 + dy, RAMP_B[0]).set(x, 23 + dy, RAMP_B[0]);
  g.fill(9, 25 + dy, 14, 1, RAMP_C[1]);
  pauldron(g, 7.5, 13.5 + dy);
  pauldron(g, 24.5, 13.5 + dy);
  if (pose.swing) {
    arm(g, 24, 10 + dy, pose.swing.fist[1]);
    flail(g, pose.swing.fist, pose.swing.ball);
  } else {
    arm(g, 24, 15 + dy, 21 + dy);
    flail(g, [26, 21 + dy], [28, 27]);
  }
  helm(g, 16, 2 + dy, 'up');
  plume(g, 10, dy, 'front');
  return g.outline(OUT);
}

function knightRight(phase: Phase, pose: Pose = {}): PixelGrid {
  const g = new PixelGrid(S, S);
  const dy = pose.dy ?? 0;
  if (pose.swing) motionArc(g, pose.swing.arc);
  else flail(g, [11, 21 + dy], [7, 27]);
  legs(g, 'right', phase);
  cylinder(g, 11, 19 + dy, 10, 6, RAMP_B);
  g.fill(11, 24 + dy, 10, 1, RAMP_C[1]);
  cylinder(g, 10, 12 + dy, 11, 8, RAMP_A, { hi: WHITE });
  g.fill(10, 19 + dy, 11, 1, RAMP_C[0]);
  helm(g, 16, 2 + dy, 'right');
  plume(g, 8, dy, 'side');
  if (pose.swing) arm(g, 12, 13 + dy, pose.swing.fist[1]);
  else arm(g, 11, 15 + dy, 21 + dy);
  pauldron(g, 14, 13.5 + dy);
  // Shield held forward on the far arm.
  shield(g, 21, 12 + dy, 7, 15);
  if (pose.swing) flail(g, pose.swing.fist, pose.swing.ball);
  return g.outline(OUT);
}

function knightSprite(): FrameBank {
  const bank = new FrameBank();
  // Walks: the body sinks 1px onto the planted leg on the first frame.
  bank.add('walk_down', knightDown(1, { dy: 1 }), knightDown(2));
  bank.add('walk_up', knightUp(1, { dy: 1 }), knightUp(2));
  bank.add('walk_right', knightRight(1, { dy: 1 }), knightRight(2));
  bank.add('charge', knightDown(1, { charge: 0, dy: 2 }), knightDown(2, { charge: 1, dy: 2 }));
  // Dazed: the slumped head wobbles from side to side under the stars.
  bank.add('stun', knightDown(0, { dy: 3, dazed: 0, lean: 1 }), knightDown(0, { dy: 3, dazed: 1, lean: -1 }));
  // Overhead swing: fist raised, ball flung high and out, a wide arc behind it.
  bank.add('attack_down', knightDown(1, {
    lean: -1,
    swing: { fist: [8, 8], ball: [5, 4], raised: true, arc: { c: [10, 13], r: 9.5, from: 120, to: 230 } },
  }));
  bank.add('attack_up', knightUp(2, {
    swing: { fist: [26, 11], ball: [27, 4], arc: { c: [23, 12], r: 8, from: 25, to: -58 } },
  }));
  bank.add('attack_right', knightRight(1, {
    swing: { fist: [15, 14], ball: [27, 6], arc: { c: [15, 15], r: 14, from: -115, to: -42 } },
  }));
  return bank;
}

/** Iron knight sprite and palette. */
export function buildKnightArt(): ArtSet {
  return {
    palettes: [actorPalette('pal.a.knight', 'Iron knight', KNIGHT)],
    sprites: [knightSprite().build('boss.knight', 'pal.a.knight')],
  };
}
