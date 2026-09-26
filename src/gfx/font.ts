// Original 8x8 bitmap font (ASCII 32-126, plus four button shapes). OWNER: gfx agent.
//
// Design: caps are 7px tall (rows 0-6), lowercase x-height 5px (rows 2-6),
// descender tails (g j p q y , ;) reach row 7. Spacing is PROPORTIONAL: every
// glyph advances by its ink width + 1px (most letters 5px -> 6px advance, space
// 4px, i/l/!/. narrower). Digits are all 5px wide so counters don't jitter.
// measureText is exact: a line measures the sum of its advances minus the
// trailing 1px gap, i.e. the drawn ink spans exactly [x, x + measureText).
// Line breaks are '\n', '\r\n' or a lone '\r'; a tab counts as a space.
// Beyond ASCII, the private-use characters U+E000-U+E003 draw the PlayStation
// face-button shapes (cross, circle, square, triangle - input/devices.ts
// PS_GLYPHS) at cap height and 7px wide, so a hint can name them inline.
// Rendering blits from per-colour glyph atlases (one 792x8 canvas per colour).

export const GLYPH_W = 8;
export const GLYPH_H = 8;
/** Vertical distance between lines of text. */
export const LINE_H = 10;

/** Horizontal alignment of each line relative to the anchor x. */
export type TextAlign = 'left' | 'center' | 'right';

const FIRST = 32;
const LAST = 126;

/** 8 row bitmasks per glyph (2 hex digits each, MSB = leftmost pixel), ASCII 32-126 in order. */
const GLYPHS: readonly string[] = [
  '0000000000000000', // space
  '8080808080008000', // !
  'a0a0000000000000', // "
  '5050f850f8505000', // #
  '2078a07028f02000', // $
  'c0c8102040981800', // %
  '6090a040a8906800', // &
  '8080000000000000', // '
  '2040808080402000', // (
  '8040202020408000', // )
  '00a870f870a80000', // *
  '002020f820200000', // +
  '0000000000404080', // ,
  '000000f000000000', // -
  '0000000000008000', // .
  '0808102040808000', // /
  '708898a8c8887000', // 0
  '2060202020207000', // 1
  '708808304080f800', // 2
  '7088083008887000', // 3
  '10305090f8101000', // 4
  'f880f00808887000', // 5
  '304080f088887000', // 6
  'f808102040404000', // 7
  '7088887088887000', // 8
  '7088887808106000', // 9
  '0000800000008000', // :
  '0000400000404080', // ;
  '1020408040201000', // <
  '0000f800f8000000', // =
  '8040201020408000', // >
  '7088081020002000', // ?
  '7088b8a8b8807000', // @
  '708888f888888800', // A
  'f08888f08888f000', // B
  '7088808080887000', // C
  'f08888888888f000', // D
  'f88080f08080f800', // E
  'f88080f080808000', // F
  '708880b888887800', // G
  '888888f888888800', // H
  'e04040404040e000', // I
  '0808080888887000', // J
  '8890a0c0a0908800', // K
  '808080808080f800', // L
  '88d8a8a888888800', // M
  '88c8c8a898988800', // N
  '7088888888887000', // O
  'f08888f080808000', // P
  '70888888a8906800', // Q
  'f08888f0a0908800', // R
  '7088807008887000', // S
  'f820202020202000', // T
  '8888888888887000', // U
  '8888888850502000', // V
  '888888a8a8d88800', // W
  '8888502050888800', // X
  '8888502020202000', // Y
  'f80810204080f800', // Z
  'e08080808080e000', // [
  '8080402010080800', // backslash
  'e02020202020e000', // ]
  '2050880000000000', // ^
  '00000000000000f8', // _
  '8040000000000000', // `
  '0000700878887800', // a
  '8080f0888888f000', // b
  '0000708880887000', // c
  '0808788888887800', // d
  '00007088f8807000', // e
  '3040e04040404000', // f
  '0000788888780870', // g
  '8080b0c888888800', // h
  '8000808080808000', // i
  '1000101010109060', // j
  '808090a0c0a09000', // k
  'c040404040404000', // l
  '0000d0a8a8a8a800', // m
  '0000b0c888888800', // n
  '0000708888887000', // o
  '0000f08888f08080', // p
  '0000788888780808', // q
  '0000b0c080808000', // r
  '000078807008f000', // s
  '0040f04040403000', // t
  '0000888888986800', // u
  '0000888888502000', // v
  '00008888a8a85000', // w
  '0000885020508800', // x
  '0000888888780870', // y
  '0000f8102040f800', // z
  '3040408040403000', // {
  '8080808080808080', // |
  'c02020102020c000', // }
  '00000068b0000000', // ~
];

