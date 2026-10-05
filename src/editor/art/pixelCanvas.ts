// The pixel canvas: zoomable frame editor with checkerboard, pixel grid & 8x8
// guides, onion skin, drawing tools (pencil, eraser, line, rect, ellipse, fill,
// eyedropper, marquee select + move, sprite origin), mirror modes, frame
// transforms, clipboard, palette strip, live previews and a status line.
// Every stroke edits a working bitmap and commits one undo step on release;
// undo / redo also put the selection back where it was at that step.
import type { Palette } from '../../core/types';
import type { EditorContext } from '../context';
import { el } from '../ui/dom';
import { clamp } from '../../core/math';
import {
  boxFrom, clipBox, clearRegion, cloneBitmap, composeFloating, ellipsePoints, extractRegion, floodFill, fromBitmap,
  inBounds, liftRegion, linePoints, mirrorPoints, pixelAt, plot, rectPoints, toBitmap, transformBitmap,
  transformRegion, type Bitmap, type Box, type Floating, type Pt, type RegionTransform,
} from './ops';
import type { ArtActions, ArtState, PixelAsset, ToolId } from './model';
import { FramePreviews } from './previews';
import { fillChecker, paintBitmap, paletteColors } from './raster';
import { UnderTheHood } from './underTheHood';
import { PaletteStrip, TOOLS, Toolbar, type FrameOp, type ToggleFlag } from './tools';

/** Zoom steps (screen px per art pixel). */
const ZOOMS = [4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32] as const;
/** Pixel grid lines appear from this zoom up. */
const GRID_MIN_ZOOM = 6;
const VIEW_PAD = 24;
/** Wheel travel (px) per zoom step: one mouse notch, or a longer trackpad swipe. */
const WHEEL_STEP = 100;
/** A wheel pause longer than this (ms) starts a fresh gesture. */
const WHEEL_RESET_MS = 250;

export interface PixelEditorHost {
  readonly ctx: EditorContext;
  readonly state: ArtState;
  readonly actions: ArtActions;
  /** The tile / sprite being edited (null when none). */
  asset(): PixelAsset | null;
  palette(): Palette | undefined;
  /** Tool, colours or modes changed from inside the editor. */
  stateChanged(): void;
  /** Step the edited frame (keyboard [ / ]). */
  stepFrame(delta: number): void;
  /** Edit a colour of the asset's palette (double-click on the palette strip). */
  editColour(index: number): void;
}

/** Marquee and lifted pixels at one point of the undo history. */
interface SelState {
  selection: Box | null;
  floating: Floating | null;
}

function cloneFloating(f: Floating): Floating {
  return { base: cloneBitmap(f.base), content: cloneBitmap(f.content) };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
}

interface Stroke {
  tool: ToolId;
  value: number;
  secondary: boolean;
  before: Bitmap;
  /** Selection when the stroke began (restored when it is undone). */
  sel: SelState;
  start: Pt;
  last: Pt;
  moved: boolean;
  /** Select tool: drawing a marquee or dragging the selection. */
  mode?: 'marquee' | 'move';
  boxStart?: Pt;
}

/** Shared between every asset so art can be copied across tiles and sprites. */
let clipboard: Bitmap | null = null;

function snapZoom(z: number): number {
  let best: number = ZOOMS[0];
  for (const s of ZOOMS) if (s <= z) best = s;
  return best;
}

const LABELS: Partial<Record<ToolId, string>> = {
  pencil: 'Pencil', eraser: 'Erase', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', fill: 'Fill',
};

export class PixelEditor {
  readonly element: HTMLDivElement;
  private readonly toolbar: Toolbar;
  private readonly strip: PaletteStrip;
  private readonly previews = new FramePreviews();
  private readonly view: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly status = el('div', { class: 'qf-art-status' });
  private readonly hood = new UnderTheHood();
  private readonly resizeObs: ResizeObserver;

  private work: Bitmap | null = null;
  private loadedKey = '';
  private stroke: Stroke | null = null;
  private selection: Box | null = null;
  private floating: Floating | null = null;
  private hover: Pt | null = null;
  private originDrag: Pt | null = null;
  private altHeld = false;
  /** Space is held: a left drag pans the view. */
  private spaceHeld = false;
  private overView = false;
  private pan: { x: number; y: number } | null = null;
  private wheelAcc = 0;
  private wheelAt = 0;
  private zoom = 16;
  private antsPhase = 0;
  private fitFrame = 0;

