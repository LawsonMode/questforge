// Map-tab local state shared by its components: active tool, view toggles,
// overview floor, sidebar tab and a pending location pick. Changes are
// broadcast on `bus`; view toggles persist per browser via storage settings.
import type { LayerName, WarpTarget } from '../../core/types';
import { Emitter } from '../../core/events';
import { getSetting, setSetting } from '../../core/storage';

export type ToolId = 'pencil' | 'rect' | 'fill' | 'eraser' | 'eyedropper' | 'select' | 'terrain' | 'entity';

/** Tools that paint the selected tile brush. */
export const BRUSH_TOOLS: readonly ToolId[] = ['pencil', 'rect', 'fill'];

export type SidebarTab = 'tiles' | 'entities' | 'triggers' | 'room';

export type Visibility = Record<LayerName | 'entities', boolean>;

export interface MapPrefs {
  grid: boolean;
  collision: boolean;
  neighbors: boolean;
  show: Visibility;
}

export interface MapEvents extends Record<string, unknown> {
  tool: ToolId;
  prefs: MapPrefs;
  floor: number;
  sidebar: SidebarTab;
  /** A location pick started (prompt) or ended (null). */
  pick: string | null;
}

const PREFS_KEY = 'map.view';
const DEFAULT_PREFS: MapPrefs = {
  grid: false,
  collision: false,
  neighbors: true,
  show: { bg: true, fg: true, over: true, entities: true },
};

function loadPrefs(): MapPrefs {
  const saved = getSetting<Partial<MapPrefs> | null>(PREFS_KEY, null);
  return {
    ...DEFAULT_PREFS,
    ...(saved ?? {}),
    show: { ...DEFAULT_PREFS.show, ...(saved?.show ?? {}) },
  };
}

interface PendingPick {
  prompt: string;
  resolve: (target: WarpTarget | null) => void;
}

export class MapState {
  readonly bus = new Emitter<MapEvents>();
  tool: ToolId = 'pencil';
  /** Tool active before the current one (the eyedropper returns to it). */
  previousTool: ToolId = 'pencil';
  prefs: MapPrefs = loadPrefs();
  floor = 0;
  sidebar: SidebarTab = 'tiles';
  private pending: PendingPick | null = null;

  setTool(id: ToolId): void {
    if (id === this.tool) return;
    this.previousTool = this.tool;
    this.tool = id;
    this.bus.emit('tool', id);
  }

  /** Update view toggles (merged), persist and broadcast. */
  setPrefs(patch: Partial<Omit<MapPrefs, 'show'>> & { show?: Partial<Visibility> }): void {
    this.prefs = { ...this.prefs, ...patch, show: { ...this.prefs.show, ...(patch.show ?? {}) } };
    setSetting(PREFS_KEY, this.prefs);
    this.bus.emit('prefs', this.prefs);
  }

  setFloor(floor: number): void {
    if (floor === this.floor) return;
    this.floor = floor;
    this.bus.emit('floor', floor);
  }

  showSidebar(tab: SidebarTab): void {
    if (tab === this.sidebar) return;
    this.sidebar = tab;
    this.bus.emit('sidebar', tab);
  }

  /** Prompt of the pending location pick, or null. */
  get pickPrompt(): string | null {
    return this.pending?.prompt ?? null;
  }

  /** Start a location pick (a previous pending pick resolves null). */
  beginPick(prompt: string): Promise<WarpTarget | null> {
    this.endPick(null);
    return new Promise((resolve) => {
      this.pending = { prompt, resolve };
      this.bus.emit('pick', prompt);
    });
  }

  /** Finish the pending pick with a target, or cancel it with null. */
  endPick(target: WarpTarget | null): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.bus.emit('pick', null);
    p.resolve(target);
  }
}
