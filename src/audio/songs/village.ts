// "Millbrook Green" - village theme. F major pastoral lilt in 6/8 (3 beats/bar), 132 BPM, 24 bars. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const CHART = [
  'F | C | Dm | Bb | F | Bb | C | C7',
  'Dm | Am | Bb | F | Gm | C | C7 | F',
  'Bb | F | Gm | Dm | Bb | F | Gm7 | C7',
].join(' | ');

const melody = `
  @2 v10 %0 m10 q7
  o5 c4 o4 a8 f4 a8 | o4 g4. e4. | o4 f4 a8 o5 d4 c8 | o5 d4. o4 b-4. |
  o4 a4 b-8 o5 c4 f8 | o5 f4. d4. | o5 e4 d8 c4 o4 b-8 | o4 g4. r4 o5 c8 |
  o5 d4 e8 f4 d8 | o5 e4. c4. | o5 d4 c8 o4 b-4 g8 | o4 a4. f4. |
  o4 g4 a8 b-4 o5 d8 | o5 c4. o4 e4 g8 | o4 b-4 g8 e4 g8 | o4 f2. |
  o5 d4. f4. | o5 c4 o4 a8 f4. | o4 b-4 o5 c8 d4 o4 b-8 | o4 a4. f4. |
  o4 f4 g8 b-4 o5 d8 | o5 c4. o4 a4. | o4 b-4 a8 g4 f8 | o4 e4. g4 b-8 |
`;

const drums = `
  v6
  [K4 H8 r8 H8 H8 | r4 H8 r8 S8 H8 |]12
`;

/** Builds the village theme (accompaniment expanded from the chord chart). */
export function village(): SongSource {
  const harmony = `@0 v5 q6 %1 ${comp(CHART, { pattern: '012321', len: 8, low: 48, bar: 3, triad: true })}`;
  const bass = `v14 q7 %0 ${comp(CHART, { pattern: '0--2--', len: 8, low: 36, bar: 3, triad: true })}`;
  return {
    bpm: 132,
    bar: 3,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
