// Art tab: asset browser (tiles / sprites / palettes / terrains) on the left,
// the pixel canvas, palette view or terrain view in the centre, and the
// selected asset's properties on the right. Owns the shared view state, routes
// keyboard shortcuts to the pixel editor, and re-reads the project whenever it
// changes (own edits, other tabs, undo): canvases redraw on the next microtask,
// DOM rebuilds wait a task and never run under a pressed pointer, so a click
// that commits a field by blurring it still lands on the control it started on.
import './art.css';
import type { EditorContext, Panel, ProjectChange } from '../context';
import { paletteById, spriteById, tileById } from '../../core/project';
import { T } from '../../content/ids';
import { el } from '../ui/dom';
import { AssetBrowser } from './browser';
import { FramesStrip } from './framesStrip';
import {
  ArtActions, createArtState, spriteAsset, tileAsset, type ArtState, type AssetKind, type PixelAsset,
} from './model';
import { PaletteView, paletteProps, type PaletteEditor } from './paletteEditor';
import { PixelEditor } from './pixelCanvas';
import { SpriteProps } from './spriteProps';
import { TerrainView, terrainProps } from './terrainEditor';
import { TileProps } from './tileProps';
import { closeTileMenu, rebuild } from './widgets';

/** Project changes that affect what the art tab shows. */
const ART_CHANGES: ReadonlySet<ProjectChange> = new Set(['tiles', 'sprites', 'palettes', 'terrains']);
/** Changes that may remove the tile or terrain the map paints with. */
const BRUSH_CHANGES: ReadonlySet<ProjectChange> = new Set(['tiles', 'terrains', 'all']);
/** Animated previews redraw at most this often (ms). */
const TICK_MS = 33;

/** Rebuild levels: re-read the data (keeping the canvas selection), or reload everything. */
const LEVEL = { none: 0, soft: 1, full: 2 } as const;
type Level = (typeof LEVEL)[keyof typeof LEVEL];

/** Input types whose keys are text entry (the pixel editor's hotkeys must not fire in them). */
const TEXT_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel']);
/** Keys a focused slider uses itself. */
const RANGE_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/**
 * Keys a focused dropdown uses itself. Letters and digits stay hotkeys: its
 * type-ahead would otherwise silently change the asset (a select keeps focus
 * after a mouse pick).
 */
const SELECT_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ', 'Escape', 'Tab']);
/** Keys that press a focused button or checkbox. */
const PRESS_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

export function mountArtTab(host: HTMLElement, ctx: EditorContext): Panel {
  const tab = new ArtTab(host, ctx);
  return { destroy: () => tab.destroy(), refresh: () => tab.refresh() };
}

function isTextEntry(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

/**
 * Whether the focused control consumes this key (text entry, a dropdown's or
 * slider's navigation, pressing a button). Space with the pointer over the
 * canvas always goes to the canvas (hold to pan) unless text is being typed.
 */
function controlOwnsKey(target: EventTarget | null, e: KeyboardEvent, overCanvas: boolean): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || isTextEntry(target)) return true;
  if (e.key === ' ' && overCanvas) return false;
  if (target instanceof HTMLSelectElement) return SELECT_KEYS.has(e.key);
  if (target instanceof HTMLInputElement && target.type === 'range') return RANGE_KEYS.has(e.key);
  return (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) && PRESS_KEYS.has(e.key);
}

/** A plain character key (what a dropdown's type-ahead would jump on). */
function isCharacterKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

