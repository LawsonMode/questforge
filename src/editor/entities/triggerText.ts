// Trigger summaries ("When all enemies are defeated → show Chest (e_x1), play
// secret") and validation hints for the trigger panel (pure: no DOM).
import type { Action, Condition, EntityInstance, Project, Room, Trigger } from '../../core/types';
import { countsForClear } from '../../core/catalog';
import { findRoom, roomCols, roomRows } from '../../core/project';
import {
  dialogueLabel, findInRoom, itemAmount, itemName, musicLabel, refLabel, sfxLabel, tileLabel, warpLabel,
} from './labels';
import {
  ACTION_KINDS, CONDITION_KINDS, actionKindLabel, actionTargets, conditionKindLabel, conditionTargets, talkSources,
} from './triggerModel';

/** Kind of a condition or action as stored (imports may carry kinds this editor does not know). */
function rawKind(x: Condition | Action): string {
  return (x as { kind: string }).kind;
}

/** Whether this editor (and the game) knows the condition's kind. */
export function knownCondition(c: Condition): boolean {
  return CONDITION_KINDS.some((k) => k.kind === rawKind(c));
}

/** Whether this editor (and the game) knows the action's kind. */
export function knownAction(a: Action): boolean {
  return ACTION_KINDS.some((k) => k.kind === rawKind(a));
}

/** Entity reference for a summary: its label, or "(no <what> picked)" when unset. */
function target(room: Room, id: string, what: string): string {
  return id ? refLabel(room, id) : `(no ${what} picked)`;
}

/**
 * "on" / "off" for a floor switch; "blue" / "red" for a crystal switch, whose
 * state is the peg state (on = blue: blue pegs raised, red lowered).
 */
export function switchStateText(room: Room, target: string, on: boolean): string {
  if (findInRoom(room, target)?.type === 'obj.crystalSwitch') return on ? 'blue' : 'red';
  return on ? 'on' : 'off';
}

/** Room entities that count for "all enemies defeated" (hidden ones count once shown). */
export function clearCountingEnemies(room: Room): number {
  return room.entities.filter((e) => countsForClear(e.type)).length;
}

/** Condition phrase, e.g. "all enemies are defeated", "Floor Switch (e_1) is on". */
export function conditionText(room: Room, c: Condition): string {
  switch (c.kind) {
    case 'enemiesCleared': return 'all enemies are defeated';
    case 'torchesLit': return 'all torches are lit';
    case 'switch': return `${target(room, c.target, 'switch')} is ${switchStateText(room, c.target, c.on)}`;
    case 'flag': return `flag “${c.flag || '?'}” is ${c.value ? 'set' : 'not set'}`;
    case 'hasItem': return c.min <= 1 ? `the player has ${itemName(c.item)}` : `the player has at least ${itemAmount(c.item, c.min)}`;
    case 'inRegion': return `the player is in ${target(room, c.target, 'region')}`;
    case 'defeated': return `${target(room, c.target, 'enemy')} is defeated`;
    case 'blockPushed': return `${target(room, c.target, 'block')} was pushed`;
    default: return `unknown condition “${rawKind(c)}”`;
  }
}

/** "3 half-hearts" / "2 hearts". */
function halfHearts(n: number): string {
  if (n % 2 === 0) return `${n / 2} heart${n === 2 ? '' : 's'}`;
  return `${n} half-heart${n === 1 ? '' : 's'}`;
}

/** Action phrase, e.g. "show Chest (e_x1)", "give 20 Gems", "play secret". */
export function actionText(p: Project, room: Room, a: Action): string {
  switch (a.kind) {
    case 'openDoor': return `open ${target(room, a.target, 'door')}`;
    case 'closeDoor': return `close ${target(room, a.target, 'door')}`;
    case 'showEntity': return `show ${target(room, a.target, 'entity')}`;
    case 'hideEntity': return `hide ${target(room, a.target, 'entity')}`;
    case 'setFlag': return `${a.value ? 'set' : 'clear'} flag “${a.flag || '?'}”`;
    case 'dialogue': return a.dialogue ? `say “${dialogueLabel(p, a.dialogue)}”` : 'say (no dialogue picked)';
    case 'giveItem': return `give ${itemAmount(a.item, a.amount)}`;
    case 'takeItem': return `take ${itemAmount(a.item, a.amount)}`;
    case 'setTile': return `set ${a.layer} tile (${a.tx},${a.ty}) to ${tileLabel(p, a.tile)}`;
    case 'sound': return `play sound “${sfxLabel(a.sfx)}”`;
    case 'music': return a.music === 'none' ? 'stop the music' : `play music ${musicLabel(a.music)}`;
    case 'secret': return 'play secret';
    case 'warp': return `warp to ${warpLabel(p, a.target)}`;
    case 'heal': return `heal ${halfHearts(a.amount)}`;
    case 'shake': return `shake the screen ${a.seconds} s`;
    case 'wait': return `wait ${a.seconds} s`;
    default: return `unknown action “${rawKind(a)}”`;
  }
}

