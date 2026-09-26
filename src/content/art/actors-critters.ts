// Overworld critters (16x16, centred): slime, rock spitter, bat, shell beetle
// and snake. Round bodies are shaded procedurally with `sphere`; faces, legs and
// wings are ASCII overlays. Each critter has its own colour identity.
import {
  actorPalette, art, bevel, compose, FrameBank, GLOW, moved, OUT, RAMP_A, RAMP_B, sphere, swapPalette, WHITE,
  type ActorColors, type ArtSet,
} from './actors-kit';
import { PixelGrid } from './pixelgrid';

const S = 16;
const blank = (): PixelGrid => new PixelGrid(S, S);
const finish = (...layers: PixelGrid[]): PixelGrid => compose(S, S, layers);
const NONE: readonly [string, string, string] = ['#000000', '#000000', '#000000'];
type Pt = readonly [number, number];

// ---------------------------------------------------------------- slime

const SLIME_GREEN: ActorColors = {
  outline: '#0c3018',
  a: ['#207828', '#40b040', '#90e868'],
  b: ['#105820', '#288838', '#50b050'],
  c: NONE,
  d: NONE,
  white: '#f0fff0',
  glow: '#f8f8f8',
};
const SLIME_RED: Partial<ActorColors> = {
  outline: '#380810',
  a: ['#a01828', '#e04040', '#ff9878'],
  b: ['#701020', '#b02030', '#d84848'],
  white: '#fff0e8',
};
const SLIME_BLUE: Partial<ActorColors> = {
  outline: '#081838',
  a: ['#1c48a8', '#3888e8', '#98d0ff'],
  b: ['#103070', '#2058b0', '#3878d8'],
  white: '#f0f8ff',
};

/** A slime blob whose flat base sits on row `bottom`; `eye` 1 = small dots, 2 = big eyes. */
function slimeFrame(rx: number, ry: number, bottom: number, eye: 1 | 2): PixelGrid {
  const g = blank();
  const cx = 7.5;
  const cy = bottom + 1 - ry * 0.8;
  sphere(g, cx, cy, rx, ry, RAMP_A, { hi: WHITE, clip: (_x, y) => y <= bottom });
  // Darker nucleus floating low inside the gel.
  const body = g.clone();
  sphere(g, cx + rx * 0.25, cy + ry * 0.4, Math.max(1.2, rx * 0.34), Math.max(1, ry * 0.26), [RAMP_B[0], RAMP_B[1]], {
    clip: (x, y) => y <= bottom - 1 && body.get(x, y) !== 0,
  });
  // Contact shading on the base.
  for (let x = 0; x < S; x++) if (g.get(x, bottom) !== 0) g.set(x, bottom, RAMP_A[0]);
  // Eyes: big glossy ovals (2x2 with a glint) or small dots.
  const ey = Math.round(cy - ry * 0.1);
  if (eye === 2) {
    for (const x of [5, 9]) g.fill(x, ey, 2, 2, OUT).set(x, ey, WHITE);
  } else {
    g.set(6, ey, OUT).set(9, ey, OUT);
  }
  return g.outline(OUT);
}

function slimeSprite(): FrameBank {
  return new FrameBank()
    .add('idle', slimeFrame(6.6, 5.4, 13, 2), slimeFrame(5.9, 6.1, 13, 2))
    .add('hop', slimeFrame(5.2, 6.8, 12, 2))
    .add('small_idle', slimeFrame(3.9, 3.2, 13, 1), slimeFrame(3.4, 3.7, 13, 1))
    .add('small_hop', slimeFrame(3.1, 4.2, 12, 1));
}

// ---------------------------------------------------------------- rock spitter

const SPITTER_RED: ActorColors = {
  outline: '#380810',
  a: ['#982028', '#d84038', '#ff9068'],
  b: ['#a84818', '#e89040', '#ffd890'],
  c: NONE,
  d: NONE,
  white: '#f8f8f0',
  glow: '#f8f8f8',
};
const SPITTER_BLUE: Partial<ActorColors> = {
  outline: '#0c1838',
  a: ['#2040a0', '#3c78e0', '#90c8ff'],
  b: ['#806018', '#d0a830', '#fff098'],
};

