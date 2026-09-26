// Map editor quality-pass regressions: walled shrinks drop trigger tile targets
// on removed lines (and the confirm counts them), resizes move the arrival
// points into the room with its walls (one undo step), the tile clipboard never
// pastes tile ids the project lacks, thumbnails of deleted rooms are dropped,
// the world grid limit, and a dungeon's prize name.
import { describe, expect, it } from 'vitest';
import type { Project, Room, TileDef } from '../src/core/types';
import type { EditorContext, ProjectChange } from '../src/editor/context';
import { USER_TILE_BASE, createBlankProject, findRoom, locateRoom, tileById } from '../src/core/project';
import { T } from '../src/content/ids';
import { validateProject } from '../src/core/validate';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { UndoStack } from '../src/editor/undo';
import { GRID_LIMIT, arrivals, moveRoom, resizeLoss, resizeRoomUndoable, withinGrid } from '../src/editor/map/roomOps';
import { remapArrival, resizeWalledRoom, type ResizePlan } from '../src/editor/map/stretch';
import { buildWorld, setWorldPrize } from '../src/editor/map/worldOps';
import { copyRegion, pasteClip, planPaste } from '../src/editor/map/clipboard';
import { TileEdit } from '../src/editor/map/tileEdit';
import { ThumbCache } from '../src/editor/map/thumbs';

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
    assetsChanged: () => {},
    selectRoom: (w: string, r: string | null) => { worldId = w; roomId = r; },
    world: () => project.worlds.find((w) => w.id === worldId)!,
    room: () => (roomId ? findRoom(project, worldId, roomId) ?? null : null),
  };
  return ctx as unknown as EditorContext & { events: ProjectChange[] };
}

const setTiles = (room: Room): { tx: number; ty: number }[] =>
  room.triggers.flatMap((t) => t.actions.flatMap((a) => (a.kind === 'setTile' ? [{ tx: a.tx, ty: a.ty }] : [])));

describe('walled room shrink and trigger tile targets', () => {
  it('drops set-tile actions on removed columns instead of moving them onto the new wall, and counts them first', () => {
    const p = createBlankProject('T');
    const w = buildWorld('Crypt', 'dungeon', 'dungeon');
    p.worlds.push(w);
    const room = w.rooms[0]!;
    const look = (id: number): TileDef | undefined => tileById(p, id);
    resizeWalledRoom(room, 2, 1, T.DFLOOR!, look);
    room.triggers.push({
      id: 't1', name: 'Open east', on: 'enter', conditions: [], once: false,
      actions: [
        { kind: 'setTile', layer: 'bg', tx: 15, ty: 7, tile: 0 }, // removed band
        { kind: 'setTile', layer: 'bg', tx: 20, ty: 7, tile: 0 }, // removed band
        { kind: 'setTile', layer: 'bg', tx: 31, ty: 7, tile: 0 }, // the wall: moves with it
        { kind: 'setTile', layer: 'bg', tx: 3, ty: 7, tile: 0 }, // kept
        { kind: 'openDoor', target: 'x' },
      ],
    });
    room.entities.push({ id: 'e_torch', type: 'obj.torch', x: 20 * 16 + 8, y: 3 * 16 + 8, props: {} });
    expect(resizeLoss(p, room, 1, 1)).toMatchObject({ entities: 1, actions: 2 });
    resizeWalledRoom(room, 1, 1, T.DFLOOR!, look);
    expect(setTiles(room)).toEqual([{ tx: 15, ty: 7 }, { tx: 3, ty: 7 }]);
    expect(room.triggers[0]!.actions.some((a) => a.kind === 'openDoor')).toBe(true);
    expect(room.layers.bg[7 * 16 + 15]).toBe(T.DWALL_RIGHT); // the kept target is the moved wall's cell
    expect(validateProject(p).filter((x) => /outside|set tile/i.test(x.message))).toEqual([]);
  });

  it('drops set-tile targets a crop leaves outside the room', () => {
    const p = createBlankProject('T');
    const room = p.worlds[0]!.rooms[0]!;
    const ctx = fakeCtx(p);
    expect(resizeRoomUndoable(ctx, p.worlds[0]!.id, room.id, 2, 1)).toBe(true);
    const r = findRoom(p, p.worlds[0]!.id, room.id)!;
    r.triggers.push({ id: 't', name: 't', on: 'enter', conditions: [], once: false, actions: [{ kind: 'setTile', layer: 'fg', tx: 25, ty: 2, tile: 0 }] });
    expect(resizeLoss(p, r, 1, 1).actions).toBe(1);
    expect(resizeRoomUndoable(ctx, p.worlds[0]!.id, room.id, 1, 1)).toBe(true);
    expect(setTiles(findRoom(p, p.worlds[0]!.id, room.id)!)).toEqual([]);
    ctx.undo.undo();
    expect(setTiles(findRoom(p, p.worlds[0]!.id, room.id)!)).toEqual([{ tx: 25, ty: 2 }]);
  });
});

