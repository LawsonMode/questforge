// Reference & usage scanning across a project (pure: no DOM). Answers "who uses
// this dialogue / flag / entity?", counts flag usage, renames flags and clears
// dangling dialogue references.
import type { EntityInstance, Project, Room, Trigger, World } from '../../core/types';
import { entityInfo, type PropKind } from '../../core/catalog';
import { entityLabel } from './labels';

/** Where a reference lives; enough to jump there in the editor. */
export interface UsageWhere {
  world?: string;
  room?: string;
  entity?: string;
  trigger?: string;
  dialogue?: string;
  /** Project settings (intro dialogue). */
  settings?: boolean;
}

export interface Usage {
  /** e.g. "Overworld › Village · Person “Mira” (e_1) · Dialogue". */
  label: string;
  where: UsageWhere;
}

/** Prefixes of the flags the engine sets itself (see SaveData in core/types.ts). */
export const ENGINE_FLAG_PREFIXES: readonly string[] = [
  'chest:', 'pickup:', 'door:', 'shown:', 'hidden:', 'defeated:', 'trigger:', 'tile:', 'pegs:', 'crystal:',
];

/** Whether `name` is an engine-managed flag (e.g. "crystal:keep"), which designers read but never declare. */
export function isEngineFlag(name: string): boolean {
  return ENGINE_FLAG_PREFIXES.some((pre) => name.startsWith(pre));
}

/** Visit every room of every world. */
export function forEachRoom(p: Project, fn: (world: World, room: Room) => void): void {
  for (const world of p.worlds) for (const room of world.rooms) fn(world, room);
}

/** Schema keys of an entity's props with the given kind. */
function propKeysOfKind(inst: EntityInstance, kind: PropKind): string[] {
  return (entityInfo(inst.type)?.props ?? []).filter((s) => s.kind === kind).map((s) => s.key);
}

function propLabel(inst: EntityInstance, key: string): string {
  return entityInfo(inst.type)?.props.find((s) => s.key === key)?.label ?? key;
}

const place = (world: World, room: Room): string => `${world.name} › ${room.name}`;
const triggerName = (t: Trigger): string => `Trigger “${t.name || t.id}”`;

/** Entity props of `kind` whose value equals `value`. */
function propUsages(world: World, room: Room, kind: PropKind, value: string): Usage[] {
  const out: Usage[] = [];
  for (const inst of room.entities) {
    for (const key of propKeysOfKind(inst, kind)) {
      if (inst.props[key] === value) {
        out.push({
          label: `${place(world, room)} · ${entityLabel(inst)} · ${propLabel(inst, key)}`,
          where: { world: world.id, room: room.id, entity: inst.id },
        });
      }
    }
  }
  return out;
}

/** Everything that shows dialogue `id`: entity props, trigger actions, the intro. */
export function dialogueUsages(p: Project, id: string): Usage[] {
  const out: Usage[] = [];
  if (!id) return out;
  if (p.settings.introDialogue === id) out.push({ label: 'Project settings · Intro dialogue', where: { settings: true } });
  forEachRoom(p, (world, room) => {
    out.push(...propUsages(world, room, 'dialogue', id));
    for (const t of room.triggers) {
      const n = t.actions.filter((a) => a.kind === 'dialogue' && a.dialogue === id).length;
      if (n > 0) {
        out.push({ label: `${place(world, room)} · ${triggerName(t)}${n > 1 ? ` ×${n}` : ''}`, where: { world: world.id, room: room.id, trigger: t.id } });
      }
    }
  });
  return out;
}

/**
 * Usage count of every referenced dialogue id in one pass over the project;
 * each count equals dialogueUsages(p, id).length (a trigger counts once).
 */
export function dialogueUsageCounts(p: Project): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string): void => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  if (p.settings.introDialogue) bump(p.settings.introDialogue);
  forEachRoom(p, (_world, room) => {
    for (const inst of room.entities) {
      for (const key of propKeysOfKind(inst, 'dialogue')) {
        const v = inst.props[key];
        if (typeof v === 'string') bump(v);
      }
    }
    for (const t of room.triggers) {
      const ids = new Set<string>();
      for (const a of t.actions) if (a.kind === 'dialogue') ids.add(a.dialogue);
      ids.forEach(bump);
    }
  });
  return counts;
}

/** Number of references to `flag` inside one trigger (conditions + setFlag actions). */
function triggerFlagRefs(t: Trigger, flag: string): number {
  return t.conditions.filter((c) => c.kind === 'flag' && c.flag === flag).length
    + t.actions.filter((a) => a.kind === 'setFlag' && a.flag === flag).length;
}

