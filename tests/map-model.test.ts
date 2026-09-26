// Map editor: view math, room/world operations, undo helpers, overview layout
// and palette grouping.
import { describe, expect, it } from 'vitest';
import type { Collision, Project, Room, TileDef } from '../src/core/types';
import type { EditorContext, ProjectChange } from '../src/editor/context';
import { createBlankProject, createRoom, createWorld, findRoom, roomCols, roomRows } from '../src/core/project';
import { T, TILE_SPECS } from '../src/content/ids';
import { UndoStack } from '../src/editor/undo';
import { clampZoom, deviceScale, fitView, stepZoom, toArt, zoomAround } from '../src/editor/map/viewMath';
import { addRoom, buildRoom, deleteRoom, floorLabel, freeSpot, moveRoom, nextRoomName, resizeLoss, resizeRoomUndoable } from '../src/editor/map/roomOps';
import { addWorld, buildWorld, deleteWorld, moveWorld, renameWorld } from '../src/editor/map/worldOps';
import { isSeam } from '../src/editor/map/stretch';
import { detectWalls, WALL_SETS } from '../src/editor/map/walls';
import { MergingEntityEdit, MergingRoomEdit, commitTiles, editEntities } from '../src/editor/map/history';
import { overviewBounds } from '../src/editor/map/worldOverview';
import { floorChoices } from '../src/editor/map/worldPanel';
import { groupTiles, tileMatches } from '../src/editor/map/tilePalette';
import { ArtWatch } from '../src/editor/map/artStamp';

const SPECS = new Map(TILE_SPECS.map((s) => [s.id, s] as const));
const specOf = (id: number): { tags: readonly string[]; collision: Collision } | undefined => SPECS.get(id);

/** Minimal EditorContext over a project: real undo stack, recorded change events. */
function fakeCtx(project: Project): EditorContext & { events: ProjectChange[] } {
  let worldId = project.worlds[0]!.id;
  let roomId: string | null = project.worlds[0]!.rooms[0]?.id ?? null;
  const events: ProjectChange[] = [];
  const ctx = {
    project,
    undo: new UndoStack(),
    events,
    get worldId() { return worldId; },
    get roomId() { return roomId; },
    changed: (what: ProjectChange) => { events.push(what); },
    selectRoom: (w: string, r: string | null) => { worldId = w; roomId = r; },
    world: () => project.worlds.find((w) => w.id === worldId)!,
    room: () => (roomId ? findRoom(project, worldId, roomId) ?? null : null),
  };
  return ctx as unknown as EditorContext & { events: ProjectChange[] };
}

describe('view math', () => {
  it('uses integer device scales from 100% up and snaps zoom to the supported levels', () => {
    expect(deviceScale(2, 1)).toBe(2);
    expect(deviceScale(2, 1.25)).toBe(3);
    expect(deviceScale(0.5, 1)).toBe(0.5);
    expect(deviceScale(0.5, 2)).toBe(1);
    expect(clampZoom(0)).toBe(0.25);
    expect(clampZoom(0.6)).toBe(0.5);
    expect(clampZoom(2.4)).toBe(2);
    expect(clampZoom(9)).toBe(6);
  });

  it('steps through the zoom levels and stops at both ends', () => {
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(0.5, 1)).toBe(1);
    expect(stepZoom(2, 1)).toBe(3);
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(6, 2)).toBe(6);
  });

  it('zooming keeps the art pixel under the cursor in place', () => {
    const v = { zoom: 2, panX: 40, panY: 30 };
    const before = toArt(v, 1, 300, 200);
    const next = zoomAround(v, 4, 1, 300, 200);
    const after = toArt(next, 1, 300, 200);
    expect(next.zoom).toBe(4);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('fit picks the largest zoom that shows the room and centres it', () => {
    const v = fitView(256, 224, 544, 709, 1, 12);
    expect(v.zoom).toBe(2);
    expect(v.panX).toBe(16);
    expect(fitView(512, 448, 544, 709, 1, 12).zoom).toBe(1);
    const big = fitView(1024, 896, 544, 709, 1, 12);
    expect(big.zoom).toBe(0.5);
    expect(big.panX).toBe(16);
  });
});

