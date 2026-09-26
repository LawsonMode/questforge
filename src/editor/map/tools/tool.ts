// The contract between the room canvas (the host) and the editing tools. Tools
// are small stateful objects: they receive pointer events in room space, edit
// through the host (so every gesture is one undo step and the canvas caches
// stay in sync) and may draw previews over the room.
import type { LayerName, Room, World } from '../../../core/types';
import type { EditorContext } from '../../context';
import type { MapState, ToolId } from '../mapState';
import type { TileEdit } from '../tileEdit';
import type { EntityBox, Xf } from '../roomRender';
import type { MapIcon } from '../icons';
import type { SideEffect } from '../history';

/** A pointer sample in room space. */
export interface Pointer {
  /** Room-local art pixels (fractional). */
  x: number;
  y: number;
  /** Tile cell under the pointer (may lie outside the room). */
  tx: number;
  ty: number;
  /** Mouse button of the gesture (0 left, 2 right). */
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export type FlashKind = 'info' | 'warn';

export interface ToolHost {
  readonly ctx: EditorContext;
  readonly state: MapState;
  world(): World;
  room(): Room | null;
  /** Open a tile gesture on the current room; its writes show up live on the canvas. */
  beginTiles(): TileEdit | null;
  /**
   * Record a finished gesture as one undo step (no-op when nothing changed).
   * `also` is a project change made with it (already applied) that undo and redo take along.
   */
  commitTiles(edit: TileEdit, label: string, also?: SideEffect): void;
  /** Schedule a canvas redraw. */
  redraw(): void;
  /** Transient status-bar message. */
  flash(msg: string, kind?: FlashKind): void;
  /** Drop a transient status-bar message early (the hint it hides matters now). */
  clearFlash(): void;
  /** Whether a layer (or the entity overlay) is currently shown. */
  visible(layer: LayerName | 'entities'): boolean;
  /** Whether a layer may be edited now; warns in the status bar (false) when it is hidden. */
  canEdit(layer: LayerName): boolean;
  /** Placed entities' boxes in draw order (topmost last). */
  entityBoxes(): EntityBox[];
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor over the canvas. */
  cursor(host: ToolHost): string;
  /** Status-bar hint describing what the mouse does. */
  hint(host: ToolHost): string;
  /** Right-button gestures go to the tool instead of opening the context menu. */
  readonly wantsRight?: boolean;
  down(p: Pointer, host: ToolHost): void;
  /** Pointer moved; `dragging` while a gesture this tool started is in progress. */
  move(p: Pointer, host: ToolHost, dragging: boolean): void;
  up(p: Pointer, host: ToolHost): void;
  /** Key pressed while this tool is active; true when handled. */
  key?(e: KeyboardEvent, host: ToolHost): boolean;
  /** End the gesture in progress without further action (tool switch, room change, lost pointer). */
  cancel?(host: ToolHost): void;
  /** Esc during a gesture: drop it and revert what it changed (defaults to cancel). */
  abort?(host: ToolHost): void;
  /** Another tool takes over: leave modes that only make sense while this one is active (paste). */
  deactivate?(host: ToolHost): void;
  /** Previews drawn over the room; `hover` is the last pointer sample over the canvas. */
  overlay?(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void;
}

/** Toolbar metadata for a tool. */
export interface ToolMeta {
  id: ToolId;
  label: string;
  /** Shortcut keys shown in the tooltip (first one is the main key). */
  keys: readonly string[];
  icon: MapIcon;
}

export const TOOL_META: readonly ToolMeta[] = [
  { id: 'pencil', label: 'Pencil', keys: ['P', 'B'], icon: 'pencil' },
  { id: 'rect', label: 'Rectangle', keys: ['R'], icon: 'rect' },
  { id: 'fill', label: 'Fill', keys: ['F'], icon: 'fill' },
  { id: 'eraser', label: 'Eraser', keys: ['E'], icon: 'eraser' },
  { id: 'eyedropper', label: 'Eyedropper', keys: ['I'], icon: 'eyedropper' },
  { id: 'select', label: 'Select', keys: ['S'], icon: 'select' },
  { id: 'terrain', label: 'Terrain brush', keys: ['T'], icon: 'terrain' },
  { id: 'entity', label: 'Entities', keys: ['N'], icon: 'entity' },
];

/** Tool bound to a (case-insensitive) single-letter shortcut. */
export function toolForKey(key: string): ToolId | null {
  const k = key.toUpperCase();
  return TOOL_META.find((m) => m.keys.includes(k))?.id ?? null;
}

/** Tools that edit tiles (Alt+click picks a tile with any of them). */
export const TILE_TOOLS: readonly ToolId[] = ['pencil', 'rect', 'fill', 'eraser', 'select', 'terrain'];
