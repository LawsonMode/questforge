// Dialogue tab model (pure: no DOM): page statistics measured with the game's
// own box layout, {btn:x} button codes, naming, duplication, search and
// flag-name validation.
import type { Dialogue, DialoguePage, Project } from '../../core/types';
import { newId } from '../../core/project';
import { BOX_LINES, layoutDialogue } from '../../game/ui/dialogueLayout';
import { ENGINE_FLAG_PREFIXES } from '../entities/refs';
import { compareNames } from '../entities/labels';
import { copyName, uniqueName } from '../entities/names';
import { DEFAULT_HERO_NAME } from '../../game/state';
import { substituteButtons, type LabelOpts } from '../../input/devices';

/** Name substituted for {name} in previews: the same one playtests use. */
export const PREVIEW_NAME = DEFAULT_HERO_NAME;

export interface PageStats {
  /** Characters of text as typed. */
  chars: number;
  /** Wrapped text lines (after {name} and {btn:x} substitution). */
  lines: number;
  /** Dialogue boxes the page needs in game. */
  boxes: number;
}

/** A button code a dialogue may use: the game shows it as the key or pad button the player uses. */
export interface ButtonToken {
  token: string;
  /** What the button does (menus, help). */
  label: string;
}

/**
 * The {btn:x} codes, in the order the editor offers them: the buttons the game uses.
 * (substituteButtons also knows {btn:x}, the pad's top face button, but the game
 * gives it no job and the keyboard no key, so the editor doesn't offer it.)
 */
export const BUTTON_TOKENS: readonly ButtonToken[] = [
  { token: '{btn:a}', label: 'action' },
  { token: '{btn:b}', label: 'sword' },
  { token: '{btn:y}', label: 'item' },
  { token: '{btn:start}', label: 'pause menu' },
  { token: '{btn:select}', label: 'map' },
  { token: '{btn:l}', label: 'page left' },
  { token: '{btn:r}', label: 'page right' },
  { token: '{btn:move}', label: 'movement' },
];

/**
 * The page as the game shows it: {btn:x} codes in its text, speaker and
 * answers replaced by button names for `opts` (default: the device in use).
 */
export function withButtons(page: DialoguePage, opts?: LabelOpts): DialoguePage {
  const out: DialoguePage = { ...page, text: substituteButtons(page.text, opts) };
  if (page.speaker !== undefined) out.speaker = substituteButtons(page.speaker, opts);
  if (page.choice) out.choice = { ...page.choice, options: page.choice.options.map((o) => substituteButtons(o, opts)) };
  return out;
}

/** How a page lays out in the in-game box (button codes shown for the device in use). */
export function pageStats(page: DialoguePage): PageStats {
  const boxes = layoutDialogue([withButtons(page)], PREVIEW_NAME);
  return {
    chars: page.text.length,
    lines: boxes.reduce((n, b) => n + b.lines.length, 0),
    boxes: boxes.length,
  };
}

/** "42 characters · 2 lines · 1 box" (+ a note when the page spills into more boxes). */
export function statsText(s: PageStats): string {
  const base = `${s.chars} character${s.chars === 1 ? '' : 's'} · ${s.lines} line${s.lines === 1 ? '' : 's'}`;
  if (s.boxes === 0) return `${base} · empty page (skipped in game)`;
  if (s.boxes === 1) return `${base} · 1 box`;
  return `${base} · ${s.boxes} boxes (${BOX_LINES} lines each)`;
}

function dialogueNames(p: Project): Set<string> {
  return new Set(p.dialogues.map((d) => d.name));
}

/** `base`, or `base 2`, `base 3`… so no dialogue shares the name. */
export function uniqueDialogueName(p: Project, base: string): string {
  return uniqueName(base.trim() || 'Dialogue', dialogueNames(p));
}

/**
 * `typed` (trimmed) as the new name of dialogue `id`, numbered ("Name 2") when
 * another dialogue already has it, so pickers never list two alike; null when blank.
 */
export function renamedDialogueName(p: Project, id: string, typed: string): string | null {
  const name = typed.trim();
  if (!name) return null;
  return uniqueName(name, new Set(p.dialogues.filter((d) => d.id !== id).map((d) => d.name)));
}

/** Deep copy with a fresh id and a unique "… copy" name ("X copy 2" when copying "X copy"). */
export function duplicateDialogue(p: Project, d: Dialogue): Dialogue {
  const copy = structuredClone(d);
  copy.id = newId('d');
  copy.name = copyName(d.name || d.id, dialogueNames(p));
  return copy;
}

/** First non-empty page text on one line, shortened to `max` characters. */
export function dialogueSnippet(d: Dialogue, max = 60): string {
  const text = d.pages.map((pg) => pg.text.trim()).find(Boolean) ?? '';
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Dialogues whose name, id, speakers or text contain `query` (case-insensitive), sorted by name. */
export function filterDialogues(list: readonly Dialogue[], query: string): Dialogue[] {
  const q = query.trim().toLowerCase();
  const hit = (d: Dialogue): boolean => !q || [d.name, d.id, ...d.pages.flatMap((pg) => [pg.text, pg.speaker ?? ''])]
    .some((s) => s.toLowerCase().includes(q));
  return list.filter(hit).sort((a, b) => compareNames(a.name || a.id, b.name || b.id));
}

/** Why `name` (trimmed) can't be used as a new flag name (null = fine). `except` is the flag being renamed. */
export function flagNameProblem(p: Project, name: string, except?: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a flag name.';
  if (n !== except && p.flags.some((f) => f.name === n)) return `There is already a flag called “${n}”.`;
  const reserved = ENGINE_FLAG_PREFIXES.find((pre) => n.startsWith(pre));
  if (reserved) return `Names starting with “${reserved}” are used by the engine.`;
  return null;
}

/** Warning for choice answers left blank (null when every answer has text). */
export function blankAnswersWarning(options: readonly string[]): string | null {
  const blank = options.flatMap((o, i) => (o.trim() ? [] : [String(i + 1)]));
  if (!blank.length) return null;
  if (blank.length === 1) return `Answer ${blank[0]} is blank: the player would see an empty choice.`;
  return `Answers ${blank.slice(0, -1).join(', ')} and ${blank[blank.length - 1]} are blank: the player would see empty choices.`;
}

/** Answer count the game supports for a choice. */
export const CHOICE_OPTIONS = { min: 2, max: 3 } as const;

/** Warning when a choice has fewer or more answers than the game shows (null when fine). */
export function choiceCountWarning(count: number): string | null {
  const { min, max } = CHOICE_OPTIONS;
  if (count < min) return `A choice needs at least ${min} answers; this one has ${count}. Add an answer.`;
  if (count > max) return `The game's dialogue box fits at most ${max} answers; this choice has ${count}. Remove ${count - max === 1 ? 'one' : count - max}.`;
  return null;
}

/** A blank page. */
export function blankPage(): DialoguePage {
  return { text: '' };
}
