// On-screen names of the pad buttons for the device in use (keyboard keys, or the
// glyphs of the connected Xbox / PlayStation / Nintendo pad - see input/devices.ts),
// shared by the in-game UI and the title screen, so a hint always names a button
// the player can actually press. Labels change when the player switches device:
// call these at draw time, not once at module load. liveText() wraps a hint
// builder so it re-runs only after a change (labelsVersion() counts them).
// Dialogue and item messages name buttons with {btn:x} tokens instead, which the
// dialogue box replaces (input/devices.ts substituteButtons).
import type { Button } from './api';
import { buttonLabel, buttonWord, onControlsChange } from '../input/devices';

let version = 0;
onControlsChange(() => {
  version++;
});

/** Label of a pad button for on-screen hints ('X', 'ENTER', 'A', PS cross glyph, 'MENU', ...). */
export function keyLabel(b: Button): string {
  return buttonLabel(b);
}

/** A button name as written inside a sentence ('Z', 'A', 'Enter', 'Menu'). */
export function keyWord(b: Button): string {
  return buttonWord(b);
}

/** Bumped whenever button labels may have changed (device switched, another pad, controller prefs). */
export function labelsVersion(): number {
  return version;
}

/**
 * A hint built from the current labels, rebuilt only after they change:
 * `const hint = liveText(() => `${keyLabel('a')}: OK`)`, then `hint()` at draw time.
 */
export function liveText(build: () => string): () => string {
  let at = -1;
  let text = '';
  return () => {
    if (at !== version) {
      text = build();
      at = version;
    }
    return text;
  };
}
