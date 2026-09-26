// Objects standing on the meadow (bushes, rocks, stumps, fences, graves,
// statues, holes, ledges) and trees. Grass-based objects are painted on a
// transparent layer, outlined, and composited over the shared GRASS tile with a
// soft cast shadow toward the bottom-right (light comes from the top-left).
import { clamp } from '../../core/math';
import { PixelGrid } from './pixelgrid';
import {
  art, composite, rampAt, seeded, slice, sphereLight, stamp, tileNoise, type Field, type PainterTable,
} from './tiles-kit';
import { grassTile } from './tiles-ground';
import { EARTH, G, GRASS_SHADE, MEADOW, PAL, ROCK, TREE, WOOD } from './tiles-palettes';

// ---------------------------------------------------------------------------
// Shared shape helpers
// ---------------------------------------------------------------------------

/** A leafy clump: centre and radius. Later clumps are nearer the viewer. */
type Clump = readonly [cx: number, cy: number, r: number];

/**
 * Paint overlapping sphere-shaded clumps (foliage). Each pixel mixes the
 * clump's own light with the whole mass's light so the silhouette reads as one
 * rounded form built of lobes.
 */
function paintClumps(
  g: PixelGrid, clumps: readonly Clump[], ramp: readonly number[],
  mass: readonly [cx: number, cy: number, r: number], leaf: Field,
): PixelGrid {
  const [mx, my, mr] = mass;
  for (const [cx, cy, r] of clumps) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const nx = (x + 0.5 - cx) / r;
        const ny = (y + 0.5 - cy) / r;
        if (nx * nx + ny * ny > 1) continue;
        const local = sphereLight(nx, ny);
        const whole = sphereLight((x + 0.5 - mx) / mr, (y + 0.5 - my) / mr);
        const edge = nx * nx + ny * ny > 0.72 && ny > -0.2 ? -0.18 : 0;
        const v = local * 0.5 + whole * 0.6 - 0.12 + edge + (leaf(x, y) - 0.5) * 0.28;
        g.set(x, y, rampAt(v, ramp, x, y, 0.55));
      }
    }
  }
  return g;
}

/** Grass tile with `obj` composited and a cast shadow. */
function onGrass(obj: PixelGrid, contact?: readonly [number, number, number, number]): PixelGrid {
  return composite(grassTile(), obj, { lut: GRASS_SHADE, dx: 1, dy: 1, ...(contact ? { ellipse: contact } : {}) });
}

// ---------------------------------------------------------------------------
// Bush, rocks, stump
// ---------------------------------------------------------------------------

function bush(): PixelGrid {
  const leaf = tileNoise(seeded('nature.bush'), 8);
  const obj = new PixelGrid(16, 16);
  const clumps: Clump[] = [
    [5, 6, 3.6], [10.5, 5.5, 3.8], [8, 4.5, 3.4], [3.8, 9.5, 3.3],
    [12.2, 9.5, 3.3], [8, 9, 4.6], [5.8, 11, 3.2], [10.4, 11, 3.2],
  ];
  paintClumps(obj, clumps, [MEADOW.B0, MEADOW.B1, MEADOW.B2, MEADOW.B3], [7.5, 7.5, 7], leaf);
  obj.outline(MEADOW.OUT);
  return onGrass(obj, [8.5, 13.2, 6.5, 2.2]);
}

/**
 * Faceted boulder: hard-banded sphere light reads as chiselled planes. `boxy`
 * (> 2) flattens the outline toward a squarer, heavier block.
 */
function boulder(
  obj: PixelGrid, cx: number, cy: number, rx: number, ry: number, ramp: readonly number[], flatBottom: number,
  jag: Field, boxy = 2,
): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.abs(nx) ** boxy + Math.abs(ny) ** boxy + (jag(x, y) - 0.5) * 0.25;
      if (d > 1 || y > flatBottom) continue;
      // Quantise the normal into facets before lighting.
      const fx = Math.round(nx * 2.2) / 2.2;
      const fy = Math.round(ny * 2.2) / 2.2;
      obj.set(x, y, rampAt(sphereLight(fx, fy) * 1.08 - 0.04, ramp, x, y, 0.25));
    }
  }
}

