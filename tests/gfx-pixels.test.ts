import { describe, expect, it } from 'vitest';
import {
  blankFrame, decodeFrame, encodeFrame, flipFrameX, flipFrameY, getPixel, isValidFrame, rotateFrameCW,
  setPixel, shiftFrame,
} from '../src/gfx/pixels';
import { PixelGrid } from '../src/content/art/pixelgrid';

// 3x2 frame:  1 2 3
//             4 5 6
const F32 = '123456';

describe('pixels: encode / decode', () => {
  it('blankFrame is all zeros of w*h', () => {
    expect(blankFrame(4, 3)).toBe('000000000000');
    expect(blankFrame(16, 16)).toHaveLength(256);
    expect(blankFrame(0, 5)).toBe('');
  });

  it('decode/encode round-trip', () => {
    const data = '0123456789abcdef';
    const px = decodeFrame(data, 4, 4);
    expect(Array.from(px)).toEqual([...Array(16).keys()]);
    expect(encodeFrame(px)).toBe(data);
  });

  it('decode tolerates short or malformed data', () => {
    expect(Array.from(decodeFrame('1z', 2, 2))).toEqual([1, 0, 0, 0]);
    expect(Array.from(decodeFrame('A', 1, 1))).toEqual([10]);
  });

  it('encode masks values to 0-15 and lowercases', () => {
    expect(encodeFrame([10, 15, 16, 31])).toBe('af0f');
  });
});

describe('pixels: get / set', () => {
  it('reads row-major', () => {
    expect(getPixel(F32, 3, 0, 0)).toBe(1);
    expect(getPixel(F32, 3, 2, 0)).toBe(3);
    expect(getPixel(F32, 3, 1, 1)).toBe(5);
  });

  it('returns 0 outside the frame', () => {
    expect(getPixel(F32, 3, -1, 0)).toBe(0);
    expect(getPixel(F32, 3, 3, 0)).toBe(0);
    expect(getPixel(F32, 3, 0, 2)).toBe(0);
  });

  it('setPixel returns a new string and ignores out-of-range writes', () => {
    expect(setPixel(F32, 3, 1, 1, 12)).toBe('1234c6');
    expect(setPixel(F32, 3, 0, 0, 0)).toBe('023456');
    expect(setPixel(F32, 3, 5, 0, 7)).toBe(F32);
    expect(setPixel(F32, 3, 0, -1, 7)).toBe(F32);
    expect(F32).toBe('123456');
  });
});

describe('pixels: validation', () => {
  it('accepts exactly w*h lowercase hex', () => {
    expect(isValidFrame('0123456789abcdef', 4, 4)).toBe(true);
    expect(isValidFrame(blankFrame(16, 24), 16, 24)).toBe(true);
  });

  it('rejects wrong length, uppercase, bad chars, bad sizes', () => {
    expect(isValidFrame('012', 2, 2)).toBe(false);
    expect(isValidFrame('012A', 2, 2)).toBe(false);
    expect(isValidFrame('01g3', 2, 2)).toBe(false);
    expect(isValidFrame('', 0, 0)).toBe(false);
  });
});

describe('pixels: transforms', () => {
  it('flips horizontally and vertically', () => {
    expect(flipFrameX(F32, 3, 2)).toBe('321654');
    expect(flipFrameY(F32, 3, 2)).toBe('456123');
    expect(flipFrameX(flipFrameX(F32, 3, 2), 3, 2)).toBe(F32);
  });

  it('rotates clockwise', () => {
    // 1 2      3 1
    // 3 4  ->  4 2
    expect(rotateFrameCW('1234', 2)).toBe('3142');
    const r4 = rotateFrameCW(rotateFrameCW(rotateFrameCW(rotateFrameCW('0123456789abcdef', 4), 4), 4), 4);
    expect(r4).toBe('0123456789abcdef');
  });

  it('shifts with wrap-around', () => {
    expect(shiftFrame(F32, 3, 2, 1, 0)).toBe('312645');
    expect(shiftFrame(F32, 3, 2, -1, 0)).toBe('231564');
    expect(shiftFrame(F32, 3, 2, 0, 1)).toBe('456123');
    expect(shiftFrame(F32, 3, 2, 3, 2)).toBe(F32);
    expect(shiftFrame(F32, 3, 2, -4, -3)).toBe(shiftFrame(F32, 3, 2, -1, -1));
  });

  it('agrees with PixelGrid transforms on a random 16x16 frame', () => {
    let seed = 7;
    const rand = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 16;
    const data = encodeFrame(Array.from({ length: 256 }, rand));
    const g = PixelGrid.from(data, 16, 16);
    expect(flipFrameX(data, 16, 16)).toBe(g.flipX().toData());
    expect(flipFrameY(data, 16, 16)).toBe(g.flipY().toData());
    expect(rotateFrameCW(data, 16)).toBe(g.rotateCW().toData());
    expect(shiftFrame(data, 16, 16, 3, -5)).toBe(g.shift(3, -5).toData());
  });
});
