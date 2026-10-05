// "Show as code": a trigger written as Python-style pseudocode, so students
// read the logic they built with the form as a program (event → condition →
// ordered actions). Pure: no DOM. The same text is stored as the student's work
// sample in the learning log (src/learning/observer.ts).
//
//   # Open the gate (runs once per save file)
//   when room.enter:
//       if switch_on("e_sw") and flag("gotKey"):
//           open_door("e_door")
//           play_secret()
import type { Action, Condition, Project, Room, Trigger } from '../../core/types';
import { findInRoom, dialogueLabel, itemName, refLabel, sfxLabel, tileLabel, warpLabel } from './labels';

const INDENT = '    ';

/** A double-quoted string literal. */
function str(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Entity reference as an argument, with what it is as a trailing comment ("" when unset). */
function ref(room: Room, id: string): { arg: string; note: string } {
  if (!id) return { arg: 'None', note: 'nothing picked yet' };
  return { arg: str(id), note: refLabel(room, id) };
}

/** Condition as a boolean expression; `notes` collects what referenced entities are. */
export function conditionCode(room: Room, c: Condition, notes: string[] = []): string {
  const r = (id: string): string => {
    const x = ref(room, id);
    if (!notes.includes(x.note)) notes.push(x.note);
    return x.arg;
  };
  switch (c.kind) {
    case 'enemiesCleared': return 'enemies_defeated()';
    case 'torchesLit': return 'torches_lit()';
    case 'switch':
      if (findInRoom(room, c.target)?.type === 'obj.crystalSwitch') return `crystal_is(${r(c.target)}, ${str(c.on ? 'blue' : 'red')})`;
      return `${c.on ? '' : 'not '}switch_on(${r(c.target)})`;
    case 'flag': return `${c.value ? '' : 'not '}flag(${str(c.flag || '?')})`;
    case 'hasItem': return c.min <= 1 ? `has(${str(itemName(c.item))})` : `count(${str(itemName(c.item))}) >= ${c.min}`;
    case 'inRegion': return `hero_in(${r(c.target)})`;
    case 'defeated': return `defeated(${r(c.target)})`;
    case 'blockPushed': return `pushed(${r(c.target)})`;
    default: return `False  # unknown condition "${(c as { kind: string }).kind}"`;
  }
}

/** One action as a statement line (with an optional explanatory comment). */
export function actionCode(p: Project, room: Room, a: Action): string {
  const call = (fn: string, args: string[], note?: string): string => `${fn}(${args.join(', ')})${note ? `  # ${note}` : ''}`;
  const target = (fn: string, id: string): string => {
    const x = ref(room, id);
    return call(fn, [x.arg], x.note);
  };
  switch (a.kind) {
    case 'openDoor': return target('open_door', a.target);
    case 'closeDoor': return target('close_door', a.target);
    case 'showEntity': return target('show', a.target);
    case 'hideEntity': return target('hide', a.target);
    case 'setFlag': return call('set_flag', [str(a.flag || '?'), a.value ? 'True' : 'False']);
    case 'dialogue': return call('say', [a.dialogue ? str(dialogueLabel(p, a.dialogue)) : 'None']);
    case 'giveItem': return call('give', [str(itemName(a.item)), String(a.amount)]);
    case 'takeItem': return call('take', [str(itemName(a.item)), String(a.amount)]);
    case 'setTile': return call('set_tile', [str(a.layer), String(a.tx), String(a.ty), String(a.tile)], tileLabel(p, a.tile));
    case 'sound': return call('play_sound', [str(sfxLabel(a.sfx))]);
    case 'music': return a.music === 'none' ? call('stop_music', []) : call('play_music', [str(a.music)]);
    case 'secret': return call('play_secret', []);
    case 'warp': return call('warp_to', [str(warpLabel(p, a.target))]);
    case 'heal': return call('heal', [String(a.amount)], 'half-hearts');
    case 'shake': return call('shake', [String(a.seconds)], 'seconds');
    case 'wait': return call('wait', [String(a.seconds)], 'seconds; the next line waits too');
    default: return `pass  # unknown action "${(a as { kind: string }).kind}"`;
  }
}

/** Conditions joined with `and` ("" when there are none). */
function allOf(room: Room, conds: readonly Condition[], notes: string[]): string {
  return conds.map((c) => conditionCode(room, c, notes)).join(' and ');
}

/**
 * The whole trigger as pseudocode lines. `header` adds the "# name" comment line
 * (left out when comparing two versions of a student's work).
 */
export function triggerCodeLines(p: Project, room: Room, t: Trigger, header = true): string[] {
  const notes: string[] = [];
  const conds = allOf(room, t.conditions, notes);
  const lines: string[] = [];
  if (header) lines.push(`# ${t.name || t.id}${t.once ? ' (runs once per save file)' : ' (runs every time)'}`);
  let depth = 1;
  switch (t.on) {
    case 'auto':
      // Fires on the rising edge: the moment all conditions become true.
      lines.push(conds ? `when becomes_true(${conds}):` : 'when room.start:');
      break;
    case 'enter':
      lines.push('when room.enter:');
      break;
    case 'talk': {
      const who = ref(room, t.source ?? '');
      lines.push(`when talk_to(${who.arg}):  # ${who.note}`);
      break;
    }
  }
  if (t.on !== 'auto' && conds) {
    lines.push(`${INDENT}if ${conds}:`);
    depth = 2;
  }
  const pad = INDENT.repeat(depth);
  if (t.actions.length === 0) lines.push(`${pad}pass  # no actions yet`);
  for (const a of t.actions) lines.push(pad + actionCode(p, room, a));
  return lines;
}

/** The trigger as one pseudocode string. */
export function triggerCode(p: Project, room: Room, t: Trigger, header = true): string {
  return triggerCodeLines(p, room, t, header).join('\n');
}

/** Token classes for highlighting a line of pseudocode (keyword, fn, str, num, comment, plain). */
export type CodeToken = { kind: 'kw' | 'fn' | 'str' | 'num' | 'com' | 'txt'; text: string };

const KEYWORDS = new Set(['when', 'if', 'and', 'or', 'not', 'pass', 'True', 'False', 'None']);

/** Split a pseudocode line into highlight tokens (concatenating every token's text gives the line back). */
export function tokenizeCode(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  const re = /(#.*$)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_.]*)(\s*\()?|(\s+|[^\sA-Za-z0-9_"#]+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[1]) out.push({ kind: 'com', text: m[1] });
    else if (m[2]) out.push({ kind: 'str', text: m[2] });
    else if (m[3]) out.push({ kind: 'num', text: m[3] });
    else if (m[4]) {
      const word = m[4];
      out.push({ kind: KEYWORDS.has(word) ? 'kw' : m[5] ? 'fn' : 'txt', text: word });
      if (m[5]) out.push({ kind: 'txt', text: m[5] });
    } else out.push({ kind: 'txt', text: m[0] });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}
