// The four 13-piece autotile terrains (deep water, dirt path, pit, plateau)
// and shallow water. Each piece is painted per pixel from the shared geometry
// in tiles-autotile.ts, so borders, corners and notches line up exactly; the
// outside ground is copied from the neighbouring ground tile at the same
// coordinates, so the blob blends into the surrounding GRASS / DFLOOR.
import { PixelGrid } from './pixelgrid';
import {
  FACE, OUT, PIECES, classifyBands, sdfNormal, terrainSdf, type BandHit, type BandWidths, type PieceShape,
} from './tiles-autotile';
import { dungeonFloor } from './tiles-dungeon';
import { grassTile, sandTile } from './tiles-ground';
import { ROCK_STYLE, rockCells, rockGrain, rockPixel } from './tiles-mountain';
import {
  art, bayer, memoField, paintTile, remap, scatter, seeded, tileNoise, wset, wstamp, type Cells, type Field,
  type PainterTable, type TileArt,
} from './tiles-kit';
import { DUN, EARTH, G, GRASS_SHADE, MOUNT, PAL, SAND, SHALLOW, WATER } from './tiles-palettes';

const WATER_FRAMES = 4;
const WATER_FRAME_TIME = 0.25;

/** Outside-band depth and convex/concave corner radii (px) of an organic terrain edge. */
interface EdgeStyle { depth: number; round: number; notch: number }

const SHORE: EdgeStyle = { depth: 4, round: 4, notch: 2.5 };
const PATH_EDGE = { depth: 3, round: 4, notch: 2.5, wobble: 2 } as const;
const PIT_EDGE = 3;

/** 16-periodic integer wobble (-1..1, at most 1 px change per px) so rims and shores are not ruler-straight. */
const rimJag = (phase: number) => (t: number): number =>
  Math.round(Math.sin((2 * Math.PI * t) / 16 + phase) * 0.8 + Math.sin((4 * Math.PI * t) / 16 + phase * 2) * 0.5);

const SHORE_JAG_X = rimJag(0.7);
const SHORE_JAG_Y = rimJag(2.6);

/** Register all 13 pieces of a terrain under `<base><suffix>` keys. */
function terrainSet(base: string, paint: (shape: PieceShape) => TileArt): PainterTable {
  const table: PainterTable = {};
  PIECES.forEach(([suffix, shape]) => {
    table[base + suffix] = () => paint(shape);
  });
  return table;
}

// ---------------------------------------------------------------------------
// Deep water
// ---------------------------------------------------------------------------

/** A wave crest on open water: start, length and its phase in the 4-frame loop. */
interface Crest { x: number; y: number; len: number; phase: number }

/**
 * Crests scattered irregularly over the (wrapping) tile, with different lengths
 * and phases, so a pond shimmers without showing a 16 px lattice.
 */
const CRESTS: readonly Crest[] = [
  { x: 1, y: 1, len: 4, phase: 0 },
  { x: 10, y: 3, len: 5, phase: 2 },
  { x: 5, y: 7, len: 3, phase: 1 },
  { x: 13, y: 9, len: 4, phase: 3 },
  { x: 2, y: 12, len: 5, phase: 2 },
  { x: 9, y: 14, len: 3, phase: 0 },
];

/** Per-frame sideways sway and length change of a crest (a 4-frame loop). */
const CREST_SWAY = [0, 1, 2, 1] as const;
const CREST_SWELL = [0, 1, 0, -1] as const;

/**
 * Open deep water for one animation frame: calm mid blue with short wave
 * crests (lit line over a darker trough) that sway sideways and swell on their
 * own phase; a crest catches a foam glint at its peak.
 */
function waterSurface(frame: number): PixelGrid {
  const g = new PixelGrid(16, 16, WATER.W2);
  for (const c of CRESTS) {
    const s = (frame + c.phase) % 4;
    const x0 = c.x + CREST_SWAY[s];
    const len = c.len + CREST_SWELL[s];
    for (let i = 0; i < len; i++) wset(g, x0 + i, c.y, s === 1 && i === 1 ? WATER.FOAM : WATER.W3);
    for (let i = 1; i < len; i++) wset(g, x0 + i, c.y + 1, WATER.W1);
  }
  return g;
}

/**
 * Shore geometry of deep water: the rounded SDF plus a 16-periodic integer
 * wobble that runs along the shore (x on horizontal shores, y on vertical
 * ones), so a shore steps by at most 1 px and never frays. `base` is the
 * unwobbled field, whose normal is exact on straight shores.
 */
