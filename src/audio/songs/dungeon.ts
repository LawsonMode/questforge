// "The Deep Halls" - dungeon theme. C minor, 112 BPM, A B A (24 bars), pulsing octave bass. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const A = 'Cm | Cm | Ab | Ab | Fm | Fm | G | G';
const B = 'Eb | Bb | Cm | Ab | Fm | Db | G | G7';

const MEL_A = `
  r4 o4 g4 a-4 g4 | o4 f+4 g2. | r4 o5 c4 d-4 c4 | o4 b4 o5 c2. |
  o5 c4 o4 a-4 f4 a-4 | o5 d-4 c4 o4 a-4 f4 | o4 g4 b4 o5 d4 f4 | o5 e-2 d2 |
`;
const MEL_B = `
  o5 e-2. d8 c8 | o5 d2 o4 b-4 f4 | o4 g4. a-8 g4 e-4 | o5 c2. e-4 |
  o5 f4. e-8 d-4 c4 | o5 d-4 f4 a-4 f4 | o5 g2 f4 d4 | o4 b2. r4 |
`;
const melody = `@1 v11 %0 m20 q7 ${MEL_A} ${MEL_B} ${MEL_A}`;

const STABS = { pattern: 'r1r2r1r2', len: 8, low: 55 } as const;
const ARP = { pattern: '0121012101210121', len: 16, low: 51 } as const;
const PULSE = { pattern: '00300030', len: 8, low: 36, triad: true } as const;

const beat = 'K8 H8 H8 K8 S8 H8 H8 H8 |';
const DR_A = `[${beat}]7 K8 H8 S16 S16 S8 S8 S8 S16 S16 S8 |`;
const drums = `v9 ${DR_A} [[${beat}]3 K8 H8 H8 K8 S8 S8 S8 S8 |]2 ${DR_A}`;

/** Builds the dungeon theme (accompaniment expanded from the chord charts). */
export function dungeon(): SongSource {
  const harmony = `@0 v6 q4 %1 ${comp(A, STABS)} v5 q6 ${comp(B, ARP)} v6 q4 ${comp(A, STABS)}`;
  const bass = `v15 q5 %0 ${comp(A, PULSE)} ${comp(B, PULSE)} ${comp(A, PULSE)}`;
  return {
    bpm: 112,
    bar: 4,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
