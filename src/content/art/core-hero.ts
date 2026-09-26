// The Hero (16x24, origin 8,18): an original young adventurer in a green tunic,
// forest-green cap with a swept-back cream plume, auburn hair, brown belt &
// boots and a round wooden shield with a gold sprout emblem on the left arm.
//
// Frames are composed from reusable parts (head / torso / arms / legs / shield
// per facing) and then given a 1px dark-brown silhouette outline, so every pose
// stays on-model. Feet sit on the bottom row; the 12x12 hitbox covers rows 12-23.
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { at, compose, outlineFill, pix, shifted, SpriteBuilder, type Layer, type Legend } from './core-draw';
import { PAL } from './core-palettes';

/** Hero palette indices. */
const O = 1;
const L = { o: O, G: 2, g: 3, l: 4, c: 5, S: 6, s: 7, H: 8, h: 9, B: 10, b: 11, w: 12, W: 13, y: 14, C: 15 } as const satisfies Legend;
const W = 16;
const H = 24;

type Facing = 'down' | 'up' | 'right';
type Face = 'normal' | 'shut' | 'happy';
type Legs = 'stand' | 'stepA' | 'stepB' | 'braceA' | 'braceB' | 'pushA' | 'pushB' | 'none';

/** Everything that varies between frames of one facing. */
interface Pose {
  /** Upper-body offset in px (negative = up / back); the legs stay planted. */
  dx?: number;
  dy?: number;
  legs?: Legs;
  /** Arm/shield layers drawn behind the legs and torso. */
  back?: Layer[];
  /** Arm/shield layers drawn over the torso but under the head. */
  mid?: Layer[];
  /** Layers drawn over everything (raised arms, shield). */
  front?: Layer[];
  face?: Face;
}

// ============================================================================
// Heads (12 wide, drawn at x=2, y=2+dy). A 2px cream plume with a tan shade
// rises from the band at the side of the cap and sweeps back.
// ============================================================================

const CAP_DOWN = [
  '...ccccc...W',
  '..cggcccc.Ww',
  '.cgccccccWw.',
  '.cgccccccyC.',
  '.CCCCCCCCCC.',
];

const HEAD_DOWN = pix([
  ...CAP_DOWN,
  'HhhhhHhhhhhH',
  'HhhshhhshhhH',
  'HhssssssssSH',
  'HhsossssosSH',
  '.SsossssosS.',
  '..SssssssS..',
], L);

/** Face overlays for the down-facing head (rows 7-10 of the head). */
const FACES_DOWN: Record<Exclude<Face, 'normal'>, PixelGrid> = {
  shut: pix([
    'HhssssssssSH',
    'HhoosssoosSH',
    '.SssssssssS.',
    '..SssoosS...',
  ], L),
  happy: pix([
    'HhsossssosSH',
    'HosssssssoSH',
    '.SssoooosS..',
    '..SssssssS..',
  ], L),
};

const HEAD_UP = pix([
  'W...ccccc...',
  'wW.cggcccc..',
  '.wWgccccccc.',
  '.Cycccccccc.',
  '.CCCCCCCCCC.',
  'HhhhhhhhhhhH',
  'HhhHhhhhHhhH',
  'sHhHhhhhHhHs',
  'SHhhHhhHhhHS',
  '.HHhHhhHhHH.',
  '..HHhSShHH..',
], L);

const HEAD_RIGHT = pix([
  '....cccccc..',
  'wW.cggccccc.',
  '.wWygccccccc',
  '.CWccccccccc',
  '.CCCCCCCCCCC',
  'HhhhhhhhhhhH',
  'HhhhhhShhsS.',
  'HhhhhSssosss',
  'HhhhHSssosss',
  '.HhhhSssssS.',
  '..HHHSSSSS..',
], L);

const HEAD_RIGHT_SHUT = pix([
  'HhhhhSssssss',
  'HhhhHSsooSss',
], L);

