// Bus graph: songs -> duck -> music volume -> master -> mute -> limiter -> out; sfx -> sfx volume -> master.

/** Bus levels, each 0..1. */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

/** Levels used until setVolumes() is called. */
export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.7, sfx: 0.9 };

/** Music level while ducked, and the dip/recovery times in seconds. */
const DUCK_LEVEL = 0.25;
const DUCK_ATTACK = 0.08;
const DUCK_RELEASE = 0.5;
/** Time constant for volume changes (avoids zipper noise). */
const SMOOTH = 0.02;

/** The engine's bus graph (one per context): song and SFX inputs, volumes, mute, duck and a safety limiter. */
export class Mixer {
  /** Input for song players. */
  readonly music: GainNode;
  /** Input for sound effects. */
  readonly sfx: GainNode;
  private readonly musicVol: GainNode;
  private readonly master: GainNode;
  private readonly mute: GainNode;
  private duckEnd = 0;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, vol: Volumes, muted: boolean) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(dest);
    this.mute = this.gain(muted ? 0 : 1, limiter);
    this.master = this.gain(vol.master, this.mute);
    this.musicVol = this.gain(vol.music, this.master);
    this.music = this.gain(1, this.musicVol);
    this.sfx = this.gain(vol.sfx, this.master);
  }

  /** Glides the master/music/SFX levels to `v` (no zipper noise). */
  setVolumes(v: Volumes): void {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, now, SMOOTH);
    this.musicVol.gain.setTargetAtTime(v.music, now, SMOOTH);
    this.sfx.gain.setTargetAtTime(v.sfx, now, SMOOTH);
  }

  /** Fades everything out (or back in) within a few milliseconds. */
  setMuted(m: boolean): void {
    this.mute.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, SMOOTH);
  }

  /** Dips the music for `seconds` (overlapping ducks extend each other), then recovers smoothly. */
  duck(seconds: number): void {
    const now = this.ctx.currentTime;
    const g = this.music.gain;
    const hold = Math.max(this.duckEnd, now + seconds, now + DUCK_ATTACK);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK);
    g.setValueAtTime(DUCK_LEVEL, hold);
    g.linearRampToValueAtTime(1, hold + DUCK_RELEASE);
    this.duckEnd = hold;
  }

  private gain(value: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(to);
    return g;
  }
}
