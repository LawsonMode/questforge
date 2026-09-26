// Lookahead song player: turns parsed tracks into scheduled voices a little
// ahead of the audio clock, looping seamlessly from the song's loop point.
import type { MusicId } from '../core/types';
import { DRUMS } from './drums';
import { ENVELOPES } from './envelope';
import { TICKS_PER_BEAT, type NoteEvent, type Song, type Track } from './mml';
import { scheduleParts } from './parts';
import { midiToHz } from './pitch';
import { DUTY_WAVES, playTone, type Scheduled, type WaveBank } from './voices';

/** Peak gain per channel type at volume 15. */
const PULSE_GAIN = 0.15;
const TRIANGLE_GAIN = 0.34;
const DRUM_GAIN = 0.42;
const NOISE_NOTE_GAIN = 0.12;
/** Vibrato speed and onset delay for sequenced notes. */
const VIB_RATE = 5.5;
const VIB_DELAY = 0.16;
/** Notes that would start more than this late (stalled timer) are skipped instead of bunching up. */
const LATE_SKIP = 0.05;
/** Seconds after a one-shot song's last beat before it counts as finished. */
const TAIL = 0.6;

interface Cursor {
  track: Track;
  bus: AudioNode;
  idx: number;
  /** Ticks added to event times (grows by the loop length on every wrap). */
  offset: number;
  /** First event index inside the loop body. */
  loopIdx: number;
  done: boolean;
}

/**
 * Plays one parsed song from context time `start`: call schedule() regularly with a lookahead
 * horizon, stop() to fade out, then dispose() once fadeEnd (or endTime for one-shots) has passed.
 */
export class SongPlayer {
  private readonly out: GainNode;
  private readonly cursors: Cursor[];
  private readonly tick: number;
  private readonly loopLen: number;
  private live: Scheduled[] = [];
  /** Every node this player created besides per-note voices (disconnected on dispose). */
  private readonly graph: AudioNode[] = [];
  private stopAt = Infinity;
  private fadeDone = Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly bank: WaveBank,
    dest: AudioNode,
    /** Track id, so callers can tell what is playing. */
    readonly id: MusicId,
    private readonly song: Song,
    /** Context time of beat 0. */
    readonly start: number,
    fadeIn = 0,
  ) {
    this.tick = 60 / (song.bpm * TICKS_PER_BEAT);
    this.loopLen = song.length - song.loopStart;
    this.out = ctx.createGain();
    if (fadeIn > 0) {
      this.out.gain.value = 0;
      this.out.gain.setValueAtTime(0, start);
      this.out.gain.linearRampToValueAtTime(1, start + fadeIn);
    }
    this.out.connect(dest);
    this.graph.push(this.out);
    const echo = this.createEcho();
    this.cursors = song.tracks.map((track) => {
      const bus = ctx.createGain();
      this.graph.push(bus);
      bus.connect(this.out);
      if (echo && (track.voice === 'pulse1' || track.voice === 'pulse2')) bus.connect(echo);
      const loopIdx = track.events.findIndex((e) => e.time >= song.loopStart);
      return { track, bus, idx: 0, offset: 0, loopIdx: loopIdx < 0 ? track.events.length : loopIdx, done: false };
    });
  }

  /** Context time at which a one-shot song has finished (Infinity for looping songs). */
  get endTime(): number {
    return this.song.loop ? Infinity : this.start + this.song.length * this.tick + TAIL;
  }

  /** Context time at which a stop() fade has finished (Infinity while playing). */
  get fadeEnd(): number {
    return this.fadeDone;
  }

  /** Schedules every note that starts before context time `until`. */
  schedule(until: number): void {
    if (until > this.stopAt) until = this.stopAt;
    for (const c of this.cursors) this.fill(c, until);
    const now = this.ctx.currentTime;
    this.live = this.live.filter((s) => s.end > now);
  }

  /** Fades out from `at` over `fade` seconds and cancels everything scheduled after. */
  stop(at: number, fade: number): void {
    this.stopAt = at;
    this.fadeDone = at + fade;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, at + fade);
    const cut = at + fade;
    for (const s of this.live) {
      if (s.end <= cut) continue;
      try {
        s.node.stop(cut);
      } catch {
        // Already stopped: nothing to cancel.
      }
    }
  }

  /** Disconnects the player's graph (call once its fade has finished). */
  dispose(): void {
    for (const node of this.graph) node.disconnect();
    this.live = [];
  }

  private fill(c: Cursor, until: number): void {
    const events = c.track.events;
    while (!c.done) {
      if (c.idx >= events.length) {
        if (!this.song.loop || this.loopLen <= 0 || c.loopIdx >= events.length) {
          c.done = true;
          break;
        }
        c.idx = c.loopIdx;
        c.offset += this.loopLen;
        continue;
      }
      const ev = events[c.idx];
      const t = this.start + (c.offset + ev.time) * this.tick;
      if (t >= until) break;
      if (t >= this.ctx.currentTime - LATE_SKIP) this.play(c, ev, Math.max(t, this.ctx.currentTime));
      c.idx++;
    }
  }

  private play(c: Cursor, ev: NoteEvent, t: number): void {
    const voice = c.track.voice;
    if (ev.drum) {
      this.live.push(...scheduleParts(this.ctx, this.bank, c.bus, DRUMS[ev.drum], t, { gain: ev.vol * DRUM_GAIN }));
      return;
    }
    const gate = ev.gate * this.tick;
    const noise = voice === 'noise';
    this.live.push(playTone(this.ctx, this.bank, c.bus, {
      wave: noise ? (ev.duty > 0 ? 'metal' : 'noise') : voice === 'triangle' ? 'tri' : DUTY_WAVES[ev.duty],
      t,
      gate,
      freq: noise ? Math.min(1, Math.pow(2, (ev.midi - 108) / 12)) : midiToHz(ev.midi),
      vol: ev.vol * (noise ? NOISE_NOTE_GAIN : voice === 'triangle' ? TRIANGLE_GAIN : PULSE_GAIN),
      env: ENVELOPES[ev.env],
      vib: ev.vib > 0 && gate > VIB_DELAY + 0.05 ? { rate: VIB_RATE, depth: ev.vib, delay: VIB_DELAY } : undefined,
      bend: ev.bend * 100,
      bendTime: Math.min(0.06, gate * 0.5),
    }));
  }

  private createEcho(): AudioNode | null {
    const e = this.song.echo;
    if (!e) return null;
    const send = this.ctx.createGain();
    const delay = this.ctx.createDelay(2);
    const feedback = this.ctx.createGain();
    const wet = this.ctx.createGain();
    delay.delayTime.value = Math.min(1.9, e.beats * TICKS_PER_BEAT * this.tick);
    feedback.gain.value = Math.min(0.85, e.feedback);
    wet.gain.value = e.mix;
    send.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.out);
    this.graph.push(send, delay, feedback, wet);
    return send;
  }
}