function rock(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  boulder(obj, 7.8, 8.8, 6.1, 5.3, [ROCK.S0, ROCK.S1, ROCK.S2, ROCK.S3, ROCK.S4], 13, tileNoise(seeded('nature.rock'), 8));
  stamp(obj, ['1..', '.1.', '.11'], 8, 7, { 1: ROCK.S1 });
  obj.set(4, 6, ROCK.S4).set(5, 5, ROCK.S4);
  obj.outline(ROCK.OUT);
  return onGrass(obj, [8.5, 13.5, 6.5, 1.8]);
}

/** A big dark boulder filling the tile: squarer, flatter-topped and split by fissures, with a heavy shadow. */
function heavyRock(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  const jag = tileNoise(seeded('nature.heavy-rock'), 8);
  boulder(obj, 7.5, 7.9, 6.9, 6.5, [ROCK.OUT, ROCK.H0, ROCK.H1, ROCK.H2, ROCK.S2], 14, jag, 2.6);
  // Deep fissures split the mass into slabs.
  stamp(obj, ['1...', '.1..', '.1..', '..11', '...1'], 6, 3, { 1: ROCK.OUT });
  stamp(obj, ['11..', '..1.', '...1'], 9, 9, { 1: ROCK.OUT });
  obj.set(2, 4, ROCK.S3).set(3, 3, ROCK.S3).set(4, 2, ROCK.S2).set(5, 2, ROCK.S2);
  obj.outline(ROCK.OUT);
  return onGrass(obj, [8.5, 14.5, 8, 1.8]);
}

function stump(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  // Bark body (cylinder), flaring roots.
  for (let y = 6; y <= 13; y++) {
    const flare = y >= 11 ? y - 10 : 0;
    for (let x = 3 - flare; x <= 12 + flare; x++) {
      const nx = (x + 0.5 - 7.5) / (5 + flare);
      const bark = (x * 5 + (y >> 1)) % 4 === 0 ? -0.18 : 0;
      obj.set(x, y, rampAt(sphereLight(nx, -0.1) + bark, [WOOD.W0, WOOD.W1, WOOD.W2, WOOD.W3], x, y, 0.4));
    }
  }
  // Cut face with growth rings.
  for (let y = 2; y <= 9; y++) {
    for (let x = 2; x <= 13; x++) {
      const nx = (x + 0.5 - 7.5) / 5.6;
      const ny = (y + 0.5 - 6) / 3.4;
      const d = Math.hypot(nx, ny);
      if (d > 1) continue;
      const ring = d > 0.82 ? WOOD.W3 : Math.round(d * 5) % 2 === 1 ? WOOD.RING : WOOD.CUT;
      obj.set(x, y, ring);
    }
  }
  obj.set(7, 6, WOOD.W2).set(8, 6, WOOD.RING);
  stamp(obj, ['1.', '.1'], 9, 4, { 1: WOOD.W2 });
  // A patch of moss on the shaded side of the bark.
  stamp(obj, ['.e', 'ee', '.e'], 11, 9, { 0xe: WOOD.MOSS });
  obj.outline(WOOD.OUT);
  return onGrass(obj, [8.5, 13.6, 7, 1.8]);
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

/** A fence post spanning columns x..x+4 (outline, three lit-to-shaded wood columns, outline) and rows y0..y1. */
function post(obj: PixelGrid, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    obj.set(x, y, WOOD.OUT).set(x + 1, y, WOOD.W3).set(x + 2, y, WOOD.W2).set(x + 3, y, WOOD.W1).set(x + 4, y, WOOD.OUT);
  }
  obj.set(x + 1, y0, WOOD.W4).set(x + 2, y0, WOOD.W4).set(x + 3, y0, WOOD.W3);
  obj.set(x + 1, y0 - 1, WOOD.OUT).set(x + 2, y0 - 1, WOOD.OUT).set(x + 3, y0 - 1, WOOD.OUT);
  obj.set(x + 2, y1 - 2, WOOD.W1).set(x + 2, y1 - 5, WOOD.W1);
  for (let xx = x; xx <= x + 4; xx++) obj.set(xx, y1 + 1, WOOD.OUT);
}

