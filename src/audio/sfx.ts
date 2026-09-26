// Procedural sound effects: one original definition per SfxId, built on first use
// (so a typo in a note name silences one effect instead of breaking app startup).
// Levels are 0..1 before the SFX bus gain; keep them punchy but never grating.
import type { SfxId } from '../core/types';
import { hz } from './pitch';
import { run, tone, type Part } from './parts';

/** A sound effect: a stack of one-shot parts plus playback rules. */
export interface SfxDef {
  parts: readonly Part[];
  /** Duck the music for the length of the effect (fanfares, jingles). */
  duck?: boolean;
  /** Minimum seconds between two plays of this effect (default MIN_SFX_GAP). */
  gap?: number;
}

/** Default re-trigger guard: identical sounds closer than this are merged. */
export const MIN_SFX_GAP = 0.03;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Rising item fanfare: G-major lick, a third-below harmony and a walking bass. */
function fanfare(): Part[] {
  const lead = { vol: 0.24, env: { a: 0.005, d: 0.1, s: 0.7, r: 0.1 } } as const;
  const harm = { vol: 0.13, env: lead.env } as const;
  return [
    tone('p25', 'd5', 0, 0.05, lead), tone('p25', 'g5', 0.06, 0.08, lead), tone('p25', 'b5', 0.15, 0.13, lead),
    tone('p25', 'a5', 0.3, 0.08, lead), tone('p25', 'b5', 0.39, 0.08, lead), tone('p25', 'd6', 0.48, 0.13, lead),
    tone('p25', 'g6', 0.63, 0.55, { ...lead, vib: [6, 22] }),
    tone('p50', 'g5', 0.15, 0.13, harm), tone('p50', 'f#5', 0.3, 0.08, harm), tone('p50', 'g5', 0.39, 0.08, harm),
    tone('p50', 'b5', 0.48, 0.13, harm), tone('p50', 'd6', 0.63, 0.55, harm),
    tone('tri', 'g3', 0, 0.27, { vol: 0.45, env: 'hold' }), tone('tri', 'd3', 0.3, 0.15, { vol: 0.45, env: 'hold' }),
    tone('tri', 'b2', 0.48, 0.13, { vol: 0.45, env: 'hold' }), tone('tri', 'g2', 0.63, 0.55, { vol: 0.5, env: 'soft' }),
    { wave: 'noise', f: 0.8, at: 0.63, dur: 0.5, vol: 0.12 },
  ];
}

/** Original "puzzle solved" jingle: an ascending D-G-A-D-E climb resolving G -> C. */
function secret(): Part[] {
  const notes = ['d5', 'g5', 'a5', 'd6'];
  return [
    ...run('p25', notes, 0.08, 0, { dur: 0.07, vol: 0.22, env: 'pluck' }),
    tone('p25', 'e6', 0.32, 0.42, { vol: 0.24, env: 'bell', vib: [7, 16] }),
    ...run('p12', ['d6', 'g6', 'a6', 'd7'], 0.08, 0.04, { dur: 0.06, vol: 0.06, env: 'pluck' }),
    tone('p12', 'e7', 0.36, 0.4, { vol: 0.06, env: 'bell' }),
    tone('tri', 'g3', 0, 0.3, { vol: 0.4, env: 'hold' }),
    tone('tri', 'c4', 0.32, 0.45, { vol: 0.4, env: 'soft' }),
  ];
}

function bossDie(): Part[] {
  const booms = range(6).flatMap((i): Part[] => [
    { wave: 'noise', f: 0.7 - i * 0.08, to: 0.05, at: i * 0.22, dur: 0.35, vol: 0.5 },
    { wave: 'tri', f: 140 - i * 14, to: 30, at: i * 0.22, dur: 0.25, vol: 0.55 },
  ]);
  return [
    ...booms,
    { wave: 'noise', f: 0.4, to: 0.02, at: 1.3, dur: 1.1, vol: 0.65, env: { a: 0.01, d: 1.1, s: 0, r: 0.1 } },
    { wave: 'sine', f: 60, to: 24, at: 1.3, dur: 0.8, vol: 0.6 },
  ];
}