  /** timeline = element shown between the canvas and the palette strip (the frames strip). */
  constructor(private readonly host: PixelEditorHost, timeline: HTMLElement | null = null) {
    this.toolbar = new Toolbar({
      setTool: (t) => this.setTool(t),
      toggle: (f) => this.toggle(f),
      transform: (op) => this.transform(op),
      clear: () => this.clear(),
      zoomBy: (n) => this.zoomBy(n),
      zoomFit: () => {
        this.host.state.zoom = null;
        this.fit();
      },
    });
    this.strip = new PaletteStrip({
      pick: (i, secondary) => this.pickColour(i, secondary),
      swap: () => this.swapColours(),
      edit: (i) => this.host.editColour(i),
    });
    this.canvas = el('canvas', { class: 'qf-canvas qf-art-canvas', tabIndex: 0 });
    this.view = el('div', { class: 'qf-art-view' }, el('div', { class: 'qf-art-stage' }, this.canvas));
    this.element = el('div', { class: 'qf-art-editor' },
      this.toolbar.element,
      this.view,
      timeline,
      el('div', { class: 'qf-art-bottom' }, this.strip.element, this.previews.element),
      el('div', { class: 'qf-art-statusbar' }, this.status, this.toolbar.viewBar),
      this.hood.element);
    // A clicked button would keep the keyboard and repeat its action on Space / Enter: give it back to the canvas.
    for (const bar of [this.toolbar.element, this.toolbar.viewBar, this.strip.element, timeline]) {
      bar?.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('button')) this.focusCanvas();
      });
    }
    this.bindPointer();
    // Refit on the next frame: resizing the canvas inside the callback would re-trigger layout observers.
    this.resizeObs = new ResizeObserver(() => {
      if (this.fitFrame) return;
      this.fitFrame = requestAnimationFrame(() => {
        this.fitFrame = 0;
        if (this.host.state.zoom === null) this.fit();
      });
    });
    this.resizeObs.observe(this.view);
  }

  destroy(): void {
    this.resizeObs.disconnect();
    cancelAnimationFrame(this.fitFrame);
  }

  /** Give the keyboard to the canvas (tool and colour hotkeys). */
  focusCanvas(): void {
    this.canvas.focus({ preventScroll: true });
  }

  /** The pointer is over the canvas view (Space there means pan, whatever has focus). */
  get pointerOver(): boolean {
    return this.overView;
  }

  // ------------------------------------------------------------------ loading

  /** Show the selected asset/frame; a different asset resets the selection and zoom fit. */
  load(): void {
    const a = this.host.asset();
    const key = a ? `${a.kind}:${a.id}` : '';
    if (key !== this.loadedKey.split('#')[0]) {
      this.selection = null;
      this.floating = null;
      this.host.state.zoom = null;
      if (this.host.state.tool === 'origin' && a?.kind !== 'sprite') this.host.state.tool = 'pencil';
    } else if (this.loadedKey !== `${key}#${this.host.state.frame}`) {
      this.floating = null;
    }
    this.loadedKey = `${key}#${this.host.state.frame}`;
    this.stroke = null;
    this.reloadWork();
    if (this.host.state.zoom === null) this.fit();
    else this.applyZoom(this.host.state.zoom);
  }

  /** The asset changed outside a stroke (commit, undo, palette edit): re-read it and redraw. */
  sync(): void {
    if (this.stroke) {
      this.redraw();
      return;
    }
    this.reloadWork();
    this.redraw();
  }

  private reloadWork(): void {
    const a = this.host.asset();
    const data = a?.frames[this.host.state.frame];
    if (!a || data === undefined) {
      this.work = null;
      return;
    }
    this.work = toBitmap(data, a.w, a.h);
    if (this.floating) {
      // Pixels changed under lifted content (not by this editor's own undo): the marquee no longer means anything.
      if (!this.selection || fromBitmap(composeFloating(this.floating, this.selection.x, this.selection.y)) !== data) {
        this.floating = null;
        this.selection = null;
      }
    } else if (this.selection) {
      this.selection = clipBox(this.selection, a.w, a.h);
    }
  }

  // ------------------------------------------------------------------ zoom

  private fit(): void {
    const a = this.host.asset();
    if (!a) return this.redraw();
    const vw = this.view.clientWidth - VIEW_PAD * 2;
    const vh = this.view.clientHeight - VIEW_PAD * 2;
    const z = vw > 0 && vh > 0 ? Math.floor(Math.min(vw / a.w, vh / a.h)) : 16;
    this.applyZoom(snapZoom(clamp(z, ZOOMS[0], ZOOMS[ZOOMS.length - 1])));
  }

  private zoomBy(steps: number, anchor?: { x: number; y: number }): void {
    const i = ZOOMS.indexOf(snapZoom(this.zoom) as (typeof ZOOMS)[number]);
    const next = ZOOMS[clamp(i + steps, 0, ZOOMS.length - 1)]!;
    if (next === this.zoom) return;
    const before = this.canvas.getBoundingClientRect();
    const ax = anchor ? (anchor.x - before.left) / this.zoom : 0;
    const ay = anchor ? (anchor.y - before.top) / this.zoom : 0;
    this.host.state.zoom = next;
    this.applyZoom(next);
    if (anchor) {
      const after = this.canvas.getBoundingClientRect();
      this.view.scrollLeft += after.left + ax * next - anchor.x;
      this.view.scrollTop += after.top + ay * next - anchor.y;
    }
  }

  private applyZoom(z: number): void {
    this.zoom = z;
    this.redraw();
  }

  // ------------------------------------------------------------------ drawing

  /** Redraw canvas, previews, palette strip, toolbar and status. */
  redraw(): void {
    const a = this.host.asset();
    const pal = this.host.palette();
    const rgba = paletteColors(pal);
    this.toolbar.update(this.host.state, a, this.zoom, this.canRotate());
    this.strip.update(pal, this.host.state.primary, this.host.state.secondary);
    this.element.classList.toggle('is-empty', !a || !this.work);
    if (!a || !this.work) {
      this.setStatus('Select a tile or sprite to edit.');
      return;
    }
    this.drawWork(a, this.work, rgba);
  }

  /** Canvas, previews and status only (the chrome does not change while a stroke is drawn). */
  private drawWork(a: PixelAsset, work: Bitmap, rgba: Uint32Array): void {
    this.drawCanvas(a, work, rgba);
    this.previews.update(work, rgba, a.kind === 'tile');
    this.updateStatus(a);
  }

  private drawCanvas(a: PixelAsset, work: Bitmap, rgba: Uint32Array): void {
    const z = this.zoom;
    const W = a.w * z;
    const H = a.h * z;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    fillChecker(g, 0, 0, W, H, 8);
    const prev = a.frames[this.host.state.frame - 1];
    if (this.host.state.onion && prev !== undefined) paintBitmap(g, toBitmap(prev, a.w, a.h), rgba, 0, 0, z, 0.3);
    paintBitmap(g, work, rgba, 0, 0, z);
    if (this.host.state.grid) this.drawGrid(g, a, z, dpr);
    this.drawHover(g, a, z, rgba);
    if (this.selection) this.drawSelection(g, this.selection, z);
    if (a.kind === 'sprite') this.drawOrigin(g, a, z);
  }

  private drawGrid(g: CanvasRenderingContext2D, a: PixelAsset, z: number, dpr: number): void {
    const line = 1 / dpr;
    const W = a.w * z;
    const H = a.h * z;
    if (z >= GRID_MIN_ZOOM) {
      g.fillStyle = 'rgba(150, 144, 180, 0.22)';
      for (let x = 1; x < a.w; x++) g.fillRect(x * z, 0, line, H);
      for (let y = 1; y < a.h; y++) g.fillRect(0, y * z, W, line);
    }
    for (let x = 8; x < a.w; x += 8) {
      g.fillStyle = x % 16 === 0 ? 'rgba(240, 192, 64, 0.85)' : 'rgba(240, 192, 64, 0.45)';
      g.fillRect(x * z, 0, line, H);
    }
    for (let y = 8; y < a.h; y += 8) {
      g.fillStyle = y % 16 === 0 ? 'rgba(240, 192, 64, 0.85)' : 'rgba(240, 192, 64, 0.45)';
      g.fillRect(0, y * z, W, line);
    }
  }

  private drawHover(g: CanvasRenderingContext2D, a: PixelAsset, z: number, rgba: Uint32Array): void {
    const p = this.hover;
    const tool = this.effectiveTool();
    if (!p || this.stroke?.tool === 'select' || tool === 'select' || tool === 'origin' || !this.work || !inBounds(this.work, p.x, p.y)) return;
    const pts = tool === 'eyedropper' ? [p] : mirrorPoints([p], a.w, a.h, this.host.state.mirrorX, this.host.state.mirrorY);
    const idx = tool === 'eraser' || tool === 'eyedropper' ? 0 : this.host.state.primary;
    for (const q of pts) {
      if (idx !== 0 && !this.stroke) {
        const c = rgba[idx]!;
        g.fillStyle = `rgba(${c & 255}, ${(c >>> 8) & 255}, ${(c >>> 16) & 255}, 0.75)`;
        g.fillRect(q.x * z, q.y * z, z, z);
      }
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.strokeRect(q.x * z + 0.5, q.y * z + 0.5, z - 1, z - 1);
      g.strokeStyle = '#fff';
      g.strokeRect(q.x * z + 1.5, q.y * z + 1.5, z - 3, z - 3);
    }
  }

  private drawSelection(g: CanvasRenderingContext2D, box: Box, z: number): void {
    g.save();
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.strokeStyle = '#000';
    g.lineDashOffset = -this.antsPhase;
    g.strokeRect(box.x * z + 0.5, box.y * z + 0.5, box.w * z - 1, box.h * z - 1);
    g.strokeStyle = '#fff';
    g.lineDashOffset = -this.antsPhase + 4;
    g.strokeRect(box.x * z + 0.5, box.y * z + 0.5, box.w * z - 1, box.h * z - 1);
    g.restore();
  }

  private drawOrigin(g: CanvasRenderingContext2D, a: PixelAsset, z: number): void {
    const def = this.host.ctx.assets.spriteDef(String(a.id));
    if (!def) return;
    const o = this.originDrag ?? { x: def.ox, y: def.oy };
    const x = o.x * z;
    const y = o.y * z;
    const active = this.host.state.tool === 'origin';
    g.save();
    g.strokeStyle = active ? 'rgba(88, 200, 240, 0.95)' : 'rgba(88, 200, 240, 0.5)';
    g.lineWidth = 1;
    g.setLineDash(active ? [] : [3, 3]);
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, a.h * z);
    g.moveTo(0, y + 0.5);
    g.lineTo(a.w * z, y + 0.5);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(x + 0.5, y + 0.5, Math.max(4, z / 3), 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private updateStatus(a: PixelAsset): void {
    const parts = [`${a.w}×${a.h}`, `frame ${this.host.state.frame + 1}/${a.frames.length}`];
    if (this.hover && this.work && inBounds(this.work, this.hover.x, this.hover.y)) {
      parts.unshift(`x ${this.hover.x}, y ${this.hover.y} · index ${pixelAt(this.work, this.hover.x, this.hover.y)}`);
    }
    if (this.selection) parts.push(`selection ${this.selection.w}×${this.selection.h} at ${this.selection.x},${this.selection.y}`);
    const tool = TOOLS.find((t) => t.id === this.effectiveTool());
    if (tool) parts.push(`${tool.label}: ${tool.hint}`);
    this.setStatus(parts.join('  ·  '));
    if (this.work) this.hood.update(a, this.work, this.hover, this.host.palette());
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.title = text;
  }

  /** Animate the selection's marching ants (called every animation frame). */
  tick(t: number): void {
    if (!this.selection) return;
    const phase = Math.floor(t * 12) % 8;
    if (phase === this.antsPhase) return;
    this.antsPhase = phase;
    this.redrawCanvasOnly();
  }

  private redrawCanvasOnly(): void {
    const a = this.host.asset();
    if (a && this.work) this.drawCanvas(a, this.work, paletteColors(this.host.palette()));
  }

  // ------------------------------------------------------------------ state changes

  setTool(t: ToolId): void {
    if (t === 'origin' && this.host.asset()?.kind !== 'sprite') return;
    this.host.state.tool = t;
    this.updateCursor();
    this.host.stateChanged();
  }

  private toggle(flag: ToggleFlag): void {
    this.host.state[flag] = !this.host.state[flag];
    this.host.stateChanged();
  }

  private pickColour(i: number, secondary: boolean): void {
    if (secondary) this.host.state.secondary = i;
    else this.host.state.primary = i;
    this.host.stateChanged();
  }

  private swapColours(): void {
    const s = this.host.state;
    [s.primary, s.secondary] = [s.secondary, s.primary];
    this.host.stateChanged();
  }

  private effectiveTool(): ToolId {
    return this.altHeld && !this.stroke ? 'eyedropper' : this.host.state.tool;
  }

  private updateCursor(): void {
    const tool = this.effectiveTool();
    const inside = tool === 'select' && this.hover && this.selection && this.insideSelection(this.hover);
    this.canvas.style.cursor = this.pan ? 'grabbing' : this.spaceHeld ? 'grab' : inside ? 'move' : tool === 'eyedropper' ? 'copy' : 'crosshair';
  }

  // ------------------------------------------------------------------ pointer

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => this.cancelStroke());
    // Capture lost without a pointerup reaching the canvas: keep the stroke instead of leaving it stuck.
    c.addEventListener('lostpointercapture', () => {
      if (this.stroke) this.finish();
    });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      const a = this.host.asset();
      this.redrawCanvasOnly();
      if (a && this.work) this.updateStatus(a);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.view.addEventListener('pointerenter', () => { this.overView = true; });
    this.view.addEventListener('pointerleave', () => { this.overView = false; });
    this.view.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  /** Vertical wheel zooms one step per notch (trackpad swipes accumulate); sideways scrolling pans natively. */
  private onWheel(e: WheelEvent): void {
    if (!this.host.asset() || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    const dy = e.deltaY * unit;
    if (e.timeStamp - this.wheelAt > WHEEL_RESET_MS || Math.sign(this.wheelAcc) !== Math.sign(dy)) this.wheelAcc = 0;
    this.wheelAt = e.timeStamp;
    this.wheelAcc += dy;
    const steps = Math.trunc(this.wheelAcc / WHEEL_STEP);
    if (steps === 0) return;
    this.wheelAcc -= steps * WHEEL_STEP;
    this.zoomBy(-steps, { x: e.clientX, y: e.clientY });
  }

  private pixelAt(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / this.zoom), y: Math.floor((e.clientY - r.top) / this.zoom) };
  }

  private cornerAt(e: PointerEvent, a: PixelAsset): Pt {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: clamp(Math.round((e.clientX - r.left) / this.zoom), 0, a.w),
      y: clamp(Math.round((e.clientY - r.top) / this.zoom), 0, a.h),
    };
  }

  private onDown(e: PointerEvent): void {
    const a = this.host.asset();
    if (!a || !this.work || this.stroke) return;
    this.canvas.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pixelAt(e);
    const secondary = e.button === 2;
    const tool = e.altKey ? 'eyedropper' : this.host.state.tool;
    const s = this.host.state;
    const value = tool === 'eraser' ? 0 : secondary ? s.secondary : s.primary;
    const sel = this.selState();
    if (tool !== 'select' && tool !== 'eyedropper' && tool !== 'origin') this.floating = null;
    this.stroke = { tool, value, secondary, before: cloneBitmap(this.work), sel, start: p, last: p, moved: false };
    switch (tool) {
      case 'pencil':
      case 'eraser':
        this.paint([p]);
        break;
      case 'fill':
        this.fillAt(p, value);
        this.finish();
        return;
      case 'eyedropper':
        this.pick(p, secondary);
        break;
      case 'select':
        this.beginSelect(p);
        break;
      case 'origin':
        this.originDrag = this.cornerAt(e, a);
        break;
      default:
        this.shape(p, e.shiftKey);
    }
    this.redraw();
  }

  private onMove(e: PointerEvent): void {
    const a = this.host.asset();
    if (!a) return;
    if (this.pan) {
      this.view.scrollLeft -= e.clientX - this.pan.x;
      this.view.scrollTop -= e.clientY - this.pan.y;
      this.pan = { x: e.clientX, y: e.clientY };
      return;
    }
    // The release happened where the canvas could not see it (e.g. in another window): end the stroke there.
    if (this.stroke && e.buttons === 0) {
      this.finish();
      return;
    }
    const p = this.pixelAt(e);
    const st = this.stroke;
    // Freehand strokes and hovering only care about pixel changes; shapes re-evaluate every move so
    // Shift can be pressed mid-drag, and the origin follows pixel corners.
    const samePixel = this.hover?.x === p.x && this.hover?.y === p.y;
    if (samePixel && (!st || st.tool === 'pencil' || st.tool === 'eraser')) return;
    this.hover = p;
    if (st) {
      st.moved ||= p.x !== st.start.x || p.y !== st.start.y;
      switch (st.tool) {
        case 'pencil':
        case 'eraser':
          this.paint(linePoints(st.last, p));
          break;
        case 'eyedropper':
          this.pick(p, st.secondary);
          break;
        case 'select':
          this.dragSelect(p);
          break;
        case 'origin':
          this.originDrag = this.cornerAt(e, a);
          break;
        case 'line':
        case 'rect':
        case 'ellipse':
          this.shape(p, e.shiftKey);
          break;
        default:
          break;
      }
      st.last = p;
      if (this.work) this.drawWork(a, this.work, paletteColors(this.host.palette()));
    } else {
      this.updateCursor();
      this.redrawCanvasOnly();
      this.updateStatus(a);
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pan) {
      this.pan = null;
      this.updateCursor();
      return;
    }
    if (this.stroke) this.finish();
  }

  /** Abandon the current stroke: pixels, a dragged selection and the origin go back to where it started. */
  private cancelStroke(): void {
    this.pan = null;
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    this.originDrag = null;
    this.selection = st.sel.selection;
    this.floating = st.sel.floating;
    this.work = st.before;
    this.updateCursor();
    this.redraw();
  }

  /** End the current stroke: commit pixels / selection / origin as one undo step. */
  private finish(): void {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    if (st.tool === 'select') {
      if (st.mode === 'marquee' && !st.moved) this.selection = null;
      if (st.mode === 'move' && st.moved) this.commit('Move selection', st.sel);
    } else if (st.tool === 'origin') {
      this.commitOrigin();
    } else if (st.tool !== 'eyedropper') {
      this.commit(LABELS[st.tool] ?? 'Draw', st.sel);
    }
    this.updateCursor();
    this.redraw();
  }

  /** Record the working bitmap as one undo step; undo / redo also restore the selection (`before` / now). */
  private commit(label: string, before: SelState): void {
    const a = this.host.asset();
    if (!a || !this.work) return;
    const key = this.loadedKey;
    const after = this.selState();
    this.host.actions.setFrame(a, this.host.state.frame, fromBitmap(this.work), `${label} (${a.kind} ${a.id})`, {
      undo: () => this.restoreSelection(key, after, before),
      redo: () => this.restoreSelection(key, before, after),
    });
  }

  private selState(): SelState {
    return { selection: this.selection && { ...this.selection }, floating: this.floating && cloneFloating(this.floating) };
  }

  /**
   * Undo / redo moved the frame `key` from the step that left selection `from`
   * to the one with `to`: show `to` if that frame is on the canvas and the user
   * has not picked another selection (or deselected) since.
   */
  private restoreSelection(key: string, from: SelState, to: SelState): void {
    if (key !== this.loadedKey || this.stroke || !sameBox(this.selection, from.selection)) return;
    this.selection = to.selection && { ...to.selection };
    this.floating = to.floating && cloneFloating(to.floating);
  }

  private commitOrigin(): void {
    const a = this.host.asset();
    const o = this.originDrag;
    this.originDrag = null;
    if (!a || a.kind !== 'sprite' || !o) return;
    this.host.actions.edit('sprite', String(a.id), 'Move sprite origin', (def) => {
      def.ox = o.x;
      def.oy = o.y;
    });
  }

  // ------------------------------------------------------------------ tools

  private mask(): Box | null {
    return this.selection;
  }

  private paint(pts: Pt[]): void {
    const a = this.host.asset();
    const st = this.stroke;
    if (!a || !st || !this.work) return;
    plot(this.work, mirrorPoints(pts, a.w, a.h, this.host.state.mirrorX, this.host.state.mirrorY), st.value, this.mask());
  }

  private shape(p: Pt, shift: boolean): void {
    const a = this.host.asset();
    const st = this.stroke;
    if (!a || !st) return;
    const work = cloneBitmap(st.before);
    let pts: Pt[];
    if (st.tool === 'line') pts = linePoints(st.start, shift ? snap45(st.start, p) : p);
    else if (st.tool === 'rect') pts = rectPoints(st.start, p, shift);
    else pts = ellipsePoints(st.start, p, shift);
    plot(work, mirrorPoints(pts, a.w, a.h, this.host.state.mirrorX, this.host.state.mirrorY), st.value, this.mask());
    this.work = work;
  }

  private fillAt(p: Pt, value: number): void {
    const a = this.host.asset();
    if (!a || !this.work) return;
    const before = cloneBitmap(this.work);
    for (const q of mirrorPoints([p], a.w, a.h, this.host.state.mirrorX, this.host.state.mirrorY)) {
      const probe = cloneBitmap(before);
      floodFill(probe, q.x, q.y, value, this.mask());
      for (let i = 0; i < probe.px.length; i++) if (probe.px[i] !== before.px[i]) this.work.px[i] = probe.px[i]!;
    }
  }

  private pick(p: Pt, secondary: boolean): void {
    if (!this.work || !inBounds(this.work, p.x, p.y)) return;
    this.pickColour(pixelAt(this.work, p.x, p.y), secondary);
  }

  private insideSelection(p: Pt): boolean {
    const b = this.selection;
    return !!b && p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h;
  }

  private beginSelect(p: Pt): void {
    const st = this.stroke!;
    if (this.selection && this.insideSelection(p)) {
      st.mode = 'move';
      if (!this.floating) this.floating = liftRegion(this.work!, this.selection);
      st.boxStart = { x: this.selection.x, y: this.selection.y };
    } else {
      st.mode = 'marquee';
      this.floating = null;
      this.selection = this.marquee(p, p);
    }
  }

  private dragSelect(p: Pt): void {
    const st = this.stroke!;
    const a = this.host.asset()!;
    if (st.mode === 'move' && this.selection && this.floating && st.boxStart) {
      this.selection = { ...this.selection, x: st.boxStart.x + p.x - st.start.x, y: st.boxStart.y + p.y - st.start.y };
      this.work = composeFloating(this.floating, this.selection.x, this.selection.y);
    } else {
      this.selection = this.marquee(st.start, { x: clamp(p.x, 0, a.w - 1), y: clamp(p.y, 0, a.h - 1) });
    }
  }

  private marquee(a: Pt, b: Pt): Box | null {
    const asset = this.host.asset();
    return asset ? clipBox(boxFrom(a, b), asset.w, asset.h) : null;
  }

  // ------------------------------------------------------------------ frame operations

  private canRotate(): boolean {
    const a = this.host.asset();
    if (!a) return false;
    const b = this.floating ? this.floating.content : this.selection ?? { w: a.w, h: a.h };
    return b.w === b.h;
  }

  /** Flip / rotate / shift the selection (floating content if lifted) or the whole frame. */
  transform(op: FrameOp | RegionTransform): void {
    if (!this.work || this.stroke) return;
    if (op === 'rotate' && !this.canRotate()) return;
    const before = this.selState();
    if (this.floating && this.selection) {
      this.floating.content = transformBitmap(this.floating.content, op);
      this.selection = { ...this.selection, w: this.floating.content.w, h: this.floating.content.h };
      this.work = composeFloating(this.floating, this.selection.x, this.selection.y);
    } else {
      const work = cloneBitmap(this.work);
      transformRegion(work, this.selection, op);
      this.work = work;
    }
    this.commit(typeof op === 'string' ? { flipX: 'Flip H', flipY: 'Flip V', rotate: 'Rotate' }[op] : 'Shift', before);
    this.redraw();
  }

  /** Clear the selection area, or the whole frame when nothing is selected. */
  clear(): void {
    if (!this.work || this.stroke) return;
    const a = this.host.asset()!;
    const before = this.selState();
    const work = cloneBitmap(this.work);
    const clipped = clipBox(this.selection ?? { x: 0, y: 0, w: a.w, h: a.h }, a.w, a.h);
    if (clipped) clearRegion(work, clipped);
    this.floating = null;
    this.work = work;
    this.commit('Clear', before);
    this.redraw();
  }

  private nudge(dx: number, dy: number): void {
    if (!this.work || !this.selection || this.stroke) return;
    const before = this.selState();
    if (!this.floating) this.floating = liftRegion(this.work, this.selection);
    this.selection = { ...this.selection, x: this.selection.x + dx, y: this.selection.y + dy };
    this.work = composeFloating(this.floating, this.selection.x, this.selection.y);
    this.commit('Nudge selection', before);
    this.redraw();
  }

  private copy(): void {
    const a = this.host.asset();
    if (!a || !this.work) return;
    const box = this.selection ? clipBox(this.selection, a.w, a.h) : { x: 0, y: 0, w: a.w, h: a.h };
    if (!box) return;
    clipboard = this.floating && this.selection ? cloneBitmap(this.floating.content) : extractRegion(this.work, box);
    this.host.ctx.toast(`Copied ${clipboard.w}×${clipboard.h} pixels`);
  }

  private paste(): void {
    const a = this.host.asset();
    if (!a || !this.work || !clipboard) return;
    const before = this.selState();
    const box = { x: this.selection?.x ?? 0, y: this.selection?.y ?? 0, w: clipboard.w, h: clipboard.h };
    this.floating = { base: cloneBitmap(this.work), content: cloneBitmap(clipboard) };
    this.selection = box;
    this.work = composeFloating(this.floating, box.x, box.y);
    this.commit('Paste', before);
    this.setTool('select');
    this.redraw();
  }

  private selectAll(): void {
    const a = this.host.asset();
    if (!a) return;
    this.floating = null;
    this.selection = { x: 0, y: 0, w: a.w, h: a.h };
    this.redraw();
  }

  private deselect(): void {
    this.floating = null;
    this.selection = null;
    this.redraw();
  }

  // ------------------------------------------------------------------ keyboard

  /**
   * Handle a key while the pixel editor is showing; true if consumed. While a
   * stroke is drawn every key is held back (no undo, tab or tool switch under
   * the pen) and Escape cancels the stroke.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (this.stroke) {
      if (e.key === 'Escape') this.cancelStroke();
      return true;
    }
    if (e.key === 'Alt') {
      this.setAlt(true);
      return true;
    }
    if (e.code === 'Space') {
      this.setSpace(true);
      return true;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const arrow = ARROWS[e.key];
    if (ctrl && !e.altKey) {
      if (arrow) {
        this.transform({ shift: arrow });
        return true;
      }
      const act: Record<string, () => void> = {
        KeyA: () => this.selectAll(),
        KeyD: () => this.deselect(),
        KeyC: () => this.copy(),
        KeyX: () => {
          this.copy();
          this.clear();
        },
        KeyV: () => this.paste(),
      };
      const fn = act[e.code];
      if (!fn) return false;
      fn();
      return true;
    }
    if (e.altKey) return false;
    return this.plainKey(e, arrow);
  }

  private plainKey(e: KeyboardEvent, arrow: Pt | undefined): boolean {
    if (arrow) {
      if (!this.selection) return false;
      this.nudge(arrow.x, arrow.y);
      return true;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      const index = e.shiftKey ? 10 + n : n;
      if (index > 15) return false;
      this.pickColour(index, false);
      return true;
    }
    if (e.shiftKey) {
      const op = ({ KeyH: 'flipX', KeyV: 'flipY', KeyR: 'rotate' } as Record<string, FrameOp>)[e.code];
      if (!op) return false;
      this.transform(op);
      return true;
    }
    const tool = TOOLS.find((t) => `Key${t.key}` === e.code);
    if (tool) {
      this.setTool(tool.id);
      return true;
    }
    switch (e.code) {
      case 'KeyX': this.swapColours(); return true;
      case 'Delete':
      case 'Backspace':
        if (!this.selection) return false;
        this.clear();
        return true;
      case 'Escape':
        if (!this.selection) return false;
        this.deselect();
        return true;
      case 'BracketLeft': this.host.stepFrame(-1); return true;
      case 'BracketRight': this.host.stepFrame(1); return true;
      default: return false;
    }
  }

  /** Key released anywhere (Alt ends the temporary eyedropper, Space the pan mode); true if consumed. */
  handleKeyUp(e: KeyboardEvent): boolean {
    if (e.key === 'Alt') {
      this.setAlt(false);
      return true;
    }
    if (e.code !== 'Space' || !this.spaceHeld) return false;
    this.setSpace(false);
    return true;
  }

  /** The window lost focus: forget held modifiers (their keyup never arrives). */
  releaseModifiers(): void {
    this.setAlt(false);
    this.setSpace(false);
  }

  private setSpace(on: boolean): void {
    if (this.spaceHeld === on) return;
    this.spaceHeld = on;
    this.updateCursor();
  }

  private setAlt(on: boolean): void {
    if (this.altHeld === on) return;
    this.altHeld = on;
    this.updateCursor();
    this.redraw();
  }
}

const ARROWS: Record<string, Pt> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** End point snapped to the nearest 45° direction from start. */
function snap45(start: Pt, p: Pt): Pt {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: p.x, y: start.y };
  if (ady > adx * 2) return { x: start.x, y: p.y };
  const d = Math.max(adx, ady);
  return { x: start.x + Math.sign(dx) * d, y: start.y + Math.sign(dy) * d };
}
