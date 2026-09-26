// Tile painting kit for the sample adventure: rooms are drawn from ASCII maps
// (one character per tile, see Legend), with autotiled terrains (water, path,
// pit, plateau via core/autotile), autotiled dungeon/house walls, and a house
// facade stamp.
import type { LayerName, Room, Terrain } from '../../core/types';
import { NB, paintTerrain, resolveTerrainsAround, resolveTerrainTile } from '../../core/autotile';
import { createRoom } from '../../core/project';
import { SCREEN_COLS, SCREEN_ROWS } from '../../core/constants';
import { T } from '../ids';

/** Tile id for a key (throws on typos so a layout never silently breaks). */
function tid(key: string): number {
  const id = T[key];
  if (id === undefined) throw new Error(`sample: unknown tile key "${key}"`);
  return id;
}

/** Room walls drawn as an autotiled mass: dungeon stone or house timber. */
export type WallStyle = 'dungeon' | 'interior';

/** What one ASCII map character paints. */
export interface Glyph {
  /** bg tile key (defaults to the map's ground); '' = void (black, solid; counts as wall mass). */
  bg?: string;
  fg?: string;
  over?: string;
  /** Terrain id (water / path / pit / plateau) autotiled on top of bg. */
  terrain?: string;
  /** bg tile placed after terrains resolve (e.g. stairs cut into a plateau edge). */
  after?: string;
  /** Part of the wall mass (autotiled with the map's wall style). */
  wall?: boolean;
  /** Set into the wall (doorway, window, exit mat): keeps its own tile, but walls beside it stay straight. */
  inWall?: boolean;
}

/** Map character -> what it paints. */
export type Legend = Readonly<Record<string, Glyph>>;

/** Map options: the default bg tile and the wall style for `wall` glyphs. */
export interface MapOptions {
  ground: string;
  walls?: WallStyle;
}

type Cell = { tx: number; ty: number };

/** Wall pieces as a Terrain so core/autotile's resolver picks edges and corners. */
function wallTerrain(style: WallStyle): Terrain {
  const k = (name: string): number => tid(style === 'dungeon' ? `DWALL_${name}` : `IWALL_${name}`);
  const outer = (dungeonKey: string, interiorKey: string): number =>
    tid(style === 'dungeon' ? `DWALL_${dungeonKey}` : `IWALL_${interiorKey}`);
  return {
    id: `walls_${style}`, name: 'Walls', layer: 'bg',
    center: style === 'dungeon' ? k('FILL') : 0,
    s: k('TOP'), n: k('BOTTOM'), e: k('LEFT'), w: k('RIGHT'),
    ise: k('TL'), isw: k('TR'), ine: k('BL'), inw: k('BR'),
    nw: outer('OTL', 'BOTTOM'), ne: outer('OTR', 'BOTTOM'), sw: outer('OBL', 'TOP'), se: outer('OBR', 'TOP'),
  };
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, -1, NB.N], [1, -1, NB.NE], [1, 0, NB.E], [1, 1, NB.SE],
  [0, 1, NB.S], [-1, 1, NB.SW], [-1, 0, NB.W], [-1, -1, NB.NW],
];

/** Paints one room's layers in tile coordinates. */
export class Painter {
  readonly room: Room;
  readonly cols: number;
  readonly rows: number;
  private readonly terrains: readonly Terrain[];

  constructor(room: Room, terrains: readonly Terrain[]) {
    this.room = room;
    this.terrains = terrains;
    this.cols = room.gw * SCREEN_COLS;
    this.rows = room.gh * SCREEN_ROWS;
  }

  /** Set one cell; `0` clears it. Out-of-room cells are ignored. */
  set(layer: LayerName, tx: number, ty: number, key: string | 0): this {
    if (tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows) {
      this.room.layers[layer][ty * this.cols + tx] = key === 0 ? 0 : tid(key);
    }
    return this;
  }

