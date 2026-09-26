import { describe, expect, it } from 'vitest';
import { hexToRgb, makePalette, paletteRGBA, rgbToHex, snap5, snapHex } from '../src/gfx/palette';

describe('palette: hex conversion', () => {
  it('parses #rrggbb and #rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#F0C040')).toEqual([240, 192, 64]);
    expect(hexToRgb('#fa0')).toEqual([255, 170, 0]);
    expect(hexToRgb('102030')).toEqual([16, 32, 48]);
  });

  it('returns black for malformed input', () => {
    expect(hexToRgb('#12345')).toEqual([0, 0, 0]);
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
  });

  it('formats lowercase, rounds and clamps', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(300, -5, 15.6)).toBe('#ff0010');
    expect(rgbToHex(...hexToRgb('#abcdef'))).toBe('#abcdef');
  });
});

describe('palette: SNES gamut', () => {
  it('snap5 maps to (c5 << 3) | (c5 >> 2) of the nearest 5-bit level', () => {
    expect(snap5(0)).toBe(0);
    expect(snap5(255)).toBe(255);
    expect(snap5(8)).toBe(8);
    expect(snap5(128)).toBe(132); // c5 = 16
    expect(snap5(3)).toBe(0);
    expect(snap5(5)).toBe(8); // c5 = 1
  });

  it('snap5 is idempotent and only yields 32 levels', () => {
    const levels = new Set<number>();
    for (let v = 0; v < 256; v++) {
      const s = snap5(v);
      levels.add(s);
      expect(snap5(s)).toBe(s);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(5);
    }
    expect(levels.size).toBe(32);
  });

  it('snapHex snaps every channel', () => {
    expect(snapHex('#ffffff')).toBe('#ffffff');
    expect(snapHex('#808080')).toBe('#848484');
    expect(snapHex('#fff')).toBe('#ffffff');
  });
});

describe('palette: construction & packing', () => {
  it('makePalette pads, truncates and lowercases', () => {
    const p = makePalette('pal.x', 'X', ['#FF0000', '#00ff00']);
    expect(p).toMatchObject({ id: 'pal.x', name: 'X' });
    expect(p.colors).toHaveLength(16);
    expect(p.colors.slice(0, 3)).toEqual(['#ff0000', '#00ff00', '#000000']);
    const long = makePalette('l', 'L', Array.from({ length: 20 }, () => '#123456'));
    expect(long.colors).toHaveLength(16);
  });

  it('paletteRGBA packs 0xAABBGGRR with index 0 transparent', () => {
    const p = makePalette('p', 'P', ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#102030']);
    const rgba = paletteRGBA(p);
    expect(rgba).toBeInstanceOf(Uint32Array);
    expect(rgba).toHaveLength(16);
    expect(rgba[0]).toBe(0);
    expect(rgba[1]).toBe(0xff0000ff);
    expect(rgba[2]).toBe(0xff00ff00);
    expect(rgba[3]).toBe(0xffff0000);
    expect(rgba[4]).toBe(0xff302010);
    expect(rgba[15]).toBe(0xff000000);
  });

  it('packed values land as R,G,B,A bytes on little-endian hosts', () => {
    const rgba = paletteRGBA(makePalette('p', 'P', ['#000000', '#102030']));
    const bytes = new Uint8Array(rgba.buffer, 4, 4);
    expect(Array.from(bytes)).toEqual([0x10, 0x20, 0x30, 0xff]);
  });
});
