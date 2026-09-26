// Runtime view of one room: private copies of the tile layers (with persisted
// tile changes applied), tile/collision lookups and mover-aware blocking tests.
// OWNER: engine agent.
import type { Collision, Dir, LayerName, Project, Room, TileDef, World } from '../core/types';
import type { MoverKind, RoomRuntime } from './api';
import type { Rect } from '../core/math';
import { SCREEN_COLS, SCREEN_ROWS, TILE } from '../core/constants';

/** Collision is resolved per 8x8 quarter (TileDef.solidMask granularity). */
const CELL = TILE / 2;
/** Tolerance (in cells) so float noise on flush edges doesn't touch the next cell. */
const EPS = 1e-6;
const LAYER_RE = /^(bg|fg|over):(\d+),(\d+)=(\d+)$/;

const indexCache = new WeakMap<readonly TileDef[], Map<number, TileDef>>();

/** Id -> TileDef lookup for a tile list (cached per array, rebuilt when its length changes). */
export function tileIndex(tiles: readonly TileDef[]): ReadonlyMap<number, TileDef> {
  let m = indexCache.get(tiles);
  if (!m || m.size !== tiles.length) {
    m = new Map(tiles.map((t) => [t.id, t]));
    indexCache.set(tiles, m);
  }
  return m;
}

/** Flag key recording a persistent tile change (see SaveData flag conventions). */
export function tileFlagName(roomId: string, layer: LayerName, tx: number, ty: number, id: number): string {
  return `${tileFlagPrefix(roomId, layer, tx, ty)}${id}`;
}

function tileFlagPrefix(roomId: string, layer: LayerName, tx: number, ty: number): string {
  return `tile:${roomId}:${layer}:${tx},${ty}=`;
}

/** Whether a tile collision blocks a mover (ghosts are never blocked). */
export function blocksMover(c: Collision, mover: MoverKind, flippers = false): boolean {
  switch (c) {
    case 'solid': return mover !== 'ghost';
    case 'ledge': return mover === 'player' || mover === 'walker';
    case 'deep': return mover === 'walker' || (mover === 'player' && !flippers);
    case 'pit': return mover === 'walker';
    default: return false;
  }
}

/** Inclusive range of 8x8 cells a half-open rect overlaps (empty when c0 > c1 or r0 > r1). */
interface CellRange { c0: number; c1: number; r0: number; r1: number }

function cellRange(rect: Rect): CellRange {
  if (rect.w <= 0 || rect.h <= 0) return { c0: 0, c1: -1, r0: 0, r1: -1 };
  return {
    c0: Math.floor(rect.x / CELL + EPS),
    c1: Math.ceil((rect.x + rect.w) / CELL - EPS) - 1,
    r0: Math.floor(rect.y / CELL + EPS),
    r1: Math.ceil((rect.y + rect.h) / CELL - EPS) - 1,
  };
}

/** ledgeDir of the tile deciding collision at a pixel (fg if non-zero, else bg), when it is a ledge. */
function ledgeDirAt(room: RoomRuntime, px: number, py: number): Dir | undefined {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  const fg = room.tile('fg', tx, ty);
  const def = room.tileDef(fg !== 0 ? fg : room.tile('bg', tx, ty));
  return def?.collision === 'ledge' ? def.ledgeDir : undefined;
}

/** Result of probeLedge. */
export type LedgeProbe = 'ledge' | 'blocked' | 'clear';

/**
 * What a player rect meets on a ledge hop along `dir`:
 * 'ledge' = at least one ledge whose ledgeDir is `dir` and nothing else that blocks the player;
 * 'blocked' = something else that blocks the player (walls, other ledges, deep water without flippers);
 * 'clear' = neither. Cells outside the room are ignored (the caller decides about room edges).
 */
export function probeLedge(room: RoomRuntime, rect: Rect, dir: Dir, flippers = false): LedgeProbe {
  const { c0, c1, r0, r1 } = cellRange(rect);
  let ledge = false;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const px = cx * CELL;
      const py = cy * CELL;
      if (px < 0 || py < 0 || px >= room.width || py >= room.height) continue;
      const c = room.collisionAt(px, py);
      if (c === 'ledge' && ledgeDirAt(room, px, py) === dir) ledge = true;
      else if (blocksMover(c, 'player', flippers)) return 'blocked';
    }
  }
  return ledge ? 'ledge' : 'clear';
}

export class ActiveRoom implements RoomRuntime {
  readonly def: Room;
  readonly world: World;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  private readonly layers: Record<LayerName, number[]>;
  private readonly defs: ReadonlyMap<number, TileDef>;
  private readonly flags: Record<string, boolean>;