describe('arrival points follow a resized room', () => {
  const plan = (sx: ResizePlan['sx'], sy: ResizePlan['sy'], from: [number, number], to: [number, number]): ResizePlan =>
    ({ sx, sy, fromCols: from[0], fromRows: from[1], toCols: to[0], toRows: to[1] });

  it('keeps the distance to the nearer wall; removed lines land before the far wall; outside points come inside', () => {
    const grow = plan(null, { seam: 12, d: 14 }, [16, 14], [16, 28]);
    expect(remapArrival(128, 184, grow)).toEqual({ x: 128, y: 184 + 224 }); // near the bottom wall: follows it
    expect(remapArrival(128, 40, grow)).toEqual({ x: 128, y: 40 }); // near the top wall: stays
    const shrink = plan(null, { seam: 26, d: -14 }, [16, 28], [16, 14]);
    expect(remapArrival(128, 408, shrink)).toEqual({ x: 128, y: 184 }); // the round trip
    expect(remapArrival(128, 40, shrink)).toEqual({ x: 128, y: 40 });
    expect(remapArrival(128, 200, shrink)).toEqual({ x: 128, y: 12 * 16 + 8 }); // near half, removed row 12..26 -> row 12
    const crop = plan(null, null, [32, 14], [16, 14]);
    expect(remapArrival(400, 112, crop)).toEqual({ x: 248, y: 112 });
  });

  it('moves the Keep Gate warp with the Entrance Hall south door, validates clean, and undoes in one step', () => {
    const p = createSampleProject();
    const found = locateRoom(p, 'kp_entrance')!;
    const { world, room: hall } = found;
    const ctx = fakeCtx(p);
    const gate = locateRoom(p, 'ow_keep_gate')!.room;
    // Looked up each time: undo restores rooms from snapshots (new objects).
    const target = (): { x: number; y: number } =>
      locateRoom(p, 'ow_keep_gate')!.room.entities.find((e) => e.id === 'kg_keep_door')!.props.target as unknown as { x: number; y: number };
    const door = (): { x: number; y: number } => findRoom(p, world.id, hall.id)!.entities.find((e) => e.id === 'kp_e1_door_s')!;
    const before = { target: { ...target() }, door: { ...door() }, gate: JSON.stringify(gate) };
    expect(arrivals(p, world.id, hall.id).length).toBeGreaterThan(0);
    const problems = validateProject(p).length;
    expect(resizeLoss(p, hall, 1, 2).arrivals).toBe(1);
    expect(resizeRoomUndoable(ctx, world.id, hall.id, 1, 2)).toBe(true);
    expect(door().y).toBe(before.door.y + 224);
    expect(target()).toEqual({ ...before.target, y: before.target.y + 224 }); // same distance above the doorway
    expect(door().y - target().y).toBe(before.door.y - before.target.y);
    expect(validateProject(p).length).toBe(problems);
    ctx.undo.undo();
    expect(target()).toEqual(before.target);
    expect(JSON.stringify(locateRoom(p, 'ow_keep_gate')!.room)).toBe(before.gate);
    ctx.undo.redo();
    expect(target().y).toBe(before.target.y + 224);
  });

  it('moves the project start and pit targets into the room too', () => {
    const p = createBlankProject('T');
    const w = buildWorld('Crypt', 'dungeon', 'dungeon');
    p.worlds.push(w);
    const room = w.rooms[0]!;
    const other = p.worlds[0]!.rooms[0]!;
    other.pitTarget = { world: w.id, room: room.id, x: 128, y: 200 };
    p.start = { world: w.id, room: room.id, x: 200, y: 96, dir: 'down' };
    const ctx = fakeCtx(p);
    expect(resizeRoomUndoable(ctx, w.id, room.id, 2, 2)).toBe(true);
    expect(p.start).toMatchObject({ x: 200 + 256, y: 96 });
    expect(other.pitTarget).toMatchObject({ x: 128, y: 200 + 224 });
    expect(ctx.events).toContain('settings');
    ctx.undo.undo();
    expect(p.start).toMatchObject({ x: 200, y: 96, dir: 'down' });
    expect(other.pitTarget).toMatchObject({ x: 128, y: 200 });
  });
});

