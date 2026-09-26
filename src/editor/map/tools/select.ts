// Select tool: drag a marquee over tiles of the active layer (Shift at the start
// = all layers), then Ctrl+C / Ctrl+X / Delete. Ctrl+V enters paste mode: the
// clip follows the cursor and each click stamps it (Esc leaves paste mode).
// The clipboard is shared by every room and outlives the editor (copy in one
// project, paste in another): pasting maps its tile ids onto the shown project
// (see planPaste) and says what it had to skip.
import type { LayerName, Project, TileDef } from '../../../core/types';
import type { Cell, CellRect } from '../geometry';
import type { PastePlan, TileClip } from '../clipboard';
import type { EditorContext } from '../../context';
import type { Xf } from '../roomRender';
import type { Pointer, Tool, ToolHost } from './tool';
import { LAYERS } from '../../../core/types';
import { roomCols, roomRows } from '../../../core/project';
import { clipTargets, clearRegion, copyRegion, pasteClip, planPaste } from '../clipboard';
import { clipRect, rectBetween } from '../geometry';
import { ghostTile, hoverCell, outlineCells } from './overlay';
import { layerLabel } from './paint';

let clipboard: TileClip | null = null;

/** Put tile defs into the project (undoable side effect of a paste). */
function tileImport(ctx: EditorContext, defs: readonly TileDef[]): { undo(): void; redo(): void } {
  const snap = JSON.stringify(defs);
  const ids = new Set(defs.map((d) => d.id));
  const notify = (): void => {
    for (const id of ids) ctx.assetsChanged('tile', id);
    ctx.changed('tiles');
  };
  // In place: other panels keep a reference to the tiles array.
  const drop = (tiles: TileDef[]): void => {
    for (let i = tiles.length - 1; i >= 0; i--) if (ids.has(tiles[i]!.id)) tiles.splice(i, 1);
  };
  return {
    undo: () => {
      drop(ctx.project.tiles);
      notify();
    },
    redo: () => {
      drop(ctx.project.tiles);
      ctx.project.tiles.push(...(JSON.parse(snap) as TileDef[]));
      notify();
    },
  };
}

/** Whether the tile clipboard holds something to paste. */
export function hasClip(): boolean {
  return clipboard !== null;
}

/** Top-left cell that centres a w x h clip on the cursor cell. */
export function pasteOrigin(cursor: Cell, w: number, h: number): Cell {
  return { tx: cursor.tx - Math.floor((w - 1) / 2), ty: cursor.ty - Math.floor((h - 1) / 2) };
}