describe('room operations', () => {
  it('builds walled rooms with the right corner pieces and floor inside', () => {
    const r = buildRoom({ name: 'D', gx: 0, gy: 0, gw: 2, gh: 1, floor: 0, fill: T.DFLOOR!, walls: 'dungeon' });
    const cols = roomCols(r);
    const rows = roomRows(r);
    const w = WALL_SETS.dungeon;
    expect(r.layers.bg[0]).toBe(w.tl);
    expect(r.layers.bg[cols - 1]).toBe(w.tr);
    expect(r.layers.bg[(rows - 1) * cols]).toBe(w.bl);
    expect(r.layers.bg[5]).toBe(w.top);
    expect(r.layers.bg[cols + 5]).toBe(T.DFLOOR);
    expect(detectWalls(r)).toBe('dungeon');
    expect(detectWalls(buildRoom({ name: 'G', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, fill: T.GRASS!, walls: null }))).toBeNull();
  });

  it('finds free grid spots, names rooms and labels floors', () => {
    const world = createWorld({ name: 'W', kind: 'dungeon' });
    world.rooms.push(createRoom({ name: 'Room 1', gx: 0, gy: 0, gw: 2, gh: 1 }));
    expect(freeSpot(world, 0, 1, 1, { gx: 0, gy: 0 })).not.toEqual({ gx: 0, gy: 0 });
    expect(freeSpot(world, 0, 1, 1, { gx: 2, gy: 0 })).toEqual({ gx: 2, gy: 0 });
    expect(freeSpot(world, 1, 1, 1, { gx: 0, gy: 0 })).toEqual({ gx: 0, gy: 0 });
    expect(nextRoomName(world)).toBe('Room 2');
    expect([floorLabel(0), floorLabel(2), floorLabel(-1)]).toEqual(['1F', '3F', 'B1']);
  });

  it('add / delete / move rooms are single undo steps', () => {
    const p = createBlankProject('T');
    const ctx = fakeCtx(p);
    const world = p.worlds[0]!;
    const room = buildRoom({ name: 'East', gx: 1, gy: 0, gw: 1, gh: 1, floor: 0, fill: T.GRASS!, walls: null });
    addRoom(ctx, world.id, room);
    expect(world.rooms).toHaveLength(2);
    expect(ctx.roomId).toBe(room.id);
    expect(moveRoom(ctx, world.id, room.id, 0, 0)).toBe(false); // would overlap the start room
    expect(moveRoom(ctx, world.id, room.id, 0, 1)).toBe(true);
    expect(findRoom(p, world.id, room.id)).toMatchObject({ gx: 0, gy: 1 });
    ctx.undo.undo();
    expect(findRoom(p, world.id, room.id)).toMatchObject({ gx: 1, gy: 0 });
    deleteRoom(ctx, world.id, room.id);
    expect(world.rooms).toHaveLength(1);
    ctx.undo.undo();
    expect(p.worlds[0]!.rooms.map((r) => r.name)).toEqual(['Start', 'East']);
    ctx.undo.undo(); // (move was undone already) -> undo the add
    expect(p.worlds[0]!.rooms).toHaveLength(1);
  });

  it('resizing re-stamps a wall border at the new size and refuses overlaps', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const room = buildRoom({ name: 'D', gx: 0, gy: 1, gw: 1, gh: 1, floor: 0, fill: T.DFLOOR!, walls: 'dungeon' });
    world.rooms.push(room);
    const ctx = fakeCtx(p);
    expect(resizeRoomUndoable(ctx, world.id, room.id, 1, 2)).toBe(true);
    const r = findRoom(p, world.id, room.id)!;
    expect(roomRows(r)).toBe(28);
    expect(detectWalls(r)).toBe('dungeon');
    expect(r.layers.bg[13 * 16 + 5]).toBe(T.DFLOOR); // the old bottom wall became floor
    expect(resizeRoomUndoable(ctx, world.id, room.id, 1, 1)).toBe(true);
    world.rooms.push(createRoom({ name: 'X', gx: 1, gy: 1 }));
    expect(resizeRoomUndoable(ctx, world.id, room.id, 2, 1)).toBe(false);
  });

  it('resizing a real dungeon room moves its far walls with their doorways, and shrinking undoes it', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const room = buildRoom({ name: 'Hall', gx: 0, gy: 1, gw: 1, gh: 1, floor: 0, fill: T.DFLOOR!, walls: 'dungeon' });
    const set = (tx: number, ty: number, id: number): void => { room.layers.bg[ty * 16 + tx] = id; };
    set(7, 0, T.DFLOOR!); set(8, 0, T.DFLOOR!); // doorway in the top wall
    set(15, 6, T.DFLOOR!); set(15, 7, T.DFLOOR!); // doorway in the right wall
    set(3, 3, T.DPOT!);
    set(5, 12, T.CARPET!); set(4, 12, T.DPOT!); // a carpet and a pot on the bottom-most interior row
    room.entities.push({ id: 'door', type: 'obj.door', x: 248, y: 112, props: { dir: 'right' } }, { id: 'bat', type: 'enemy.bat', x: 56, y: 56, props: {} });
    room.triggers.push({ id: 't', name: 'Open', on: 'auto', once: false, conditions: [], actions: [{ kind: 'setTile', layer: 'bg', tx: 15, ty: 6, tile: T.DFLOOR! }] });
    world.rooms.push(room);
    const original = JSON.stringify(room);
    const ctx = fakeCtx(p);
    expect(resizeRoomUndoable(ctx, world.id, room.id, 2, 1)).toBe(true);
    const r = findRoom(p, world.id, room.id)!;
    const bg = (tx: number, ty: number): number => r.layers.bg[ty * roomCols(r) + tx]!;
    expect(roomCols(r)).toBe(32);
    expect([bg(7, 0), bg(8, 0), bg(20, 0), bg(31, 0)]).toEqual([T.DFLOOR, T.DFLOOR, T.DWALL_TOP, T.DWALL_TR]);
    expect([bg(15, 13), bg(31, 13)]).toEqual([T.DWALL_BOTTOM, T.DWALL_BR]);
    expect([bg(15, 5), bg(31, 5), bg(31, 6), bg(31, 7)]).toEqual([T.DFLOOR, T.DWALL_RIGHT, T.DFLOOR, T.DFLOOR]);
    expect(bg(3, 3)).toBe(T.DPOT);
    expect(r.entities.find((e) => e.id === 'door')).toMatchObject({ x: 248 + 256, y: 112 });
    expect(r.entities.find((e) => e.id === 'bat')).toMatchObject({ x: 56, y: 56 });
    expect(r.triggers[0]!.actions[0]).toMatchObject({ tx: 31, ty: 6 });
    expect(resizeRoomUndoable(ctx, world.id, room.id, 2, 2)).toBe(true);
    expect([bg(0, 27), bg(10, 27), bg(31, 27), bg(10, 13), bg(0, 20), bg(31, 20)]).toEqual(
      [T.DWALL_BL, T.DWALL_BOTTOM, T.DWALL_BR, T.DFLOOR, T.DWALL_LEFT, T.DWALL_RIGHT]);
    expect([bg(5, 20), bg(4, 20), bg(4, 12)]).toEqual([T.CARPET, T.DFLOOR, T.DPOT]); // the carpet runs on, the pot is not cloned
    expect(resizeRoomUndoable(ctx, world.id, room.id, 1, 1)).toBe(true);
    expect(JSON.stringify(findRoom(p, world.id, room.id))).toBe(original);
  });

  it('resizing a house keeps the void around it, its windows and its exit on the bottom wall', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const room = createRoom({ name: 'House', gx: 0, gy: 1, fill: 0 });
    const set = (tx: number, ty: number, id: number): void => { room.layers.bg[ty * 16 + tx] = id; };
    for (let ty = 2; ty <= 11; ty++) for (let tx = 3; tx <= 12; tx++) set(tx, ty, T.WOOD_FLOOR!);
    for (let tx = 4; tx <= 11; tx++) { set(tx, 2, T.IWALL_TOP!); set(tx, 11, T.IWALL_BOTTOM!); }
    for (let ty = 3; ty <= 10; ty++) { set(3, ty, T.IWALL_LEFT!); set(12, ty, T.IWALL_RIGHT!); }
    set(3, 2, T.IWALL_TL!); set(12, 2, T.IWALL_TR!); set(3, 11, T.IWALL_BL!); set(12, 11, T.IWALL_BR!);
    set(5, 2, T.IWALL_WINDOW!); set(7, 11, T.WOOD_FLOOR!); set(8, 11, T.WOOD_FLOOR!); // window, exit gap
    world.rooms.push(room);
    const ctx = fakeCtx(p);
    expect(resizeRoomUndoable(ctx, world.id, room.id, 1, 2)).toBe(true);
    const r = findRoom(p, world.id, room.id)!;
    const bg = (tx: number, ty: number): number => r.layers.bg[ty * 16 + tx]!;
    expect([bg(3, 25), bg(7, 25), bg(9, 25), bg(12, 25)]).toEqual([T.IWALL_BL, T.WOOD_FLOOR, T.IWALL_BOTTOM, T.IWALL_BR]);
    expect([bg(3, 18), bg(6, 18), bg(12, 18), bg(1, 18), bg(14, 18)]).toEqual([T.IWALL_LEFT, T.WOOD_FLOOR, T.IWALL_RIGHT, 0, 0]);
    expect([bg(5, 2), bg(6, 26), bg(6, 27)]).toEqual([T.IWALL_WINDOW, 0, 0]);
    expect(resizeRoomUndoable(ctx, world.id, room.id, 2, 2)).toBe(true);
    const wide = findRoom(p, world.id, room.id)!;
    const at2 = (tx: number, ty: number): number => wide.layers.bg[ty * 32 + tx]!;
    expect([at2(28, 10), at2(20, 2), at2(29, 10), at2(31, 10)]).toEqual([T.IWALL_RIGHT, T.IWALL_TOP, 0, 0]);
  });

  it('rooms without walls keep resizing anchored top-left', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const ctx = fakeCtx(p);
    const room = world.rooms[0]!;
    room.layers.bg[15] = T.SAND!;
    expect(resizeRoomUndoable(ctx, world.id, room.id, 2, 1)).toBe(true);
    const r = findRoom(p, world.id, room.id)!;
    expect(r.layers.bg[15]).toBe(T.SAND);
    expect(r.layers.bg[31]).toBe(T.GRASS);
  });

  it('a dry-run shrink counts the entities and painted tiles it would drop, never plain floor or walls', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const ctx = fakeCtx(p);
    const id = world.rooms[0]!.id;
    expect(resizeRoomUndoable(ctx, world.id, id, 2, 1)).toBe(true);
    const r = findRoom(p, world.id, id)!;
    r.layers.fg[3 * 32 + 20] = T.BUSH!; // right screen: dropped
    r.layers.bg[4 * 32 + 22] = T.SAND!; // right screen: dropped
    r.layers.bg[5 * 32 + 2] = T.SAND!; // left screen: kept
    r.entities.push(
      { id: 'far', type: 'enemy.bat', x: 300, y: 40, props: {} },
      { id: 'near', type: 'enemy.bat', x: 40, y: 40, props: {} },
    );
    const before = JSON.stringify(r);
    expect(resizeLoss(p, r, 1, 1)).toEqual({ entities: 1, tiles: 2, actions: 0, arrivals: 0 });
    expect(resizeLoss(p, r, 2, 2)).toEqual({ entities: 0, tiles: 0, actions: 0, arrivals: 0 });
    expect(JSON.stringify(r)).toBe(before); // a dry run leaves the room alone
    const hall = buildRoom({ name: 'Hall', gx: 5, gy: 5, gw: 2, gh: 1, floor: 0, fill: T.DFLOOR!, walls: 'dungeon' });
    expect(resizeLoss(p, hall, 1, 1)).toEqual({ entities: 0, tiles: 0, actions: 0, arrivals: 0 }); // only floor and wall copies go
  });

  it('seams cross the interior between plain wall faces only', () => {
    const F = T.DFLOOR!;
    expect(isSeam([T.DWALL_TOP!, F, F, T.DWALL_BOTTOM!], true, specOf)).toBe(true);
    expect(isSeam([0, T.IWALL_TOP!, T.WOOD_FLOOR!, T.IWALL_BOTTOM!, 0], true, specOf)).toBe(true);
    expect(isSeam([F, F, F, T.DWALL_BOTTOM!], true, specOf)).toBe(false); // doorway in the top wall
    expect(isSeam([T.DWALL_TR!, T.DWALL_RIGHT!, T.DWALL_BR!], true, specOf)).toBe(false); // the right wall itself
    expect(isSeam([T.IWALL_WINDOW!, T.WOOD_FLOOR!, T.IWALL_BOTTOM!], true, specOf)).toBe(false);
    expect(isSeam([0, 0, 0], true, specOf)).toBe(false);
    expect(isSeam([T.DWALL_LEFT!, F, T.DWALL_RIGHT!], false, specOf)).toBe(true);
    expect(isSeam([T.DWALL_LEFT!, F, T.DWALL_RIGHT!], true, specOf)).toBe(false);
  });

  it('deleting the shown room selects its nearest neighbour, also on redo', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const near = createRoom({ name: 'Near', gx: 1, gy: 0 });
    const far = createRoom({ name: 'Far', gx: 5, gy: 0 });
    const doomed = createRoom({ name: 'Doomed', gx: 2, gy: 0 });
    world.rooms.push(far, near, doomed);
    const ctx = fakeCtx(p);
    ctx.selectRoom(world.id, doomed.id);
    deleteRoom(ctx, world.id, doomed.id);
    expect(ctx.roomId).toBe(near.id);
    ctx.undo.undo();
    expect(ctx.roomId).toBe(doomed.id);
    ctx.undo.redo();
    expect(ctx.roomId).toBe(near.id);
    ctx.undo.undo();
    ctx.selectRoom(world.id, far.id);
    ctx.undo.redo();
    expect(ctx.roomId).toBe(far.id); // deleting another room keeps the selection
  });

  it('new worlds come with a starter room (walled for dungeons)', () => {
    const d = buildWorld('Crypt', 'dungeon', 'dungeon');
    expect(d.rooms).toHaveLength(1);
    expect(detectWalls(d.rooms[0]!)).toBe('dungeon');
    expect(detectWalls(buildWorld('Land', 'overworld', 'overworld').rooms[0]!)).toBeNull();
    expect(detectWalls(buildWorld('Inn', 'interior', 'house').rooms[0]!)).toBe('house');
  });
});