  /**
   * Paint the whole room from an ASCII map (exactly rows x cols characters).
   * Base tiles first, then every terrain as one autotiled blob, late tiles, then walls.
   */
  map(lines: readonly string[], legend: Legend, opts: MapOptions): this {
    if (lines.length !== this.rows) {
      throw new Error(`sample: map for "${this.room.name}" has ${lines.length} rows, needs ${this.rows}`);
    }
    const bad = lines.findIndex((l) => l.length !== this.cols);
    if (bad >= 0) throw new Error(`sample: map for "${this.room.name}" row ${bad} is not ${this.cols} tiles wide`);
    const terrainCells = new Map<string, Cell[]>();
    const wallCells = new Set<number>();
    const wallMates = new Set<number>();
    const late: [number, number, string][] = [];
    lines.forEach((line, ty) => {
      [...line].forEach((ch, tx) => {
        const g = legend[ch];
        if (!g) throw new Error(`sample: "${this.room.name}" uses unknown map glyph "${ch}" at ${tx},${ty}`);
        const bg = g.bg ?? opts.ground;
        this.set('bg', tx, ty, bg === '' ? 0 : bg);
        if (bg === '') wallMates.add(ty * this.cols + tx);
        if (g.fg) this.set('fg', tx, ty, g.fg);
        if (g.over) this.set('over', tx, ty, g.over);
        if (g.terrain) {
          const list = terrainCells.get(g.terrain) ?? [];
          list.push({ tx, ty });
          terrainCells.set(g.terrain, list);
        }
        if (g.wall) wallCells.add(ty * this.cols + tx);
        if (g.inWall) wallMates.add(ty * this.cols + tx);
        if (g.after) late.push([tx, ty, g.after]);
      });
    });
    for (const [id, cells] of terrainCells) this.terrain(id, cells);
    for (const [tx, ty, key] of late) this.set('bg', tx, ty, key);
    if (wallCells.size > 0) this.walls(wallCells, wallMates, opts.walls ?? 'dungeon');
    return this;
  }

  /** Autotile a terrain over the given cells, re-resolving every terrain around them. */
  private terrain(id: string, cells: Cell[]): void {
    const terrain = this.terrains.find((t) => t.id === id);
    if (!terrain) throw new Error(`sample: unknown terrain "${id}"`);
    paintTerrain(this.room, terrain, cells);
    resolveTerrainsAround(this.room, this.terrains, cells);
  }

  /** Resolve wall pieces; `mates` (doorways, void) and outside the room count as wall for neighbours. */
  private walls(cells: ReadonlySet<number>, mates: ReadonlySet<number>, style: WallStyle): void {
    const pieces = wallTerrain(style);
    const member = (x: number, y: number): boolean =>
      x < 0 || y < 0 || x >= this.cols || y >= this.rows || cells.has(y * this.cols + x) || mates.has(y * this.cols + x);
    for (const i of cells) {
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      let mask = 0;
      for (const [dx, dy, bit] of NEIGHBOURS) if (member(tx + dx, ty + dy)) mask |= bit;
      this.room.layers.bg[i] = resolveTerrainTile(pieces, mask);
    }
  }

  /**
   * House facade: a shingle roof (9-slice, `roofRows` >= 2 tall) over a wall
   * row with windows and a door. (tx, ty) = roof top-left, doorX / windows in room columns.
   */
  house(tx: number, ty: number, w: number, doorX: number, windows: readonly number[], roofRows: number): this {
    for (let i = 0; i < w; i++) {
      const x = tx + i;
      const side = i === 0 ? 'L' : i === w - 1 ? 'R' : '';
      for (let r = 0; r < roofRows; r++) {
        const band = r === 0 ? 'T' : r === roofRows - 1 ? 'B' : '';
        const key = band && side ? `ROOF_${band}${side}` : band ? `ROOF_${band}` : side ? `ROOF_${side}` : 'ROOF_M';
        this.set('bg', x, ty + r, key);
      }
      this.set('bg', x, ty + roofRows, x === doorX ? 'HOUSE_DOOR' : windows.includes(x) ? 'HOUSE_WINDOW' : 'HOUSE_WALL');
    }
    return this;
  }
}

/** New room painted from an ASCII map. */
export function mapRoom(
  terrains: readonly Terrain[],
  spec: { id: string; name: string; gx: number; gy: number; gw?: number; gh?: number; floor?: number },
  lines: readonly string[], legend: Legend, opts: MapOptions,
): { room: Room; paint: Painter } {
  const room = createRoom({ ...spec, fill: 0 });
  const paint = new Painter(room, terrains).map(lines, legend, opts);
  return { room, paint };
}