class ArtTab {
  private readonly state: ArtState = createArtState();
  private readonly actions: ArtActions;
  /** What every panel needs: context, view state and undoable actions. */
  private readonly base: { ctx: EditorContext; state: ArtState; actions: ArtActions };
  private readonly root: HTMLDivElement;
  private readonly centre = el('div', { class: 'qf-art-centre' });
  private readonly props = el('div', { class: 'qf-art-props' });
  private readonly miscProps = el('div', { class: 'qf-art-props__inner' });
  private readonly browser: AssetBrowser;
  private readonly editor: PixelEditor;
  private readonly frames: FramesStrip;
  private readonly tileProps: TileProps;
  private readonly spriteProps: SpriteProps;
  private readonly paletteView: PaletteView;
  private readonly terrainView: TerrainView;
  private readonly sizeObs: ResizeObserver;
  private readonly offs: (() => void)[] = [];
  private shownKind: AssetKind | null = null;
  /** Rebuild waiting for its task (or for the pointer to be released). */
  private pending: Level = LEVEL.none;
  private rebuildTimer = 0;
  /** A pointer is pressed inside the tab: rebuilds wait until it is released. */
  private pointerHeld = false;
  /** Dropdown in the properties column opened with the pointer (its pick hands the keyboard back to the canvas). */
  private pointerSelect: HTMLSelectElement | null = null;
  /** Text field being edited and its value when editing began (Escape puts it back). */
  private fieldStart: { input: HTMLInputElement; value: string } | null = null;
  private visualQueued = false;
  private visualAll = false;
  private readonly visualIds: { kind: 'tile' | 'sprite' | 'palette'; id: string | number }[] = [];
  /** Changes arrived while hidden: reload on the next show. */
  private stale = false;
  /** The tab is rendered (tracked by the size observer; drives the animation loop). */
  private shown = false;
  private raf = 0;
  private lastTick = 0;
  private destroyed = false;

  constructor(host: HTMLElement, private readonly ctx: EditorContext) {
    this.actions = new ArtActions(ctx);
    this.initSelection();
    const base = (this.base = { ctx, state: this.state, actions: this.actions });
    this.browser = new AssetBrowser({
      ...base,
      setKind: (k) => this.setKind(k),
      select: (k, id) => this.select(k, id),
    });
    this.frames = new FramesStrip({ ...base, asset: () => this.asset(), selectFrame: (i) => this.selectFrame(i) });
    this.editor = new PixelEditor({
      ...base,
      asset: () => this.asset(),
      palette: () => this.pixelPalette(),
      stateChanged: () => this.editor.redraw(),
      stepFrame: (d) => this.stepFrame(d),
      editColour: (i) => this.editColour(i),
    }, this.frames.element);
    this.tileProps = new TileProps(base);
    this.spriteProps = new SpriteProps({
      ...base,
      originTool: () => this.editor.setTool('origin'),
      selectFrame: (i) => this.selectFrame(i),
    });
    this.paletteView = new PaletteView({ ...base, open: (k, id) => this.select(k, id) });
    this.terrainView = new TerrainView(base);
    this.root = el('div', { class: 'qf-art' }, this.browser.element, this.centre, this.props);
    host.appendChild(this.root);
    this.bind();
    this.renderAll();
    this.browser.reveal();
    this.sizeObs = new ResizeObserver(() => this.onVisibility());
    this.sizeObs.observe(this.root);
    this.onVisibility();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    clearTimeout(this.rebuildTimer);
    this.sizeObs.disconnect();
    for (const off of this.offs.splice(0)) off();
    closeTileMenu();
    this.editor.destroy();
    this.root.remove();
  }

  /** The tab was shown again: re-read everything. */
  refresh(): void {
    this.stale = false;
    this.renderAll();
    this.startLoop();
  }

  // ------------------------------------------------------------------ selection

  private initSelection(): void {
    const p = this.ctx.project;
    const sel = this.state.sel;
    sel.tile = tileById(p, this.ctx.tile) ? this.ctx.tile : p.tiles[0]?.id ?? null;
    sel.sprite = spriteById(p, 'hero') ? 'hero' : p.sprites[0]?.id ?? null;
    const tile = sel.tile === null ? undefined : tileById(p, sel.tile);
    sel.palette = tile?.palette ?? p.palettes[0]?.id ?? null;
    sel.terrain = p.terrains.find((t) => t.id === this.ctx.terrainId)?.id ?? p.terrains[0]?.id ?? null;
  }

  /** Drop selections of deleted assets (falling back to the first of the kind) and clamp the frame. */
  private validateSelection(): void {
    const p = this.ctx.project;
    const sel = this.state.sel;
    if (sel.tile === null || !tileById(p, sel.tile)) sel.tile = p.tiles[0]?.id ?? null;
    if (sel.sprite === null || !spriteById(p, sel.sprite)) sel.sprite = p.sprites[0]?.id ?? null;
    if (sel.palette === null || !paletteById(p, sel.palette)) sel.palette = p.palettes[0]?.id ?? null;
    if (!p.terrains.some((t) => t.id === sel.terrain)) sel.terrain = p.terrains[0]?.id ?? null;
    const n = this.asset()?.frames.length ?? 1;
    this.state.frame = Math.max(0, Math.min(n - 1, this.state.frame));
  }

