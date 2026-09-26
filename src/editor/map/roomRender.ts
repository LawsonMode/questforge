// Room canvas drawing: per-layer tile caches (1 art px per canvas px, animated
// cells refreshed individually), neighbour edge strips, the collision overlay,
// grid/screen lines and placed entities. Caches are blitted at an integer scale.
import type { Collision, Dir, EntityInstance, LayerName, Room, TileDef, World } from '../../core/types';
import type { AssetCache } from '../../gfx/imageCache';
import { SCREEN_COLS, SCREEN_ROWS, TILE } from '../../core/constants';
import { entityInfo, footprint } from '../../core/catalog';
import { roomAtGrid, roomCols, roomRows } from '../../core/project';
import { entityLook } from './entityLook';

/** Art -> device transform: device = o + art * s. */
export interface Xf {
  s: number;
  ox: number;
  oy: number;
  dpr: number;
}

export const dx = (xf: Xf, x: number): number => Math.round(xf.ox + x * xf.s);
export const dy = (xf: Xf, y: number): number => Math.round(xf.oy + y * xf.s);

// ---------------------------------------------------------------- layer cache

/** A block of cells (tile coordinates, x1 / y1 exclusive). */
export interface CellArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * One tile layer rendered at 1x. build() rasterises every cell; update() redraws
 * given cells, sync() every cell whose id differs from what was drawn, tick()
 * the animated cells whose frame changed. A tick asks each animated tile id
 * for its frame once (not every cell) and does nothing until one of them
 * flips; then it redraws only the cells in view, a row of equal tiles at a
 * time (one pattern fill per run instead of one image per cell). A cell out of
 * view keeps its old frame until a later flip finds it in view.
 */
export class LayerCache {
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  /** Frame drawn in each animated cell; -1 = not an animated cell. */
  private animFrame = new Int16Array(0);
  /** Tile id each animated cell was counted under (see animIds). */
  private animIdOf = new Int32Array(0);
  /** Animated tile id -> number of cells showing it. */
  private readonly animIds = new Map<number, number>();
  /** Animated tile id -> its frame at the last tick. */
  private readonly idFrame = new Map<number, number>();
  /** Repeating fill of a tile frame image (a new image after an art change gets a new pattern). */
  private patterns = new WeakMap<HTMLCanvasElement, CanvasPattern>();
  /** Tile id drawn in each cell. */
  private drawn = new Int32Array(0);
  private cols = 1;
  private rows = 1;

  constructor(private readonly assets: AssetCache) {
    this.g = this.canvas.getContext('2d')!;
  }

  build(data: readonly number[], cols: number, rows: number, t: number): void {
    this.cols = cols;
    this.rows = rows;
    this.canvas.width = cols * TILE;
    this.canvas.height = rows * TILE;
    this.g.imageSmoothingEnabled = false;
    this.animIds.clear();
    this.idFrame.clear();
    this.patterns = new WeakMap();
    this.animFrame = new Int16Array(cols * rows).fill(-1);
    this.animIdOf = new Int32Array(cols * rows);
    this.drawn = new Int32Array(cols * rows);
    for (let i = 0; i < data.length; i++) this.drawCell(data, i, t, false);
  }

  update(data: readonly number[], indices: Iterable<number>, t: number): void {
    for (const i of indices) this.drawCell(data, i, t, true);
  }

  /** Redraw cells whose id changed since they were drawn; -1 if the size differs (rebuild instead). */
  sync(data: readonly number[], t: number): number {
    if (data.length !== this.drawn.length) return -1;
    let n = 0;
    for (let i = 0; i < data.length; i++) {
      if ((data[i] ?? 0) === this.drawn[i]) continue;
      this.drawCell(data, i, t, true);
      n++;
    }
    return n;
  }

  /** Mark the cells showing one of these tiles stale, so the next sync() redraws them (their art changed). */
  forget(tileIds: ReadonlySet<number>): void {
    const d = this.drawn;
    for (let i = 0; i < d.length; i++) if (tileIds.has(d[i]!)) d[i] = -1;
  }