/** The round body; `glint` adds the specular spot (off in the front view, where it would merge with the left eye). */
function spitterBody(dy: number, glint: boolean): PixelGrid {
  return sphere(blank(), 7.5, 7.2 + dy, 5.6, 5.1, RAMP_A, { hi: glint ? WHITE : undefined, bias: 0.05 });
}

/** Four stubby legs; `phase` alternates which pair is stretched. */
function spitterLegs(phase: 0 | 1, side: boolean): PixelGrid {
  const g = blank();
  const xs = side ? [3, 6, 8, 11] : [3, 6, 9, 12];
  xs.forEach((x, i) => {
    const long = (i % 2 === 0) === (phase === 0);
    const len = long ? 3 : 2;
    for (let y = 11; y < 11 + len; y++) g.set(x, y, RAMP_A[1]).set(x + 1, y, RAMP_A[0]);
    if (side) g.set(x + (phase === 0 ? 1 : -1) * (long ? 1 : 0) + 1, 10 + len, RAMP_A[0]);
  });
  return g;
}

const SPITTER_FACE = {
  down: art(S, [
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '...www..|..www...',
    '...w##..|..##w...',
    '....#...|...#....',
    '......BB|BB......',
    '.....bB#|#Bb.....',
    '.....yb#|#by.....',
    '......yb|by......',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
  ]),
  up: art(S, [
    '........|........',
    '......yb|by......',
    '.....bB#|#By.....',
    '.....yBb|bby.....',
    '......yy|yy......',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
  ]),
  right: art(S, [
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|ww......',
    '........|w##.....',
    '........|.#...bBy',
    '........|....bBB#',
    '........|....bb##',
    '........|.....by#',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
    '........|........',
  ]),
};

function spitterSprite(): FrameBank {
  const bank = new FrameBank();
  for (const f of ['down', 'up', 'right'] as const) {
    const frames = ([0, 1] as const).map((p) => {
      const dy = (f === 'up' ? 1 : 0) + (p === 1 ? 1 : 0);
      return finish(spitterLegs(p, f === 'right'), spitterBody(dy, f !== 'down'), moved(SPITTER_FACE[f], 0, dy));
    });
    bank.add(`walk_${f}`, ...frames);
  }
  return bank;
}

// ---------------------------------------------------------------- bat

const BAT: ActorColors = {
  outline: '#1c0c2c',
  a: ['#40285c', '#6c48a0', '#a080d0'],
  b: ['#5c1c4c', '#983078', '#d060a8'],
  c: NONE,
  d: NONE,
  white: '#f8f0f0',
  glow: '#ff3830',
};

const BAT_FLY_UP = art(S, [
  '........|........',
  '.y......|......y.',
  '.Bb.....|.....by.',
  '.BBb....|....bby.',
  '..BBb.a.|.a.bby..',
  '..BBbbaA|aabbyy..',
  '...BbaAA|aaaby...',
  '...ybara|araby...',
  '....yaAa|aaay....',
  '.....aaw|waa.....',
  '......aa|aa......',
  '.......x|x.......',
  '........|........',
  '........|........',
  '........|........',
  '........|........',
]);

const BAT_FLY_DOWN = art(S, [
  '........|........',
  '........|........',
  '........|........',
  '........|........',
  '......a.|.a......',
  '......aA|aa......',
  '..ybb.AA|aa.bby..',
  '.yBBbbra|arbbbby.',
  '.BBBbaAa|aaabbby.',
  '.yBb.aaw|waa.bby.',
  '.y.b..aa|aa..b.y.',
  '...y...x|x...y...',
  '........|........',
  '........|........',
  '........|........',
  '........|........',
]);

/** Perched with the wings wrapped like a cloak, eyes shut. */
const BAT_REST = art(S, [
  '........|........',
  '........|........',
  '........|........',
  '.....a..|..a.....',
  '.....aa.|.aa.....',
  '.....aAA|Aaa.....',
  '....baAA|aaaby...',
  '...bBa#a|a#abby..',
  '...bBaaa|aaabby..',
  '...bBBbw|wbbbby..',
  '...ybBBb|bbbbyy..',
  '....ybBb|bbby....',
  '.....yyb|byy.....',
  '......y.|.y......',
  '........|........',
  '........|........',
]);

function batSprite(): FrameBank {
  return new FrameBank()
    .add('fly', finish(BAT_FLY_UP), finish(BAT_FLY_DOWN))
    .add('rest', finish(BAT_REST));
}

