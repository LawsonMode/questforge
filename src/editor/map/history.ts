// Undo helpers for the map tab. Every edit is ONE undo step followed by
// ctx.changed(...). Commands look rooms up by id when they run, so they stay
// valid when other commands restore or replace data in between, and undoing or
// redoing a room edit shows that room, so the change never happens off screen.
import type { Room } from '../../core/types';
import type { EditorContext, ProjectChange } from '../context';
import type { CellChange } from './tileEdit';
import { findRoom } from '../../core/project';
import { applyChanges } from './tileEdit';

/** Whether Ctrl/Cmd+Z or Ctrl/Cmd+Y (undo / redo) was pressed: gestures hold these until they end. */
export function isHistoryKey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const k = e.key.toLowerCase();
  return k === 'z' || k === 'y' || e.code === 'KeyZ' || e.code === 'KeyY';
}

/** Run `apply(true)` now and record it; undo runs `apply(false)`. */
export function reversible(
  ctx: EditorContext, label: string, what: ProjectChange, id: string | undefined, apply: (forward: boolean) => void,
): void {
  apply(true);
  ctx.undo.push({
    label,
    undo: () => {
      apply(false);
      ctx.changed(what, id);
    },
    redo: () => {
      apply(true);
      ctx.changed(what, id);
    },
  });
  ctx.changed(what, id);
}

/** Select a room (if it still exists) unless it is already the one shown. */
export function focusRoom(ctx: EditorContext, worldId: string, roomId: string): void {
  if ((ctx.worldId !== worldId || ctx.roomId !== roomId) && findRoom(ctx.project, worldId, roomId)) ctx.selectRoom(worldId, roomId);
}

/** A project change outside the room's tiles that belongs to a tile edit's undo step (e.g. tiles a paste brought along). */
export interface SideEffect {
  undo(): void;
  redo(): void;
}

/**
 * Record tile changes that are already applied to a room as one undo step;
 * `also` (already applied too) is redone before and undone after the cells.
 */
export function commitTiles(
  ctx: EditorContext, worldId: string, roomId: string, label: string, changes: readonly CellChange[], also?: SideEffect,
): void {
  if (changes.length === 0) return;
  const list = [...changes];
  const run = (forward: boolean): void => {
    if (forward) also?.redo();
    const room = findRoom(ctx.project, worldId, roomId);
    if (room) applyChanges(room, list, forward);
    if (!forward) also?.undo();
    focusRoom(ctx, worldId, roomId);
    ctx.changed('room', roomId);
  };
  ctx.undo.push({ label, undo: () => run(false), redo: () => run(true) });
  ctx.changed('room', roomId);
}

/** Overwrite a room in place with snapshot data (keeps object identity; drops fields the snapshot lacks). */
function restoreRoom(room: Room, data: Room): void {
  for (const key of Object.keys(room)) if (!(key in data)) Reflect.deleteProperty(room, key);
  Object.assign(room, data);
}

/**
 * Snapshot a whole room around `mutate` and record the difference as one undo
 * step (no-op if nothing changed). Returns whether anything changed.
 */
export function editRoom(
  ctx: EditorContext, worldId: string, roomId: string, label: string, what: ProjectChange, mutate: (room: Room) => void,
): boolean {
  const room = findRoom(ctx.project, worldId, roomId);
  if (!room) return false;
  const before = JSON.stringify(room);
  mutate(room);
  const after = JSON.stringify(room);
  if (before === after) return false;
  const restore = (json: string): void => {
    const target = findRoom(ctx.project, worldId, roomId);
    if (target) restoreRoom(target, JSON.parse(json) as Room);
    focusRoom(ctx, worldId, roomId);
    ctx.changed(what, roomId);
  };
  ctx.undo.push({ label, undo: () => restore(before), redo: () => restore(after) });
  ctx.changed(what, roomId);
  return true;
}

/** A room, by world and room id. */
export interface RoomRef {
  world: string;
  room: string;
}

/**
 * Snapshot several rooms (the first one is shown on undo / redo) and, with
 * `withStart`, the project's start location around `mutate`, and record the
 * difference as one undo step (no-op if nothing changed). Returns whether
 * anything changed.
 */
export function editRooms(
  ctx: EditorContext, label: string, what: ProjectChange, rooms: readonly RoomRef[], withStart: boolean, mutate: () => void,
): boolean {
  const main = rooms[0];
  if (!main || !findRoom(ctx.project, main.world, main.room)) return false;
  const snap = (): string[] => [
    ...rooms.map((r) => JSON.stringify(findRoom(ctx.project, r.world, r.room) ?? null)),
    withStart ? JSON.stringify(ctx.project.start) : '',
  ];
  const before = snap();
  mutate();
  const after = snap();
  if (before.every((json, i) => json === after[i])) return false;
  const startMoved = before[rooms.length] !== after[rooms.length];
  const notify = (): void => {
    ctx.changed(what, main.room);
    if (startMoved) ctx.changed('settings');
  };
  const restore = (state: readonly string[]): void => {
    rooms.forEach((r, i) => {
      const target = findRoom(ctx.project, r.world, r.room);
      const data = JSON.parse(state[i]!) as Room | null;
      if (target && data) restoreRoom(target, data);
    });
    if (withStart) Object.assign(ctx.project.start, JSON.parse(state[rooms.length]!));
    focusRoom(ctx, main.world, main.room);
    notify();
  };
  ctx.undo.push({ label, undo: () => restore(before), redo: () => restore(after) });
  notify();
  return true;
}

