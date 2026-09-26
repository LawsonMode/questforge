// World rendering for one room: culled tile layers, entity draw order, the
// tall-grass-over-feet overlay, darkness and the debug overlay.
// Order: bg -> fg -> ground entities -> normal entities (y + sortBias) ->
// tall grass over feet -> over layer -> above entities -> darkness.
// OWNER: engine agent.
import type { LayerName } from '../core/types';
import type { Rect } from '../core/math';
import type { DebugFlags, Light, Renderer } from './api';
import type { Entity } from './entity';
import type { ActiveRoom } from './world';
import { TILE } from '../core/constants';

/** Darkness level of dark rooms (1 = pitch black outside lights). */
export const DARK_LEVEL = 0.94;
/** Rows (px) of tall grass redrawn over the feet of entities standing in it. */
const GRASS_BAND = 7;
/** Entities further than this outside the view are not drawn. */
const CULL_MARGIN = 48;

interface TileRange { tx0: number; ty0: number; tx1: number; ty1: number }

export interface SceneOptions {
  /** Extra lights for dark rooms (player lantern), world px. */
  lights?: readonly Light[];
}

/**
 * Scratch lists reused by every drawScene call (drawing is never re-entrant).
 * Emptied after each draw: module-level lists that still held the last frame's
 * entities would keep a closed game (and the editor behind its playtest) alive.
 */
const shownBuf: Entity[] = [];
const normalBuf: Entity[] = [];
const lightBuf: Light[] = [];

function byDepth(a: Entity, b: Entity): number {
  return a.y + a.sortBias - (b.y + b.sortBias) || a.uid - b.uid;
}

/** Tiles of `room` visible with the camera at (camX, camY). */
function visibleTiles(room: ActiveRoom, camX: number, camY: number, viewW: number, viewH: number): TileRange {
  return {
    tx0: Math.max(0, Math.floor(camX / TILE)),
    ty0: Math.max(0, Math.floor(camY / TILE)),
    tx1: Math.min(room.cols - 1, Math.floor((camX + viewW - 1) / TILE)),
    ty1: Math.min(room.rows - 1, Math.floor((camY + viewH - 1) / TILE)),
  };
}

/** Draw one room with its entities, clipped to the room's on-screen rect. */
export function drawScene(
  r: Renderer, room: ActiveRoom, entities: readonly Entity[], camX: number, camY: number, opts: SceneOptions = {},
): void {
  r.camX = camX;
  r.camY = camY;
  const ctx = r.ctx;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(-camX, -camY, room.width, room.height);
    ctx.clip();
    drawRoomContents(r, room, entities, camX, camY, opts);
  } finally {
    ctx.restore();
    shownBuf.length = 0;
    normalBuf.length = 0;
    lightBuf.length = 0;
  }
}

function drawRoomContents(
  r: Renderer, room: ActiveRoom, entities: readonly Entity[], camX: number, camY: number, opts: SceneOptions,
): void {
  const view = visibleTiles(room, camX, camY, r.width, r.height);
  drawLayer(r, room, 'bg', view);
  drawLayer(r, room, 'fg', view);
  shownBuf.length = 0;
  normalBuf.length = 0;
  for (const e of entities) {
    if (!e.visible || !inView(e, camX, camY, r.width, r.height)) continue;
    shownBuf.push(e);
    if (e.drawLayer === 'normal') normalBuf.push(e);
  }
  for (const e of shownBuf) if (e.drawLayer === 'ground') e.draw(r);
  normalBuf.sort(byDepth);
  for (const e of normalBuf) {
    e.draw(r);
    drawGrassOverFeet(r, room, e);
  }
  drawLayer(r, room, 'over', view);
  for (const e of shownBuf) if (e.drawLayer === 'above') e.draw(r);
  if (room.def.dark) r.darkness(DARK_LEVEL, collectLights(opts.lights, entities));
}

