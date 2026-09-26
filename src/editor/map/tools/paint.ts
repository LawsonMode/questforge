// Tile painting tools: pencil & eraser (continuous strokes, Shift+click draws a
// line from the last stroke), rectangle (filled; Shift = outline), fill (flood
// on the active layer; Shift = replace every matching tile) and the eyedropper.
// Esc during a stroke reverts it; hidden layers are never painted.
import type { LayerName, Room } from '../../../core/types';
import type { Cell } from '../geometry';
import type { TileEdit } from '../tileEdit';
import type { Xf } from '../roomRender';
import type { Pointer, Tool, ToolHost } from './tool';
import type { ToolId } from '../mapState';
import { roomCols, roomRows } from '../../../core/project';
import { BRUSH_TOOLS } from '../mapState';
import { clipRect, floodRegion, rectBetween, rectCells, strokeCells } from '../geometry';
import { crossCell, ghostTile, hoverCell, outlineCells } from './overlay';

const LAYER_LABEL: Readonly<Record<LayerName, string>> = { bg: 'ground', fg: 'objects', over: 'overhead' };

/** Human name of a layer for hints and messages. */
export function layerLabel(layer: LayerName): string {
  return LAYER_LABEL[layer];
}

function inRoom(room: Room | null, tx: number, ty: number): boolean {
  return !!room && tx >= 0 && ty >= 0 && tx < roomCols(room) && ty < roomRows(room);
}

/** Cursor of a tool that writes `layer`: a crosshair, or not-allowed while that layer is hidden. */
export function paintCursor(host: ToolHost, layer: LayerName): string {
  return host.visible(layer) ? 'crosshair' : 'not-allowed';
}

/** Whether to preview a brush at the hovered cell: inside the room, on a visible layer. */
export function canPreview(host: ToolHost, hover: Pointer | null, layer: LayerName): hover is Pointer {
  return !!hover && host.visible(layer) && inRoom(host.room(), hover.tx, hover.ty);
}

// ---------------------------------------------------------------- pencil / eraser

/** Continuous stroke of the brush tile (pencil) or of 0 (eraser) on the active layer. */
export class StrokeTool implements Tool {
  private edit: TileEdit | null = null;
  private last: Cell | null = null;
  /** End of the previous stroke, for Shift+click lines. */
  private anchor: { roomId: string; cell: Cell } | null = null;

  constructor(readonly id: 'pencil' | 'eraser') {}

  cursor(host: ToolHost): string {
    return paintCursor(host, host.ctx.layer);
  }

  hint(host: ToolHost): string {
    const layer = layerLabel(host.ctx.layer);
    return this.id === 'pencil'
      ? `Pencil — drag to paint on the ${layer} layer · Shift+click draws a line · Alt+click picks a tile`
      : `Eraser — drag to clear tiles on the ${layer} layer · Shift+click erases a line`;
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0 || !host.canEdit(host.ctx.layer)) return;
    const room = host.room();
    const edit = host.beginTiles();
    if (!room || !edit) return;
    this.edit = edit;
    const anchor = this.anchor?.roomId === room.id ? this.anchor.cell : null;
    this.last = p.shift && anchor ? anchor : null;
    if (this.id === 'eraser' && host.ctx.layer === 'bg') {
      host.flash('Erasing the ground layer leaves void — black and solid in the game. Paint a floor tile instead to clear objects.', 'warn');
    }
    this.paint(p, host);
  }

  move(p: Pointer, host: ToolHost, dragging: boolean): void {
    if (dragging && this.edit) this.paint(p, host);
    else host.redraw();
  }

  up(_p: Pointer, host: ToolHost): void {
    const edit = this.edit;
    if (!edit) return;
    this.edit = null;
    if (this.last) this.anchor = { roomId: edit.room.id, cell: this.last };
    host.commitTiles(edit, this.id === 'pencil' ? 'Paint tiles' : 'Erase tiles');
  }

  cancel(host: ToolHost): void {
    const edit = this.edit;
    this.edit = null;
    if (edit) host.commitTiles(edit, this.id === 'pencil' ? 'Paint tiles' : 'Erase tiles');
  }

  abort(host: ToolHost): void {
    this.edit?.revert();
    this.edit = null;
    this.last = null;
    host.redraw();
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    if (this.edit || !canPreview(host, hover, host.ctx.layer)) return;
    if (this.id === 'pencil') ghostTile(g, xf, host.ctx.assets, host.ctx.tile, hover.tx, hover.ty);
    else crossCell(g, xf, hover.tx, hover.ty);
    hoverCell(g, xf, hover.tx, hover.ty);
  }

  private paint(p: Pointer, host: ToolHost): void {
    const edit = this.edit!;
    const id = this.id === 'pencil' ? host.ctx.tile : 0;
    const cur = { tx: p.tx, ty: p.ty };
    for (const c of strokeCells(this.last, cur)) edit.set(host.ctx.layer, c.tx, c.ty, id);
    this.last = cur;
    host.redraw();
  }
}

