// Map page of the pause menu. The overworld gets a true mini-map (every tile
// drawn as its average colour, built once per open into an offscreen canvas)
// with the current room outlined and the hero blinking. Indoors (interior
// worlds) the page shows the overworld with the marker on the doorway that leads
// in - the warp into the current room, else any warp into that interior world -
// and "NO MAP HERE" when no overworld warp leads in. Dungeons get the schematic
// ALttP-style floor map: rooms appear once visited (or all with the Dungeon Map,
// which also draws the paper grid of the whole dungeon), the Compass adds the
// boss room and unopened chests, and up/down pages through the floors.
// OWNER: triggers+UI agent.
import type { Project, Room, TileDef, World } from '../../core/types';
import type { GameServices, Renderer } from '../api';
import type { Rect, Vec } from '../../core/math';
import { SCREEN_COLS, SCREEN_ROWS, TILE } from '../../core/constants';
import { entityInfo, propOf } from '../../core/catalog';
import { CENTER, SCREEN, UI, drawFrame, drawTitlePlate, keyLabel, outlineText } from './theme';

/** Map frame and the drawable area inside it (screen px). */
export const MAP_FRAME = { x: 8, y: 46, w: 240, h: 166 } as const;
const AREA = { x: 18, y: 60, w: 220, h: 142 } as const;
/** Dungeon schematic area (the floor list takes the right column). */
const DUNGEON_AREA = { x: 18, y: 62, w: 170, h: 138 } as const;
const FLOOR_COL_X = 206;
/** Floors listed at once in the floor column (a taller dungeon scrolls with the selection). */
const VISIBLE_FLOORS = 7;
/** Largest dungeon map scale (px per tile): a one-screen room is at most 64x56. */
const MAX_DUNGEON_SCALE = 4;
/**
 * Largest overworld mini-map canvas side (px = tiles). Rooms placed very far
 * apart would need a canvas beyond what browsers allocate (and would shrink to
 * nothing in the map window anyway): past this the page shows no mini-map.
 */
const MAX_MINIMAP_SIDE = 4096;
/** Paper-grid cells smaller than this (px) are invisible: the grid is skipped. */
const MIN_GRID_CELL = 2;

/** Dungeon items shown under the floor list (dimmed until owned). */
const DUNGEON_ITEMS: readonly ('map' | 'compass' | 'bigKey')[] = ['map', 'compass', 'bigKey'];

/** Per-project cache of tile average colours. */
const tileColors = new WeakMap<Project, Map<number, string | null>>();

/** Average colour of a tile's first frame (opaque pixels only), or null if fully transparent. */
function tileColor(project: Project, id: number): string | null {
  let cache = tileColors.get(project);
  if (!cache) {
    cache = new Map();
    tileColors.set(project, cache);
  }
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const def = project.tiles.find((t) => t.id === id);
  const color = def ? averageColor(project, def) : null;
  cache.set(id, color);
  return color;
}

function averageColor(project: Project, def: TileDef): string | null {
  const colors = project.palettes.find((p) => p.id === def.palette)?.colors;
  const frame = def.frames[0];
  if (!colors || !frame) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const ch of frame) {
    const idx = parseInt(ch, 16);
    if (!(idx > 0)) continue;
    const hex = colors[idx];
    if (!hex || hex.length < 7) continue;
    r += parseInt(hex.slice(1, 3), 16);
    g += parseInt(hex.slice(3, 5), 16);
    b += parseInt(hex.slice(5, 7), 16);
    n++;
  }
  if (n === 0) return null;
  const c = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** A rectangle on the room grid (in screens). */