describe('world operations', () => {
  function threeWorlds(): { p: Project; ctx: ReturnType<typeof fakeCtx>; ids: string[] } {
    const p = createBlankProject('T');
    p.worlds.push(buildWorld('Keep', 'dungeon', 'dungeon'), buildWorld('Homes', 'interior', 'house'));
    return { p, ctx: fakeCtx(p), ids: p.worlds.map((w) => w.id) };
  }

  it('deleting another world keeps the selection; deleting the shown one moves to its neighbour', () => {
    const { p, ctx, ids } = threeWorlds();
    const sel = { w: ctx.worldId, r: ctx.roomId };
    expect(deleteWorld(ctx, ids[1]!)).toBe(true);
    expect({ w: ctx.worldId, r: ctx.roomId }).toEqual(sel);
    ctx.undo.undo();
    expect(p.worlds.map((w) => w.id)).toEqual(ids);
    expect({ w: ctx.worldId, r: ctx.roomId }).toEqual(sel);
    ctx.selectRoom(ids[1]!, p.worlds[1]!.rooms[0]!.id);
    deleteWorld(ctx, ids[1]!);
    expect(ctx.worldId).toBe(ids[2]);
    expect(ctx.roomId).toBe(p.worlds[1]!.rooms[0]!.id);
    ctx.undo.undo();
    expect(ctx.worldId).toBe(ids[1]);
    ctx.undo.redo();
    expect(ctx.worldId).toBe(ids[2]);
  });

  it('rename, reorder and add are small steps that keep the other World objects', () => {
    const { p, ctx, ids } = threeWorlds();
    const keep = p.worlds[1]!;
    const room = keep.rooms[0]!;
    renameWorld(ctx, keep.id, '  Hollow  ');
    moveWorld(ctx, keep.id, -1);
    expect(p.worlds.map((w) => w.id)).toEqual([ids[1], ids[0], ids[2]]);
    expect(keep.name).toBe('Hollow');
    const added = addWorld(ctx, 'Wilds', 'overworld', 'overworld');
    expect(ctx.worldId).toBe(added.id);
    ctx.undo.undo();
    expect(p.worlds).toHaveLength(3);
    expect(ctx.worldId).toBe(ids[0]);
    ctx.undo.undo();
    ctx.undo.undo();
    expect(p.worlds.map((w) => w.id)).toEqual(ids);
    expect(p.worlds[1]).toBe(keep);
    expect(p.worlds[1]!.rooms[0]).toBe(room);
    expect(keep.name).toBe('Keep');
    ctx.undo.redo();
    expect(keep.name).toBe('Hollow');
  });
});

