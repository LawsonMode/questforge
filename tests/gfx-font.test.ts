import { beforeAll, describe, expect, it } from 'vitest';
import { GLYPH_H, GLYPH_W, LINE_H, drawText, drawTextAligned, measureText, wrapText } from '../src/gfx/font';

/** Canvas fake recording drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) calls. */
class FakeContext {
  imageSmoothingEnabled = true;
  globalCompositeOperation = 'source-over';
  fillStyle = '';
  blits: number[][] = [];
  createImageData(w: number, h: number): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(): void {}
  fillRect(): void {}
  drawImage(_img: unknown, ...rest: number[]): void {
    if (rest.length === 8) this.blits.push(rest);
  }
}

beforeAll(() => {
  const createElement = (): unknown => ({ width: 0, height: 0, getContext: () => new FakeContext() });
  (globalThis as { document?: unknown }).document = { createElement };
});

describe('font: metrics', () => {
  it('exports 8x8 cells with 10px lines', () => {
    expect([GLYPH_W, GLYPH_H, LINE_H]).toEqual([8, 8, 10]);
  });

  it('measures proportional advances minus the trailing gap', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AA')).toBe(11);
    expect(measureText('I')).toBe(3);
    expect(measureText('i')).toBe(1);
    expect(measureText(' ')).toBe(3);
    expect(measureText('A B')).toBe(5 + 1 + 3 + 1 + 5);
  });

  it('keeps every digit the same width', () => {
    for (const d of '0123456789') expect(measureText(d), d).toBe(5);
    expect(measureText('0123456789')).toBe(10 * 6 - 1);
    expect(measureText('111')).toBe(measureText('808'));
  });

  it('returns the longest line and measures unknown chars as "?"', () => {
    expect(measureText('AB\nABCD\nA')).toBe(measureText('ABCD'));
    expect(measureText('A\n')).toBe(5);
    expect(measureText(String.fromCharCode(0xe9))).toBe(measureText('?'));
  });

  it('treats CRLF and lone CR as line breaks and a tab as a space', () => {
    expect(measureText('Hello\r\nWorld')).toBe(measureText('World'));
    expect(measureText('Hello\r')).toBe(measureText('Hello'));
    expect(measureText('AB\rABCD')).toBe(measureText('ABCD'));
    expect(measureText('A\tB')).toBe(measureText('A B'));
  });

  it('gives every printable ASCII glyph a width within the 8px cell', () => {
    for (let c = 33; c <= 126; c++) {
      const w = measureText(String.fromCharCode(c));
      expect(w, String.fromCharCode(c)).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(GLYPH_W);
    }
  });
});

