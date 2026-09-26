// Room-level operations for the world overview and the Room tab: build a new
// room (fill + optional wall border), add / delete / move / resize rooms. Each
// mutation is one undo step followed by ctx.changed('rooms', id). A resize also
// moves the arrival points into the room (warps, pit targets, the start) with
// its walls, in the same undo step.
import type { Project, Room, TileDef, WarpTarget, World, WorldKind } from '../../core/types';
import type { EditorContext } from '../context';
import type { WallStyle } from './walls';
import { MAX_ROOM_SCREENS } from '../../core/constants';
import { createRoom, findWorld, gridOverlaps, tileById } from '../../core/project';
import { T } from '../../content/ids';
import { editRoom, editRooms, type RoomRef } from './history';
import { dominantTile } from './geometry';
import { remapArrival, resizeWalledRoom, type ResizePlan } from './stretch';
import { TileEdit } from './tileEdit';
import { stampWalls } from './walls';

/** Rooms stay within this many screens of the world origin on each axis (keeps the overview grid a sane size). */
export const GRID_LIMIT = 256;

/** Whether a gw x gh room at (gx, gy) lies within the world grid limits. */
export function withinGrid(gx: number, gy: number, gw = 1, gh = 1): boolean {
  return gx >= -GRID_LIMIT && gy >= -GRID_LIMIT && gx + gw - 1 <= GRID_LIMIT && gy + gh - 1 <= GRID_LIMIT;
}

/** Floor tiles offered for new rooms. */
export const ROOM_FILLS: readonly { key: string; label: string }[] = [
  { key: 'GRASS', label: 'Grass' },
  { key: 'DFLOOR', label: 'Dungeon floor' },
  { key: 'WOOD_FLOOR', label: 'Wood floor' },
  { key: 'CAVE_FLOOR', label: 'Cave floor' },
];

/** Default fill tile key for new rooms in a world of this kind. */
export function defaultFillKey(kind: WorldKind): string {
  return kind === 'dungeon' ? 'DFLOOR' : kind === 'interior' ? 'WOOD_FLOOR' : 'GRASS';
}

export interface RoomSpec {
  name: string;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  floor: number;
  fill: number;
  walls: WallStyle | null;
}

/** A new room from a spec: bg filled, optional one-tile wall border. */
export function buildRoom(spec: RoomSpec): Room {
  const room = createRoom({ name: spec.name, gx: spec.gx, gy: spec.gy, gw: spec.gw, gh: spec.gh, floor: spec.floor, fill: spec.fill });
  if (spec.walls) stampWalls(new TileEdit(room), spec.walls);
  return room;
}

/** "Room N" with the lowest N not already used in the world. */
export function nextRoomName(world: World): string {
  const used = new Set(world.rooms.map((r) => r.name));
  let n = world.rooms.length + 1;
  while (used.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

/** Nearest free grid spot for a gw x gh room on a floor, searching rings around `near`. */
export function freeSpot(world: World, floor: number, gw: number, gh: number, near: { gx: number; gy: number }): { gx: number; gy: number } {
  for (let r = 0; r < 64; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = near.gx + dx;
        const gy = near.gy + dy;
        if (!gridOverlaps(world, gx, gy, gw, gh, floor)) return { gx, gy };
      }
    }
  }
  return { gx: near.gx, gy: near.gy + 64 };
}

/** Insert a room into a world (undoable) and select it. */
export function addRoom(ctx: EditorContext, worldId: string, room: Room): void {
  const snapshot = JSON.stringify(room);
  const prev = ctx.roomId;
  const apply = (forward: boolean): void => {
    const world = findWorld(ctx.project, worldId);
    if (!world) return;
    world.rooms = world.rooms.filter((r) => r.id !== room.id);
    if (forward) world.rooms.push(JSON.parse(snapshot) as Room);
    ctx.changed('rooms', room.id);
    ctx.selectRoom(worldId, forward ? room.id : prev);
  };
  world(ctx, worldId)?.rooms.push(room);
  ctx.undo.push({ label: `Add room “${room.name}”`, undo: () => apply(false), redo: () => apply(true) });
  ctx.changed('rooms', room.id);
  ctx.selectRoom(worldId, room.id);
}

