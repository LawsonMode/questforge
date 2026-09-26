// "Iron Maw" - boss theme. E minor with a Phrygian bII (F), fast 168 BPM, 16 bars, galloping bass. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const A = 'Em | Em | C | D | Em | Em | F | B7';
const B = 'Am | B7 | Em | C | Am | B7 | C | B7';

const melody = `
  @1 v11 %0 m8 q6
  o5 e8 e8 r8 e8 g8 f+8 e8 d+8 | o5 e4 o4 b4 r8 b8 o5 c8 d8 | o5 e8 e8 r8 e8 g8 e8 c8 e8 | o5 f+4 d4 r8 d8 e8 f+8 |
  o5 g8 g8 r8 g8 b8 a8 g8 f+8 | o5 g4 e4 r8 e8 f+8 g8 | o5 a8 g8 f8 e8 f8 a8 o6 c8 o5 a8 | o5 b4 f+4 d+4 o4 b4 |
  q7 m14
  o5 c4. o4 b8 a4 o5 c4 | o5 d+4. c+8 o4 b4 o5 d+4 | o5 e8 f+8 g8 a8 b4 g4 | o5 e4. f+8 g4 e4 |
  o5 a4. g8 e4 c4 | o5 d+4 f+4 a4 b4 | o6 c4. o5 b8 a4 g4 | o5 f+2 d+4 o4 b4 |
`;

const ARP = { pattern: '0121012101210121', len: 16, low: 52 } as const;
const GALLOP = { pattern: '0-000-000-002-22', len: 16, low: 40, triad: true } as const;

const drums = `
  v9
  [[K16 K16 H8 S8 H8 K8 K8 S8 H8 |]3 S16 S16 S16 S16 S16 S16 S16 S16 K8 S8 K8 S8 |]4
`;

/** Builds the boss theme (accompaniment expanded from the chord charts). */
export function boss(): SongSource {
  const harmony = `@2 v5 q5 %1 ${comp(A, ARP)} ${comp(B, ARP)}`;
  const bass = `v15 q6 %0 ${comp(A, GALLOP)} ${comp(B, GALLOP)}`;
  return {
    bpm: 168,
    bar: 4,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
