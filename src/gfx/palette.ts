// SNES colour helpers. OWNER: gfx agent. Pure functions (unit-testable in node).
import type { Palette } from '../core/types';
import { PALETTE_SIZE } from '../core/constants';

function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** "#rrggbb" -> [r, g, b] (0-255). Accepts "#rgb" too (and a missing '#'); malformed input gives [0, 0, 0]. */
export function hexToRgb(hex: string): [number, number, number] {
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return [0, 0, 0];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] (0-255) -> "#rrggbb" lowercase. Channels are rounded and clamped. */
export function rgbToHex(r: number, g: number, b: number): string {
  const n = (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Snap an 8-bit channel to the nearest SNES 5-bit level, expanded back to 8-bit ((c5 << 3) | (c5 >> 2)). */
export function snap5(v: number): number {
  const c5 = Math.round((clampByte(v) * 31) / 255);
  return (c5 << 3) | (c5 >> 2);
}

/** Snap every channel of a hex colour to the SNES gamut. */
export function snapHex(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(snap5(r), snap5(g), snap5(b));
}

/** Build a 16-colour palette (pads with "#000000", truncates extras, lowercases). */
export function makePalette(id: string, name: string, colors: string[]): Palette {
  const c = colors.slice(0, PALETTE_SIZE).map((s) => s.toLowerCase());
  while (c.length < PALETTE_SIZE) c.push('#000000');
  return { id, name, colors: c };
}

/** Packed RGBA per index for Uint32 ImageData writes (little-endian 0xAABBGGRR); index 0 = 0 (transparent). */
export function paletteRGBA(p: Palette): Uint32Array {
  const out = new Uint32Array(PALETTE_SIZE);
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const [r, g, b] = hexToRgb(p.colors[i] ?? '#000000');
    out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return out;
}
