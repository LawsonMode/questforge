// =============================================================================
// EditorContext — the seam between the editor shell (editor.ts) and the tab /
// panel modules. Panels read & mutate `project` in place, then call changed()
// (or assetsChanged() for pixel/palette edits) so other panels refresh and
// autosave runs. Every user-visible mutation should go through `undo`.
// =============================================================================
import type { Emitter } from '../core/events';
import type { LayerName, Project, Room, WarpTarget, World } from '../core/types';
import type { AssetCache } from '../gfx/imageCache';
import type { UndoStack } from './undo';

export type EditorTabId = 'map' | 'art' | 'dialogue' | 'project';

export type ProjectChange =
  | 'tiles' | 'sprites' | 'palettes' | 'terrains' | 'worlds' | 'rooms' | 'room'
  | 'entities' | 'triggers' | 'dialogues' | 'flags' | 'settings' | 'all';

export type SelectionChange = 'room' | 'entity' | 'tile' | 'entityType' | 'layer';

export interface EditorEvents extends Record<string, unknown> {
  /** Project data changed (id = affected room/tile/sprite/dialogue id when relevant). */
  project: { what: ProjectChange; id?: string };
  selection: { what: SelectionChange };
  /** Pixel/palette data changed; the shell has already invalidated `assets`. */
  assets: { kind: 'tile' | 'sprite' | 'palette' | 'all'; id?: string | number };
  tab: { id: EditorTabId };
  /** Undo/redo applied: panels should re-read everything they display. */
  undo: { label: string };
}

/** Mounted UI piece. */
export interface Panel {
  destroy(): void;
  /** Re-render from current project/selection state. */
  refresh?(): void;
}

export interface EditorContext {
  readonly project: Project;
  readonly assets: AssetCache;
  readonly undo: UndoStack;
  readonly bus: Emitter<EditorEvents>;

  // ---- selection (read-only; mutate through the select* methods so events fire)
  readonly worldId: string;
  readonly roomId: string | null;
  readonly layer: LayerName;
  /** Tile brush for painting. */
  readonly tile: number;
  /** Terrain brush id (null = plain tile painting). */
  readonly terrainId: string | null;
  /** Entity type chosen in the entity palette for placement (null = select/move mode). */
  readonly entityType: string | null;
  /** Placed entity currently selected in the room. */
  readonly entityId: string | null;

  selectRoom(worldId: string, roomId: string | null): void;
  selectLayer(layer: LayerName): void;
  selectTile(id: number): void;
  selectTerrain(id: string | null): void;
  selectEntityType(type: string | null): void;
  selectEntity(id: string | null): void;

  world(): World;
  room(): Room | null;

  /** Mark dirty, schedule autosave, emit 'project'. */
  changed(what: ProjectChange, id?: string): void;
  /** Invalidate cached images, mark dirty, emit 'assets'. */
  assetsChanged(kind: 'tile' | 'sprite' | 'palette' | 'all', id?: string | number): void;

  switchTab(id: EditorTabId): void;
  /** Launch the game overlay (from = spawn point; default project start). */
  playtest(from?: WarpTarget): void;
  /** Ask the user to click a location on the map (switches to the map tab). Resolves null if cancelled. */
  pickLocation(prompt: string): Promise<WarpTarget | null>;
  /** The map tab registers the implementation of pickLocation here. */
  setLocationPicker(fn: ((prompt: string) => Promise<WarpTarget | null>) | null): void;
  save(): Promise<void>;
  toast(msg: string, kind?: 'info' | 'success' | 'error'): void;
}