interface Marquee {
  roomId: string;
  /** Room size (tiles) the selection was made at: a resize drops it. */
  cols: number;
  rows: number;
  rect: CellRect;
  allLayers: boolean;
}

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  private marquee: Marquee | null = null;
  private anchor: Cell | null = null;
  private pasting = false;
  /** How the clipboard maps onto the shown project (the paste preview and the next stamp use it). */
  private plan: { clip: TileClip; project: Project; tiles: number; plan: PastePlan } | null = null;

  cursor(): string {
    return this.pasting ? 'copy' : 'crosshair';
  }

  hint(host: ToolHost): string {
    if (this.pasting) return 'Paste — click to stamp the copied tiles · Esc to finish';
    const m = this.current(host);
    if (m) {
      const where = m.allLayers ? 'all layers' : `the ${layerLabel(host.ctx.layer)} layer`;
      return `${m.rect.w}×${m.rect.h} tiles on ${where} — Ctrl+C copy · Ctrl+X cut · Delete clears · Esc deselects`;
    }
    return 'Select — drag to select tiles (Shift: all layers) · Ctrl+A selects the room · Ctrl+V pastes';
  }

  /** Enter paste mode (false if the clipboard is empty). */
  startPaste(host: ToolHost): boolean {
    if (!clipboard) {
      host.flash('Nothing to paste yet — select tiles and press Ctrl+C first.');
      return false;
    }
    this.pasting = true;
    // A "Copied …" message must not hide the paste-mode hint.
    host.clearFlash();
    host.redraw();
    return true;
  }

  /** Select the whole room (active layer, or every layer). */
  selectAll(host: ToolHost, allLayers: boolean): boolean {
    const room = host.room();
    if (!room) return false;
    this.pasting = false;
    const cols = roomCols(room);
    const rows = roomRows(room);
    this.marquee = { roomId: room.id, cols, rows, rect: { x: 0, y: 0, w: cols, h: rows }, allLayers };
    host.redraw();
    return true;
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0) return;
    if (this.pasting) {
      this.stamp(p, host);
      return;
    }
    const room = host.room();
    if (!room) return;
    this.anchor = { tx: p.tx, ty: p.ty };
    this.setMarquee(host, this.anchor, this.anchor, p.shift);
  }

  move(p: Pointer, host: ToolHost, dragging: boolean): void {
    if (dragging && this.anchor) this.setMarquee(host, this.anchor, p, this.marquee?.allLayers ?? false);
    host.redraw();
  }

  up(): void {
    this.anchor = null;
  }

  cancel(host: ToolHost): void {
    this.anchor = null;
    this.pasting = false;
    host.redraw();
  }

  abort(host: ToolHost): void {
    if (this.anchor) this.marquee = null;
    this.cancel(host);
  }

  deactivate(): void {
    this.anchor = null;
    this.pasting = false;
  }

  key(e: KeyboardEvent, host: ToolHost): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyC') return this.copy(host, false);
    if (mod && e.code === 'KeyX') return this.copy(host, true);
    if (mod && e.code === 'KeyV') return this.startPaste(host) || true;
    if (mod && e.code === 'KeyA') return this.selectAll(host, e.shiftKey);
    if (mod) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') return this.clear(host);
    if (e.key === 'Escape') {
      if (this.pasting) this.pasting = false;
      else if (this.current(host)) this.marquee = null;
      else return false;
      host.redraw();
      return true;
    }
    return false;
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    const m = this.current(host);
    if (m) outlineCells(g, xf, m.rect, '#f0c040', 'rgba(240,192,64,0.14)', true);
    if (this.pasting && clipboard && hover) {
      this.drawPastePreview(g, xf, host, clipboard, hover);
      return;
    }
    if (!m && hover && host.room()) hoverCell(g, xf, hover.tx, hover.ty);
  }

  // ------------------------------------------------------------------ internals

  /** The marquee of the shown room; dropped once that room was resized (its cells moved or vanished). */
  private current(host: ToolHost): Marquee | null {
    const m = this.marquee;
    const room = host.room();
    if (!m || !room || m.roomId !== room.id) return null;
    if (m.cols === roomCols(room) && m.rows === roomRows(room)) return m;
    this.marquee = null;
    return null;
  }

  private layers(host: ToolHost, m: Marquee): LayerName[] {
    return m.allLayers ? [...LAYERS] : [host.ctx.layer];
  }

  private setMarquee(host: ToolHost, a: Cell, b: Cell, allLayers: boolean): void {
    const room = host.room();
    const cols = room ? roomCols(room) : 0;
    const rows = room ? roomRows(room) : 0;
    const rect = room ? clipRect(rectBetween(a, b), cols, rows) : null;
    this.marquee = room && rect ? { roomId: room.id, cols, rows, rect, allLayers } : null;
    host.redraw();
  }

  private copy(host: ToolHost, cut: boolean): boolean {
    const m = this.current(host);
    const room = host.room();
    if (!m || !room) {
      host.flash('Select an area first (drag with the Select tool).');
      return true;
    }
    const layers = this.layers(host, m);
    if (cut && !layers.every((l) => host.canEdit(l))) return true;
    clipboard = copyRegion(room, m.rect, layers, host.ctx.project);
    if (cut) {
      const edit = host.beginTiles();
      if (!edit) return true;
      clearRegion(edit, m.rect, layers);
      host.commitTiles(edit, 'Cut tiles');
    }
    host.flash(`${cut ? 'Cut' : 'Copied'} ${m.rect.w}×${m.rect.h} tiles${m.allLayers ? ' (all layers)' : ''}. Ctrl+V to paste.`);
    return true;
  }

  private clear(host: ToolHost): boolean {
    const m = this.current(host);
    if (!m) return false;
    const layers = this.layers(host, m);
    if (!layers.every((l) => host.canEdit(l))) return true;
    const edit = host.beginTiles();
    if (!edit) return true;
    clearRegion(edit, m.rect, layers);
    host.commitTiles(edit, 'Delete tiles');
    return true;
  }

  /** The clipboard's paste plan for the shown project (recomputed when the clip or the project's tiles change). */
  private pastePlan(host: ToolHost, clip: TileClip): PastePlan {
    const project = host.ctx.project;
    const c = this.plan;
    if (c && c.clip === clip && c.project === project && c.tiles === project.tiles.length && c.plan.imports.every((d) => !project.tiles.some((t) => t.id === d.id))) {
      return c.plan;
    }
    const plan = planPaste(clip, project);
    this.plan = { clip, project, tiles: project.tiles.length, plan };
    return plan;
  }

  private stamp(p: Pointer, host: ToolHost): void {
    const clip = clipboard;
    if (!clip || !clipTargets(clip, host.ctx.layer).every(([, to]) => host.canEdit(to))) return;
    const plan = this.pastePlan(host, clip);
    const edit = host.beginTiles();
    if (!edit) return;
    const o = pasteOrigin(p, clip.w, clip.h);
    pasteClip(edit, clip, o.tx, o.ty, host.ctx.layer, plan);
    const changed = edit.changes().length > 0;
    // Tiles from another project join in the same undo step (only when something was painted with them).
    const also = changed && plan.imports.length > 0 ? tileImport(host.ctx, plan.imports) : undefined;
    also?.redo();
    host.commitTiles(edit, 'Paste tiles', also);
    this.plan = null;
    const notes: string[] = [];
    if (also) notes.push(`brought ${plan.imports.length} custom tile${plan.imports.length === 1 ? '' : 's'} from the other project`);
    if (plan.skipped > 0) notes.push(`skipped ${plan.skipped} cell${plan.skipped === 1 ? '' : 's'} whose tile does not exist in this project`);
    if (notes.length > 0) host.ctx.toast(`Pasted: ${notes.join('; ')}.`, plan.skipped > 0 ? 'error' : 'info');
  }

  private drawPastePreview(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, clip: TileClip, hover: Pointer): void {
    const o = pasteOrigin(hover, clip.w, clip.h);
    const plan = this.pastePlan(host, clip);
    const pending = new Set(plan.imports.map((d) => d.id));
    for (const [from] of clipTargets(clip, host.ctx.layer)) {
      const data = clip.layers[from]!;
      for (let y = 0; y < clip.h; y++) {
        for (let x = 0; x < clip.w; x++) {
          const src = data[y * clip.w + x] ?? 0;
          // Skipped cells and tiles still to be imported have nothing to show here yet.
          const id = plan.map.get(src) ?? src;
          if (id !== 0 && !pending.has(id)) ghostTile(g, xf, host.ctx.assets, id, o.tx + x, o.ty + y, 0.7);
        }
      }
    }
    outlineCells(g, xf, { x: o.tx, y: o.ty, w: clip.w, h: clip.h }, '#5fd0ff');
  }
}
