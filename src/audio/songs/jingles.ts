// Short one-shot cues: "Well Earned" (victory, G major) and "Fallen Lantern" (game over, A minor). Original.
import type { SongSource } from '../mml';

/** "Well Earned": the short victory fanfare (one-shot). */
export const victory = (): SongSource => ({
  bpm: 126,
  bar: 4,
  loop: false,
  channels: {
    pulse1: `
      @1 v12 %0 m14 q7
      o4 b8. o5 d16 g4 b8. a16 g4 | o5 e8. f+16 g4 a8. g16 f+4 |
      o5 g8. a16 b4 o6 c8. o5 b16 a4 | o5 a4 f+4 g2 |
    `,
    pulse2: `
      @2 v8 %0 q7
      o4 g8. b16 b4 o5 d8. c16 o4 b4 | o5 c8. d16 e4 f+8. e16 d4 |
      o4 b8. o5 c16 d4 e8. d16 c4 | o5 f+4 d4 o4 b2 |
    `,
    triangle: `
      v15 q7 %0
      o2 g4 o3 g4 o2 g4 o3 d4 | o3 c4 o2 g4 o3 d4 o2 a4 |
      o2 e4 b4 o3 c4 o2 g4 | o2 d4 a4 g2 |
    `,
    noise: `
      v9
      C4 S8 S8 S4 S8 S8 | K4 S4 K4 S4 | K4 S4 K4 S8 S8 | S16 S16 S16 S16 S4 C2 |
    `,
  },
});

/** "Fallen Lantern": the short game-over lament (one-shot). */
export const gameover = (): SongSource => ({
  bpm: 84,
  bar: 4,
  loop: false,
  channels: {
    pulse1: `
      @2 v10 %5 m14 q7
      o5 e4. d8 c4 o4 b4 | o4 a4. g8 f4 a4 | o4 f4 d4 e4 g+4 | o4 a1 |
    `,
    pulse2: `
      @0 v6 %2 q8
      o4 c2 e2 | o4 c2 o3 a2 | o3 a2 b2 | o4 c1 |
    `,
    triangle: `
      v14 %5 q8
      o2 a1 | o2 f1 | o2 d2 e2 | o2 a1 |
    `,
  },
});
