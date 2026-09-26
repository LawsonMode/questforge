import { describe, expect, it } from 'vitest';
import {
  MAX_BACKING, MAX_LIGHT_STAMP_R, backingSize, deviceSize, lightStampScale, onScreen, originOffsetX,
  presentLayout, stampLeft, type PresentLayout,
} from '../src/gfx/layout';

const fresh = (): PresentLayout => ({ scale: 0, x: 0, y: 0, w: 0, h: 0 });

describe('layout: presentLayout', () => {
  it('fills an exact multiple with no bars', () => {
    expect(presentLayout(1024, 896, fresh())).toEqual({ scale: 4, x: 0, y: 0, w: 1024, h: 896 });
  });

  it('picks the largest integer scale and centres it', () => {
    expect(presentLayout(700, 500, fresh())).toEqual({ scale: 2, x: 94, y: 26, w: 512, h: 448 });
    expect(presentLayout(1400, 1000, fresh())).toEqual({ scale: 4, x: 188, y: 52, w: 1024, h: 896 });
    expect(presentLayout(1920, 1080, fresh())).toEqual({ scale: 4, x: 448, y: 92, w: 1024, h: 896 });
  });

  it('never goes below scale 1 (a small canvas crops the centre)', () => {
    expect(presentLayout(200, 100, fresh())).toEqual({ scale: 1, x: -28, y: -62, w: 256, h: 224 });
    expect(presentLayout(Number.NaN, 0, fresh()).scale).toBe(1);
  });

  it('writes into and returns the given object', () => {
    const out = fresh();
    expect(presentLayout(512, 448, out)).toBe(out);
  });
});

describe('layout: backingSize', () => {
  it('multiplies by the device pixel ratio and rounds', () => {
    expect(backingSize(700, 1)).toBe(700);
    expect(backingSize(700, 2)).toBe(1400);
    expect(backingSize(1023, 1.25)).toBe(1279);
  });

  it('treats a bad ratio as 1 and an empty box as 0', () => {
    expect(backingSize(300, 0)).toBe(300);
    expect(backingSize(300, Number.NaN)).toBe(300);
    expect(backingSize(0, 2)).toBe(0);
    expect(backingSize(-5, 2)).toBe(0);
    expect(backingSize(Number.NaN, 2)).toBe(0);
  });

  it('caps runaway sizes', () => {
    expect(backingSize(9600, 2)).toBe(MAX_BACKING);
    expect(deviceSize(19200, 9600, 2)).toBe(MAX_BACKING);
  });
});

describe('layout: deviceSize', () => {
  it('prefers the exact device-pixel size when it agrees with CSS x DPR', () => {
    expect(deviceSize(1278, 1023, 1.25)).toBe(1278);
    expect(deviceSize(1279, 1023, 1.25)).toBe(1279);
    expect(deviceSize(2046, 1023, 2)).toBe(2046);
  });

  it('falls back to CSS x DPR when the exact size is missing or inconsistent (DPR emulation)', () => {
    expect(deviceSize(0, 1023, 1.25)).toBe(1279);
    expect(deviceSize(1023, 1023, 2)).toBe(2046);
    expect(deviceSize(0, 0, 2)).toBe(0);
  });
});

describe('layout: sprite and stamp placement', () => {
  it('flipX mirrors about the origin', () => {
    expect(originOffsetX(16, 8, false)).toBe(8);
    expect(originOffsetX(16, 8, true)).toBe(8);
    // Sword with its hilt (origin) at x=3 of a 16px frame: mirrored, the blade extends left.
    expect(originOffsetX(16, 3, false)).toBe(3);
    expect(originOffsetX(16, 3, true)).toBe(13);
  });

  it('stampLeft rounds the centre first so odd sizes keep a fixed offset', () => {
    const offsets = new Set<number>();
    for (let i = 0; i <= 20; i++) {
      const x = 50 + i / 20;
      offsets.add(Math.round(x - 8) - stampLeft(x, 13));
    }
    expect([...offsets]).toEqual([-2]);
    expect(stampLeft(10, 12)).toBe(4);
    expect(stampLeft(10.4, 5)).toBe(8);
  });

  it('onScreen culls boxes fully outside the 256x224 view', () => {
    expect(onScreen(0, 0, 16, 16)).toBe(true);
    expect(onScreen(-15, -15, 16, 16)).toBe(true);
    expect(onScreen(-16, 0, 16, 16)).toBe(false);
    expect(onScreen(255, 223, 16, 16)).toBe(true);
    expect(onScreen(256, 0, 16, 16)).toBe(false);
    expect(onScreen(0, 224, 16, 16)).toBe(false);
  });

  it('big lights use a scaled stamp no larger than the native cap', () => {
    expect(lightStampScale(40)).toBe(1);
    expect(lightStampScale(MAX_LIGHT_STAMP_R)).toBe(1);
    expect(lightStampScale(129)).toBe(2);
    expect(lightStampScale(342)).toBe(3);
    for (const r of [129, 200, 342, 1000]) {
      const k = lightStampScale(r);
      expect(Math.round(r / k)).toBeLessThanOrEqual(MAX_LIGHT_STAMP_R);
      expect(Math.abs(Math.round(r / k) * k - r)).toBeLessThanOrEqual(k / 2);
    }
  });
});
