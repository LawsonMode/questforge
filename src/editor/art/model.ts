// Art tab model: view state shared by the art panels, the pixel-asset view of
// tiles & sprites, and ArtActions — every undoable mutation the art editor
// performs (frame strokes, def edits, add/remove) with the matching
// ctx.changed / ctx.assetsChanged notifications.
import type { Palette, PixelData, Project, SpriteDef, Terrain, TileDef } from '../../core/types';
import type { EditorContext, ProjectChange } from '../context';
import type { UndoCommand } from '../undo';
import { TILE } from '../../core/constants';

export type AssetKind = 'tile' | 'sprite' | 'palette' | 'terrain';

export type ToolId = 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'eyedropper' | 'select' | 'origin';

/** Editor view state (not saved in the project). */
export interface ArtState {
  /** Browser sub-tab = kind of the asset being edited. */
  kind: AssetKind;
  /** Selected asset per kind (tile ids are numbers). */
  sel: { tile: number | null; sprite: string | null; palette: string | null; terrain: string | null };
  /** Frame of the selected tile/sprite on the canvas. */
  frame: number;
  tool: ToolId;
  /** Palette indices for the left / right mouse button. */
  primary: number;
  secondary: number;
  mirrorX: boolean;
  mirrorY: boolean;
  onion: boolean;
  grid: boolean;
  /** Canvas zoom (4-32); null = fit to the view. */
  zoom: number | null;
  /** Selected sprite animation (preview + table highlight). */
  anim: string | null;
  /** Tile animation preview playing. */
  playing: boolean;
}

export function createArtState(): ArtState {
  return {
    kind: 'tile',
    sel: { tile: null, sprite: null, palette: null, terrain: null },
    frame: 0,
    tool: 'pencil',
    primary: 1,
    secondary: 0,
    mirrorX: false,
    mirrorY: false,
    onion: false,
    grid: true,
    zoom: null,
    anim: null,
    playing: true,
  };
}

/** A tile or sprite seen as editable pixel frames (frames is the live def array). */
export interface PixelAsset {
  kind: 'tile' | 'sprite';
  id: number | string;
  w: number;
  h: number;
  palette: string;
  frames: PixelData[];
}

export function tileAsset(t: TileDef): PixelAsset {
  return { kind: 'tile', id: t.id, w: TILE, h: TILE, palette: t.palette, frames: t.frames };
}

export function spriteAsset(s: SpriteDef): PixelAsset {
  return { kind: 'sprite', id: s.id, w: s.w, h: s.h, palette: s.palette, frames: s.frames };
}

/** Editor state to put back when a frame edit is undone / redone. */
export interface FrameRestore {
  undo(): void;
  redo(): void;
}

interface KindMap { tile: TileDef; sprite: SpriteDef; palette: Palette; terrain: Terrain }
type IdOf<K extends AssetKind> = KindMap[K]['id'];

/** The project array holding assets of a kind. */
function collection<K extends AssetKind>(p: Project, kind: K): KindMap[K][] {
  const arrays = { tile: p.tiles, sprite: p.sprites, palette: p.palettes, terrain: p.terrains };
  return arrays[kind] as KindMap[K][];
}

function findAsset<K extends AssetKind>(p: Project, kind: K, id: IdOf<K>): KindMap[K] | undefined {
  return collection(p, kind).find((a) => a.id === id);
}

/** `base` if it is free, else the first free of base2, base3, ... (asset ids, tile keys). */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** First free `${prefix}${n}` for n = 1, 2, ... */
export function numberedId(prefix: string, taken: ReadonlySet<string>): { id: string; n: number } {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return { id: `${prefix}${n}`, n };
}

const CHANGE: Readonly<Record<AssetKind, ProjectChange>> = {
  tile: 'tiles', sprite: 'sprites', palette: 'palettes', terrain: 'terrains',
};

/** Replace an object's own fields with a JSON snapshot's, keeping its identity. */
function restoreInPlace(target: object, snapshot: string): void {
  const rec = target as Record<string, unknown>;
  const src = JSON.parse(snapshot) as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (!(k in src)) delete rec[k];
  Object.assign(rec, src);
}

/** Undoable art mutations; each applies, records one undo step and notifies the editor. */
export class ArtActions {
  /** Commands collected by group() (null = push straight to the undo stack). */
  private batch: UndoCommand[] | null = null;

  constructor(private readonly ctx: EditorContext) {}

  /** Run several actions as a single undo step (nested groups join the outer one). */
  group(label: string, fn: () => void): void {
    if (this.batch) {
      fn();
      return;
    }
    const cmds: UndoCommand[] = [];
    this.batch = cmds;
    try {
      fn();
    } finally {
      this.batch = null;
    }
    if (cmds.length === 1) this.ctx.undo.push(cmds[0]!);
    else if (cmds.length > 1) {
      this.ctx.undo.push({
        label,
        undo: () => [...cmds].reverse().forEach((c) => c.undo()),
        redo: () => cmds.forEach((c) => c.redo()),
      });
    }
  }

  private push(cmd: UndoCommand): void {
    if (this.batch) this.batch.push(cmd);
    else this.ctx.undo.push(cmd);
  }