describe('undo helpers', () => {
  it('commitTiles records applied tile changes as one step', () => {
    const p = createBlankProject('T');
    const ctx = fakeCtx(p);
    const room = p.worlds[0]!.rooms[0]!;
    const before = room.layers.bg[0];
    room.layers.bg[0] = T.SAND!;
    room.layers.bg[1] = T.SAND!;
    commitTiles(ctx, p.worlds[0]!.id, room.id, 'Paint', [
      { layer: 'bg', index: 0, before: before!, after: T.SAND! },
      { layer: 'bg', index: 1, before: before!, after: T.SAND! },
    ]);
    expect(ctx.undo.peekUndo()).toBe('Paint');
    ctx.undo.undo();
    expect(room.layers.bg.slice(0, 2)).toEqual([before, before]);
    ctx.undo.redo();
    expect(room.layers.bg.slice(0, 2)).toEqual([T.SAND, T.SAND]);
    expect(ctx.events.every((e) => e === 'room')).toBe(true);
  });

  it('consecutive nudges of one entity merge into a single undo step', () => {
    const p = createBlankProject('T');
    const ctx = fakeCtx(p);
    const w = p.worlds[0]!.id;
    const room: Room = p.worlds[0]!.rooms[0]!;
    editEntities(ctx, w, room.id, 'Place', (r) => r.entities.push({ id: 'e1', type: 'obj.pot', x: 40, y: 40, props: {} }));
    const merge = new MergingEntityEdit(ctx);
    for (let i = 0; i < 5; i++) merge.run(w, room.id, 'nudge:e1', 'Nudge', (r) => { r.entities[0]!.x += 1; });
    expect(findRoom(p, w, room.id)!.entities[0]!.x).toBe(45);
    ctx.undo.undo();
    expect(findRoom(p, w, room.id)!.entities[0]!.x).toBe(40);
    ctx.undo.redo();
    expect(findRoom(p, w, room.id)!.entities[0]!.x).toBe(45);
    ctx.undo.undo();
    ctx.undo.undo();
    expect(findRoom(p, w, room.id)!.entities).toHaveLength(0);
    merge.dispose();
  });

  it('merged room edits (arrowing through a list) are one undo step', () => {
    const p = createBlankProject('T');
    const ctx = fakeCtx(p);
    const w = p.worlds[0]!.id;
    const room = p.worlds[0]!.rooms[0]!;
    const merge = new MergingRoomEdit(ctx);
    const before = room.music;
    for (const music of ['dungeon', 'house', 'cave'] as const) merge.run(w, room.id, 'music', 'Room music', 'room', (r) => { r.music = music; });
    expect(room.music).toBe('cave');
    ctx.undo.undo();
    expect(room.music).toBe(before);
    expect(ctx.undo.canUndo()).toBe(false);
    ctx.undo.redo();
    expect(room.music).toBe('cave');
    merge.dispose();
  });

  it('undo and redo show the room they change', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const other = createRoom({ name: 'Other', gx: 1, gy: 0 });
    world.rooms.push(other);
    const ctx = fakeCtx(p);
    const first = world.rooms[0]!.id;
    other.layers.bg[0] = T.SAND!;
    commitTiles(ctx, world.id, other.id, 'Paint', [{ layer: 'bg', index: 0, before: T.GRASS!, after: T.SAND! }]);
    editEntities(ctx, world.id, other.id, 'Place', (r) => r.entities.push({ id: 'e1', type: 'obj.pot', x: 8, y: 8, props: {} }));
    ctx.selectRoom(world.id, first);
    ctx.undo.undo();
    expect(ctx.roomId).toBe(other.id);
    expect(other.entities).toHaveLength(0);
    ctx.selectRoom(world.id, first);
    ctx.undo.undo();
    expect(ctx.roomId).toBe(other.id);
    expect(other.layers.bg[0]).toBe(T.GRASS);
    ctx.selectRoom(world.id, first);
    ctx.undo.redo();
    expect(ctx.roomId).toBe(other.id);
  });
});

