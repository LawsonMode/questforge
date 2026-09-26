// Audio runtime logic against a fake Web Audio context: sequencer timing across loop wraps,
// late-note skipping, stop/dispose, duck automation, SFX gap/cap, one-shot retirement and
// gesture unlocking. The fake records every source start/stop and every param automation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SFX_IDS } from '../src/core/types';
import { ChipAudio, MAX_SFX_EFFECTS } from '../src/audio/audio';
import { DEFAULT_VOLUMES, Mixer } from '../src/audio/mixer';
import { parseSong, type Song } from '../src/audio/mml';
import { SongPlayer } from '../src/audio/sequencer';
import { getBank } from '../src/audio/voices';

interface Automation { kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel'; v: number; t: number }

/** AudioParam stand-in: records automation and, like the real one, rejects non-finite values. */
class FakeParam {
  readonly events: Automation[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number): this { return this.push('set', v, t); }
  linearRampToValueAtTime(v: number, t: number): this { return this.push('linear', v, t); }
  exponentialRampToValueAtTime(v: number, t: number): this { return this.push('exp', v, t); }
  setTargetAtTime(v: number, t: number): this { return this.push('target', v, t); }
  cancelScheduledValues(t: number): this { return this.push('cancel', 0, t); }
  private push(kind: Automation['kind'], v: number, t: number): this {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`non-finite ${kind} automation`);
    this.events.push({ kind, v, t });
    return this;
  }
}

class FakeNode {
  disconnected = false;
  connect<T>(dest: T): T { return dest; }
  disconnect(): void { this.disconnected = true; }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam(440);
  readonly playbackRate = new FakeParam(1);
  readonly detune = new FakeParam(0);
  type = 'custom';
  buffer: unknown = null;
  loop = false;
  constructor(ctx: FakeContext) {
    super();
    ctx.sources.push(this);
  }
  start(when = 0): void { this.startAt = when; }
  stop(when = 0): void {
    if (this.startAt === null) throw new Error('stop() before start()');
    this.stopAt = when;
  }
  setPeriodicWave(): void {}
}