/** First private-use character drawn as a button shape; the other SYMBOLS follow it in order. */
const SYMBOL_FIRST = 0xe000;
/** Button shapes in the same row format, U+E000 onwards (the order of input/devices.ts PS_GLYPHS). */
const SYMBOLS: readonly string[] = [
  '8244281028448200', // U+E000 cross
  '3844828282443800', // U+E001 circle
  'fe8282828282fe00', // U+E002 square
  '102828444482fe00', // U+E003 triangle
];

/** Ink widths that can't be derived from the bitmask: space has no ink, '1' matches the other digits. */
const WIDTH_OVERRIDES: Readonly<Record<string, number>> = { ' ': 3, '1': 5 };

/** ASCII glyphs; the button shapes follow them in the tables and atlases (TOTAL glyphs in all). */
const COUNT = LAST - FIRST + 1;
const TOTAL = COUNT + SYMBOLS.length;
const ROWS = new Uint8Array(TOTAL * GLYPH_H);
const WIDTHS = new Uint8Array(TOTAL);
const INK = new Uint8Array(TOTAL);
for (let g = 0; g < TOTAL; g++) {
  const hex = g < COUNT ? GLYPHS[g]! : SYMBOLS[g - COUNT]!;
  let w = 0;
  for (let r = 0; r < GLYPH_H; r++) {
    const bits = parseInt(hex.slice(r * 2, r * 2 + 2), 16);
    ROWS[g * GLYPH_H + r] = bits;
    for (let x = 0; x < GLYPH_W; x++) if (bits & (0x80 >> x)) w = Math.max(w, x + 1);
  }
  INK[g] = w > 0 ? 1 : 0;
  WIDTHS[g] = (g < COUNT ? WIDTH_OVERRIDES[String.fromCharCode(FIRST + g)] : undefined) ?? w;
}

const FALLBACK = '?'.charCodeAt(0) - FIRST;
const TAB = 9;
const LF = 10;
const CR = 13;

/** Glyph for a char code: tabs draw as spaces, anything else outside ASCII 32-126 and the button shapes as '?'. */
function glyphIndex(code: number): number {
  if (code >= FIRST && code <= LAST) return code - FIRST;
  if (code >= SYMBOL_FIRST && code < SYMBOL_FIRST + SYMBOLS.length) return COUNT + code - SYMBOL_FIRST;
  return code === TAB ? 0 : FALLBACK;
}

/** Index of the line break ending the line that starts at `start` (text.length if none). */
function lineEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === LF || c === CR) return i;
  }
  return text.length;
}

/** Start of the line after the break at `end` ('\r\n' counts as one break). */
function nextLine(text: string, end: number): number {
  return text.charCodeAt(end) === CR && text.charCodeAt(end + 1) === LF ? end + 2 : end + 1;
}

/** Width of text[start, end) with no line breaks. */
function lineWidth(text: string, start: number, end: number): number {
  let w = 0;
  for (let i = start; i < end; i++) w += WIDTHS[glyphIndex(text.charCodeAt(i))]! + 1;
  return w > 0 ? w - 1 : 0;
}

// ---------------------------------------------------------------- atlases

const MAX_ATLASES = 32;
const atlases = new Map<string, HTMLCanvasElement>();
let mask: HTMLCanvasElement | null = null;

