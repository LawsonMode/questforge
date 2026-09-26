// World-level operations for the worlds list: add (with a first room), rename,
// change music, reorder and delete. Each is one small undo step (only a deleted
// or added world is kept as a snapshot) followed by ctx.changed('worlds'); undo
// never replaces the World or Room objects that stay in the project.
import type { MusicId, Project, World, WorldKind } from '../../core/types';
import type { EditorContext } from '../context';
import { createWorld, findWorld } from '../../core/project';
import { T } from '../../content/ids';
import { reversible } from './history';
import { buildRoom, defaultFillKey } from './roomOps';
import { wallStyleFor } from './walls';

export const WORLD_KIND_LABELS: Readonly<Record<WorldKind, string>> = {
  overworld: 'Overworld',
  dungeon: 'Dungeon',
  interior: 'Interior',
};

/** Room to show when a world gets selected: the project start if it lies there, else its first room. */
export function entryRoom(project: Project, world: World): string | null {
  const start = project.start;
  const room = (start.world === world.id ? world.rooms.find((r) => r.id === start.room) : undefined) ?? world.rooms[0];
  return room?.id ?? null;
}

/** Move the world `id` to position `to` of the list. */
function placeWorld(list: World[], id: string, to: number): void {
  const from = list.findIndex((w) => w.id === id);
  if (from < 0) return;
  const [w] = list.splice(from, 1);
  list.splice(Math.min(to, list.length), 0, w!);
}

/** A new world with one starter room (walled for dungeons and interiors). */
export function buildWorld(name: string, kind: WorldKind, music: MusicId | 'none'): World {
  const world = createWorld({ name, kind, music });
  const fill = T[defaultFillKey(kind)] ?? 0;
  world.rooms.push(buildRoom({ name: kind === 'overworld' ? 'Start' : 'Entrance', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, fill, walls: wallStyleFor(kind) }));
  return world;
}

/** Add a world (selected); undoing it returns to the previous selection. */
export function addWorld(ctx: EditorContext, name: string, kind: WorldKind, music: MusicId | 'none'): World {
  const world = buildWorld(name, kind, music);
  const snapshot = JSON.stringify(world);
  const prev = { world: ctx.worldId, room: ctx.roomId };
  let first = true;
  reversible(ctx, `Add world “${name}”`, 'worlds', undefined, (forward) => {
    const list = ctx.project.worlds;
    if (forward) {
      list.push(first ? world : (JSON.parse(snapshot) as World));
      first = false;
      ctx.selectRoom(world.id, world.rooms[0]?.id ?? null);
    } else {
      const i = list.findIndex((w) => w.id === world.id);
      if (i >= 0) list.splice(i, 1);
      if (ctx.worldId === world.id && findWorld(ctx.project, prev.world)) ctx.selectRoom(prev.world, prev.room);
    }
  });
  return world;
}

/** Change one field of a world as an undo step (no-op when unchanged). */
function setField<K extends 'name' | 'music'>(ctx: EditorContext, id: string, key: K, value: World[K], label: string): void {
  const w = findWorld(ctx.project, id);
  if (!w || w[key] === value) return;
  const before = w[key];
  reversible(ctx, label, 'worlds', undefined, (forward) => {
    const target = findWorld(ctx.project, id);
    if (target) target[key] = forward ? value : before;
  });
}

export function renameWorld(ctx: EditorContext, id: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed) setField(ctx, id, 'name', trimmed, 'Rename world');
}

export function setWorldMusic(ctx: EditorContext, id: string, music: MusicId | 'none'): void {
  setField(ctx, id, 'music', music, 'World music');
}

/** Longest dungeon prize name (it appears in "You got the …!"). */
export const PRIZE_NAME_MAX = 40;

/** Set a dungeon world's prize name as an undo step; blank = the default "<world name> Crystal". */
export function setWorldPrize(ctx: EditorContext, id: string, name: string): void {
  const w = findWorld(ctx.project, id);
  const value = name.trim().slice(0, PRIZE_NAME_MAX) || undefined;
  if (!w || w.prizeName === value) return;
  const before = w.prizeName;
  reversible(ctx, value ? 'Prize name' : 'Clear prize name', 'worlds', undefined, (forward) => {
    const target = findWorld(ctx.project, id);
    if (!target) return;
    const v = forward ? value : before;
    if (v === undefined) delete target.prizeName;
    else target.prizeName = v;
  });
}

/** Move a world up (-1) or down (+1) in the list. */
export function moveWorld(ctx: EditorContext, id: string, delta: number): void {
  const i = ctx.project.worlds.findIndex((w) => w.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ctx.project.worlds.length) return;
  reversible(ctx, 'Reorder worlds', 'worlds', undefined, (forward) => placeWorld(ctx.project.worlds, id, forward ? j : i));
}

/**
 * Delete a world (never the last one). Only when it is the world being shown
 * does the selection move, to the neighbouring world; undo shows it again.
 */
export function deleteWorld(ctx: EditorContext, id: string): boolean {
  const list = ctx.project.worlds;
  const i = list.findIndex((w) => w.id === id);
  if (i < 0 || list.length <= 1) return false;
  const snapshot = JSON.stringify(list[i]);
  const shownBefore = ctx.worldId === id ? { world: id, room: ctx.roomId } : null;
  reversible(ctx, `Delete world “${list[i]!.name}”`, 'worlds', undefined, (forward) => {
    const worlds = ctx.project.worlds;
    if (forward) {
      const at = worlds.findIndex((w) => w.id === id);
      if (at < 0) return;
      const shown = ctx.worldId === id;
      worlds.splice(at, 1);
      const next = worlds[Math.min(at, worlds.length - 1)]!;
      if (shown) ctx.selectRoom(next.id, entryRoom(ctx.project, next));
    } else {
      worlds.splice(Math.min(i, worlds.length), 0, JSON.parse(snapshot) as World);
      if (shownBefore) ctx.selectRoom(shownBefore.world, shownBefore.room);
    }
  });
  return true;
}
