// Dungeon dwellers (16x16, centred): hopping skeleton, ghost, eye statue and
// blade trap. Skeleton = bone white with ember eyes, ghost = pale lilac with
// teal eyes, eye statue = blue-grey stone with a red eye, blade trap = steel
// with a red core.
import { actorPalette, art, compose, FrameBank, GLOW, OUT, RAMP_A, RAMP_B, WHITE, type ActorColors, type ArtSet } from './actors-kit';
import { PixelGrid } from './pixelgrid';

const S = 16;
const finish = (...layers: PixelGrid[]): PixelGrid => compose(S, S, layers);
const NONE: readonly [string, string, string] = ['#000000', '#000000', '#000000'];

// ---------------------------------------------------------------- skeleton

const SKELETON: ActorColors = {
  outline: '#281c14',
  a: ['#988c70', '#d0c8a8', '#f8f4e0'],
  b: ['#3c2420', '#5c3830', '#805048'],
  c: NONE,
  d: NONE,
  white: '#ffffff',
  glow: '#ff7020',
};

const SKULL = [
  '........|........',
  '......aA|Aa......',
  '....aAAA|AAaa....',
  '...aAAAA|AAaax...',
  '...aAyyA|ayyax...',
  '...aAyrA|ayrax...',
  '...xaAAy|yaaax...',
  '....xwww|wwwx....',
  '.....x#w|#wx.....',
];

const SKELETON_WALK = [
  art(S, [
    ...SKULL,
    '....aAAA|Aaax....',
    '...a.#A#|A#.a....',
    '..aA.AAA|aax.a...',
    '..A...xA|a...Aa..',
    '.....aA.|..aA....',
    '....yy..|..yy....',
    '........|........',
  ]),
  // Mid-hop: the whole skeleton 1px higher with its knees tucked together.
  art(S, [
    ...SKULL.slice(1),
    '....aAAA|Aaax....',
    '....a#A#|A#a.a...',
    '...a.AAA|aax..a..',
    '..Aa..xA|a....A..',
    '......aA|aA......',
    '.....yy.|.yy.....',
    '........|........',
    '........|........',
  ]),
];

/** Leaping: arms flung up beside the skull, legs tucked. */
const SKELETON_JUMP = art(S, [
  '.A......|......a.',
  '.aA...aA|Aa...aa.',
  '..a.aAAA|AAaa.a..',
  '..aaAAAA|AAaaaa..',
  '...aAyyA|ayyax...',
  '...aAyrA|ayrax...',
  '...xaAAy|yaaax...',
  '....xwww|wwwx....',
  '.....x#w|#wx.....',
  '.....AAA|aax.....',
  '.....#A#|A#......',
  '...aAAxA|axAaa...',
  '...a....|....a...',
  '..yy....|....yy..',
  '........|........',
  '........|........',
]);

function skeletonSprite(): FrameBank {
  return new FrameBank()
    .add('walk', ...SKELETON_WALK.map((g) => finish(g)))
    .add('jump', finish(SKELETON_JUMP));
}

// ---------------------------------------------------------------- ghost

const GHOST: ActorColors = {
  outline: '#241c44',
  a: ['#7c74b8', '#b4b0e4', '#f0f0ff'],
  b: ['#302858', '#483c80', '#6858a8'],
  c: NONE,
  d: NONE,
  white: '#ffffff',
  glow: '#58f8d0',
};

const GHOST_HEAD = [
  '........|........',
  '......AA|Aa......',
  '....AAAA|Aaaa....',
  '...AAAAA|AAaaa...',
  '...AAyyA|Ayyaa...',
  '...AAyrA|Ayraa...',
];

const GHOST_FLOAT = [
  art(S, [
    ...GHOST_HEAD,
    '.A.AAAAA|AAaaa.a.',
    'AA.AAAAy|yaaaa.aa',
    '.AAAAAAy|yaaaaaa.',
    '...AAAAA|aaaax...',
    '...AAAAa|aaaax...',
    '..AAAAaa|aaaaax..',
    '..AAaaaa|aaaaax..',
    '..Aa.aaa|a.aax...',
    '..a...aa|...ax...',
    '........|........',
  ]),
  art(S, [
    ...GHOST_HEAD,
    '...AAAAA|AAaaa...',
    '.A.AAAAy|yaaaa.a.',
    'AAAAAAAy|yaaaaaaa',
    '...AAAAA|aaaax...',
    '...AAAAa|aaaax...',
    '..AAAAaa|aaaaax..',
    '..AAaaaa|aaaaax..',
    '...Aaa.a|aaa.ax..',
    '....a...|aa...x..',
    '........|........',
  ]),
];

function ghostSprite(): FrameBank {
  return new FrameBank().add('float', ...GHOST_FLOAT.map((g, i) => compose(S, S, [g], 0, i)));
}

// ---------------------------------------------------------------- eye statue

const EYE_STATUE: ActorColors = {
  outline: '#141824',
  a: ['#484c68', '#787e9c', '#b0b8d0'],
  b: ['#1c2030', '#2c3044', '#454a64'],
  c: ['#7c5818', '#c09030', '#f0d060'],
  d: ['#801020', '#e02838', '#ff9848'],
  white: '#f8f0e8',
  glow: '#fff4a0',
};

