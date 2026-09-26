// Engine test project ('test'): a compact overworld (2x2 one-screen rooms plus a
// 2x1 room, all connected) showing every movement surface — grass, paths,
// deep & shallow water, a bridge, trees with canopies, walls, a ledge band,
// a hole, tall grass — and a two-room dungeon (one dark) linked by warps.
// Used by e2e scenarios (#/playtest/test, #/play/test). OWNER: engine agent.
import type { EntityInstance, LayerName, Project, Room, Terrain, WarpTarget, World } from '../core/types';
import { PROJECT_FORMAT, PROJECT_VERSION, SCREEN_COLS } from '../core/constants';
import { createRoom, createWorld, defaultSettings } from '../core/project';
import { paintTerrain } from '../core/autotile';
import { buildTerrains, createDefaultAssets } from './art';
import { T } from './ids';

export const TEST_PROJECT_ID = 'test';

/** Tile id for a key (throws on typos so the layout never silently breaks). */
function tid(key: string): number {
  const id = T[key];
  if (id === undefined) throw new Error(`testProject: unknown tile key ${key}`);
  return id;
}

type Side = 'n' | 's' | 'e' | 'w';

let terrains: Terrain[] | null = null;

/** Default terrain by id (throws on typos). */
function defaultTerrain(id: string): Terrain {
  terrains ??= buildTerrains();
  const t = terrains.find((x) => x.id === id);
  if (!t) throw new Error(`testProject: unknown terrain ${id}`);
  return t;
}

/** Small painting helper over one room's layers (tile coordinates). */
class Paint {
  readonly room: Room;
  private readonly cols: number;
  private readonly rows: number;

  constructor(room: Room) {
    this.room = room;
    this.cols = room.gw * SCREEN_COLS;
    this.rows = room.layers.bg.length / this.cols;
  }

  set(layer: LayerName, tx: number, ty: number, key: string): this {
    if (tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows) this.room.layers[layer][ty * this.cols + tx] = tid(key);
    return this;
  }

  fill(layer: LayerName, x: number, y: number, w: number, h: number, key: string): this {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.set(layer, tx, ty, key);
    return this;
  }

  /** 2x2 tree: canopy on 'over' (walk behind it), solid lower half (trunk row) on 'fg'. */
  tree(tx: number, ty: number): this {
    return this.set('over', tx, ty, 'TREE_TL').set('over', tx + 1, ty, 'TREE_TR')
      .set('fg', tx, ty + 1, 'TREE_BL').set('fg', tx + 1, ty + 1, 'TREE_BR');
  }

  /** Autotile-style rectangle of a 13-piece terrain placed piece by piece; `open` sides get no border. */
  terrain(base: string, x: number, y: number, w: number, h: number, open: Partial<Record<Side, boolean>> = {}): this {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const n = ty === y && !open.n;
        const s = ty === y + h - 1 && !open.s;
        const wEdge = tx === x && !open.w;
        const e = tx === x + w - 1 && !open.e;
        const v = n ? 'N' : s ? 'S' : '';
        const hz = e ? 'E' : wEdge ? 'W' : '';
        this.set('bg', tx, ty, v || hz ? `${base}_${v}${hz}` : base);
      }
    }
    return this;
  }

  /**
   * Terrain painted over the union of rects and autotiled like the editor brush
   * (core/autotile): junctions get proper inner corners, room edges stay open.
   */
  autotile(terrainId: string, rects: [x: number, y: number, w: number, h: number][]): this {
    const cells: { tx: number; ty: number }[] = [];
    for (const [x, y, w, h] of rects) {
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) cells.push({ tx, ty });
    }
    paintTerrain(this.room, defaultTerrain(terrainId), cells);
    return this;
  }

  /** Solid border along one room side on 'fg', leaving [from, to] (inclusive tile ranges) open. */
  border(side: Side, key: string, gaps: [number, number][] = []): this {
    const len = side === 'n' || side === 's' ? this.cols : this.rows;
    for (let i = 0; i < len; i++) {
      if (gaps.some(([a, b]) => i >= a && i <= b)) continue;
      if (side === 'n') this.set('fg', i, 0, key);
      else if (side === 's') this.set('fg', i, this.rows - 1, key);
      else if (side === 'w') this.set('fg', 0, i, key);
      else this.set('fg', this.cols - 1, i, key);
    }
    return this;
  }

  scatter(key: string, cells: [number, number][]): this {
    for (const [tx, ty] of cells) this.set('bg', tx, ty, key);
    return this;
  }

  /** Classic dungeon room walls on bg with openings (tile ranges per side). */
  dungeonWalls(gaps: Partial<Record<Side, [number, number]>> = {}): this {
    const lastX = this.cols - 1;
    const lastY = this.rows - 1;
    const open = (side: Side, i: number): boolean => {
      const g = gaps[side];
      return g !== undefined && i >= g[0] && i <= g[1];
    };
    for (let tx = 1; tx < lastX; tx++) {
      this.set('bg', tx, 0, open('n', tx) ? 'DFLOOR' : 'DWALL_TOP');
      this.set('bg', tx, lastY, open('s', tx) ? 'DFLOOR' : 'DWALL_BOTTOM');
    }
    for (let ty = 1; ty < lastY; ty++) {
      this.set('bg', 0, ty, open('w', ty) ? 'DFLOOR' : 'DWALL_LEFT');
      this.set('bg', lastX, ty, open('e', ty) ? 'DFLOOR' : 'DWALL_RIGHT');
    }
    return this.set('bg', 0, 0, 'DWALL_TL').set('bg', lastX, 0, 'DWALL_TR')
      .set('bg', 0, lastY, 'DWALL_BL').set('bg', lastX, lastY, 'DWALL_BR');
  }
}