/** Everything that reads or writes `flag`: triggers, flag props, dialogue choices. */
export function flagUsages(p: Project, flag: string): Usage[] {
  const out: Usage[] = [];
  if (!flag) return out;
  forEachRoom(p, (world, room) => {
    out.push(...propUsages(world, room, 'flag', flag));
    for (const t of room.triggers) {
      const n = triggerFlagRefs(t, flag);
      if (n > 0) out.push({ label: `${place(world, room)} · ${triggerName(t)}${n > 1 ? ` ×${n}` : ''}`, where: { world: world.id, room: room.id, trigger: t.id } });
    }
  });
  for (const d of p.dialogues) {
    d.pages.forEach((page, i) => {
      if (page.choice?.flag === flag) out.push({ label: `Dialogue “${d.name || d.id}” · page ${i + 1} choice`, where: { dialogue: d.id } });
    });
  }
  return out;
}

/** Every flag name referenced anywhere, with its reference count. */
export function flagUsageCounts(p: Project): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (name: string | undefined): void => {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  forEachRoom(p, (_world, room) => {
    for (const inst of room.entities) {
      for (const key of propKeysOfKind(inst, 'flag')) {
        const v = inst.props[key];
        if (typeof v === 'string') bump(v);
      }
    }
    for (const t of room.triggers) {
      for (const c of t.conditions) if (c.kind === 'flag') bump(c.flag);
      for (const a of t.actions) if (a.kind === 'setFlag') bump(a.flag);
    }
  });
  for (const d of p.dialogues) for (const page of d.pages) bump(page.choice?.flag);
  return counts;
}

/**
 * Rename a flag everywhere (definition, triggers, flag props, dialogue choices).
 * Returns the number of references updated (the definition not included).
 */
export function renameFlag(p: Project, from: string, to: string): number {
  if (!from || from === to) return 0;
  for (const f of p.flags) if (f.name === from) f.name = to;
  let n = 0;
  forEachRoom(p, (_world, room) => {
    for (const inst of room.entities) {
      for (const key of propKeysOfKind(inst, 'flag')) {
        if (inst.props[key] === from) {
          inst.props[key] = to;
          n++;
        }
      }
    }
    for (const t of room.triggers) {
      for (const c of t.conditions) {
        if (c.kind === 'flag' && c.flag === from) {
          c.flag = to;
          n++;
        }
      }
      for (const a of t.actions) {
        if (a.kind === 'setFlag' && a.flag === from) {
          a.flag = to;
          n++;
        }
      }
    }
  });
  for (const d of p.dialogues) {
    for (const page of d.pages) {
      if (page.choice?.flag === from) {
        page.choice.flag = to;
        n++;
      }
    }
  }
  return n;
}

/**
 * Remove every reference to dialogue `id`: dialogue props become '', trigger
 * 'dialogue' actions are dropped, the intro is unset. Returns the count removed.
 */
export function clearDialogueRefs(p: Project, id: string): number {
  let n = 0;
  if (p.settings.introDialogue === id) {
    delete p.settings.introDialogue;
    n++;
  }
  forEachRoom(p, (_world, room) => {
    for (const inst of room.entities) {
      for (const key of propKeysOfKind(inst, 'dialogue')) {
        if (inst.props[key] === id) {
          inst.props[key] = '';
          n++;
        }
      }
    }
    for (const t of room.triggers) {
      const before = t.actions.length;
      t.actions = t.actions.filter((a) => !(a.kind === 'dialogue' && a.dialogue === id));
      n += before - t.actions.length;
    }
  });
  return n;
}

/** Triggers and entity props in `room` that point at entity `id`. */
export function entityUsages(world: World, room: Room, id: string): Usage[] {
  const out: Usage[] = [];
  for (const t of room.triggers) {
    const hit = t.source === id
      || t.conditions.some((c) => 'target' in c && c.target === id)
      || t.actions.some((a) => 'target' in a && a.target === id);
    if (hit) out.push({ label: `${place(world, room)} · ${triggerName(t)}`, where: { world: world.id, room: room.id, trigger: t.id } });
  }
  for (const inst of room.entities) {
    if (inst.id === id) continue;
    for (const key of propKeysOfKind(inst, 'entity')) {
      if (inst.props[key] === id) {
        out.push({ label: `${place(world, room)} · ${entityLabel(inst)} · ${propLabel(inst, key)}`, where: { world: world.id, room: room.id, entity: inst.id } });
      }
    }
  }
  return out;
}
