// Asset usage scanning for the art editor (pure, unit-tested in node): which
// rooms, terrains, behaviours, triggers, entity icons and palette swaps refer
// to a tile / sprite / palette, and whether an asset may be deleted.
import type { Project, SpriteDef, TileDef } from '../../core/types';
import { ENTITY_TYPES } from '../../core/catalog';
import { SPRITE_SPECS, TILE_SPECS, VARIANT_PALETTES, spriteSpec } from '../../content/ids';
import { TERRAIN_PIECES } from '../../gfx/artCheck';

const DEFAULT_TILE_IDS = new Set(TILE_SPECS.map((s) => s.id));
const BEHAVIOURS = ['cut', 'lift', 'bomb', 'dash'] as const;

/** Built-in tile (fixed id referenced by content and code): editable, never deletable, key read-only. */
export function isDefaultTile(id: number): boolean {
  return DEFAULT_TILE_IDS.has(id);
}

/** Built-in sprite the engine draws by id: editable, never deletable, size locked. */
export function isDefaultSprite(id: string): boolean {
  return spriteSpec(id) !== undefined;
}

/** Human-readable places that use a tile (empty = unused). */
export function tileUsage(p: Project, id: number): string[] {
  const out: string[] = [];
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      let cells = 0;
      for (const layer of Object.values(room.layers)) for (const v of layer) if (v === id) cells++;
      if (cells) out.push(`${world.name} / ${room.name}: ${cells} cell${cells === 1 ? '' : 's'}`);
      for (const tr of room.triggers) {
        if (tr.actions.some((a) => a.kind === 'setTile' && a.tile === id)) out.push(`Trigger "${tr.name}" (${room.name}) sets it`);
      }
    }
  }
  for (const terrain of p.terrains) {
    const pieces = TERRAIN_PIECES.filter((k) => terrain[k] === id);
    if (pieces.length) out.push(`Terrain "${terrain.name}": ${pieces.join(', ')}`);
  }
  for (const t of p.tiles) {
    if (t.id === id) continue;
    const via = BEHAVIOURS.filter((b) => t[b]?.to === id);
    if (via.length) out.push(`Tile ${t.key} becomes it (${via.join(', ')})`);
  }
  return out;
}

/** Human-readable places that use a sprite (empty = unused). */
export function spriteUsage(p: Project, id: string): string[] {
  const out: string[] = [];
  if (isDefaultSprite(id)) out.push('Built-in sprite drawn by the engine');
  for (const info of ENTITY_TYPES) if (info.icon.sprite === id) out.push(`Entity icon: ${info.name}`);
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      const n = room.entities.filter((e) => Object.values(e.props).some((v) => v === id)).length;
      if (n) out.push(`${world.name} / ${room.name}: ${n} entit${n === 1 ? 'y' : 'ies'}`);
    }
  }
  return out;
}

/** Assets drawn with a palette plus the engine palette-swap references to it. */
export interface PaletteUsage {
  tiles: TileDef[];
  sprites: SpriteDef[];
  /** Palette-swap roles (variant colours, sword/boomerang levels, entity icons). */
  refs: string[];
}

export function paletteUsage(p: Project, id: string): PaletteUsage {
  const refs: string[] = [];
  for (const [sprite, variants] of Object.entries(VARIANT_PALETTES)) {
    for (const [variant, pal] of Object.entries(variants)) if (pal === id) refs.push(`${sprite} variant "${variant}"`);
  }
  for (const spec of SPRITE_SPECS) {
    if (spec.swaps?.includes(id) && !refs.some((r) => r.startsWith(`${spec.id} `))) refs.push(`${spec.id} palette swap`);
  }
  for (const info of ENTITY_TYPES) if (info.icon.palette === id) refs.push(`Entity icon: ${info.name}`);
  return {
    tiles: p.tiles.filter((t) => t.palette === id),
    sprites: p.sprites.filter((s) => s.palette === id),
    refs,
  };
}

/** Why an asset cannot be deleted, or null if it can. */
export function tileDeleteBlocker(p: Project, id: number): string | null {
  if (isDefaultTile(id)) return 'Built-in tiles can be edited but not deleted.';
  const uses = tileUsage(p, id);
  return uses.length ? `Still in use:\n${uses.join('\n')}` : null;
}

export function spriteDeleteBlocker(p: Project, id: string): string | null {
  if (isDefaultSprite(id)) return 'Built-in sprites can be edited but not deleted.';
  const uses = spriteUsage(p, id);
  return uses.length ? `Still in use:\n${uses.join('\n')}` : null;
}

export function paletteDeleteBlocker(p: Project, id: string): string | null {
  const u = paletteUsage(p, id);
  const lines = [
    ...u.tiles.map((t) => `Tile ${t.key}`),
    ...u.sprites.map((s) => `Sprite ${s.id}`),
    ...u.refs,
  ];
  if (!lines.length) return null;
  const shown = lines.slice(0, 12);
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`);
  return `Still in use:\n${shown.join('\n')}`;
}
