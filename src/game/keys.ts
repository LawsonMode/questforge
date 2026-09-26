// On-screen names of the pad buttons (keyboard labels from the input module's
// default map), shared by the item messages (state.ts), the in-game UI and the
// title screen, so a hint never names a key the game does not use.
import type { Button } from './api';
import { CONTROL_HINTS, DEFAULT_KEYMAP } from '../input/input';

/**
 * Keyboard label of a pad button for on-screen hints ('X', 'ENTER', 'Q', ...):
 * the input module's control hint, else the first key of the default key map.
 */
export function keyLabel(b: Button): string {
  const hint = (CONTROL_HINTS as Partial<Record<Button, string>>)[b];
  if (hint) return hint.toUpperCase();
  const code = Object.keys(DEFAULT_KEYMAP).find((k) => DEFAULT_KEYMAP[k] === b) ?? b;
  return code.replace(/^(Key|Arrow)/, '').toUpperCase();
}

/** A key name as written inside a sentence: one letter stays upper case ('Z'), longer names are capitalised ('Enter'). */
export function keyWord(b: Button): string {
  const label = keyLabel(b);
  return label.length <= 1 ? label : label[0] + label.slice(1).toLowerCase();
}
