// "Parts": relative one-shot tone descriptions shared by SFX and drum kits.
import { resolveEnv, type Env, type EnvName } from './envelope';
import { hz } from './pitch';
import { playTone, type Scheduled, type Wave, type WaveBank } from './voices';

export interface Part {
  wave: Wave;
  /** Start offset in seconds (default 0). */
  at?: number;
  /** Seconds held before the release. */
  dur: number;
  /** Frequency in Hz; for noise waves the playback rate (1 = brightest). */
  f: number;
  /** Exponential glide target, reached after `glide` seconds (default: dur). */
  to?: number;
  glide?: number;
  /** Peak level 0..1 (default 0.5). */
  vol?: number;
  /** Envelope (default 'perc': instant attack, decays to silence over dur). */
  env?: Env | EnvName;
  /** Vibrato: [rate Hz, depth cents]. */
  vib?: readonly [number, number];
}

/** Seconds from the start of a part list until its last release has finished. */
export function partsLength(parts: readonly Part[]): number {
  let end = 0;
  for (const p of parts) end = Math.max(end, (p.at ?? 0) + p.dur + resolveEnv(p.env, p.dur).r);
  return end;
}

/** Schedules parts at context time t0; pitch multiplies every frequency, gain scales every level. */
export function scheduleParts(
  ctx: BaseAudioContext, bank: WaveBank, dest: AudioNode, parts: readonly Part[], t0: number,
  opts: { pitch?: number; gain: number },
): Scheduled[] {
  const pitch = opts.pitch ?? 1;
  return parts.map((p) => playTone(ctx, bank, dest, {
    wave: p.wave,
    t: t0 + (p.at ?? 0),
    gate: p.dur,
    freq: p.f * pitch,
    freqEnd: p.to !== undefined ? p.to * pitch : undefined,
    glide: p.glide,
    vol: (p.vol ?? 0.5) * opts.gain,
    env: resolveEnv(p.env, p.dur),
    vib: p.vib ? { rate: p.vib[0], depth: p.vib[1], delay: 0 } : undefined,
  }));
}

/** One part at a note name ('e6') or frequency. */
export function tone(wave: Wave, f: number | string, at: number, dur: number, rest: Partial<Part> = {}): Part {
  return { wave, f: typeof f === 'string' ? hz(f) : f, at, dur, ...rest };
}

/** A run of notes, one every `step` seconds starting at `at`. */
export function run(wave: Wave, notes: readonly string[], step: number, at = 0, rest: Partial<Part> = {}): Part[] {
  return notes.map((n, i) => tone(wave, n, at + i * step, rest.dur ?? step, rest));
}