  /** Keep the map's brushes on existing assets (a delete or an undone add can remove them). */
  private reconcileBrushes(): void {
    const p = this.ctx.project;
    if (!tileById(p, this.ctx.tile)) {
      const fallback = T.GRASS !== undefined && tileById(p, T.GRASS) ? T.GRASS : p.tiles[0]?.id;
      if (fallback !== undefined) this.ctx.selectTile(fallback);
    }
    if (this.ctx.terrainId !== null && !p.terrains.some((t) => t.id === this.ctx.terrainId)) this.ctx.selectTerrain(null);
  }

  private setKind(kind: AssetKind): void {
    if (kind !== this.state.kind) this.state.frame = 0;
    this.state.kind = kind;
    this.renderAll();
    this.browser.reveal();
  }

  private select(kind: AssetKind, id: string | number): void {
    const sel = this.state.sel as Record<AssetKind, string | number | null>;
    const sameKind = this.state.kind === kind;
    const changed = !sameKind || sel[kind] !== id;
    this.state.kind = kind;
    sel[kind] = id;
    this.browser.unhide(kind, id);
    if (changed && (kind === 'tile' || kind === 'sprite')) {
      this.state.frame = 0;
      if (kind === 'sprite') this.state.anim = null;
    }
    // Same sub-tab and the item is listed: move the highlight instead of rebuilding the list.
    if (sameKind && this.browser.lists(id)) {
      this.validateSelection();
      this.browser.markSelection();
      this.renderView(true);
    } else {
      this.renderAll();
    }
    this.browser.reveal();
  }

  private selectFrame(index: number): void {
    const n = this.asset()?.frames.length ?? 0;
    if (index < 0 || index >= n) return;
    this.state.frame = index;
    this.editor.load();
    this.frames.render();
    this.pixelProps()?.visuals();
  }

  private stepFrame(delta: number): void {
    const n = this.asset()?.frames.length ?? 0;
    if (n > 1) this.selectFrame((this.state.frame + delta + n) % n);
  }