interface Bounds {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

/** Grid bounds of a (non-empty) set of rooms. */
function bounds(rooms: readonly Room[]): Bounds {
  const gx = Math.min(...rooms.map((r) => r.gx));
  const gy = Math.min(...rooms.map((r) => r.gy));
  const gw = Math.max(...rooms.map((r) => r.gx + r.gw)) - gx;
  const gh = Math.max(...rooms.map((r) => r.gy + r.gh)) - gy;
  return { gx, gy, gw, gh };
}

/** Top-most visible colour of a room cell: over, then fg, then bg. */
function cellColor(project: Project, room: Room, i: number): string {
  for (const layer of ['over', 'fg', 'bg'] as const) {
    const id = room.layers[layer][i] ?? 0;
    if (id === 0) continue;
    const c = tileColor(project, id);
    if (c) return c;
  }
  return '#000000';
}

/** Mini-map image of one floor of a world (one pixel per tile), or null without a DOM. */
function buildMiniMap(project: Project, rooms: readonly Room[]): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || rooms.length === 0) return null;
  const b = bounds(rooms);
  if (b.gw * SCREEN_COLS > MAX_MINIMAP_SIDE || b.gh * SCREEN_ROWS > MAX_MINIMAP_SIDE) return null;
  const canvas = document.createElement('canvas');
  canvas.width = b.gw * SCREEN_COLS;
  canvas.height = b.gh * SCREEN_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const room of rooms) {
    const cols = room.gw * SCREEN_COLS;
    const rows = room.gh * SCREEN_ROWS;
    const ox = (room.gx - b.gx) * SCREEN_COLS;
    const oy = (room.gy - b.gy) * SCREEN_ROWS;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = cellColor(project, room, y * cols + x);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
  return canvas;
}

/** Floor label: 0 -> 1F, 1 -> 2F, -1 -> B1. */
export function floorLabel(floor: number): string {
  return floor >= 0 ? `${floor + 1}F` : `B${-floor}`;
}

function floorRooms(world: World, floor: number): Room[] {
  return world.rooms.filter((r) => r.floor === floor);
}

/** The overworld spot of an interior room: the overworld warp into it (else into its world), or null. */
export function interiorDoorway(project: Project, interior: World, roomId: string): { world: World; room: Room; at: Vec } | null {
  let fallback: { world: World; room: Room; at: Vec } | null = null;
  for (const world of project.worlds) {
    if (world.kind !== 'overworld') continue;
    for (const room of world.rooms) {
      for (const inst of room.entities) {
        const target = inst.type === 'marker.warp' ? inst.props['target'] : null;
        if (!target || typeof target !== 'object' || target.world !== interior.id) continue;
        const found = { world, room, at: { x: inst.x, y: inst.y } };
        if (target.room === roomId) return found;
        fallback ??= found;
      }
    }
  }
  return fallback;
}

/** What the overworld mini-map shows: a floor of a world (and its bounds), the room to outline and a fixed hero spot (null = the hero). */
interface OverworldView {
  world: World;
  room: Room;
  rooms: Room[];
  bounds: Bounds;
  heroAt: Vec | null;
}

/** The map page: owns the per-open mini-map and the dungeon floor selection. */
export class MapPage {
  private readonly game: GameServices;
  private miniMap: HTMLCanvasElement | null = null;
  private view: OverworldView | null = null;
  private floors: number[] = [];
  private floor = 0;
  private visited: ReadonlySet<string> = new Set();
  /** Grid bounds of the whole dungeon (null outside dungeons or without rooms). */
  private dungeonBounds: Bounds | null = null;
  /** Reused room rectangle of the dungeon map. */
  private readonly cell: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** The dungeon map's top-left (screen px) and scale (px per tile) this frame. */
  private readonly layout = { x0: 0, y0: 0, k: 1 };

  constructor(game: GameServices) {
    this.game = game;
  }

  private get world(): World {
    return this.game.room.world;
  }

  private get isDungeon(): boolean {
    return this.world.kind === 'dungeon';
  }

  /** Rebuild for the current room (call whenever the page is shown). */
  refresh(): void {
    const g = this.game;
    const current = g.room.def;
    this.floors = [...new Set(this.world.rooms.map((r) => r.floor))].sort((a, b) => b - a);
    this.floor = current.floor;
    this.visited = new Set(g.dungeon?.visited ?? []);
    this.dungeonBounds = this.isDungeon && this.world.rooms.length > 0 ? bounds(this.world.rooms) : null;
    this.view = this.isDungeon ? null : this.overworldView();
    this.miniMap = this.view ? buildMiniMap(g.project, this.view.rooms) : null;
  }

