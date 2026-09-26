// Drum kit for the music noise channel (see the K S H O T C tokens in mml.ts).
import type { DrumId } from './mml';
import type { Part } from './parts';

/** Each drum hit is a short stack of parts; levels are scaled by the channel volume. */
export const DRUMS: Readonly<Record<DrumId, readonly Part[]>> = {
  // Kick: a fast falling thump with a tiny noise click on top.
  K: [
    { wave: 'sine', f: 150, to: 42, glide: 0.09, dur: 0.09, vol: 1 },
    { wave: 'noise', f: 0.3, dur: 0.012, vol: 0.3 },
  ],
  // Snare: bright noise burst over a short tonal body.
  S: [
    { wave: 'noise', f: 0.6, to: 0.35, dur: 0.13, vol: 0.55 },
    { wave: 'tri', f: 200, to: 140, dur: 0.05, vol: 0.45 },
  ],
  H: [{ wave: 'noise', f: 1, dur: 0.028, vol: 0.26 }],
  O: [{ wave: 'noise', f: 1, dur: 0.16, vol: 0.22 }],
  // Tom / timpani: pitched triangle drop plus low rumble.
  T: [
    { wave: 'tri', f: 120, to: 72, dur: 0.2, vol: 0.9 },
    { wave: 'noise', f: 0.1, dur: 0.08, vol: 0.18 },
  ],
  C: [
    { wave: 'noise', f: 0.85, dur: 0.9, vol: 0.3 },
    { wave: 'metal', f: 0.9, dur: 0.35, vol: 0.06 },
  ],
};
