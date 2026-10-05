// How Questforge stores images, as numbers (pure): a frame is one hex digit
// (4 bits, a palette index 0-15) per pixel; a palette colour is 5 bits per red,
// green and blue channel (SNES BGR555, 15 bits per colour). Used by the art
// tab's "Under the hood" panel.

/** `n` in binary, padded to `width` digits. */
export function bits(n: number, width: number): string {
  return (n >>> 0).toString(2).padStart(width, '0');
}

export interface ColourBits {
  /** 0-31 per channel. */
  r: number;
  g: number;
  b: number;
  /** The packed 15-bit SNES colour: 0bbbbbgggggrrrrr. */
  bgr555: number;
}

/** A "#rrggbb" colour as the 5-bit channels it snaps to (null for anything else). */
export function colourBits(hex: string): ColourBits | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) >> 3) as [number, number, number];
  return { r, g, b, bgr555: (b << 10) | (g << 5) | r };
}

/** Storage size of one w×h frame at 4 bits per pixel. */
export function frameSize(w: number, h: number): { pixels: number; bits: number; bytes: number } {
  const pixels = w * h;
  return { pixels, bits: pixels * 4, bytes: pixels / 2 };
}

/** Pixel indices (0-15) as rows of hex digits, row-major. */
export function hexRows(px: ArrayLike<number>, w: number, h: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += ((px[y * w + x] ?? 0) & 15).toString(16);
    rows.push(row);
  }
  return rows;
}