function shoreField(shape: PieceShape, edge: EdgeStyle): { base: Field; sdf: Field } {
  const base: Field = memoField((x, y) => terrainSdf(shape, x, y, edge.depth, edge.round, edge.notch), 3);
  const sdf: Field = memoField((x, y) => {
    const [nx, ny] = sdfNormal(base, x, y);
    return base(x, y) + Math.round(SHORE_JAG_X(x) * ny * ny + SHORE_JAG_Y(y) * nx * nx);
  });
  return { base, sdf };
}

const NEIGHBOURS_8: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** True where any 8-neighbour lies outside the terrain (keeps a stepped outline 4-connected). */
const touchesOutside = (sdf: Field, x: number, y: number): boolean => NEIGHBOURS_8.some(([dx, dy]) => sdf(x + dx, y + dy) < 0);

function waterPiece(shape: PieceShape, surfaces: readonly PixelGrid[], grass: PixelGrid): TileArt {
  const { base, sdf } = shoreField(shape, SHORE);
  // Static shore classification, shared by every frame (0 = open water).
  const shoreIdx = paintTile((x, y) => {
    const d = sdf(x, y);
    const [, ny] = sdfNormal(base, x, y);
    if (d < 0) return d >= -1 && ny < -0.5 ? G.LT : grass.get(x, y);
    if (d < 1 || touchesOutside(sdf, x, y)) return WATER.OUT;
    // The far (north) shore shows its earth bank; side and near shores do not.
    const bank = ny > 0.3 ? ny * 2.4 : 0;
    if (d < 1 + bank) return d < 1 + bank * 0.45 ? WATER.BANK1 : WATER.BANK0;
    const w = d - 1 - bank;
    if (w < 1) return WATER.FOAM;
    if (w < 2) return bayer(x, y) < 0.5 ? WATER.FOAM : WATER.W3;
    if (w < 3.2) return bayer(x, y) < 0.35 ? WATER.W3 : 0;
    return 0;
  });
  const frames = surfaces.map((surf) => paintTile((x, y) => shoreIdx.get(x, y) || surf.get(x, y)));
  return art(PAL.water, frames, WATER_FRAME_TIME);
}

function waterSet(): PainterTable {
  const surfaces = Array.from({ length: WATER_FRAMES }, (_, f) => waterSurface(f));
  const grass = grassTile();
  return terrainSet('WATER', (shape) => waterPiece(shape, surfaces, grass));
}

// ---------------------------------------------------------------------------
// Shallow water
// ---------------------------------------------------------------------------

/** An open caustic arc drifting over the shallow bed (hex 3 = light caustic). */
interface Caustic { rows: readonly string[]; x: number; y: number; phase: number }

const CAUSTICS: readonly Caustic[] = [
  { rows: ['.3333', '3....'], x: 1, y: 3, phase: 0 },
  { rows: ['333.', '...3'], x: 9, y: 8, phase: 2 },
  { rows: ['.333', '3...'], x: 3, y: 13, phase: 1 },
];

/**
 * Shallow water: the rippled sand bed (the SAND tile seen through the water,
 * so a beach runs on under it) is the base; a few short open caustic arcs
 * drift sideways and glint at their peak.
 */
function shallowWater(): TileArt {
  const bed = remap(sandTile(), {
    [SAND.S0]: SHALLOW.W2, [SAND.S1]: SHALLOW.B0, [SAND.S2]: SHALLOW.B1, [SAND.S3]: SHALLOW.B2,
    [SAND.S4]: SHALLOW.B3, [SAND.SHELL]: SHALLOW.B2,
  });
  const frames = Array.from({ length: WATER_FRAMES }, (_, f) => {
    const g = bed.clone();
    for (const c of CAUSTICS) {
      const s = (f + c.phase) % 4;
      wstamp(g, c.rows, c.x + CREST_SWAY[s], c.y, { 3: s === 1 ? SHALLOW.FOAM : SHALLOW.B3 });
    }
    return g;
  });
  return art(PAL.shallow, frames, 0.3);
}

// ---------------------------------------------------------------------------
// Dirt path
// ---------------------------------------------------------------------------