function head(f: Facing, dy: number, face: Face): Layer[] {
  if (f === 'up') return [at(HEAD_UP, 2, 2 + dy)];
  if (f === 'right') {
    const out = [at(HEAD_RIGHT, 2, 2 + dy)];
    if (face !== 'normal') out.push(at(HEAD_RIGHT_SHUT, 2, 9 + dy));
    return out;
  }
  const out = [at(HEAD_DOWN, 2, 2 + dy)];
  if (face !== 'normal') out.push(at(FACES_DOWN[face], 2, 9 + dy));
  return out;
}

// ============================================================================
// Torsos (drawn at y=13+dy)
// ============================================================================

const TORSO_DOWN = pix([
  'GglssgGG',
  'GgllggGG',
  'GglgggGG',
  'BbbyybBB',
  'GglgggGG',
  'GglggggG',
  'GGgGGgGG',
], L);

const TORSO_UP = pix([
  'GglgggGG',
  'GglgggGG',
  'GglgggGG',
  'BbbbbbBB',
  'GglgggGG',
  'GglggggG',
  'GGgGGgGG',
], L);

const TORSO_RIGHT = pix([
  'GglggG.',
  'GglggG.',
  'GglgggG',
  'BbbbyyB',
  'GglgggG',
  'GglgggG',
  'GGgGGGG',
], L);

function torso(f: Facing, dy: number): Layer {
  if (f === 'up') return at(TORSO_UP, 4, 13 + dy);
  if (f === 'right') return at(TORSO_RIGHT, 5, 13 + dy);
  return at(TORSO_DOWN, 4, 13 + dy);
}

// ============================================================================
// Legs (boots below the tunic hem, feet on row 22; outline lands on row 23)
// ============================================================================

/** One front/back-view leg: 2px column from `top` to `bottom`, foot flares outward on the last row. */
function legFront(g: PixelGrid, x: number, top: number, bottom: number, flare: -1 | 1): void {
  for (let y = top; y <= bottom; y++) {
    g.set(x, y, L.b);
    g.set(x + 1, y, L.B);
  }
  g.set(flare < 0 ? x - 1 : x + 2, bottom, L.B);
}

function legsFrontView(dy: number, legs: Legs): PixelGrid {
  const g = new PixelGrid(W, H);
  const top = 20 + dy;
  const lb = legs === 'stepB' || legs === 'braceB' ? 21 : 22;
  const rb = legs === 'stepA' || legs === 'braceA' ? 21 : 22;
  const spread = legs === 'braceA' || legs === 'braceB' ? 1 : 0;
  legFront(g, 5 - spread, top, lb, -1);
  legFront(g, 9 + spread, top, rb, 1);
  return g;
}

/** Side-view leg as a slanted 2px strip from the hip to a foot pointing right. */
function legSide(g: PixelGrid, hipX: number, top: number, footX: number, near: boolean, bottom = 22): void {
  const span = bottom - top;
  for (let y = top; y <= bottom; y++) {
    const t = span === 0 ? 1 : (y - top) / span;
    const x = Math.round(hipX + (footX - hipX) * t);
    g.set(x, y, near ? L.b : L.B);
    g.set(x + 1, y, L.B);
  }
  g.set(footX + 2, bottom, near ? L.b : L.B);
}

/** Side-view leg placements: [hipX, footX, near, bottom] for the far leg then the near leg. */
const SIDE_LEGS: Readonly<Record<Exclude<Legs, 'none'>, readonly (readonly [number, number, boolean, number])[]>> = {
  stand: [[6, 6, false, 22], [7, 7, true, 22]],
  stepA: [[6, 4, false, 22], [7, 9, true, 22]],
  stepB: [[7, 9, false, 22], [6, 4, true, 22]],
  braceA: [[6, 3, false, 22], [7, 7, true, 22]],
  braceB: [[7, 7, false, 22], [6, 3, true, 22]],
  // Pushing: the rear leg drives back from a planted front foot, then steps in.
  pushA: [[6, 2, false, 22], [8, 8, true, 22]],
  pushB: [[6, 4, false, 21], [8, 8, true, 22]],
};

