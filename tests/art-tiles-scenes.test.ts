// Realistic 16x14-tile scenes composed from the default tileset, rendered at 2x
// to e2e-out/sheets/scene-*.png for visual review (skipped unless QF_SHEETS=1):
//   QF_SHEETS=1 npx vitest run tests/art-tiles-scenes.test.ts
// Scenes: village meadow, cliffs & cave, dungeon room, house interior, cave.
// Animated tiles are rendered at frame 0 and 1 (scene-*-f1.png) to check sync.
import { describe, it } from 'vitest';
import { buildTileArt } from '../src/content/art/tiles';
import { buildTerrains } from '../src/content/art/index';
import { T } from '../src/content/ids';
import type { Terrain } from '../src/core/types';
import { renderScene, writePng } from './tools/png';

const OUT = 'e2e-out/sheets';
const W = 16;
const H = 14;

type Layer = number[];
interface Scene { bg: Layer; fg: Layer; over: Layer }

const id = (key: string): number => {
  const v = T[key];
  if (v === undefined) throw new Error(`unknown tile ${key}`);
  return v;
};

function blank(bg = 0): Scene {
  return { bg: new Array<number>(W * H).fill(bg), fg: new Array<number>(W * H).fill(0), over: new Array<number>(W * H).fill(0) };
}

/** Pieces of a 13-part set by name (terrain or wall family). */
type Pieces = Pick<Terrain, 'center' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'ine' | 'inw' | 'ise' | 'isw'>;

/** Same precedence as core/autotile.ts: outer corners, edges, inner corners, centre. Off-map counts as inside. */
function autotile(inside: (x: number, y: number) => boolean, p: Pieces, x: number, y: number): number {
  const at = (dx: number, dy: number): boolean => {
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || ny < 0 || nx >= W || ny >= H || inside(nx, ny);
  };
  const n = at(0, -1), s = at(0, 1), e = at(1, 0), w = at(-1, 0);
  if (!n && !e) return p.ne;
  if (!n && !w) return p.nw;
  if (!s && !e) return p.se;
  if (!s && !w) return p.sw;
  if (!n) return p.n;
  if (!s) return p.s;
  if (!w) return p.w;
  if (!e) return p.e;
  if (!at(1, -1)) return p.ine;
  if (!at(-1, -1)) return p.inw;
  if (!at(1, 1)) return p.ise;
  if (!at(-1, 1)) return p.isw;
  return p.center;
}

function paintBlob(layer: Layer, inside: (x: number, y: number) => boolean, p: Pieces): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) layer[y * W + x] = autotile(inside, p, x, y);
}

/** Room walls: the wall mass is the "terrain"; keys map the 13 parts to DWALL_/IWALL_ tiles. */
function wallPieces(prefix: string): Pieces {
  const k = (name: string): number => id(`${prefix}_${name}`);
  const fill = prefix === 'DWALL' ? k('FILL') : 0;
  return {
    center: fill, s: k('TOP'), n: k('BOTTOM'), e: k('LEFT'), w: k('RIGHT'),
    ise: k('TL'), isw: k('TR'), ine: k('BL'), inw: k('BR'),
    nw: prefix === 'DWALL' ? k('OTL') : k('BOTTOM'), ne: prefix === 'DWALL' ? k('OTR') : k('BOTTOM'),
    sw: prefix === 'DWALL' ? k('OBL') : k('TOP'), se: prefix === 'DWALL' ? k('OBR') : k('TOP'),
  };
}

const put = (layer: Layer, x: number, y: number, key: string): void => {
  layer[y * W + x] = id(key);
};

function tree(s: Scene, x: number, y: number): void {
  put(s.over, x, y, 'TREE_TL');
  put(s.over, x + 1, y, 'TREE_TR');
  put(s.fg, x, y + 1, 'TREE_BL');
  put(s.fg, x + 1, y + 1, 'TREE_BR');
}

function terrain(name: string): Pieces {
  const t = buildTerrains().find((tr) => tr.id === name);
  if (!t) throw new Error(`terrain ${name}`);
  return t;
}

// ---------------------------------------------------------------------------