describe('font: wrapping', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('Hello there', 200)).toEqual(['Hello there']);
    expect(wrapText('', 100)).toEqual(['']);
  });

  it('wraps greedily at word boundaries within maxWidth', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the old mill';
    for (const maxWidth of [40, 64, 100, 150]) {
      const lines = wrapText(text, maxWidth);
      expect(lines.join(' ')).toBe(text);
      for (const l of lines) expect(measureText(l), l).toBeLessThanOrEqual(maxWidth);
      // Greedy: the next word would not have fit on the previous line.
      for (let i = 1; i < lines.length; i++) {
        const next = lines[i]!.split(' ')[0]!;
        expect(measureText(`${lines[i - 1]} ${next}`)).toBeGreaterThan(maxWidth);
      }
    }
  });

  it('fits exactly at the boundary', () => {
    const w = measureText('AAA AAA');
    expect(wrapText('AAA AAA', w)).toEqual(['AAA AAA']);
    expect(wrapText('AAA AAA', w - 1)).toEqual(['AAA', 'AAA']);
  });

  it('honours explicit newlines, including empty lines', () => {
    expect(wrapText('One\n\nTwo three', 1000)).toEqual(['One', '', 'Two three']);
    expect(wrapText('A\n', 1000)).toEqual(['A', '']);
  });

  it('collapses runs of spaces', () => {
    expect(wrapText('  a   b  ', 1000)).toEqual(['a b']);
  });

  it('splits CRLF / CR paragraphs and wraps on tabs', () => {
    expect(wrapText('Hello\r\nWorld', 200)).toEqual(['Hello', 'World']);
    expect(wrapText('One\rTwo\n\r\nThree', 200)).toEqual(['One', 'Two', '', 'Three']);
    expect(wrapText('a\tb \t c', 1000)).toEqual(['a b c']);
  });

  it('hard-breaks words longer than maxWidth', () => {
    const lines = wrapText('Hi Supercalifragilistic ok', 30);
    for (const l of lines) expect(measureText(l), l).toBeLessThanOrEqual(30);
    expect(lines.join(' ').replace(/ /g, '')).toBe('HiSupercalifragilisticok');
    expect(lines[0]).toBe('Hi');
    expect(lines.length).toBeGreaterThan(3);
  });

  it('never loops forever when maxWidth is smaller than a glyph', () => {
    expect(wrapText('ABC', 2)).toEqual(['A', 'B', 'C']);
    expect(wrapText('AB', 0)).toEqual(['A', 'B']);
  });

  /** The original measure-and-slice wrapper (quadratic on long words), kept as the reference for the output. */
  function referenceWrap(text: string, maxWidth: number): string[] {
    const fit = (word: string): number => {
      let n = 1;
      while (n < word.length && measureText(word.slice(0, n + 1)) <= maxWidth) n++;
      return n;
    };
    const lines: string[] = [];
    for (const para of text.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const word of para.split(/[ \t]+/)) {
        if (!word) continue;
        const joined = line ? `${line} ${word}` : word;
        if (measureText(joined) <= maxWidth) {
          line = joined;
          continue;
        }
        if (line) lines.push(line);
        let rest = word;
        while (rest.length > 1 && measureText(rest) > maxWidth) {
          const n = fit(rest);
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  it('matches the reference wrapper on random text (spaces, tabs, breaks, long words, odd chars)', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyzMWil1.!ABC  \t\n\ré—,';
    for (let k = 0; k < 400; k++) {
      let s = '';
      const len = rnd(120);
      for (let i = 0; i < len; i++) s += rnd(8) === 0 ? 'W'.repeat(rnd(40)) : alphabet[rnd(alphabet.length)];
      const width = rnd(8) === 0 ? rnd(12) : 20 + rnd(220);
      expect(wrapText(s, width), JSON.stringify([s, width])).toEqual(referenceWrap(s, width));
    }
  });

  it('wraps one huge unbroken word in linear time (a 1 MB sign must not freeze the game)', () => {
    const t0 = performance.now();
    const lines = wrapText('M'.repeat(1_000_000), 200);
    const ms = performance.now() - t0;
    expect(lines.length).toBeGreaterThan(20_000);
    expect(lines.join('')).toHaveLength(1_000_000);
    for (const l of lines.slice(0, 50)) expect(measureText(l)).toBeLessThanOrEqual(200);
    expect(ms).toBeLessThan(1500);
  });
});

describe('font: drawing', () => {
  const draw = (fn: (ctx: CanvasRenderingContext2D) => void): number[][] => {
    const ctx = new FakeContext();
    fn(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    return ctx.blits;
  };

  it('blits one glyph per inked char at its advance, skipping spaces', () => {
    const blits = draw((ctx) => drawText(ctx, 'Ab c', 10.4, 5.6, '#fff'));
    expect(blits.map((b) => [b[4], b[5]])).toEqual([[10, 6], [16, 6], [26, 6]]);
    // Source rect: glyph column in the atlas, ink width, full cell height.
    expect(blits[0]!.slice(0, 4)).toEqual([('A'.charCodeAt(0) - 32) * GLYPH_W, 0, 5, GLYPH_H]);
  });

  it('renders unknown characters as "?"', () => {
    const [b] = draw((ctx) => drawText(ctx, String.fromCharCode(0xe9), 0, 0, '#fff'));
    expect(b![0]).toBe(('?'.charCodeAt(0) - 32) * GLYPH_W);
  });

  it('starts a new line every LINE_H px on newline', () => {
    const blits = draw((ctx) => drawText(ctx, 'A\nB', 3, 4, '#fff'));
    expect(blits.map((b) => [b[4], b[5]])).toEqual([[3, 4], [3, 4 + LINE_H]]);
  });

  it('draws CRLF as one break with no stray glyph, and a tab as a space', () => {
    const crlf = draw((ctx) => drawText(ctx, 'A\r\nB', 0, 0, '#fff'));
    expect(crlf.map((b) => [b[4], b[5]])).toEqual([[0, 0], [0, LINE_H]]);
    const tab = draw((ctx) => drawText(ctx, 'A\tB', 0, 0, '#fff'));
    const spaced = draw((ctx) => drawText(ctx, 'A B', 0, 0, '#fff'));
    expect(tab).toEqual(spaced);
  });

  it('aligns each line on x for center and right', () => {
    const c = draw((ctx) => drawTextAligned(ctx, 'AB\nABCD', 100, 0, '#fff', 'center'));
    expect(c[0]![4]).toBe(100 - Math.floor(measureText('AB') / 2));
    expect(c[2]![4]).toBe(100 - Math.floor(measureText('ABCD') / 2));
    const r = draw((ctx) => drawTextAligned(ctx, 'AB', 100, 0, '#fff', 'right'));
    const last = r[r.length - 1]!;
    expect(last[4]! + last[2]!).toBe(100);
  });
});