/** The room to show instead of a deleted one: the nearest on its floor, else any other room. */
export function roomAfterDelete(world: World, deleted: Room): Room | undefined {
  const centre = (r: Room): [number, number] => [r.gx + r.gw / 2, r.gy + r.gh / 2];
  const [cx, cy] = centre(deleted);
  const dist = (r: Room): number => {
    const [x, y] = centre(r);
    return Math.hypot(x - cx, y - cy);
  };
  const others = world.rooms.filter((r) => r.id !== deleted.id);
  const same = others.filter((r) => r.floor === deleted.floor).sort((a, b) => dist(a) - dist(b));
  return same[0] ?? others[0];
}

/**
 * Remove a room (undo puts it back at the same index and shows it). When the
 * deleted room is the selected one, the nearest room on its floor is selected.
 */
export function deleteRoom(ctx: EditorContext, worldId: string, roomId: string): void {
  const w = world(ctx, worldId);
  const index = w?.rooms.findIndex((r) => r.id === roomId) ?? -1;
  if (!w || index < 0) return;
  const snapshot = JSON.stringify(w.rooms[index]);
  const name = w.rooms[index]!.name;
  const apply = (forward: boolean): void => {
    const target = world(ctx, worldId);
    if (!target) return;
    const room = target.rooms.find((r) => r.id === roomId);
    const shown = ctx.worldId === worldId && ctx.roomId === roomId;
    const next = forward && shown && room ? roomAfterDelete(target, room) : undefined;
    target.rooms = target.rooms.filter((r) => r.id !== roomId);
    if (!forward) target.rooms.splice(Math.min(index, target.rooms.length), 0, JSON.parse(snapshot) as Room);
    ctx.changed('rooms', roomId);
    if (!forward) ctx.selectRoom(worldId, roomId);
    else if (shown) ctx.selectRoom(worldId, next?.id ?? null);
  };
  apply(true);
  ctx.undo.push({ label: `Delete room “${name}”`, undo: () => apply(false), redo: () => apply(true) });
}

/** Move a room on the world grid; false (unchanged) if it would overlap another room or leave the grid limits. */
export function moveRoom(ctx: EditorContext, worldId: string, roomId: string, gx: number, gy: number, floor?: number): boolean {
  const w = world(ctx, worldId);
  const room = w?.rooms.find((r) => r.id === roomId);
  if (!w || !room || !withinGrid(gx, gy, room.gw, room.gh)) return false;
  const f = floor ?? room.floor;
  if (gridOverlaps(w, gx, gy, room.gw, room.gh, f, room.id)) return false;
  return editRoom(ctx, worldId, roomId, 'Move room', 'rooms', (r) => {
    r.gx = gx;
    r.gy = gy;
    r.floor = f;
  });
}

/**
 * Resize a room in screens. Walled rooms move their right / bottom walls (see
 * resizeWalledRoom); other rooms keep their content anchored top-left. New
 * ground cells get the room's most common floor tile. False if the new size
 * would overlap another room.
 */
export function resizeRoomUndoable(ctx: EditorContext, worldId: string, roomId: string, gw: number, gh: number): boolean {
  const w = world(ctx, worldId);
  const room = w?.rooms.find((r) => r.id === roomId);
  if (!w || !room) return false;
  const nw = Math.min(MAX_ROOM_SCREENS, Math.max(1, Math.round(gw)));
  const nh = Math.min(MAX_ROOM_SCREENS, Math.max(1, Math.round(gh)));
  if (nw === room.gw && nh === room.gh) return false;
  if (gridOverlaps(w, room.gx, room.gy, nw, nh, room.floor, room.id)) return false;
  const p = ctx.project;
  const hosts = arrivals(p, worldId, roomId);
  const rooms: RoomRef[] = [{ world: worldId, room: roomId }];
  for (const h of hosts) if (h.host && !rooms.some((r) => r.world === h.host!.world && r.room === h.host!.room)) rooms.push(h.host);
  return editRooms(ctx, 'Resize room', 'rooms', rooms, hosts.some((h) => !h.host), () => {
    const plan = applyResize(p, room, nw, nh);
    for (const { target } of arrivals(p, worldId, roomId)) Object.assign(target, remapArrival(target.x, target.y, plan));
  });
}

