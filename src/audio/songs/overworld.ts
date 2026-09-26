// "Open Road" - overworld theme. D major march, 132 BPM, 2-bar intro + 32-bar loop (A A' B C). Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const A1 = 'D | D | G | A | Bm | G | E7 | A7';
const A2 = 'D | D | G | A | Bm | G | A7 | D';
const B = 'Bm | F#m | G | D | Em | A | F#7 | Bm';
const C = 'G | A | F#m | Bm | Em | A | G A7 | D';

const melody = `
  q5 @1 v11 %0 m14
  [o5 d8 d8 r8 d8]2 | o5 d4 r4 r4 q7 o4 f+8 g8 |
  $
  o4 a4 f+8 a8 o5 d4 c+8 d8 | o5 e4. d8 f+2 | o5 g8 f+8 e8 d8 o4 b4 o5 d4 | o5 c+4. o4 b8 a2 |
  o4 b8 o5 c+8 d4 f+4. e8 | o5 d4 o4 b4 g4 b4 | o4 g+8 b8 o5 e4 d8 c+8 o4 b4 | o4 a2 r8 a8 b8 o5 c+8 |
  o5 d4 o4 a8 o5 d8 f+4 e8 d8 | o5 e4. f+8 a2 | o5 b8 a8 g8 f+8 e4 g4 | o5 f+4. e8 c+2 |
  o5 d8 e8 f+4 b4 a8 g8 | o5 d4 b4 g4 d4 | o4 a8 b8 o5 c+8 d8 e4 c+4 | o5 d2 r8 o4 f+8 g8 a8 |
  @2 v10 m18
  o4 b2 o5 f+4. e8 | o5 c+2 o4 a4 o5 c+4 | o5 d4. e8 d4 o4 b4 | o4 a2. b8 a8 |
  o4 g4 b4 o5 e4. d8 | o5 c+4 e4 a2 | o5 a+4. g+8 f+4 e4 | o5 d4 c+4 o4 b2 |
  @1 v11 m14
  o4 g8 b8 o5 d8 g8 b4 a4 | o5 e8 c+8 o4 a8 o5 c+8 e4 a4 | o5 a4. g8 f+4 c+4 | o5 d8 c+8 o4 b8 o5 c+8 d4 f+4 |
  o5 g4. f+8 e4 o4 b4 | o5 c+8 d8 e8 f+8 g4 e4 | o5 d4 o4 b4 o5 c+4 e4 | o5 d2 r4 o4 f+8 g8 |
`;

/** Accompaniment: pickup stabs, then comping patterns expanded from the chord charts. */
function harmony(): string {
  return `
    @2 v6 q5 %1
    [o4 a8 a8 r8 a8]2 | o4 a4 r4 r2 |
    $ q6
    ${comp(A1, { pattern: '02120212', len: 8, low: 50 })}
    ${comp(A2, { pattern: '02120212', len: 8, low: 50 })}
    %2 q7 m8
    ${comp(B, { pattern: '2-1-', len: 4, low: 50 })}
    %1 q6 m0 v5
    ${comp(C, { pattern: '0212021202120212', len: 16, low: 50 })}
  `;
}

/** Bass: octave-hopping intro, then root/fifth patterns per section. */
function bass(): string {
  return `
    v15 q6 %0
    o2 d4 o3 d4 o2 d4 o3 d4 | o2 d4 r4 o1 a4 o2 c+4 |
    $
    ${comp(A1, { pattern: '0202', len: 4, low: 38, triad: true })}
    ${comp(A2, { pattern: '0202', len: 4, low: 38, triad: true })}
    ${comp(B, { pattern: '0--20-2-', len: 8, low: 38, triad: true })}
    ${comp(C, { pattern: '03030303', len: 8, low: 38, triad: true })}
  `;
}

const march = 'K8 H8 S8 H8 K8 K8 S8 H8 |';
const drums = `
  v10
  C4 r4 S8 S8 S8 S8 | S16 S16 S16 S16 S8 S8 S4 r4 |
  $
  [${march}]7 K8 H8 S8 H8 S16 S16 S16 S16 S8 S8 |
  [${march}]7 K8 H8 S8 H8 S16 S16 S16 S16 S8 S8 |
  [K4 H8 H8 S4 H8 H8 |]7 K4 H8 H8 S8 S8 S16 S16 S8 |
  [K8 H16 H16 S8 H8 K8 K8 S8 O8 |]7 C4 r4 S8 S8 S16 S16 S16 S16 |
`;

/** Builds the overworld theme. */
export function overworld(): SongSource {
  return {
    bpm: 132,
    bar: 4,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony(), triangle: bass(), noise: drums },
  };
}