/** The "When …" half of a summary. */
function whenText(p: Project, room: Room, t: Trigger): string {
  const conds = t.conditions.map((c) => conditionText(room, c)).join(' and ');
  switch (t.on) {
    case 'auto': return conds ? `When ${conds}` : 'As soon as the room starts';
    case 'enter': return conds ? `On entering the room, if ${conds}` : 'On entering the room';
    case 'talk': {
      const who = `When talking to ${target(room, t.source ?? '', 'person')}`;
      return conds ? `${who}, if ${conds}` : who;
    }
  }
}

/** One-line summary: "When all enemies are defeated → show Chest (e_x1), play secret". */
export function triggerSummary(p: Project, room: Room, t: Trigger): string {
  const actions = t.actions.length ? t.actions.map((a) => actionText(p, room, a)).join(', ') : 'do nothing yet';
  return `${whenText(p, room, t)} → ${actions}${t.once ? '' : ' (repeats)'}`;
}

function targetIssue(room: Room, what: string, target: string, ok: ((e: EntityInstance) => boolean) | null): string | null {
  if (!ok) return null;
  if (!target) return `${what}: pick a target.`;
  const inst = findInRoom(room, target);
  if (!inst) return `${what}: entity ${target} is not in this room any more.`;
  if (!ok(inst)) return `${what}: ${refLabel(room, target)} is not a valid target.`;
  return null;
}

function conditionIssues(room: Room, c: Condition, n: number): string[] {
  if (!knownCondition(c)) {
    return [`Condition ${n} has an unknown kind (“${rawKind(c)}”): the game treats it as never true, so this trigger never fires. Remove it.`];
  }
  const what = `Condition ${n} (${conditionKindLabel(c.kind)})`;
  const out: string[] = [];
  if ('target' in c) {
    const issue = targetIssue(room, what, c.target, conditionTargets(c.kind));
    if (issue) out.push(issue);
  }
  if (c.kind === 'flag' && !c.flag.trim()) out.push(`${what}: enter a flag name.`);
  if (c.kind === 'hasItem' && !Number.isInteger(c.min)) out.push(`${what}: the count must be a whole number.`);
  if (c.kind === 'torchesLit' && !room.entities.some((e) => e.type === 'obj.torch')) out.push(`${what}: there are no torches in this room.`);
  if (c.kind === 'enemiesCleared' && clearCountingEnemies(room) === 0) {
    out.push(`${what}: no enemy in this room counts, so this never becomes true.`);
  }
  return out;
}

function actionIssues(p: Project, room: Room, a: Action, n: number): string[] {
  if (!knownAction(a)) return [`Action ${n} has an unknown kind (“${rawKind(a)}”): the game skips it. Remove it.`];
  const what = `Action ${n} (${actionKindLabel(a.kind)})`;
  const out: string[] = [];
  if ('target' in a && typeof a.target === 'string') {
    const issue = targetIssue(room, what, a.target, actionTargets(a.kind));
    if (issue) out.push(issue);
    const inst = findInRoom(room, a.target);
    if (!issue && a.kind === 'showEntity' && inst && inst.props.hidden !== true) {
      out.push(`${what}: ${refLabel(room, a.target)} is not marked Hidden, so it is already visible.`);
    }
  }
  switch (a.kind) {
    case 'setFlag':
      if (!a.flag.trim()) out.push(`${what}: enter a flag name.`);
      break;
    case 'dialogue':
      if (!a.dialogue) out.push(`${what}: pick a dialogue.`);
      else if (!p.dialogues.some((d) => d.id === a.dialogue)) out.push(`${what}: the dialogue no longer exists.`);
      break;
    case 'giveItem':
    case 'takeItem':
    case 'heal':
      if (!Number.isInteger(a.amount)) out.push(`${what}: the amount must be a whole number.`);
      break;
    case 'setTile':
      if (!Number.isInteger(a.tx) || !Number.isInteger(a.ty)) out.push(`${what}: the tile position must be whole numbers.`);
      else if (a.tx < 0 || a.ty < 0 || a.tx >= roomCols(room) || a.ty >= roomRows(room)) out.push(`${what}: tile (${a.tx},${a.ty}) is outside this room.`);
      if (a.tile !== 0 && !p.tiles.some((t) => t.id === a.tile)) out.push(`${what}: tile #${a.tile} does not exist.`);
      break;
    case 'warp':
      if (!findRoom(p, a.target.world, a.target.room)) out.push(`${what}: the destination room no longer exists.`);
      break;
    default:
      break;
  }
  return out;
}

/** Validation hints for a trigger (empty = fine). */
export function triggerIssues(p: Project, room: Room, t: Trigger): string[] {
  const out: string[] = [];
  if (t.on === 'talk') {
    const src = t.source ? findInRoom(room, t.source) : undefined;
    if (!t.source) out.push('Pick who the player talks to.');
    else if (!src) out.push(`Talk source ${t.source} is not in this room any more.`);
    else if (!talkSources(src)) out.push(`${refLabel(room, t.source)} is not a person, so talking to it never fires this trigger.`);
  }
  t.conditions.forEach((c, i) => out.push(...conditionIssues(room, c, i + 1)));
  t.actions.forEach((a, i) => out.push(...actionIssues(p, room, a, i + 1)));
  if (t.actions.length === 0) out.push('Does nothing yet: add an action.');
  return out;
}