/** Worn light path surface: an even tone with small scattered light patches and grit (no feature over 3 px, so wide paths do not grid). */
function pathSurface(): PixelGrid {
  const rng = seeded('terrain.path');
  const g = new PixelGrid(16, 16, EARTH.E3);
  const patches: readonly (readonly string[])[] = [['33', '3.'], ['.3', '33'], ['33'], ['3', '3']];
  for (const [x, y] of scatter(rng, 6, 5)) wstamp(g, rng.pick(patches), Math.floor(x), Math.floor(y), { 3: EARTH.P3 });
  const grit: readonly (readonly string[])[] = [['4'], ['4', '2'], ['2'], ['42'], ['2'], ['1']];
  for (const [x, y] of scatter(rng, 10, 3.4)) {
    wstamp(g, rng.pick(grit), Math.floor(x), Math.floor(y), { 4: EARTH.P4, 2: EARTH.E2, 1: EARTH.E1 });
  }
  return g;
}

function pathPiece(shape: PieceShape, surface: PixelGrid, grass: PixelGrid, edge: Field): TileArt {
  const sdf = memoField((x: number, y: number): number =>
    terrainSdf(shape, x, y, PATH_EDGE.depth, PATH_EDGE.round, PATH_EDGE.notch) + (edge(x, y) - 0.5) * PATH_EDGE.wobble);
  return art(PAL.earth, [paintTile((x, y) => {
    const d = sdf(x, y);
    if (d < -0.8) return grass.get(x, y);
    const [, ny] = sdfNormal(sdf, x, y);
    // Ragged grass fringe dithered over the path edge.
    if (d < 0.6) return bayer(x, y) < 0.5 - d * 0.6 ? G.DK : d < 0 ? G.MID : EARTH.E1;
    if (d < 1.6) return ny > 0.3 ? EARTH.E1 : EARTH.E2;
    if (d < 2.4 && ny > 0.3) return bayer(x, y) < 0.5 ? EARTH.E2 : surface.get(x, y);
    return surface.get(x, y);
  })]);
}

function pathSet(): PainterTable {
  const surface = pathSurface();
  const grass = grassTile();
  const edge = tileNoise(seeded('terrain.path.edge'), 4);
  return terrainSet('PATH', (shape) => pathPiece(shape, surface, grass, edge));
}

// ---------------------------------------------------------------------------
// Pit
// ---------------------------------------------------------------------------

/**
 * Inner wall of a pit below its lip: the far (north) wall shows two courses of
 * dark floor brick sinking into the void; the side walls show a dark sliver;
 * the near wall is hidden.
 */
function pitWall(d: number, x: number, y: number, nx: number, ny: number): number {
  if (ny > 0.5) {
    const row = Math.floor(d);
    if (row === 0 || row === 3) return DUN.OUT;
    if (row > 5) return DUN.VOID;
    if (row === 5) return bayer(x, y) < 0.5 ? DUN.OUT : DUN.VOID;
    const joint = ((x + (row > 3 ? 4 : 0)) & 7) === 0;
    if (joint) return DUN.OUT;
    return row === 1 ? DUN.D2 : row === 2 ? DUN.D1 : DUN.D0;
  }
  const face = Math.abs(nx) * 2.5;
  if (d >= face) return DUN.VOID;
  return d < 1 ? DUN.D0 : bayer(x, y) < 0.5 ? DUN.OUT : DUN.VOID;
}

function pitPiece(shape: PieceShape, floor: PixelGrid): TileArt {
  const sdf = memoField((x: number, y: number): number => terrainSdf(shape, x, y, PIT_EDGE, 0, 0));
  return art(PAL.dungeon, [paintTile((x, y) => {
    const d = sdf(x, y);
    const [nx, ny] = sdfNormal(sdf, x, y);
    if (d < -1) return floor.get(x, y);
    // Worn stone lip, lit all round (a touch darker on the near side).
    if (d < 0) return ny < -0.5 ? DUN.D3 : DUN.D4;
    if (ny < -0.5) return d < 1 ? DUN.OUT : DUN.VOID;
    return pitWall(d, x, y, nx, ny);
  })]);
}

function pitSet(): PainterTable {
  const floor = dungeonFloor();
  return terrainSet('PIT', (shape) => pitPiece(shape, floor));
}

// ---------------------------------------------------------------------------
// Plateau (cliff)
// ---------------------------------------------------------------------------

/**
 * Cliff bands: only a rocky rim shows on the north (its face looks away from
 * the viewer), 5 px side faces on the east and west, and a tall south face
 * over a 2 px strip of shadowed ground at its foot.
 */