/** A horizontal rail across the whole tile at y (2 px tall + outline). */
function railH(obj: PixelGrid, y: number): void {
  for (let x = 0; x < 16; x++) {
    obj.set(x, y - 1, WOOD.OUT).set(x, y, x % 8 === 3 ? WOOD.W3 : WOOD.W4).set(x, y + 1, WOOD.W2).set(x, y + 2, WOOD.OUT);
  }
}

function fenceH(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  railH(obj, 5);
  railH(obj, 9);
  post(obj, 5, 3, 13);
  return onGrass(obj);
}

function fenceV(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  // Side-on rails: a continuous bar running through the tile.
  for (let y = 0; y < 16; y++) obj.set(6, y, WOOD.OUT).set(7, y, WOOD.W3).set(8, y, WOOD.W2).set(9, y, WOOD.OUT);
  post(obj, 5, 5, 13);
  return onGrass(obj);
}

function fencePost(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  post(obj, 5, 4, 13);
  return onGrass(obj, [8.5, 14.6, 3.5, 1.2]);
}

// ---------------------------------------------------------------------------
// Grave, statue
// ---------------------------------------------------------------------------

function gravestone(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  const ramp = [ROCK.S0, ROCK.S1, ROCK.S2, ROCK.S3, ROCK.S4];
  for (let y = 2; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const inArch = y >= 7 || Math.hypot(x + 0.5 - 8, y + 0.5 - 7) <= 5;
      if (!inArch) continue;
      const nx = (x + 0.5 - 8) / 5;
      const ny = y < 7 ? (y + 0.5 - 7) / 5 : 0.1;
      obj.set(x, y, rampAt(sphereLight(nx * 0.9, ny * 0.8), ramp, x, y, 0.3));
    }
  }
  // Engraved cross (dark cut with a lit lower lip).
  stamp(obj, ['.1.', '111', '.1.', '.1.'], 7, 5, { 1: ROCK.S1 });
  stamp(obj, ['...', '...', '2.2', '.2.', '.2.'], 7, 5, { 2: ROCK.S3 });
  // Plinth.
  for (let x = 2; x <= 13; x++) {
    obj.set(x, 13, x < 5 ? ROCK.S2 : ROCK.S1).set(x, 12, obj.get(x, 12) || ROCK.S2);
  }
  obj.outline(ROCK.OUT);
  return onGrass(obj, [9, 14.4, 7, 1.4]);
}

/** Stone owl guardian on a plinth (o outline, 1-5 stone ramp dark -> light). */
const OWL = [
  '................',
  '...oo......oo...',
  '...o4oooooo3o...',
  '..o4444433332o..',
  '..o4oo433oo22o..',
  '..o4o5o33o5o2o..',
  '..o44o3113o22o..',
  '..o4433oo3221o..',
  '...o43333221o...',
  '..o4o433221o1o..',
  '..o4o332211o1o..',
  '..o3o322111o1o..',
  '.o555555555554o.',
  '.o433333333332o.',
  '.o322222222221o.',
  '.oooooooooooooo.',
];

function statue(): PixelGrid {
  const obj = PixelGrid.rows(OWL, { o: ROCK.OUT, 1: ROCK.S0, 2: ROCK.S1, 3: ROCK.S2, 4: ROCK.S3, 5: ROCK.S4 });
  return onGrass(obj);
}

// ---------------------------------------------------------------------------
// Hole, ledges
// ---------------------------------------------------------------------------