  /**
   * `flags` is the live save-flag record: persisted `tile:` changes for this room
   * are applied on construction and setTile(..., persist) writes new ones into it.
   */
  constructor(project: Pick<Project, 'tiles'>, world: World, room: Room, flags: Record<string, boolean> = {}) {
    this.def = room;
    this.world = world;
    this.cols = room.gw * SCREEN_COLS;
    this.rows = room.gh * SCREEN_ROWS;
    this.width = this.cols * TILE;
    this.height = this.rows * TILE;
    this.defs = tileIndex(project.tiles);
    this.flags = flags;
    const size = this.cols * this.rows;
    const copy = (src: readonly number[] | undefined): number[] => {
      const out = new Array<number>(size).fill(0);
      if (src) for (let i = 0; i < size && i < src.length; i++) out[i] = src[i] ?? 0;
      return out;
    };
    // Null prototype: a layer name from hand-edited data ("__proto__", "constructor") finds nothing instead of Object's members.
    const layers = Object.create(null) as Record<LayerName, number[]>;
    layers.bg = copy(room.layers.bg);
    layers.fg = copy(room.layers.fg);
    layers.over = copy(room.layers.over);
    this.layers = layers;
    this.applyPersistedTiles();
  }

  private applyPersistedTiles(): void {
    const prefix = `tile:${this.def.id}:`;
    for (const [key, on] of Object.entries(this.flags)) {
      if (!on || !key.startsWith(prefix)) continue;
      const m = LAYER_RE.exec(key.slice(prefix.length));
      if (!m) continue;
      const tx = Number(m[2]);
      const ty = Number(m[3]);
      if (this.inBounds(tx, ty)) this.layers[m[1] as LayerName][ty * this.cols + tx] = Number(m[4]);
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  /** Whether a pixel lies inside the room. */
  containsPx(px: number, py: number): boolean {
    return px >= 0 && py >= 0 && px < this.width && py < this.height;
  }

  tile(layer: LayerName, tx: number, ty: number): number {
    const cells = this.layers[layer];
    return cells && this.inBounds(tx, ty) ? cells[ty * this.cols + tx]! : 0;
  }

  /** Ignores cells outside the room, unknown layer names and ids that are not whole numbers >= 0. */
  setTile(layer: LayerName, tx: number, ty: number, id: number, persist = false): void {
    const cells = this.layers[layer];
    if (!cells || !this.inBounds(tx, ty) || !Number.isInteger(id) || id < 0) return;
    cells[ty * this.cols + tx] = id;
    if (!persist) return;
    const prefix = tileFlagPrefix(this.def.id, layer, tx, ty);
    for (const key of Object.keys(this.flags)) if (key.startsWith(prefix)) delete this.flags[key];
    this.flags[tileFlagName(this.def.id, layer, tx, ty, id)] = true;
  }

  tileDef(id: number): TileDef | undefined {
    return this.defs.get(id);
  }

  /**
   * A non-zero fg tile decides the whole cell (its open solidMask quarters are floor, not the bg below),
   * else the bg tile; bg 0 is solid void and unknown ids are floor. Same rule as core/validate.ts.
   */
  collisionAt(px: number, py: number): Collision {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (!this.inBounds(tx, ty)) return 'solid';
    const fg = this.tile('fg', tx, ty);
    const id = fg !== 0 ? fg : this.tile('bg', tx, ty);
    if (id === 0) return 'solid';
    const def = this.defs.get(id);
    if (!def) return 'floor';
    const quarter = 1 << ((py - ty * TILE >= CELL ? 2 : 0) + (px - tx * TILE >= CELL ? 1 : 0));
    return openQuarter(def, quarter) ? 'floor' : def.collision;
  }

  interactiveTile(tx: number, ty: number): { layer: LayerName; def: TileDef } | null {
    for (const layer of ['fg', 'bg'] as const) {
      const id = this.tile(layer, tx, ty);
      if (id === 0) continue;
      const def = this.defs.get(id);
      if (def && (def.cut || def.lift || def.bomb || def.dash)) return { layer, def };
    }
    return null;
  }

  /**
   * Rect is half-open [x, x+w) x [y, y+h). Outside the room counts as solid for
   * every mover except 'player' (the engine turns stepping past an edge into a
   * room transition, or clamps the player back when there is no neighbour).
   */
  blocked(rect: Rect, mover: MoverKind, opts?: { flippers?: boolean }): boolean {
    if (mover === 'ghost') return false;
    const flippers = opts?.flippers ?? false;
    const { c0, c1, r0, r1 } = cellRange(rect);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const px = cx * CELL;
        const py = cy * CELL;
        if (!this.containsPx(px, py)) {
          if (mover !== 'player') return true;
        } else if (blocksMover(this.collisionAt(px, py), mover, flippers)) {
          return true;
        }
      }
    }
    return false;
  }
}

/** A masked solid tile's quarter that is not solid (floor). */
function openQuarter(def: TileDef, quarter: number): boolean {
  if (def.collision !== 'solid' || def.solidMask === undefined) return false;
  const mask = def.solidMask & 15;
  return mask !== 15 && (mask & quarter) === 0;
}
