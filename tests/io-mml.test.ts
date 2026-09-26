// Song notation parser + every composed track: timing, pitch, structure.
import { describe, expect, it } from 'vitest';
import { MUSIC_IDS } from '../src/core/types';
import { TICKS_PER_BEAT, checkBars, parseMml, parseSong, ticksToSeconds } from '../src/audio/mml';
import { hz, midiToHz, noteToMidi } from '../src/audio/pitch';
import { SONG_SOURCES, getSong } from '../src/audio/songs';
import { comp, mmlNote, parseChord } from '../src/audio/songs/kit';

const B = TICKS_PER_BEAT;

describe('pitch helpers', () => {
  it('maps notes to Hz with A4 = 440', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
    expect(noteToMidi('c4')).toBe(60);
    expect(noteToMidi('f#5')).toBe(78);
    expect(noteToMidi('bb3')).toBe(58);
    expect(noteToMidi('c+6')).toBe(85);
    expect(hz('a5')).toBeCloseTo(880, 6);
    expect(() => noteToMidi('h2')).toThrow();
  });
});

describe('parseMml', () => {
  it('parses notes, octaves and accidentals to MIDI / Hz', () => {
    const t = parseMml('o4 a4 > c+8 < b-8 o3 e', 'pulse1');
    expect(t.events.map((e) => e.midi)).toEqual([69, 73, 70, 52]);
    expect(midiToHz(t.events[0].midi)).toBeCloseTo(440, 6);
    expect(midiToHz(t.events[1].midi)).toBeCloseTo(554.365, 2);
  });

  it('handles default length, dots, triplets and ties', () => {
    const t = parseMml('l8 c d4. e12 f12 g12 a2^8 r16 b^', 'pulse1');
    expect(t.events.map((e) => e.dur)).toEqual([B / 2, B * 1.5, B / 3, B / 3, B / 3, B * 2.5, B]);
    expect(t.events.map((e) => e.time)).toEqual([0, B / 2, B * 2, B * 2 + 32, B * 2 + 64, B * 3, B * 5.75]);
    expect(t.length).toBe(B * 6.75);
    // Tied note: gate covers the first segment fully (default q7 applies to the last segment only).
    expect(t.events[5].gate).toBeCloseTo(B * 2 + (B / 2) * (7 / 8), 6);
  });

  it('applies volume, duty, gate, envelope, vibrato, bend and transpose', () => {
    const t = parseMml('v15 @0 q4 %3 m20 s-2 k12 c4 k0 v0 c4', 'pulse2');
    const [a, b] = t.events;
    expect(a).toMatchObject({ vol: 1, duty: 0, env: 3, vib: 20, bend: -2, midi: 72, gate: B / 2 });
    expect(b.vol).toBe(0);
    expect(b.midi).toBe(60);
  });

  it('expands repeats with a last-pass break', () => {
    const t = parseMml('[c8 d8 : e8]3 f8', 'pulse1');
    expect(t.events.map((e) => e.midi)).toEqual([60, 62, 64, 60, 62, 64, 60, 62, 65]);
    const nested = parseMml('[[c16]2 r8]2', 'pulse1');
    expect(nested.events).toHaveLength(4);
    expect(nested.length).toBe(B * 2);
  });

  it('records drums, bar lines and the loop point', () => {
    const t = parseMml('K8 H8 | $ S4 C4 |', 'noise');
    expect(t.events.map((e) => e.drum)).toEqual(['K', 'H', 'S', 'C']);
    expect(t.events[0].midi).toBe(-1);
    expect(t.loopStart).toBe(B);
    expect(t.bars).toEqual([B, B * 3]);
    expect(checkBars(t, 1)).toEqual(['noise bar 2: 2 beats']);
  });

  it('rejects malformed input with a position', () => {
    expect(() => parseMml('c4 x', 'pulse1')).toThrow(/unexpected 'x'/);
    expect(() => parseMml('c5', 'pulse1')).toThrow(/unsupported length/);
    expect(() => parseMml('[c4', 'pulse1')).toThrow(/unclosed/);
    expect(() => parseMml('c4 : d4', 'pulse1')).toThrow(/outside a repeat/);
    expect(() => parseMml('$ c4 $', 'pulse1')).toThrow(/once/);
    expect(() => parseMml('v16 c', 'pulse1')).toThrow(/out of range/);
    expect(() => parseMml('o9 b8 >> c', 'pulse1')).toThrow(/range/);
  });

  it('parseSong enforces equal channel lengths and loop points', () => {
    expect(() => parseSong({ bpm: 120, bar: 4, loop: true, channels: { pulse1: 'c1', triangle: 'c2' } }, 'x')).toThrow(/beats/);
    expect(() => parseSong({ bpm: 120, bar: 4, loop: true, channels: { pulse1: 'c2 $ c2', triangle: 'c1' } }, 'x')).toThrow(/loop/);
    const s = parseSong({ bpm: 120, bar: 4, loop: true, channels: { pulse1: 'c2 $ c2', noise: 'K2 $ S2' } });
    expect(s.length).toBe(B * 4);
    expect(s.loopStart).toBe(B * 2);
    expect(ticksToSeconds(s.length, s.bpm)).toBeCloseTo(2, 9);
  });
});

