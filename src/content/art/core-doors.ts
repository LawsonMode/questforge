// Dungeon doors (obj.doorNS 32x16, obj.doorEW 16x32), fully opaque so they
// replace the wall tiles they sit on. The background is painted from the real
// DWALL_* tiles of the default dungeon tileset (recoloured into pal.c.stone,
// whose wall colours are copied from the tile palette), so a cracked door is
// indistinguishable from wall until it is bombed. Every variant is authored
// once for the TOP wall (_up) and flipped/rotated onto the other walls.
import type { SpriteDef } from '../../core/types';
import { Rng, hashSeed } from '../../core/rng';
import { PixelGrid } from './pixelgrid';
import { pix, SpriteBuilder } from './core-draw';
import { PAL, dungeonToStoneLut } from './core-palettes';
import { ST } from './core-objects';
import { dungeonPainters } from './tiles-dungeon';

const { o: OUT, K, D, M, L, H, V, w: WOOD_D, u: WOOD, Y: GOLD_D, y: GOLD, X: WHITE } = ST;

type Wall = 'up' | 'down' | 'left' | 'right';
type Kind = 'open' | 'locked' | 'bigKey' | 'shutter' | 'cracked' | 'bombed';
const KINDS: readonly Kind[] = ['open', 'locked', 'bigKey', 'shutter', 'cracked', 'bombed'];

// ============================================================================
// Wall backgrounds (the dungeon wall tiles themselves)
// ============================================================================

/** The wall tile each door replaces (two of them side by side / stacked). */
const WALL_TILE: Readonly<Record<Wall, string>> = {
  up: 'DWALL_TOP', down: 'DWALL_BOTTOM', left: 'DWALL_LEFT', right: 'DWALL_RIGHT',
};

/** Two copies of the wall tile for each wall, recoloured into pal.c.stone. */
function wallBackgrounds(walls: readonly Wall[]): Map<Wall, PixelGrid> {
  const painters = dungeonPainters();
  const lut = dungeonToStoneLut();
  return new Map(walls.map((w) => {
    const key = WALL_TILE[w];
    const paint = painters[key];
    if (!paint) throw new Error(`door art: the dungeon tileset has no ${key} tile`);
    const tile = paint(new Rng(hashSeed(`tile.${key}`))).frames[0]!.clone().map((_x, _y, v) => lut[v] ?? M);
    const horizontal = w === 'up' || w === 'down';
    const g = horizontal ? new PixelGrid(32, 16) : new PixelGrid(16, 32);
    return [w, g.blit(tile, 0, 0).blit(tile, horizontal ? 16 : 0, horizontal ? 0 : 16)];
  }));
}

// ============================================================================
// Door overlays, authored for the top wall (32x16, opening faces down)
// ============================================================================

const VOID_X = 7;
const VOID_Y = 5;
const VOID_W = 18;

/** Stone arch: keystone, lintel and two jambs around an empty doorway. */
function arch(): PixelGrid {
  const g = new PixelGrid(32, 16);
  // Outline around the frame.
  g.fill(1, 0, 30, 16, OUT);
  // Lintel.
  g.fill(2, 1, 28, 4, M);
  g.fill(2, 1, 28, 1, H);
  g.fill(2, 4, 28, 1, D);
  for (const x of [9, 22]) g.fill(x, 2, 1, 2, K);
  // Jambs.
  for (const [x0, lit] of [[2, true], [25, false]] as const) {
    g.fill(x0, 1, 5, 15, M);
    g.fill(x0, 1, 5, 1, H);
    g.fill(lit ? x0 : x0 + 4, 2, 1, 14, lit ? L : D);
    g.fill(lit ? x0 + 4 : x0, 5, 1, 11, lit ? D : L);
    for (const y of [8, 12]) g.fill(x0 + 1, y, 3, 1, K);
  }
  // Keystone.
  g.fill(13, 0, 6, 5, OUT);
  g.fill(14, 0, 4, 4, L);
  g.fill(14, 0, 4, 1, H).fill(17, 1, 1, 3, D);
  // Doorway with rounded top corners.
  g.fill(VOID_X, VOID_Y, VOID_W, 11, V);
  g.set(VOID_X, VOID_Y, D).set(VOID_X + VOID_W - 1, VOID_Y, L);
  g.fill(VOID_X + 1, 14, VOID_W - 2, 2, K);
  g.fill(VOID_X + 1, 15, VOID_W - 2, 1, D);
  return g;
}

/** Plank door with iron bands (the keyhole plate is stamped upright later). */
function lockedLeaf(g: PixelGrid): void {
  g.fill(VOID_X, VOID_Y, VOID_W, 11, WOOD);
  for (const x of [11, 16, 20]) g.fill(x, VOID_Y, 1, 11, WOOD_D);
  for (const y of [7, 13]) {
    g.fill(VOID_X, y, VOID_W, 1, K);
    g.fill(VOID_X, y - 1, VOID_W, 1, M);
  }
}

/** Ornate big-key door: dark wood panel inside a gold border. */
function bigKeyLeaf(g: PixelGrid): void {
  g.fill(VOID_X, VOID_Y, VOID_W, 11, WOOD_D);
  g.fill(VOID_X + 1, VOID_Y + 1, VOID_W - 2, 9, WOOD);
  g.rect(VOID_X, VOID_Y, VOID_W, 11, GOLD);
  g.fill(VOID_X, VOID_Y + 10, VOID_W, 1, GOLD_D);
  g.set(VOID_X + 2, VOID_Y + 2, WHITE);
}