// ---------------------------------------------------------------- rectangle

/** Drag a rectangle; releases fill it with the brush tile (Shift: outline only). */
export class RectTool implements Tool {
  readonly id = 'rect' as const;
  private start: Cell | null = null;
  private end: Cell | null = null;
  private outline = false;

  cursor(host: ToolHost): string {
    return paintCursor(host, host.ctx.layer);
  }

  hint(host: ToolHost): string {
    return `Rectangle — drag to fill an area on the ${layerLabel(host.ctx.layer)} layer · hold Shift for an outline`;
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0 || !host.room() || !host.canEdit(host.ctx.layer)) return;
    this.start = { tx: p.tx, ty: p.ty };
    this.end = this.start;
    this.outline = p.shift;
    host.redraw();
  }

  move(p: Pointer, host: ToolHost, dragging: boolean): void {
    if (dragging && this.start) {
      this.end = { tx: p.tx, ty: p.ty };
      this.outline = p.shift;
    }
    host.redraw();
  }

  up(_p: Pointer, host: ToolHost): void {
    const rect = this.currentRect(host);
    this.start = this.end = null;
    if (!rect) {
      host.redraw();
      return;
    }
    const edit = host.beginTiles();
    if (!edit) return;
    for (const c of rectCells(rect, this.outline)) edit.set(host.ctx.layer, c.tx, c.ty, host.ctx.tile);
    host.commitTiles(edit, this.outline ? 'Draw outline' : 'Fill rectangle');
  }

  cancel(host: ToolHost): void {
    this.start = this.end = null;
    host.redraw();
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    const rect = this.currentRect(host);
    if (rect) {
      for (const c of rectCells(rect, this.outline)) ghostTile(g, xf, host.ctx.assets, host.ctx.tile, c.tx, c.ty, 0.7);
      outlineCells(g, xf, rect, '#f0c040');
      return;
    }
    if (canPreview(host, hover, host.ctx.layer)) {
      ghostTile(g, xf, host.ctx.assets, host.ctx.tile, hover.tx, hover.ty);
      hoverCell(g, xf, hover.tx, hover.ty);
    }
  }

  private currentRect(host: ToolHost): ReturnType<typeof clipRect> {
    const room = host.room();
    if (!this.start || !this.end || !room) return null;
    return clipRect(rectBetween(this.start, this.end), roomCols(room), roomRows(room));
  }
}

// ---------------------------------------------------------------- fill

/** Row-major indices a fill at (tx, ty) replaces: the 4-connected region, or (global) every equal id. */
export function fillIndices(data: readonly number[], cols: number, rows: number, tx: number, ty: number, global: boolean): number[] {
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return [];
  if (!global) return floodRegion(data, cols, rows, tx, ty);
  const target = data[ty * cols + tx];
  const out: number[] = [];
  data.forEach((id, i) => {
    if (id === target) out.push(i);
  });
  return out;
}

