// Undoable edits for the entity / trigger / dialogue editors. Every user edit
// is one UndoStack.snapshot over the "parts" it touches; parts restore IN
// PLACE (arrays spliced, objects re-filled) and look their target up by id at
// undo time, so references held by other panels stay valid.
import type { EditorContext } from '../context';
import type { Dialogue, EntityInstance, Room, Trigger } from '../../core/types';
import { findRoom, newId } from '../../core/project';

/**
 * A copy of a placed entity under a fresh id (Duplicate on the map and in the
 * inspector). A door's link is cleared: doors sharing a link open together, so
 * one key would open the copy and the original alike.
 */
export function duplicateInstance(src: EntityInstance): EntityInstance {
  const copy: EntityInstance = { ...structuredClone(src), id: newId('e') };
  if (copy.type === 'obj.door' && 'link' in copy.props) copy.props.link = '';
  return copy;
}

/** One restorable slice of the project. */
export interface Part {
  get(): unknown;
  set(v: unknown): void;
}

/** Replace an object's own keys with those of `v`, keeping its identity and `v`'s key order (stable exports). */
function refill(target: Record<string, unknown>, v: Record<string, unknown>): void {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, v);
}

/** Part over an array returned by `arr()` (spliced in place on restore). */
export function arrayPart<T>(arr: () => T[] | undefined): Part {
  return {
    get: () => arr() ?? [],
    set: (v) => {
      const a = arr();
      if (a) a.splice(0, a.length, ...(v as T[]));
    },
  };
}

function roomOf(ctx: EditorContext, worldId: string, roomId: string): Room | undefined {
  return findRoom(ctx.project, worldId, roomId);
}

/** One placed entity, found by id in its room. */
export function entityPart(ctx: EditorContext, worldId: string, roomId: string, entityId: string): Part {
  const find = (): EntityInstance | undefined => roomOf(ctx, worldId, roomId)?.entities.find((e) => e.id === entityId);
  return {
    get: () => find() ?? null,
    set: (v) => {
      const inst = find();
      if (inst && v) refill(inst as unknown as Record<string, unknown>, v as Record<string, unknown>);
    },
  };
}

/** One trigger, found by id in its room (restored in place; nested lists are replaced). */
export function triggerPart(ctx: EditorContext, worldId: string, roomId: string, triggerId: string): Part {
  const find = (): Trigger | undefined => roomOf(ctx, worldId, roomId)?.triggers.find((t) => t.id === triggerId);
  return {
    get: () => find() ?? null,
    set: (v) => {
      const t = find();
      if (t && v) refill(t as unknown as Record<string, unknown>, v as Record<string, unknown>);
    },
  };
}

/** One dialogue, found by id (restored in place). */
export function dialoguePart(ctx: EditorContext, dialogueId: string): Part {
  const find = (): Dialogue | undefined => ctx.project.dialogues.find((d) => d.id === dialogueId);
  return {
    get: () => find() ?? null,
    set: (v) => {
      const d = find();
      if (d && v) refill(d as unknown as Record<string, unknown>, v as Record<string, unknown>);
    },
  };
}

export const roomEntitiesPart = (ctx: EditorContext, worldId: string, roomId: string): Part =>
  arrayPart<EntityInstance>(() => roomOf(ctx, worldId, roomId)?.entities);

export const roomTriggersPart = (ctx: EditorContext, worldId: string, roomId: string): Part =>
  arrayPart<Trigger>(() => roomOf(ctx, worldId, roomId)?.triggers);

export const dialoguesPart = (ctx: EditorContext): Part => arrayPart(() => ctx.project.dialogues);

export const flagsPart = (ctx: EditorContext): Part => arrayPart(() => ctx.project.flags);

/** Project settings (e.g. the intro dialogue). */
export function settingsPart(ctx: EditorContext): Part {
  return {
    get: () => ctx.project.settings,
    set: (v) => refill(ctx.project.settings as unknown as Record<string, unknown>, v as Record<string, unknown>),
  };
}

interface RoomRefs { world: string; room: string; entities: EntityInstance[]; triggers: Trigger[] }

/** Entities + triggers of every room (for project-wide reference rewrites). Tile layers are not captured. */
export function allRoomRefsPart(ctx: EditorContext): Part {
  return {
    get: (): RoomRefs[] => ctx.project.worlds.flatMap((w) => w.rooms.map((r) => ({
      world: w.id, room: r.id, entities: r.entities, triggers: r.triggers,
    }))),
    set: (v) => {
      for (const s of v as RoomRefs[]) {
        const room = roomOf(ctx, s.world, s.room);
        if (!room) continue;
        room.entities.splice(0, room.entities.length, ...s.entities);
        room.triggers.splice(0, room.triggers.length, ...s.triggers);
      }
    },
  };
}

/** Run `mutate` as one undo step covering `parts`. */
export function commit(ctx: EditorContext, label: string, parts: Part[], mutate: () => void): void {
  ctx.undo.snapshot(label, () => parts.map((p) => p.get()), (vals) => vals.forEach((v, i) => parts[i]!.set(v)), mutate);
}
