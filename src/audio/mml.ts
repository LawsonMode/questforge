// Compact MML-style song notation -> timed note events. Pure; no Web Audio.
//
// Syntax (case-sensitive, whitespace ignored):
//   c d e f g a b   note; '+' or '#' sharp, '-' flat; optional length and dots: c+8.
//                   length n = a 1/n note (4 = one beat; 12 = eighth triplet); none = current `l`
//   r               rest (same length rules)        ^len  tie: extends the previous note or rest
//   K S H O T C     drum hits (noise channel): kick, snare, closed hat, open hat, tom, crash
//   o<n>  >  <      octave (o4 c = middle C = MIDI 60) / octave up / octave down
//   l<len>          default length                  v<0-15>  volume
//   @<0-2>          pulse duty 12.5 / 25 / 50 %     (noise notes: @0 white, @1 metallic)
//   q<1-8>          gate: n/8 of each note sounds before its release
//   %<n>            envelope preset (ENVELOPES in envelope.ts)
//   m<cents>        vibrato depth, 0 = off          s<+-n>  bend into each note from n semitones away
//   k<+-n>          transpose following notes by n semitones
//   [ ... ]n        repeat n times (default 2); ':' inside skips the rest of the block on the last pass
//   $               loop point: looping songs jump back here (default: the start)
//   |               bar line (verified by checkBars, otherwise ignored)
import { ENVELOPES } from './envelope';
import { PITCH_CLASS } from './pitch';

/** Timing resolution: ticks per beat (quarter note). 384 ticks = whole note. */
export const TICKS_PER_BEAT = 96;
const WHOLE = TICKS_PER_BEAT * 4;

/** The four chip channels a song can use. */
export type Voice = 'pulse1' | 'pulse2' | 'triangle' | 'noise';
/** Every channel, in the order tracks are built. */
export const VOICES: readonly Voice[] = ['pulse1', 'pulse2', 'triangle', 'noise'];

/** Drum hits for the noise channel: kick, snare, closed hat, open hat, tom, crash. */
export type DrumId = 'K' | 'S' | 'H' | 'O' | 'T' | 'C';
const DRUM_CHARS = 'KSHOTC';

export interface NoteEvent {
  /** Start, in ticks from the start of the song. */
  time: number;
  /** Step length in ticks (including ties). */
  dur: number;
  /** Sounding length in ticks before the release. */
  gate: number;
  /** MIDI note (C4 = 60); -1 for drum hits. */
  midi: number;
  drum: DrumId | null;
  /** Volume 0..1. */
  vol: number;
  /** Duty index (0 = 12.5 %, 1 = 25 %, 2 = 50 %). */
  duty: number;
  /** Envelope preset index. */
  env: number;
  /** Vibrato depth in cents. */
  vib: number;
  /** Bend-in distance in semitones. */
  bend: number;
}

export interface Track {
  voice: Voice;
  events: NoteEvent[];
  /** Total length in ticks. */
  length: number;
  /** Tick of the '$' loop point (0 if none). */
  loopStart: number;
  /** Tick position of every '|' bar line. */
  bars: number[];
}

/** A song as authored: tempo, meter and one MML string per channel. */
export interface SongSource {
  /** Tempo in beats (quarter notes) per minute. */
  bpm: number;
  /** Beats per bar (used to verify bar lines). */
  bar: number;
  loop: boolean;
  /** Echo on the pulse channels: delay in beats, feedback and wet level (0..1). */
  echo?: { beats: number; feedback: number; mix: number };
  channels: Partial<Record<Voice, string>>;
}

/** A parsed, validated song: all tracks share the same length and loop point. */
export interface Song {
  bpm: number;
  bar: number;
  loop: boolean;
  echo?: { beats: number; feedback: number; mix: number };
  tracks: Track[];
  /** Length in ticks. */
  length: number;
  /** Loop point in ticks. */
  loopStart: number;
}

interface State {
  octave: number;
  len: number;
  vol: number;
  duty: number;
  gate: number;
  env: number;
  vib: number;
  bend: number;
  transpose: number;
}