// ---------------------------------------------------------------- shell beetle

const BEETLE: ActorColors = {
  outline: '#081c24',
  a: ['#0c5a64', '#189890', '#58d8c0'],
  b: ['#806010', '#d0a028', '#f8e070'],
  c: ['#3c3450', '#70688c', '#b0a8c8'],
  d: NONE,
  white: '#f0fff8',
  glow: '#ff3830',
};

/**
 * Underside per walk frame (rows 10-14): two legs per side splayed out past
 * the silhouette in a tripod gait (each side's pair steps opposite the other
 * side's), the dark head with glaring white eyes, and pincers that open and
 * shut.
 */
const BEETLE_UNDER: readonly PixelGrid[] = [
  art(S, [
    'ccc.zwwc|cwwz.c..',
    '....cw#c|c#wc..c.',
    '...c.zcC|Ccz.cc.c',
    '..c..C..|..C...c.',
    '.c...c..|..c.....',
  ]),
  art(S, [
    '..c.zwwc|cwwz.ccc',
    '.c..cw#c|c#wc....',
    'c.cc.zcC|Ccz.c...',
    '.c....C.|.C...c..',
    '.......c|c.....c.',
  ]),
];

/** Front view of the shell beetle: underside, then the domed shell over its wide gold brim. */
function beetleFrame(phase: 0 | 1): PixelGrid {
  const g = blank().blit(BEETLE_UNDER[phase]!, 0, 10);
  sphere(g, 8, 6.2, 5.8, 5.4, RAMP_A, { hi: WHITE, clip: (_x, y) => y <= 8 });
  for (let y = 3; y <= 8; y++) g.set(7, y, RAMP_A[0]).set(8, y, RAMP_A[2]);
  for (let x = 1; x <= 14; x++) g.set(x, 9, x < 5 ? RAMP_B[2] : x < 11 ? RAMP_B[1] : RAMP_B[0]);
  return g.outline(OUT);
}

function beetleSprite(): FrameBank {
  return new FrameBank().add('walk', beetleFrame(0), beetleFrame(1));
}

// ---------------------------------------------------------------- snake

const SNAKE: ActorColors = {
  outline: '#2c1404',
  a: ['#b85c10', '#e8a020', '#fff068'],
  b: ['#401804', '#703010', '#a05020'],
  c: NONE,
  d: NONE,
  white: '#fffff0',
  glow: '#ff2848',
};

type SnakeFacing = 'down' | 'up' | 'right';

/** Profile body: a tapered tube from tail to neck with dark bands every other bead pair, edge-lit as one shape. */
function snakeBody(g: PixelGrid, pts: readonly Pt[]): void {
  const body = blank();
  pts.forEach(([x, y], i) => {
    const r = 1.2 + (1.0 * i) / Math.max(1, pts.length - 1);
    body.ellipse(x, y, r, r, Math.floor(i / 2) % 2 === 1 ? RAMP_B[1] : RAMP_A[1]);
  });
  g.blit(bevel(body, [RAMP_A, RAMP_B]), 0, 0);
}

/** Profile head with its eye; the tongue flicks when `tongue`. */
function snakeHeadSide(g: PixelGrid, x: number, y: number, tongue: boolean): void {
  const hx = Math.round(x);
  const hy = Math.round(y);
  sphere(g, x, y, 3.3, 2.6, RAMP_A, { hi: WHITE });
  g.set(hx + 1, hy - 1, OUT).set(hx, hy - 1, WHITE);
  if (tongue) g.set(hx + 3, hy + 1, GLOW).set(hx + 4, hy + 1, GLOW);
}

/**
 * Front and back views, drawn by hand: a clean S coil of constant width with a
 * dark crossband every 3 rows, tapering to the tail. Facing down the spade
 * head (eyes, flicking tongue) is nearest; facing up it is farthest, seen from
 * behind with its eyes bulging at the sides.
 */