  /** Redraw animated cells (inside `area`, when given) whose frame changed; true if any did. */
  tick(data: readonly number[], t: number, area?: CellArea): boolean {
    let flipped = false;
    for (const id of this.animIds.keys()) {
      const f = this.assets.tileFrameAt(id, t);
      if (this.idFrame.get(id) === f) continue;
      this.idFrame.set(id, f);
      flipped = true;
    }
    if (!flipped) return false;
    const { cols, animFrame, animIdOf, drawn } = this;
    const x0 = Math.max(0, area?.x0 ?? 0);
    const y0 = Math.max(0, area?.y0 ?? 0);
    const x1 = Math.min(cols, area?.x1 ?? cols);
    const y1 = Math.min(this.rows, area?.y1 ?? this.rows);
    let changed = false;
    for (let y = y0; y < y1; y++) {
      let x = x0;
      while (x < x1) {
        const i = y * cols + x;
        const shown = animFrame[i]!;
        if (shown < 0) {
          x++;
          continue;
        }
        const id = data[i] ?? 0;
        if (id !== animIdOf[i] || id !== drawn[i]) {
          // Changed since drawn (sync() has not run yet): redraw it on its own.
          this.drawCell(data, i, t, true);
          changed = true;
          x++;
          continue;
        }
        const f = this.idFrame.get(id) ?? shown;
        if (f === shown) {
          x++;
          continue;
        }
        // A run of the same tile, all due for this frame.
        let end = x + 1;
        while (end < x1) {
          const j = y * cols + end;
          if (animFrame[j] !== shown || animIdOf[j] !== id || drawn[j] !== id || (data[j] ?? 0) !== id) break;
          end++;
        }
        this.fillRun(id, f, y, x, end);
        animFrame.fill(f, i, i + (end - x));
        changed = true;
        x = end;
      }
    }
    return changed;
  }

  /** Paint cells x0..x1-1 of row y with one frame of a tile (the pattern lines up with the 16 px grid). */
  private fillRun(id: number, frame: number, y: number, x0: number, x1: number): void {
    const g = this.g;
    const px = x0 * TILE;
    const py = y * TILE;
    const w = (x1 - x0) * TILE;
    g.clearRect(px, py, w, TILE);
    const c = this.assets.tile(id, frame);
    if (!c) return;
    let pat = this.patterns.get(c);
    if (!pat) {
      pat = g.createPattern(c, 'repeat') ?? undefined;
      if (pat) this.patterns.set(c, pat);
    }
    if (!pat) {
      for (let x = x0; x < x1; x++) g.drawImage(c, x * TILE, py);
      return;
    }
    g.fillStyle = pat;
    g.fillRect(px, py, w, TILE);
  }

  private drawCell(data: readonly number[], i: number, t: number, clear: boolean): void {
    const id = data[i] ?? 0;
    this.drawn[i] = id;
    const x = (i % this.cols) * TILE;
    const y = Math.floor(i / this.cols) * TILE;
    if (clear) this.g.clearRect(x, y, TILE, TILE);
    if (this.animFrame[i]! >= 0) {
      this.animFrame[i] = -1;
      this.untrack(this.animIdOf[i]!);
    }
    if (id === 0) return;
    const def = this.assets.tileDef(id);
    if (!def) {
      drawMissingTile(this.g, x, y);
      return;
    }
    const frame = this.assets.tileFrameAt(id, t);
    if (def.frames.length > 1) {
      this.animFrame[i] = frame;
      this.animIdOf[i] = id;
      this.animIds.set(id, (this.animIds.get(id) ?? 0) + 1);
    }
    const c = this.assets.tile(id, frame);
    if (c) this.g.drawImage(c, x, y);
  }

  private untrack(id: number): void {
    const n = (this.animIds.get(id) ?? 1) - 1;
    if (n > 0) {
      this.animIds.set(id, n);
    } else {
      this.animIds.delete(id);
      this.idFrame.delete(id);
    }
  }
}

/** Magenta/black checker for tile ids the project does not define. */
function drawMissingTile(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#000';
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = '#ff00ff';
  for (let q = 0; q < 4; q++) if (q === 0 || q === 3) g.fillRect(x + (q % 2) * 8, y + (q >> 1) * 8, 8, 8);
}

/** Draw every non-zero tile of a room's layers (frame 0) into g at 1x, offset by (x, y) px. */
function drawRoomTiles(
  g: CanvasRenderingContext2D, assets: AssetCache, room: Room,
  src: { x: number; y: number; w: number; h: number }, dst: { x: number; y: number },
): void {
  const cols = roomCols(room);
  for (const layer of ['bg', 'fg', 'over'] as const) {
    const data = room.layers[layer];
    for (let ty = src.y; ty < src.y + src.h; ty++) {
      for (let tx = src.x; tx < src.x + src.w; tx++) {
        const c = assets.tile(data[ty * cols + tx] ?? 0, 0);
        if (c) g.drawImage(c, dst.x + (tx - src.x) * TILE, dst.y + (ty - src.y) * TILE);
      }
    }
  }
}