function warpMarker(id: string, x: number, y: number, w: number, h: number, target: WarpTarget): EntityInstance {
  return {
    id,
    type: 'marker.warp',
    x,
    y,
    props: { target, transition: 'fade', sound: 'stairs', w, h, setRespawn: true },
  };
}

function room(id: string, name: string, gx: number, gy: number, fill: string, gw = 1): Room {
  return createRoom({ id, name, gx, gy, gw, fill: tid(fill) });
}

const GAP_H: [number, number] = [6, 9];
const GAP_V: [number, number] = [5, 8];

function meadow(): Room {
  const r = room('ow_meadow', 'Meadow', 0, 0, 'GRASS');
  new Paint(r)
    .border('n', 'MOUNTAIN_ROCK').border('w', 'TREE_SMALL').border('e', 'TREE_SMALL', [GAP_V])
    .border('s', 'TREE_SMALL', [GAP_H])
    .scatter('GRASS_ALT', [[4, 6], [9, 2], [13, 8], [7, 11]])
    .scatter('FLOWERS', [[3, 3], [4, 3], [12, 11], [13, 11], [13, 10]])
    .fill('fg', 6, 4, 5, 1, 'STONE_WALL')
    .fill('bg', 2, 8, 4, 3, 'TALL_GRASS')
    .set('bg', 11, 9, 'HOLE')
    .set('bg', 13, 4, 'BUSH').set('bg', 13, 5, 'BUSH').set('bg', 8, 11, 'ROCK')
    .tree(2, 1).tree(12, 1)
    .terrain('PATH', 6, 11, 4, 3, { s: true });
  return r;
}

function lake(): Room {
  const r = room('ow_lake', 'Lake', 1, 0, 'GRASS');
  new Paint(r)
    .border('n', 'MOUNTAIN_ROCK').border('e', 'TREE_SMALL').border('w', 'TREE_SMALL', [GAP_V])
    .border('s', 'TREE_SMALL', [GAP_H])
    // West and south sides open so the lake runs straight into the shallows (no grass bank between).
    .terrain('WATER', 8, 2, 6, 5, { w: true, s: true })
    .fill('bg', 7, 2, 1, 6, 'SHALLOW_WATER').fill('bg', 8, 7, 7, 1, 'SHALLOW_WATER')
    .fill('fg', 8, 4, 6, 1, 'BRIDGE_H')
    .fill('bg', 2, 9, 3, 3, 'TALL_GRASS')
    .scatter('FLOWERS', [[3, 6], [4, 6], [10, 10], [11, 11]])
    .tree(2, 2);
  return r;
}

function ledges(): Room {
  const r = room('ow_ledges', 'Ledges', 0, 1, 'GRASS');
  new Paint(r)
    .border('w', 'TREE_SMALL').border('n', 'TREE_SMALL', [GAP_H]).border('e', 'TREE_SMALL', [[3, 5]])
    .border('s', 'TREE_SMALL', [GAP_H])
    .terrain('PATH', 6, 0, 4, 7, { n: true })
    .fill('bg', 1, 7, 10, 1, 'LEDGE_S').fill('bg', 11, 7, 2, 1, 'CLIFF_STAIRS').fill('bg', 13, 7, 2, 1, 'LEDGE_S')
    .fill('bg', 2, 9, 3, 3, 'TALL_GRASS')
    .set('bg', 12, 10, 'ROCK')
    .scatter('FLOWERS', [[9, 10], [10, 10], [9, 11]])
    .tree(2, 2);
  return r;
}