  private overworldView(): OverworldView | null {
    const here = this.game.room.def;
    const door = this.world.kind === 'overworld' ? null : interiorDoorway(this.game.project, this.world, here.id);
    if (this.world.kind !== 'overworld' && !door) return null;
    const world = door?.world ?? this.world;
    const room = door?.room ?? here;
    const rooms = floorRooms(world, room.floor);
    return { world, room, rooms, bounds: bounds(rooms), heroAt: door?.at ?? null };
  }

  /** Up/down pages dungeon floors; returns true if the floor changed. */
  changeFloor(step: number): boolean {
    if (!this.isDungeon) return false;
    const i = this.floors.indexOf(this.floor);
    const next = this.floors[i - step];
    if (next === undefined) return false;
    this.floor = next;
    return true;
  }

  /** Hint line for the bottom of the page; `closeKey` is the label of the key that closes the menu. */
  hint(closeKey: string): string {
    const flip = `${keyLabel('l')}/${keyLabel('r')}: ITEMS`;
    const close = `${closeKey}: CLOSE`;
    return this.isDungeon && this.floors.length > 1 ? `UP/DOWN: FLOOR  ${flip}  ${close}` : `${flip}   ${close}`;
  }

  draw(r: Renderer, time: number): void {
    const f = MAP_FRAME;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    const title = this.isDungeon ? `${this.world.name}  ${floorLabel(this.floor)}` : (this.view?.world ?? this.world).name;
    drawTitlePlate(r, title, f.x + 14, f.y);
    if (this.isDungeon) this.drawDungeon(r, time);
    else this.drawOverworld(r, time);
  }

  // ------------------------------------------------------------------ overworld