function legsSideView(dy: number, legs: Exclude<Legs, 'none'>): PixelGrid {
  const g = new PixelGrid(W, H);
  for (const [hip, foot, near, bottom] of SIDE_LEGS[legs]) legSide(g, hip, 20 + dy, foot, near, bottom);
  return g;
}

function legLayer(f: Facing, dy: number, legs: Legs): Layer | null {
  if (legs === 'none') return null;
  return at(f === 'right' ? legsSideView(dy, legs) : legsFrontView(dy, legs), 0, 0);
}

// ============================================================================
// Arms & shield parts
// ============================================================================

/** Hanging arm, 2 wide: sleeve then skin. `len` = total rows (hand included). */
function armHang(len: number, lightLeft = true): PixelGrid {
  const rows: string[] = [lightLeft ? 'lG' : 'gG', 'gG'];
  while (rows.length < len) rows.push(lightLeft ? 'sS' : 'Ss');
  return pix(rows.slice(0, len), L);
}

const SHIELD_FRONT = pix([
  '.BBBB.',
  'BwwybB',
  'BwyybB',
  'BwybbB',
  'BbbbbB',
  '.BBBB.',
], L);

const SHIELD_BACK = pix([
  '.BBBB.',
  'BbbbbB',
  'ByBBBB',
  'BbbbbB',
  'BbbbBB',
  '.BBBB.',
], L);

const SHIELD_SIDE = pix([
  '.B.',
  'BwB',
  'ByB',
  'ByB',
  'BbB',
  '.B.',
], L);

/** Arm raised overhead (hand on top), 2 wide; mirrored for the other side. */
const ARM_RAISED = pix([
  'ss',
  'sS',
  'sS',
  'Ss',
  'sS',
  'gG',
  'lG',
  'gG',
  'gG',
], L);

// Down-facing sword-arm poses (arm on the viewer's left).
const ARM_D_WIND = pix([
  '..gG',
  'ssgG',
  'ss..',
], L);
const ARM_D_SLASH = pix([
  '.lG',
  '.gG',
  'sS.',
  'sS.',
  'ss.',
], L);
/** Thrust: the arm drives down in front of the hip, fist low for a long reach. */
const ARM_D_THRUST = pix([
  'lG.',
  'gGG',
  '.gG',
  '.sS',
  '.ss',
  '.ss',
], L);
const ARM_D_USE = pix([
  'lG..',
  'gGG.',
  '.gss',
  '..ss',
], L);
const ARM_D_PUSH = pix([
  'lG..',
  'gGg.',
  '.Gss',
  '..sS',
], L);

// Up-facing sword-arm poses (arm on the viewer's right).
const ARM_U_WIND = pix([
  'gG.',
  'gGs',
  '.ss',
], L);
const ARM_U_SLASH = pix([
  '..ss',
  '.gss',
  'gG..',
  'gG..',
], L);
const ARM_U_REACH = pix([
  'ss',
  'ss',
  'sS',
  'Ss',
  'gG',
  'gG',
  'gG',
], L);
/** Seen from behind while pushing: the forearms reach ahead out of sight, only the bent sleeve shows. */
const ARM_U_PUSH = pix([
  'gG',
  'gG',
  'Gg',
], L);

