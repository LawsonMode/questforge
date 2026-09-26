// EditorContext implementation used by the editor shell: selection state,
// change/asset notifications, undo integration, tab switching and the
// location-picker hand-off. DOM-free (the shell injects a ShellHost), so it is
// unit-testable.
import type { LayerName, Project, Room, WarpTarget, World } from '../../core/types';
import type { EditorContext, EditorEvents, EditorTabId, ProjectChange, SelectionChange } from '../context';
import type { AssetCache } from '../../gfx/imageCache';
import type { Autosave, SaveStatus } from './autosave';
import { Emitter } from '../../core/events';
import { findRoom, findWorld } from '../../core/project';
import { T } from '../../content/ids';
import { UndoStack } from '../undo';

/** What the shell provides to the context. */
export interface ShellHost {
  /** Show (mounting on first use) a tab's panel. */
  showTab(id: EditorTabId): void;
  playtest(from?: WarpTarget): void;
  toast(msg: string, kind?: 'info' | 'success' | 'error'): void;
  /** Resolves once a shown tab's panel is mounted and had a chance to register itself. */
  tabReady(id: EditorTabId): Promise<void>;
}

/**
 * Optional extension for the map tab: publish the last hovered/clicked map
 * position here (room-local px) and Shift+F5 playtests from it.
 */
export interface MapCursorHost {
  mapCursor: WarpTarget | null;
}

/**
 * Optional extension: when the project was last stored and when the save
 * status changes (the Project tab shows "Last saved …").
 */
export interface SaveStatusHost {
  /** When the project was last stored (epoch ms); null while it has never been stored. */
  readonly lastSaved: number | null;
  /** Runs on every save status change; returns the remover. */
  onSaveStatus(fn: (status: SaveStatus) => void): () => void;
}

/** Whether `ctx` publishes its save status (the shell's context does). */
export function hasSaveStatus(ctx: EditorContext): ctx is EditorContext & SaveStatusHost {
  return typeof (ctx as Partial<SaveStatusHost>).onSaveStatus === 'function';
}

type Picker = (prompt: string) => Promise<WarpTarget | null>;

interface SelectionState {
  worldId: string;
  roomId: string | null;
  layer: LayerName;
  tile: number;
  terrainId: string | null;
  entityType: string | null;
  entityId: string | null;
}

/** Changes that may delete the selected world/room/entity. */
const STRUCTURAL: ReadonlySet<ProjectChange> = new Set(['worlds', 'rooms', 'room', 'entities', 'all']);

/** The editor's EditorContext: selection, change tracking, undo, tabs and picking. */
export class ShellContext implements EditorContext, MapCursorHost, SaveStatusHost {
  readonly bus = new Emitter<EditorEvents>();
  readonly undo = new UndoStack();
  mapCursor: WarpTarget | null = null;
  private readonly statusBus = new Emitter<{ status: SaveStatus }>();
  private sel: SelectionState;
  private tabId: EditorTabId = 'map';
  private picker: Picker | null = null;

  /** `stored` = the project is already in storage (false for an unsaved copy of the sample). */
  constructor(
    readonly project: Project,
    readonly assets: AssetCache,
    private readonly autosave: Autosave,
    private readonly host: ShellHost,
    private stored = true,
  ) {
    const start = findRoom(project, project.start.world, project.start.room) ? project.start : null;
    const world = start ? findWorld(project, start.world) : project.worlds[0];
    this.sel = {
      worldId: world?.id ?? '',
      roomId: start?.room ?? world?.rooms[0]?.id ?? null,
      layer: 'bg',
      tile: T.GRASS ?? project.tiles[0]?.id ?? 0,
      terrainId: null,
      entityType: null,
      entityId: null,
    };
  }

  // ------------------------------------------------------------ selection

  get worldId(): string { return this.sel.worldId; }
  get roomId(): string | null { return this.sel.roomId; }
  get layer(): LayerName { return this.sel.layer; }
  get tile(): number { return this.sel.tile; }
  get terrainId(): string | null { return this.sel.terrainId; }
  get entityType(): string | null { return this.sel.entityType; }
  get entityId(): string | null { return this.sel.entityId; }
  /** The tab currently shown. */
  get activeTab(): EditorTabId { return this.tabId; }

  selectRoom(worldId: string, roomId: string | null): void {
    if (worldId === this.sel.worldId && roomId === this.sel.roomId) return;
    this.sel.worldId = worldId;
    this.sel.roomId = roomId;
    this.emitSelection('room');
    if (this.sel.entityId !== null) {
      this.sel.entityId = null;
      this.emitSelection('entity');
    }
  }

  selectLayer(layer: LayerName): void {
    this.set('layer', layer, 'layer');
  }

  selectTile(id: number): void {
    this.set('tile', id, 'tile');
  }

  selectTerrain(id: string | null): void {
    this.set('terrainId', id, 'tile');
  }

