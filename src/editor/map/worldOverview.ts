// World overview mini-map: every room of the selected world & floor drawn from
// its tiles on the screen grid. Click selects a room, dragging moves it (Esc
// cancels; never onto another room, and within the shown grid, which keeps a
// free cell around the rooms), double-clicking an empty cell creates a room there and
// right-click offers room actions. From the keyboard, arrows select rooms and
// Alt+arrows move the selected one. However far apart the rooms are, the
// canvas only covers the visible part of the grid (a sizer element gives the
// panel its scroll range) and each redraw only visits the cells in view.
import type { Room, World } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapState } from './mapState';
import type { ThumbCache } from './thumbs';
import type { MenuEntry } from './contextMenu';
import { SCREEN_H, SCREEN_W } from '../../core/constants';
import { gridOverlaps, roomAtGrid } from '../../core/project';
import { el } from '../ui/dom';
import { openMenu } from './contextMenu';
import { isHistoryKey } from './history';
import { moveRoom } from './roomOps';

export interface OverviewActions {
  /** Open the new-room dialog for grid cell (gx, gy). */
  createRoomAt(gx: number, gy: number): void;
  /** Show the Room properties tab for the selected room. */
  openRoomProps(): void;
  deleteRoom(room: Room): void;
}

/** Grid window shown by the overview (screens). */
export interface GridBounds { x0: number; y0: number; cols: number; rows: number }

const MIN_CELL = 16;
const MAX_CELL = 44;
const DRAG_THRESHOLD = 4;
/** Canvas size used before the panel is laid out (about the panel's usual size). */
const UNLAID_W = 320;
const UNLAID_H = 338;

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Rooms' bounding box on a floor plus a one-cell margin (at least 5 x 4 cells). */
export function overviewBounds(rooms: readonly Room[]): GridBounds {
  if (rooms.length === 0) return { x0: -1, y0: -1, cols: 5, rows: 4 };
  const x0 = Math.min(...rooms.map((r) => r.gx)) - 1;
  const y0 = Math.min(...rooms.map((r) => r.gy)) - 1;
  const x1 = Math.max(...rooms.map((r) => r.gx + r.gw)) + 1;
  const y1 = Math.max(...rooms.map((r) => r.gy + r.gh)) + 1;
  return { x0, y0, cols: Math.max(5, x1 - x0), rows: Math.max(4, y1 - y0) };
}

interface Drag {
  pointer: number;
  room: Room;
  offX: number;
  offY: number;
  startX: number;
  startY: number;
  moved: boolean;
  gx: number;
  gy: number;
  valid: boolean;
}

export class WorldOverview {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  /** Full-grid-sized box inside the scrolling element: it sets the scroll range; the canvas sits in it at the scroll offset. */
  private readonly sizer: HTMLDivElement;
  /** Grid px (from the grid's top-left) shown at the canvas's top-left: the scroll offset. */
  private ox = 0;
  private oy = 0;
  /** Canvas size in CSS px (the visible part of the grid). */
  private vw = 0;
  private vh = 0;
  private bounds: GridBounds = { x0: 0, y0: 0, cols: 5, rows: 4 };
  private cw = 32;
  private ch = 28;
  private dpr = 1;
  private hover: { gx: number; gy: number } | null = null;
  private drag: Drag | null = null;
  private raf = 0;
  private layoutRaf = 0;
  private lastWidth = -1;
  /** Room last scrolled into view (only a new selection scrolls, never a manual scroll). */
  private revealed: string | null = null;
  private readonly resize: ResizeObserver;