// ---------------------------------------------------------------- neighbours

/** A neighbouring room's visible strip, in art px relative to the current room's origin. */
export interface NeighbourStrip {
  room: Room;
  dir: Dir;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Depth (tiles) of the neighbour preview strips. */
export const STRIP = 3;

/** Edge strips of the rooms adjacent to a room, rendered once into a margin canvas. */
export class NeighbourCache {
  readonly canvas = document.createElement('canvas');
  strips: NeighbourStrip[] = [];

  constructor(private readonly assets: AssetCache) {}

  build(world: World, room: Room): void {
    const cols = roomCols(room);
    const rows = roomRows(room);
    this.canvas.width = (cols + 2 * STRIP) * TILE;
    this.canvas.height = (rows + 2 * STRIP) * TILE;
    const g = this.canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    this.strips = [];
    // One side at a time so consecutive segments of the same neighbour merge into one strip.
    for (let sx = 0; sx < room.gw; sx++) this.strip(g, room, 'up', roomAtGrid(world, room.gx + sx, room.gy - 1, room.floor), sx);
    for (let sx = 0; sx < room.gw; sx++) this.strip(g, room, 'down', roomAtGrid(world, room.gx + sx, room.gy + room.gh, room.floor), sx);
    for (let sy = 0; sy < room.gh; sy++) this.strip(g, room, 'left', roomAtGrid(world, room.gx - 1, room.gy + sy, room.floor), sy);
    for (let sy = 0; sy < room.gh; sy++) this.strip(g, room, 'right', roomAtGrid(world, room.gx + room.gw, room.gy + sy, room.floor), sy);
  }

  /** Draw the part of neighbour `n` touching screen segment `seg` of `dir`, and record it. */
  private strip(g: CanvasRenderingContext2D, room: Room, dir: Dir, n: Room | undefined, seg: number): void {
    if (!n) return;
    const cols = roomCols(room);
    const rows = roomRows(room);
    const vertical = dir === 'up' || dir === 'down';
    const w = vertical ? SCREEN_COLS : STRIP;
    const h = vertical ? STRIP : SCREEN_ROWS;
    const srcX = vertical ? (room.gx + seg - n.gx) * SCREEN_COLS : dir === 'left' ? roomCols(n) - STRIP : 0;
    const srcY = vertical ? (dir === 'up' ? roomRows(n) - STRIP : 0) : (room.gy + seg - n.gy) * SCREEN_ROWS;
    const tx = vertical ? seg * SCREEN_COLS : dir === 'left' ? -STRIP : cols;
    const ty = vertical ? (dir === 'up' ? -STRIP : rows) : seg * SCREEN_ROWS;
    drawRoomTiles(g, this.assets, n, { x: srcX, y: srcY, w, h }, { x: (tx + STRIP) * TILE, y: (ty + STRIP) * TILE });
    const prev = this.strips[this.strips.length - 1];
    const x = tx * TILE;
    const y = ty * TILE;
    if (prev && prev.room === n && prev.dir === dir) {
      if (vertical) prev.w += w * TILE;
      else prev.h += h * TILE;
      return;
    }
    this.strips.push({ room: n, dir, x, y, w: w * TILE, h: h * TILE });
  }
}

// ---------------------------------------------------------------- collision

export type CollisionKind = Exclude<Collision, 'floor'> | 'void';

/** Overlay colour per blocking/special collision type (floor is left clear). */
export const COLLISION_COLORS: Readonly<Record<CollisionKind, string>> = {
  solid: '#ff3b4e',
  void: '#8a1030',
  deep: '#2f6bff',
  shallow: '#5fd0ff',
  pit: '#b44cff',
  ledge: '#ff9a2e',
  hurt: '#ff3cc8',
  tallgrass: '#6ee05a',
  stairs: '#ffe040',
};

export const COLLISION_LABELS: Readonly<Record<CollisionKind, string>> = {
  solid: 'Solid', void: 'Void', deep: 'Deep water', shallow: 'Shallow', pit: 'Pit',
  ledge: 'Ledge', hurt: 'Hurts', tallgrass: 'Tall grass', stairs: 'Stairs',
};

/** Collision of one 8x8 quarter (0 TL, 1 TR, 2 BL, 3 BR) of a tile. */
function quarterCollision(def: TileDef, quarter: number): Collision {
  if (def.collision !== 'solid' || def.solidMask === undefined) return def.collision;
  const mask = def.solidMask & 15;
  return mask === 15 || (mask & (1 << quarter)) !== 0 ? 'solid' : 'floor';
}

/** The tile deciding a cell's collision: a non-zero fg tile, else bg (0 = void). */
export function decidingTile(room: Room, index: number): number {
  const fg = room.layers.fg[index] ?? 0;
  return fg !== 0 ? fg : (room.layers.bg[index] ?? 0);
}

/** Collision summary of a cell for the status bar (same rule as the engine). */
export function cellCollision(room: Room, index: number, assets: AssetCache): CollisionKind | 'floor' {
  const id = decidingTile(room, index);
  if (id === 0) return 'void';
  const def = assets.tileDef(id);
  return def ? def.collision : 'floor';
}

/** Collision overlay at 2 canvas px per tile (one per 8x8 quarter). */
export class CollisionCache {
  readonly canvas = document.createElement('canvas');

