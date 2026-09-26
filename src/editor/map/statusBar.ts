// Status bar under the room canvas: tool hint (or a transient message), cursor
// tile & pixel coordinates, the tile under the cursor and its collision. Only
// the transient messages are announced to screen readers, not cursor moves.
import type { LayerName } from '../../core/types';
import type { CollisionKind } from './roomRender';
import { el } from '../ui/dom';
import { COLLISION_COLORS, COLLISION_LABELS } from './roomRender';

/** What the status bar shows about the cell under the cursor. */
export interface CursorInfo {
  tx: number;
  ty: number;
  x: number;
  y: number;
  /** Top-most tile at the cell, if any. */
  tile: { id: number; name: string; layer: LayerName } | null;
  collision: CollisionKind | 'floor';
}

const FLASH_MS = 4200;

export class StatusBar {
  readonly element: HTMLDivElement;
  private readonly hintEl: HTMLSpanElement;
  private readonly cellEl: HTMLSpanElement;
  private readonly pxEl: HTMLSpanElement;
  private readonly tileEl: HTMLSpanElement;
  private readonly collEl: HTMLSpanElement;
  private readonly liveEl: HTMLSpanElement;
  private hint = '';
  private flashUntil = 0;
  private flashTimer = 0;
  /** What the cursor fields show now (setCursor skips identical updates). */
  private cursorKey: string | null = null;

  constructor() {
    this.hintEl = el('span', { class: 'qf-map-status__hint' });
    this.cellEl = el('span', { class: 'qf-map-status__item', title: 'Tile column, row' });
    this.pxEl = el('span', { class: 'qf-map-status__item', title: 'Room pixel position' });
    this.tileEl = el('span', { class: 'qf-map-status__item qf-map-status__tile', title: 'Top-most tile under the cursor' });
    this.collEl = el('span', { class: 'qf-map-status__item qf-map-status__coll', title: 'Collision at the cursor (objects layer wins over ground)' });
    this.liveEl = el('span', { class: 'qf-map-status__live', 'aria-live': 'polite' });
    this.element = el('div', { class: 'qf-map-status' },
      this.hintEl, this.cellEl, this.pxEl, this.tileEl, this.collEl, this.liveEl);
    this.setCursor(null);
  }

  /** Persistent hint for the active tool (hidden while a flash message shows). */
  setHint(text: string): void {
    if (text === this.hint) return;
    this.hint = text;
    if (performance.now() >= this.flashUntil) this.showHint();
  }

  /** Show a message for a few seconds in place of the hint. */
  flash(msg: string, kind: 'info' | 'warn' = 'info'): void {
    this.flashUntil = performance.now() + FLASH_MS;
    this.hintEl.textContent = msg;
    this.hintEl.title = msg;
    this.hintEl.dataset.kind = kind;
    this.liveEl.textContent = msg;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.showHint(), FLASH_MS);
  }

  /** Drop a transient message early (what it warned about changed). */
  clearFlash(): void {
    if (performance.now() >= this.flashUntil) return;
    this.flashUntil = 0;
    clearTimeout(this.flashTimer);
    this.showHint();
  }

  setCursor(info: CursorInfo | null): void {
    const key = info
      ? `${info.tx},${info.ty},${Math.floor(info.x)},${Math.floor(info.y)},${info.tile?.id ?? 0},${info.tile?.name ?? ''},${info.tile?.layer ?? ''},${info.collision}`
      : '';
    if (key === this.cursorKey) return;
    this.cursorKey = key;
    if (!info) {
      this.cellEl.textContent = '—';
      this.pxEl.textContent = '';
      this.tileEl.textContent = '';
      this.collEl.textContent = '';
      this.collEl.style.removeProperty('--qf-map-coll');
      return;
    }
    this.cellEl.textContent = `Tile ${info.tx}, ${info.ty}`;
    this.pxEl.textContent = `${Math.floor(info.x)}, ${Math.floor(info.y)} px`;
    this.tileEl.textContent = info.tile ? `${info.tile.name} #${info.tile.id} · ${info.tile.layer}` : 'Void (no tile)';
    const coll = info.collision;
    this.collEl.textContent = coll === 'floor' ? 'Walkable' : COLLISION_LABELS[coll];
    this.collEl.style.setProperty('--qf-map-coll', coll === 'floor' ? 'transparent' : COLLISION_COLORS[coll]);
  }

  dispose(): void {
    clearTimeout(this.flashTimer);
  }

  private showHint(): void {
    this.liveEl.textContent = '';
    this.hintEl.textContent = this.hint;
    this.hintEl.title = this.hint;
    delete this.hintEl.dataset.kind;
  }
}