describe('tile art watch', () => {
  it('reports exactly the tiles whose pixels, collision or palette changed, never room edits', () => {
    const p = createBlankProject('T');
    const watch = new ArtWatch(() => p);
    p.worlds[0]!.rooms[0]!.layers.bg[0] = T.SAND!;
    expect(watch.changedTiles()).toEqual([]);
    const tile = p.tiles[0]!;
    tile.frames = [tile.frames[0]!.replace(/./, (c) => (c === '1' ? '2' : '1')), ...tile.frames.slice(1)];
    expect(watch.changedTiles()).toEqual([tile.id]);
    expect(watch.changedTiles()).toEqual([]);
    tile.collision = tile.collision === 'solid' ? 'floor' : 'solid';
    expect(watch.changedTiles()).toEqual([tile.id]);
    const palette = p.palettes.find((pl) => pl.id === tile.palette)!;
    palette.colors[1] = '#123456';
    const users = p.tiles.filter((t) => t.palette === palette.id).map((t) => t.id);
    expect(watch.changedTiles().sort((a, b) => a - b)).toEqual(users.sort((a, b) => a - b));
    const removed = p.tiles.pop()!;
    expect(watch.changedTiles()).toEqual([removed.id]);
    p.tiles.push(removed);
    expect(watch.changedTiles()).toEqual([removed.id]);
    watch.reset();
    expect(watch.changedTiles()).toEqual([]);
  });
});