/** White glyph strip: glyph g occupies x = g * GLYPH_W. */
function glyphMask(): HTMLCanvasElement {
  if (mask) return mask;
  const c = document.createElement('canvas');
  c.width = TOTAL * GLYPH_W;
  c.height = GLYPH_H;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(c.width, c.height);
    const px = new Uint32Array(img.data.buffer);
    for (let g = 0; g < TOTAL; g++) {
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = ROWS[g * GLYPH_H + r]!;
        for (let x = 0; x < GLYPH_W; x++) if (bits & (0x80 >> x)) px[r * c.width + g * GLYPH_W + x] = 0xffffffff;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  mask = c;
  return c;
}

/** Glyph strip tinted with a CSS colour (cached; the oldest colour is dropped past MAX_ATLASES). */
function atlas(color: string): HTMLCanvasElement {
  const hit = atlases.get(color);
  if (hit) return hit;
  const m = glyphMask();
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(m, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  if (atlases.size >= MAX_ATLASES) {
    const oldest = atlases.keys().next();
    if (!oldest.done) atlases.delete(oldest.value);
  }
  atlases.set(color, c);
  return c;
}

// ---------------------------------------------------------------- public API

/** Draw text with its top-left at (x, y). Unknown chars render as '?'. A line break starts a new line (LINE_H px). */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  drawTextAligned(ctx, text, x, y, color, 'left');
}

/**
 * Draw text whose lines are aligned on x: 'left' starts at x, 'center' centres
 * each line on x, 'right' ends each line at x. (x, y) are rounded to whole pixels.
 */
export function drawTextAligned(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: TextAlign,
): void {
  if (!text) return;
  const img = atlas(color);
  ctx.imageSmoothingEnabled = false;
  const ax = Math.round(x);
  let ly = Math.round(y);
  let start = 0;
  for (;;) {
    const end = lineEnd(text, start);
    let lx = ax;
    if (align !== 'left') {
      const w = lineWidth(text, start, end);
      lx -= align === 'center' ? Math.floor(w / 2) : w;
    }
    for (let i = start; i < end; i++) {
      const g = glyphIndex(text.charCodeAt(i));
      const w = WIDTHS[g]!;
      if (INK[g]) ctx.drawImage(img, g * GLYPH_W, 0, w, GLYPH_H, lx, ly, w, GLYPH_H);
      lx += w + 1;
    }
    if (end >= text.length) return;
    start = nextLine(text, end);
    ly += LINE_H;
  }
}

/** Width in px of the longest line. */
export function measureText(text: string): number {
  let max = 0;
  let start = 0;
  for (;;) {
    const end = lineEnd(text, start);
    max = Math.max(max, lineWidth(text, start, end));
    if (end >= text.length) return max;
    start = nextLine(text, end);
  }
}

/** Advance of the space that joins two words (its ink width + the 1px gap on each side of it). */
const JOIN_W = WIDTHS[0]! + 2;

/**
 * Word-wrap to lines no wider than maxWidth px (honours line breaks). Words are
 * split on spaces/tabs (runs collapse); a word wider than maxWidth is hard-broken.
 * Linear in the text length: widths are tracked incrementally and a long word is
 * cut by index, never re-measured or re-sliced per line.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r\n|\r|\n/)) {
    let line = '';
    let lineW = 0;
    for (const word of para.split(/[ \t]+/)) {
      if (!word) continue;
      const wordW = lineWidth(word, 0, word.length);
      const joinedW = line ? lineW + JOIN_W + wordW : wordW;
      if (joinedW <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        lineW = joinedW;
        continue;
      }
      if (line) lines.push(line);
      // Hard-break: take the longest prefix that fits (at least one char) while the rest is too wide.
      let pos = 0;
      let restW = wordW;
      while (word.length - pos > 1 && restW > maxWidth) {
        let end = pos + 1;
        let w = WIDTHS[glyphIndex(word.charCodeAt(pos))]!;
        while (end < word.length) {
          const next = w + 1 + WIDTHS[glyphIndex(word.charCodeAt(end))]!;
          if (next > maxWidth) break;
          w = next;
          end++;
        }
        lines.push(word.slice(pos, end));
        restW -= w + 1;
        pos = end;
      }
      line = pos === 0 ? word : word.slice(pos);
      lineW = restW;
    }
    lines.push(line);
  }
  return lines;
}
