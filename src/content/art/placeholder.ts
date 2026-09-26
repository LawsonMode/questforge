// Placeholder art generated from the catalog so the engine/editor can run before
// (or without) real art. Real art modules replace these entirely.
import type { Palette, PixelData, SpriteDef, TileDef } from '../../core/types';
import { SPRITE_SPECS, TILE_SPECS, type SpriteSpec, type TileSpec } from '../ids';
import { PixelGrid } from './pixelgrid';
import { palette, spriteDefFromSpec, tileDefFromSpec } from './build';

export const PLACEHOLDER_PALETTE = 'pal.placeholder';

// 0 transparent, 1 black, 2 white, 3 green, 4 dark green, 5 blue, 6 dark blue, 7 brown,
// 8 grey, 9 dark grey, 10 red, 11 yellow, 12 purple, 13 tan, 14 orange, 15 magenta
const COLORS = ['#000000', '#101010', '#f8f8f8', '#58a838', '#306820', '#3870d0', '#203878', '#886030',
  '#909098', '#484850', '#d03030', '#f0d040', '#8040b0', '#d0b080', '#f08030', '#f040c0'];

export function placeholderPalettes(swaps: string[] = []): Palette[] {
  const base = palette(PLACEHOLDER_PALETTE, 'Placeholder', COLORS);
  return [base, ...swaps.map((id) => palette(id, `Placeholder swap ${id}`, [...COLORS].reverse()))];
}

function tileColor(spec: TileSpec): number {
  switch (spec.collision) {
    case 'solid': return spec.tags.includes('tree') ? 4 : 9;
    case 'deep': return 6;
    case 'shallow': return 5;
    case 'pit': return 1;
    case 'ledge': return 7;
    case 'hurt': return 10;
    case 'tallgrass': return 4;
    case 'stairs': return 13;
    default: return spec.tags.includes('dungeon') || spec.tags.includes('cave') ? 8 : spec.tags.includes('interior') ? 13 : 3;
  }
}

function placeholderTile(spec: TileSpec, frame: number): PixelData {
  const g = new PixelGrid(16, 16, tileColor(spec));
  if (spec.collision === 'solid') g.rect(0, 0, 16, 16, 1);
  // Checker speck so animation & orientation are visible.
  g.set(3 + frame, 3, 2).set(12, 12 - frame, 2);
  if (spec.ledgeDir === 'down') g.fill(0, 13, 16, 3, 1);
  if (spec.ledgeDir === 'up') g.fill(0, 0, 16, 3, 1);
  if (spec.ledgeDir === 'left') g.fill(0, 0, 3, 16, 1);
  if (spec.ledgeDir === 'right') g.fill(13, 0, 3, 16, 1);
  return g.toData();
}

export function placeholderTiles(): TileDef[] {
  return TILE_SPECS.map((spec) => {
    const frames = spec.animated ? [placeholderTile(spec, 0), placeholderTile(spec, 1)] : [placeholderTile(spec, 0)];
    return tileDefFromSpec(spec, PLACEHOLDER_PALETTE, frames, 0.4);
  });
}

function spriteColor(spec: SpriteSpec): number {
  const t = spec.tags[0];
  switch (t) {
    case 'hero': return 3;
    case 'enemy': return 10;
    case 'boss': return 12;
    case 'npc': return 13;
    case 'object': return 7;
    case 'fx': return 11;
    case 'projectile': return 2;
    case 'pickup': return 11;
    case 'item': return 14;
    case 'hud': return 10;
    default: return 15;
  }
}

function placeholderFrame(spec: SpriteSpec, anim: string, i: number): PixelData {
  const g = new PixelGrid(spec.w, spec.h);
  const c = spriteColor(spec);
  const inset = spec.w >= 16 ? 2 : 1;
  g.fill(inset, inset, spec.w - inset * 2, spec.h - inset * 2, c);
  g.rect(inset, inset, spec.w - inset * 2, spec.h - inset * 2, 1);
  // Facing notch.
  const cx = Math.floor(spec.w / 2);
  const cy = Math.floor(spec.h / 2);
  if (anim.endsWith('_up') || anim === 'n' || anim === 'up') g.fill(cx - 1, inset, 2, 3, 2);
  else if (anim.endsWith('_right') || anim === 'e' || anim === 'right') g.fill(spec.w - inset - 3, cy - 1, 3, 2, 2);
  else if (anim.endsWith('_down') || anim === 's' || anim === 'down') g.fill(cx - 1, spec.h - inset - 3, 2, 3, 2);
  // Frame counter pixels.
  for (let k = 0; k <= i && k < spec.w - 4; k++) g.set(inset + 1 + k, inset + 1, 11);
  return g.toData();
}

export function placeholderSprites(filter: (s: SpriteSpec) => boolean): SpriteDef[] {
  return SPRITE_SPECS.filter(filter).map((spec) => {
    const frames: PixelData[] = [];
    const animFrames: Record<string, number[]> = {};
    for (const [name, a] of Object.entries(spec.anims)) {
      if (a.flipOf) continue;
      animFrames[name] = [];
      for (let i = 0; i < a.frames; i++) {
        animFrames[name]!.push(frames.length);
        frames.push(placeholderFrame(spec, name, i));
      }
    }
    return spriteDefFromSpec(spec, PLACEHOLDER_PALETTE, frames, animFrames);
  });
}
