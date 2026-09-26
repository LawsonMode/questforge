// Editor keyboard shortcuts as a pure mapping (key press + focused control ->
// action), so the rules are unit-testable without a DOM.

/** What an editor key press asks for. */
export type EditorShortcut =
  | { kind: 'playtest'; here: boolean }
  | { kind: 'save' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'tab'; index: number }
  | { kind: 'help' };

/** The parts of a KeyboardEvent the shortcut rules read. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

/** The parts of a focused element the rules read (duck-typed so tests need no DOM). */
interface FocusedControl {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
}

/** Input types the user types text into. */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week',
]);

function control(target: EventTarget | null): FocusedControl | null {
  const t = target as FocusedControl | null;
  return t && typeof t.tagName === 'string' ? t : null;
}

/** Whether `target` is a text-entry control, where native editing keys (Ctrl+Z included) win. */
export function isTextEntry(target: EventTarget | null): boolean {
  const t = control(target);
  if (!t) return false;
  if (t.isContentEditable === true || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(t.type ?? 'text').toLowerCase());
}

/** Whether plain character keys belong to `target` (typing, or a select's type-ahead). */
export function ownsCharacterKeys(target: EventTarget | null): boolean {
  return isTextEntry(target) || control(target)?.tagName === 'SELECT';
}

/** A shortcut's letter: the typed character on Latin layouts (so QWERTZ/AZERTY Ctrl+Z is Z), else the physical key. */
export function shortcutLetter(e: Pick<KeyPress, 'key' | 'code'>): string {
  return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
}

/** The tab a digit key 1-4 (by physical key, any layout) stands for. */
function tabDigit(e: Pick<KeyPress, 'code'>): EditorShortcut | null {
  const digit = /^Digit([1-4])$/.exec(e.code);
  return digit ? { kind: 'tab', index: Number(digit[1]) - 1 } : null;
}

/**
 * Map a key press to an editor shortcut; null leaves the key alone.
 * `modalOpen` = a dialog is showing (only Ctrl+S still works then).
 * Tabs: 1-4, or Alt+1-4 where a tab uses the plain digits itself (the Art
 * tab's pixel editor picks colours with them).
 */
export function editorShortcut(e: KeyPress, modalOpen: boolean): EditorShortcut | null {
  if (e.key === 'F5') return modalOpen ? null : { kind: 'playtest', here: e.shiftKey };
  const mod = e.ctrlKey || e.metaKey;
  const letter = shortcutLetter(e);
  if (mod && !e.altKey && letter === 's') return { kind: 'save' };
  if (modalOpen) return null;
  if (e.altKey) return mod || e.shiftKey || isTextEntry(e.target) ? null : tabDigit(e);
  if (mod) {
    if ((letter !== 'z' && letter !== 'y') || isTextEntry(e.target)) return null;
    return letter === 'y' || e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
  }
  if (ownsCharacterKeys(e.target)) return null;
  const tab = e.shiftKey ? null : tabDigit(e);
  if (tab) return tab;
  return e.key === '?' ? { kind: 'help' } : null;
}
