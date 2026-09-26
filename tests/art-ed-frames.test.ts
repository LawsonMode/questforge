import { describe, expect, it } from 'vitest';
import {
  appendFrame, deleteFrame, duplicateFrame, formatFrameList, moveFrame, parseFrameList, type FrameList,
} from '../src/editor/art/frames';

/** Frames 'a'..'d' (stand-ins for PixelData) with anims referencing them. */
function list(): FrameList {
  return {
    frames: ['a', 'b', 'c', 'd'],
    anims: {
      walk: { frames: [0, 1, 2, 1], fps: 8, loop: true },
      idle: { frames: [3], fps: 1, loop: false, flipX: true },
    },
  };
}

/** Each anim as the frame contents it shows (index-independent). */
function shown(l: FrameList): Record<string, string> {
  return Object.fromEntries(Object.entries(l.anims).map(([k, a]) => [k, a.frames.map((i) => l.frames[i]).join('')]));
}

describe('art frames: structural edits keep anims pointing at the same art', () => {
  it('append adds at the end without touching anims', () => {
    const r = appendFrame(list(), 'e');
    expect(r.frames).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shown(r)).toEqual(shown(list()));
  });

  it('duplicate inserts after the source and shifts later references', () => {
    const r = duplicateFrame(list(), 1);
    expect(r.frames).toEqual(['a', 'b', 'b', 'c', 'd']);
    expect(shown(r)).toEqual({ walk: 'abcb', idle: 'd' });
    expect(r.anims.walk!.frames).toEqual([0, 1, 3, 1]);
  });

  it('move reorders frames and anims follow their art', () => {
    const r = moveFrame(list(), 0, 3);
    expect(r.frames).toEqual(['b', 'c', 'd', 'a']);
    expect(shown(r)).toEqual(shown(list()));
    const back = moveFrame(list(), 3, 1);
    expect(back.frames).toEqual(['a', 'd', 'b', 'c']);
    expect(shown(back)).toEqual(shown(list()));
  });

  it('delete falls references back to the previous frame and shifts later ones', () => {
    const r = deleteFrame(list(), 1);
    expect(r.frames).toEqual(['a', 'c', 'd']);
    expect(r.anims.walk!.frames).toEqual([0, 0, 1, 0]);
    expect(r.anims.idle!.frames).toEqual([2]);
    expect(deleteFrame(list(), 0).anims.walk!.frames).toEqual([0, 0, 1, 0]);
  });

  it('keeps other anim fields and never mutates the input', () => {
    const src = list();
    const r = duplicateFrame(src, 0);
    expect(r.anims.idle).toEqual({ frames: [4], fps: 1, loop: false, flipX: true });
    expect(src).toEqual(list());
  });

  it('rejects impossible edits', () => {
    const one: FrameList = { frames: ['a'], anims: {} };
    expect(deleteFrame(one, 0)).toBe(one);
    const l = list();
    expect(moveFrame(l, 0, 9)).toBe(l);
    expect(duplicateFrame(l, 7)).toBe(l);
  });
});

describe('art frames: anim frame lists', () => {
  it('parses commas and/or spaces', () => {
    expect(parseFrameList('0,1,2,1', 3)).toEqual([0, 1, 2, 1]);
    expect(parseFrameList(' 2  0, 1 ', 3)).toEqual([2, 0, 1]);
  });

  it('rejects empty lists, non-numbers and out-of-range indices', () => {
    expect(parseFrameList('', 3)).toBeNull();
    expect(parseFrameList('0,x', 3)).toBeNull();
    expect(parseFrameList('-1', 3)).toBeNull();
    expect(parseFrameList('3', 3)).toBeNull();
  });

  it('formats for the table', () => {
    expect(formatFrameList([0, 1, 2, 1])).toBe('0,1,2,1');
  });
});