/** Replace a room's entity list with snapshot JSON and notify. */
function restoreEntities(ctx: EditorContext, worldId: string, roomId: string, json: string): void {
  const room = findRoom(ctx.project, worldId, roomId);
  if (room) room.entities = JSON.parse(json) as Room['entities'];
  focusRoom(ctx, worldId, roomId);
  ctx.changed('entities', roomId);
}

/**
 * An entity edit spanning time (e.g. a drag): snapshots the room's entities
 * when created; commit() records the difference as one undo step.
 */
export class EntityTxn {
  private readonly before: string;

  constructor(private readonly ctx: EditorContext, private readonly worldId: string, private readonly roomId: string) {
    this.before = JSON.stringify(findRoom(ctx.project, worldId, roomId)?.entities ?? []);
  }

  /** Record the change (if any) and notify; returns whether anything changed. */
  commit(label: string): boolean {
    const after = JSON.stringify(findRoom(this.ctx.project, this.worldId, this.roomId)?.entities ?? []);
    if (after === this.before) return false;
    const { ctx, worldId, roomId, before } = this;
    ctx.undo.push({
      label,
      undo: () => restoreEntities(ctx, worldId, roomId, before),
      redo: () => restoreEntities(ctx, worldId, roomId, after),
    });
    ctx.changed('entities', roomId);
    return true;
  }
}

interface OpenMerge {
  key: string;
  at: number;
  /** Mutable "after" snapshot of the command on top of the undo stack. */
  after: { json: string };
}

/**
 * Snapshot edits that merge into the previous undo step while they keep coming
 * for the same key within `windowMs`. Any other change to the undo stack (a new
 * command, undo, redo) ends the merge window.
 */
class MergeWindow {
  private open: OpenMerge | null = null;
  private pushing = false;
  private readonly off: () => void;

  constructor(private readonly ctx: EditorContext, private readonly windowMs: number) {
    this.off = ctx.undo.onChange(() => {
      if (!this.pushing) this.open = null;
    });
  }

  /** Record a before -> after change, merged into the open step when `key` matches. */
  record(key: string, label: string, before: string, after: string, restore: (json: string) => void): void {
    const now = performance.now();
    const open = this.open;
    if (open && open.key === key && now - open.at < this.windowMs) {
      open.after.json = after;
      open.at = now;
      return;
    }
    const holder = { json: after };
    this.pushing = true;
    this.ctx.undo.push({ label, undo: () => restore(before), redo: () => restore(holder.json) });
    this.pushing = false;
    this.open = { key, at: now, after: holder };
  }

  dispose(): void {
    this.off();
  }
}

/** Entity edits that merge while they keep coming for one key (e.g. arrow-key nudges of one entity). */
export class MergingEntityEdit {
  private readonly merge: MergeWindow;

  constructor(private readonly ctx: EditorContext, windowMs = 900) {
    this.merge = new MergeWindow(ctx, windowMs);
  }

  /** Mutate a room's entities; returns whether anything changed. */
  run(worldId: string, roomId: string, key: string, label: string, mutate: (room: Room) => void): boolean {
    const room = findRoom(this.ctx.project, worldId, roomId);
    if (!room) return false;
    const before = JSON.stringify(room.entities);
    mutate(room);
    const after = JSON.stringify(room.entities);
    if (after === before) return false;
    const { ctx } = this;
    this.merge.record(`${worldId}/${roomId}/${key}`, label, before, after, (json) => restoreEntities(ctx, worldId, roomId, json));
    ctx.changed('entities', roomId);
    return true;
  }

  dispose(): void {
    this.merge.dispose();
  }
}

/** Room edits that merge while they keep coming for one key (e.g. arrowing through a room's music list). */
export class MergingRoomEdit {
  private readonly merge: MergeWindow;

  constructor(private readonly ctx: EditorContext, windowMs = 1500) {
    this.merge = new MergeWindow(ctx, windowMs);
  }

  /** Mutate a room; returns whether anything changed. */
  run(worldId: string, roomId: string, key: string, label: string, what: ProjectChange, mutate: (room: Room) => void): boolean {
    const room = findRoom(this.ctx.project, worldId, roomId);
    if (!room) return false;
    const before = JSON.stringify(room);
    mutate(room);
    const after = JSON.stringify(room);
    if (after === before) return false;
    const { ctx } = this;
    this.merge.record(`${worldId}/${roomId}/${key}`, label, before, after, (json) => {
      const target = findRoom(ctx.project, worldId, roomId);
      if (target) restoreRoom(target, JSON.parse(json) as Room);
      focusRoom(ctx, worldId, roomId);
      ctx.changed(what, roomId);
    });
    ctx.changed(what, roomId);
    return true;
  }

  dispose(): void {
    this.merge.dispose();
  }
}

/** Mutate a room's entities as one undo step. */
export function editEntities(ctx: EditorContext, worldId: string, roomId: string, label: string, mutate: (room: Room) => void): boolean {
  const room = findRoom(ctx.project, worldId, roomId);
  if (!room) return false;
  const txn = new EntityTxn(ctx, worldId, roomId);
  mutate(room);
  return txn.commit(label);
}