/** An arrival point into a room, and the room holding it (null = the project start). */
interface Arrival {
  target: WarpTarget;
  host: RoomRef | null;
}

const isWarpTarget = (v: unknown): v is WarpTarget =>
  typeof v === 'object' && v !== null && typeof (v as WarpTarget).room === 'string' && typeof (v as WarpTarget).x === 'number';

/** Every arrival point into a room: warp props of entities and warp actions of triggers (in any room), pit targets and the start. */
export function arrivals(project: Project, worldId: string, roomId: string): Arrival[] {
  const out: Arrival[] = [];
  const add = (t: unknown, host: RoomRef | null): void => {
    if (isWarpTarget(t) && t.world === worldId && t.room === roomId) out.push({ target: t, host });
  };
  for (const w of project.worlds) {
    for (const r of w.rooms) {
      const host = { world: w.id, room: r.id };
      for (const e of r.entities) for (const v of Object.values(e.props)) add(v, host);
      for (const t of r.triggers) for (const a of t.actions) if (a.kind === 'warp') add(a.target, host);
      add(r.pitTarget, host);
    }
  }
  add(project.start, null);
  return out;
}

/** What a resize would drop or adjust: entities, painted tiles (not plain floor or walls), trigger tile changes, moved arrival points. */
export interface ResizeLoss {
  entities: number;
  tiles: number;
  /** Trigger "set tile" actions whose cell is removed. */
  actions: number;
  /** Arrival points into the room (warps, pit targets, the start) that move with its walls. */
  arrivals: number;
}

/** Dry-run a resize to gw x gh screens (already clamped) and count what it would remove or move. */
export function resizeLoss(project: Project, room: Room, gw: number, gh: number): ResizeLoss {
  const after = JSON.parse(JSON.stringify(room)) as Room;
  const plan = applyResize(project, after, gw, gh);
  const worldId = project.worlds.find((w) => w.rooms.includes(room) || w.rooms.some((r) => r.id === room.id))?.id;
  const moved = worldId === undefined ? 0 : arrivals(project, worldId, room.id).filter(({ target: t }) => {
    const m = remapArrival(t.x, t.y, plan);
    return m.x !== t.x || m.y !== t.y;
  }).length;
  const setTiles = (r: Room): number => r.triggers.reduce((n, t) => n + t.actions.filter((a) => a.kind === 'setTile').length, 0);
  const fill = floorFill(project, room);
  const isWall = (id: number): boolean => !!tileById(project, id)?.tags.includes('wall');
  const painted = (r: Room): number => {
    let n = r.layers.fg.filter((id) => id !== 0).length + r.layers.over.filter((id) => id !== 0).length;
    for (const id of r.layers.bg) if (id !== 0 && id !== fill && !isWall(id)) n++;
    return n;
  };
  const kept = new Set(after.entities.map((e) => e.id));
  return {
    entities: room.entities.filter((e) => !kept.has(e.id)).length,
    tiles: Math.max(0, painted(room) - painted(after)),
    actions: setTiles(room) - setTiles(after),
    arrivals: moved,
  };
}

/** The room's most common floor tile (never void or a wall): new ground cells get it. */
function floorFill(project: Project, room: Room): number {
  return dominantTile(room.layers.bg, (id) => id === 0 || !!tileById(project, id)?.tags.includes('wall')) || (T.GRASS ?? 0);
}

function applyResize(project: Project, room: Room, gw: number, gh: number): ResizePlan {
  const tile = (id: number): TileDef | undefined => tileById(project, id);
  return resizeWalledRoom(room, gw, gh, floorFill(project, room), tile);
}

function world(ctx: EditorContext, worldId: string): World | undefined {
  return findWorld(ctx.project, worldId);
}

/** Label of a floor index: 0 -> "1F", 1 -> "2F", -1 -> "B1". */
export function floorLabel(floor: number): string {
  return floor >= 0 ? `${floor + 1}F` : `B${-floor}`;
}