// Right-facing near (sword) arm poses.
const ARM_R_HANG = pix([
  'lG',
  'gG',
  'gG',
  'sS',
  'ss',
], L);
const ARM_R_FWD = pix([
  'lG..',
  'gGG.',
  '.gss',
  '..ss',
], L);
const ARM_R_BACK = pix([
  'lG',
  'gG',
  'Gs',
  'ss',
], L);
/** Windup: arm raised straight up behind the head, the fist showing above the back of the cap. */
const ARM_R_WIND = pix([
  'ss',
  'sS',
  'Ss',
  'sS',
  'gG',
  'gG',
  'gG',
  'gG',
  'gG',
  'gG',
  'lG',
  'gG',
  'gG',
], L);
/** Slash: forearm level in front of the chest, fist below the chin. */
const ARM_R_SLASH = pix([
  'lGgss.',
  'gGGsss',
], L);
/** Thrust: arm locked straight out at the belt line. */
const ARM_R_THRUST = pix([
  'lGgg...',
  'gGGgsss',
  '....sss',
], L);
const ARM_R_PUSH = pix([
  'lGg..',
  'gGgss',
  '...ss',
], L);

// ============================================================================
// Frame assembly
// ============================================================================

/** Un-outlined composite of one pose (the outline is added once by the caller). */
function layers(f: Facing, p: Pose): (Layer | null)[] {
  const dx = p.dx ?? 0;
  const dy = p.dy ?? 0;
  return [
    ...shifted(p.back ?? [], dx),
    legLayer(f, dy, p.legs ?? 'stand'),
    ...shifted([torso(f, dy)], dx),
    ...shifted(p.mid ?? [], dx),
    ...shifted(head(f, dy, p.face ?? 'normal'), dx),
    ...shifted(p.front ?? [], dx),
  ];
}

type ArmPose = 'rest' | 'fwd' | 'back' | 'wind' | 'slash' | 'thrust' | 'push' | 'raise' | 'use' | 'hurt';
type ArmLayers = Pick<Pose, 'back' | 'mid' | 'front'>;

/** Both arms raised overhead at the sides of the head (lift / carry / item get). */
function raisedArms(dy: number): ArmLayers {
  return { front: [at(ARM_RAISED, 1, 4 + dy, O), at(ARM_RAISED.flipX(), 13, 4 + dy, O)] };
}

function downArms(arm: ArmPose, dy: number): ArmLayers {
  const sh = at(SHIELD_FRONT, 9, 14 + dy, O);
  switch (arm) {
    // The shield arm counter-swings: back (1px up) while the sword arm swings forward, and vice versa.
    case 'fwd': return { mid: [at(armHang(6), 2, 13 + dy)], front: [at(SHIELD_FRONT, 9, 13 + dy, O)] };
    case 'back': return { mid: [at(armHang(4), 2, 13 + dy)], front: [at(SHIELD_FRONT, 9, 15 + dy, O)] };
    case 'wind': return { mid: [at(ARM_D_WIND, 1, 13 + dy)], front: [sh] };
    case 'slash': return { mid: [at(ARM_D_SLASH, 1, 13 + dy)], front: [sh] };
    case 'thrust': return { front: [sh, at(ARM_D_THRUST, 3, 13 + dy, O)] };
    case 'use': return { front: [at(SHIELD_FRONT, 9, 15 + dy, O), at(ARM_D_USE, 3, 14 + dy, O), at(ARM_D_USE.flipX(), 9, 14 + dy, O)] };
    case 'push': return { front: [at(ARM_D_PUSH, 3, 14 + dy, O), at(SHIELD_FRONT, 8, 15 + dy, O)] };
    case 'raise': return raisedArms(dy);
    case 'hurt': return { front: [at(ARM_RAISED.crop(0, 0, 2, 6), 1, 9 + dy, O), at(SHIELD_FRONT, 9, 13 + dy, O)] };
    default: return { mid: [at(armHang(5), 2, 13 + dy)], front: [sh] };
  }
}

