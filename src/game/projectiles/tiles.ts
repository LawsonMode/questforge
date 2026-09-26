// Tile behaviours triggered by the hero's attacks: cutting (sword, spin, dash,
// bomb blasts), dash-breaking and bomb-opening, plus the wall probe the attacks
// share. Cuts are not persisted (bushes and grass grow back on re-entry,
// ALttP-style); dash and bomb changes are. Past the room's edge is open air for
// the hero's attacks (it may be the next screen), never a wall.
import type { Rect } from '../../core/math';
import { TILE } from '../../core/constants';
import type { GameServices, RoomRuntime } from '../api';
import { circleHitsRect } from './targets';

export interface Cell {
  tx: number;
  ty: number;
}

/** Tile cells a half-open rect overlaps. */
export function cellsIn(rect: Rect): Cell[] {
  if (rect.w <= 0 || rect.h <= 0) return [];
  const out: Cell[] = [];
  const tx1 = Math.ceil((rect.x + rect.w) / TILE) - 1;
  const ty1 = Math.ceil((rect.y + rect.h) / TILE) - 1;
  for (let ty = Math.floor(rect.y / TILE); ty <= ty1; ty++) {
    for (let tx = Math.floor(rect.x / TILE); tx <= tx1; tx++) out.push({ tx, ty });
  }
  return out;
}

/** Tile cells a circle touches. */
export function cellsInCircle(cx: number, cy: number, r: number): Cell[] {
  return cellsIn({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r })
    .filter((c) => circleHitsRect(cx, cy, r, { x: c.tx * TILE, y: c.ty * TILE, w: TILE, h: TILE }));
}

/** Centre of a tile cell in room px. */
export function cellCentre(c: Cell): { x: number; y: number } {
  return { x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2 };
}

/** `rect` clipped to the room's area (into `out`), or null when it lies wholly outside. */
export function clipToRoom(room: RoomRuntime, rect: Rect, out: Rect): Rect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(room.width, rect.x + rect.w);
  const y1 = Math.min(room.height, rect.y + rect.h);
  if (x1 <= x0 || y1 <= y0) return null;
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return out;
}

/** How much of `rect` lies outside the room. */
export function outsideRoom(room: RoomRuntime, rect: Rect): 'none' | 'part' | 'all' {
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  if (x1 <= 0 || y1 <= 0 || rect.x >= room.width || rect.y >= room.height) return 'all';
  return rect.x < 0 || rect.y < 0 || x1 > room.width || y1 > room.height ? 'part' : 'none';
}

const clipBuf: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Whether a wall ('solid' collision) inside the room lies under `rect`; outside the room is open air. */
export function wallIn(game: GameServices, rect: Rect): boolean {
  const inside = clipToRoom(game.room, rect, clipBuf);
  return inside !== null && game.room.blocked(inside, 'projectile');
}

/** Cut the tile at (tx, ty) if it has a cut behaviour: tile -> cut.to, leaves, optional loot. Returns true if cut. */
export function cutTileAt(game: GameServices, tx: number, ty: number): boolean {
  const hit = game.room.interactiveTile(tx, ty);
  const cut = hit?.def.cut;
  if (!hit || !cut) return false;
  game.room.setTile(hit.layer, tx, ty, cut.to);
  const px = tx * TILE + TILE / 2;
  const py = ty * TILE + TILE / 2;
  game.effect('fx.leaves', 'play', px, py);
  if (cut.drops) game.dropLoot(px, py, 'random');
  return true;
}

/** Cut every cuttable tile under `rect` (one 'cut' sound). Returns how many were cut. */
export function cutTilesIn(game: GameServices, rect: Rect): number {
  if (rect.w <= 0 || rect.h <= 0) return 0;
  const tx0 = Math.floor(rect.x / TILE);
  const ty0 = Math.floor(rect.y / TILE);
  const tx1 = Math.ceil((rect.x + rect.w) / TILE) - 1;
  const ty1 = Math.ceil((rect.y + rect.h) / TILE) - 1;
  let n = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) if (cutTileAt(game, tx, ty)) n++;
  }
  if (n > 0) game.audio.sfx('cut');
  return n;
}

/** Break the tile at (tx, ty) if it has a dash behaviour (persistently). Returns true if it broke. */
export function dashBreakAt(game: GameServices, tx: number, ty: number): boolean {
  const hit = game.room.interactiveTile(tx, ty);
  const dash = hit?.def.dash;
  if (!hit || !dash) return false;
  game.room.setTile(hit.layer, tx, ty, dash.to, true);
  game.effect(hit.def.cut ? 'fx.leaves' : 'fx.shatter', 'play', tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  game.audio.sfx('shatter');
  return true;
}

/** Open the tile at (tx, ty) if it has a bomb behaviour (persistently). Returns true if it changed. */
export function bombOpenAt(game: GameServices, tx: number, ty: number): boolean {
  const hit = game.room.interactiveTile(tx, ty);
  const bomb = hit?.def.bomb;
  if (!hit || !bomb) return false;
  game.room.setTile(hit.layer, tx, ty, bomb.to, true);
  return true;
}