  /** Notify the shell that an asset changed (pixels = its images must be re-rasterised). */
  private notify(kind: AssetKind, id: string | number, pixels: boolean): void {
    this.ctx.changed(CHANGE[kind], String(id));
    if (pixels && kind !== 'terrain') this.ctx.assetsChanged(kind, id);
  }

  /**
   * Replace one frame of a tile/sprite (one undo step; only assetsChanged fires).
   * `restore` runs after undo / redo re-applied the pixels (the pixel editor puts
   * its selection back with them).
   */
  setFrame(asset: PixelAsset, index: number, data: PixelData, label: string, restore?: FrameRestore): void {
    const before = asset.frames[index];
    if (before === undefined || before === data) return;
    const apply = (v: PixelData): void => {
      const def = asset.kind === 'tile'
        ? findAsset(this.ctx.project, 'tile', asset.id as number)
        : findAsset(this.ctx.project, 'sprite', asset.id as string);
      if (!def || index >= def.frames.length) return;
      def.frames[index] = v;
      this.ctx.assetsChanged(asset.kind, asset.id);
    };
    apply(data);
    this.push({
      label,
      undo: () => {
        apply(before);
        restore?.undo();
      },
      redo: () => {
        apply(data);
        restore?.redo();
      },
    });
  }

  /**
   * Mutate one asset in place as a single undo step (JSON snapshot before/after).
   * pixels = the edit affects its images (frames, size, palette, colours).
   */
  edit<K extends AssetKind>(kind: K, id: IdOf<K>, label: string, mutate: (def: KindMap[K]) => void, pixels = false): void {
    const def = findAsset(this.ctx.project, kind, id);
    if (!def) return;
    const before = JSON.stringify(def);
    mutate(def);
    this.record(kind, def, id, before, label, pixels);
  }

  /** JSON snapshot of an asset (pass it to commitSince after live edits), or null if it is missing. */
  snapshot<K extends AssetKind>(kind: K, id: IdOf<K>): string | null {
    const def = findAsset(this.ctx.project, kind, id);
    return def ? JSON.stringify(def) : null;
  }

  /** Re-rasterise an asset that was changed in place without an undo step yet (e.g. while a slider drags). */
  live(kind: 'tile' | 'sprite' | 'palette', id: string | number): void {
    this.ctx.assetsChanged(kind, id);
  }

  /** Record every change made to an asset since `before` (its snapshot) as one undo step and notify. */
  commitSince<K extends AssetKind>(kind: K, id: IdOf<K>, before: string, label: string, pixels = false): void {
    const def = findAsset(this.ctx.project, kind, id);
    if (def) this.record(kind, def, id, before, label, pixels);
  }

  /** Push the undo step for an in-place edit of `def` (known as `id` before it) and notify. */
  private record<K extends AssetKind>(kind: K, def: KindMap[K], id: IdOf<K>, before: string, label: string, pixels: boolean): void {
    const after = JSON.stringify(def);
    if (before === after) return;
    const newId = def.id as IdOf<K>;
    const apply = (snap: string, findId: IdOf<K>): void => {
      const target = findAsset(this.ctx.project, kind, findId);
      if (!target) return;
      restoreInPlace(target, snap);
      this.notify(kind, target.id, pixels);
    };
    this.notify(kind, newId, pixels);
    this.push({ label, undo: () => apply(before, newId), redo: () => apply(after, id) });
  }

  /** Insert a new asset (at `index`, default the end) as one undo step. */
  add<K extends AssetKind>(kind: K, item: KindMap[K], label: string, index?: number): void {
    const arr = collection(this.ctx.project, kind);
    const at = index === undefined ? arr.length : Math.max(0, Math.min(arr.length, index));
    const snap = JSON.stringify(item);
    const insert = (obj: KindMap[K]): void => {
      const list = collection(this.ctx.project, kind);
      list.splice(Math.min(at, list.length), 0, obj);
      this.notify(kind, obj.id, true);
    };
    const remove = (): void => {
      const list = collection(this.ctx.project, kind);
      const i = list.findIndex((a) => a.id === item.id);
      if (i >= 0) list.splice(i, 1);
      this.notify(kind, item.id, true);
    };
    insert(item);
    this.push({ label, undo: remove, redo: () => insert(JSON.parse(snap) as KindMap[K]) });
  }

  /** Remove an asset as one undo step (undo restores it at the same position). */
  remove<K extends AssetKind>(kind: K, id: IdOf<K>, label: string): void {
    const arr = collection(this.ctx.project, kind);
    const at = arr.findIndex((a) => a.id === id);
    if (at < 0) return;
    const snap = JSON.stringify(arr[at]);
    const drop = (): void => {
      const list = collection(this.ctx.project, kind);
      const i = list.findIndex((a) => a.id === id);
      if (i >= 0) list.splice(i, 1);
      this.notify(kind, id, true);
    };
    const restore = (): void => {
      const list = collection(this.ctx.project, kind);
      list.splice(Math.min(at, list.length), 0, JSON.parse(snap) as KindMap[K]);
      this.notify(kind, id, true);
    };
    drop();
    this.push({ label, undo: restore, redo: drop });
  }
}
