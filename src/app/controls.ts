// Device-aware names for the controls lists (menu hub Controls card and
// controller banner, editor help, playtest bar): keyboard keys next to the
// buttons of the controller in use (or the first connected one), in its own
// glyphs; A/B/X/Y and Menu/View when no controller is known. Labels change
// with the device and the swapped-face-buttons preference, so build them when
// drawing and redraw on onControlsChange / onPadConnection.
import type { Button } from '../game/api';
import { CONTROL_HINTS } from '../input/input';
import { buttonLabel, buttonWord, connectedPads, currentControls, type ControlsInfo } from '../input/devices';
import { el } from '../editor/ui/dom';

/** A row of the game's controls. */
export interface ControlRow {
  button: Button | 'move';
  what: string;
  /** For narrow lists (the menu's Controls card). */
  short: string;
}

/** The game's controls, in the order the menu and the editor help list them. */
export const GAME_CONTROLS: readonly ControlRow[] = [
  { button: 'move', what: 'Move', short: 'Move' },
  { button: 'b', what: 'Sword — hold to charge a spin attack', short: 'Sword (hold: spin)' },
  { button: 'a', what: 'Action — talk, read, lift, throw, open, dash', short: 'Action: talk, lift, open' },
  { button: 'y', what: 'Use the selected item', short: 'Use item' },
  { button: 'start', what: 'Pause & inventory', short: 'Pause & items' },
  { button: 'select', what: 'Map', short: 'Map' },
  { button: 'l', what: 'Flip the pause screen’s pages', short: 'Pause pages' },
];

/** Keyboard keys of a control (the keyboard map never changes). */
export function keyboardKeys(b: Button | 'move'): string[] {
  switch (b) {
    case 'move': return ['Arrows', 'WASD'];
    case 'l':
    case 'r': return ['Q', 'E'];
    case 'b':
    case 'a':
    case 'y':
    case 'start':
    case 'select': return [CONTROL_HINTS[b]];
    default: return [buttonLabel(b, { info: { device: 'keyboard', family: 'generic', padName: null, padIndex: null } })];
  }
}

/** The controller in use, else the first connected one, else null. */
export function knownPad(): ControlsInfo | null {
  const now = currentControls();
  if (now.device === 'gamepad') return now;
  const pad = connectedPads()[0];
  return pad ? { device: 'gamepad', family: pad.family, padName: pad.name, padIndex: pad.index } : null;
}

/** Labels shown when no controller is known: A/B/X/Y face buttons, LB/RB, Menu/View. */
export const FALLBACK_PAD: ControlsInfo = { device: 'gamepad', family: 'xbox', padName: null, padIndex: null };

/** The controller to label buttons for: knownPad() or FALLBACK_PAD. */
export function labelPad(): ControlsInfo {
  return knownPad() ?? FALLBACK_PAD;
}

/** Controller buttons of a control as DOM text (real Unicode shapes for PlayStation pads). */
export function padButtons(b: Button | 'move', info: ControlsInfo = labelPad()): string[] {
  if (b === 'move') return ['D-pad', 'Stick'];
  if (b === 'l' || b === 'r') return [padWord('l', info), padWord('r', info)];
  return [padWord(b, info)];
}

/** One controller button's name for DOM text: 'A', '✕', 'Menu', 'LB', '+'. */
export function padWord(b: Button, info: ControlsInfo = labelPad()): string {
  return buttonWord(b, { info, unicode: true });
}

/** The PlayStation shapes as DOM text, by the class that sizes them (system fonts draw □ small). */
const SHAPE_CLASS: Readonly<Record<string, string>> = { '✕': 'cross', '○': 'circle', '□': 'square', '△': 'triangle' };

/** A button drawn as a pad button: round for face buttons, a pill for the rest. */
export function padGlyph(label: string, round = [...label].length === 1): HTMLElement {
  const shape = SHAPE_CLASS[label];
  return el('span', { class: `qf-padbtn${round ? ' qf-padbtn--round' : ''}${shape ? ` qf-padbtn--${shape}` : ''}` }, label);
}
