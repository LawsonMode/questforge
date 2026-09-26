// Volume envelopes (pure data + math; no Web Audio here).

/** Linear ADSR envelope. Times in seconds; `s` is the sustain level as a fraction of the peak. */
export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

/** Music envelope presets, selected with `%n` in song notation. */
export const ENVELOPES: readonly Env[] = [
  { a: 0.004, d: 0.08, s: 0.85, r: 0.03 }, // 0 organ: full, steady
  { a: 0.003, d: 0.16, s: 0.35, r: 0.05 }, // 1 pluck: bright attack, quick fall
  { a: 0.06, d: 0.25, s: 0.8, r: 0.14 }, //   2 pad: swelling
  { a: 0.002, d: 0.12, s: 0, r: 0.02 }, //    3 perc: short blip
  { a: 0.003, d: 0.6, s: 0.12, r: 0.35 }, //  4 bell: long ringing decay
  { a: 0.025, d: 0.3, s: 0.6, r: 0.1 }, //    5 soft: gentle attack
];

/** Named shapes for SFX/drum parts; `dur` is the part's held length. */
export type EnvName = 'hold' | 'perc' | 'bell' | 'pluck' | 'soft';

/** Resolves an SFX envelope (named or explicit) for a part held `dur` seconds. Default 'perc'. */
export function resolveEnv(env: Env | EnvName | undefined, dur: number): Env {
  if (typeof env === 'object') return env;
  switch (env) {
    case 'hold': return { a: 0.004, d: 0, s: 1, r: 0.03 };
    case 'bell': return { a: 0.002, d: dur, s: 0.25, r: 0.25 };
    case 'pluck': return { a: 0.003, d: 0.08, s: 0.4, r: 0.05 };
    case 'soft': return { a: 0.03, d: dur * 0.5, s: 0.6, r: 0.08 };
    default: return { a: 0.002, d: dur, s: 0, r: 0.015 };
  }
}

/**
 * Piecewise-linear gain curve for a note held `gate` seconds at `peak` gain:
 * [offset seconds, gain] points starting at (0, 0) and ending at 0 after the release.
 */
export function envelopePoints(env: Env, peak: number, gate: number): Array<[number, number]> {
  const a = Math.max(0.001, env.a);
  const r = Math.max(0.005, env.r);
  const g = Math.max(0.001, gate);
  const sus = peak * env.s;
  const pts: Array<[number, number]> = [[0, 0]];
  if (g <= a) {
    pts.push([g, (peak * g) / a]);
  } else {
    pts.push([a, peak]);
    if (env.d <= 0) {
      pts.push([a, sus], [g, sus]);
    } else if (g <= a + env.d) {
      pts.push([g, peak + ((sus - peak) * (g - a)) / env.d]);
    } else {
      pts.push([a + env.d, sus], [g, sus]);
    }
  }
  pts.push([g + r, 0]);
  return pts;
}
