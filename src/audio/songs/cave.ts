// "Dripstone" - cave theme. A minor, sparse 76 BPM, 16 bars, heavy echo with water-drip blips. Original.
import type { SongSource } from '../mml';
import { comp } from './kit';

const CHART = 'Am | Am | F | F | Dm | Dm | E | E | Am | G | F | E | Am | Dm | E | E';

const melody = `
  @2 v10 %5 m12 q7
  o4 e2 r2 | r4 o4 a4 b4 o5 c4 | o5 c2 r2 | r4 o4 a4 g4 f4 |
  o4 f2 r4 a4 | o5 d2 r2 | o4 b2 g+4 e4 | o4 e2 r2 |
  o5 e2 r4 d4 | o5 d2 r4 o4 b4 | o5 c2 r4 o4 a4 | o4 g+2 r2 |
  o4 a4 b4 o5 c4 e4 | o5 f2 e4 d4 | o5 e2. o4 b4 | o4 g+2 r2 |
`;

/** One drip per bar, on beat 2 (early) or beat 4 (late). */
const drip = (note: string, early: boolean): string =>
  early ? `r4 ${note}16 r8. r2 |` : `r2. ${note}16 r8. |`;
const DRIPS: ReadonlyArray<readonly [string, boolean]> = [
  ['o6 e', true], ['o6 a', false], ['o6 c', true], ['o5 a', false],
  ['o6 d', true], ['o5 f', false], ['o5 b', true], ['o6 e', false],
  ['o6 c', true], ['o6 d', false], ['o6 f', true], ['o5 g+', false],
  ['o6 e', true], ['o6 d', false], ['o5 b', true], ['o6 e', false],
];
const harmony = `@0 v7 q8 %4 ${DRIPS.map(([n, early]) => drip(n, early)).join(' ')}`;

const drums = `v5 [T2 r2 | r1 | r1 | r1 |]4`;

/** Builds the cave theme (bass expanded from the chord chart). */
export function cave(): SongSource {
  const bass = `v13 q8 %5 ${comp(CHART, { pattern: '0---', len: 4, low: 36, triad: true })}`;
  return {
    bpm: 76,
    bar: 4,
    loop: true,
    echo: { beats: 0.75, feedback: 0.45, mix: 0.4 },
    channels: { pulse1: melody, pulse2: harmony, triangle: bass, noise: drums },
  };
}
