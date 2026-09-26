// The room canvas: renders the selected room (tile layers, dimmed neighbour
// edges, collision overlay, grid & screen lines, entities, tool previews) with
// crisp pixel art, handles zoom (wheel around the cursor) and pan (Space+drag /
// middle-drag / arrows), and routes pointer + key input to the active tool. It
// draws on demand (one frame per change, a slow tick for animated tiles) so an
// idle editor costs nothing; project events only queue work, which is done
// before the next frame or input and never while the tab is hidden.
import type { LayerName, Room, World } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapCursorHost } from '../shell/context';
import type { MapState } from './mapState';
import type { StatusBar } from './statusBar';
import type { FlashKind, Pointer, Tool, ToolHost } from './tools/tool';
import type { ToolSet } from './tools';
import type { View } from './viewMath';
import type { MapIcon } from './icons';
import { TILE } from '../../core/constants';
import { locateRoom, roomCols, roomRows } from '../../core/project';
import { el, button } from '../ui/dom';
import { ArtWatch } from './artStamp';
import { commitTiles, isHistoryKey, type SideEffect } from './history';
import { mapIcon } from './icons';
import { openCanvasMenu, cellTarget } from './canvasMenu';
import { TileEdit } from './tileEdit';
import { createTools } from './tools';
import { TILE_TOOLS } from './tools/tool';
import { markerLabel } from './tools/entityTool';
import { layerLabel, pickBrush, topTile } from './tools/paint';
import { clampZoom, deviceScale, fitView, stepZoom, toArt, zoomAround } from './viewMath';
import {
  COLLISION_COLORS, COLLISION_LABELS, CollisionCache, DRAW_LAYERS, LayerCache, NeighbourCache, STRIP,
  cellCollision, drawEntities, drawGrid, drawLedgeArrows, entityBoxes, tag, type CollisionKind, type EntityBox, type NeighbourStrip, type Xf,
} from './roomRender';

const BACKDROP = '#0d0b14';
const TICK_MS = 120;
/** Device px of empty margin around a fitted room. */
const FIT_MARGIN = 12;
/** CSS px height of a canvas name tag (see tag()). */
const TAG_H = 14;
/** Narrowest on-screen neighbour strip (CSS px) that gets a name tag. */
const STRIP_LABEL_MIN = 36;
/** Wheel delta (px) per zoom step; mouse notches are ~100. */
const WHEEL_STEP = 60;
/** Accumulated ctrl-wheel delta per zoom step for trackpad pinches (many small deltas). */
const PINCH_STEP = 40;
/** Vertical pixel deltas below this come from a trackpad (or smooth scrolling), not a mouse notch. */
const TRACKPAD_DELTA = 40;

/** Status-bar hint while a location pick is pending (clicks pick instead of editing). */
const PICK_HINT = 'Picking a location — click a tile · change rooms in the overview · Esc cancels';

/** Current time in seconds (drives tile animation). */
const now = (): number => performance.now() / 1000;

/**
 * Work queued for the next frame, in increasing order: re-read the room and
 * redraw changed cells (diff), the same plus the cells showing tiles whose art
 * changed (art: after an undo or an art edit), or re-rasterise every cell (full).
 */
const SYNC = { none: 0, diff: 1, art: 2, full: 3 } as const;
type SyncLevel = (typeof SYNC)[keyof typeof SYNC];

/** PointerEvent.buttons bit of a PointerEvent.button (0 left, 1 middle, 2 right). */
function buttonMask(button: number): number {
  return button === 1 ? 4 : button === 2 ? 2 : 1 << button;
}

/** Times one gesture may take its pointer capture back (see onLost) before it just ends. */
const MAX_RECAPTURES = 6;

interface Gesture {
  kind: 'tool' | 'pan';
  button: number;
  pointer: number;
  recaptures: number;
  x: number;
  y: number;
  panX: number;
  panY: number;
}