/** One builder per SfxId; use getSfx() to get the (cached) definition. */
export const SFX_BUILDERS: Readonly<Record<SfxId, () => SfxDef>> = {
  sword: () => ({ parts: [
    { wave: 'noise', f: 0.9, to: 0.22, dur: 0.12, vol: 0.5, env: { a: 0.012, d: 0.1, s: 0, r: 0.03 } },
    { wave: 'p12', f: 1500, to: 420, dur: 0.09, vol: 0.1 },
  ] }),
  swordSpin: () => ({ parts: [
    // Two whooshes that cross-fade at the midpoint (the second swells in rather than clicking).
    { wave: 'noise', f: 0.25, to: 0.95, dur: 0.19, vol: 0.42, env: { a: 0.03, d: 0.16, s: 0.6, r: 0.04 } },
    { wave: 'noise', f: 0.95, to: 0.2, at: 0.18, dur: 0.24, vol: 0.4, env: { a: 0.035, d: 0.2, s: 0, r: 0.02 } },
    { wave: 'p25', f: 260, to: 1100, dur: 0.38, vol: 0.09, vib: [14, 60], env: 'soft' },
  ] }),
  swordCharge: () => ({ parts: [
    tone('p25', 'a6', 0, 0.04, { vol: 0.2 }),
    tone('p25', 'e7', 0.05, 0.2, { vol: 0.2, env: 'bell' }),
    tone('p12', 'e7', 0.05, 0.2, { vol: 0.07, env: 'bell', vib: [9, 25] }),
  ] }),
  swordTink: () => ({ parts: [
    { wave: 'metal', f: 0.95, dur: 0.04, vol: 0.35 },
    { wave: 'p25', f: 2600, to: 2450, dur: 0.1, vol: 0.2, env: 'bell' },
  ] }),
  hit: () => ({ parts: [
    { wave: 'noise', f: 0.45, to: 0.08, dur: 0.08, vol: 0.5 },
    { wave: 'tri', f: 220, to: 55, dur: 0.09, vol: 0.6 },
  ] }),
  enemyHit: () => ({ parts: [
    { wave: 'p25', f: 900, to: 180, dur: 0.08, vol: 0.26 },
    { wave: 'noise', f: 0.7, to: 0.3, dur: 0.05, vol: 0.28 },
  ] }),
  enemyDie: () => ({ parts: [
    { wave: 'p50', f: 520, to: 70, dur: 0.22, vol: 0.2 },
    { wave: 'noise', f: 0.8, to: 0.08, dur: 0.32, vol: 0.42, env: { a: 0.004, d: 0.3, s: 0, r: 0.05 } },
    tone('p12', 'c7', 0.02, 0.03, { vol: 0.07 }),
  ] }),
  hurt: () => ({ parts: [
    tone('p25', 'a5', 0, 0.14, { to: hz('d5'), vol: 0.28, env: { a: 0.003, d: 0.14, s: 0.2, r: 0.03 } }),
    tone('p12', 'a#5', 0, 0.14, { to: hz('d#5'), vol: 0.1 }),
    { wave: 'noise', f: 0.5, dur: 0.05, vol: 0.2 },
  ] }),
  // Repeats every ~0.8 s: a soft falling fourth pitched above the melody register so it
  // cuts through every track without being loud.
  lowHealth: () => ({ gap: 0.3, parts: [
    tone('p25', 'b6', 0, 0.05, { vol: 0.14, env: 'pluck' }),
    tone('p25', 'e6', 0.11, 0.06, { vol: 0.12, env: 'pluck' }),
  ] }),
  rupee: () => ({ parts: [
    ...run('p25', ['e6', 'g#6'], 0.045, 0, { dur: 0.04, vol: 0.2 }),
    tone('p25', 'b6', 0.09, 0.16, { vol: 0.22, env: 'bell' }),
    tone('p12', 'e7', 0.09, 0.16, { vol: 0.05, env: 'bell' }),
  ] }),
  heart: () => ({ parts: [
    ...run('p12', ['d6', 'a6', 'd7'], 0.04, 0, { vol: 0.2 }),
    tone('tri', 'd5', 0, 0.12, { vol: 0.3 }),
  ] }),
  item: () => ({ parts: [
    ...run('p25', ['c6', 'e6', 'g6'], 0.05, 0, { vol: 0.19 }),
    tone('p25', 'c7', 0.15, 0.18, { vol: 0.21, env: 'bell' }),
  ] }),
  fanfare: () => ({ duck: true, gap: 0.5, parts: fanfare() }),
  secret: () => ({ duck: true, gap: 0.5, parts: secret() }),
  door: () => ({ parts: [
    { wave: 'noise', f: 0.16, to: 0.08, dur: 0.3, vol: 0.34, vib: [16, 250], env: { a: 0.03, d: 0.2, s: 0.5, r: 0.08 } },
    { wave: 'tri', f: 80, to: 58, dur: 0.3, vol: 0.34, env: { a: 0.03, d: 0.2, s: 0.5, r: 0.08 } },
  ] }),
  locked: () => ({ parts: [
    { wave: 'tri', f: 110, to: 55, dur: 0.06, vol: 0.6 },
    { wave: 'noise', f: 0.25, to: 0.08, dur: 0.05, vol: 0.28 },
    { wave: 'tri', f: 95, to: 50, at: 0.1, dur: 0.07, vol: 0.5 },
    { wave: 'noise', f: 0.2, to: 0.07, at: 0.1, dur: 0.05, vol: 0.22 },
  ] }),
  unlock: () => ({ parts: [
    { wave: 'metal', f: 0.9, dur: 0.02, vol: 0.2 },
    { wave: 'metal', f: 0.7, at: 0.07, dur: 0.02, vol: 0.2 },
    tone('p25', 'g5', 0.14, 0.05, { vol: 0.17 }),
    tone('p25', 'c6', 0.2, 0.14, { vol: 0.19, env: 'bell' }),
  ] }),
  chest: () => ({ parts: [
    { wave: 'p12', f: 170, to: 300, dur: 0.38, vol: 0.13, vib: [8, 70], env: { a: 0.05, d: 0.3, s: 0.6, r: 0.05 } },
    { wave: 'noise', f: 0.12, dur: 0.35, vol: 0.1, env: { a: 0.05, d: 0.3, s: 0.6, r: 0.05 } },
    { wave: 'tri', f: 90, to: 60, at: 0.38, dur: 0.08, vol: 0.5 },
  ] }),
  bombPlace: () => ({ parts: [
    { wave: 'tri', f: 160, to: 90, dur: 0.06, vol: 0.6 },
    { wave: 'noise', f: 0.9, at: 0.03, dur: 0.18, vol: 0.12, env: { a: 0.02, d: 0.16, s: 0, r: 0.02 } },
  ] }),
  explode: () => ({ parts: [
    { wave: 'noise', f: 0.55, to: 0.04, dur: 0.75, vol: 0.6, env: { a: 0.003, d: 0.7, s: 0, r: 0.05 } },
    { wave: 'tri', f: 130, to: 32, dur: 0.35, vol: 0.6 },
    { wave: 'sine', f: 70, to: 30, dur: 0.3, vol: 0.35 },
  ] }),
  arrow: () => ({ parts: [
    { wave: 'tri', f: 360, to: 300, dur: 0.08, vol: 0.34 },
    { wave: 'noise', f: 0.9, to: 0.45, dur: 0.1, vol: 0.18 },
  ] }),
  arrowHit: () => ({ parts: [
    { wave: 'noise', f: 0.4, to: 0.1, dur: 0.05, vol: 0.34 },
    { wave: 'tri', f: 260, to: 110, dur: 0.05, vol: 0.44 },
  ] }),
  boomerang: () => ({ gap: 0.2, parts: [
    { wave: 'p25', f: 650, dur: 0.26, vol: 0.11, vib: [14, 180], env: { a: 0.03, d: 0.2, s: 0.7, r: 0.04 } },
    { wave: 'noise', f: 0.3, dur: 0.26, vol: 0.09, vib: [14, 400], env: { a: 0.03, d: 0.2, s: 0.7, r: 0.04 } },
  ] }),
  lift: () => ({ parts: [
    { wave: 'p50', f: 180, to: 300, dur: 0.09, vol: 0.2 },
    { wave: 'noise', f: 0.2, dur: 0.07, vol: 0.2 },
  ] }),
  throw: () => ({ parts: [
    { wave: 'noise', f: 0.35, to: 0.85, dur: 0.12, vol: 0.28, env: { a: 0.01, d: 0.11, s: 0, r: 0.02 } },
    { wave: 'p12', f: 280, to: 620, dur: 0.09, vol: 0.09 },
  ] }),
  shatter: () => ({ parts: [
    { wave: 'metal', f: 0.95, to: 0.6, dur: 0.18, vol: 0.28 },
    { wave: 'noise', f: 1, to: 0.45, dur: 0.14, vol: 0.38 },
    tone('p12', 'c7', 0.03, 0.03, { vol: 0.07 }),
    tone('p12', 'f#7', 0.07, 0.03, { vol: 0.06 }),
    tone('p12', 'a6', 0.11, 0.03, { vol: 0.05 }),
  ] }),
  cut: () => ({ parts: [
    { wave: 'noise', f: 1, to: 0.7, dur: 0.07, vol: 0.36 },
    { wave: 'noise', f: 0.5, at: 0.02, dur: 0.04, vol: 0.14 },
  ] }),
  splash: () => ({ parts: [
    { wave: 'noise', f: 0.75, to: 0.15, dur: 0.38, vol: 0.42, env: { a: 0.01, d: 0.36, s: 0, r: 0.04 } },
    { wave: 'p12', f: 700, to: 1600, at: 0.06, dur: 0.05, vol: 0.06 },
    { wave: 'p12', f: 900, to: 1900, at: 0.14, dur: 0.04, vol: 0.05 },
  ] }),
  fall: () => ({ parts: [
    { wave: 'p50', f: 880, to: 110, dur: 0.75, vol: 0.2, env: { a: 0.01, d: 0.5, s: 0.6, r: 0.1 } },
  ] }),
  stairs: () => ({ parts: range(4).flatMap((i): Part[] => [
    tone('tri', ['e4', 'c4', 'a3', 'f3'][i], i * 0.1, 0.05, { vol: 0.42 }),
    { wave: 'noise', f: 0.3, at: i * 0.1, dur: 0.02, vol: 0.11 },
  ]) }),
  text: () => ({ parts: [tone('p50', 'a5', 0, 0.02, { vol: 0.12, env: { a: 0.002, d: 0.02, s: 0.5, r: 0.012 } })] }),
  menuMove: () => ({ parts: [tone('p25', 'e6', 0, 0.03, { vol: 0.18, env: { a: 0.002, d: 0.03, s: 0.3, r: 0.02 } })] }),
  menuSelect: () => ({ parts: [
    tone('p25', 'a5', 0, 0.035, { vol: 0.15 }),
    tone('p25', 'e6', 0.045, 0.08, { vol: 0.17, env: 'bell' }),
  ] }),
  menuOpen: () => ({ parts: run('p25', ['c5', 'g5', 'c6'], 0.035, 0, { vol: 0.14 }) }),
  menuClose: () => ({ parts: run('p25', ['c6', 'g5', 'c5'], 0.035, 0, { vol: 0.14 }) }),
  switch: () => ({ parts: [
    { wave: 'tri', f: 200, to: 120, dur: 0.05, vol: 0.5 },
    { wave: 'metal', f: 0.8, at: 0.04, dur: 0.03, vol: 0.16 },
    tone('p25', 'g5', 0.05, 0.06, { vol: 0.1, env: 'bell' }),
  ] }),
  push: () => ({ gap: 0.2, parts: [
    { wave: 'noise', f: 0.09, dur: 0.3, vol: 0.28, vib: [20, 300], env: { a: 0.05, d: 0.2, s: 0.7, r: 0.06 } },
    { wave: 'tri', f: 55, dur: 0.3, vol: 0.28, env: { a: 0.05, d: 0.2, s: 0.7, r: 0.06 } },
  ] }),
  shield: () => ({ parts: [
    { wave: 'metal', f: 1, dur: 0.03, vol: 0.3 },
    { wave: 'p25', f: 2500, to: 2350, dur: 0.12, vol: 0.18, env: 'bell' },
    { wave: 'p12', f: 3200, dur: 0.08, vol: 0.05, env: 'bell' },
  ] }),
  hookshot: () => ({ gap: 0.1, parts: [
    ...range(10).map((i): Part => ({ wave: 'metal', f: 0.85, at: i * 0.028, dur: 0.012, vol: 0.2 * (1 - i / 12) })),
    { wave: 'p12', f: 900, to: 1400, dur: 0.28, vol: 0.05, env: 'soft' },
  ] }),
  dash: () => ({ parts: [
    { wave: 'noise', f: 0.15, to: 0.55, dur: 0.22, vol: 0.28, env: { a: 0.05, d: 0.17, s: 0.5, r: 0.03 } },
    { wave: 'p12', f: 140, to: 420, dur: 0.2, vol: 0.07, env: 'soft' },
  ] }),
  bossHit: () => ({ parts: [
    { wave: 'p50', f: 420, to: 90, dur: 0.16, vol: 0.26 },
    { wave: 'noise', f: 0.6, to: 0.1, dur: 0.18, vol: 0.42 },
    { wave: 'tri', f: 160, to: 45, dur: 0.16, vol: 0.65 },
  ] }),
  bossDie: () => ({ duck: true, gap: 1, parts: bossDie() }),
  fairy: () => ({ parts: [
    ...run('p12', ['a5', 'c#6', 'e6', 'a6', 'c#7', 'e7'], 0.05, 0, { dur: 0.12, vol: 0.11, env: 'bell', vib: [8, 20] }),
    ...run('p25', ['a5', 'c#6', 'e6', 'a6', 'c#7', 'e7'], 0.05, 0.08, { dur: 0.1, vol: 0.05, env: 'bell' }),
  ] }),
  lantern: () => ({ parts: [
    { wave: 'noise', f: 0.3, to: 0.9, dur: 0.12, vol: 0.26, env: { a: 0.03, d: 0.09, s: 0.3, r: 0.03 } },
    { wave: 'noise', f: 0.9, to: 0.25, at: 0.1, dur: 0.25, vol: 0.16 },
  ] }),
  error: () => ({ gap: 0.15, parts: [
    { wave: 'p50', f: 110, dur: 0.09, vol: 0.18, env: { a: 0.003, d: 0.02, s: 0.9, r: 0.02 } },
    { wave: 'p50', f: 116, dur: 0.09, vol: 0.13, env: { a: 0.003, d: 0.02, s: 0.9, r: 0.02 } },
    { wave: 'p50', f: 110, at: 0.13, dur: 0.12, vol: 0.18, env: { a: 0.003, d: 0.02, s: 0.9, r: 0.03 } },
    { wave: 'p50', f: 116, at: 0.13, dur: 0.12, vol: 0.13, env: { a: 0.003, d: 0.02, s: 0.9, r: 0.03 } },
  ] }),
  jump: () => ({ parts: [
    { wave: 'p25', f: 280, to: 720, dur: 0.12, vol: 0.2, env: { a: 0.005, d: 0.12, s: 0.3, r: 0.03 } },
  ] }),
  land: () => ({ parts: [
    { wave: 'tri', f: 170, to: 70, dur: 0.06, vol: 0.48 },
    { wave: 'noise', f: 0.3, dur: 0.04, vol: 0.16 },
  ] }),
  magic: () => ({ parts: [
    { wave: 'p12', f: 500, to: 2200, dur: 0.28, vol: 0.11, vib: [10, 40], env: { a: 0.02, d: 0.26, s: 0.3, r: 0.06 } },
    { wave: 'noise', f: 0.95, dur: 0.25, vol: 0.05, env: 'soft' },
    tone('p25', 'e7', 0.2, 0.15, { vol: 0.07, env: 'bell' }),
  ] }),
  crystal: () => ({ parts: [
    tone('p12', 'e7', 0, 0.5, { vol: 0.09, env: 'bell' }),
    tone('p12', 'b6', 0.06, 0.5, { vol: 0.08, env: 'bell' }),
    tone('p12', 'g#7', 0.12, 0.5, { vol: 0.07, env: 'bell' }),
    tone('tri', 'e6', 0, 0.6, { vol: 0.18, env: 'bell' }),
    tone('p25', 'b7', 0.18, 0.4, { vol: 0.04, env: 'bell' }),
  ] }),
};

const built = new Map<SfxId, SfxDef>();

/** The effect's definition, built on first use and cached; null for an unknown id. Throws if its builder fails. */
export function getSfx(id: SfxId): SfxDef | null {
  let def = built.get(id);
  if (!def) {
    const build = SFX_BUILDERS[id] as (() => SfxDef) | undefined;
    if (!build) return null;
    def = build();
    built.set(id, def);
  }
  return def;
}