const KEYHOLE_PLATE = pix([
  'yyyY',
  'yVVY',
  'yVVY',
  'yyVY',
  'YYYY',
], ST);

const BIG_KEY_EMBLEM = pix([
  '...yy...',
  '..yyyY..',
  '.yyRRYY.',
  'yyRXRRYY',
  'yyRRRRYY',
  '.yYRRYY.',
  '..yVVY..',
  '...VV...',
], ST);

/** Iron portcullis bars over the dark doorway. */
function shutterLeaf(g: PixelGrid): void {
  for (let x = VOID_X + 1; x < VOID_X + VOID_W - 1; x += 3) {
    g.fill(x, VOID_Y, 1, 10, L);
    g.fill(x + 1, VOID_Y, 1, 10, D);
    g.set(x, VOID_Y + 10, M);
  }
  g.fill(VOID_X, 8, VOID_W, 2, M);
  g.fill(VOID_X, 8, VOID_W, 1, H);
  g.fill(VOID_X, 10, VOID_W, 1, K);
}

const CRACK = pix([
  '....VV......',
  '.....VL.....',
  '.....VV.....',
  '......VL....',
  '.....VV.....',
  '....VL.V....',
  '....V...VVL.',
  '...VVL......',
  '...VL.......',
  '..VL........',
  '..VV........',
], ST);

/** Ragged blast hole through the wall face, open to the floor (1 = hole). */
const BLAST_HOLE = [
  '.....11..111.1....',
  '...11111111111111.',
  '..1111111111111111',
  '.11111111111111111',
  '.1111111111111111.',
  '11111111111111111.',
  '11111111111111111.',
  '.1111111111111111.',
  '.11111111111111111',
  '111111111111111111',
  '111111111111111111',
];

/** Broken stone chunk and a fallen brick, lit from the top-left. */
const RUBBLE_CHUNK = pix(['.oo.', 'oHLo', 'oLDo', '.oo.'], ST);
const RUBBLE_BRICK = pix(['.oooo.', 'oHLLLo', 'oLMMDo', '.oooo.'], ST);

/** Blasted opening: a void hole with a dark broken rim, stone chunks around it and fallen bricks below. */
function bombedHole(g: PixelGrid): void {
  const hole = new PixelGrid(18, 11).map((x, y) => (BLAST_HOLE[y]![x] === '1' ? V : 0));
  const rim = hole.clone().outline(OUT);
  g.blit(rim, 7, 5).blit(hole, 7, 5);
  for (const [x, y] of [[4, 7], [25, 6], [6, 13], [23, 9]] as const) g.blit(RUBBLE_CHUNK, x, y);
  g.blit(RUBBLE_BRICK, 9, 12).blit(RUBBLE_BRICK, 18, 12);
}

interface DoorParts {
  /** Arch + leaf, authored for the top wall. */
  overlay: PixelGrid | null;
  /** Marks painted straight onto the wall (crack / blast hole), authored for the top wall. */
  mark?: (g: PixelGrid) => void;
  /** Detail stamped upright at the leaf centre after orienting (keyholes must not rotate). */
  badge?: PixelGrid;
}

/** The top-wall version of a door. */
function doorUp(kind: Kind): DoorParts {
  switch (kind) {
    case 'cracked': return { overlay: null, mark: (g) => g.blit(CRACK, 10, 5) };
    case 'bombed': return { overlay: null, mark: bombedHole };
    default: {
      const a = arch();
      if (kind === 'locked') lockedLeaf(a);
      if (kind === 'bigKey') bigKeyLeaf(a);
      if (kind === 'shutter') shutterLeaf(a);
      const badge = kind === 'locked' ? KEYHOLE_PLATE : kind === 'bigKey' ? BIG_KEY_EMBLEM : undefined;
      return badge ? { overlay: a, badge } : { overlay: a };
    }
  }
}

/** Centre of the door leaf per wall (the doorway sits on the room side). */
const LEAF_CENTRE: Readonly<Record<Wall, readonly [number, number]>> = {
  up: [16, 10], down: [16, 6], right: [6, 16], left: [10, 16],
};

/** Map a top-wall grid onto another wall orientation. */
function orient(g: PixelGrid, w: Wall): PixelGrid {
  switch (w) {
    case 'down': return g.flipY();
    case 'right': return g.rotateCW();
    case 'left': return g.rotateCW().flipX();
    default: return g;
  }
}

function door(kind: Kind, w: Wall, background: PixelGrid): PixelGrid {
  const { overlay, mark, badge } = doorUp(kind);
  const g = background.clone();
  if (mark) {
    const marks = new PixelGrid(32, 16);
    mark(marks);
    g.blit(orient(marks, w), 0, 0);
  }
  if (overlay) g.blit(orient(overlay, w), 0, 0);
  if (badge) {
    const [cx, cy] = LEAF_CENTRE[w];
    g.blit(badge, cx - Math.floor(badge.w / 2), cy - Math.floor(badge.h / 2));
  }
  return g;
}

function buildDoor(id: 'obj.doorNS' | 'obj.doorEW', walls: readonly [Wall, Wall]): SpriteDef {
  const b = new SpriteBuilder(id, PAL.stone);
  const backgrounds = wallBackgrounds(walls);
  for (const kind of KINDS) for (const w of walls) b.anim(`${kind}_${w}`, [door(kind, w, backgrounds.get(w)!)]);
  return b.build();
}

export function buildDoorNS(): SpriteDef {
  return buildDoor('obj.doorNS', ['up', 'down']);
}

export function buildDoorEW(): SpriteDef {
  return buildDoor('obj.doorEW', ['left', 'right']);
}