  constructor(private readonly assets: AssetCache) {}

  build(room: Room): void {
    const cols = roomCols(room);
    const rows = roomRows(room);
    this.canvas.width = cols * 2;
    this.canvas.height = rows * 2;
    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(cols * 2, rows * 2);
    const rgb = rgbTable();
    for (let i = 0; i < cols * rows; i++) {
      const id = decidingTile(room, i);
      const def = id === 0 ? undefined : this.assets.tileDef(id);
      for (let q = 0; q < 4; q++) {
        const kind: Collision | 'void' = id === 0 ? 'void' : def ? quarterCollision(def, q) : 'floor';
        if (kind === 'floor') continue;
        const px = (i % cols) * 2 + (q & 1);
        const py = Math.floor(i / cols) * 2 + (q >> 1);
        const o = (py * cols * 2 + px) * 4;
        const c = rgb[kind];
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
}

let rgbCache: Record<CollisionKind, [number, number, number]> | null = null;
function rgbTable(): Record<CollisionKind, [number, number, number]> {
  if (!rgbCache) {
    const out = {} as Record<CollisionKind, [number, number, number]>;
    for (const [k, hex] of Object.entries(COLLISION_COLORS) as [CollisionKind, string][]) {
      const n = parseInt(hex.slice(1), 16);
      out[k] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    rgbCache = out;
  }
  return rgbCache;
}

/** Small arrows on ledge tiles pointing where the player hops. */
export function drawLedgeArrows(g: CanvasRenderingContext2D, xf: Xf, room: Room, assets: AssetCache): void {
  if (xf.s * TILE < 24) return;
  const cols = roomCols(room);
  g.fillStyle = '#fff';
  for (let i = 0; i < cols * roomRows(room); i++) {
    const def = assets.tileDef(decidingTile(room, i));
    if (def?.collision !== 'ledge' || !def.ledgeDir) continue;
    const cx = dx(xf, (i % cols) * TILE + 8);
    const cy = dy(xf, Math.floor(i / cols) * TILE + 8);
    const r = xf.s * 3;
    const [ux, uy] = def.ledgeDir === 'up' ? [0, -1] : def.ledgeDir === 'down' ? [0, 1] : def.ledgeDir === 'left' ? [-1, 0] : [1, 0];
    g.beginPath();
    g.moveTo(cx + ux * r, cy + uy * r);
    g.lineTo(cx - ux * r + uy * r, cy - uy * r - ux * r);
    g.lineTo(cx - ux * r - uy * r, cy - uy * r + ux * r);
    g.closePath();
    g.fill();
  }
}

// ---------------------------------------------------------------- grid

/** Tile grid (optional) and screen boundaries (always) over a cols x rows room. */
export function drawGrid(g: CanvasRenderingContext2D, xf: Xf, cols: number, rows: number, tiles: boolean): void {
  const x0 = dx(xf, 0);
  const y0 = dy(xf, 0);
  const x1 = dx(xf, cols * TILE);
  const y1 = dy(xf, rows * TILE);
  const line = (x: number, y: number, w: number, h: number): void => g.fillRect(x, y, w, h);
  if (tiles && xf.s * TILE >= 8) {
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let tx = 1; tx < cols; tx++) if (tx % SCREEN_COLS) line(dx(xf, tx * TILE), y0, 1, y1 - y0);
    for (let ty = 1; ty < rows; ty++) if (ty % SCREEN_ROWS) line(x0, dy(xf, ty * TILE), x1 - x0, 1);
  }
  const w = Math.max(1, Math.round(xf.dpr));
  g.fillStyle = 'rgba(240,192,64,0.6)';
  for (let tx = SCREEN_COLS; tx < cols; tx += SCREEN_COLS) line(dx(xf, tx * TILE) - (w >> 1), y0, w, y1 - y0);
  for (let ty = SCREEN_ROWS; ty < rows; ty += SCREEN_ROWS) line(x0, dy(xf, ty * TILE) - (w >> 1), x1 - x0, w);
}

// ---------------------------------------------------------------- entities

/** Art-px bounds of an entity for hit-testing and outlines (footprint united with its sprite). */
export interface EntityBox {
  inst: EntityInstance;
  x: number;
  y: number;
  w: number;
  h: number;
  marker: boolean;
}

const MARKER_COLORS: Readonly<Record<string, string>> = { 'marker.warp': '#b07cff', 'marker.region': '#3fd6c4' };

export function isMarker(inst: EntityInstance): boolean {
  return entityInfo(inst.type)?.category === 'marker';
}

export function entityBox(inst: EntityInstance, assets: AssetCache): EntityBox {
  const fp = footprint(inst);
  let x0 = inst.x - fp.w / 2;
  let y0 = inst.y - fp.h / 2;
  let x1 = x0 + fp.w;
  let y1 = y0 + fp.h;
  const marker = isMarker(inst);
  const look = marker ? null : entityLook(inst, assets);
  const def = look ? assets.spriteDef(look.sprite) : undefined;
  if (def) {
    const left = inst.x - (look!.flipX ? def.w - def.ox : def.ox);
    x0 = Math.min(x0, left);
    y0 = Math.min(y0, inst.y - def.oy);
    x1 = Math.max(x1, left + def.w);
    y1 = Math.max(y1, inst.y - def.oy + def.h);
  }
  return { inst, x: x0, y: y0, w: x1 - x0, h: y1 - y0, marker };
}

/** Boxes in draw order (doors first, sprites by y, markers last). */
export function entityBoxes(room: Room, assets: AssetCache): EntityBox[] {
  const boxes = room.entities.map((e) => entityBox(e, assets));
  const rank = (b: EntityBox): number => (b.marker ? 1e6 : b.inst.type === 'obj.door' ? -1e6 : 0) + b.inst.y;
  return boxes.sort((a, b) => rank(a) - rank(b));
}

export interface EntityDrawOpts {
  selected: string | null;
  hovered: string | null;
  /** Label for markers (e.g. "→ Village"). */
  label: (inst: EntityInstance) => string;
}

/** Draw placed entities (sprites, markers, hidden marks, hover/selection outlines). */
export function drawEntities(g: CanvasRenderingContext2D, xf: Xf, boxes: readonly EntityBox[], assets: AssetCache, opts: EntityDrawOpts): void {
  for (const b of boxes) {
    const hidden = b.inst.props.hidden === true;
    g.globalAlpha = hidden ? 0.45 : 1;
    if (b.marker) drawMarker(g, xf, b, assets, opts.label(b.inst));
    else drawSprite(g, xf, b.inst, assets);
    g.globalAlpha = 1;
    if (hidden) drawHiddenMark(g, dx(xf, b.x + b.w) - 1, dy(xf, b.y) + 1, Math.round(10 * xf.dpr));
  }
  for (const b of boxes) {
    if (b.inst.id === opts.selected) outline(g, xf, b, '#f0c040', Math.max(2, Math.round(2 * xf.dpr)), b.inst.id);
    else if (b.inst.id === opts.hovered) outline(g, xf, b, 'rgba(255,255,255,0.75)', Math.max(1, Math.round(xf.dpr)), null);
  }
}

/** A would-be entity (placement preview): translucent sprite plus its dashed footprint. */
export function drawEntityGhost(g: CanvasRenderingContext2D, xf: Xf, inst: EntityInstance, assets: AssetCache): void {
  const b = entityBox(inst, assets);
  g.globalAlpha = 0.6;
  if (b.marker) drawMarker(g, xf, b, assets, '');
  else drawSprite(g, xf, inst, assets);
  g.globalAlpha = 1;
  const fp = footprint(inst);
  const x = dx(xf, inst.x - fp.w / 2);
  const y = dy(xf, inst.y - fp.h / 2);
  g.strokeStyle = '#58c878';
  g.lineWidth = Math.max(1, Math.round(xf.dpr));
  g.setLineDash([3 * xf.dpr, 3 * xf.dpr]);
  g.strokeRect(x + 0.5, y + 0.5, dx(xf, inst.x + fp.w / 2) - x - 1, dy(xf, inst.y + fp.h / 2) - y - 1);
  g.setLineDash([]);
}

function drawSprite(g: CanvasRenderingContext2D, xf: Xf, inst: EntityInstance, assets: AssetCache): void {
  const look = entityLook(inst, assets);
  if (!look) return;
  assets.drawSpriteAt(g, look.sprite, look.frame, dx(xf, inst.x), dy(xf, inst.y), xf.s, { palette: look.palette, flipX: look.flipX });
}

function drawMarker(g: CanvasRenderingContext2D, xf: Xf, b: EntityBox, assets: AssetCache, label: string): void {
  const color = MARKER_COLORS[b.inst.type] ?? '#ffffff';
  const x = dx(xf, b.x);
  const y = dy(xf, b.y);
  const w = dx(xf, b.x + b.w) - x;
  const h = dy(xf, b.y + b.h) - y;
  g.fillStyle = color;
  g.globalAlpha *= 0.28;
  g.fillRect(x, y, w, h);
  g.globalAlpha /= 0.28;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, Math.round(xf.dpr));
  g.setLineDash([4 * xf.dpr, 3 * xf.dpr]);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.setLineDash([]);
  const icon = entityInfo(b.inst.type)?.icon;
  const frame = icon ? assets.animFrame(icon.sprite, icon.anim, 0) : -1;
  if (icon && frame >= 0) assets.drawSpriteAt(g, icon.sprite, frame, dx(xf, b.inst.x), dy(xf, b.inst.y), xf.s);
  if (label && w >= 40 * xf.dpr) tag(g, x + 2, y + 2, label, color, xf.dpr, w - 4);
}

/** Small text pill with its top-left (align 'right': top-right) corner at (x, y), truncated to maxW. */
export function tag(
  g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, dpr: number, maxW = Infinity, align: 'left' | 'right' = 'left',
): void {
  g.font = `${Math.round(10 * dpr)}px ui-monospace, Consolas, monospace`;
  let t = text;
  const pad = Math.round(3 * dpr);
  while (t.length > 1 && g.measureText(t).width + pad * 2 > maxW) t = t.slice(0, -1);
  if (t !== text) t = `${t.slice(0, -1)}…`;
  const w = Math.ceil(g.measureText(t).width) + pad * 2;
  const h = Math.round(14 * dpr);
  const left = align === 'right' ? x - w : x;
  g.fillStyle = 'rgba(12,10,18,0.85)';
  g.fillRect(left, y, w, h);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(t, left + pad, y + h / 2 + 0.5);
}

function outline(g: CanvasRenderingContext2D, xf: Xf, b: EntityBox, color: string, width: number, label: string | null): void {
  const x = dx(xf, b.x) - width;
  const y = dy(xf, b.y) - width;
  const w = dx(xf, b.x + b.w) + width - x;
  const h = dy(xf, b.y + b.h) + width - y;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.strokeRect(x + width / 2, y + width / 2, w - width, h - width);
  if (label) tag(g, x, y - Math.round(15 * xf.dpr), label, color, xf.dpr);
}

/** Eye with a slash: "hidden until a trigger shows it". (x, y) = top-right corner. */
function drawHiddenMark(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const left = x - size;
  const cx = left + size / 2;
  const cy = y + size / 2;
  g.fillStyle = 'rgba(12,10,18,0.85)';
  g.fillRect(left, y, size, size);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = Math.max(1, size / 10);
  g.beginPath();
  g.ellipse(cx, cy, size * 0.38, size * 0.22, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ff5a5a';
  g.lineWidth = Math.max(1, size / 7);
  g.beginPath();
  g.moveTo(left + size * 0.15, y + size * 0.85);
  g.lineTo(left + size * 0.85, y + size * 0.15);
  g.stroke();
}

/** Layers in draw order. */
export const DRAW_LAYERS: readonly LayerName[] = ['bg', 'fg', 'over'];
