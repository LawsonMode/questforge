// "Whisperwood" - forest theme. D Dorian (raised 6th = B natural), 92 BPM, 16 bars, echoed leads. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const CHART = 'Dm | G | Dm | G | F | C | Am | Am | Dm | G | Em | Am | F | G | Dm | C';

const melody = `
  @0 v11 %5 m16 q7
  o4 a2 o5 d4 e4 | o5 f4. e8 d4 o4 b4 | o4 a2. r4 | o4 g8 a8 b8 o5 d8 c4 o4 b4 |
  o4 a2 o5 c4 f4 | o5 e4. d8 c4 o4 g4 | o4 a2. e4 | o4 a2 r4 o5 c12 d12 e12 |
  o5 f2 e4 d4 | o5 d4. o4 b8 g2 | o4 g4 b4 o5 e4. d8 | o5 c2. r4 |
  o5 c4 d4 f4 a4 | o5 g2 f4 d4 | o5 e4. d8 d2 | r2 o4 g4 e4 |
`;

const drums = `
  v6
  [T4 H8 H8 r4 H8 r8 |]16
`;

/** Builds the forest theme (accompaniment expanded from the chord chart). */
export function forest(): SongSource {
  const harmony = `@1 v5 q5 %1 ${comp(CHART, { pattern: '01232123', len: 8, low: 50, triad: true })}`;
  const bass = `v14 q7 %5 ${comp(CHART, { pattern: '0--2', len: 4, low: 38, triad: true })}`;
  return {
    bpm: 92,
    bar: 4,
    loop: true,
    echo: { beats: 0.75, feedback: 0.35, mix: 0.3 },
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
