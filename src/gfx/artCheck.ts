// Art sanity checks surfaced by the asset gallery. OWNER: gfx agent.
// Pure functions (unit-testable in node): each returns human-readable problems,
// an empty list meaning the asset renders as authored.
import type { Palette, SpriteAnim, SpriteDef, Terrain, TileDef } from '../core/types';
import { PALETTE_SIZE, TILE } from '../core/constants';
import { isValidFrame } from './pixels';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** The 13 autotile pieces of a Terrain, in display order. */
export const TERRAIN_PIECES = ['center', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'ine', 'inw', 'ise', 'isw'] as const;
export type TerrainPiece = (typeof TERRAIN_PIECES)[number];

/** Why `data` is not a valid w x h frame (w*h lowercase hex digits), or null if it is. */
export function frameProblem(data: unknown, w: number, h: number): string | null {
  if (typeof data !== 'string') return 'not a string';
  if (isValidFrame(data, w, h)) return null;
  if (data.length !== w * h) return `${data.length} px, expected ${w * h}`;
  for (let i = 0; i < data.length; i++) {
    if (!/[0-9a-f]/.test(data[i]!)) return `bad digit "${data[i]}" at (${i % w}, ${Math.floor(i / w)})`;
  }
  return 'invalid';
}

function framesProblems(frames: readonly unknown[], w: number, h: number): string[] {
  if (frames.length === 0) return ['no frames'];
  const out: string[] = [];
  frames.forEach((f, i) => {
    const p = frameProblem(f, w, h);
    if (p) out.push(`frame ${i}: ${p}`);
  });
  return out;
}

function paletteProblem(id: string, hasPalette: (id: string) => boolean): string[] {
  return hasPalette(id) ? [] : [`palette "${id}" not found (drawn greyscale)`];
}

/** Problems with a 16-colour palette. */
export function paletteProblems(p: Palette): string[] {
  const out: string[] = [];
  if (p.colors.length !== PALETTE_SIZE) out.push(`${p.colors.length} colours, expected ${PALETTE_SIZE}`);
  p.colors.forEach((c, i) => {
    if (!HEX_COLOR.test(c)) out.push(`colour ${i} "${c}" is not #rrggbb`);
  });
  return out;
}

/** Problems with a tile: frames, palette and frame time. */
export function tileProblems(t: TileDef, hasPalette: (id: string) => boolean): string[] {
  const out = framesProblems(t.frames, TILE, TILE);
  out.push(...paletteProblem(t.palette, hasPalette));
  if (t.frameTime !== undefined && !(t.frameTime > 0)) out.push(`frameTime ${t.frameTime} must be > 0`);
  return out;
}

/** Sprite-level problems: frame size, frames and palette. */
export function spriteProblems(s: SpriteDef, hasPalette: (id: string) => boolean): string[] {
  const sized = Number.isInteger(s.w) && Number.isInteger(s.h) && s.w > 0 && s.h > 0;
  const out = sized ? framesProblems(s.frames, s.w, s.h) : [`frame size ${s.w}x${s.h} is invalid`];
  out.push(...paletteProblem(s.palette, hasPalette));
  return out;
}

/** Problems with one anim of a sprite: empty, frame indices out of range, or no fps for a multi-frame anim. */
export function animProblems(s: SpriteDef, anim: SpriteAnim): string[] {
  if (anim.frames.length === 0) return ['no frames'];
  const out: string[] = [];
  const bad = anim.frames.filter((f) => !Number.isInteger(f) || f < 0 || f >= s.frames.length);
  if (bad.length) out.push(`frame index ${[...new Set(bad)].join(', ')} out of range (sprite has ${s.frames.length} frames)`);
  if (anim.frames.length > 1 && !(anim.fps > 0)) out.push(`fps ${anim.fps} must be > 0`);
  return out;
}

/** Autotile pieces of a terrain that point at missing tiles. */
export function terrainProblems(tr: Terrain, hasTile: (id: number) => boolean): string[] {
  return TERRAIN_PIECES.filter((k) => !hasTile(tr[k])).map((k) => `piece ${k}: tile ${tr[k]} not found`);
}