/** Minimal BaseAudioContext/AudioContext with a settable clock. */
class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  static initialState: AudioContextState = 'running';
  currentTime = 0;
  readonly sampleRate = 8000;
  state: AudioContextState = FakeContext.initialState;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];

  constructor() {
    super();
    FakeContext.instances.push(this);
  }

  static last(): FakeContext {
    return FakeContext.instances[FakeContext.instances.length - 1];
  }

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeSource { return new FakeSource(this); }
  createBufferSource(): FakeSource { return new FakeSource(this); }
  createPeriodicWave(): object { return {}; }
  createBuffer(_channels: number, length: number, rate: number): object {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createDelay(): object { return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) }); }
  createDynamicsCompressor(): object {
    const p = (): FakeParam => new FakeParam(0);
    return Object.assign(new FakeNode(), { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() });
  }
  resume(): Promise<void> {
    this.setState('running');
    return Promise.resolve();
  }
  setState(state: AudioContextState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

const asCtx = (c: FakeContext): BaseAudioContext => c as unknown as BaseAudioContext;
const asNode = (n: FakeNode): AudioNode => n as unknown as AudioNode;
const round = (x: number | null): number => Math.round((x ?? NaN) * 1e6) / 1e6;
const starts = (c: FakeContext): number[] => c.sources.map((s) => round(s.startAt));

/** 60 BPM (1 beat = 1 s): intro note, then a two-beat loop body. */
const LOOPING: Song = parseSong({ bpm: 60, bar: 1, loop: true, channels: { pulse1: 'c4 $ d4 e4' } });

function player(song: Song, start: number): { ctx: FakeContext; p: SongPlayer } {
  const ctx = new FakeContext();
  const p = new SongPlayer(asCtx(ctx), getBank(asCtx(ctx)), asNode(ctx.createGain()), 'title', song, start);
  return { ctx, p };
}

describe('SongPlayer', () => {
  it('schedules exact note times across loop wraps, however the horizon is chunked', () => {
    const chunked = player(LOOPING, 0.5);
    for (const until of [0.7, 2, 2.01, 4, 6]) chunked.p.schedule(until);
    const once = player(LOOPING, 0.5);
    once.p.schedule(6);
    expect(starts(chunked.ctx)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
    expect(starts(once.ctx)).toEqual(starts(chunked.ctx));
    const hz = chunked.ctx.sources.map((s) => Math.round(s.frequency.value));
    expect(hz).toEqual([262, 294, 330, 294, 330, 294]);
  });

  it('skips notes a stalled timer left far behind, but plays slightly late ones immediately', () => {
    const { ctx, p } = player(LOOPING, 0.5);
    p.schedule(1);
    ctx.currentTime = 2.47;
    p.schedule(2.6);
    ctx.currentTime = 3.53;
    p.schedule(3.6);
    expect(starts(ctx)).toEqual([0.5, 2.5, 3.53]);
  });

  it('stop() fades out, cuts notes that would outlast the fade and schedules nothing after', () => {
    const { ctx, p } = player(LOOPING, 0.5);
    p.schedule(6);
    p.stop(2, 0.35);
    expect(p.fadeEnd).toBeCloseTo(2.35, 9);
    const [first, ...rest] = ctx.sources;
    expect(first.stopAt).toBeLessThan(2.35);
    for (const s of rest) expect(round(s.stopAt)).toBe(2.35);
    const out = ctx.gains[1].gain.events;
    expect(out.at(-1)).toEqual({ kind: 'linear', v: 0, t: 2.35 });
    const count = ctx.sources.length;
    p.schedule(20);
    expect(ctx.sources.length).toBe(count);
    p.dispose();
    expect(ctx.gains[1].disconnected).toBe(true);
  });

  it('plays one-shot songs once and reports when they end', () => {
    const song = parseSong({ bpm: 120, bar: 1, loop: false, channels: { pulse1: 'c4 d4' } });
    const { ctx, p } = player(song, 0.25);
    p.schedule(100);
    expect(starts(ctx)).toEqual([0.25, 0.75]);
    expect(p.endTime).toBeCloseTo(0.25 + 1 + 0.6, 9);
    expect(player(LOOPING, 0).p.endTime).toBe(Infinity);
  });
});

describe('Mixer.duck', () => {
  it('dips, holds and recovers; overlapping ducks extend the hold instead of stacking', () => {
    const ctx = new FakeContext();
    const mixer = new Mixer(asCtx(ctx), asNode(ctx.destination), DEFAULT_VOLUMES, false);
    const events = (mixer.music.gain as unknown as FakeParam).events;
    const tail = (): Array<[string, number, number]> => events.slice(-5).map((e) => [e.kind, round(e.v), round(e.t)]);
    ctx.currentTime = 1;
    mixer.duck(2);
    expect(tail()).toEqual([['cancel', 0, 1], ['set', 1, 1], ['linear', 0.25, 1.08], ['set', 0.25, 3], ['linear', 1, 3.5]]);
    ctx.currentTime = 2;
    mixer.duck(0.5);
    expect(tail().slice(3)).toEqual([['set', 0.25, 3], ['linear', 1, 3.5]]);
    ctx.currentTime = 2.5;
    mixer.duck(2);
    expect(tail().slice(3)).toEqual([['set', 0.25, 4.5], ['linear', 1, 5]]);
  });
});

describe('ChipAudio runtime', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeContext);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    warn.mockRestore();
    FakeContext.initialState = 'running';
  });

  function running(): { a: ChipAudio; ctx: FakeContext } {
    const a = new ChipAudio();
    a.unlock();
    const ctx = FakeContext.last();
    expect(a.status).toBe('running');
    return { a, ctx };
  }

  it('merges re-triggers inside an effect\'s gap', () => {
    const { a, ctx } = running();
    a.sfx('sword');
    const n = ctx.sources.length;
    expect(n).toBeGreaterThan(0);
    a.sfx('sword');
    expect(ctx.sources.length).toBe(n);
    ctx.currentTime = 0.05;
    a.sfx('sword');
    expect(ctx.sources.length).toBeGreaterThan(n);
  });

  it(`caps concurrent effects at ${MAX_SFX_EFFECTS} and frees slots as they finish`, () => {
    const { a, ctx } = running();
    const ids = SFX_IDS.slice(0, MAX_SFX_EFFECTS + 6);
    let played = 0;
    for (const id of ids) {
      const before = ctx.sources.length;
      a.sfx(id);
      if (ctx.sources.length > before) played++;
    }
    expect(played).toBe(MAX_SFX_EFFECTS);
    ctx.currentTime = 5;
    const before = ctx.sources.length;
    a.sfx(ids[ids.length - 1]);
    expect(ctx.sources.length).toBeGreaterThan(before);
  });

  it('treats NaN options as defaults and unknown effects as a warning, never a throw', () => {
    const { a, ctx } = running();
    a.sfx('rupee', { volume: NaN, pitch: NaN });
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
    expect(() => a.sfx('bogus' as never)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retires a finished one-shot track to "none"', () => {
    vi.useFakeTimers();
    const { a, ctx } = running();
    a.music('victory');
    expect(a.currentMusic).toBe('victory');
    expect(ctx.sources.length).toBeGreaterThan(0);
    ctx.currentTime = 30;
    vi.advanceTimersByTime(25);
    expect(a.currentMusic).toBe('none');
  });

  it('fades the old track out and starts the new one after a short overlap', () => {
    vi.useFakeTimers();
    const { a, ctx } = running();
    a.music('overworld');
    for (let t = 0.025; t <= 1; t += 0.025) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(25);
    }
    const before = ctx.sources.length;
    const at = ctx.currentTime;
    a.music('dungeon');
    const fadeOut = ctx.gains.some((g) => g.gain.events.some((e) => e.kind === 'linear' && e.v === 0 && round(e.t) === round(at + 0.35)));
    expect(fadeOut).toBe(true);
    for (let t = at + 0.025; t <= at + 0.5; t += 0.025) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(25);
    }
    const fresh = ctx.sources.slice(before).map((s) => s.startAt ?? 0);
    expect(fresh.length).toBeGreaterThan(0);
    expect(Math.min(...fresh)).toBeGreaterThanOrEqual(at + 0.2);
    expect(a.currentMusic).toBe('dungeon');
    expect(warn).not.toHaveBeenCalled();
  });

  it('unlocks on touch/click gestures and re-arms them when the context is interrupted', async () => {
    vi.stubGlobal('window', new EventTarget());
    FakeContext.initialState = 'suspended';
    const a = new ChipAudio();
    expect(a.status).toBe('locked');
    window.dispatchEvent(new Event('touchend'));
    await Promise.resolve();
    expect(a.status).toBe('running');
    const ctx = FakeContext.last();
    const resume = vi.spyOn(ctx, 'resume');
    window.dispatchEvent(new Event('click'));
    expect(resume).not.toHaveBeenCalled();
    ctx.setState('suspended');
    expect(a.status).toBe('suspended');
    window.dispatchEvent(new Event('pointerup'));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('running');
  });
});
