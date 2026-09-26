// Trigger editing model (pure): condition/action kinds with labels, which
// entities each kind may target, and fresh defaults for "add by kind".
import type { Action, Condition, EntityInstance, Project, Room, Trigger, TriggerOn } from '../../core/types';
import { countsForClear, entityInfo } from '../../core/catalog';
import { newId } from '../../core/project';
import { copyName, numberedName } from './names';

export type ConditionKind = Condition['kind'];
export type ActionKind = Action['kind'];

export interface KindInfo<K extends string> {
  kind: K;
  label: string;
  help: string;
}

export const TRIGGER_ONS: readonly { value: TriggerOn; label: string }[] = [
  { value: 'auto', label: 'Conditions become true' },
  { value: 'enter', label: 'Entering the room' },
  { value: 'talk', label: 'Talking to a person' },
];

export const CONDITION_KINDS: readonly KindInfo<ConditionKind>[] = [
  { kind: 'enemiesCleared', label: 'All enemies defeated', help: 'No enemy that counts for clearing is left in the room.' },
  { kind: 'switch', label: 'Switch state', help: 'A floor switch or crystal switch is on / off.' },
  { kind: 'torchesLit', label: 'All torches lit', help: 'Every torch in the room is burning.' },
  { kind: 'flag', label: 'Flag value', help: 'A save-file flag is set or not set.' },
  { kind: 'hasItem', label: 'Player has item', help: 'The player owns at least N of an item.' },
  { kind: 'inRegion', label: 'Player in region', help: 'The player stands inside a Region marker.' },
  { kind: 'defeated', label: 'Enemy defeated', help: 'A specific enemy or boss has been defeated.' },
  { kind: 'blockPushed', label: 'Block pushed', help: 'A specific push block has been moved.' },
];

export const ACTION_KINDS: readonly KindInfo<ActionKind>[] = [
  { kind: 'openDoor', label: 'Open door', help: 'Opens a door (stays open).' },
  { kind: 'closeDoor', label: 'Close door', help: 'Closes a door.' },
  { kind: 'showEntity', label: 'Show entity', help: 'Reveals an entity placed as Hidden (stays revealed).' },
  { kind: 'hideEntity', label: 'Hide entity', help: 'Removes an entity (stays removed).' },
  { kind: 'setFlag', label: 'Set flag', help: 'Sets or clears a save-file flag.' },
  { kind: 'dialogue', label: 'Show dialogue', help: 'Shows a dialogue; waits until it is closed.' },
  { kind: 'giveItem', label: 'Give item', help: 'Gives the player an item.' },
  { kind: 'takeItem', label: 'Take item', help: 'Takes an item from the player.' },
  { kind: 'setTile', label: 'Change tile', help: 'Changes one tile of this room (stays changed).' },
  { kind: 'sound', label: 'Play sound', help: 'Plays a sound effect.' },
  { kind: 'music', label: 'Change music', help: 'Switches the background music.' },
  { kind: 'secret', label: 'Secret jingle', help: 'Plays the "secret found" jingle.' },
  { kind: 'warp', label: 'Warp player', help: 'Moves the player to another place.' },
  { kind: 'heal', label: 'Heal player', help: 'Restores health (in half-hearts).' },
  { kind: 'shake', label: 'Shake screen', help: 'Shakes the camera for a moment.' },
  { kind: 'wait', label: 'Wait', help: 'Pauses the action sequence.' },
];