function hole(): PixelGrid {
  const out = grassTile();
  const [cx, cy] = [7.5, 8];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ox = (x + 0.5 - cx) / 6.8;
      const oy = (y + 0.5 - cy) / 5.8;
      const outer = ox * ox + oy * oy;
      if (outer > 1) continue;
      const ix = (x + 0.5 - cx) / 5.2;
      const iy = (y + 0.5 - (cy + 0.6)) / 4.2;
      if (ix * ix + iy * iy > 1) {
        // Earthy rim: lit on the far (top-left) lip, shaded near the bottom-right.
        const lit = sphereLight(ox, oy);
        out.set(x, y, y > cy + 2 ? EARTH.E3 : lit > 0.55 ? EARTH.E1 : EARTH.E2);
        continue;
      }
      // Inside: the far wall shows as a dark earth face fading into the void.
      const top = cy + 0.6 - 4.2 * Math.sqrt(Math.max(0, 1 - ix * ix));
      const depth = y + 0.5 - top;
      out.set(x, y, depth < 1.2 ? EARTH.E0 : depth < 2.6 ? EARTH.HOLE : EARTH.VOID);
    }
  }
  return out;
}

/** Periodic wobble for ledge lips (period 16 px). */
const wobble = (t: number): number =>
  Math.round(Math.sin((2 * Math.PI * t) / 16) * 0.7 + Math.sin((4 * Math.PI * t) / 16 + 1) * 0.5);

/**
 * Ledge with its drop on one side. Painted for the 'down' orientation along a
 * run (u = along the run, v = toward the drop) and mapped to the other sides.
 */
function ledge(side: 'down' | 'up' | 'left' | 'right'): PixelGrid {
  const out = grassTile();
  const face = side === 'down' ? 6 : side === 'up' ? 3 : 4;
  // Faces turned toward the light (left, up) use the lighter earth; the tall south face the full ramp.
  const lit = side === 'left' || side === 'up';
  const ramp = lit ? [EARTH.E1, EARTH.E2, EARTH.E3]
    : side === 'down' ? [EARTH.E0, EARTH.E1, EARTH.E2, EARTH.E3] : [EARTH.E0, EARTH.E1, EARTH.E2];
  for (let u = 0; u < 16; u++) {
    const lip = 16 - face + wobble(u);
    for (let v = lip - 1; v < 16; v++) {
      const [x, y] = side === 'down' ? [u, v] : side === 'up' ? [u, 15 - v] : side === 'right' ? [v, u] : [15 - v, u];
      if (v === lip - 1) {
        out.set(x, y, G.HI);
        continue;
      }
      const k = (v - lip) / Math.max(1, 15 - lip);
      const stria = (u * 3 + (v >> 1)) % 5 === 0 ? 1 : 0;
      const shade = side === 'down' ? 1 - k : lit ? 0.9 - k * 0.5 : 0.8 - k * 0.6;
      const idx = clamp(Math.round(shade * (ramp.length - 1)) - stria, 0, ramp.length - 1);
      out.set(x, y, v === 15 && side === 'down' ? EARTH.OUT : ramp[idx]!);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

const LEAVES = [TREE.L0, TREE.L1, TREE.L2, TREE.L3, TREE.L4];

/** Small regular leaf flecks (a diagonal lattice) so foliage reads as leaves rather than a smooth ball. */
const leafPattern: Field = (x, y) => ((x * 5 + y * 3) % 7) / 7;

/** One round 32x32 tree: canopy of leafy lobes over a short trunk with roots. */
function bigTree(): PixelGrid {
  const g32 = new PixelGrid(32, 32);
  // Trunk and roots first (the canopy overlaps the top of the trunk).
  for (let y = 19; y <= 30; y++) {
    const flare = y >= 27 ? (y - 26) * 1.2 : 0;
    const x0 = Math.round(11.5 - flare);
    const x1 = Math.round(20.5 + flare);
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - 16) / (5 + flare);
      const bark = (x * 7 + y) % 5 === 0 || (x * 3 + (y >> 1)) % 7 === 0 ? -0.2 : 0;
      g32.set(x, y, rampAt(sphereLight(nx, -0.2) + bark, [TREE.T0, TREE.T1, TREE.T2, TREE.T3], x, y, 0.4));
    }
  }
  for (let x = 12; x <= 19; x++) g32.set(x, 19, TREE.T0).set(x, 20, TREE.T0);
  const clumps: Clump[] = [
    [10, 8, 6.5], [21, 7.5, 6.8], [15.5, 5, 6.5],
    [6.5, 13.5, 6], [25, 13.5, 6], [15.5, 11, 8.5],
    [10, 18, 6.2], [21.5, 18, 6.2], [15.5, 19, 6],
  ];
  paintClumps(g32, clumps, LEAVES, [15, 11.5, 15], leafPattern);
  g32.outline(TREE.OUT);
  // Root outline + contact shadow.
  for (let x = 9; x <= 22; x++) if (!g32.get(x, 31)) g32.set(x, 31, TREE.OUT);
  return groundShadow(g32, 17, 30.2, 11, 2.4);
}

/**
 * A checker-dithered contact shadow on the empty pixels of an ellipse around
 * a trunk's base: half of the ground shows through, so it darkens whatever
 * ground the tree stands on (grass, dirt or sand).
 */
function groundShadow(g: PixelGrid, cx: number, cy: number, rx: number, ry: number): PixelGrid {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1 && !g.get(x, y) && ((x + y) & 1) === 0) g.set(x, y, TREE.OUT);
    }
  }
  return g;
}