function upArms(arm: ArmPose, dy: number): ArmLayers {
  const sh = at(SHIELD_BACK, 1, 14 + dy, O);
  switch (arm) {
    case 'fwd': return { mid: [at(armHang(6, false), 12, 13 + dy)], front: [at(SHIELD_BACK, 1, 13 + dy, O)] };
    case 'back': return { mid: [at(armHang(4, false), 12, 13 + dy)], front: [at(SHIELD_BACK, 1, 15 + dy, O)] };
    case 'wind': return { mid: [at(ARM_U_WIND, 12, 13 + dy)], front: [sh] };
    case 'slash': return { mid: [at(ARM_U_SLASH, 11, 10 + dy, O)], front: [sh] };
    case 'thrust': return { front: [sh, at(ARM_U_REACH, 10, 6 + dy, O)] };
    case 'use': return { front: [sh, at(ARM_U_REACH, 10, 7 + dy, O)] };
    case 'push': return { mid: [at(SHIELD_BACK, 1, 12 + dy, O), at(ARM_U_PUSH, 12, 13 + dy)] };
    case 'raise': return raisedArms(dy);
    case 'hurt': return { front: [at(ARM_RAISED.crop(0, 0, 2, 6).flipX(), 13, 9 + dy, O), at(SHIELD_BACK, 1, 13 + dy, O)] };
    default: return { mid: [at(armHang(5, false), 12, 13 + dy)], front: [sh] };
  }
}

function rightArms(arm: ArmPose, dy: number): ArmLayers {
  const sh = at(SHIELD_SIDE, 10, 14 + dy, O);
  switch (arm) {
    case 'fwd': return { mid: [sh], front: [at(ARM_R_FWD, 7, 13 + dy, O)] };
    case 'back': return { mid: [sh], front: [at(ARM_R_BACK, 6, 13 + dy, O)] };
    case 'wind': return { back: [at(ARM_R_WIND, 3, 1 + dy)], mid: [sh] };
    case 'slash': return { mid: [sh], front: [at(ARM_R_SLASH, 7, 13 + dy, O)] };
    case 'thrust': case 'use': return { mid: [sh], front: [at(ARM_R_THRUST, 7, 14 + dy, O)] };
    case 'push': return { mid: [at(SHIELD_SIDE, 11, 14 + dy, O)], front: [at(ARM_R_PUSH, 8, 13 + dy, O)] };
    case 'raise': return { back: [at(ARM_RAISED.flipX(), 10, 4 + dy)], front: [at(ARM_RAISED, 6, 4 + dy, O)] };
    case 'hurt': return { back: [at(ARM_R_BACK.flipY(), 3, 11 + dy)], front: [at(SHIELD_SIDE, 11, 15 + dy, O)] };
    default: return { mid: [sh], front: [at(ARM_R_HANG, 7, 13 + dy, O)] };
  }
}

interface Opts {
  dx?: number;
  dy?: number;
  face?: Face;
}

function pose(f: Facing, arm: ArmPose, legs: Legs, o: Opts = {}): Pose {
  const dy = o.dy ?? 0;
  const arms = f === 'up' ? upArms(arm, dy) : f === 'right' ? rightArms(arm, dy) : downArms(arm, dy);
  return { ...o, legs, ...arms };
}

/** One outlined hero frame. */
function hero(f: Facing, arm: ArmPose, legs: Legs, o: Opts = {}): PixelGrid {
  return compose(W, H, layers(f, pose(f, arm, legs, o)), O);
}

// ============================================================================
// Special frames: swim, fall, die
// ============================================================================

const WATER = 19;
/** Stroking arm reaching out along the surface (hand at the outer end), left side; mirrored for the right. */
const SWIM_ARM = pix(['ssgG', 'sSGg'], L);

/**
 * Swimming: head and shoulders above the waterline, the arms stroking out along the surface in turn (the
 * side view reaches forward, then recovers under water), a foam line at the waterline and a ripple ring
 * that spreads between the two frames.
 */