function village(): Scene {
  const s = blank(id('GRASS'));
  for (const [x, y] of [[1, 1], [9, 2], [14, 6], [3, 11], [10, 0], [6, 7], [13, 10]]) put(s.bg, x!, y!, 'GRASS_ALT');
  // House: roof 5x3 over a front row with windows and a door.
  const roof = ['ROOF_TL', 'ROOF_T', 'ROOF_T', 'ROOF_T', 'ROOF_TR'];
  for (let i = 0; i < 5; i++) {
    put(s.bg, 2 + i, 1, roof[i]!);
    put(s.bg, 2 + i, 2, i === 0 ? 'ROOF_L' : i === 4 ? 'ROOF_R' : 'ROOF_M');
    put(s.bg, 2 + i, 3, i === 0 ? 'ROOF_BL' : i === 4 ? 'ROOF_BR' : 'ROOF_B');
    put(s.bg, 2 + i, 4, ['HOUSE_WALL', 'HOUSE_WINDOW', 'HOUSE_DOOR', 'HOUSE_WINDOW', 'HOUSE_WALL'][i]!);
  }
  // Dirt path from the door, turning east, with a branch south over the pond bridge.
  const path = (x: number, y: number): boolean =>
    (x >= 3 && x <= 5 && y >= 5 && y <= 9) || (y >= 8 && y <= 9 && x >= 3) || (x >= 8 && x <= 10 && y === 13);
  paintBlob(s.bg, path, terrain('path'));
  // Pond with a vertical bridge.
  const pond = (x: number, y: number): boolean =>
    y >= 10 && y <= 12 && x >= 5 && x <= 13 && !(x === 5 && y === 10) && !(x >= 12 && y === 12);
  paintBlob(s.bg, pond, terrain('water'));
  for (let y = 10; y <= 12; y++) put(s.fg, 9, y, 'BRIDGE_V');
  // Fence along the garden.
  put(s.fg, 8, 5, 'FENCE_POST');
  for (let x = 9; x <= 13; x++) put(s.fg, x, 5, 'FENCE_H');
  put(s.fg, 14, 5, 'FENCE_POST');
  put(s.fg, 14, 6, 'FENCE_V');
  put(s.fg, 14, 7, 'FENCE_POST');
  tree(s, 12, 1);
  tree(s, 0, 5);
  tree(s, 14, 10);
  put(s.fg, 10, 2, 'TREE_SMALL');
  for (const [x, y] of [[8, 3], [9, 3], [10, 6], [11, 6], [12, 7], [1, 10], [2, 11], [7, 1]]) put(s.bg, x!, y!, 'FLOWERS');
  for (const [x, y] of [[7, 3], [1, 3], [0, 8], [13, 3], [1, 12]]) put(s.fg, x!, y!, 'BUSH');
  put(s.fg, 15, 8, 'ROCK');
  put(s.fg, 7, 6, 'STUMP');
  put(s.bg, 11, 7, 'PEBBLES');
  for (const [x, y] of [[3, 12], [3, 13], [4, 13], [2, 13]]) put(s.bg, x!, y!, 'TALL_GRASS');
  return s;
}

