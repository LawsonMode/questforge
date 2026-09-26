// "Hearthside" - house interior theme. G major, cozy 100 BPM, 16 bars. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const CHART = 'G | Em | C | D | G | Em | Am D | G | C | D | Bm | Em | Am | D | G C | G D7';

const melody = `
  @2 v10 %0 m10 q7
  o4 b4 o5 d4 d4. c8 | o4 b4 g4 g2 | o4 a4 o5 c4 e4. d8 | o5 d2 o4 a2 |
  o4 b4 o5 d4 g4. f+8 | o5 e4 d4 o4 b2 | o4 a4 o5 c4 o4 f+4 a4 | o4 g2. r4 |
  o5 e4. d8 c4 e4 | o5 d4. c8 o4 a4 f+4 | o4 f+4 b4 o5 d4 f+4 | o5 e2. r4 |
  o5 c4. o4 b8 a4 o5 c4 | o4 b4 a4 f+4 d4 | o4 g4 b4 o5 c4 e4 | o5 d2 c4 o4 a4 |
`;

const drums = `v4 [K4 H8 H8 S4 H8 H8 |]16`;

/** Builds the house theme (accompaniment expanded from the chord chart). */
export function house(): SongSource {
  const harmony = `@0 v5 q6 %1 ${comp(CHART, { pattern: '02120212', len: 8, low: 48 })}`;
  const bass = `v14 q7 %0 ${comp(CHART, { pattern: '0-2-', len: 4, low: 36, triad: true })}`;
  return {
    bpm: 100,
    bar: 4,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
