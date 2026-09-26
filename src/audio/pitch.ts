// Pitch helpers shared by the MML parser, the song kit and SFX definitions.

/** Semitone offset of each natural note letter from C. */
export const PITCH_CLASS: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Parses a note name such as 'c4', 'f#5', 'bb3' or 'c+6' into a MIDI number (C4 = 60). */
export function noteToMidi(name: string): number {
  const m = /^([a-g])([#+b-]?)(\d)$/i.exec(name.trim());
  if (!m) throw new Error(`bad note name "${name}"`);
  const acc = m[2] === '#' || m[2] === '+' ? 1 : m[2] === 'b' || m[2] === '-' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1].toLowerCase()] + acc;
}

/** Frequency in Hz of a note name (see noteToMidi). */
export function hz(name: string): number {
  return midiToHz(noteToMidi(name));
}