function drawLayer(r: Renderer, room: ActiveRoom, layer: LayerName, v: TileRange): void {
  for (let ty = v.ty0; ty <= v.ty1; ty++) {
    for (let tx = v.tx0; tx <= v.tx1; tx++) {
      const id = room.tile(layer, tx, ty);
      if (id !== 0) r.drawTile(id, tx * TILE, ty * TILE);
    }
  }
}

function inView(e: Entity, camX: number, camY: number, w: number, h: number): boolean {
  return e.x > camX - CULL_MARGIN && e.x < camX + w + CULL_MARGIN
    && e.y > camY - CULL_MARGIN && e.y < camY + h + CULL_MARGIN;
}

/** `extra` lights plus one per live entity with light > 0 (into the shared scratch list). */
function collectLights(extra: readonly Light[] | undefined, entities: readonly Entity[]): Light[] {
  lightBuf.length = 0;
  if (extra) for (const l of extra) lightBuf.push(l);
  for (const e of entities) if (e.light > 0 && !e.dead) lightBuf.push({ x: e.x, y: e.y - e.z, r: e.light });
  return lightBuf;
}

/** Whether an entity's feet are in tall grass (walkers & the player on the ground). */
function feetInTallGrass(room: ActiveRoom, e: Entity): boolean {
  if (!e.visible || e.z > 1 || (e.mover !== 'player' && e.mover !== 'walker')) return false;
  return room.collisionAt(e.x, e.y + e.h / 2 - 2) === 'tallgrass';
}

/** Redraw the tall-grass tiles' lower band over an entity standing in them so its feet disappear. */
function drawGrassOverFeet(r: Renderer, room: ActiveRoom, e: Entity): void {
  if (!feetInTallGrass(room, e)) return;
  const feet = Math.round(e.y + e.h / 2);
  const band: Rect = { x: Math.round(e.x) - TILE / 2, y: feet - GRASS_BAND, w: TILE, h: GRASS_BAND + 1 };
  const ctx = r.ctx;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(band.x - r.camX, band.y - r.camY, band.w, band.h);
    ctx.clip();
    const tx0 = Math.floor(band.x / TILE);
    const tx1 = Math.floor((band.x + band.w - 1) / TILE);
    const ty0 = Math.floor(band.y / TILE);
    const ty1 = Math.floor((band.y + band.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = grassTileAt(room, tx, ty);
        if (id !== 0) r.drawTile(id, tx * TILE, ty * TILE);
      }
    }
  } finally {
    ctx.restore();
  }
}

/** The tall-grass tile id at a cell (fg first, then bg), or 0. */
function grassTileAt(room: ActiveRoom, tx: number, ty: number): number {
  for (const layer of ['fg', 'bg'] as const) {
    const id = room.tile(layer, tx, ty);
    if (id !== 0) return room.tileDef(id)?.collision === 'tallgrass' ? id : 0;
  }
  return 0;
}

/** Hitboxes (entities cyan, enemies red, sword yellow) in world space; fps bottom-right; active cheats bottom-left. */
export function drawDebugOverlay(
  r: Renderer, entities: readonly Entity[], sword: Rect | null, flags: DebugFlags, fps: number,
): void {
  if (flags.hitboxes) {
    for (const e of entities) {
      const hb = e.hitbox();
      r.strokeRect(Math.round(hb.x), Math.round(hb.y - e.z), hb.w, hb.h, e.team === 'enemy' ? '#ff4040' : '#40e0ff');
    }
    if (sword) r.strokeRect(Math.round(sword.x), Math.round(sword.y), sword.w, sword.h, '#ffe040');
  }
  const tags = [flags.invincible ? 'INV' : '', flags.noclip ? 'NOCLIP' : ''].filter(Boolean).join(' ');
  if (flags.fps) r.drawText(`${Math.round(fps)} FPS`, r.width - 4, r.height - 10, { align: 'right', color: '#80ff80' });
  if (tags) r.drawText(tags, 4, r.height - 10, { color: '#ffe040' });
}
