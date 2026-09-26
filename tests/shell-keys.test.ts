// Editor shell: keyboard shortcut rules (layouts, focused controls, dialogs).
import { describe, expect, it } from 'vitest';
import { editorShortcut, isTextEntry, ownsCharacterKeys, shortcutLetter, type KeyPress } from '../src/editor/shell/keys';

/** A duck-typed focused element. */
function focused(tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}): EventTarget {
  return { tagName, ...extra } as unknown as EventTarget;
}

function press(key: string, code: string, mods: Partial<KeyPress> = {}): KeyPress {
  return { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, ...mods };
}

const BODY = focused('BODY');
const TEXT = focused('INPUT', { type: 'text' });
const NUMBER = focused('INPUT', { type: 'number' });
const CHECKBOX = focused('INPUT', { type: 'checkbox' });
const RANGE = focused('INPUT', { type: 'range' });
const SELECT = focused('SELECT');
const TEXTAREA = focused('TEXTAREA');
const EDITABLE = focused('DIV', { isContentEditable: true });

describe('shortcutLetter', () => {
  it('uses the typed character on Latin layouts', () => {
    expect(shortcutLetter({ key: 'z', code: 'KeyY' })).toBe('z'); // QWERTZ
    expect(shortcutLetter({ key: 'z', code: 'KeyW' })).toBe('z'); // AZERTY
    expect(shortcutLetter({ key: 'Z', code: 'KeyZ' })).toBe('z'); // Shift held
  });

  it('falls back to the physical key on non-Latin layouts', () => {
    expect(shortcutLetter({ key: 'я', code: 'KeyZ' })).toBe('z');
    expect(shortcutLetter({ key: 'ז', code: 'KeyS' })).toBe('s');
  });
});

describe('focused controls', () => {
  it('treats only real text entry as typing', () => {
    for (const t of [TEXT, NUMBER, TEXTAREA, EDITABLE, focused('INPUT', { type: 'search' })]) expect(isTextEntry(t)).toBe(true);
    for (const t of [BODY, CHECKBOX, RANGE, SELECT, focused('BUTTON'), null]) expect(isTextEntry(t)).toBe(false);
  });

  it('gives a select its type-ahead keys but not a checkbox', () => {
    expect(ownsCharacterKeys(SELECT)).toBe(true);
    expect(ownsCharacterKeys(TEXT)).toBe(true);
    expect(ownsCharacterKeys(CHECKBOX)).toBe(false);
  });
});

