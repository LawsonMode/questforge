// "Pages of the Chronicle" - file select. E major, calm rolling arpeggios in 3/4, 84 BPM, 16 bars. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const CHART = 'E | C#m | A | B | E | G#m | A | B | C#m | G#m | A | E | F#m | B | E | B7';

const melody = `
  @2 v9 %5 m12 q7
  o4 b2 o5 e4 | o5 e4. d+8 c+4 | o5 c+2. | o4 b4 o5 d+4 f+4 |
  o5 g+2 f+4 | o5 d+2 o4 b4 | o5 c+4. o4 b8 a4 | o4 b2. |
  o5 e2 g+4 | o5 f+4. e8 d+4 | o5 c+2 e4 | o4 b2. |
  o5 c+4 o4 a4 f+4 | o4 f+4 a4 b4 | o4 g+2 b4 | o4 a2 f+4 |
`;

/** Builds the file-select theme (accompaniment expanded from the chord chart). */
export function fileSelect(): SongSource {
  const harmony = `@1 v5 q7 %1 ${comp(CHART, { pattern: '012321', len: 8, low: 52, bar: 3, triad: true })}`;
  const bass = `v12 q8 %5 ${comp(CHART, { pattern: '0--', len: 4, low: 40, bar: 3, triad: true })}`;
  return {
    bpm: 84,
    bar: 3,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass },
  };
}