class MmlParser {
  private pos = 0;
  private time = 0;
  private loopMark: number | null = null;
  private last: NoteEvent | 'rest' | null = null;
  private readonly events: NoteEvent[] = [];
  private readonly bars: number[] = [];
  private readonly st: State = { octave: 4, len: TICKS_PER_BEAT, vol: 12, duty: 2, gate: 7, env: 0, vib: 0, bend: 0, transpose: 0 };

  constructor(private readonly src: string, private readonly voice: Voice) {}

  parse(): Track {
    this.run(0, this.src.length, false, 0);
    return { voice: this.voice, events: this.events, length: this.time, loopStart: this.loopMark ?? 0, bars: this.bars };
  }

  /** Parses src[start, end). `lastPass` = final iteration of the enclosing repeat. */
  private run(start: number, end: number, lastPass: boolean, depth: number): void {
    this.pos = start;
    while (this.pos < end) {
      const at = this.pos;
      const ch = this.src[this.pos++];
      if (/\s/.test(ch)) continue;
      if (ch in PITCH_CLASS) this.note(ch);
      else if (DRUM_CHARS.includes(ch)) this.drum(ch as DrumId);
      else if (ch === 'r') this.rest(this.readLen() ?? this.st.len);
      else if (ch === '^') this.tie(this.readLen() ?? this.st.len);
      else if (ch === '|') this.bars.push(this.time);
      else if (ch === '>') this.setOctave(this.st.octave + 1);
      else if (ch === '<') this.setOctave(this.st.octave - 1);
      else if (ch === '[') this.repeat(at, depth);
      else if (ch === ':') {
        if (depth === 0) this.fail(at, "':' outside a repeat");
        if (lastPass) return;
      } else if (ch === '$') {
        if (depth > 0 || this.loopMark !== null) this.fail(at, "'$' must appear once, outside repeats");
        this.loopMark = this.time;
      } else this.command(ch, at);
    }
  }

  private command(ch: string, at: number): void {
    const st = this.st;
    switch (ch) {
      case 'o': this.setOctave(this.int(at, 0, 9)); break;
      case 'l': st.len = this.readLen() ?? this.fail(at, 'l needs a length'); break;
      case 'v': st.vol = this.int(at, 0, 15); break;
      case '@': st.duty = this.int(at, 0, 2); break;
      case 'q': st.gate = this.int(at, 1, 8); break;
      case '%': st.env = this.int(at, 0, ENVELOPES.length - 1); break;
      case 'm': st.vib = this.int(at, 0, 200); break;
      case 's': st.bend = this.int(at, -24, 24, true); break;
      case 'k': st.transpose = this.int(at, -24, 24, true); break;
      default: this.fail(at, `unexpected '${ch}'`);
    }
  }

  private note(letter: string): void {
    let pc = PITCH_CLASS[letter];
    for (;;) {
      const c = this.src[this.pos];
      if (c === '+' || c === '#') pc++;
      else if (c === '-') pc--;
      else break;
      this.pos++;
    }
    const midi = 12 * (this.st.octave + 1) + pc + this.st.transpose;
    if (midi < 12 || midi > 120) this.fail(this.pos - 1, `note out of range (MIDI ${midi})`);
    this.emit(midi, null, this.readLen() ?? this.st.len);
  }

  private drum(id: DrumId): void {
    this.emit(-1, id, this.readLen() ?? this.st.len);
  }

  private emit(midi: number, drum: DrumId | null, ticks: number): void {
    const st = this.st;
    const ev: NoteEvent = {
      time: this.time, dur: ticks, gate: (ticks * st.gate) / 8, midi, drum,
      vol: st.vol / 15, duty: st.duty, env: st.env, vib: st.vib, bend: st.bend,
    };
    this.events.push(ev);
    this.last = ev;
    this.time += ticks;
  }

  private rest(ticks: number): void {
    this.last = 'rest';
    this.time += ticks;
  }

  private tie(ticks: number): void {
    const ev = this.last;
    if (ev && ev !== 'rest') {
      ev.dur += ticks;
      ev.gate = ev.dur - ticks * (1 - this.st.gate / 8);
    }
    this.time += ticks;
  }

