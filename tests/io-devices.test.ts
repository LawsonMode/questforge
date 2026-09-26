// input/devices.ts: pad families and display names, device-aware button labels
// (swapped face buttons included), {btn:x} tokens as sentence words, and the
// connection events trackDevices() reports (wasInUse = the pad in use went away).
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ControlsInfo, type PadConnection, buttonLabel, currentControls, noteKeyboard, notePad, onPadConnection,
  padDisplayName, padFamily, setControllerPrefs, substituteButtons, trackDevices,
} from '../src/input/devices';

const IDS = {
  xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  playstation: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  nintendo: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  generic: 'USB Gamepad (STANDARD GAMEPAD Vendor: 0079 Product: 0011)',
} as const;

const KEYBOARD: ControlsInfo = { device: 'keyboard', family: 'generic', padName: null, padIndex: null };
const pad = (family: ControlsInfo['family']): ControlsInfo => ({ device: 'gamepad', family, padName: 'Pad', padIndex: 0 });

afterEach(() => {
  setControllerPrefs({ swapFaceButtons: false });
  noteKeyboard();
});

describe('pad families and names', () => {
  it('classifies the browsers\' id strings and drops their vendor suffix', () => {
    for (const [family, id] of Object.entries(IDS)) expect(padFamily(id)).toBe(family);
    expect(padDisplayName(IDS.playstation)).toBe('DualSense Wireless Controller');
    expect(padDisplayName('045e-0b13-Xbox Wireless Controller')).toBe('Xbox Wireless Controller');
    expect(padDisplayName('')).toBe('Controller');
  });
});

describe('button labels', () => {
  it('names the button at each SNES position in the family\'s own glyphs', () => {
    expect(['b', 'a', 'y'].map((b) => buttonLabel(b as 'b', { info: pad('xbox') }))).toEqual(['A', 'B', 'X']);
    expect(['b', 'a', 'y'].map((b) => buttonLabel(b as 'b', { info: pad('nintendo') }))).toEqual(['B', 'A', 'Y']);
    expect(['b', 'a', 'y'].map((b) => buttonLabel(b as 'b', { info: pad('playstation'), unicode: true }))).toEqual(['✕', '○', '□']);
    expect(buttonLabel('start', { info: pad('playstation') })).toBe('OPTIONS');
    expect(buttonLabel('b', { info: KEYBOARD })).toBe('Z');
  });

  it('follows the swapped face buttons on a pad but never on the keyboard', () => {
    setControllerPrefs({ swapFaceButtons: true });
    expect(buttonLabel('a', { info: pad('xbox') })).toBe('A');
    expect(buttonLabel('b', { info: pad('xbox') })).toBe('B');
    expect(buttonLabel('a', { info: KEYBOARD })).toBe('X');
  });

  it('writes {btn:x} tokens as words inside a sentence', () => {
    const text = 'Walk with the {btn:move}, press {btn:a}; {btn:start} pauses. {btn:zz} stays.';
    expect(substituteButtons(text, { info: KEYBOARD })).toBe('Walk with the arrow keys, press X; Enter pauses. {btn:zz} stays.');
    expect(substituteButtons(text, { info: pad('xbox') })).toBe('Walk with the D-pad, press B; Menu pauses. {btn:zz} stays.');
    expect(substituteButtons(text, { info: pad('nintendo') })).toBe('Walk with the D-pad, press A; + pauses. {btn:zz} stays.');
  });
});

describe('trackDevices connection events', () => {
  const win = new EventTarget();
  trackDevices(win as unknown as Window);
  const seen: PadConnection[] = [];
  onPadConnection((e) => seen.push(e));
  const fire = (type: 'gamepadconnected' | 'gamepaddisconnected', index: number, id: string): void => {
    const ev = new Event(type);
    Object.defineProperty(ev, 'gamepad', { value: { index, id } });
    win.dispatchEvent(ev);
  };

  it('marks the disconnection of the pad in use, and only that one', () => {
    seen.length = 0;
    fire('gamepadconnected', 0, IDS.xbox);
    fire('gamepadconnected', 1, IDS.playstation);
    notePad(0, IDS.xbox);
    fire('gamepaddisconnected', 1, IDS.playstation);
    expect(currentControls().device).toBe('gamepad');
    fire('gamepaddisconnected', 0, IDS.xbox);
    expect(seen.map((e) => [e.connected, e.index, e.wasInUse])).toEqual([
      [true, 0, false], [true, 1, false], [false, 1, false], [false, 0, true],
    ]);
    expect(seen[0]).toMatchObject({ name: 'Xbox Wireless Controller', family: 'xbox' });
    expect(currentControls()).toMatchObject({ device: 'keyboard', padIndex: null });
  });

  it('switches back to the keyboard on a plain key press, not on a shortcut', () => {
    notePad(0, IDS.xbox);
    const key = (init: KeyboardEventInit): Event => Object.assign(new Event('keydown'), init);
    win.dispatchEvent(key({ ctrlKey: true }));
    expect(currentControls().device).toBe('gamepad');
    win.dispatchEvent(key({}));
    expect(currentControls().device).toBe('keyboard');
  });
});
