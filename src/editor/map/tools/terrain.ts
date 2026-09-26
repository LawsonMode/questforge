// Terrain brush: paints the selected autotile terrain (ctx.terrainId) with
// continuous strokes; right-drag erases it back to the room's surrounding floor.
// Borders of every other terrain around the painted cells are re-resolved in
// the same undo step; Esc during a stroke reverts it.
import type { Room, Terrain } from '../../../core/types';
import type { Cell } from '../geometry';
import type { TileEdit } from '../tileEdit';
import type { Xf } from '../roomRender';
import type { Pointer, Tool, ToolHost } from './tool';
import { isTerrainTile, paintTerrain, resolveTerrainsAround } from '../../../core/autotile';
import { dominantTile, strokeCells } from '../geometry';
import { ghostTile, hoverCell } from './overlay';
import { canPreview, paintCursor } from './paint';

/** Tile an erased terrain cell becomes: the most common non-terrain tile of its layer (0 on fg/over or if none). */
export function terrainEraseTo(room: Room, terrain: Terrain, terrains: readonly Terrain[]): number {
  if (terrain.layer !== 'bg') return 0;
  return dominantTile(room.layers.bg, (id) => id === 0 || terrains.some((t) => isTerrainTile(t, id)));
}

export class TerrainTool implements Tool {
  readonly id = 'terrain' as const;
  readonly wantsRight = true;
  private edit: TileEdit | null = null;
  private terrain: Terrain | null = null;
  private erase = false;
  private eraseTo = 0;
  private last: Cell | null = null;

  cursor(host: ToolHost): string {
    const t = this.selected(host);
    return t ? paintCursor(host, t.layer) : 'crosshair';
  }

  hint(host: ToolHost): string {
    const t = this.selected(host);
    return t
      ? `Terrain — drag to paint ${t.name} (borders fit themselves) · right-drag erases it`
      : 'Terrain — choose a terrain brush in the Tiles panel';
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0 && p.button !== 2) return;
    const terrain = this.selected(host);
    if (!terrain) {
      host.flash('Pick a terrain brush in the Tiles panel first.', 'warn');
      return;
    }
    if (!host.canEdit(terrain.layer)) return;
    const edit = host.beginTiles();
    if (!edit) return;
    this.edit = edit;
    this.terrain = terrain;
    this.erase = p.button === 2;
    this.eraseTo = this.erase ? terrainEraseTo(edit.room, terrain, host.ctx.project.terrains) : 0;
    this.last = null;
    this.paint(p, host);
  }

  move(p: Pointer, host: ToolHost, dragging: boolean): void {
    if (dragging && this.edit) this.paint(p, host);
    else host.redraw();
  }

  up(_p: Pointer, host: ToolHost): void {
    this.finish(host);
  }

  cancel(host: ToolHost): void {
    this.finish(host);
  }

  abort(host: ToolHost): void {
    this.edit?.revert();
    this.edit = null;
    host.redraw();
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    const t = this.selected(host);
    if (this.edit || !canPreview(host, hover, t?.layer ?? host.ctx.layer)) return;
    if (t) ghostTile(g, xf, host.ctx.assets, t.center, hover.tx, hover.ty);
    hoverCell(g, xf, hover.tx, hover.ty, t ? '#58c878' : 'rgba(255,255,255,0.6)');
  }

  private selected(host: ToolHost): Terrain | null {
    const id = host.ctx.terrainId;
    return id === null ? null : host.ctx.project.terrains.find((t) => t.id === id) ?? null;
  }

  private paint(p: Pointer, host: ToolHost): void {
    const edit = this.edit!;
    const cur = { tx: p.tx, ty: p.ty };
    const cells = strokeCells(this.last, cur);
    this.last = cur;
    if (cells.length === 0) return;
    const opts = this.erase ? { erase: true, eraseTo: this.eraseTo } : undefined;
    edit.absorb(paintTerrain(edit.room, this.terrain!, cells, opts));
    edit.absorb(resolveTerrainsAround(edit.room, host.ctx.project.terrains, cells));
    host.redraw();
  }

  private finish(host: ToolHost): void {
    const edit = this.edit;
    if (!edit) return;
    this.edit = null;
    host.commitTiles(edit, this.erase ? `Erase ${this.terrain?.name ?? 'terrain'}` : `Paint ${this.terrain?.name ?? 'terrain'}`);
  }
}