const SNAKE_COIL: Record<'down' | 'up', readonly [PixelGrid, PixelGrid]> = {
  down: [
    art(S, [
      '........|........',
      '........|.a......',
      '........|Aax.....',
      '.......A|ax......',
      '......yy|b.......',
      '.....Aax|........',
      '.....Aaa|x.......',
      '......yy|bb......',
      '.......A|aax.....',
      '........|Aax.....',
      '.......y|ybb.....',
      '......wA|Aaw.....',
      '.....A#A|aa#x....',
      '.....aaa|aaax....',
      '......xa|aax.....',
      '........|r.......',
    ]),
    art(S, [
      '........|........',
      '......a.|........',
      '.....Aax|........',
      '......Aa|x.......',
      '.......y|yb......',
      '........|Aax.....',
      '.......A|aax.....',
      '......yy|bb......',
      '.....Aaa|x.......',
      '.....Aax|........',
      '......yy|bb......',
      '......wA|Aaw.....',
      '.....A#A|aa#x....',
      '.....aaa|aaax....',
      '......xa|aax.....',
      '........|........',
    ]),
  ],
  up: [
    art(S, [
      '........|........',
      '......AA|aa......',
      '.....#AA|aa#.....',
      '.....aAy|yax.....',
      '......aa|ax......',
      '......yy|b.......',
      '.....Aax|........',
      '.....Aaa|x.......',
      '......yy|bb......',
      '.......A|aax.....',
      '........|Aax.....',
      '.......y|ybx.....',
      '......Aa|x.......',
      '......Ax|........',
      '.......a|........',
      '........|........',
    ]),
    art(S, [
      '........|........',
      '......AA|aa......',
      '.....#AA|aa#.....',
      '.....aAy|yax.....',
      '......aa|ax......',
      '.......y|yb......',
      '........|Aax.....',
      '.......A|aax.....',
      '......yy|bb......',
      '.....Aaa|x.......',
      '.....Aax|........',
      '......yy|b.......',
      '.......A|ax......',
      '........|ax......',
      '........|a.......',
      '........|........',
    ]),
  ],
};

/** `n` points along one sine period from (x0, y0) to (x1, y1), swaying sideways by `amp`. */
function wave(x0: number, y0: number, x1: number, y1: number, amp: number, phase: number, n: number): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const px = -(y1 - y0) / len;
  const py = (x1 - x0) / len;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const s = Math.sin(t * Math.PI * 2 + phase) * amp;
    return [x0 + (x1 - x0) * t + px * s, y0 + (y1 - y0) * t + py * s] as const;
  });
}

function snakeFrame(f: SnakeFacing, p: 0 | 1): PixelGrid {
  if (f !== 'right') return finish(SNAKE_COIL[f][p]);
  const g = blank();
  snakeBody(g, [...wave(2, 11.5, 9.8, 11.5, 1.5, p === 0 ? 0 : Math.PI, 9), [10.6, 9.6], [11.2, 8.2]]);
  snakeHeadSide(g, 11.6, 6.4, p === 1);
  return g.outline(OUT);
}

function snakeSprite(): FrameBank {
  const bank = new FrameBank();
  for (const f of ['down', 'up', 'right'] as const) bank.add(`walk_${f}`, snakeFrame(f, 0), snakeFrame(f, 1));
  return bank;
}

// ---------------------------------------------------------------- export

/** Slime, spitter, bat, beetle and snake sprites with their palettes and swaps. */
export function buildCritterArt(): ArtSet {
  return {
    palettes: [
      actorPalette('pal.a.slime', 'Slime (green)', SLIME_GREEN),
      swapPalette('pal.slime.red', 'Slime (red)', SLIME_GREEN, SLIME_RED),
      swapPalette('pal.slime.blue', 'Slime (blue)', SLIME_GREEN, SLIME_BLUE),
      actorPalette('pal.a.spitter', 'Rock spitter (red)', SPITTER_RED),
      swapPalette('pal.spitter.blue', 'Rock spitter (blue)', SPITTER_RED, SPITTER_BLUE),
      actorPalette('pal.a.bat', 'Bat', BAT),
      actorPalette('pal.a.beetle', 'Shell beetle', BEETLE),
      actorPalette('pal.a.snake', 'Snake', SNAKE),
    ],
    sprites: [
      slimeSprite().build('enemy.slime', 'pal.a.slime'),
      spitterSprite().build('enemy.spitter', 'pal.a.spitter'),
      batSprite().build('enemy.bat', 'pal.a.bat'),
      beetleSprite().build('enemy.beetle', 'pal.a.beetle'),
      snakeSprite().build('enemy.snake', 'pal.a.snake'),
    ],
  };
}