  selectEntityType(type: string | null): void {
    this.set('entityType', type, 'entityType');
  }

  selectEntity(id: string | null): void {
    this.set('entityId', id, 'entity');
  }

  world(): World {
    return findWorld(this.project, this.sel.worldId) ?? this.project.worlds[0]!;
  }

  room(): Room | null {
    const id = this.sel.roomId;
    return id === null ? null : findRoom(this.project, this.world().id, id) ?? null;
  }

  // ------------------------------------------------------------ changes

  changed(what: ProjectChange, id?: string): void {
    if (STRUCTURAL.has(what)) this.reconcileSelection();
    this.autosave.markDirty();
    this.bus.emit('project', id === undefined ? { what } : { what, id });
  }

  assetsChanged(kind: 'tile' | 'sprite' | 'palette' | 'all', id?: string | number): void {
    if (id === undefined || kind === 'all') this.assets.invalidateAll();
    else if (kind === 'tile') this.assets.invalidateTile(Number(id));
    else if (kind === 'sprite') this.assets.invalidateSprite(String(id));
    else this.assets.invalidatePalette(String(id));
    this.autosave.markDirty();
    this.bus.emit('assets', id === undefined ? { kind } : { kind, id });
  }

  /** Undo the last command; false when there was nothing to undo. */
  undoLast(): boolean {
    const cmd = this.undo.undo();
    if (cmd) this.afterHistory(cmd.label);
    return cmd !== null;
  }

  /** Redo the last undone command; false when there was nothing to redo. */
  redoLast(): boolean {
    const cmd = this.undo.redo();
    if (cmd) this.afterHistory(cmd.label);
    return cmd !== null;
  }

  // ------------------------------------------------------------ shell services

  switchTab(id: EditorTabId): void {
    const changed = id !== this.tabId;
    this.tabId = id;
    this.host.showTab(id);
    if (changed) this.bus.emit('tab', { id });
  }

  playtest(from?: WarpTarget): void {
    this.host.playtest(from);
  }

  async pickLocation(prompt: string): Promise<WarpTarget | null> {
    this.switchTab('map');
    if (!this.picker) await this.host.tabReady('map');
    const picker = this.picker;
    if (!picker) {
      this.host.toast('The map editor cannot pick a location yet.', 'error');
      return null;
    }
    // Leaving the map abandons the pick: it resolves null, and a later click on the map changes nothing.
    return new Promise((resolve) => {
      let settled = false;
      const finish = (at: WarpTarget | null): void => {
        if (settled) return;
        settled = true;
        off();
        resolve(at);
      };
      const off = this.bus.on('tab', ({ id }) => {
        if (id !== 'map') finish(null);
      });
      picker(prompt).then(finish, () => finish(null));
    });
  }

  setLocationPicker(fn: Picker | null): void {
    this.picker = fn;
  }

  async save(): Promise<void> {
    await this.autosave.saveNow();
  }

  toast(msg: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    this.host.toast(msg, kind);
  }

  // ------------------------------------------------------------ save status

  get lastSaved(): number | null {
    // saveProject stamps `modified`, so for a stored project it is the time of the last save.
    return this.stored ? this.project.modified : null;
  }

  onSaveStatus(fn: (status: SaveStatus) => void): () => void {
    return this.statusBus.on('status', fn);
  }

  /** The shell reports each save status change (`stored` = the project is in storage now). */
  reportSaveStatus(status: SaveStatus, stored: boolean): void {
    this.stored = stored;
    this.statusBus.emit('status', status);
  }

  /** Drop every listener (the shell calls this when the editor closes). */
  dispose(): void {
    this.bus.clear();
    this.statusBus.clear();
    this.picker = null;
  }

  // ------------------------------------------------------------ internals

  private set<K extends Exclude<keyof SelectionState, 'worldId' | 'roomId'>>(
    key: K, value: SelectionState[K], what: SelectionChange,
  ): void {
    if (this.sel[key] === value) return;
    this.sel[key] = value;
    this.emitSelection(what);
  }

  private emitSelection(what: SelectionChange): void {
    this.bus.emit('selection', { what });
  }

  private afterHistory(label: string): void {
    // Undo may restore pixel data or replace asset arrays: re-rasterise lazily.
    this.assets.invalidateAll();
    this.reconcileSelection();
    this.autosave.markDirty();
    this.bus.emit('undo', { label });
  }

  /** Clear selections that point at deleted worlds, rooms or entities. */
  private reconcileSelection(): void {
    const p = this.project;
    if (!findWorld(p, this.sel.worldId)) {
      const world = findWorld(p, p.start.world) ?? p.worlds[0];
      this.selectRoom(world?.id ?? '', null);
    }
    if (this.sel.roomId !== null && !this.room()) this.selectRoom(this.sel.worldId, null);
    const room = this.room();
    if (this.sel.entityId !== null && !room?.entities.some((e) => e.id === this.sel.entityId)) this.selectEntity(null);
  }
}
