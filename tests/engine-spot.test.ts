// Free-spot search used after scrolls, warps, respawns and to unstick the hero.
import { describe, expect, it } from 'vitest';
import { findFreeSpot } from '../src/game/spot';

describe('findFreeSpot', () => {
  it('keeps a free starting point', () => {
    expect(findFreeSpot(() => true, 10.5, 20)).toEqual({ x: 10.5, y: 20 });
  });

  it('searches along the preferred axis first', () => {
    // free below y >= 120, or right of x >= 110 (closer, but off-axis)
    const free = (x: number, y: number) => y >= 120 || x >= 110;
    expect(findFreeSpot(free, 100, 100, { along: 'y' })).toEqual({ x: 100, y: 120 });
    expect(findFreeSpot(free, 100, 100, { along: 'x' })).toEqual({ x: 110, y: 100 });
  });

  it('falls back to the nearest point on growing rings', () => {
    // a 40x40 solid block centred on the start; free to the left is nearest
    const free = (x: number, y: number) => !(x > 85 && x < 125 && y > 60 && y < 140);
    expect(findFreeSpot(free, 90, 100)).toEqual({ x: 85, y: 100 });
    expect(findFreeSpot(free, 90, 100, { along: 'y', alongMax: 8 })).toEqual({ x: 85, y: 100 });
  });

  it('returns null when nothing fits within the radius', () => {
    expect(findFreeSpot(() => false, 0, 0, { maxRadius: 4 })).toBeNull();
    expect(findFreeSpot((x) => x > 50, 0, 0, { maxRadius: 20 })).toBeNull();
  });
});