  private repeat(open: number, depth: number): void {
    let level = 1;
    let close = this.pos;
    for (; close < this.src.length && level > 0; close++) {
      if (this.src[close] === '[') level++;
      else if (this.src[close] === ']') level--;
    }
    if (level > 0) this.fail(open, "unclosed '['");
    const closeAt = close - 1;
    this.pos = close;
    const count = this.readDigits() ?? 2;
    if (count < 1) this.fail(open, 'repeat count must be >= 1');
    const resume = this.pos;
    for (let i = 0; i < count; i++) this.run(open + 1, closeAt, i === count - 1, depth + 1);
    this.pos = resume;
  }

  private setOctave(o: number): void {
    if (o < 0 || o > 9) this.fail(this.pos - 1, `octave ${o} out of range`);
    this.st.octave = o;
  }

  /** Optional length (digits + dots) in ticks; null when absent. */
  private readLen(): number | null {
    const n = this.readDigits();
    let dots = 0;
    while (this.src[this.pos] === '.') {
      dots++;
      this.pos++;
    }
    if (n === null && dots === 0) return null;
    if (n !== null && (n <= 0 || WHOLE % n !== 0)) this.fail(this.pos - 1, `unsupported length ${n}`);
    let part = n === null ? this.st.len : WHOLE / n;
    let total = part;
    for (let i = 0; i < dots; i++) {
      if (part % 2 !== 0) this.fail(this.pos - 1, 'too many dots for this length');
      part /= 2;
      total += part;
    }
    return total;
  }

  private readDigits(): number | null {
    const m = /^\d+/.exec(this.src.slice(this.pos, this.pos + 6));
    if (!m) return null;
    this.pos += m[0].length;
    return Number(m[0]);
  }

  private int(at: number, lo: number, hi: number, signed = false): number {
    let sign = 1;
    if (signed && (this.src[this.pos] === '-' || this.src[this.pos] === '+')) {
      sign = this.src[this.pos] === '-' ? -1 : 1;
      this.pos++;
    }
    const n = this.readDigits();
    if (n === null) this.fail(at, `'${this.src[at]}' needs a number`);
    const v = sign * n;
    if (v < lo || v > hi) this.fail(at, `'${this.src[at]}${v}' out of range ${lo}..${hi}`);
    return v;
  }

  private fail(at: number, msg: string): never {
    const near = this.src.slice(Math.max(0, at - 12), at + 12).replace(/\s+/g, ' ');
    throw new Error(`MML ${this.voice} @${at}: ${msg} (near "${near}")`);
  }
}

/** Parses one channel of MML. Throws a descriptive Error on bad input. */
export function parseMml(src: string, voice: Voice): Track {
  return new MmlParser(src, voice).parse();
}

/** Parses and validates a song: every channel must share one length and loop point. */
export function parseSong(src: SongSource, name = 'song'): Song {
  const tracks = VOICES.filter((v) => src.channels[v] !== undefined).map((v) => parseMml(src.channels[v]!, v));
  if (tracks.length === 0) throw new Error(`${name}: no channels`);
  const { length, loopStart } = tracks[0];
  if (length <= 0) throw new Error(`${name}: empty song`);
  for (const t of tracks) {
    if (t.length !== length) {
      throw new Error(`${name}: ${t.voice} lasts ${t.length / TICKS_PER_BEAT} beats, ${tracks[0].voice} ${length / TICKS_PER_BEAT}`);
    }
    if (t.loopStart !== loopStart) throw new Error(`${name}: ${t.voice} loop point differs`);
  }
  return { bpm: src.bpm, bar: src.bar, loop: src.loop, echo: src.echo, tracks, length, loopStart };
}

/** Lists bars whose length differs from `beatsPerBar` (empty = all bars are well formed). */
export function checkBars(track: Track, beatsPerBar: number): string[] {
  const want = beatsPerBar * TICKS_PER_BEAT;
  const marks = [0, ...track.bars];
  if (marks[marks.length - 1] !== track.length) marks.push(track.length);
  const problems: string[] = [];
  for (let i = 1; i < marks.length; i++) {
    const got = marks[i] - marks[i - 1];
    if (got !== want) problems.push(`${track.voice} bar ${i}: ${got / TICKS_PER_BEAT} beats`);
  }
  return problems;
}

/** Converts ticks to seconds at a tempo. */
export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks * 60) / (bpm * TICKS_PER_BEAT);
}
