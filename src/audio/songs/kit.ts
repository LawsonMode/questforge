// Song-writing helpers: expand chord charts into MML accompaniment lines.
// Output uses absolute octaves ('o3a8'), so fragments never disturb each other's octave state.

const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
const ROOTS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
};

export interface Chord {
  /** Root pitch class (0 = C). */
  root: number;
  /** Semitones above the root, ascending. */
  intervals: readonly number[];
}

/** Parses a chord symbol: root letter, optional '#'/'b', quality ('', m, 7, m7, maj7, dim, sus4, ...). */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  const intervals = m ? QUALITIES[m[3]] : undefined;
  if (!m || !intervals) throw new Error(`unknown chord "${symbol}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { root: (ROOTS[m[1]] + acc + 12) % 12, intervals };
}

/** MML token for a MIDI note with an absolute octave, e.g. 62 -> 'o4d'. */
export function mmlNote(midi: number): string {
  return `o${Math.floor(midi / 12) - 1}${NOTE_NAMES[midi % 12]}`;
}

export interface CompOptions {
  /** One bar of steps: digit = chord tone index (ascending from the root, wrapping up an octave), 'r' = rest, '-' = hold. */
  pattern: string;
  /** Step length as an MML length (8 = eighth notes). */
  len: number;
  /** Lowest allowed MIDI note for each root; roots land in [low, low + 12). */
  low: number;
  /** Beats per bar (default 4). */
  bar?: number;
  /** Use only root/third/fifth, so index 3 is the octave even on seventh chords. */
  triad?: boolean;
}

/**
 * Expands a chord chart into one MML accompaniment line with bar lines.
 * Chart: bars separated by '|'; several chords in one bar split it evenly ('G A7'),
 * each restarting the pattern from its first step.
 */
export function comp(chart: string, o: CompOptions): string {
  const steps = ((o.bar ?? 4) * o.len) / 4;
  if (o.pattern.length !== steps) throw new Error(`pattern "${o.pattern}" needs ${steps} steps`);
  return chart.split('|').map((bar) => {
    const chords = bar.trim().split(/\s+/);
    if (steps % chords.length !== 0) throw new Error(`bar "${bar}" cannot be split evenly`);
    const each = steps / chords.length;
    return `${chords.map((c) => figure(parseChord(c), o.pattern.slice(0, each), o)).join(' ')} |`;
  }).join(' ');
}

function figure(chord: Chord, pattern: string, o: CompOptions): string {
  const tones = o.triad ? chord.intervals.slice(0, 3) : chord.intervals;
  const root = o.low + ((chord.root - o.low) % 12 + 12) % 12;
  const out: string[] = [];
  for (const step of pattern) {
    if (step === '-') {
      if (out.length === 0) throw new Error(`pattern "${pattern}" starts with a hold`);
      out.push(`^${o.len}`);
    } else if (step === 'r') {
      out.push(`r${o.len}`);
    } else {
      const i = Number(step);
      if (!Number.isInteger(i)) throw new Error(`bad pattern step "${step}"`);
      out.push(`${mmlNote(root + tones[i % tones.length] + 12 * Math.floor(i / tones.length))}${o.len}`);
    }
  }
  return out.join(' ');
}