  private editColour(index: number): void {
    const pe: PaletteEditor | undefined = this.state.kind === 'tile' ? this.tileProps.palette
      : this.state.kind === 'sprite' ? this.spriteProps.palette : undefined;
    if (!pe) return;
    pe.select(index);
    pe.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ asset access

  private asset(): PixelAsset | null {
    const { kind, sel } = this.state;
    const p = this.ctx.project;
    if (kind === 'tile' && sel.tile !== null) {
      const t = tileById(p, sel.tile);
      return t ? tileAsset(t) : null;
    }
    if (kind === 'sprite' && sel.sprite !== null) {
      const s = spriteById(p, sel.sprite);
      return s ? spriteAsset(s) : null;
    }
    return null;
  }

  private pixelPalette(): ReturnType<typeof paletteById> {
    const a = this.asset();
    return a ? paletteById(this.ctx.project, a.palette) : undefined;
  }

  private pixelProps(): TileProps | SpriteProps | null {
    return this.state.kind === 'tile' ? this.tileProps : this.state.kind === 'sprite' ? this.spriteProps : null;
  }

  // ------------------------------------------------------------------ rendering

  /** Rebuild the browser, the centre view and the properties from the project. */
  private renderAll(): void {
    this.validateSelection();
    this.browser.render();
    this.renderView(true);
  }

  /** Re-read the data after an edit (the pixel canvas keeps its selection unless the asset changed). */
  private renderSoft(): void {
    this.validateSelection();
    this.browser.render();
    this.renderView(false);
  }

  private renderView(reload: boolean): void {
    const kind = this.state.kind;
    const pixel = kind === 'tile' || kind === 'sprite';
    if (kind !== this.shownKind) {
      this.shownKind = kind;
      this.centre.replaceChildren(pixel ? this.editor.element : kind === 'palette' ? this.paletteView.element : this.terrainView.element);
      this.props.replaceChildren(kind === 'tile' ? this.tileProps.element : kind === 'sprite' ? this.spriteProps.element : this.miscProps);
      reload = true;
    }
    if (pixel) {
      this.pixelProps()!.render();
      this.frames.render();
      if (reload) this.editor.load();
      else this.editor.sync();
      return;
    }
    const p = this.ctx.project;
    if (kind === 'palette') {
      const pal = this.state.sel.palette === null ? undefined : paletteById(p, this.state.sel.palette);
      this.paletteView.render(pal?.id ?? null);
      rebuild(this.miscProps, () => pal ? paletteProps(this.base, pal) : el('div', { class: 'qf-empty' }, 'No palette selected.'));
    } else {
      const tr = p.terrains.find((t) => t.id === this.state.sel.terrain);
      this.terrainView.render(tr?.id ?? null);
      rebuild(this.miscProps, () => tr ? terrainProps(this.base, tr) : el('div', { class: 'qf-empty' }, 'No terrain selected.'));
    }
  }

  /** Redraw every canvas that shows the changed pixels or colours. */
  private renderVisuals(): void {
    const ids = this.visualAll ? null : this.visualIds.splice(0);
    this.dropVisuals();
    if (ids === null) this.browser.visuals('all');
    else for (const { kind, id } of ids) this.browser.visuals(kind, id);
    const kind = this.state.kind;
    if (kind === 'tile' || kind === 'sprite') {
      this.frames.visuals();
      this.pixelProps()!.visuals();
      this.editor.sync();
    } else if (kind === 'palette') {
      this.paletteView.visuals();
    } else {
      this.terrainView.visuals();
    }
  }

  // ------------------------------------------------------------------ events

  private bind(): void {
    const { bus } = this.ctx;
    const listen = <K extends keyof DocumentEventMap>(target: EventTarget, type: K, fn: (e: DocumentEventMap[K]) => void, capture = false): void => {
      target.addEventListener(type, fn as EventListener, capture);
      this.offs.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    this.offs.push(
      bus.on('project', ({ what }) => {
        if (BRUSH_CHANGES.has(what)) this.reconcileBrushes();
        if (what === 'all') this.queueRebuild(LEVEL.full);
        else if (ART_CHANGES.has(what)) this.queueRebuild(LEVEL.soft);
      }),
      bus.on('assets', ({ kind, id }) => this.queueVisual(kind, id)),
      bus.on('undo', () => {
        for (const pe of [this.tileProps.palette, this.spriteProps.palette, this.paletteView.editor]) pe.historyMoved();
        this.reconcileBrushes();
        this.queueRebuild(LEVEL.full);
      }),
    );
    // Capture phase: palette digits etc. must win over the shell's global shortcuts.
    listen(document, 'keydown', (e) => this.onKeyDown(e), true);
    listen(document, 'keyup', (e) => {
      if (this.pixelMode() && this.editor.handleKeyUp(e)) e.preventDefault();
    }, true);
    listen(this.root, 'keydown', (e) => this.onFieldKey(e));
    listen(this.root, 'focusin', (e) => {
      const t = e.target;
      this.fieldStart = isTextEntry(t) ? { input: t, value: t.value } : null;
    });
    listen(window, 'blur', () => {
      this.editor.releaseModifiers();
      this.releasePointer();
    });
    // Hold rebuilds while a pointer is pressed inside the tab; every way a press can end releases them.
    listen(this.root, 'pointerdown', (e) => {
      this.pointerHeld = true;
      const t = e.target;
      this.pointerSelect = t instanceof HTMLSelectElement && this.props.contains(t) ? t : null;
    }, true);
    listen(document, 'pointerup', () => this.releasePointer(), true);
    listen(document, 'pointercancel', () => this.releasePointer(), true);
    listen(document, 'dragend', () => this.releasePointer(), true);
    listen(document, 'pointermove', (e) => {
      if (this.pointerHeld && e.buttons === 0) this.releasePointer();
    }, true);
    // A select's popup can swallow the pointer release; its change means the popup has closed.
    listen(this.root, 'change', (e) => {
      if (e.target instanceof HTMLSelectElement) this.releasePointer();
    }, true);
    listen(this.root, 'change', (e) => this.onChanged(e));
  }

  private visible(): boolean {
    return this.root.isConnected && this.root.offsetParent !== null;
  }

  private pixelMode(): boolean {
    return (this.state.kind === 'tile' || this.state.kind === 'sprite') && this.visible();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target === this.pointerSelect) this.pointerSelect = null;
    if (e.defaultPrevented || !this.pixelMode() || controlOwnsKey(e.target, e, this.editor.pointerOver)) return;
    if (document.querySelector('.qf-modal-backdrop, .qf-art-pop')) return;
    // A character the editor does not use must not reach a focused dropdown's type-ahead either.
    if (this.editor.handleKey(e) || (e.target instanceof HTMLSelectElement && isCharacterKey(e))) e.preventDefault();
  }

  /**
   * Enter in a properties field commits it, Escape puts back the value it had
   * when editing began; either way the keyboard goes back to the canvas.
   */
  private onFieldKey(e: KeyboardEvent): void {
    const t = e.target;
    if ((e.key !== 'Enter' && e.key !== 'Escape') || e.defaultPrevented || e.isComposing) return;
    if (!isTextEntry(t) || this.browser.element.contains(t)) return;
    e.preventDefault();
    if (e.key === 'Escape' && this.fieldStart?.input === t) this.fieldStart.input.value = this.fieldStart.value;
    t.blur();
    if (this.pixelMode()) this.editor.focusCanvas();
  }

  /** A field committed (Escape now reverts to this value); a dropdown picked with the pointer returns the keyboard to the canvas. */
  private onChanged(e: Event): void {
    const t = e.target;
    if (this.fieldStart?.input === t) this.fieldStart.value = this.fieldStart.input.value;
    if (t instanceof HTMLSelectElement && t === this.pointerSelect) {
      this.pointerSelect = null;
      if (this.pixelMode()) this.editor.focusCanvas();
    }
  }

  /** The tab was shown or hidden (size observer): run the animation loop only while it is on screen. */
  private onVisibility(): void {
    const shown = this.visible();
    if (shown === this.shown) return;
    this.shown = shown;
    if (shown) {
      this.startLoop();
      return;
    }
    this.stopLoop();
    closeTileMenu();
    this.editor.releaseModifiers();
    this.releasePointer();
  }

  private queueVisual(kind: 'tile' | 'sprite' | 'palette' | 'all', id: string | number | undefined): void {
    if (kind === 'all' || id === undefined) this.visualAll = true;
    else this.visualIds.push({ kind, id });
    if (this.visualQueued) return;
    this.visualQueued = true;
    queueMicrotask(() => this.flushVisual());
  }

  private flushVisual(): void {
    this.visualQueued = false;
    if (this.destroyed || (!this.visualAll && this.visualIds.length === 0)) return;
    if (!this.visible()) {
      this.stale = true;
      this.dropVisuals();
      return;
    }
    this.renderVisuals();
  }

  private dropVisuals(): void {
    this.visualIds.length = 0;
    this.visualAll = false;
  }

  /** Rebuild a task later, so focus moves and clicks begun by the same input finish on the current DOM. */
  private queueRebuild(level: Level): void {
    if (level > this.pending) this.pending = level;
    if (this.rebuildTimer || this.pending === LEVEL.none) return;
    this.rebuildTimer = window.setTimeout(() => this.flushRebuild(), 0);
  }

  private flushRebuild(): void {
    this.rebuildTimer = 0;
    if (this.destroyed || this.pending === LEVEL.none || this.pointerHeld) return;
    const level = this.pending;
    this.pending = LEVEL.none;
    this.dropVisuals();
    if (!this.visible()) {
      this.stale = true;
      return;
    }
    if (level === LEVEL.full) this.renderAll();
    else this.renderSoft();
  }

  private releasePointer(): void {
    if (!this.pointerHeld) return;
    this.pointerHeld = false;
    this.queueRebuild(LEVEL.none);
  }

  private startLoop(): void {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.loop);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    if (this.stale) this.refresh();
    const t = now / 1000;
    switch (this.state.kind) {
      case 'tile':
        this.editor.tick(t);
        this.tileProps.tick(t);
        break;
      case 'sprite':
        this.editor.tick(t);
        this.spriteProps.tick(t);
        break;
      case 'terrain':
        this.terrainView.tick(t);
        break;
      default:
        break;
    }
  };
}
