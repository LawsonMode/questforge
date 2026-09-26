// "Banners of Ellendor" - title theme. C major, stately 84 BPM, 2-bar swell + 16-bar loop. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const INTRO = 'C | G';
const CHART = 'C | Em | F | G | Am | F | Dsus4 D | G | C | E7 | Am | F | Dm | G | C F | C G';

const melody = `
  @1 v11 %0 m18 q7
  r1 | r1 |
  $
  o4 g2 o5 c4. d8 | o5 e2 d4 o4 b4 | o5 c2. o4 a4 | o4 b4. o5 c8 d2 |
  o5 e2 a4. g8 | o5 f2 e4 c4 | o5 d2 d4 f+4 | o5 g1 |
  o5 g2 e4. c8 | o5 g+4. f+8 e4 d4 | o5 c2 o4 a4 o5 c4 | o5 f4. e8 d4 c4 |
  o5 d2 f4 a4 | o5 g2. f4 | o5 e2 f2 | o5 e2 d2 |
`;

const TRIPLETS = { pattern: '012321012321', len: 12, low: 48, triad: true } as const;

const drums = `
  v8
  T4 r4 T4 r4 | T8 T8 T8 T8 S16 S16 S16 S16 S8 S8 |
  $
  [C4 r4 T4 r8 T8 | K4 r4 S4 r8 S8 | K4 r4 S4 r8 S8 | K4 r4 S4 S8 S8 |]4
`;

/** Builds the title theme (accompaniment expanded from the chord charts). */
export function title(): SongSource {
  const harmony = `@2 v6 q7 %1 ${comp(INTRO, TRIPLETS)} $ ${comp(CHART, TRIPLETS)}`;
  const bass = `
    v15 q7 %0
    ${comp(INTRO, { pattern: '0---', len: 4, low: 36 })}
    $
    ${comp(CHART, { pattern: '0-2-', len: 4, low: 36, triad: true })}
  `;
  return {
    bpm: 84,
    bar: 4,
    loop: true,
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