/** Stone totem with gold bands around a tall recessed eye socket. */
const EYE_BLOCK = art(S, [
  '........|........',
  '....AAAA|aaaa....',
  '...AAAAA|Aaaax...',
  '..CCCCCC|cccczz..',
  '.AAyyyyy|yyyyyax.',
  '.Aaybbbb|bbbbyax.',
  '.Aaybbbb|bbbbyax.',
  '.Aaybbbb|bbbbyax.',
  '.Aaybbbb|bbbbyax.',
  '.Aaybbbb|bbbbyax.',
  '.Aaybbbb|bbbbyax.',
  '.AAayyyy|yyyyaax.',
  '..CCCCCC|cccczz..',
  '.AAAAAAA|aaaaaax.',
  '.aaaaaaa|aaaaxxx.',
  '........|........',
]);

/** Glowing iris (4x4): a dark red ring around a hot yellow-orange core with a white glint. */
const IRIS = art(4, ['.kk.', 'kwrk', 'krSk', '.kk.']);

const EYE_DIRS: Record<string, readonly [number, number]> = {
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
};

/** The statue with its almond eye looking toward (dx, dy): the iris travels 3px sideways and 2px up / down. */
function eyeFrame(dx: number, dy: number): PixelGrid {
  const g = EYE_BLOCK.clone();
  const sclera = (x: number, y: number): boolean => {
    const nx = (x + 0.5 - 8) / 4.6;
    const ny = (y + 0.5 - 8) / 3.3;
    return nx * nx + ny * ny <= 1;
  };
  // Sclera, shaded under the upper lid and toward the lower right.
  g.map((x, y) => (sclera(x, y) ? (y <= 5 || (x >= 10 && y >= 9) ? RAMP_A[2] : WHITE) : -1));
  const ix = 6 + dx * 3;
  const iy = 6 + dy * 2;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = IRIS.get(x, y);
      if (v && sclera(ix + x, iy + y)) g.set(ix + x, iy + y, v);
    }
  }
  return g.outline(OUT);
}

function eyeSprite(): FrameBank {
  const bank = new FrameBank();
  for (const [name, [dx, dy]] of Object.entries(EYE_DIRS)) bank.add(name, eyeFrame(dx, dy));
  return bank;
}

// ---------------------------------------------------------------- blade trap

const BLADE_TRAP: ActorColors = {
  outline: '#101018',
  a: ['#4c5468', '#8890a8', '#d8e0f0'],
  b: ['#282c38', '#3c4050', '#5c6478'],
  c: NONE,
  d: NONE,
  white: '#ffffff',
  glow: '#ff2830',
};

/** Spiked steel block: bevelled face, recessed red core, 12 spikes. */
function bladeTrapFrame(): PixelGrid {
  const g = new PixelGrid(S, S);
  const [dark, mid, light] = RAMP_A;
  // Side spikes: two per side, lit on the top/left sides.
  for (const c of [5, 10]) {
    g.set(c, 1, light).fill(c - 1, 2, 3, 1, light);
    g.set(1, c, light).fill(2, c - 1, 1, 3, light);
    g.set(c, 14, dark).fill(c - 1, 13, 3, 1, dark);
    g.set(14, c, dark).fill(13, c - 1, 1, 3, dark);
  }
  // Corner spikes.
  g.set(1, 1, light).set(2, 2, light).set(14, 1, mid).set(13, 2, mid);
  g.set(1, 14, mid).set(2, 13, mid).set(14, 14, dark).set(13, 13, dark);
  // Bevelled block.
  g.fill(3, 3, 10, 10, mid);
  g.fill(3, 3, 10, 1, light).fill(3, 3, 1, 10, light);
  g.fill(3, 12, 10, 1, dark).fill(12, 3, 1, 10, dark);
  g.set(12, 3, mid).set(3, 12, mid);
  // Recessed socket with the glowing core.
  g.fill(5, 5, 6, 6, RAMP_B[1]);
  g.fill(5, 5, 6, 1, RAMP_B[0]).fill(5, 5, 1, 6, RAMP_B[0]);
  g.fill(6, 6, 4, 4, GLOW);
  g.fill(8, 8, 2, 2, RAMP_B[2]);
  g.set(9, 9, OUT).set(6, 6, WHITE).set(7, 6, WHITE).set(6, 7, WHITE);
  // Rivets.
  for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]] as const) g.set(x, y, x + y < 15 ? WHITE : dark);
  return g.outline(OUT);
}

function bladeTrapSprite(): FrameBank {
  return new FrameBank().add('idle', bladeTrapFrame());
}

// ---------------------------------------------------------------- export

/** Skeleton, ghost, eye statue and blade trap sprites with their palettes. */
export function buildDungeonArt(): ArtSet {
  return {
    palettes: [
      actorPalette('pal.a.skeleton', 'Skeleton', SKELETON),
      actorPalette('pal.a.ghost', 'Ghost', GHOST),
      actorPalette('pal.a.eye', 'Eye statue', EYE_STATUE),
      actorPalette('pal.a.bladeTrap', 'Blade trap', BLADE_TRAP),
    ],
    sprites: [
      skeletonSprite().build('enemy.skeleton', 'pal.a.skeleton'),
      ghostSprite().build('enemy.ghost', 'pal.a.ghost'),
      eyeSprite().build('enemy.eye', 'pal.a.eye'),
      bladeTrapSprite().build('enemy.bladeTrap', 'pal.a.bladeTrap'),
    ],
  };
}