export class RoomCanvas implements ToolHost {
  readonly element: HTMLDivElement;
  readonly tools: ToolSet;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly banner: HTMLDivElement;
  private readonly bannerText: HTMLSpanElement;
  private readonly legend: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly zoomLabel: HTMLButtonElement;
  private readonly caches: Record<LayerName, LayerCache>;
  private readonly neighbours: NeighbourCache;
  private readonly collision: CollisionCache;
  private readonly art: ArtWatch;
  private collisionDirty = true;
  private pending: SyncLevel = SYNC.full;
  /** Room the caches were built for, with its size at that time. */
  private built: { room: Room; cols: number; rows: number } | null = null;
  private view: View = { zoom: 2, panX: 0, panY: 0 };
  /** Saved view per room id, restored when coming back to a room. */
  private readonly views = new Map<string, View>();
  private viewRoom: string | null = null;
  private needsFit = true;
  private dpr = 1;
  private hover: Pointer | null = null;
  private gesture: Gesture | null = null;
  private spaceHeld = false;
  private wheelAccum = 0;
  private activeTool: Tool;
  private selfCommit = false;
  private raf = 0;
  private readonly timer: number;
  private readonly resize: ResizeObserver;
  private readonly cleanups: (() => void)[] = [];

  constructor(readonly ctx: EditorContext, readonly state: MapState, private readonly status: StatusBar) {
    // Zero-sized until the stage is measured, so nothing is fitted to the 300x150 default.
    this.canvas = el('canvas', { class: 'qf-map-canvas', tabIndex: -1, 'aria-label': 'Room canvas', width: 0, height: 0 });
    this.g = this.canvas.getContext('2d')!;
    this.bannerText = el('span', { class: 'qf-grow' });
    this.banner = el('div', { class: 'qf-map-pick', role: 'status', hidden: true },
      mapIcon('target'), this.bannerText,
      button('Cancel', () => this.state.endPick(null), { small: true }));
    this.legend = el('div', { class: 'qf-map-legend', hidden: true }, el('div', { class: 'qf-map-legend__title' }, 'Collision'),
      (Object.keys(COLLISION_COLORS) as CollisionKind[]).map((k) => el('div', { class: 'qf-map-legend__row' },
        el('span', { class: 'qf-map-legend__swatch', style: { background: COLLISION_COLORS[k] } }), COLLISION_LABELS[k])));
    this.empty = el('div', { class: 'qf-map-empty', hidden: true },
      el('div', { class: 'qf-map-empty__title' }, 'No room selected'),
      el('div', null, 'Pick a room in the world overview, or double-click an empty cell there to create one.'));
    this.zoomLabel = el('button', { class: 'qf-map-zoom__label', type: 'button', title: 'Actual size (100%)', on: { click: () => this.zoomToCentre(1) } });
    const zoom = el('div', { class: 'qf-map-zoom' },
      this.iconButton('zoomOut', 'Zoom out (-)', () => this.zoomBy(-1)),
      this.zoomLabel,
      this.iconButton('zoomIn', 'Zoom in (+)', () => this.zoomBy(1)),
      this.iconButton('fit', 'Fit the room (0)', () => this.fit()));
    this.element = el('div', { class: 'qf-map-stage' }, this.canvas, this.banner, this.legend, this.empty, zoom);
    const assets = ctx.assets;
    this.caches = { bg: new LayerCache(assets), fg: new LayerCache(assets), over: new LayerCache(assets) };
    this.neighbours = new NeighbourCache(assets);
    this.collision = new CollisionCache(assets);
    this.art = new ArtWatch(() => ctx.project);
    this.tools = createTools(this);
    this.activeTool = this.tools.get(state.tool);
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(this.element);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.bind();
    this.onPick();
  }

  // ------------------------------------------------------------------ ToolHost

  world(): World {
    return this.ctx.world();
  }

  room(): Room | null {
    return this.ctx.room();
  }

  beginTiles(): TileEdit | null {
    this.flush();
    const room = this.room();
    if (!room) return null;
    return new TileEdit(room, (layer, index) => {
      this.caches[layer].update(room.layers[layer], [index], now());
      this.collisionDirty = true;
    });
  }

  commitTiles(edit: TileEdit, label: string, also?: SideEffect): void {
    const changes = edit.changes();
    if (changes.length === 0) return;
    this.selfCommit = true;
    try {
      commitTiles(this.ctx, this.world().id, edit.room.id, label, changes, also);
    } finally {
      this.selfCommit = false;
    }
    this.redraw();
  }