function crossroads(): Room {
  const r = room('ow_cross', 'Crossroads', 1, 1, 'GRASS');
  new Paint(r)
    .border('e', 'TREE_SMALL').border('n', 'TREE_SMALL', [GAP_H]).border('w', 'TREE_SMALL', [[3, 5]])
    .border('s', 'TREE_SMALL', [GAP_H])
    .autotile('path', [[6, 0, 4, 14], [0, 3, 6, 3]])
    .fill('fg', 2, 7, 4, 3, 'MOUNTAIN_ROCK').set('fg', 3, 9, 'CAVE_ENTRANCE')
    .fill('fg', 10, 7, 4, 1, 'STONE_WALL_TOP').fill('fg', 10, 8, 4, 2, 'STONE_WALL')
    .tree(11, 2).tree(2, 11);
  r.entities.push(warpMarker('w_cave_in', 56, 152, 1, 1, { world: 'dg', room: 'dg_entry', x: 128, y: 184, dir: 'up' }));
  return r;
}

function field(): Room {
  const r = room('ow_field', 'Long Field', 0, 2, 'GRASS', 2);
  new Paint(r)
    .border('s', 'TREE_SMALL').border('w', 'TREE_SMALL').border('e', 'TREE_SMALL')
    .border('n', 'TREE_SMALL', [GAP_H, [22, 25]])
    .terrain('PATH', 6, 0, 4, 4, { n: true }).terrain('PATH', 22, 0, 4, 4, { n: true })
    .fill('bg', 8, 8, 7, 4, 'TALL_GRASS')
    .fill('bg', 20, 9, 5, 3, 'SHALLOW_WATER')
    .set('bg', 17, 10, 'HOLE')
    .set('bg', 5, 9, 'ROCK').set('bg', 28, 3, 'BUSH').set('bg', 29, 3, 'BUSH')
    .scatter('FLOWERS', [[3, 7], [4, 7], [26, 11], [27, 11], [15, 3]])
    .tree(2, 3).tree(12, 5).tree(17, 2).tree(27, 7);
  return r;
}

function overworld(): World {
  const w = createWorld({ id: 'ow', name: 'Test Overworld', kind: 'overworld', music: 'overworld' });
  w.rooms.push(meadow(), lake(), ledges(), crossroads(), field());
  return w;
}

function dungeon(): World {
  const w = createWorld({ id: 'dg', name: 'Test Dungeon', kind: 'dungeon', music: 'dungeon' });
  const entry = room('dg_entry', 'Entry Hall', 0, 0, 'DFLOOR');
  new Paint(entry)
    .dungeonWalls({ e: [6, 7], s: [7, 8] })
    .fill('bg', 7, 1, 2, 12, 'CARPET')
    .set('fg', 4, 4, 'PILLAR').set('fg', 11, 4, 'PILLAR').set('fg', 4, 9, 'PILLAR').set('fg', 11, 9, 'PILLAR');
  const exit: WarpTarget = { world: 'ow', room: 'ow_cross', x: 56, y: 170, dir: 'down' };
  entry.entities.push(warpMarker('w_cave_out', 128, 216, 2, 1, exit));
  const dark = room('dg_dark', 'Dark Hall', 1, 0, 'DFLOOR');
  dark.dark = true;
  new Paint(dark)
    .dungeonWalls({ w: [6, 7] })
    .terrain('PIT', 6, 3, 4, 3)
    .fill('bg', 11, 9, 2, 1, 'SPIKES')
    .set('fg', 3, 3, 'PILLAR').set('fg', 12, 3, 'PILLAR').set('fg', 3, 10, 'PILLAR').set('fg', 12, 10, 'PILLAR');
  w.rooms.push(entry, dark);
  return w;
}

/** Fresh copy of the engine test project. */
export function createTestProject(): Project {
  const assets = createDefaultAssets();
  const now = Date.now();
  const settings = defaultSettings('Engine Test');
  settings.subtitle = 'Questforge engine playground';
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: TEST_PROJECT_ID,
    name: 'Engine Test',
    author: 'Questforge',
    description: 'Movement, collision, transitions, ledges, pits, water, tall grass and dark rooms.',
    created: now,
    modified: now,
    settings,
    palettes: assets.palettes,
    tiles: assets.tiles,
    terrains: assets.terrains,
    sprites: assets.sprites,
    worlds: [overworld(), dungeon()],
    dialogues: [{ id: 'welcome', name: 'Welcome', pages: [{ text: 'Welcome to the engine test, {name}!' }] }],
    flags: [],
    start: { world: 'ow', room: 'ow_meadow', x: 128, y: 120, dir: 'down' },
  };
}
