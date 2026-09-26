import { describe, expect, it } from 'vitest';
import {
  anchorOffset, boxFrom, clipBox, composeFloating, ellipsePoints, floodFill, fromBitmap, liftRegion,
  linePoints, mirrorPoints, plot, rectPoints, resizeFrame, toBitmap, transformRegion, type Bitmap, type Pt,
} from '../src/editor/art/ops';
import { blankFrame } from '../src/gfx/pixels';

/** Frame from rows of hex digits (all rows equally long). */
function frame(...rows: string[]): Bitmap {
  return toBitmap(rows.join(''), rows[0]!.length, rows.length);
}

/** Bitmap back to rows for readable assertions. */
function rows(b: Bitmap): string[] {
  const s = fromBitmap(b);
  const out: string[] = [];
  for (let y = 0; y < b.h; y++) out.push(s.slice(y * b.w, (y + 1) * b.w));
  return out;
}

function draw(w: number, h: number, pts: Pt[], v = 1): string[] {
  const b = toBitmap(blankFrame(w, h), w, h);
  plot(b, pts, v);
  return rows(b);
}

describe('art ops: lines', () => {
  it('draws horizontal, vertical and diagonal lines including both ends', () => {
    expect(linePoints({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(linePoints({ x: 2, y: 3 }, { x: 2, y: 0 }).map((p) => p.y)).toEqual([3, 2, 1, 0]);
    expect(draw(4, 4, linePoints({ x: 0, y: 0 }, { x: 3, y: 3 }))).toEqual(['1000', '0100', '0010', '0001']);
  });

  it('draws a shallow line with one pixel per column, stepping down once without gaps', () => {
    const pts = linePoints({ x: 0, y: 0 }, { x: 4, y: 1 });
    expect(pts.map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
    const ys = pts.map((p) => p.y);
    expect(ys[0]).toBe(0);
    expect(ys[4]).toBe(1);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(0);
  });

  it('a single point is a one-pixel line', () => {
    expect(linePoints({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('art ops: rectangles & ellipses', () => {
  it('outlines or fills a rectangle from any corner pair', () => {
    expect(draw(4, 4, rectPoints({ x: 3, y: 2 }, { x: 0, y: 0 }, false))).toEqual(['1111', '1001', '1111', '0000']);
    expect(draw(4, 3, rectPoints({ x: 1, y: 0 }, { x: 2, y: 2 }, true))).toEqual(['0110', '0110', '0110']);
  });

  it('draws a symmetric hollow ellipse inside its box', () => {
    const r = draw(7, 5, ellipsePoints({ x: 0, y: 0 }, { x: 6, y: 4 }, false));
    expect(r[0]).toBe('0011100');
    expect(r[2]).toBe('1000001');
    expect(r[4]).toBe('0011100');
    for (const line of r) expect(line).toBe([...line].reverse().join(''));
  });

  it('filled ellipses fill each row between the outline', () => {
    const r = draw(6, 6, ellipsePoints({ x: 0, y: 0 }, { x: 5, y: 5 }, true));
    expect(r[2]).toBe('111111');
    expect(r[0]).toMatch(/^0+1+0+$/);
    expect(r).toEqual([...r].reverse());
  });

  it('degenerate boxes still produce pixels', () => {
    expect(ellipsePoints({ x: 1, y: 1 }, { x: 1, y: 1 }, false)).toEqual([{ x: 1, y: 1 }]);
    expect(draw(4, 1, ellipsePoints({ x: 0, y: 0 }, { x: 3, y: 0 }, false))).toEqual(['1111']);
  });
});

describe('art ops: plot, mirror & masks', () => {
  it('ignores out-of-frame points and masks outside the selection', () => {
    const b = toBitmap(blankFrame(3, 3), 3, 3);
    plot(b, [{ x: -1, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 0 }, { x: 2, y: 2 }], 5, { x: 0, y: 0, w: 2, h: 2 });
    expect(rows(b)).toEqual(['500', '000', '000']);
  });

  it('mirrors points across the vertical and/or horizontal centre', () => {
    const p = [{ x: 0, y: 1 }];
    expect(mirrorPoints(p, 4, 4, true, false)).toEqual([{ x: 0, y: 1 }, { x: 3, y: 1 }]);
    expect(mirrorPoints(p, 4, 4, false, true)).toEqual([{ x: 0, y: 1 }, { x: 0, y: 2 }]);
    expect(mirrorPoints(p, 4, 4, true, true)).toHaveLength(4);
    // A point on the centre line of an odd frame is not duplicated.
    expect(mirrorPoints([{ x: 2, y: 0 }], 5, 5, true, false)).toEqual([{ x: 2, y: 0 }]);
  });

  it('boxFrom normalises corners and clipBox trims to the frame', () => {
    expect(boxFrom({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 1, w: 4, h: 4 });
    expect(clipBox({ x: -2, y: 14, w: 5, h: 5 }, 16, 16)).toEqual({ x: 0, y: 14, w: 3, h: 2 });
    expect(clipBox({ x: 20, y: 0, w: 2, h: 2 }, 16, 16)).toBeNull();
  });
});

describe('art ops: flood fill', () => {
  it('fills the 4-connected region of the start colour only', () => {
    const b = frame(
      '0010',
      '0010',
      '1100',
      '0001',
    );
    floodFill(b, 0, 0, 7);
    expect(rows(b)).toEqual(['7710', '7710', '1100', '0001']);
  });

  it('does not leak through diagonal gaps', () => {
    const b = frame('01', '10');
    floodFill(b, 0, 0, 5);
    expect(rows(b)).toEqual(['51', '10']);
  });

  it('is a no-op when the colour is unchanged, out of bounds or outside the mask', () => {
    const b = frame('00', '00');
    floodFill(b, 0, 0, 0);
    floodFill(b, 5, 5, 3);
    floodFill(b, 1, 1, 3, { x: 0, y: 0, w: 1, h: 1 });
    expect(rows(b)).toEqual(['00', '00']);
  });

  it('stays inside the selection mask', () => {
    const b = frame('000', '000');
    floodFill(b, 0, 0, 4, { x: 0, y: 0, w: 2, h: 2 });
    expect(rows(b)).toEqual(['440', '440']);
  });
});

describe('art ops: selection move', () => {
  it('lifting clears the region and keeps its pixels', () => {
    const f = liftRegion(frame('12', '34'), { x: 0, y: 0, w: 1, h: 2 });
    expect(rows(f.base)).toEqual(['02', '04']);
    expect(rows(f.content)).toEqual(['1', '3']);
  });

  it('moves a region: the source clears and the pixels land on top (transparent pixels keep the base)', () => {
    const b = frame(
      '1200',
      '3000',
      '0055',
    );
    expect(rows(composeFloating(liftRegion(b, { x: 0, y: 0, w: 2, h: 2 }), 2, 1))).toEqual(['0000', '0012', '0035']);
  });

  it('moved pixels falling off the frame are clipped; the floating copy can move back', () => {
    const f = liftRegion(frame('12', '00'), { x: 0, y: 0, w: 2, h: 1 });
    expect(rows(composeFloating(f, 1, 1))).toEqual(['00', '01']);
    expect(rows(composeFloating(f, 0, 0))).toEqual(['12', '00']);
  });
});

describe('art ops: region transforms', () => {
  it('flips, rotates and shifts the whole frame', () => {
    let b = frame('12', '34');
    transformRegion(b, null, 'flipX');
    expect(rows(b)).toEqual(['21', '43']);
    b = frame('12', '34');
    transformRegion(b, null, 'flipY');
    expect(rows(b)).toEqual(['34', '12']);
    b = frame('12', '34');
    transformRegion(b, null, 'rotate');
    expect(rows(b)).toEqual(['31', '42']);
    b = frame('123', '456');
    transformRegion(b, null, { shift: { x: 1, y: 0 } });
    expect(rows(b)).toEqual(['312', '645']);
  });

  it('transforms only the selected box', () => {
    const b = frame('1200', '3400');
    transformRegion(b, { x: 0, y: 0, w: 2, h: 2 }, 'flipX');
    expect(rows(b)).toEqual(['2100', '4300']);
  });

  it('rotate leaves non-square regions unchanged', () => {
    const b = frame('123', '456');
    transformRegion(b, null, 'rotate');
    expect(rows(b)).toEqual(['123', '456']);
  });
});

describe('art ops: resizing sprite frames', () => {
  it('pads or crops around the given offset', () => {
    expect(resizeFrame('1234', 2, 2, 4, 3, 1, 1)).toBe('0000' + '0120' + '0340');
    expect(resizeFrame('123456789', 3, 3, 2, 2, -1, -1)).toBe('5689');
  });

  it('anchors bottom-centre', () => {
    expect(anchorOffset(16, 16, 24, 24)).toEqual({ x: 4, y: 8 });
    expect(anchorOffset(16, 24, 16, 16)).toEqual({ x: 0, y: -8 });
  });
});
