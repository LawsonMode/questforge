// WebAudio chiptune synth: SFX + sequenced ORIGINAL music. OWNER: input/audio agent.
// Must never throw when audio is unavailable (node tests, blocked autoplay): degrade to silence.
//
// Voices: pulse1/pulse2 (12.5/25/50 % duty PeriodicWaves), a 4-bit stepped triangle and
// LFSR noise (white + short-period metallic). Songs live in ./songs as MML text (see mml.ts),
// played by a lookahead sequencer (~0.12 s ahead, pumped every 25 ms).
import { MUSIC_IDS, type MusicId, type SfxId } from '../core/types';
import type { AudioApi } from '../game/api';
import { clamp } from '../core/math';
import { DEFAULT_VOLUMES, Mixer, type Volumes } from './mixer';
import type { Song } from './mml';
import { partsLength, scheduleParts } from './parts';
import { SongPlayer } from './sequencer';
import { MIN_SFX_GAP, getSfx, type SfxDef } from './sfx';
import { getSong } from './songs';
import { getBank, type WaveBank } from './voices';

const LOOKAHEAD = 0.12;
/** Background tabs throttle timers, so schedule further ahead while hidden. */
const HIDDEN_LOOKAHEAD = 1.2;
const TIMER_MS = 25;
const FADE_OUT = 0.35;
const FADE_IN = 0.05;
/** Level of every SFX part at volume 1 before the SFX bus. */
const SFX_GAIN = 0.8;
/** Most effects sounding at once (each effect may use several oscillators); extra requests are dropped. */
export const MAX_SFX_EFFECTS = 14;
/** Silence rendered before offline captures, so the limiter has settled as it has in a running context. */
const OFFLINE_PREROLL = 0.3;
/** Distinct warnings logged per engine; later ones are dropped so a broken voice can't flood the console. */
const MAX_WARNINGS = 8;
/** Events that count as a user gesture for unlocking audio (iOS Safari only honours touchend/click). */
const GESTURES = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

/** Engine state, e.g. for a "click to enable sound" hint. */
export type AudioStatus = 'unavailable' | 'locked' | 'suspended' | 'running';

type AudioCtor = new (opts?: AudioContextOptions) => AudioContext;

