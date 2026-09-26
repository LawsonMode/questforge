// Lifted tiles (bushes, rocks, pots) have their ground baked into the art. When
// one is carried overhead or thrown, only the object should show: pixels that
// match the tile it leaves behind (lift.to) at the same spot are masked out.
// Images are built once per project + tile and drawn straight to the backbuffer.
import type { Palette, PixelData, Project, TileDef } from '../../core/types';
import type { Renderer } from '../api';
import { TILE } from '../../core/constants';
import { tileIndex } from '../world';

const cache = new WeakMap<Project, Map<number, HTMLCanvasElement | null>>();

/** Colour of every pixel of a frame ('' = transparent). */
function frameColors(frame: PixelData | undefined, palette: Palette | undefined): string[] {
  const out: string[] = [];
  for (let i = 0; i < TILE * TILE; i++) {
    const idx = frame ? parseInt(frame[i] ?? '0', 16) : 0;
    out.push(idx > 0 && palette ? palette.colors[idx] ?? '' : '');
  }
  return out;
}

/**
 * Which pixels of `tile` show once the ground it stands on (`ground`) is removed:
 * the tile's colour where it differs from the ground's, '' where they match.
 */
export function objectPixels(project: Pick<Project, 'palettes'>, tile: TileDef, ground: TileDef | undefined): string[] {
  const pal = (id: string): Palette | undefined => project.palettes.find((p) => p.id === id);
  const own = frameColors(tile.frames[0], pal(tile.palette));
  if (!ground) return own;
  const under = frameColors(ground.frames[0], pal(ground.palette));
  return own.map((c, i) => (c === under[i] ? '' : c));
}

function buildImage(project: Project, id: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const defs = tileIndex(project.tiles);
  const tile = defs.get(id);
  if (!tile) return null;
  const ground = tile.lift ? defs.get(tile.lift.to) : undefined;
  const pixels = objectPixels(project, tile, ground);
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  pixels.forEach((c, i) => {
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(i % TILE, Math.floor(i / TILE), 1, 1);
  });
  return canvas;
}

function liftedImage(project: Project, id: number): HTMLCanvasElement | null {
  let m = cache.get(project);
  if (!m) {
    m = new Map();
    cache.set(project, m);
  }
  if (!m.has(id)) m.set(id, buildImage(project, id));
  return m.get(id) ?? null;
}

/** Draw a lifted tile's object pixels centred at world (x, y); falls back to the plain tile. */
export function drawLiftedTile(r: Renderer, project: Project, id: number, x: number, y: number): void {
  const img = liftedImage(project, id);
  const left = Math.round(x) - TILE / 2;
  const top = Math.round(y) - TILE / 2;
  if (!img) {
    r.drawTile(id, left, top);
    return;
  }
  r.ctx.drawImage(img, left - Math.round(r.camX), top - Math.round(r.camY));
}