  constructor(
    private readonly ctx: EditorContext,
    private readonly state: MapState,
    private readonly thumbs: ThumbCache,
    private readonly actions: OverviewActions,
  ) {
    this.canvas = el('canvas', {
      class: 'qf-map-overview__canvas', tabIndex: 0,
      'aria-label': 'World overview: arrows select a room, Alt+arrows move it, Enter opens its properties, Delete deletes it',
    });
    this.g = this.canvas.getContext('2d')!;
    this.sizer = el('div', { class: 'qf-map-overview__sizer' }, this.canvas);
    this.element = el('div', { class: 'qf-map-overview' }, this.sizer);
    // Draw right away (not on the next frame) so the canvas never lags behind the scroll.
    this.element.addEventListener('scroll', () => this.fitCanvas(), { passive: true });
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.redraw();
    });
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('contextmenu', (e) => this.onMenu(e));
    this.canvas.addEventListener('keydown', (e) => this.onKey(e));
    // Re-layout on width changes only, outside the observer callback (the canvas sets our height).
    this.resize = new ResizeObserver(() => {
      const w = this.element.clientWidth;
      if (w === this.lastWidth || this.layoutRaf) return;
      this.layoutRaf = requestAnimationFrame(() => {
        this.layoutRaf = 0;
        this.refresh();
      });
    });
    this.resize.observe(this.element);
  }

  /** Re-layout for the current world/floor and redraw. */
  refresh(): void {
    if (!this.drag) this.bounds = overviewBounds(this.rooms());
    this.lastWidth = this.element.clientWidth;
    const avail = Math.max(MIN_CELL * 5, this.lastWidth - 2);
    this.cw = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(avail / this.bounds.cols)));
    this.ch = Math.round((this.cw * SCREEN_H) / SCREEN_W);
    this.dpr = window.devicePixelRatio || 1;
    this.sizer.style.width = `${this.bounds.cols * this.cw}px`;
    this.sizer.style.height = `${this.bounds.rows * this.ch}px`;
    this.reveal();
    this.fitCanvas();
  }

  /** Size and place the canvas over the visible part of the grid (after a layout change or a scroll), then draw. */
  private fitCanvas(): void {
    const el = this.element;
    const w = this.bounds.cols * this.cw;
    const h = this.bounds.rows * this.ch;
    // clientWidth / clientHeight exclude scrollbars; the 1px padding on each side is not grid. Not laid out yet
    // (a hidden tab): a panel-sized guess, fixed by the refresh once it shows.
    const vw = Math.max(1, Math.min(w, el.clientWidth > 2 ? el.clientWidth - 2 : UNLAID_W));
    const vh = Math.max(1, Math.min(h, el.clientHeight > 2 ? el.clientHeight - 2 : UNLAID_H));
    this.ox = Math.max(0, Math.min(w - vw, el.scrollLeft));
    this.oy = Math.max(0, Math.min(h - vh, el.scrollTop));
    this.canvas.style.left = `${this.ox}px`;
    this.canvas.style.top = `${this.oy}px`;
    const bw = Math.round(vw * this.dpr);
    const bh = Math.round(vh * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh || vw !== this.vw || vh !== this.vh) {
      this.vw = vw;
      this.vh = vh;
      this.canvas.style.width = `${vw}px`;
      this.canvas.style.height = `${vh}px`;
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.draw();
  }

  /** Scroll a newly selected room into view when the grid is larger than the panel. */
  private reveal(): void {
    const room = this.rooms().find((r) => r.id === this.ctx.roomId);
    if (!room || room.id === this.revealed) return;
    this.revealed = room.id;
    const el = this.element;
    const x = (room.gx - this.bounds.x0) * this.cw;
    const y = (room.gy - this.bounds.y0) * this.ch;
    const w = room.gw * this.cw;
    const h = room.gh * this.ch;
    if (x < el.scrollLeft || x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x + w / 2 - el.clientWidth / 2);
    if (y < el.scrollTop || y + h > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y + h / 2 - el.clientHeight / 2);
  }

  redraw(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  destroy(): void {
    this.cancelDrag();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.layoutRaf);
    this.resize.disconnect();
    this.element.remove();
  }

  // ------------------------------------------------------------------ geometry

  private world(): World {
    return this.ctx.world();
  }

  private rooms(): Room[] {
    return this.world().rooms.filter((r) => r.floor === this.state.floor);
  }

  private cellAt(e: MouseEvent): { gx: number; gy: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      gx: this.bounds.x0 + Math.floor((e.clientX - r.left + this.ox) / this.cw),
      gy: this.bounds.y0 + Math.floor((e.clientY - r.top + this.oy) / this.ch),
    };
  }

  /** Canvas px of a grid column / row (the canvas shows the grid from the scroll offset on). */
  private px(gx: number): number {
    return (gx - this.bounds.x0) * this.cw - this.ox;
  }

  private py(gy: number): number {
    return (gy - this.bounds.y0) * this.ch - this.oy;
  }

  private roomAt(cell: { gx: number; gy: number }): Room | undefined {
    return roomAtGrid(this.world(), cell.gx, cell.gy, this.state.floor);
  }

  // ------------------------------------------------------------------ input

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const cell = this.cellAt(e);
    const room = this.roomAt(cell);
    if (!room) return;
    if (room.id !== this.ctx.roomId) this.ctx.selectRoom(this.world().id, room.id);
    this.drag = {
      pointer: e.pointerId, room, offX: cell.gx - room.gx, offY: cell.gy - room.gy,
      startX: e.clientX, startY: e.clientY, moved: false, gx: room.gx, gy: room.gy, valid: true,
    };
    this.canvas.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', this.onDragKey, true);
  }

  /**
   * Keys during a drag (the canvas may not have focus): Esc drops the drag so
   * the release moves nothing; undo / redo wait until the drag ends.
   */
  private readonly onDragKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' && !isHistoryKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') this.cancelDrag();
  };

  /** End the drag in progress without moving the room. */
  private cancelDrag(): void {
    const drag = this.endDrag();
    if (!drag) return;
    this.canvas.style.cursor = 'pointer';
    this.redraw();
  }

  /** Clear the drag state (listener, pointer capture) and return the drag that was in progress. */
  private endDrag(): Drag | null {
    const drag = this.drag;
    if (!drag) return null;
    this.drag = null;
    window.removeEventListener('keydown', this.onDragKey, true);
    if (this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer);
    return drag;
  }

  private onMove(e: PointerEvent): void {
    const cell = this.cellAt(e);
    const drag = this.drag;
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const b = this.bounds;
      drag.gx = clampInt(cell.gx - drag.offX, b.x0, b.x0 + b.cols - drag.room.gw);
      drag.gy = clampInt(cell.gy - drag.offY, b.y0, b.y0 + b.rows - drag.room.gh);
      drag.valid = !gridOverlaps(this.world(), drag.gx, drag.gy, drag.room.gw, drag.room.gh, this.state.floor, drag.room.id);
      this.canvas.style.cursor = drag.valid ? 'grabbing' : 'not-allowed';
      this.redraw();
      return;
    }
    if (this.hover?.gx === cell.gx && this.hover.gy === cell.gy) return;
    this.hover = cell;
    const room = this.roomAt(cell);
    this.canvas.style.cursor = room ? 'pointer' : 'cell';
    this.canvas.title = room
      ? `${room.name} — ${room.gw}×${room.gh} screens at ${room.gx}, ${room.gy} · drag to move, double-click for properties`
      : `Empty cell ${cell.gx}, ${cell.gy} — double-click to add a room`;
    this.redraw();
  }

  private onUp(e: PointerEvent): void {
    if (this.drag?.pointer !== e.pointerId) return;
    const drag = this.endDrag();
    if (!drag) return;
    this.canvas.style.cursor = 'pointer';
    if (drag.moved && (drag.gx !== drag.room.gx || drag.gy !== drag.room.gy)) {
      if (!drag.valid || !moveRoom(this.ctx, this.world().id, drag.room.id, drag.gx, drag.gy)) {
        this.ctx.toast('Rooms can’t overlap — drop it on free cells.', 'error');
      }
    }
    this.refresh();
  }

  private onDouble(e: MouseEvent): void {
    const cell = this.cellAt(e);
    if (this.roomAt(cell)) this.actions.openRoomProps();
    else this.actions.createRoomAt(cell.gx, cell.gy);
  }

  /** Keyboard: arrows select the nearest room that way, Alt+arrows move it, Enter / Delete / Shift+F10 act on it. */
  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || this.drag) return;
    const dirs: Partial<Record<string, [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const sel = this.rooms().find((r) => r.id === this.ctx.roomId);
    let run: (() => void) | null = null;
    if (d && e.altKey && sel) run = () => this.nudgeRoom(sel, d[0], d[1]);
    else if (d && !e.altKey) run = () => this.selectToward(sel, d[0], d[1]);
    else if (e.key === 'Enter' && sel) run = () => this.actions.openRoomProps();
    else if (e.key === 'Delete' && sel) run = () => this.actions.deleteRoom(sel);
    else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && sel) run = () => this.openMenuAt(sel);
    if (!run) return;
    e.preventDefault();
    run();
  }

  /** Select the room nearest to `from` in direction (dx, dy); the first room when nothing is selected. */
  private selectToward(from: Room | undefined, dx: number, dy: number): void {
    const rooms = this.rooms();
    if (!from) {
      if (rooms[0]) this.ctx.selectRoom(this.world().id, rooms[0].id);
      return;
    }
    const cx = from.gx + from.gw / 2;
    const cy = from.gy + from.gh / 2;
    let best: Room | null = null;
    let bestScore = Infinity;
    for (const r of rooms) {
      const ax = r.gx + r.gw / 2 - cx;
      const ay = r.gy + r.gh / 2 - cy;
      const ahead = ax * dx + ay * dy;
      if (r === from || ahead <= 0) continue;
      const score = ahead + 2 * Math.abs(ax * dy + ay * dx);
      if (score < bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best) this.ctx.selectRoom(this.world().id, best.id);
  }

  private nudgeRoom(room: Room, dx: number, dy: number): void {
    if (!moveRoom(this.ctx, this.world().id, room.id, room.gx + dx, room.gy + dy)) {
      this.ctx.toast('Rooms can’t overlap — that cell is taken.', 'error');
    }
  }

  private openMenuAt(room: Room): void {
    const r = this.canvas.getBoundingClientRect();
    this.showMenu(room, { gx: room.gx, gy: room.gy }, r.left + this.px(room.gx + 0.5), r.top + this.py(room.gy + 0.5));
  }

  private onMenu(e: MouseEvent): void {
    e.preventDefault();
    const cell = this.cellAt(e);
    this.showMenu(this.roomAt(cell), cell, e.clientX, e.clientY);
  }

  private showMenu(room: Room | undefined, cell: { gx: number; gy: number }, x: number, y: number): void {
    const world = this.world();
    const entries: MenuEntry[] = room
      ? [
        { header: room.name },
        { label: 'Room properties', icon: 'edit', action: () => { this.ctx.selectRoom(world.id, room.id); this.actions.openRoomProps(); } },
        {
          label: 'Playtest this room', icon: 'play',
          action: () => this.ctx.playtest({ world: world.id, room: room.id, x: (room.gw * SCREEN_W) / 2, y: (room.gh * SCREEN_H) / 2, dir: 'down' }),
        },
        'separator',
        { label: 'Delete room…', icon: 'trash', danger: true, action: () => this.actions.deleteRoom(room) },
      ]
      : [{ label: 'New room here…', icon: 'plus', action: () => this.actions.createRoomAt(cell.gx, cell.gy) }];
    openMenu(x, y, entries);
  }

  // ------------------------------------------------------------------ drawing

  private draw(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const { g, dpr, cw, ch, bounds, ox, oy, vw, vh } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d0b14';
    g.fillRect(0, 0, vw, vh);
    // Only the cells in view: the grid may span thousands of screens.
    g.fillStyle = '#231f31';
    const cx0 = Math.floor(ox / cw);
    const cy0 = Math.floor(oy / ch);
    const cx1 = Math.min(bounds.cols, Math.ceil((ox + vw) / cw));
    const cy1 = Math.min(bounds.rows, Math.ceil((oy + vh) / ch));
    for (let x = cx0; x < cx1; x++) {
      for (let y = cy0; y < cy1; y++) g.fillRect(x * cw - ox + 1, y * ch - oy + 1, cw - 2, ch - 2);
    }
    if (this.hover && !this.drag && !this.roomAt(this.hover)) {
      const hx = this.px(this.hover.gx);
      const hy = this.py(this.hover.gy);
      g.fillStyle = '#332d48';
      g.fillRect(hx + 1, hy + 1, cw - 2, ch - 2);
      g.fillStyle = '#a59fbd';
      g.fillRect(hx + cw / 2 - 4, hy + ch / 2 - 0.5, 8, 1);
      g.fillRect(hx + cw / 2 - 0.5, hy + ch / 2 - 4, 1, 8);
    }
    const start = this.ctx.project.start;
    for (const room of this.rooms()) {
      const dragging = this.drag?.moved && this.drag.room.id === room.id;
      this.drawRoom(room, room.gx, room.gy, dragging ? 0.35 : 1);
      if (start.world === this.world().id && start.room === room.id) this.drawStartMark(room);
    }
    const sel = this.rooms().find((r) => r.id === this.ctx.roomId);
    if (sel && !(this.drag?.moved && this.drag.room === sel)) this.outline(sel.gx, sel.gy, sel.gw, sel.gh, '#f0c040', 2);
    const hoverRoom = this.hover && !this.drag ? this.roomAt(this.hover) : undefined;
    if (hoverRoom && hoverRoom !== sel) this.outline(hoverRoom.gx, hoverRoom.gy, hoverRoom.gw, hoverRoom.gh, 'rgba(255,255,255,0.7)', 1);
    const d = this.drag;
    if (d?.moved) {
      this.drawRoom(d.room, d.gx, d.gy, 0.8);
      this.outline(d.gx, d.gy, d.room.gw, d.room.gh, d.valid ? '#58c878' : '#e05050', 2);
    }
  }

  private drawRoom(room: Room, gx: number, gy: number, alpha: number): void {
    const { g, cw, ch } = this;
    const x = this.px(gx);
    const y = this.py(gy);
    if (x >= this.vw || y >= this.vh || x + room.gw * cw <= 0 || y + room.gh * ch <= 0) return; // out of view
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.thumbs.get(room), x, y, room.gw * cw, room.gh * ch);
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, room.gw * cw - 1, room.gh * ch - 1);
  }

  private drawStartMark(room: Room): void {
    const { g } = this;
    const x = this.px(room.gx) + 3;
    const y = this.py(room.gy) + 3;
    g.fillStyle = 'rgba(12,10,18,0.8)';
    g.fillRect(x - 1, y - 1, 9, 9);
    g.fillStyle = '#58c878';
    g.fillRect(x + 1, y, 1, 7);
    g.fillRect(x + 2, y, 4, 3);
  }

  private outline(gx: number, gy: number, gw: number, gh: number, color: string, width: number): void {
    const { g, cw, ch } = this;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.strokeRect(this.px(gx) + width / 2, this.py(gy) + width / 2, gw * cw - width, gh * ch - width);
  }
}