function swim(f: Facing, phase: 0 | 1): PixelGrid {
  const body = layers(f, { dy: 4, legs: 'none' });
  const arm = f === 'right'
    ? (phase === 0 ? at(SWIM_ARM.flipX(), 11, WATER - 2, O) : null)
    : at(phase === 0 ? SWIM_ARM : SWIM_ARM.flipX(), phase === 0 ? 1 : 11, WATER - 2, O);
  const g = compose(W, H, [...body, arm]);
  g.fill(0, WATER, W, H - WATER, 0);
  outlineFill(g, O);
  g.fill(0, WATER, W, H - WATER, 0);
  let left = W;
  let right = -1;
  for (let x = 0; x < W; x++) {
    if (g.get(x, WATER - 1) === 0) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  for (let x = left; x <= right; x++) if ((x + phase) % 4 !== 0) g.set(x, WATER, L.W);
  // Splash where the stroking hand meets the water; the ring spreads outward on the second frame.
  const splash: readonly (readonly [number, number])[] = f === 'right'
    ? (phase === 0 ? [[15, WATER - 1], [14, WATER - 3]] : [[2, WATER - 1], [3, WATER - 2]])
    : phase === 0 ? [[0, WATER - 3], [1, WATER - 4]] : [[15, WATER - 3], [14, WATER - 4]];
  const ripple: readonly (readonly [number, number])[] = phase === 0
    ? [[left - 1, WATER + 1], [right + 1, WATER + 1], [5, WATER + 2], [10, WATER + 2]]
    : [[left - 2, WATER + 1], [left - 1, WATER + 2], [right + 2, WATER + 1], [right + 1, WATER + 2], [4, WATER + 3], [11, WATER + 3]];
  for (const [x, y] of [...splash, ...ripple]) if (g.get(x, y) === 0) g.set(x, y, L.W);
  return g;
}

/** Fall, first frame: arms flung up as the legs drop out of sight into the pit. */
function fallStart(): PixelGrid {
  return compose(W, H, layers('down', { dy: 3, legs: 'none', face: 'shut', ...raisedArms(3) }), O);
}

const FALL_MID = pix([
  '....cccc.W',
  '...cgcccWw',
  '..cgccccC.',
  '..CCCCCCC.',
  'ssHhhhhhHs',
  'sSHoshosHS',
  '.gSssssSg.',
  '.gGglggGg.',
  '..GbyybG..',
  '..GggggG..',
  '...B..B...',
], L);

const FALL_SMALL = pix([
  '..ccc.W',
  '.cgccW.',
  '.CCCCC.',
  'sHoshos',
  '.gSssg.',
  '..GbG..',
  '..B.B..',
], L);

function fallFrame(i: 0 | 1 | 2): PixelGrid {
  if (i === 0) return fallStart();
  const g = new PixelGrid(W, H);
  if (i === 1) g.blit(FALL_MID, 3, 11);
  else g.blit(FALL_SMALL, 4, 14);
  return g.outline(O);
}

/** Slumped on the knees, eyes shut (same cap as the standing hero). */
const DIE_KNEEL = pix([
  ...CAP_DOWN.map((r) => `..${r}..`),
  '..HhhhhHhhhhhH..',
  '..HhhshhhshhhH..',
  '..HhssssssssSH..',
  '..HhoosssoosSH..',
  '...SsssssssS....',
  '....SssssssS....',
  '...sGglggggGs...',
  '...sGgllgggGsS..',
  '....BbbyybBBS...',
  '...GGglggggGG...',
  '..bBGgggggggGBb.',
  '..BBBBBBBBBBBBB.',
], L);

/** Collapsed face-down on the ground, boots to the left and head to the right. */
const DIE_LYING = pix([
  '......cccccWw.',
  '.BBGGgggccccW.',
  'bbBGgllgCCCCCC',
  'bBBBbyGgHhhhhH',
  '.BBGggggHssoSH',
  '....ssGGGSSsH.',
], L);

function dieFrame(i: 0 | 1): PixelGrid {
  const g = new PixelGrid(W, H);
  if (i === 0) g.blit(DIE_KNEEL, 0, 6);
  else g.blit(DIE_LYING, 1, 17);
  return g.outline(O);
}

// ============================================================================
// Public: sprite + sword anchors
// ============================================================================

/**
 * Where the hand holding the sword is on each attack frame, relative to the
 * hero's origin (entity position), and which fx.sword anim to draw there.
 * `behind` = draw the blade before the hero sprite.
 */
export interface SwordPose {
  dx: number;
  dy: number;
  blade: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  behind: boolean;
}

/** Attack-frame sword placement per facing (3 entries = the 3 attack_* frames: windup, slash, thrust). */
export const HERO_SWORD_POSES: Readonly<Record<'down' | 'up' | 'right' | 'left', readonly SwordPose[]>> = {
  down: [
    { dx: -6, dy: -3, blade: 'w', behind: false },
    { dx: -6, dy: -1, blade: 'sw', behind: false },
    { dx: -3, dy: 2, blade: 's', behind: false },
  ],
  up: [
    { dx: 6, dy: -4, blade: 'e', behind: true },
    { dx: 7, dy: -11, blade: 'ne', behind: true },
    { dx: 3, dy: -15, blade: 'n', behind: true },
  ],
  right: [
    { dx: -4, dy: -16, blade: 'n', behind: true },
    { dx: 5, dy: -4, blade: 'ne', behind: true },
    { dx: 6, dy: -3, blade: 'e', behind: false },
  ],
  left: [
    { dx: 4, dy: -16, blade: 'n', behind: true },
    { dx: -5, dy: -4, blade: 'nw', behind: true },
    { dx: -6, dy: -3, blade: 'w', behind: false },
  ],
};

const FACINGS: readonly Facing[] = ['down', 'up', 'right'];

/** Walk cycle: contact, passing (1px up), opposite contact, passing. */
function walk(f: Facing): PixelGrid[] {
  const pass = hero(f, 'rest', 'stand', { dy: -1 });
  return [hero(f, 'fwd', 'stepA'), pass, hero(f, 'back', 'stepB'), pass];
}

/** Carry: arms overhead while walking; the side view alternates a stride with a 1px-high passing pose. */
function carry(f: Facing): PixelGrid[] {
  return f === 'right'
    ? [hero(f, 'raise', 'stepA'), hero(f, 'raise', 'stand', { dy: -1 })]
    : [hero(f, 'raise', 'stepA'), hero(f, 'raise', 'stepB', { dy: -1 })];
}

/** Push: braced legs; the side view leans into the block and steps the rear foot. */
function push(f: Facing): PixelGrid[] {
  return f === 'right'
    ? [hero(f, 'push', 'pushA', { dx: 1, dy: 1 }), hero(f, 'push', 'pushB', { dx: 1 })]
    : [hero(f, 'push', 'braceA', { dy: 1 }), hero(f, 'push', 'braceB', { dy: 1 })];
}

export function buildHero(): SpriteDef {
  const b = new SpriteBuilder('hero', PAL.hero);
  for (const f of FACINGS) {
    b.anim(`idle_${f}`, [hero(f, 'rest', 'stand')]);
    b.anim(`walk_${f}`, walk(f));
    b.anim(`attack_${f}`, [hero(f, 'wind', 'stand'), hero(f, 'slash', 'braceA', { dy: 1 }), hero(f, 'thrust', 'braceA', { dy: 1 })]);
    b.anim(`push_${f}`, push(f));
    b.anim(`lift_${f}`, [hero(f, 'raise', 'stand')]);
    b.anim(`carry_${f}`, carry(f));
    b.anim(`swim_${f}`, [swim(f, 0), swim(f, 1)]);
    b.anim(`use_${f}`, [hero(f, 'use', 'braceA', { dy: 1 })]);
    b.anim(`hurt_${f}`, [hero(f, 'hurt', 'braceB', { dy: -1, face: 'shut' })]);
  }
  b.anim('item_get', [hero('down', 'raise', 'stand', { dy: -1, face: 'happy' })]);
  b.anim('fall', [fallFrame(0), fallFrame(1), fallFrame(2)]);
  b.anim('die', [dieFrame(0), dieFrame(1)]);
  return b.build();
}