describe('song kit', () => {
  it('spells chords and places roots in range', () => {
    expect(parseChord('F#m')).toEqual({ root: 6, intervals: [0, 3, 7] });
    expect(parseChord('Bb7').root).toBe(10);
    expect(() => parseChord('Hx')).toThrow();
    expect(mmlNote(62)).toBe('o4d');
    expect(comp('A', { pattern: '0212', len: 4, low: 50 })).toBe('o3a4 o4e4 o4c+4 o4e4 |');
    expect(comp('G A7', { pattern: '0-3-', len: 4, low: 40, triad: true })).toBe('o2g4 ^4 o2a4 ^4 |');
    expect(() => comp('C', { pattern: '012', len: 4, low: 48 })).toThrow(/steps/);
  });
});

describe('every music track', () => {
  it('has a composition for every MusicId', () => {
    expect(Object.keys(SONG_SOURCES).sort()).toEqual([...MUSIC_IDS].sort());
  });

  for (const id of MUSIC_IDS) {
    describe(id, () => {
      const song = getSong(id);

      it('parses, with 3-4 channels of identical length', () => {
        expect(song.tracks.length).toBeGreaterThanOrEqual(3);
        for (const t of song.tracks) {
          expect(t.length, `${id} ${t.voice}`).toBe(song.length);
          expect(t.loopStart, `${id} ${t.voice}`).toBe(song.loopStart);
        }
      });

      it('has well-formed bars in every channel', () => {
        for (const t of song.tracks) expect(checkBars(t, song.bar), `${id} ${t.voice}`).toEqual([]);
        expect(song.length % (song.bar * B)).toBe(0);
      });

      it('keeps pitches in a sensible range per voice', () => {
        for (const t of song.tracks) {
          for (const e of t.events) {
            if (t.voice === 'noise') expect(e.drum ?? e.midi).toBeTruthy();
            else if (t.voice === 'triangle') expect(e.midi, `${id} bass`).toBeGreaterThanOrEqual(28);
            else {
              expect(e.midi, `${id} ${t.voice}`).toBeGreaterThanOrEqual(45);
              expect(e.midi, `${id} ${t.voice}`).toBeLessThanOrEqual(100);
            }
          }
          if (t.voice !== 'noise') expect(t.events.length, `${id} ${t.voice}`).toBeGreaterThan(0);
        }
      });

      it('loops (or not) as its role requires', () => {
        const oneShot = id === 'victory' || id === 'gameover';
        expect(song.loop).toBe(!oneShot);
        const seconds = ticksToSeconds(song.length, song.bpm);
        if (oneShot) expect(seconds).toBeLessThan(12);
        else expect(seconds).toBeGreaterThan(15);
      });
    });
  }

  it('the overworld showpiece loops over at least 32 bars', () => {
    const s = getSong('overworld');
    expect((s.length - s.loopStart) / (s.bar * B)).toBeGreaterThanOrEqual(32);
  });
});