function audioCtor(): AudioCtor | null {
  const g = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Whether the page has had a user gesture (so a new AudioContext may start unmuted). */
function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
  return !!ua?.hasBeenActive;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function isMusicId(id: string): id is MusicId {
  return (MUSIC_IDS as readonly string[]).includes(id);
}

/** A finite option value, clamped; `fallback` when missing or not a number. */
function option(v: number | undefined, lo: number, hi: number, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/** Schedules an SFX definition at t0; returns the time its last voice ends. */
function scheduleSfx(ctx: BaseAudioContext, bank: WaveBank, dest: AudioNode, def: SfxDef, t0: number, pitch: number, volume: number): number {
  scheduleParts(ctx, bank, dest, def.parts, t0, { pitch, gain: SFX_GAIN * volume });
  return t0 + partsLength(def.parts);
}

/**
 * The game's sound engine (implements AudioApi). The AudioContext is created lazily on the
 * first user gesture (unlock(), or the built-in keydown/pointer/touch hooks), and every method
 * degrades to a silent no-op when Web Audio is missing or blocked.
 */
export class ChipAudio implements AudioApi {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private failed = false;
  private track: MusicId | 'none' = 'none';
  private player: SongPlayer | null = null;
  private fading: SongPlayer[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private muted = false;
  private readonly lastPlayed = new Map<SfxId, number>();
  private effectEnds: number[] = [];
  private readonly warnings = new Set<string>();
  private hooked = false;
  private readonly onGesture = (): void => this.unlock();

  constructor() {
    // Auto-unlock on the first gesture in case the host forgets to call unlock().
    if (audioCtor()) this.setGestureHooks(true);
  }

  get currentMusic(): MusicId | 'none' {
    return this.track;
  }

  get status(): AudioStatus {
    if (this.failed || !audioCtor()) return 'unavailable';
    if (!this.ctx) return 'locked';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  /** Plays an effect. `pitch` multiplies its frequencies (1 = normal), `volume` scales it (1 = normal). */
  sfx(id: SfxId, opts?: { volume?: number; pitch?: number }): void {
    if (this.muted) return;
    this.guard(() => {
      const ctx = this.liveContext();
      if (!ctx || !this.mixer) return;
      const def = getSfx(id);
      if (!def) throw new Error(`unknown sfx id "${String(id)}"`);
      const now = ctx.currentTime;
      const last = this.lastPlayed.get(id);
      if (last !== undefined && now - last < (def.gap ?? MIN_SFX_GAP)) return;
      this.effectEnds = this.effectEnds.filter((end) => end > now);
      if (this.effectEnds.length >= MAX_SFX_EFFECTS) return;
      const pitch = opts?.pitch !== undefined && opts.pitch > 0 ? option(opts.pitch, 0.25, 4, 1) : 1;
      const volume = option(opts?.volume, 0, 2, 1);
      this.lastPlayed.set(id, now);
      const end = scheduleSfx(ctx, getBank(ctx), this.mixer.sfx, def, now + 0.005, pitch, volume);
      this.effectEnds.push(end);
      if (def.duck) this.mixer.duck(end - now);
    });
  }

  /**
   * Switches track with a short fade; same track = no-op; 'none' fades out. Unknown ids are
   * ignored (with a warning). One-shot tracks reset to 'none' once they finish playing.
   */
  music(id: MusicId | 'none'): void {
    if (id !== 'none' && !isMusicId(id)) {
      this.warn(new Error(`unknown music id "${String(id)}"`));
      return;
    }
    if (id === this.track) return;
    this.track = id;
    this.guard(() => {
      this.liveContext();
      this.sync();
    });
  }

  /** Dips the music for `seconds`, then recovers smoothly; overlapping ducks extend each other. */
  duck(seconds: number): void {
    this.guard(() => {
      if (this.liveContext() && this.mixer && seconds > 0) this.mixer.duck(seconds);
    });
  }

  /** Sets any of the bus levels (each clamped to 0..1; missing or non-finite values are kept). */
  setVolumes(v: { master?: number; music?: number; sfx?: number }): void {
    this.volumes = {
      master: option(v.master, 0, 1, this.volumes.master),
      music: option(v.music, 0, 1, this.volumes.music),
      sfx: option(v.sfx, 0, 1, this.volumes.sfx),
    };
    this.guard(() => this.mixer?.setVolumes(this.volumes));
  }

  /** Creates/resumes the AudioContext; call from a user gesture. Idempotent. */
  unlock(): void {
    this.guard(() => {
      const ctx = this.context();
      if (!ctx) return;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        ctx.resume().then(() => this.guard(() => this.onStateChange()), () => undefined);
      }
      this.onStateChange();
    });
  }

  /** Silences (or restores) everything; SFX requested while muted are dropped. */
  setMuted(m: boolean): void {
    this.muted = m;
    this.guard(() => this.mixer?.setMuted(m));
  }

  /** The AudioContext, created on first need (null when Web Audio is unavailable). */
  private context(): AudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    const Ctor = audioCtor();
    try {
      if (!Ctor) throw new Error('Web Audio is not available');
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.mixer = new Mixer(ctx, ctx.destination, this.volumes, this.muted);
      ctx.addEventListener('statechange', () => this.guard(() => this.onStateChange()));
      this.ctx = ctx;
    } catch (err) {
      this.failed = true;
      this.setGestureHooks(false);
      if (Ctor) this.warn(err);
    }
    return this.ctx;
  }

  /** The context if it is running; lazily unlocks when the page already had a user gesture. */
  private liveContext(): AudioContext | null {
    if (!this.ctx && hasUserActivation()) this.unlock();
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** Running: start the requested music. Suspended/interrupted (e.g. iOS call): re-arm the gesture hooks. */
  private onStateChange(): void {
    const state = this.ctx?.state;
    if (state === 'running') {
      this.setGestureHooks(false);
      this.sync();
    } else if (state !== undefined && state !== 'closed') {
      this.setGestureHooks(true);
    }
  }

  private setGestureHooks(on: boolean): void {
    if (typeof window === 'undefined' || on === this.hooked) return;
    this.hooked = on;
    for (const type of GESTURES) {
      if (on) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
      else window.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  /** Makes the playing song match `track`. */
  private sync(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.mixer) return;
    if ((this.player?.id ?? 'none') === this.track) return;
    const now = ctx.currentTime;
    const hadSong = this.player !== null;
    if (this.player) {
      this.player.stop(now, FADE_OUT);
      this.fading.push(this.player);
      this.player = null;
    }
    if (this.track !== 'none') {
      const song = this.loadSong(this.track);
      const start = now + (hadSong ? FADE_OUT * 0.6 : 0.05);
      if (song) this.player = new SongPlayer(ctx, getBank(ctx), this.mixer.music, this.track, song, start, FADE_IN);
    }
    this.pump();
    if (!this.timer) this.timer = setInterval(() => this.guard(() => this.pump()), TIMER_MS);
  }

  /** The parsed track, or null (with a warning) if its notation is broken: that track stays silent. */
  private loadSong(id: MusicId): Song | null {
    try {
      return getSong(id);
    } catch (err) {
      this.warn(err);
      return null;
    }
  }

  /** Timer tick: keep the song scheduled ahead, retire finished/faded players. */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const p = this.player;
    if (p && now >= p.endTime) {
      p.dispose();
      this.player = null;
      if (this.track === p.id) this.track = 'none';
    } else if (p) {
      p.schedule(now + (isHidden() ? HIDDEN_LOOKAHEAD : LOOKAHEAD));
    }
    this.fading = this.fading.filter((f) => {
      if (now < f.fadeEnd) return true;
      f.dispose();
      return false;
    });
    if (!this.player && this.fading.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.warn(err);
    }
  }

  /** Logs each distinct problem once (up to MAX_WARNINGS per engine). */
  private warn(err: unknown): void {
    const key = err instanceof Error ? err.message : String(err);
    if (this.warnings.has(key) || this.warnings.size >= MAX_WARNINGS) return;
    this.warnings.add(key);
    console.warn('[audio] disabled part of the sound engine:', err);
  }
}

let shared: ChipAudio | null = null;
/** The app-wide audio instance (game and editor previews share it). */
export function getAudio(): ChipAudio {
  return (shared ??= new ChipAudio());
}

/**
 * Test helper (browser only): renders a music track or sound effect through an
 * OfflineAudioContext using the same mixer, and returns `seconds` of mono samples starting
 * where the sound starts (after a silent pre-roll that settles the limiter).
 */
export async function renderOffline(id: MusicId | SfxId, seconds: number, sampleRate = 44100): Promise<Float32Array> {
  const Ctor = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctor) throw new Error('renderOffline needs OfflineAudioContext (browser only)');
  const t0 = OFFLINE_PREROLL;
  const ctx = new Ctor(1, Math.max(1, Math.ceil((t0 + seconds) * sampleRate)), sampleRate);
  const mixer = new Mixer(ctx, ctx.destination, DEFAULT_VOLUMES, false);
  const bank = getBank(ctx);
  if (isMusicId(id)) {
    new SongPlayer(ctx, bank, mixer.music, id, getSong(id), t0).schedule(t0 + seconds);
  } else {
    const def = getSfx(id);
    if (!def) throw new Error(`unknown sound "${String(id)}"`);
    scheduleSfx(ctx, bank, mixer.sfx, def, t0, 1, 1);
  }
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice(Math.round(t0 * sampleRate));
}