  private drawOverworld(r: Renderer, time: number): void {
    const view = this.view;
    const map = this.miniMap;
    if (!view || !map) {
      outlineText(r, 'NO MAP HERE', AREA.x + AREA.w / 2, AREA.y + AREA.h / 2 - 4, UI.dim, CENTER);
      return;
    }
    const rooms = view.rooms;
    const fit = Math.min(AREA.w / map.width, AREA.h / map.height);
    const scale = fit >= 1 ? Math.min(4, Math.floor(fit)) : fit;
    const w = Math.round(map.width * scale);
    const h = Math.round(map.height * scale);
    const x0 = Math.round(AREA.x + (AREA.w - w) / 2);
    const y0 = Math.round(AREA.y + (AREA.h - h) / 2);
    const ctx = r.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(map, x0, y0, w, h);
    const b = view.bounds;
    for (const room of rooms) {
      const rx = x0 + Math.round((room.gx - b.gx) * SCREEN_COLS * scale);
      const ry = y0 + Math.round((room.gy - b.gy) * SCREEN_ROWS * scale);
      const rw = Math.round(room.gw * SCREEN_COLS * scale);
      const rh = Math.round(room.gh * SCREEN_ROWS * scale);
      if (room.id === view.room.id) r.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2, Math.floor(time * 3) % 2 === 0 ? UI.gold : UI.goldDark, SCREEN);
      else r.strokeRect(rx, ry, rw, rh, '#000000', ROOM_EDGE);
    }
    const cur = view.room;
    const hero = view.heroAt ?? this.game.player;
    const hx = x0 + ((cur.gx - b.gx) * SCREEN_COLS + hero.x / TILE) * scale;
    const hy = y0 + ((cur.gy - b.gy) * SCREEN_ROWS + hero.y / TILE) * scale;
    drawHeroMarker(r, hx, hy, time);
  }

  // ------------------------------------------------------------------ dungeon

  private drawDungeon(r: Renderer, time: number): void {
    const g = this.game;
    const ds = g.dungeon;
    const all = this.world.rooms;
    const b = this.dungeonBounds;
    if (!b) return;
    const k = Math.min(DUNGEON_AREA.w / (b.gw * SCREEN_COLS), DUNGEON_AREA.h / (b.gh * SCREEN_ROWS), MAX_DUNGEON_SCALE);
    const mapW = b.gw * SCREEN_COLS * k;
    const mapH = b.gh * SCREEN_ROWS * k;
    const layout = this.layout;
    layout.x0 = DUNGEON_AREA.x + (DUNGEON_AREA.w - mapW) / 2;
    layout.y0 = DUNGEON_AREA.y + (DUNGEON_AREA.h - mapH) / 2;
    layout.k = k;
    const { x0, y0 } = layout;
    const hasMap = ds?.map === true;
    const hasCompass = ds?.compass === true;
    if (hasMap) drawGrid(r, x0, y0, b.gw, b.gh, k);
    let shown = 0;
    for (const room of all) {
      if (room.floor !== this.floor) continue;
      const seen = this.visited.has(room.id);
      if (!seen && !hasMap) continue;
      shown++;
      const rect = this.place(room, b);
      drawRoomBlock(r, rect, seen, room.id === g.room.def.id);
      if (hasCompass) this.drawCompassMarks(r, room, rect, k, time);
    }
    if (shown === 0) {
      outlineText(r, 'NOT EXPLORED', DUNGEON_AREA.x + DUNGEON_AREA.w / 2, DUNGEON_AREA.y + DUNGEON_AREA.h / 2 - 4, UI.dim, CENTER);
    }
    const cur = g.room.def;
    if (cur.floor === this.floor) {
      const rect = this.place(cur, b);
      drawHeroMarker(r, rect.x + (g.player.x / TILE) * k, rect.y + (g.player.y / TILE) * k, time);
    }
    this.drawFloorColumn(r, time);
  }

  /** Screen rectangle of a room on the dungeon map (the reused `cell`), per the current `layout`. */
  private place(room: Room, b: Bounds): Rect {
    const { x0, y0, k } = this.layout;
    const c = this.cell;
    c.x = Math.round(x0 + (room.gx - b.gx) * SCREEN_COLS * k);
    c.y = Math.round(y0 + (room.gy - b.gy) * SCREEN_ROWS * k);
    c.w = Math.round(room.gw * SCREEN_COLS * k);
    c.h = Math.round(room.gh * SCREEN_ROWS * k);
    return c;
  }

  /** Compass marks: a skull on rooms with an undefeated boss, gold dots on unopened chests. */
  private drawCompassMarks(r: Renderer, room: Room, rect: Rect, k: number, time: number): void {
    const g = this.game;
    for (const inst of room.entities) {
      const info = entityInfo(inst.type);
      const x = Math.round(rect.x + (inst.x / TILE) * k);
      const y = Math.round(rect.y + (inst.y / TILE) * k);
      if (info?.category === 'boss' && !g.flag(`defeated:${inst.id}`)) {
        if (Math.floor(time * 2) % 2 === 0) drawSkull(r, x, y);
      } else if (inst.type === 'obj.chest' && !g.flag(`chest:${inst.id}`) && isPresent(g, inst.id, propOf(inst, 'hidden', false))) {
        r.fillRect(x - 2, y - 2, 5, 5, UI.outline, SCREEN);
        r.fillRect(x - 1, y - 1, 3, 3, UI.gold, SCREEN);
      }
    }
  }

  private drawFloorColumn(r: Renderer, time: number): void {
    const cur = this.game.room.def.floor;
    const top = MAP_FRAME.y + 18;
    const pitch = 14;
    const first = Math.max(0, Math.min(this.floors.indexOf(this.floor) - 3, this.floors.length - VISIBLE_FLOORS));
    const last = Math.min(this.floors.length, first + VISIBLE_FLOORS);
    for (let i = first; i < last; i++) {
      const floor = this.floors[i]!;
      const y = top + (i - first) * pitch;
      const selected = floor === this.floor;
      if (selected) drawFrame(r, FLOOR_COL_X - 12, y - 4, 38, 16, UI.fillLight);
      outlineText(r, floorLabel(floor), FLOOR_COL_X + 7, y, selected ? UI.gold : UI.mid, CENTER);
      if (floor === cur && Math.floor(time * 3) % 2 === 0) r.fillRect(FLOOR_COL_X - 16, y + 2, 3, 3, UI.green, SCREEN);
    }
    const ds = this.game.dungeon;
    for (let i = 0; i < DUNGEON_ITEMS.length; i++) {
      const item = DUNGEON_ITEMS[i]!;
      r.drawSpriteAnim('item', item, 0, FLOOR_COL_X + 7, 150 + i * 18, ds?.[item] === true ? SCREEN : NOT_OWNED);
    }
  }
}

