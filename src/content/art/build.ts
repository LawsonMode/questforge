// Builders that turn catalog specs (content/ids.ts) + authored pixels into
// TileDef / SpriteDef records. Shared by all art modules.
import type { Palette, PixelData, SpriteAnim, SpriteDef, TileDef } from '../../core/types';
import { PALETTE_SIZE } from '../../core/constants';
import { T, type SpriteSpec, type TileSpec } from '../ids';

function keyToId(key: string, ctx: string): number {
  const id = T[key];
  if (id === undefined) throw new Error(`${ctx}: unknown tile key "${key}"`);
  return id;
}

/** Palette helper: pads/truncates to 16 colours, lowercases. Index 0 is transparent. */
export function palette(id: string, name: string, colors: string[]): Palette {
  const c = colors.slice(0, PALETTE_SIZE).map((s) => s.toLowerCase());
  while (c.length < PALETTE_SIZE) c.push('#000000');
  return { id, name, colors: c };
}

/** Build a TileDef from its spec (behaviour keys resolved to ids). */
export function tileDefFromSpec(spec: TileSpec, paletteId: string, frames: PixelData[], frameTime?: number): TileDef {
  if (frames.length === 0) throw new Error(`tile ${spec.key}: needs at least one frame`);
  for (const f of frames) {
    if (f.length !== 256) throw new Error(`tile ${spec.key}: frame length ${f.length} != 256`);
  }
  const def: TileDef = {
    id: spec.id,
    key: spec.key,
    name: spec.name,
    palette: paletteId,
    frames,
    collision: spec.collision,
    tags: [...spec.tags],
  };
  if (frames.length > 1) def.frameTime = frameTime ?? 0.25;
  if (spec.solidMask !== undefined) def.solidMask = spec.solidMask;
  if (spec.ledgeDir) def.ledgeDir = spec.ledgeDir;
  if (spec.cut) def.cut = { to: keyToId(spec.cut.to, spec.key), drops: spec.cut.drops };
  if (spec.lift) def.lift = { to: keyToId(spec.lift.to, spec.key), weight: spec.lift.weight, drops: spec.lift.drops };
  if (spec.bomb) def.bomb = { to: keyToId(spec.bomb.to, spec.key) };
  if (spec.dash) def.dash = { to: keyToId(spec.dash.to, spec.key) };
  return def;
}

/**
 * Build a SpriteDef from its spec. `animFrames` maps every NON-flipped anim name
 * in the spec to indices into `frames` (length must equal the spec's frame
 * count). Flipped anims (flipOf) are derived automatically.
 */
export function spriteDefFromSpec(
  spec: SpriteSpec, paletteId: string, frames: PixelData[], animFrames: Record<string, number[]>,
): SpriteDef {
  const need = spec.w * spec.h;
  frames.forEach((f, i) => {
    if (f.length !== need) throw new Error(`sprite ${spec.id}: frame ${i} length ${f.length} != ${need}`);
  });
  const anims: Record<string, SpriteAnim> = {};
  for (const [name, a] of Object.entries(spec.anims)) {
    if (a.flipOf) continue;
    const idx = animFrames[name];
    if (!idx) throw new Error(`sprite ${spec.id}: missing frames for anim "${name}"`);
    if (idx.length !== a.frames) throw new Error(`sprite ${spec.id}: anim "${name}" has ${idx.length} frames, spec needs ${a.frames}`);
    for (const i of idx) if (i < 0 || i >= frames.length) throw new Error(`sprite ${spec.id}: anim "${name}" frame index ${i} out of range`);
    anims[name] = { frames: [...idx], fps: a.fps, loop: a.loop };
  }
  for (const [name, a] of Object.entries(spec.anims)) {
    if (!a.flipOf) continue;
    const src = anims[a.flipOf];
    if (!src) throw new Error(`sprite ${spec.id}: flip source "${a.flipOf}" missing`);
    anims[name] = { ...src, frames: [...src.frames], flipX: true };
  }
  return {
    id: spec.id,
    name: spec.name,
    palette: paletteId,
    w: spec.w,
    h: spec.h,
    ox: spec.ox,
    oy: spec.oy,
    frames,
    anims,
    tags: [...spec.tags],
  };
}

/** Sprite tags handled by sprites-core.ts; everything else (enemy/boss/npc) is sprites-actors.ts. */
export const CORE_SPRITE_TAGS = ['hero', 'fx', 'projectile', 'object', 'pickup', 'item', 'hud', 'editor'];

export function isCoreSprite(spec: SpriteSpec): boolean {
  return spec.tags.some((t) => CORE_SPRITE_TAGS.includes(t));
}