const PLATEAU_BANDS: BandWidths = {
  out: { n: 1, s: 2, e: 3, w: 1 },
  face: { n: 3, s: 11, e: 5, w: 5 },
  jag: { n: rimJag(1.3), s: rimJag(0.2), e: rimJag(2.1), w: rimJag(3.4) },
};

/** Rock face of a cliff side: the shared rock chunks, lit per the side's facing (the west face is lit, the east shaded). */
function cliffFace(hit: BandHit, x: number, y: number, cells: Cells, grain: Field): number {
  const { side, fromRim, fromBase } = hit;
  if (fromBase === 0) return MOUNT.OUT;
  if (side === 'n') return fromRim === 0 ? MOUNT.R4 : MOUNT.R1;
  if (fromRim === 0) return side === 'e' ? MOUNT.R3 : MOUNT.R4;
  if (side === 's' && fromBase === 1) return MOUNT.R0;
  const light = side === 's' ? 0.12 - (0.4 * fromRim) / (fromRim + fromBase) : side === 'e' ? -0.32 : 0.2;
  return rockPixel(cells, grain, x, y, { ...ROCK_STYLE, light });
}

/**
 * The plateau bands with the faces widened by `k` px, so a pixel in a face band
 * lies within k px of a face (`south` = false leaves the south face as is).
 */
function widened(k: number, south = true): BandWidths {
  const f = PLATEAU_BANDS.face;
  return { ...PLATEAU_BANDS, face: { n: f.n + k, s: f.s + (south ? k : 0), e: f.e + k, w: f.w + k } };
}

/** Share of the top's mid grass lit at 2, 3 and 4 px from a (non-south) rim: the sunlit edge fades out inward. */
const RIM_GLOW = [0.75, 0.5, 0.25] as const;
const LIP_BANDS = widened(1);
const GLOW_BANDS = RIM_GLOW.map((_, k) => widened(k + 2, false));
/** The top's dark grass shades, one step lighter inside the sunlit edge. */
const GLOW_LIGHTER: Readonly<Record<number, number>> = { [G.SH]: G.DK, [G.DK]: G.MID };

/** Ground at the foot of a south face: shaded, fading out over the 2 px strip. */
function footShadow(shaded: PixelGrid, grass: PixelGrid, x: number, y: number, fromBase: number): number {
  return (fromBase === -1 || bayer(x, y) < 0.5 ? shaded : grass).get(x, y);
}

/**
 * The plateau top: a bright lip along every rim, and sunlit grass fading inward
 * from the north, east and west rims so the raised edge reads; the middle
 * stays exactly GRASS, so grass-based objects placed on a plateau sit on
 * matching ground. (The south rim only gets the lip: its face leaves just 3 px
 * of top in the tile, too little to fade out before the tile above.)
 */
function plateauTop(shape: PieceShape, grass: PixelGrid, x: number, y: number): number {
  if (classifyBands(shape, LIP_BANDS, x, y).band === FACE) return G.HI;
  const c = grass.get(x, y);
  const k = GLOW_BANDS.findIndex((bands) => classifyBands(shape, bands, x, y).band === FACE);
  if (k < 0) return c;
  if (c === G.MID) return bayer(x, y) < RIM_GLOW[k]! ? G.LT : c;
  return GLOW_LIGHTER[c] ?? c;
}

function plateauPiece(shape: PieceShape, grass: PixelGrid, cells: Cells, grain: Field): TileArt {
  const shaded = remap(grass.clone(), GRASS_SHADE);
  return art(PAL.mount, [paintTile((x, y) => {
    const hit = classifyBands(shape, PLATEAU_BANDS, x, y);
    if (hit.band === OUT) {
      // The south face and the east face (light from the top-left) shade the ground hugging their foot.
      if (hit.side === 's') return footShadow(shaded, grass, x, y, hit.fromBase);
      return (hit.side === 'e' && hit.fromBase >= -2 ? shaded : grass).get(x, y);
    }
    if (hit.band === FACE) return cliffFace(hit, x, y, cells, grain);
    return plateauTop(shape, grass, x, y);
  })]);
}

function plateauSet(): PainterTable {
  const grass = grassTile();
  const cells = rockCells();
  const grain = rockGrain();
  return terrainSet('PLATEAU', (shape) => plateauPiece(shape, grass, cells, grain));
}

/** Terrain painters by tile key. */
export function terrainPainters(): PainterTable {
  return {
    ...waterSet(),
    SHALLOW_WATER: () => shallowWater(),
    ...pathSet(),
    ...pitSet(),
    ...plateauSet(),
  };
}