describe('overview & palette', () => {
  it('overview bounds wrap the rooms with a margin', () => {
    expect(overviewBounds([])).toEqual({ x0: -1, y0: -1, cols: 5, rows: 4 });
    const rooms = [createRoom({ name: 'a', gx: 0, gy: 0, gw: 2 }), createRoom({ name: 'b', gx: 5, gy: 3 })];
    expect(overviewBounds(rooms)).toEqual({ x0: -1, y0: -1, cols: 8, rows: 6 });
  });

  it('floor choices include used floors plus one above and below', () => {
    const world = createWorld({ name: 'W', kind: 'dungeon' });
    world.rooms.push(createRoom({ name: 'a', gx: 0, gy: 0, floor: 0 }), createRoom({ name: 'b', gx: 0, gy: 0, floor: -1 }));
    expect(floorChoices(world, 0)).toEqual([1, 0, -1, -2]);
  });

  it('floor choices list only floors in use (+ the next ones), never the whole range between far floors', () => {
    const world = createWorld({ name: 'W', kind: 'dungeon' });
    world.rooms.push(createRoom({ name: 'a', gx: 0, gy: 0, floor: 99 }), createRoom({ name: 'b', gx: 0, gy: 0, floor: -99 }));
    expect(floorChoices(world, 0)).toEqual([99, 1, 0, -1, -99]);
    expect(floorChoices(world, 99)).toEqual([99, 98, -99]);
    world.rooms.push(createRoom({ name: 'c', gx: 0, gy: 0, floor: 5 }));
    expect(floorChoices(world, 5)).toEqual([99, 6, 5, 4, -99]);
  });

  it('groups tiles by tag with autotile pieces last, and searches name/key/tag/id', () => {
    const tile = (id: number, tags: string[], name = `t${id}`): TileDef => ({ id, key: name.toUpperCase(), name, palette: 'p', frames: [], collision: 'floor', tags });
    const tiles = [tile(3, ['dungeon', 'wall']), tile(1, ['overworld', 'ground'], 'grass'), tile(2, ['overworld']), tile(4, ['overworld', 'water']), tile(9, ['zzz'])];
    const groups = groupTiles(tiles, new Set([4]));
    expect(groups.map((g) => g.tag)).toEqual(['overworld', 'dungeon', 'zzz']);
    expect(groups[0]!.subs.map((s) => s.tag)).toEqual(['ground', 'general', 'autotile pieces']);
    expect(groups[0]!.count).toBe(3);
    expect(tileMatches(tiles[1]!, 'GRA')).toBe(true);
    expect(tileMatches(tiles[1]!, '1')).toBe(true);
    expect(tileMatches(tiles[1]!, 'wall')).toBe(false);
    expect(tileMatches(tiles[0]!, 'wall')).toBe(true);
    expect(groupTiles(tiles, new Set(), 'dungeon').map((g) => g.tag)).toEqual(['dungeon', 'overworld', 'zzz']);
  });
});
