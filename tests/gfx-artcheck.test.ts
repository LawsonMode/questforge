import { describe, expect, it } from 'vitest';
import type { SpriteDef, Terrain, TileDef } from '../src/core/types';
import {
  TERRAIN_PIECES, animProblems, frameProblem, paletteProblems, spriteProblems, terrainProblems, tileProblems,
} from '../src/gfx/artCheck';
import { makePalette } from '../src/gfx/palette';

const has = (...ids: string[]) => (id: string): boolean => ids.includes(id);

function tile(extra: Partial<TileDef> = {}): TileDef {
  return { id: 1, key: 'T', name: 'T', palette: 'pal.a', frames: ['1'.repeat(256)], collision: 'floor', tags: [], ...extra };
}

function sprite(extra: Partial<SpriteDef> = {}): SpriteDef {
  return {
    id: 's', name: 'S', palette: 'pal.a', w: 2, h: 2, ox: 1, oy: 1,
    frames: ['1000', '0200'], anims: {}, tags: [], ...extra,
  };
}

describe('artCheck: frames', () => {
  it('accepts exact lowercase hex frames', () => {
    expect(frameProblem('0123', 2, 2)).toBeNull();
  });

  it('explains wrong lengths, bad digits and non-strings', () => {
    expect(frameProblem('012', 2, 2)).toBe('3 px, expected 4');
    expect(frameProblem('01g3', 2, 2)).toBe('bad digit "g" at (0, 1)');
    expect(frameProblem('01A3', 2, 2)).toBe('bad digit "A" at (0, 1)');
    expect(frameProblem(42, 2, 2)).toBe('not a string');
  });
});

describe('artCheck: palettes and tiles', () => {
  it('flags palettes with the wrong size or malformed colours', () => {
    expect(paletteProblems(makePalette('p', 'P', ['#000000']))).toEqual([]);
    const bad = { id: 'p', name: 'P', colors: ['#000000', 'red'] };
    expect(paletteProblems(bad)).toEqual(['2 colours, expected 16', 'colour 1 "red" is not #rrggbb']);
  });

  it('passes a clean tile', () => {
    expect(tileProblems(tile(), has('pal.a'))).toEqual([]);
  });

  it('reports bad frames, a missing palette and a bad frame time', () => {
    const t = tile({ frames: ['1'.repeat(256), '1'.repeat(255)], palette: 'pal.x', frameTime: 0 });
    expect(tileProblems(t, has('pal.a'))).toEqual([
      'frame 1: 255 px, expected 256',
      'palette "pal.x" not found (drawn greyscale)',
      'frameTime 0 must be > 0',
    ]);
    expect(tileProblems(tile({ frames: [] }), has('pal.a'))).toEqual(['no frames']);
  });
});

describe('artCheck: sprites and anims', () => {
  it('passes a clean sprite and flags size, frames and palette', () => {
    expect(spriteProblems(sprite(), has('pal.a'))).toEqual([]);
    expect(spriteProblems(sprite({ w: 0 }), has('pal.a'))).toEqual(['frame size 0x2 is invalid']);
    expect(spriteProblems(sprite({ frames: ['10', '0200'], palette: 'pal.q' }), has('pal.a'))).toEqual([
      'frame 0: 2 px, expected 4',
      'palette "pal.q" not found (drawn greyscale)',
    ]);
  });

  it('flags anim frame indices outside the sprite, once each', () => {
    const s = sprite();
    expect(animProblems(s, { frames: [0, 1], fps: 8, loop: true })).toEqual([]);
    expect(animProblems(s, { frames: [0, 2, 2, -1], fps: 8, loop: true })).toEqual([
      'frame index 2, -1 out of range (sprite has 2 frames)',
    ]);
    expect(animProblems(s, { frames: [0, 1.5], fps: 8, loop: true })[0]).toContain('1.5');
  });

  it('flags empty anims and multi-frame anims without fps', () => {
    const s = sprite();
    expect(animProblems(s, { frames: [], fps: 8, loop: true })).toEqual(['no frames']);
    expect(animProblems(s, { frames: [0, 1], fps: 0, loop: true })).toEqual(['fps 0 must be > 0']);
    expect(animProblems(s, { frames: [1], fps: 0, loop: false })).toEqual([]);
  });
});

describe('artCheck: terrains', () => {
  it('lists pieces that point at missing tiles', () => {
    const tr = Object.fromEntries(TERRAIN_PIECES.map((k) => [k, 5])) as unknown as Terrain;
    Object.assign(tr, { id: 't', name: 'T', layer: 'bg', ne: 9 });
    expect(terrainProblems(tr, (id) => id === 5)).toEqual(['piece ne: tile 9 not found']);
    expect(TERRAIN_PIECES).toHaveLength(13);
  });
});
