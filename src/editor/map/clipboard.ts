// Tile clipboard for the Select tool: copy a marquee of one or all layers,
// clear it, and stamp it elsewhere (any room, any project). A clip remembers
// its project and snapshots the custom tiles it uses, so a paste never writes
// tile ids the target project does not have: a tile deleted since the copy is
// skipped, and another project's custom tiles come along as copies (or reuse
// an identical tile already there). Pure data, no DOM.
import type { LayerName, Project, Room, TileDef } from '../../core/types';
import type { CellRect } from './geometry';
import type { TileEdit } from './tileEdit';
import { USER_TILE_BASE, roomCols, roomRows, tileById } from '../../core/project';
import { clipRect } from './geometry';

/** A copied block of tiles; `layers` holds w*h row-major ids per copied layer. */
export interface TileClip {
  w: number;
  h: number;
  layers: Partial<Record<LayerName, number[]>>;
  /** Id of the project the tiles were copied from ('' = unknown: every custom id counts as foreign). */
  project: string;
  /** Snapshots (as copied) of the custom tiles the clip uses and of those they turn into (cut, lift, bomb, dash). */
  defs: Record<number, TileDef>;
}

/** TileDef fields naming the tile it turns into. */
const TRANSFORMS = ['cut', 'lift', 'bomb', 'dash'] as const;

/** Copy the part of `rect` inside the room (never wrapping into the next row) of the given layers. */
export function copyRegion(room: Room, rect: CellRect, layers: readonly LayerName[], project?: Project): TileClip {
  const cols = roomCols(room);
  const r = clipRect(rect, cols, roomRows(room)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const clip: TileClip = { w: r.w, h: r.h, layers: {}, project: project?.id ?? '', defs: {} };
  const used = new Set<number>();
  for (const layer of layers) {
    const src = room.layers[layer];
    const out: number[] = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const id = src[y * cols + x] ?? 0;
        out.push(id);
        used.add(id);
      }
    }
    clip.layers[layer] = out;
  }
  if (project) clip.defs = customDefs(project, used);
  return clip;
}

/** Snapshots of the custom tiles among `ids`, following what they turn into. */
function customDefs(project: Project, ids: Iterable<number>): Record<number, TileDef> {
  const out: Record<number, TileDef> = {};
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (id < USER_TILE_BASE || out[id]) continue;
    const def = tileById(project, id);
    if (!def) continue;
    out[id] = structuredClone(def);
    for (const k of TRANSFORMS) {
      const to = def[k]?.to;
      if (to) queue.push(to);
    }
  }
  return out;
}

/** How a clip lands in a project. */
export interface PastePlan {
  /** Clip id -> id to paint (0 = skip: the tile does not exist here). Ids not listed paint as they are. */
  map: Map<number, number>;
  /** Copies of another project's custom tiles, to add to the project before painting (fresh ids >= 1000). */
  imports: TileDef[];
  /** Non-empty cells that will be skipped. */
  skipped: number;
}

/** Same art and behaviour on the ground (an earlier import of the same tile is reused instead of copied again). */
function sameTile(a: TileDef, b: TileDef): boolean {
  const look = (t: TileDef): string => JSON.stringify([t.palette, t.frames, t.frameTime ?? null, t.collision, t.solidMask ?? null, t.ledgeDir ?? null]);
  return look(a) === look(b);
}

function freeKey(base: string, used: Set<string>): string {
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  used.add(key);
  return key;
}

/**
 * Map a clip's tile ids onto `project`. Built-in ids (< 1000) and, within
 * the clip's own project, custom ids paint as they are while the tile
 * exists. Another project's custom tiles are imported from the clip's
 * snapshots (with the tiles they turn into; an identical custom tile already
 * in the project is reused), unless their palette is missing here. Anything
 * else is skipped.
 */
export function planPaste(clip: TileClip, project: Project): PastePlan {
  const foreign = clip.project === '' || clip.project !== project.id;
  const map = new Map<number, number>();
  const imports: TileDef[] = [];
  const usedIds = new Set(project.tiles.map((t) => t.id));
  const usedKeys = new Set(project.tiles.map((t) => t.key));
  const palettes = new Set(project.palettes.map((p) => p.id));
  const resolve = (id: number): number => {
    if (id === 0) return 0;
    const known = map.get(id);
    if (known !== undefined) return known;
    map.set(id, 0); // a transform cycle resolves to "skip" until the tile is placed below
    const def = foreign && id >= USER_TILE_BASE ? clip.defs[id] : undefined;
    if (!def) {
      const to = (id < USER_TILE_BASE || !foreign) && tileById(project, id) ? id : 0;
      map.set(id, to);
      return to;
    }
    if (!palettes.has(def.palette)) return 0;
    const same = project.tiles.find((t) => t.id >= USER_TILE_BASE && sameTile(t, def))
      ?? imports.find((t) => sameTile(t, def));
    if (same) {
      map.set(id, same.id);
      return same.id;
    }
    let fresh = USER_TILE_BASE;
    while (usedIds.has(fresh)) fresh++;
    usedIds.add(fresh);
    const copy: TileDef = { ...structuredClone(def), id: fresh, key: freeKey(def.key, usedKeys) };
    map.set(id, fresh);
    imports.push(copy);
    for (const k of TRANSFORMS) {
      const tr = copy[k];
      if (!tr) continue;
      const to = resolve(tr.to);
      if (to !== 0 || tr.to === 0) tr.to = to;
      else delete copy[k]; // what it turned into is not available here
    }
    return fresh;
  };
  let skipped = 0;
  for (const data of Object.values(clip.layers)) {
    for (const id of data ?? []) if (id !== 0 && resolve(id) === 0) skipped++;
  }
  return { map, imports, skipped };
}

/** Set every cell of `rect` on the given layers to 0. */
export function clearRegion(edit: TileEdit, rect: CellRect, layers: readonly LayerName[]): void {
  for (const layer of layers) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) edit.set(layer, x, y, 0);
    }
  }
}

/** Layers a clip lands on: a single-layer clip goes to `target`, a multi-layer clip to its own layers. */
export function clipTargets(clip: TileClip, target: LayerName): [from: LayerName, to: LayerName][] {
  const own = Object.keys(clip.layers) as LayerName[];
  return own.length === 1 ? [[own[0]!, target]] : own.map((l) => [l, l]);
}

/**
 * Stamp a clip with its top-left cell at (tx, ty). Empty (0) cells are
 * transparent, so stamping never punches holes; cells outside the room are
 * dropped. `plan` (see planPaste) maps ids first; cells it maps to 0 are skipped.
 */
export function pasteClip(edit: TileEdit, clip: TileClip, tx: number, ty: number, target: LayerName, plan?: PastePlan): void {
  for (const [from, to] of clipTargets(clip, target)) {
    const data = clip.layers[from]!;
    for (let y = 0; y < clip.h; y++) {
      for (let x = 0; x < clip.w; x++) {
        const src = data[y * clip.w + x] ?? 0;
        const id = src !== 0 && plan ? plan.map.get(src) ?? src : src;
        if (id !== 0) edit.set(to, tx + x, ty + y, id);
      }
    }
  }
}