function cliffs(): Scene {
  const s = blank(id('GRASS'));
  // Mountain wall across the top with a cave mouth and a cracked (bombable) section.
  for (let x = 0; x < W; x++) for (let y = 0; y <= 2; y++) put(s.bg, x, y, 'MOUNTAIN_ROCK');
  for (const x of [0, 1, 14, 15]) put(s.bg, x, 3, 'MOUNTAIN_ROCK');
  put(s.bg, 7, 2, 'CAVE_ENTRANCE');
  put(s.bg, 11, 2, 'CRACKED_ROCKWALL');
  for (let x = 4; x <= 11; x++) for (let y = 3; y <= 4; y++) put(s.bg, x, y, 'MOUNTAIN_GROUND');
  put(s.bg, 3, 3, 'MOUNTAIN_GROUND');
  put(s.bg, 12, 3, 'MOUNTAIN_GROUND');
  // Raised plateau with cliff stairs cut into its south face.
  const plateau = (x: number, y: number): boolean => x >= 1 && x <= 6 && y >= 6 && y <= 10 && !(x >= 5 && y >= 10);
  paintBlob(s.bg, plateau, terrain('plateau'));
  put(s.bg, 3, 10, 'CLIFF_STAIRS');
  // A ledge you can hop down, and a side ledge.
  for (let x = 9; x <= 15; x++) put(s.bg, x, 7, 'LEDGE_S');
  for (let y = 8; y <= 10; y++) put(s.bg, 8, y, 'LEDGE_W');
  put(s.bg, 8, 7, 'LEDGE_S');
  // Dirt path from the cave down the middle.
  const path = (x: number, y: number): boolean => x >= 7 && x <= 8 && y >= 5 && y <= 13 && !(x === 8 && y >= 7 && y <= 10);
  paintBlob(s.bg, path, terrain('path'));
  put(s.bg, 12, 9, 'GRASS_DARK');
  put(s.fg, 10, 9, 'ROCK');
  put(s.fg, 13, 9, 'HEAVY_ROCK');
  put(s.fg, 11, 11, 'ROCK');
  put(s.bg, 12, 12, 'PEBBLES');
  put(s.bg, 14, 12, 'HOLE');
  put(s.bg, 10, 13, 'STAIRS_DOWN');
  put(s.fg, 2, 7, 'STATUE');
  put(s.fg, 4, 7, 'BUSH');
  put(s.fg, 13, 4, 'GRAVESTONE');
  put(s.fg, 2, 4, 'BUSH');
  put(s.fg, 5, 12, 'STUMP');
  tree(s, 0, 11);
  put(s.bg, 15, 5, 'STONE_PATH');
  put(s.bg, 14, 5, 'STONE_PATH');
  return s;
}

function dungeon(): Scene {
  const s = blank(id('DFLOOR'));
  const floor = (x: number, y: number): boolean =>
    (x >= 2 && x <= 13 && y >= 2 && y <= 11) || (x >= 7 && x <= 8 && y <= 1) ||
    (x <= 1 && y >= 6 && y <= 7) || (x >= 7 && x <= 8 && y >= 12);
  paintBlob(s.bg, (x, y) => !floor(x, y), wallPieces('DWALL'));
  for (let y = 0; y <= 6; y++) for (const x of [7, 8]) if (floor(x, y)) put(s.bg, x, y, 'CARPET');
  const pit = (x: number, y: number): boolean => x >= 9 && x <= 12 && y >= 7 && y <= 9 && !(x === 12 && y === 7);
  paintBlob(s.bg, pit, terrain('pit'));
  for (let x = 3; x <= 5; x++) put(s.bg, x, 10, 'SPIKES');
  put(s.bg, 3, 9, 'SPIKES');
  put(s.fg, 3, 3, 'DSTATUE');
  put(s.fg, 12, 3, 'DSTATUE');
  put(s.fg, 5, 3, 'PILLAR');
  put(s.fg, 10, 3, 'PILLAR');
  put(s.fg, 12, 11, 'DPOT');
  put(s.fg, 13, 11, 'DPOT');
  put(s.fg, 13, 10, 'DPOT');
  put(s.fg, 5, 7, 'DBLOCK');
  put(s.bg, 13, 5, 'DSTAIRS_DOWN');
  put(s.bg, 2, 2, 'DSTAIRS_UP');
  for (let y = 5; y <= 6; y++) for (let x = 3; x <= 5; x++) put(s.bg, x, y, 'DFLOOR_TILE');
  put(s.bg, 7, 8, 'DFLOOR_ORNATE');
  put(s.bg, 8, 8, 'DFLOOR_ORNATE');
  put(s.bg, 10, 5, 'DFLOOR_CRACKED');
  put(s.bg, 0, 3, 'CRACKED_WALL');
  return s;
}

