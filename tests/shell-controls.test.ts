// Device-aware controls lists (menu Controls card, editor help, playtest bar)
// and the dialogue editor's {btn:x} codes.
import { afterEach, describe, expect, it } from 'vitest';
import { FALLBACK_PAD, GAME_CONTROLS, keyboardKeys, knownPad, labelPad, padButtons, padWord } from '../src/app/controls';
import { BUTTON_TOKENS, pageStats, withButtons } from '../src/editor/dialogue/dialogueModel';
import { setControllerPrefs, type ControlsInfo, type PadFamily } from '../src/input/devices';

const padOf = (family: PadFamily): ControlsInfo => ({ device: 'gamepad', family, padName: null, padIndex: null });
const KEYBOARD: ControlsInfo = { device: 'keyboard', family: 'generic', padName: null, padIndex: null };

afterEach(() => {
  setControllerPrefs({ swapFaceButtons: false });
});

describe('controls lists', () => {
  it('list every game control once, move first', () => {
    expect(GAME_CONTROLS.map((c) => c.button)).toEqual(['move', 'b', 'a', 'y', 'start', 'select', 'l']);
    for (const c of GAME_CONTROLS) expect(c.short.length).toBeLessThanOrEqual(c.what.length);
  });

  it('keyboard keys never change', () => {
    expect(keyboardKeys('move')).toEqual(['Arrows', 'WASD']);
    expect(['b', 'a', 'y', 'start', 'select'].map((b) => keyboardKeys(b as 'b')[0])).toEqual(['Z', 'X', 'C', 'Enter', 'Shift']);
    expect(keyboardKeys('l')).toEqual(['Q', 'E']);
  });

  it('without a controller the labels are A/B/X/Y and Menu/View', () => {
    expect(knownPad()).toBeNull(); // no Gamepad API under node
    expect(labelPad()).toBe(FALLBACK_PAD);
    expect(['b', 'a', 'y', 'start', 'select'].map((b) => padWord(b as 'b'))).toEqual(['A', 'B', 'X', 'Menu', 'View']);
    expect(padButtons('move')).toEqual(['D-pad', 'Stick']);
    expect(padButtons('l')).toEqual(['LB', 'RB']);
  });

  it('name each family by the glyph on the button in that position (DOM text: Unicode shapes)', () => {
    const ps = padOf('playstation');
    expect(['b', 'a', 'y'].map((b) => padWord(b as 'b', ps))).toEqual(['✕', '○', '□']);
    expect(padButtons('start', ps)).toEqual(['Options']);
    expect(padButtons('l', ps)).toEqual(['L1', 'R1']);
    const nin = padOf('nintendo');
    expect(['b', 'a', 'y', 'start', 'select'].map((b) => padWord(b as 'b', nin))).toEqual(['B', 'A', 'Y', '+', '-']);
  });

  it('follow the swapped face buttons', () => {
    setControllerPrefs({ swapFaceButtons: true });
    expect(padWord('b', padOf('xbox'))).toBe('B');
    expect(padWord('a', padOf('xbox'))).toBe('A');
    expect(padWord('a', padOf('playstation'))).toBe('✕');
  });
});

describe('dialogue button codes', () => {
  it('every offered code is replaced for keyboards and pads', () => {
    for (const info of [KEYBOARD, padOf('xbox'), padOf('playstation'), padOf('nintendo')]) {
      const page = withButtons({ text: BUTTON_TOKENS.map((t) => t.token).join(' ') }, { info });
      expect(page.text).not.toMatch(/\{btn:/);
    }
  });

  it('replaces codes in the text, the speaker and the answers, leaving other fields alone', () => {
    const page = { speaker: 'Guide {btn:start}', text: 'Press {btn:a} to talk, {btn:move} to walk.', choice: { options: ['{btn:b}!', 'No'], flag: 'f' } };
    expect(withButtons(page, { info: KEYBOARD })).toEqual({
      speaker: 'Guide Enter', text: 'Press X to talk, arrow keys to walk.', choice: { options: ['Z!', 'No'], flag: 'f' },
    });
    expect(withButtons(page, { info: padOf('xbox') }).text).toBe('Press B to talk, D-pad to walk.');
    expect(page.text).toBe('Press {btn:a} to talk, {btn:move} to walk.'); // the source page is untouched
    expect(withButtons({ text: 'Hi {name} {btn:zz}' }, { info: KEYBOARD })).toEqual({ text: 'Hi {name} {btn:zz}' });
  });

  it('page stats measure the text as the game shows it', () => {
    // 45 x "{btn:a} " is 360 characters as typed but only 90 once shown ("X X X ..."): one box.
    const s = pageStats({ text: '{btn:a} '.repeat(45).trim() });
    expect(s.chars).toBe(359);
    expect(s.boxes).toBe(1);
  });
});