/** Flood-fill the clicked region of the active layer with the brush tile. */
export class FillTool implements Tool {
  readonly id = 'fill' as const;

  cursor(host: ToolHost): string {
    return paintCursor(host, host.ctx.layer);
  }

  hint(host: ToolHost): string {
    return `Fill — click to flood an area of the ${layerLabel(host.ctx.layer)} layer · Shift+click replaces that tile everywhere in the room`;
  }

  down(p: Pointer, host: ToolHost): void {
    const layer = host.ctx.layer;
    if (p.button !== 0 || !host.canEdit(layer)) return;
    const edit = host.beginTiles();
    if (!edit) return;
    const indices = fillIndices(edit.room.layers[layer], edit.cols, edit.rows, p.tx, p.ty, p.shift);
    for (const i of indices) edit.set(layer, i % edit.cols, Math.floor(i / edit.cols), host.ctx.tile);
    host.commitTiles(edit, p.shift ? 'Replace tiles' : 'Fill area');
  }

  move(_p: Pointer, host: ToolHost): void {
    host.redraw();
  }

  up(): void {
    // Fill acts on press.
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    if (!canPreview(host, hover, host.ctx.layer)) return;
    ghostTile(g, xf, host.ctx.assets, host.ctx.tile, hover.tx, hover.ty);
    hoverCell(g, xf, hover.tx, hover.ty, '#f0c040');
  }
}

// ---------------------------------------------------------------- eyedropper

/** Top-most non-zero tile at a cell among the given layers (over -> fg -> bg). */
export function topTile(room: Room, tx: number, ty: number, layers: readonly LayerName[]): { layer: LayerName; id: number } | null {
  if (!inRoom(room, tx, ty)) return null;
  const i = ty * roomCols(room) + tx;
  for (const layer of ['over', 'fg', 'bg'] as const) {
    if (!layers.includes(layer)) continue;
    const id = room.layers[layer][i] ?? 0;
    if (id !== 0) return { layer, id };
  }
  return null;
}

/** Pick the tile under the cursor as the brush and switch to its layer. Returns whether a tile was found. */
export function pickTile(p: Pointer, host: ToolHost): boolean {
  const room = host.room();
  if (!room) return false;
  const layers = (['bg', 'fg', 'over'] as const).filter((l) => host.visible(l));
  const hit = topTile(room, p.tx, p.ty, layers);
  if (!hit) {
    host.flash('No tile here to pick.');
    return false;
  }
  host.ctx.selectTile(hit.id);
  host.ctx.selectLayer(hit.layer);
  const def = host.ctx.assets.tileDef(hit.id);
  host.flash(`Picked ${def?.name ?? `tile ${hit.id}`} from the ${layerLabel(hit.layer)} layer.`);
  return true;
}

/** Alt+click / "Pick this tile": take the tile as the brush, switching to the pencil unless a brush tool is active. */
export function pickBrush(p: Pointer, host: ToolHost): void {
  if (pickTile(p, host) && !BRUSH_TOOLS.includes(host.state.tool)) host.state.setTool('pencil');
}

/** Click to pick a tile; then returns to the brush tool used before. */
export class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;

  cursor(): string {
    return 'copy';
  }

  hint(): string {
    return 'Eyedropper — click a tile to use it as the brush (also Alt+click with any tile tool)';
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0 || !pickTile(p, host)) return;
    const back: ToolId = BRUSH_TOOLS.includes(host.state.previousTool) ? host.state.previousTool : 'pencil';
    host.state.setTool(back);
  }

  move(_p: Pointer, host: ToolHost): void {
    host.redraw();
  }

  up(): void {
    // Picking happens on press.
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    if (hover && inRoom(host.room(), hover.tx, hover.ty)) hoverCell(g, xf, hover.tx, hover.ty, '#5fd0ff');
  }
}