function interior(): Scene {
  const s = blank(0);
  const room = (x: number, y: number): boolean => x >= 2 && x <= 13 && y >= 1 && y <= 12;
  const floor = (x: number, y: number): boolean => x >= 3 && x <= 12 && y >= 2 && y <= 11;
  paintBlob(s.bg, (x, y) => room(x, y) && !floor(x, y) ? true : !room(x, y) ? true : false, wallPieces('IWALL'));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!room(x, y)) s.bg[y * W + x] = 0;
  for (let y = 2; y <= 11; y++) for (let x = 3; x <= 12; x++) put(s.bg, x, y, 'WOOD_FLOOR');
  put(s.bg, 5, 1, 'IWALL_WINDOW');
  put(s.bg, 10, 1, 'IWALL_WINDOW');
  put(s.bg, 7, 12, 'EXIT_MAT');
  put(s.bg, 8, 12, 'EXIT_MAT');
  put(s.fg, 4, 2, 'BED_TOP');
  put(s.fg, 4, 3, 'BED_BOTTOM');
  put(s.fg, 7, 2, 'FIREPLACE');
  put(s.bg, 6, 3, 'STONE_FLOOR');
  put(s.bg, 7, 3, 'STONE_FLOOR');
  put(s.bg, 8, 3, 'STONE_FLOOR');
  put(s.fg, 11, 2, 'SHELF');
  put(s.fg, 12, 2, 'SHELF');
  put(s.fg, 8, 6, 'TABLE');
  put(s.fg, 7, 6, 'STOOL');
  put(s.fg, 9, 6, 'STOOL');
  for (let x = 6; x <= 10; x++) for (let y = 8; y <= 9; y++) put(s.bg, x, y, 'RUG');
  put(s.fg, 3, 11, 'IPOT');
  put(s.fg, 4, 11, 'IPOT');
  put(s.fg, 12, 10, 'BARREL');
  put(s.fg, 12, 11, 'CRATE');
  put(s.fg, 11, 11, 'CRATE');
  return s;
}

function cave(): Scene {
  const s = blank(id('CAVE_WALL'));
  const floor = (x: number, y: number): boolean =>
    (x >= 3 && x <= 12 && y >= 3 && y <= 10) || (x >= 6 && x <= 8 && y >= 11) || (x >= 12 && x <= 14 && y >= 5 && y <= 7);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (floor(x, y)) put(s.bg, x, y, 'CAVE_FLOOR');
  put(s.bg, 7, 13, 'CAVE_EXIT');
  put(s.fg, 4, 4, 'CAVE_ROCKS');
  put(s.fg, 11, 9, 'CAVE_ROCKS');
  put(s.fg, 10, 4, 'CAVE_ROCKS');
  const pit = (x: number, y: number): boolean => x >= 6 && x <= 8 && y >= 5 && y <= 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pit(x, y)) put(s.bg, x, y, 'STONE_FLOOR');
  put(s.bg, 13, 6, 'SHALLOW_WATER');
  put(s.bg, 14, 6, 'SHALLOW_WATER');
  put(s.bg, 13, 5, 'SHALLOW_WATER');
  put(s.fg, 5, 9, 'CAVE_ROCKS');
  return s;
}

/** Cut a sub-rectangle (in tiles) out of a scene. */
function crop(s: Scene, x0: number, y0: number, w: number, h: number): Scene {
  const pick = (layer: Layer): Layer => {
    const out: Layer = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(layer[y * W + x] ?? 0);
    return out;
  };
  return { bg: pick(s.bg), fg: pick(s.fg), over: pick(s.over) };
}

/** 4x close-ups of the joins that matter most (scene, x, y, w, h in tiles). */
const CLOSE_UPS: readonly (readonly [string, number, number, number, number])[] = [
  ['village', 1, 0, 7, 6],
  ['village', 4, 8, 8, 6],
  ['cliffs', 0, 4, 8, 7],
  ['dungeon', 0, 0, 8, 7],
  ['dungeon', 8, 5, 8, 9],
  ['interior', 1, 0, 8, 6],
];

describe.skipIf(!process.env.QF_SHEETS)('tile scenes', () => {
  const { tiles, palettes } = buildTileArt();
  const scenes: Record<string, () => Scene> = { village, cliffs, dungeon, interior, cave };
  for (const [name, make] of Object.entries(scenes)) {
    it(name, () => {
      const s = make();
      for (const frame of [0, 1]) {
        const r = renderScene(tiles, palettes, s, W, H, 2, frame);
        writePng(`${OUT}/scene-${name}${frame ? '-f1' : ''}.png`, r);
      }
    });
  }
  it('close-ups', () => {
    CLOSE_UPS.forEach(([name, x, y, w, h], i) => {
      const s = crop(scenes[name]!(), x, y, w, h);
      writePng(`${OUT}/scene-zoom-${i}-${name}.png`, renderScene(tiles, palettes, s, w, h, 4));
    });
  });
});
