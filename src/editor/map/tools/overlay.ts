// Preview drawing shared by the tools: translucent tile ghosts, cell and
// rectangle outlines, all in device pixels through the canvas transform.
import type { AssetCache } from '../../../gfx/imageCache';
import type { CellRect } from '../geometry';
import type { Xf } from '../roomRender';
import { TILE } from '../../../core/constants';
import { dx, dy } from '../roomRender';

/** Device-pixel rect of a tile rect. */
function box(xf: Xf, r: CellRect): { x: number; y: number; w: number; h: number } {
  const x = dx(xf, r.x * TILE);
  const y = dy(xf, r.y * TILE);
  return { x, y, w: dx(xf, (r.x + r.w) * TILE) - x, h: dy(xf, (r.y + r.h) * TILE) - y };
}

/** A tile drawn translucently at a cell (id 0 draws nothing). */
export function ghostTile(g: CanvasRenderingContext2D, xf: Xf, assets: AssetCache, id: number, tx: number, ty: number, alpha = 0.65): void {
  const c = assets.tile(id, 0);
  if (!c) return;
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, dx(xf, tx * TILE), dy(xf, ty * TILE), TILE * xf.s, TILE * xf.s);
  g.globalAlpha = 1;
}

/** Outline around a tile rect; `fill` adds a translucent wash. */
export function outlineCells(g: CanvasRenderingContext2D, xf: Xf, r: CellRect, color: string, fill?: string, dashed = false): void {
  const b = box(xf, r);
  if (fill) {
    g.fillStyle = fill;
    g.fillRect(b.x, b.y, b.w, b.h);
  }
  const lw = Math.max(1, Math.round(xf.dpr));
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.setLineDash([]);
  g.strokeRect(b.x - lw * 0.5, b.y - lw * 0.5, b.w + lw, b.h + lw);
  g.strokeStyle = color;
  if (dashed) g.setLineDash([4 * xf.dpr, 3 * xf.dpr]);
  g.strokeRect(b.x + lw * 0.5, b.y + lw * 0.5, b.w - lw, b.h - lw);
  g.setLineDash([]);
}

/** Highlight of the single cell under the cursor. */
export function hoverCell(g: CanvasRenderingContext2D, xf: Xf, tx: number, ty: number, color = 'rgba(255,255,255,0.9)'): void {
  outlineCells(g, xf, { x: tx, y: ty, w: 1, h: 1 }, color);
}

/** Small "X" marking cells a tool will clear (eraser preview). */
export function crossCell(g: CanvasRenderingContext2D, xf: Xf, tx: number, ty: number): void {
  const b = box(xf, { x: tx, y: ty, w: 1, h: 1 });
  const inset = b.w * 0.25;
  g.strokeStyle = 'rgba(255,90,90,0.95)';
  g.lineWidth = Math.max(1, Math.round(1.5 * xf.dpr));
  g.beginPath();
  g.moveTo(b.x + inset, b.y + inset);
  g.lineTo(b.x + b.w - inset, b.y + b.h - inset);
  g.moveTo(b.x + b.w - inset, b.y + inset);
  g.lineTo(b.x + inset, b.y + b.h - inset);
  g.stroke();
}
