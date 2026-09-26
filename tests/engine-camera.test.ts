// Camera clamping, following and shake.
import { describe, expect, it } from 'vitest';
import { Camera, clampCamera } from '../src/game/camera';
import { Rng } from '../src/core/rng';

describe('clampCamera', () => {
  it('never scrolls a one-screen room', () => {
    expect(clampCamera(0, 0, 256, 224)).toEqual({ x: 0, y: 0 });
    expect(clampCamera(250, 220, 256, 224)).toEqual({ x: 0, y: 0 });
  });

  it('centres on the focus and clamps to the room bounds', () => {
    expect(clampCamera(300, 100, 512, 224)).toEqual({ x: 172, y: 0 });
    expect(clampCamera(20, 100, 512, 224)).toEqual({ x: 0, y: 0 });
    expect(clampCamera(500, 600, 512, 672)).toEqual({ x: 256, y: 448 });
    expect(clampCamera(300.4, 330.6, 512, 672)).toEqual({ x: 172, y: 219 });
  });
});

describe('Camera', () => {
  it('follows with integer positions', () => {
    const c = new Camera(new Rng(1));
    c.follow(400, 200, 1024, 448);
    expect([c.x, c.y]).toEqual([272, 88]);
    expect([c.renderX, c.renderY]).toEqual([272, 88]);
  });

  it('shakes within the magnitude for the requested time, then settles', () => {
    const c = new Camera(new Rng(7));
    c.follow(128, 112, 256, 224);
    c.shake(0.2, 3);
    let moved = false;
    for (let i = 0; i < 13; i++) {
      c.update(1 / 60);
      expect(Math.abs(c.renderX - c.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.renderY - c.y)).toBeLessThanOrEqual(3);
      moved ||= c.renderX !== c.x || c.renderY !== c.y;
    }
    expect(moved).toBe(true);
    expect(c.shaking).toBe(false);
    c.update(1 / 60);
    expect([c.renderX, c.renderY]).toEqual([c.x, c.y]);
  });

  it('keeps the stronger of overlapping shakes', () => {
    const c = new Camera(new Rng(3));
    c.shake(1, 4);
    c.shake(0.1, 1);
    for (let i = 0; i < 30; i++) c.update(1 / 60);
    expect(c.shaking).toBe(true);
  });
});