function smallTree(): PixelGrid {
  const obj = new PixelGrid(16, 16);
  for (let y = 10; y <= 14; y++) {
    for (let x = 6; x <= 9; x++) obj.set(x, y, x === 6 ? TREE.T2 : x === 9 ? TREE.T0 : TREE.T1);
  }
  obj.set(5, 14, TREE.T1).set(10, 14, TREE.T0);
  paintClumps(obj, [[5, 5.5, 3.6], [10.5, 5.5, 3.6], [8, 3.8, 3.6], [8, 8, 4.4]], LEAVES, [7.8, 6.2, 6.5], leafPattern);
  obj.outline(TREE.OUT);
  return groundShadow(obj, 8.5, 14.6, 6, 1.6);
}

/** Nature painters by tile key. */
export function naturePainters(): PainterTable {
  const tree = slice(bigTree());
  return {
    BUSH: () => art(PAL.meadow, [bush()]),
    ROCK: () => art(PAL.rock, [rock()]),
    HEAVY_ROCK: () => art(PAL.rock, [heavyRock()]),
    STUMP: () => art(PAL.wood, [stump()]),
    FENCE_H: () => art(PAL.wood, [fenceH()]),
    FENCE_V: () => art(PAL.wood, [fenceV()]),
    FENCE_POST: () => art(PAL.wood, [fencePost()]),
    GRAVESTONE: () => art(PAL.rock, [gravestone()]),
    STATUE: () => art(PAL.rock, [statue()]),
    HOLE: () => art(PAL.earth, [hole()]),
    LEDGE_S: () => art(PAL.earth, [ledge('down')]),
    LEDGE_N: () => art(PAL.earth, [ledge('up')]),
    LEDGE_E: () => art(PAL.earth, [ledge('right')]),
    LEDGE_W: () => art(PAL.earth, [ledge('left')]),
    TREE_TL: () => art(PAL.tree, [tree[0]!]),
    TREE_TR: () => art(PAL.tree, [tree[1]!]),
    TREE_BL: () => art(PAL.tree, [tree[2]!]),
    TREE_BR: () => art(PAL.tree, [tree[3]!]),
    TREE_SMALL: () => art(PAL.tree, [smallTree()]),
  };
}