/** Whether a placed entity is in play (a hidden one only after a trigger showed it, and not hidden since). */
function isPresent(g: GameServices, id: string, hidden: boolean): boolean {
  if (g.flag(`hidden:${id}`)) return false;
  return !hidden || g.flag(`shown:${id}`);
}

const ROOM_EDGE = { screen: true, alpha: 0.35 } as const;
const NOT_OWNED = { screen: true, alpha: 0.18 } as const;

/**
 * Faint outline of every screen cell the dungeon spans (the map's paper grid).
 * Drawn every frame, so the loop only visits cells inside the map area, and a
 * grid too fine to see (rooms far apart shrink the scale) is skipped outright.
 */
function drawGrid(r: Renderer, x0: number, y0: number, gw: number, gh: number, k: number): void {
  const o = SCREEN;
  const cw = SCREEN_COLS * k;
  const ch = SCREEN_ROWS * k;
  if (Math.round(cw) < MIN_GRID_CELL || Math.round(ch) < MIN_GRID_CELL) return;
  const a = DUNGEON_AREA;
  const gx0 = Math.max(0, Math.floor((a.x - x0) / cw));
  const gx1 = Math.min(gw, Math.ceil((a.x + a.w - x0) / cw));
  const gy0 = Math.max(0, Math.floor((a.y - y0) / ch));
  const gy1 = Math.min(gh, Math.ceil((a.y + a.h - y0) / ch));
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      r.strokeRect(Math.round(x0 + gx * cw), Math.round(y0 + gy * ch), Math.round(cw), Math.round(ch), '#18204c', o);
    }
  }
}

function drawRoomBlock(r: Renderer, rect: Rect, seen: boolean, current: boolean): void {
  const o = SCREEN;
  const { x, y, w, h } = rect;
  r.fillRect(x, y, w, h, UI.outline, o);
  const fill = current ? '#90a8f0' : seen ? '#5870c0' : '#202a60';
  r.fillRect(x + 1, y + 1, w - 2, h - 2, fill, o);
  if (seen) {
    r.fillRect(x + 1, y + 1, w - 2, 1, current ? '#d0e0f8' : '#88a0e0', o);
    r.fillRect(x + 1, y + 1, 1, h - 2, current ? '#d0e0f8' : '#88a0e0', o);
    r.fillRect(x + 2, y + h - 2, w - 3, 1, '#28306a', o);
  } else {
    r.strokeRect(x + 1, y + 1, w - 2, h - 2, '#4050a0', o);
  }
}

function drawHeroMarker(r: Renderer, x: number, y: number, time: number): void {
  if (Math.floor(time * 4) % 4 === 3) return;
  const o = SCREEN;
  const cx = Math.round(x);
  const cy = Math.round(y);
  r.fillRect(cx - 3, cy - 3, 7, 7, UI.outline, o);
  r.fillRect(cx - 2, cy - 2, 5, 5, UI.green, o);
  r.fillRect(cx - 1, cy - 1, 2, 2, '#d8f8d0', o);
}

/** 7x7 red skull (boss room). */
function drawSkull(r: Renderer, x: number, y: number): void {
  const o = SCREEN;
  r.fillRect(x - 4, y - 4, 9, 9, UI.outline, o);
  r.fillRect(x - 3, y - 3, 7, 5, UI.red, o);
  r.fillRect(x - 2, y + 2, 5, 2, UI.red, o);
  r.fillRect(x - 2, y - 1, 2, 2, UI.outline, o);
  r.fillRect(x + 1, y - 1, 2, 2, UI.outline, o);
  r.fillRect(x - 1, y + 3, 1, 1, UI.outline, o);
  r.fillRect(x + 1, y + 3, 1, 1, UI.outline, o);
}
