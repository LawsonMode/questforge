// Small previews of a project's rooms for the menu cards and the project tab:
// one 256x224 screen with its tiles, placed entities and the hero at the start.
import type { Dir, Project, Room } from '../core/types';
import type { AssetCache } from '../gfx/imageCache';
import { SCREEN_COLS, SCREEN_H, SCREEN_ROWS, SCREEN_W, TILE } from '../core/constants';
import { clamp } from '../core/math';
import { entityInfo, propOf } from '../core/catalog';
import { findRoom, roomCols } from '../core/project';

/** Which screen of a room contains the room-local point (x, y). */
export function screenAt(room: Room, x: number, y: number): { col: number; row: number } {
  return {
    col: clamp(Math.floor(x / SCREEN_W), 0, room.gw - 1),
    row: clamp(Math.floor(y / SCREEN_H), 0, room.gh - 1),
  };
}

function drawLayer(ctx: CanvasRenderingContext2D, assets: AssetCache, room: Room, layer: 'bg' | 'fg' | 'over', col: number, row: number): void {
  const cols = roomCols(room);
  const data = room.layers[layer];
  for (let ty = 0; ty < SCREEN_ROWS; ty++) {
    for (let tx = 0; tx < SCREEN_COLS; tx++) {
      const id = data[(row * SCREEN_ROWS + ty) * cols + col * SCREEN_COLS + tx] ?? 0;
      if (id !== 0) assets.drawTileTo(ctx, id, tx * TILE, ty * TILE);
    }
  }
}

function drawEntities(ctx: CanvasRenderingContext2D, assets: AssetCache, room: Room, ox: number, oy: number): void {
  const visible = room.entities
    .filter((e) => e.x >= ox && e.x < ox + SCREEN_W && e.y >= oy && e.y < oy + SCREEN_H)
    .filter((e) => propOf<boolean>(e, 'hidden', false) !== true)
    .sort((a, b) => a.y - b.y);
  for (const e of visible) {
    const info = entityInfo(e.type);
    if (!info || info.category === 'marker') continue;
    const sprite = e.type === 'npc.person' ? String(propOf(e, 'sprite', info.icon.sprite)) : info.icon.sprite;
    const anim = sprite === info.icon.sprite ? info.icon.anim : 'idle_down';
    const frame = Math.max(0, assets.animFrame(sprite, anim, 0));
    assets.drawSpriteAt(ctx, sprite, frame, e.x - ox, e.y - oy, 1, { palette: info.icon.palette });
  }
}

/** Where (room-local px) and which way the hero stands in a preview. */
export interface HeroMark {
  x: number;
  y: number;
  dir?: Dir;
}

/**
 * Draw the screen of `room` that contains (fx, fy) into a 256x224 context;
 * `hero` places the hero sprite (facing hero.dir) at that room-local point.
 */
export function drawRoomScreen(
  ctx: CanvasRenderingContext2D, assets: AssetCache, room: Room, fx: number, fy: number, hero?: HeroMark,
): void {
  const { col, row } = screenAt(room, fx, fy);
  const ox = col * SCREEN_W;
  const oy = row * SCREEN_H;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawLayer(ctx, assets, room, 'bg', col, row);
  drawLayer(ctx, assets, room, 'fg', col, row);
  drawEntities(ctx, assets, room, ox, oy);
  if (hero) {
    const anim = `idle_${hero.dir ?? 'down'}`;
    const frame = Math.max(0, assets.animFrame('hero', anim, 0));
    assets.drawSpriteAt(ctx, 'hero', frame, hero.x - ox, hero.y - oy, 1, { flipX: assets.anim('hero', anim)?.flipX });
  }
  drawLayer(ctx, assets, room, 'over', col, row);
}

/**
 * What paintStartScreen drew: the start screen with the hero, the first room
 * instead (the start room is missing), or nothing (the project has no rooms).
 */
export type StartPaint = 'exact' | 'fallback' | 'none';

/** Paint the project's start screen (with the hero) into `canvas` (resized to 256x224). */
export function paintStartScreen(canvas: HTMLCanvasElement, project: Project, assets: AssetCache): StartPaint {
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d');
  const s = project.start;
  const start = findRoom(project, s.world, s.room);
  const room = start ?? project.worlds.find((w) => w.rooms.length)?.rooms[0];
  if (!ctx || !room) return 'none';
  if (!start) {
    drawRoomScreen(ctx, assets, room, SCREEN_W / 2, SCREEN_H / 2);
    return 'fallback';
  }
  drawRoomScreen(ctx, assets, room, s.x, s.y, { x: s.x, y: s.y, dir: s.dir });
  return 'exact';
}
