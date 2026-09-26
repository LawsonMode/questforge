// Sword geometry: swing timeline, blade hitboxes per facing/frame, spin ring.
import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/core/types';
import type { Rect } from '../src/core/math';
import { DIRS } from '../src/core/math';
import { HERO_SWORD_POSES } from '../src/content/art/sprites-core';
import type { Project, SpriteDef } from '../src/core/types';
import { rectsOverlap } from '../src/core/math';
import type { Entity } from '../src/game/entity';
import {
  BLADE_VEC, SPIN_RING, SPIN_TIME, SWING_TIME, type SwingFrame, bladeRect, bladeTip, heldPose, spinIndex, spinStep,
  swingFrame, swingPose,
} from '../src/game/player/sword';
import { bodyRect } from '../src/game/projectiles/targets';

/** The hero's 12x12 hitbox around origin (0, 0). */
const HERO: Rect = { x: -6, y: -6, w: 12, h: 12 };
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** How far (px) a rect reaches past the hero hitbox edge on the facing side. */
function reachPast(r: Rect, facing: Dir): number {
  switch (facing) {
    case 'up': return HERO.y - r.y;
    case 'down': return r.y + r.h - (HERO.y + HERO.h);
    case 'left': return HERO.x - r.x;
    case 'right': return r.x + r.w - (HERO.x + HERO.w);
  }
}

describe('swing timeline', () => {
  it('walks through wind-up, slash and thrust within one swing', () => {
    expect(swingFrame(0)).toBe(0);
    expect(swingFrame(0.06)).toBe(1);
    expect(swingFrame(0.2)).toBe(2);
    expect(swingFrame(SWING_TIME - 1e-6)).toBe(2);
    const frames = new Set<number>();
    for (let t = 0; t < SWING_TIME; t += 1 / 60) frames.add(swingFrame(t));
    expect([...frames]).toEqual([0, 1, 2]);
  });

  it('uses the art poses (blade at the hand) and holds the thrust pose', () => {
    for (const f of DIRS) {
      expect(swingPose(f, 1)).toBe(HERO_SWORD_POSES[f][1]);
      expect(heldPose(f)).toBe(HERO_SWORD_POSES[f][2]);
    }
  });
});

describe('blade hitbox', () => {
  it('starts at the hand and extends along the blade direction', () => {
    const r = bladeRect(100, 50, { dx: 6, dy: -3, blade: 'e', behind: false });
    expect(r.x).toBeGreaterThan(100 + 6 - 4);
    expect(r.x + r.w).toBeGreaterThanOrEqual(100 + 6 + 12);
    expect(centre(r).y).toBeCloseTo(47);
    const tip = bladeTip(100, 50, { dx: 6, dy: -3, blade: 'e', behind: false });
    expect(tip.x).toBeGreaterThan(106);
    expect(tip.y).toBe(47);
  });

  it('the thrust reaches well past the hero on the facing side, in every direction', () => {
    for (const f of DIRS) {
      const r = bladeRect(0, 0, heldPose(f));
      expect(reachPast(r, f)).toBeGreaterThanOrEqual(8);
    }
  });

  it('left mirrors right', () => {
    for (const frame of [0, 1, 2] as const) {
      const right = bladeRect(0, 0, swingPose('right', frame));
      const left = bladeRect(0, 0, swingPose('left', frame));
      expect(left.x).toBeCloseTo(-(right.x + right.w));
      expect(left.y).toBeCloseTo(right.y);
      expect(left.w).toBeCloseTo(right.w);
      expect(left.h).toBeCloseTo(right.h);
    }
  });

  it('each swing sweeps a 90 degree arc in 45 degree steps, ending pointing ahead', () => {
    const angle = (b: keyof typeof BLADE_VEC) => Math.atan2(BLADE_VEC[b].y, BLADE_VEC[b].x);
    const ahead: Record<Dir, keyof typeof BLADE_VEC> = { up: 'n', down: 's', left: 'w', right: 'e' };
    for (const f of DIRS) {
      const blades = [0, 1, 2].map((i) => swingPose(f, i as 0 | 1 | 2).blade);
      expect(blades[2]).toBe(ahead[f]);
      const a = blades.map(angle);
      const step = (i: number) => Math.abs(Math.atan2(Math.sin(a[i + 1]! - a[i]!), Math.cos(a[i + 1]! - a[i]!)));
      expect(step(0)).toBeCloseTo(Math.PI / 4);
      expect(step(1)).toBeCloseTo(Math.PI / 4);
    }
  });
});

describe('spin attack ring', () => {
  it('covers all eight compass directions once, clockwise from south', () => {
    expect(SPIN_RING.map((s) => s.pose.blade)).toEqual(['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se']);
  });

  it('only reuses art poses whose hand holds a matching blade (se re-aims the right thrust)', () => {
    for (const s of SPIN_RING) {
      const art = HERO_SWORD_POSES[s.facing][s.frame]!;
      expect({ dx: s.pose.dx, dy: s.pose.dy }).toEqual({ dx: art.dx, dy: art.dy });
      if (s.pose.blade !== 'se') expect(s.pose.blade).toBe(art.blade);
    }
  });

  it('starts at the facing and makes one full turn over SPIN_TIME', () => {
    const start: Record<Dir, string> = { down: 's', left: 'w', up: 'n', right: 'e' };
    for (const f of DIRS) {
      expect(spinStep(0, f).pose.blade).toBe(start[f]);
      const seen = new Set<number>();
      for (let t = 0; t < SPIN_TIME; t += 1 / 60) seen.add(spinIndex(t, f));
      expect(seen.size).toBe(8);
    }
    expect(spinIndex(SPIN_TIME * 2, 'down')).toBe(7);
  });

  it('every step hits around the hero (the blade box sits outside its centre)', () => {
    for (const s of SPIN_RING) {
      const c = centre(bladeRect(0, -6, s.pose));
      expect(Math.hypot(c.x, c.y + 6)).toBeGreaterThan(6);
    }
  });
});

describe('reach against a body', () => {
  // A soldier-sized target: 12x12 footprint, 16x24 sprite drawn from 18 px above its origin.
  const soldierArt = { id: 't.soldier', oy: 18 } as SpriteDef;
  const project = { sprites: [soldierArt] } as unknown as Project;
  const target = (x: number, y: number) => ({ x, y, z: 0, w: 12, h: 12, sprite: 't.soldier' }) as Entity;
  const body = { x: 0, y: 0, w: 0, h: 0 };

  /** Widest gap (px) between the hero's and the target's footprints at which one swing still hits it, target dead ahead. */
  function swingReach(f: Dir): number {
    let best = -1;
    for (let gap = 0; gap <= 40; gap++) {
      const d = gap + 12;
      const at = { up: [0, -d], down: [0, d], left: [-d, 0], right: [d, 0] }[f];
      const t = bodyRect(project, target(at[0]!, at[1]!), body);
      if ([0, 1, 2].some((fr) => rectsOverlap(bladeRect(0, 0, swingPose(f, fr as SwingFrame)), t))) best = gap;
    }
    return best;
  }

  it('reaches about as far facing down as facing sideways (the blade stabs into the body, not just the feet)', () => {
    const down = swingReach('down');
    const side = swingReach('right');
    expect(swingReach('left')).toBe(side);
    expect(down).toBeGreaterThanOrEqual(18);
    expect(Math.abs(down - side)).toBeLessThanOrEqual(6);
    expect(swingReach('up')).toBeGreaterThanOrEqual(18);
  });
});
