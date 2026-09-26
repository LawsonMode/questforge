// Room thumbnails for the world overview: each room drawn from its actual tiles
// (frame 0, all layers) at THUMB_TILE px per tile with smoothing. A thumbnail
// remembers the ids it drew, so get() only repaints cells that changed; call
// forget(ids) when some tiles' art changed, prune(ids) when rooms were deleted
// (their thumbnails go; an undone delete simply rebuilds one) and invalidate()
// for a new project.
import type { LayerName, Room } from '../../core/types';
import type { AssetCache } from '../../gfx/imageCache';
import { LAYERS } from '../../core/types';
import { roomCols, roomRows } from '../../core/project';

/** Thumbnail pixels per tile. */
export const THUMB_TILE = 4;

interface Thumb {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  cols: number;
  rows: number;
  /** Tile ids drawn per layer. */
  drawn: Record<LayerName, Int32Array>;
}

export class ThumbCache {
  private readonly thumbs = new Map<string, Thumb>();

  constructor(private readonly assets: AssetCache) {}

  /** Up-to-date thumbnail of a room (built when missing, invalidated or resized; changed cells repainted). */
  get(room: Room): HTMLCanvasElement {
    const cols = roomCols(room);
    const rows = roomRows(room);
    let thumb = this.thumbs.get(room.id);
    if (!thumb || thumb.cols !== cols || thumb.rows !== rows) {
      thumb = this.create(cols, rows);
      this.thumbs.set(room.id, thumb);
    }
    const { bg, fg, over } = room.layers;
    const d = thumb.drawn;
    for (let i = 0; i < cols * rows; i++) {
      if ((bg[i] ?? 0) !== d.bg[i] || (fg[i] ?? 0) !== d.fg[i] || (over[i] ?? 0) !== d.over[i]) this.paintCell(thumb, room, i);
    }
    return thumb.canvas;
  }

  /** Number of thumbnails held. */
  get size(): number {
    return this.thumbs.size;
  }

  /** Drop the thumbnails of rooms that no longer exist (not in `liveIds`). */
  prune(liveIds: ReadonlySet<string>): void {
    for (const id of this.thumbs.keys()) if (!liveIds.has(id)) this.thumbs.delete(id);
  }

  /** Forget every thumbnail (the whole project or all tile art changed). */
  invalidate(): void {
    this.thumbs.clear();
  }

  /** Repaint, on their next get(), only the cells showing one of these tiles (their art changed). */
  forget(tileIds: readonly number[]): void {
    if (tileIds.length === 0) return;
    const ids = new Set(tileIds);
    for (const thumb of this.thumbs.values()) {
      for (const layer of LAYERS) {
        const d = thumb.drawn[layer];
        for (let i = 0; i < d.length; i++) if (ids.has(d[i]!)) d[i] = -1;
      }
    }
  }

  private create(cols: number, rows: number): Thumb {
    const canvas = document.createElement('canvas');
    canvas.width = cols * THUMB_TILE;
    canvas.height = rows * THUMB_TILE;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';
    // -1 never matches a tile id, so the first get() paints every cell.
    const blank = (): Int32Array => new Int32Array(cols * rows).fill(-1);
    return { canvas, g, cols, rows, drawn: { bg: blank(), fg: blank(), over: blank() } };
  }

  private paintCell(thumb: Thumb, room: Room, i: number): void {
    const x = (i % thumb.cols) * THUMB_TILE;
    const y = Math.floor(i / thumb.cols) * THUMB_TILE;
    thumb.g.fillStyle = '#000';
    thumb.g.fillRect(x, y, THUMB_TILE, THUMB_TILE);
    for (const layer of LAYERS) {
      const id = room.layers[layer][i] ?? 0;
      thumb.drawn[layer][i] = id;
      const c = this.assets.tile(id, 0);
      if (c) thumb.g.drawImage(c, x, y, THUMB_TILE, THUMB_TILE);
    }
  }
}
