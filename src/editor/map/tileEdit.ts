// Tile change log for one editing gesture (a stroke, a fill, a paste...). Cells
// are written straight into the room; the log remembers each cell's original
// id so the whole gesture can be undone as one step. Pure data, no DOM.
import type { LayerName, Room } from '../../core/types';
import { roomCols, roomRows } from '../../core/project';

/** One cell's change: row-major `index` on `layer`. */
export interface CellChange { layer: LayerName; index: number; before: number; after: number }

/** Called whenever a logged cell's value actually changes. */
export type CellListener = (layer: LayerName, index: number) => void;

export class TileEdit {
  readonly cols: number;
  readonly rows: number;
  private readonly original = new Map<LayerName, Map<number, number>>();

  constructor(readonly room: Room, private readonly listener?: CellListener) {
    this.cols = roomCols(room);
    this.rows = roomRows(room);
  }

  /** Current id at a cell (0 outside the room). */
  get(layer: LayerName, tx: number, ty: number): number {
    return this.inside(tx, ty) ? (this.room.layers[layer][ty * this.cols + tx] ?? 0) : 0;
  }

  /** Write a cell; cells outside the room are ignored. Returns true if the value changed. */
  set(layer: LayerName, tx: number, ty: number, id: number): boolean {
    if (!this.inside(tx, ty)) return false;
    const index = ty * this.cols + tx;
    const data = this.room.layers[layer];
    const current = data[index] ?? 0;
    if (current === id) return false;
    this.remember(layer, index, current);
    data[index] = id;
    this.listener?.(layer, index);
    return true;
  }

  /** Log cells another routine (e.g. autotile) already wrote, given their previous ids. */
  absorb(changes: readonly { layer: LayerName; tx: number; ty: number; before: number }[]): void {
    for (const c of changes) {
      if (!this.inside(c.tx, c.ty)) continue;
      const index = c.ty * this.cols + c.tx;
      this.remember(c.layer, index, c.before);
      this.listener?.(c.layer, index);
    }
  }

  /** Write every logged cell back to its original id (abandons the gesture). */
  revert(): void {
    for (const [layer, cells] of this.original) {
      const data = this.room.layers[layer];
      for (const [index, before] of cells) {
        if (data[index] === before) continue;
        data[index] = before;
        this.listener?.(layer, index);
      }
    }
    this.original.clear();
  }

  /** Net changes so far (cells written back to their original id are dropped). */
  changes(): CellChange[] {
    const out: CellChange[] = [];
    for (const [layer, cells] of this.original) {
      const data = this.room.layers[layer];
      for (const [index, before] of cells) {
        const after = data[index] ?? 0;
        if (after !== before) out.push({ layer, index, before, after });
      }
    }
    return out;
  }

  private inside(tx: number, ty: number): boolean {
    return Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  private remember(layer: LayerName, index: number, before: number): void {
    let cells = this.original.get(layer);
    if (!cells) this.original.set(layer, (cells = new Map()));
    if (!cells.has(index)) cells.set(index, before);
  }
}

/** Re-apply (`forward`) or revert a list of changes on a room. */
export function applyChanges(room: Room, changes: readonly CellChange[], forward: boolean): void {
  for (const c of changes) {
    const data = room.layers[c.layer];
    if (c.index >= 0 && c.index < data.length) data[c.index] = forward ? c.after : c.before;
  }
}