describe('tile clipboard across deletes and projects', () => {
  function withCustomTile(name: string): { p: Project; tile: TileDef } {
    const p = createBlankProject(name);
    const base = tileById(p, T.GRASS!)!;
    const tile: TileDef = { ...structuredClone(base), id: USER_TILE_BASE, key: 'TILE_1000', name: `${name} tile`, tags: ['custom'] };
    p.tiles.push(tile);
    return { p, tile };
  }

  it('skips cells whose tile was deleted since the copy', () => {
    const { p, tile } = withCustomTile('A');
    const room = p.worlds[0]!.rooms[0]!;
    room.layers.fg[0] = tile.id;
    room.layers.fg[1] = T.BUSH!;
    const clip = copyRegion(room, { x: 0, y: 0, w: 2, h: 1 }, ['fg'], p);
    expect(clip.project).toBe(p.id);
    p.tiles = p.tiles.filter((t) => t.id !== tile.id);
    room.layers.fg[0] = 0;
    const plan = planPaste(clip, p);
    expect(plan).toMatchObject({ skipped: 1, imports: [] });
    const edit = new TileEdit(room);
    pasteClip(edit, clip, 5, 5, 'fg', plan);
    expect(room.layers.fg[5 * 16 + 5]).toBe(0);
    expect(room.layers.fg[5 * 16 + 6]).toBe(T.BUSH);
    expect(validateProject(p).some((x) => /unknown tile/i.test(x.message))).toBe(false);
  });

  it('brings another project’s custom tiles along under a free id (reusing an identical one), never its own tile 1000', () => {
    const a = withCustomTile('A');
    const b = withCustomTile('B');
    b.tile.frames = [b.tile.frames[0]!.replace(/./g, '1')]; // B's tile 1000 is different art
    const src = a.p.worlds[0]!.rooms[0]!;
    src.layers.bg[0] = a.tile.id;
    src.layers.bg[1] = T.SAND!;
    const clip = copyRegion(src, { x: 0, y: 0, w: 2, h: 1 }, ['bg'], a.p);
    const plan = planPaste(clip, b.p);
    expect(plan.skipped).toBe(0);
    expect(plan.imports).toHaveLength(1);
    const imported = plan.imports[0]!;
    expect(imported.id).toBe(USER_TILE_BASE + 1);
    expect(imported.frames).toEqual(a.tile.frames);
    expect(imported.key).not.toBe(b.tile.key);
    expect(plan.map.get(a.tile.id)).toBe(imported.id);
    expect(plan.map.get(T.SAND!) ?? T.SAND).toBe(T.SAND);
    b.p.tiles.push(imported);
    expect(planPaste(clip, b.p)).toMatchObject({ imports: [], skipped: 0 }); // the earlier import is reused
    expect(planPaste(clip, b.p).map.get(a.tile.id)).toBe(imported.id);
  });

  it('skips foreign custom tiles whose palette is missing and follows what tiles turn into', () => {
    const a = withCustomTile('A');
    const cracked: TileDef = { ...structuredClone(a.tile), id: USER_TILE_BASE + 1, key: 'CRACKED', frames: [a.tile.frames[0]!.replace(/./g, '2')], bomb: { to: a.tile.id } };
    a.p.tiles.push(cracked);
    const src = a.p.worlds[0]!.rooms[0]!;
    src.layers.bg[0] = cracked.id;
    const clip = copyRegion(src, { x: 0, y: 0, w: 1, h: 1 }, ['bg'], a.p);
    expect(Object.keys(clip.defs).map(Number).sort()).toEqual([a.tile.id, cracked.id]);
    const b = createBlankProject('B');
    const plan = planPaste(clip, b);
    expect(plan.imports).toHaveLength(2);
    const cr = plan.imports.find((t) => t.key === 'CRACKED')!;
    expect(cr.bomb?.to).toBe(plan.map.get(a.tile.id));
    const c = createBlankProject('C');
    c.palettes = c.palettes.filter((x) => x.id !== cracked.palette);
    expect(planPaste(clip, c)).toMatchObject({ skipped: 1, imports: [] });
  });
});

describe('overview thumbnails and the world grid', () => {
  it('prunes thumbnails of rooms that no longer exist', () => {
    const cache = new ThumbCache({} as never);
    const held = (cache as unknown as { thumbs: Map<string, unknown> }).thumbs;
    held.set('r1', {});
    held.set('r2', {});
    cache.prune(new Set(['r1']));
    expect([...held.keys()]).toEqual(['r1']);
    expect(cache.size).toBe(1);
  });

  it('keeps rooms within the grid limit', () => {
    expect(withinGrid(GRID_LIMIT, 0)).toBe(true);
    expect(withinGrid(GRID_LIMIT, 0, 2, 1)).toBe(false);
    expect(withinGrid(-GRID_LIMIT - 1, 0)).toBe(false);
    const p = createBlankProject('T');
    const ctx = fakeCtx(p);
    const room = p.worlds[0]!.rooms[0]!;
    expect(moveRoom(ctx, p.worlds[0]!.id, room.id, 3000, 3000)).toBe(false);
    expect(moveRoom(ctx, p.worlds[0]!.id, room.id, 5, -5)).toBe(true);
  });
});

describe('dungeon prize name', () => {
  it('sets, trims and clears the prize name as undo steps', () => {
    const p = createBlankProject('T');
    const w = buildWorld('Crypt', 'dungeon', 'dungeon');
    p.worlds.push(w);
    const ctx = fakeCtx(p);
    setWorldPrize(ctx, w.id, '  Moon Shard  ');
    expect(w.prizeName).toBe('Moon Shard');
    setWorldPrize(ctx, w.id, '   ');
    expect('prizeName' in w).toBe(false);
    ctx.undo.undo();
    expect(w.prizeName).toBe('Moon Shard');
    ctx.undo.undo();
    expect(w.prizeName).toBeUndefined();
    expect(ctx.events).toContain('worlds');
  });
});