describe('editorShortcut', () => {
  it('undoes and redoes on every layout', () => {
    expect(editorShortcut(press('z', 'KeyZ', { ctrlKey: true, target: BODY }), false)).toEqual({ kind: 'undo' });
    expect(editorShortcut(press('z', 'KeyY', { ctrlKey: true, target: BODY }), false)).toEqual({ kind: 'undo' });
    expect(editorShortcut(press('y', 'KeyZ', { ctrlKey: true, target: BODY }), false)).toEqual({ kind: 'redo' });
    expect(editorShortcut(press('Z', 'KeyZ', { ctrlKey: true, shiftKey: true, target: BODY }), false)).toEqual({ kind: 'redo' });
    expect(editorShortcut(press('z', 'KeyZ', { metaKey: true, target: BODY }), false)).toEqual({ kind: 'undo' });
  });

  it('keeps undo working right after ticking a checkbox or changing a select', () => {
    expect(editorShortcut(press('z', 'KeyZ', { ctrlKey: true, target: CHECKBOX }), false)).toEqual({ kind: 'undo' });
    expect(editorShortcut(press('z', 'KeyZ', { ctrlKey: true, target: SELECT }), false)).toEqual({ kind: 'undo' });
    expect(editorShortcut(press('y', 'KeyY', { ctrlKey: true, target: RANGE }), false)).toEqual({ kind: 'redo' });
  });

  it('leaves Ctrl+Z to text fields (native text undo)', () => {
    for (const t of [TEXT, NUMBER, TEXTAREA, EDITABLE]) expect(editorShortcut(press('z', 'KeyZ', { ctrlKey: true, target: t }), false)).toBeNull();
  });

  it('saves with Ctrl+S anywhere, even in a text field or behind a dialog', () => {
    expect(editorShortcut(press('s', 'KeyS', { ctrlKey: true, target: TEXT }), false)).toEqual({ kind: 'save' });
    expect(editorShortcut(press('s', 'KeyS', { ctrlKey: true, target: BODY }), true)).toEqual({ kind: 'save' });
    expect(editorShortcut(press('s', 'KeyS', { ctrlKey: true, altKey: true, target: BODY }), false)).toBeNull();
  });

  it('switches tabs with 1-4 unless the key types into a control', () => {
    expect(editorShortcut(press('1', 'Digit1', { target: BODY }), false)).toEqual({ kind: 'tab', index: 0 });
    expect(editorShortcut(press('4', 'Digit4', { target: CHECKBOX }), false)).toEqual({ kind: 'tab', index: 3 });
    expect(editorShortcut(press('5', 'Digit5', { target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('2', 'Digit2', { target: TEXT }), false)).toBeNull();
    expect(editorShortcut(press('2', 'Digit2', { target: SELECT }), false)).toBeNull();
    expect(editorShortcut(press('!', 'Digit1', { shiftKey: true, target: BODY }), false)).toBeNull();
  });

  it('switches tabs with Alt+1-4 too (the Art tab keeps plain digits), except while typing', () => {
    expect(editorShortcut(press('1', 'Digit1', { altKey: true, target: BODY }), false)).toEqual({ kind: 'tab', index: 0 });
    expect(editorShortcut(press('¡', 'Digit1', { altKey: true, target: SELECT }), false)).toEqual({ kind: 'tab', index: 0 });
    expect(editorShortcut(press('4', 'Digit4', { altKey: true, target: CHECKBOX }), false)).toEqual({ kind: 'tab', index: 3 });
    expect(editorShortcut(press('2', 'Digit2', { altKey: true, target: TEXT }), false)).toBeNull();
    expect(editorShortcut(press('2', 'Digit2', { altKey: true, ctrlKey: true, target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('!', 'Digit1', { altKey: true, shiftKey: true, target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('5', 'Digit5', { altKey: true, target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('1', 'Digit1', { altKey: true, target: BODY }), true)).toBeNull();
  });

  it('opens help with ? outside text fields', () => {
    expect(editorShortcut(press('?', 'Slash', { shiftKey: true, target: BODY }), false)).toEqual({ kind: 'help' });
    expect(editorShortcut(press('?', 'Slash', { shiftKey: true, target: TEXTAREA }), false)).toBeNull();
  });

  it('playtests with F5 / Shift+F5, even from a text field', () => {
    expect(editorShortcut(press('F5', 'F5', { target: TEXT }), false)).toEqual({ kind: 'playtest', here: false });
    expect(editorShortcut(press('F5', 'F5', { shiftKey: true, target: BODY }), false)).toEqual({ kind: 'playtest', here: true });
  });

  it('ignores everything but Ctrl+S while a dialog is open', () => {
    for (const k of [press('F5', 'F5'), press('z', 'KeyZ', { ctrlKey: true }), press('1', 'Digit1'), press('?', 'Slash')]) {
      expect(editorShortcut({ ...k, target: BODY }, true)).toBeNull();
    }
  });

  it('ignores other Alt combinations and unrelated keys', () => {
    expect(editorShortcut(press('z', 'KeyZ', { ctrlKey: true, altKey: true, target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('c', 'KeyC', { ctrlKey: true, target: BODY }), false)).toBeNull();
    expect(editorShortcut(press('a', 'KeyA', { target: BODY }), false)).toBeNull();
  });
});
