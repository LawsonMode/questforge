// Web Audio voice primitives: band-limited pulse and stepped-triangle waves
// (PeriodicWave), LFSR noise buffers, and one-shot tone scheduling with
// envelope, glide, bend-in and vibrato. Nothing here runs at import time.
import { envelopePoints, type Env } from './envelope';

/** p12/p25/p50 = pulse duties; tri = 4-bit stepped triangle; noise = white LFSR; metal = short-period LFSR. */
export type Wave = 'p12' | 'p25' | 'p50' | 'tri' | 'noise' | 'metal' | 'sine';
/** Pulse wave for each duty index used by song notation (`@0`..`@2`). */
export const DUTY_WAVES: readonly Wave[] = ['p12', 'p25', 'p50'];

const HARMONICS = 64;
const LONG_LFSR = 32767;
/** Short-mode LFSR period is 93 (or 31); 93 * 20 samples loops seamlessly either way. */
const SHORT_LFSR = 93 * 20;

export interface ToneSpec {
  wave: Wave;
  /** Absolute start time (context seconds). */
  t: number;
  /** Seconds held before the release starts. */
  gate: number;
  /** Frequency in Hz; for noise waves the buffer playback rate (1 = brightest). */
  freq: number;
  /** Exponential glide target, reached after `glide` seconds (default: gate). */
  freqEnd?: number;
  glide?: number;
  /** Peak gain. */
  vol: number;
  env: Env;
  /** Vibrato: rate in Hz, depth in cents, onset delay in seconds. */
  vib?: { rate: number; depth: number; delay: number };
  /** Bend-in: start `bend` cents away and slide to pitch over `bendTime` seconds. */
  bend?: number;
  bendTime?: number;
}

/** A scheduled source and the time it finishes (for early stops and voice counting). */
export interface Scheduled {
  node: AudioScheduledSourceNode;
  end: number;
}

/** Per-context wave tables and noise buffers. */
export interface WaveBank {
  waves: Readonly<Record<'p12' | 'p25' | 'p50' | 'tri', PeriodicWave>>;
  noise: AudioBuffer;
  metal: AudioBuffer;
}

/** Fourier coefficients of a +-1 pulse wave with the given duty (DC removed). */
export function pulseCoefficients(duty: number, harmonics = HARMONICS): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) real[n] = (4 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return { real, imag };
}

/** Fourier coefficients of a 32-step (4-bit) triangle, the classic chip bass timbre. */
export function steppedTriangleCoefficients(harmonics = HARMONICS): { real: Float32Array; imag: Float32Array } {
  const N = 2048;
  const samples = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const phase = k / N;
    const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    samples[k] = Math.round(((tri + 1) / 2) * 15) / 7.5 - 1;
  }
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < N; k++) {
      const w = (2 * Math.PI * n * k) / N;
      re += samples[k] * Math.cos(w);
      im += samples[k] * Math.sin(w);
    }
    real[n] = (2 * re) / N;
    imag[n] = (2 * im) / N;
  }
  return { real, imag };
}

/** 15-bit LFSR noise (+-1). Short mode taps bit 6, giving a metallic, pitched buzz. */
export function lfsrNoise(length: number, short: boolean): Float32Array {
  const out = new Float32Array(length);
  let reg = 1;
  const tap = short ? 6 : 1;
  for (let i = 0; i < length; i++) {
    out[i] = reg & 1 ? -1 : 1;
    const fb = (reg & 1) ^ ((reg >> tap) & 1);
    reg = (reg >> 1) | (fb << 14);
  }
  return out;
}

const banks = new WeakMap<BaseAudioContext, WaveBank>();
let noiseCursor = 0;

function periodic(ctx: BaseAudioContext, c: { real: Float32Array; imag: Float32Array }): PeriodicWave {
  return ctx.createPeriodicWave(c.real, c.imag, { disableNormalization: true });
}

function buffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

/** Wave tables for a context (built once per context). */
export function getBank(ctx: BaseAudioContext): WaveBank {
  let bank = banks.get(ctx);
  if (!bank) {
    bank = {
      waves: {
        p12: periodic(ctx, pulseCoefficients(0.125)),
        p25: periodic(ctx, pulseCoefficients(0.25)),
        p50: periodic(ctx, pulseCoefficients(0.5)),
        tri: periodic(ctx, steppedTriangleCoefficients()),
      },
      noise: buffer(ctx, lfsrNoise(LONG_LFSR, false)),
      metal: buffer(ctx, lfsrNoise(SHORT_LFSR, true)),
    };
    banks.set(ctx, bank);
  }
  return bank;
}

interface Source {
  src: AudioScheduledSourceNode;
  pitch: AudioParam;
  detune: AudioParam;
  begin(when: number): void;
}

function createSource(ctx: BaseAudioContext, bank: WaveBank, s: ToneSpec): Source {
  if (s.wave === 'noise' || s.wave === 'metal') {
    const b = ctx.createBufferSource();
    const buf = s.wave === 'noise' ? bank.noise : bank.metal;
    b.buffer = buf;
    b.loop = true;
    b.playbackRate.value = s.freq;
    // Start each noise hit at a different point in the buffer so repeats don't sound identical.
    noiseCursor = (noiseCursor + 0.137) % 1;
    const offset = noiseCursor * buf.duration;
    return { src: b, pitch: b.playbackRate, detune: b.detune, begin: (when) => b.start(when, offset) };
  }
  const o = ctx.createOscillator();
  if (s.wave === 'sine') o.type = 'sine';
  else o.setPeriodicWave(bank.waves[s.wave]);
  o.frequency.value = s.freq;
  return { src: o, pitch: o.frequency, detune: o.detune, begin: (when) => o.start(when) };
}

/** Schedules one note into `dest`. Returns the source and its end time. */
export function playTone(ctx: BaseAudioContext, bank: WaveBank, dest: AudioNode, s: ToneSpec): Scheduled {
  const amp = ctx.createGain();
  const pts = envelopePoints(s.env, s.vol, s.gate);
  // GainNode defaults to 1: zero it first so a sub-sample-early source start can't leak a full-scale click.
  amp.gain.value = 0;
  amp.gain.setValueAtTime(0, s.t);
  for (let i = 1; i < pts.length; i++) amp.gain.linearRampToValueAtTime(pts[i][1], s.t + pts[i][0]);
  const end = s.t + pts[pts.length - 1][0] + 0.005;

  const { src, pitch, detune, begin } = createSource(ctx, bank, s);
  if (s.freqEnd !== undefined && s.freqEnd !== s.freq) {
    pitch.setValueAtTime(s.freq, s.t);
    pitch.exponentialRampToValueAtTime(Math.max(0.0001, s.freqEnd), s.t + Math.max(0.005, s.glide ?? s.gate));
  }
  if (s.bend) {
    detune.setValueAtTime(s.bend, s.t);
    detune.linearRampToValueAtTime(0, s.t + (s.bendTime ?? 0.05));
  }
  if (s.vib && s.vib.depth > 0) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.frequency.value = s.vib.rate;
    depth.gain.setValueAtTime(0, s.t);
    depth.gain.setValueAtTime(0, s.t + s.vib.delay);
    depth.gain.linearRampToValueAtTime(s.vib.depth, s.t + s.vib.delay + 0.12);
    lfo.connect(depth).connect(detune);
    lfo.start(s.t);
    lfo.stop(end);
  }
  src.connect(amp).connect(dest);
  begin(s.t);
  src.stop(end);
  src.onended = () => amp.disconnect();
  return { node: src, end };
}