export function conditionKindLabel(kind: ConditionKind): string {
  return CONDITION_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export function actionKindLabel(kind: ActionKind): string {
  return ACTION_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export type EntityFilter = (inst: EntityInstance) => boolean;

const ofTypes = (...types: string[]): EntityFilter => (e) => types.includes(e.type);
const anyEntity: EntityFilter = () => true;
/** Enemies and bosses that can be defeated (invulnerable ones such as statues and blade traps never are). */
const defeatable: EntityFilter = (e) => {
  const info = entityInfo(e.type);
  const foe = info?.category === 'enemy' || info?.category === 'boss';
  return foe && (countsForClear(e.type) || info?.persistDefeat === true);
};

/** Entities a condition kind may target (null = the kind has no target). */
export function conditionTargets(kind: ConditionKind): EntityFilter | null {
  switch (kind) {
    case 'switch': return ofTypes('obj.switch', 'obj.crystalSwitch');
    case 'inRegion': return ofTypes('marker.region');
    case 'defeated': return defeatable;
    case 'blockPushed': return ofTypes('obj.block');
    default: return null;
  }
}

/** Entities an action kind may target (null = the kind has no target). */
export function actionTargets(kind: ActionKind): EntityFilter | null {
  switch (kind) {
    case 'openDoor':
    case 'closeDoor': return ofTypes('obj.door');
    case 'showEntity':
    case 'hideEntity': return anyEntity;
    default: return null;
  }
}

/** Entities that report being talked to (people emit the 'talk' event). */
export const talkSources: EntityFilter = (e) => entityInfo(e.type)?.category === 'npc';

function firstTarget(room: Room, filter: EntityFilter | null): string {
  return filter ? room.entities.find(filter)?.id ?? '' : '';
}

/** A new condition of `kind`, targeting the first suitable entity in the room. */
export function defaultCondition(kind: ConditionKind, room: Room): Condition {
  switch (kind) {
    case 'enemiesCleared': return { kind };
    case 'torchesLit': return { kind };
    case 'switch': return { kind, target: firstTarget(room, conditionTargets(kind)), on: true };
    case 'flag': return { kind, flag: '', value: true };
    case 'hasItem': return { kind, item: 'smallKey', min: 1 };
    case 'inRegion':
    case 'defeated':
    case 'blockPushed': return { kind, target: firstTarget(room, conditionTargets(kind)) };
  }
}

/** Context for action defaults: the room, the editor's tile brush and the project start. */
export interface ActionDefaults {
  project: Project;
  room: Room;
  tile: number;
}

/** A new action of `kind` with sensible defaults. */
export function defaultAction(kind: ActionKind, d: ActionDefaults): Action {
  switch (kind) {
    case 'openDoor':
    case 'closeDoor':
    case 'showEntity':
    case 'hideEntity': {
      const filter = kind === 'showEntity' ? hiddenFirst(d.room) : actionTargets(kind);
      return { kind, target: firstTarget(d.room, filter) };
    }
    case 'setFlag': return { kind, flag: '', value: true };
    // Unset on purpose: the "pick a dialogue" hint shows until one is chosen or created.
    case 'dialogue': return { kind, dialogue: '' };
    case 'giveItem': return { kind, item: 'rupees', amount: 20 };
    case 'takeItem': return { kind, item: 'smallKey', amount: 1 };
    case 'setTile': return { kind, layer: 'bg', tx: 0, ty: 0, tile: d.tile };
    case 'sound': return { kind, sfx: 'secret' };
    case 'music': return { kind, music: 'dungeon' };
    case 'secret': return { kind };
    case 'warp': return { kind, target: { ...d.project.start } };
    case 'heal': return { kind, amount: 2 };
    case 'shake': return { kind, seconds: 0.5 };
    case 'wait': return { kind, seconds: 1 };
  }
}

/** Prefer an entity already marked hidden (what showEntity is for). */
function hiddenFirst(room: Room): EntityFilter {
  const hidden = room.entities.find((e) => e.props.hidden === true);
  return hidden ? (e) => e.id === hidden.id : anyEntity;
}

function triggerNames(room: Room): Set<string> {
  return new Set(room.triggers.map((t) => t.name));
}

/** A fresh, empty trigger for `room`, named "Trigger N" with N unused in the room. */
export function newTrigger(room: Room): Trigger {
  const name = numberedName('Trigger', room.triggers.length + 1, triggerNames(room));
  return { id: newId('t'), name, on: 'auto', conditions: [], actions: [], once: true };
}

/** Deep copy of `t` (a trigger of `room`) with a new id and a unique "… copy" name. */
export function duplicateTrigger(t: Trigger, room: Room): Trigger {
  const copy = structuredClone(t);
  copy.id = newId('t');
  copy.name = copyName(t.name || t.id, triggerNames(room));
  return copy;
}