  redraw(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  flash(msg: string, kind: FlashKind = 'info'): void {
    this.status.flash(msg, kind);
  }

  clearFlash(): void {
    this.status.clearFlash();
  }

  visible(layer: LayerName | 'entities'): boolean {
    return this.state.prefs.show[layer];
  }

  canEdit(layer: LayerName): boolean {
    if (this.visible(layer)) return true;
    this.flash(`The ${layerLabel(layer)} layer is hidden — click its eye in the toolbar to show it before editing it.`, 'warn');
    return false;
  }

  entityBoxes(): EntityBox[] {
    const room = this.room();
    return room ? entityBoxes(room, this.ctx.assets) : [];
  }

  // ------------------------------------------------------------------ public API

  /** Zoom in (+) or out (-) by whole zoom levels around the canvas centre. */
  zoomBy(steps: number): void {
    this.zoomToCentre(stepZoom(this.view.zoom, steps));
  }

  /** Zoom and centre so the whole room is visible. */
  fit(): void {
    this.needsFit = true;
    if (this.applyFit()) this.afterView();
  }

  /** Zoom as a percentage of CSS pixels: the scale actually drawn (integer device scales from 100% up). */
  get zoomPercent(): number {
    return Math.round((deviceScale(this.view.zoom, this.dpr) / this.dpr) * 100);
  }

  /** Key pressed while the map tab is active; true when handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Space') {
      // A focused button keeps Space (keyboard activation) unless the mouse is over the canvas.
      const focus = document.activeElement;
      if (!this.hover && !this.gesture && focus instanceof HTMLElement && focus !== document.body && focus !== this.canvas) return false;
      this.spaceHeld = true;
      this.updateCursor();
      return true;
    }
    if (e.key === 'Escape' && this.state.pickPrompt !== null) {
      this.state.endPick(null);
      return true;
    }
    if (e.key === 'Escape' && this.gesture?.kind === 'tool') {
      this.endGesture(true);
      return true;
    }
    this.flush();
    if (this.activeTool.key?.(e, this)) {
      this.redraw();
      return true;
    }
    const pan: Partial<Record<string, [number, number]>> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const d = pan[e.key];
    if (d && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const step = Math.round(deviceScale(this.view.zoom, this.dpr) * TILE * (e.shiftKey ? 4 : 1));
      this.view = { ...this.view, panX: this.view.panX + d[0] * step, panY: this.view.panY + d[1] * step };
      this.afterView();
      return true;
    }
    return false;
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      this.updateCursor();
    }
  }

  /** Re-measure and re-read the room (the tab became visible again). */
  refresh(): void {
    this.onResize();
    this.invalidate(SYNC.art);
  }

  destroy(): void {
    this.endGesture();
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.resize.disconnect();
    this.tools.dispose();
    for (const off of this.cleanups.splice(0)) off();
    this.element.remove();
  }

  // ------------------------------------------------------------------ wiring

  private bind(): void {
    const { ctx, state, canvas } = this;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, fn, opts);
      this.cleanups.push(() => canvas.removeEventListener(type, fn, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onLost(e));
    on('lostpointercapture', (e) => this.onLost(e));
    on('pointerleave', () => this.onLeave());
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => this.onContextMenu(e));
    on('auxclick', (e) => e.preventDefault());
    const blur = (): void => {
      this.spaceHeld = false;
      this.updateCursor();
    };
    // Undo/redo in the middle of a stroke would interleave with it: hold them until the gesture ends.
    const holdHistory = (e: KeyboardEvent): void => {
      if (this.gesture?.kind !== 'tool' || !isHistoryKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', holdHistory, true);
    this.cleanups.push(
      () => window.removeEventListener('blur', blur),
      () => window.removeEventListener('keydown', holdHistory, true),
      ctx.bus.on('selection', ({ what }) => {
        if (what === 'room') {
          this.status.clearFlash();
          this.invalidate(SYNC.diff);
        } else {
          this.redraw();
        }
        this.updateCursor();
      }),
      ctx.bus.on('project', ({ what, id }) => this.onProject(what, id)),
      ctx.bus.on('assets', ({ kind }) => {
        if (kind === 'sprite') this.redraw();
        else this.invalidate(kind === 'all' ? SYNC.full : SYNC.art);
      }),
      ctx.bus.on('undo', () => this.invalidate(SYNC.art)),
      state.bus.on('tool', () => this.onTool()),
      state.bus.on('prefs', () => {
        this.legend.hidden = !state.prefs.collision;
        this.status.clearFlash();
        this.redraw();
      }),
      state.bus.on('pick', () => this.onPick()),
    );
    this.legend.hidden = !state.prefs.collision;
  }

  private onProject(what: string, id: string | undefined): void {
    if (what === 'room' && this.selfCommit && id === this.room()?.id) {
      this.collisionDirty = true;
      return;
    }
    if (what === 'all') this.invalidate(SYNC.full);
    else if (what === 'tiles' || what === 'palettes') this.invalidate(SYNC.art);
    else if (what === 'room' || what === 'rooms' || what === 'worlds') this.invalidate(SYNC.diff);
    else this.redraw();
  }

  private onTool(): void {
    const next = this.tools.get(this.state.tool);
    if (next === this.activeTool) return;
    this.endGesture();
    this.activeTool.deactivate?.(this);
    this.activeTool = next;
    this.updateCursor();
    this.redraw();
  }

  private onPick(): void {
    const prompt = this.state.pickPrompt;
    this.banner.hidden = prompt === null;
    if (prompt !== null) {
      this.bannerText.replaceChildren('Pick a location: ', el('b', null, prompt), ' — click in any room (Esc cancels)');
    }
    this.updateCursor();
    this.redraw();
  }

  private onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.element.clientWidth * dpr);
    const h = Math.round(this.element.clientHeight * dpr);
    // A hidden tab measures 0 x 0: keep the last size (and view) until it shows again.
    if (w === 0 || h === 0) return;
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return;
    const old = { w: this.canvas.width, h: this.canvas.height };
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${this.element.clientWidth}px`;
    this.canvas.style.height = `${this.element.clientHeight}px`;
    if (old.w > 0 && old.h > 0 && !this.needsFit) {
      // Keep the view centre where it was.
      this.view = { ...this.view, panX: this.view.panX + Math.round((w - old.w) / 2), panY: this.view.panY + Math.round((h - old.h) / 2) };
    }
    this.redraw();
  }

  // ------------------------------------------------------------------ syncing

  /** Queue a re-read of the room (merged with pending work) and schedule a frame. */
  private invalidate(level: SyncLevel): void {
    if (level > this.pending) this.pending = level;
    this.redraw();
  }

  /** Do queued sync work now (before drawing or handling input). */
  private flush(): void {
    const level = this.pending;
    if (level === SYNC.none) return;
    this.pending = SYNC.none;
    this.syncNow(level);
  }

  private syncNow(level: SyncLevel): void {
    const room = this.room();
    const id = room?.id ?? null;
    if (id !== this.viewRoom) {
      this.endGesture();
      if (this.viewRoom !== null && !this.needsFit) this.views.set(this.viewRoom, { ...this.view });
      this.viewRoom = id;
      const saved = id !== null ? this.views.get(id) : undefined;
      if (saved) this.view = { ...saved };
      this.needsFit = !saved;
    }
    this.empty.hidden = room !== null;
    if (!room) {
      this.built = null;
      return;
    }
    const cols = roomCols(room);
    const rows = roomRows(room);
    const b = this.built;
    const same = b !== null && b.room.id === room.id;
    const resized = same && (b.cols !== cols || b.rows !== rows);
    if (resized) this.needsFit = true;
    if (!same || resized || level === SYNC.full) {
      this.rebuild(room, cols, rows);
      return;
    }
    if (level === SYNC.art) this.forgetArt();
    const t = now();
    for (const layer of DRAW_LAYERS) {
      const redrawn = this.caches[layer].sync(room.layers[layer], t);
      if (redrawn < 0) {
        this.rebuild(room, cols, rows);
        return;
      }
      if (redrawn > 0) this.collisionDirty = true;
    }
    this.neighbours.build(this.world(), room);
    this.built = { room, cols, rows };
  }

  /** Mark the cells showing tiles whose art changed for redrawing. */
  private forgetArt(): void {
    const stale = this.art.changedTiles();
    if (stale.length === 0) return;
    const ids = new Set(stale);
    for (const layer of DRAW_LAYERS) this.caches[layer].forget(ids);
    this.collisionDirty = true;
  }

  private rebuild(room: Room, cols: number, rows: number): void {
    const t = now();
    this.art.reset();
    for (const layer of DRAW_LAYERS) this.caches[layer].build(room.layers[layer], cols, rows, t);
    this.neighbours.build(this.world(), room);
    this.collisionDirty = true;
    this.built = { room, cols, rows };
  }

  /** Whether the canvas is laid out (not in a hidden tab or behind the playtest). */
  private shown(): boolean {
    return this.element.offsetParent !== null;
  }

  private tick(): void {
    const b = this.built;
    if (!b || this.pending !== SYNC.none || !this.shown()) return;
    const t = now();
    // Only the cells in view (at high zoom a small part of a big room); hidden layers catch up once shown.
    const xf = this.xf();
    const cell = TILE * xf.s;
    const area = {
      x0: Math.floor(-xf.ox / cell), y0: Math.floor(-xf.oy / cell),
      x1: Math.ceil((this.canvas.width - xf.ox) / cell), y1: Math.ceil((this.canvas.height - xf.oy) / cell),
    };
    let changed = false;
    for (const layer of DRAW_LAYERS) {
      if (this.visible(layer) && this.caches[layer].tick(b.room.layers[layer], t, area)) changed = true;
    }
    if (changed) this.redraw();
  }

  // ------------------------------------------------------------------ input

  private pointer(e: MouseEvent, button = e.button): Pointer {
    const r = this.canvas.getBoundingClientRect();
    const a = toArt(this.view, this.dpr, (e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
    return {
      x: a.x, y: a.y, tx: Math.floor(a.x / TILE), ty: Math.floor(a.y / TILE), button,
      shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey,
    };
  }

  private onDown(e: PointerEvent): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active !== this.canvas) active.blur();
    if (this.gesture) return;
    this.flush();
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.startGesture(e, 'pan');
      return;
    }
    const p = this.pointer(e);
    if (e.button === 0 && this.state.pickPrompt !== null) {
      this.resolvePick(p);
      return;
    }
    if (!this.room()) return;
    const tool = this.activeTool;
    if (e.button === 0 && e.altKey && TILE_TOOLS.includes(tool.id)) {
      e.preventDefault();
      pickBrush(p, this);
      return;
    }
    if (e.button !== 0 && !(e.button === 2 && tool.wantsRight)) return;
    this.startGesture(e, 'tool');
    tool.down(p, this);
    this.updateCursor();
  }

  private startGesture(e: PointerEvent, kind: Gesture['kind']): void {
    this.gesture = { kind, button: e.button, pointer: e.pointerId, recaptures: 0, x: e.clientX, y: e.clientY, panX: this.view.panX, panY: this.view.panY };
    this.canvas.setPointerCapture(e.pointerId);
    this.updateCursor();
  }

  private onMove(e: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture?.kind === 'pan') {
      this.view = {
        ...this.view,
        panX: gesture.panX + Math.round((e.clientX - gesture.x) * this.dpr),
        panY: gesture.panY + Math.round((e.clientY - gesture.y) * this.dpr),
      };
      this.afterView();
      return;
    }
    this.flush();
    const p = this.pointer(e, gesture?.button ?? 0);
    this.hover = p;
    this.publishCursor(p);
    if (this.state.pickPrompt !== null) {
      this.redraw();
      return;
    }
    this.activeTool.move(p, this, gesture?.kind === 'tool');
    this.updateCursor();
  }

  private onUp(e: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== e.pointerId) return;
    this.gesture = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (gesture.kind === 'tool') {
      // The final position may only arrive with the up event (moves are coalesced per frame).
      const p = this.pointer(e, gesture.button);
      this.activeTool.move(p, this, true);
      this.activeTool.up(p, this);
    }
    this.updateCursor();
    this.redraw();
  }

  /**
   * The pointer went away mid-gesture (cancelled, or the tab was hidden): end
   * the gesture where it was. Chromium also drops the capture when a second
   * button opens the context menu; while the gesture's button is still held on
   * a visible canvas, the capture is taken back and the gesture goes on.
   */
  private onLost(e: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture?.pointer !== e.pointerId) return;
    const held = (e.buttons & buttonMask(gesture.button)) !== 0;
    if (e.type === 'lostpointercapture' && held && this.shown() && gesture.recaptures < MAX_RECAPTURES) {
      gesture.recaptures++;
      try {
        this.canvas.setPointerCapture(e.pointerId);
        return;
      } catch {
        // The pointer is no longer active: fall through and end the gesture.
      }
    }
    this.endGesture();
  }

  private onLeave(): void {
    if (this.gesture) return;
    this.hover = null;
    this.status.setCursor(null);
    this.redraw();
  }

  /**
   * Ctrl/Cmd+wheel (and trackpad pinch, which arrives as a ctrl wheel) zooms
   * around the cursor; trackpad scrolling (pixel deltas with a sideways part,
   * or small ones) pans; a mouse wheel's notches zoom.
   */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < TRACKPAD_DELTA);
    if (trackpad && !e.ctrlKey && !e.metaKey) {
      this.view = { ...this.view, panX: this.view.panX - Math.round(e.deltaX * this.dpr), panY: this.view.panY - Math.round(e.deltaY * this.dpr) };
      this.needsFit = false;
      this.afterView();
      return;
    }
    this.wheelAccum += e.deltaY * unit;
    if (Math.abs(this.wheelAccum) < (e.ctrlKey || e.metaKey ? PINCH_STEP : WHEEL_STEP)) return;
    const step = this.wheelAccum < 0 ? 1 : -1;
    this.wheelAccum = 0;
    const r = this.canvas.getBoundingClientRect();
    this.zoomTo(stepZoom(this.view.zoom, step), (e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    // A right-click in the middle of a stroke or drag must not open the menu over it.
    if (this.gesture || this.activeTool.wantsRight || this.state.pickPrompt !== null || !this.room()) return;
    openCanvasMenu(this, this.tools, this.pointer(e), e.clientX, e.clientY);
  }

  /** Stop the gesture in progress: the tool keeps what it did, or reverts it with `abort` (Esc). */
  private endGesture(abort = false): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (this.canvas.hasPointerCapture(gesture.pointer)) this.canvas.releasePointerCapture(gesture.pointer);
    if (gesture.kind === 'tool') {
      const tool = this.activeTool;
      if (abort && tool.abort) tool.abort(this);
      else tool.cancel?.(this);
    }
    this.updateCursor();
    this.redraw();
  }

  private resolvePick(p: Pointer): void {
    const room = this.room();
    if (!room) {
      this.flash('Choose a room in the world overview first, then click a spot in it.', 'warn');
      return;
    }
    if (p.tx < 0 || p.ty < 0 || p.tx >= roomCols(room) || p.ty >= roomRows(room)) {
      this.flash('Click inside the room.', 'warn');
      return;
    }
    this.state.endPick(cellTarget(this.world().id, room.id, p.tx, p.ty));
  }

  private zoomToCentre(zoom: number): void {
    this.zoomTo(zoom, this.canvas.width / 2, this.canvas.height / 2);
  }

  private zoomTo(zoom: number, px: number, py: number): void {
    if (clampZoom(zoom) === this.view.zoom) return;
    this.view = zoomAround(this.view, zoom, this.dpr, px, py);
    this.needsFit = false;
    this.afterView();
  }

  private afterView(): void {
    this.zoomLabel.textContent = `${this.zoomPercent}%`;
    this.redraw();
  }

  /** Fit the built room into the canvas now; false while there is nothing to fit yet. */
  private applyFit(): boolean {
    const b = this.built;
    if (!b || !this.canvas.width || !this.canvas.height) return false;
    this.view = fitView(b.cols * TILE, b.rows * TILE, this.canvas.width, this.canvas.height, this.dpr, FIT_MARGIN * this.dpr);
    this.needsFit = false;
    return true;
  }

  private iconButton(icon: MapIcon, title: string, onClick: () => void): HTMLButtonElement {
    return el('button', { class: 'qf-map-zoom__btn', type: 'button', title, 'aria-label': title, on: { click: onClick } }, mapIcon(icon));
  }

  private updateCursor(): void {
    let cursor: string;
    if (this.gesture?.kind === 'pan') cursor = 'grabbing';
    else if (this.spaceHeld) cursor = 'grab';
    else if (this.state.pickPrompt !== null) cursor = 'crosshair';
    else cursor = this.activeTool.cursor(this);
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /** Status-bar cursor info and the shell's Shift+F5 spawn point. */
  private publishCursor(p: Pointer): void {
    const room = this.room();
    if (!room || p.tx < 0 || p.ty < 0 || p.tx >= roomCols(room) || p.ty >= roomRows(room)) {
      this.status.setCursor(null);
      return;
    }
    const index = p.ty * roomCols(room) + p.tx;
    const top = topTile(room, p.tx, p.ty, DRAW_LAYERS);
    const def = top ? this.ctx.assets.tileDef(top.id) : undefined;
    this.status.setCursor({
      tx: p.tx, ty: p.ty, x: p.x, y: p.y,
      tile: top ? { id: top.id, name: def?.name ?? 'Unknown tile', layer: top.layer } : null,
      collision: cellCollision(room, index, this.ctx.assets),
    });
    if ('mapCursor' in this.ctx) (this.ctx as EditorContext & MapCursorHost).mapCursor = cellTarget(this.world().id, room.id, p.tx, p.ty);
  }

  // ------------------------------------------------------------------ drawing

  private xf(): Xf {
    return { s: deviceScale(this.view.zoom, this.dpr), ox: this.view.panX, oy: this.view.panY, dpr: this.dpr };
  }

  private draw(): void {
    this.raf = 0;
    const { g, canvas } = this;
    if (!canvas.width || !canvas.height || !this.shown()) return;
    this.flush();
    if (this.needsFit) this.applyFit();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = BACKDROP;
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.status.setHint(this.state.pickPrompt !== null ? PICK_HINT : this.activeTool.hint(this));
    this.zoomLabel.textContent = `${this.zoomPercent}%`;
    // Edits, undo and room switches change what lies under a still cursor.
    if (this.hover) this.publishCursor(this.hover);
    const b = this.built;
    if (!b) return;
    const xf = this.xf();
    const w = Math.round(b.cols * TILE * xf.s);
    const h = Math.round(b.rows * TILE * xf.s);
    // Below 100% average the art instead of dropping pixels (reads better when surveying big rooms).
    g.imageSmoothingEnabled = xf.s < 1;
    if (this.state.prefs.neighbors) this.drawNeighbours(xf);
    g.fillStyle = '#000';
    g.fillRect(xf.ox, xf.oy, w, h);
    for (const layer of DRAW_LAYERS) {
      if (this.visible(layer)) g.drawImage(this.caches[layer].canvas, xf.ox, xf.oy, w, h);
    }
    g.imageSmoothingEnabled = false;
    if (this.state.prefs.collision) this.drawCollision(xf, b.room, w, h);
    drawGrid(g, xf, b.cols, b.rows, this.state.prefs.grid);
    if (this.visible('entities')) this.drawEntityLayer(xf, b.room);
    if (this.state.pickPrompt === null) this.activeTool.overlay?.(g, xf, this, this.hover);
    else this.drawPickHover(xf, b);
    g.strokeStyle = 'rgba(240,192,64,0.45)';
    g.lineWidth = Math.max(1, Math.round(this.dpr));
    g.strokeRect(xf.ox - 0.5 * g.lineWidth, xf.oy - 0.5 * g.lineWidth, w + g.lineWidth, h + g.lineWidth);
  }

  private drawNeighbours(xf: Xf): void {
    const { g, neighbours } = this;
    if (neighbours.strips.length === 0) return;
    const m = STRIP * TILE * xf.s;
    g.drawImage(neighbours.canvas, xf.ox - m, xf.oy - m, neighbours.canvas.width * xf.s, neighbours.canvas.height * xf.s);
    g.fillStyle = 'rgba(13,11,20,0.55)';
    for (const s of neighbours.strips) g.fillRect(xf.ox + s.x * xf.s, xf.oy + s.y * xf.s, s.w * xf.s, s.h * xf.s);
    for (const s of neighbours.strips) this.labelStrip(s, xf);
  }

  /** Name of a neighbour strip, on its on-screen part next to the room; skipped when too little of the strip shows. */
  private labelStrip(s: NeighbourStrip, xf: Xf): void {
    const { dpr } = this;
    const pad = 4 * dpr;
    const left = Math.max(xf.ox + s.x * xf.s, 0);
    const right = Math.min(xf.ox + (s.x + s.w) * xf.s, this.canvas.width);
    const top = Math.max(xf.oy + s.y * xf.s, 0);
    const bottom = Math.min(xf.oy + (s.y + s.h) * xf.s, this.canvas.height);
    const maxW = right - left - 2 * pad;
    if (maxW < STRIP_LABEL_MIN * dpr || bottom - top < (TAG_H + 8) * dpr) return;
    const x = s.dir === 'left' ? right - pad : left + pad;
    const y = s.dir === 'up' ? bottom - pad - TAG_H * dpr : top + pad;
    tag(this.g, x, y, s.room.name, '#a59fbd', dpr, maxW, s.dir === 'left' ? 'right' : 'left');
  }

  private drawCollision(xf: Xf, room: Room, w: number, h: number): void {
    const { g } = this;
    if (this.collisionDirty) {
      this.collision.build(room);
      this.collisionDirty = false;
    }
    g.globalAlpha = 0.55;
    g.drawImage(this.collision.canvas, xf.ox, xf.oy, w, h);
    g.globalAlpha = 1;
    drawLedgeArrows(g, xf, room, this.ctx.assets);
  }

  private drawEntityLayer(xf: Xf, room: Room): void {
    const { g, ctx } = this;
    const start = ctx.project.start;
    if (start.world === this.world().id && start.room === room.id) {
      const frame = ctx.assets.animFrame('editor.icons', 'start', 0);
      const sx = Math.round(xf.ox + start.x * xf.s);
      const sy = Math.round(xf.oy + start.y * xf.s);
      if (frame >= 0) ctx.assets.drawSpriteAt(g, 'editor.icons', frame, sx, sy, xf.s);
      tag(g, sx + 9 * xf.s, sy - 7 * xf.s, 'Start', '#58c878', this.dpr);
    }
    const hovered = this.activeTool === this.tools.entity && this.hover ? this.tools.entity.hoveredId : null;
    const roomName = (world: string, id: string): string | null => {
      const hit = locateRoom(ctx.project, id);
      return hit && hit.world.id === world ? hit.room.name : null;
    };
    drawEntities(g, xf, entityBoxes(room, ctx.assets), ctx.assets, {
      selected: ctx.entityId, hovered, label: (inst) => markerLabel(inst, roomName),
    });
  }

  private drawPickHover(xf: Xf, b: { cols: number; rows: number }): void {
    const p = this.hover;
    if (!p || p.tx < 0 || p.ty < 0 || p.tx >= b.cols || p.ty >= b.rows) return;
    const { g } = this;
    const cx = Math.round(xf.ox + (p.tx * TILE + TILE / 2) * xf.s);
    const cy = Math.round(xf.oy + (p.ty * TILE + TILE / 2) * xf.s);
    const r = TILE * xf.s;
    g.strokeStyle = '#5fd0ff';
    g.lineWidth = Math.max(2, Math.round(2 * this.dpr));
    g.strokeRect(cx - r / 2, cy - r / 2, r, r);
    g.beginPath();
    g.moveTo(cx - r, cy);
    g.lineTo(cx + r, cy);
    g.moveTo(cx, cy - r);
    g.lineTo(cx, cy + r);
    g.stroke();
  }
}
