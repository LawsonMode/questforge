// Entity tool: with an entity type chosen in the Entities panel, clicks place
// new instances (snapped to the tile grid, Shift = 8 px); otherwise clicks
// select, drags move (Shift 8 px, Ctrl free), arrows nudge, Ctrl+D duplicates
// and Delete removes (asking first when triggers use it, like the inspector).
// Every placement/move/removal is one undo step; Esc during a drag puts the
// entity back. A duplicated door starts unlinked (a shared link opens both).
import type { Dir, EntityInstance, PropValue, Room, World } from '../../../core/types';
import type { EntityBox, Xf } from '../roomRender';
import type { Pointer, Tool, ToolHost } from './tool';
import { TILE } from '../../../core/constants';
import { defaultProps, entityInfo, footprint } from '../../../core/catalog';
import { newId, roomCols, roomRows } from '../../../core/project';
import { EntityTxn, MergingEntityEdit, editEntities } from '../history';
import { clampAxis, snapAxis } from '../geometry';
import { drawEntityGhost } from '../roomRender';
import { entityUsages } from '../../entities/refs';
import { entityLabel } from '../../entities/labels';
import { duplicateInstance } from '../../entities/edit';
import { choiceDialog, usageBody } from '../../entities/widgets';
import { focusTopDialog, restoreFocus } from '../../shell/dialogs';


/**
 * Ask before deleting an entity that triggers use (the same question as the
 * inspector's Delete). Resolves true to go ahead.
 */
export async function confirmEntityDelete(world: World, room: Room, inst: EntityInstance): Promise<boolean> {
  const uses = entityUsages(world, room, inst.id);
  if (uses.length === 0) return true;
  const trigger = document.activeElement;
  const body = usageBody(`${entityLabel(inst)} is used by:`, uses.map((u) => u.label), 'Delete it anyway? Those references will show as missing.');
  const answer = choiceDialog('Delete entity', body, [{ label: 'Delete', value: true, kind: 'danger' }]);
  focusTopDialog('first'); // Enter must not delete by accident
  const ok = (await answer) === true;
  restoreFocus(trigger);
  return ok;
}

/** How a drag or placement snaps: tile grid by footprint, a pixel step, or free. */
export type SnapMode = 'tile' | 8 | 1;

/** Snap mode for the modifier keys held (Ctrl = free, Shift = 8 px). */
export function snapModeFor(p: { shift: boolean; ctrl: boolean }): SnapMode {
  return p.ctrl ? 1 : p.shift ? 8 : 'tile';
}

/** Snap an entity centre and keep its footprint inside a room of w x h px. */
export function snapPoint(x: number, y: number, fp: { w: number; h: number }, roomW: number, roomH: number, mode: SnapMode): { x: number; y: number } {
  const step = mode === 'tile' ? undefined : mode;
  return {
    x: clampAxis(snapAxis(x, fp.w, step), fp.w, roomW),
    y: clampAxis(snapAxis(y, fp.h, step), fp.h, roomH),
  };
}

/** Whether a room-space point lies inside the room (not on the neighbour strips or the backdrop). */
export function insideRoom(room: Room | null, p: { x: number; y: number }): room is Room {
  return !!room && p.x >= 0 && p.y >= 0 && p.x < roomCols(room) * TILE && p.y < roomRows(room) * TILE;
}

/** Wall of a w x h px room nearest to a point (where a door placed there belongs). */
export function nearestWall(x: number, y: number, w: number, h: number): Dir {
  const d: [Dir, number][] = [['up', y], ['down', h - y], ['left', x], ['right', w - x]];
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0];
}

/** Topmost box at a point, preferring real entities over (often large) markers. */
export function hitEntity(boxes: readonly EntityBox[], x: number, y: number): EntityBox | null {
  let marker: EntityBox | null = null;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) continue;
    if (!b.marker) return b;
    marker ??= b;
  }
  return marker;
}

/** A fresh instance of `type` for a point in `room` (doors face the nearest wall). */
export function newInstance(type: string, x: number, y: number, room: Room, mode: SnapMode): EntityInstance {
  const inst: EntityInstance = { id: newId('e'), type, x: 0, y: 0, props: defaultProps(type) };
  const w = roomCols(room) * TILE;
  const h = roomRows(room) * TILE;
  if (type === 'obj.door') inst.props.dir = nearestWall(x, y, w, h);
  const p = snapPoint(x, y, footprint(inst), w, h, mode);
  inst.x = p.x;
  inst.y = p.y;
  return inst;
}

interface Drag {
  txn: EntityTxn;
  id: string;
  offX: number;
  offY: number;
  startX: number;
  startY: number;
  /** The entity's position when the drag began (Esc puts it back). */
  fromX: number;
  fromY: number;
  /** Set once the pointer left the drag threshold; a plain click never moves the entity. */
  moved: boolean;
}

/** Art pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

export class EntityTool implements Tool {
  readonly id = 'entity' as const;
  private drag: Drag | null = null;
  private hovered: string | null = null;
  private readonly nudges: MergingEntityEdit;

  constructor(host: ToolHost) {
    this.nudges = new MergingEntityEdit(host.ctx);
  }

  /** Entity under the cursor (highlighted on the canvas). */
  get hoveredId(): string | null {
    return this.hovered;
  }

  cursor(host: ToolHost): string {
    if (host.ctx.entityType) return 'copy';
    if (this.drag) return 'grabbing';
    return this.hovered ? 'move' : 'default';
  }

  hint(host: ToolHost): string {
    const type = host.ctx.entityType;
    if (type) return `Place ${entityInfo(type)?.name ?? type} — click to add (Shift: 8 px grid) · Esc stops placing`;
    if (host.ctx.entityId) return 'Drag to move (Shift: 8 px, Ctrl: free) · arrows nudge · Ctrl+D duplicates · Delete removes · right-click for more';
    return 'Entities — click to select, drag to move · choose a type in the Entities panel to place new ones';
  }

  down(p: Pointer, host: ToolHost): void {
    if (p.button !== 0) return;
    if (!host.visible('entities')) {
      host.flash('Entities are hidden — turn them back on in the toolbar to edit them.', 'warn');
      return;
    }
    const type = host.ctx.entityType;
    if (type) {
      if (insideRoom(host.room(), p)) this.place(host, type, p.x, p.y, snapModeFor(p));
      else host.flash(`Click inside the room to place ${entityInfo(type)?.name ?? 'the entity'}.`, 'warn');
      return;
    }
    const hit = hitEntity(host.entityBoxes(), p.x, p.y);
    this.select(host, hit?.inst.id ?? null);
    const room = host.room();
    if (!hit || !room) return;
    this.drag = {
      txn: new EntityTxn(host.ctx, host.world().id, room.id), id: hit.inst.id,
      offX: hit.inst.x - p.x, offY: hit.inst.y - p.y, startX: p.x, startY: p.y, fromX: hit.inst.x, fromY: hit.inst.y, moved: false,
    };
  }

  move(p: Pointer, host: ToolHost, dragging: boolean): void {
    const room = host.room();
    const drag = this.drag;
    if (dragging && drag && room) {
      drag.moved ||= Math.hypot(p.x - drag.startX, p.y - drag.startY) >= DRAG_THRESHOLD;
      const inst = drag.moved ? room.entities.find((e) => e.id === drag.id) : undefined;
      if (inst) {
        const pt = snapPoint(p.x + drag.offX, p.y + drag.offY, footprint(inst), roomCols(room) * TILE, roomRows(room) * TILE, snapModeFor(p));
        inst.x = pt.x;
        inst.y = pt.y;
      }
    } else {
      this.hovered = host.visible('entities') ? hitEntity(host.entityBoxes(), p.x, p.y)?.inst.id ?? null : null;
    }
    host.redraw();
  }

  up(_p: Pointer, host: ToolHost): void {
    this.cancel(host);
  }

  cancel(host: ToolHost): void {
    const drag = this.drag;
    this.drag = null;
    if (drag) drag.txn.commit('Move entity');
    host.redraw();
  }

  abort(host: ToolHost): void {
    const drag = this.drag;
    this.drag = null;
    const inst = drag && host.room()?.entities.find((e) => e.id === drag.id);
    if (drag && inst) {
      inst.x = drag.fromX;
      inst.y = drag.fromY;
    }
    host.redraw();
  }

  key(e: KeyboardEvent, host: ToolHost): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const selected = host.ctx.entityId;
    if (e.key === 'Escape') {
      if (host.ctx.entityType) host.ctx.selectEntityType(null);
      else if (selected) host.ctx.selectEntity(null);
      else return false;
      return true;
    }
    if (!selected) return false;
    if (mod && e.code === 'KeyD') {
      this.duplicate(host, selected);
      return true;
    }
    if (mod) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      void this.remove(host, selected);
      return true;
    }
    const step = e.shiftKey ? 8 : 1;
    const delta: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return false;
    this.nudge(host, selected, d[0], d[1]);
    return true;
  }

  overlay(g: CanvasRenderingContext2D, xf: Xf, host: ToolHost, hover: Pointer | null): void {
    const type = host.ctx.entityType;
    const room = host.room();
    if (!type || !hover || !room || !host.visible('entities') || !insideRoom(room, hover)) return;
    drawEntityGhost(g, xf, newInstance(type, hover.x, hover.y, room, snapModeFor(hover)), host.ctx.assets);
  }

  // ------------------------------------------------------------------ actions (also used by the context menu)

  /** Place a new instance of `type` near (x, y); selects it. Returns its id. */
  place(host: ToolHost, type: string, x: number, y: number, mode: SnapMode = 'tile'): string | null {
    const room = host.room();
    if (!room) return null;
    const inst = newInstance(type, x, y, room, mode);
    editEntities(host.ctx, host.world().id, room.id, `Place ${entityInfo(type)?.name ?? 'entity'}`, (r) => {
      r.entities.push(inst);
    });
    this.select(host, inst.id);
    return inst.id;
  }

  /** Copy an entity one tile to the side (fresh id); selects the copy. */
  duplicate(host: ToolHost, id: string): void {
    const room = host.room();
    const src = room?.entities.find((e) => e.id === id);
    if (!room || !src) return;
    const copy = duplicateInstance(src);
    const fp = footprint(src);
    const w = roomCols(room) * TILE;
    const shift = src.x + TILE + fp.w / 2 <= w ? TILE : -TILE;
    copy.x = clampAxis(src.x + shift, fp.w, w);
    editEntities(host.ctx, host.world().id, room.id, 'Duplicate entity', (r) => {
      r.entities.push(copy);
    });
    this.select(host, copy.id);
  }

  /** Remove an entity from the room (asking first when a trigger uses it). */
  async remove(host: ToolHost, id: string): Promise<void> {
    const room = host.room();
    const inst = room?.entities.find((e) => e.id === id);
    if (!room || !inst) return;
    const world = host.world();
    if (!(await confirmEntityDelete(world, room, inst))) return;
    const name = entityInfo(inst.type)?.name ?? 'entity';
    // The room is looked up again: it may have changed while the question was open.
    const removed = editEntities(host.ctx, world.id, room.id, `Delete ${name}`, (r) => {
      r.entities = r.entities.filter((e) => e.id !== id);
    });
    if (removed && host.ctx.entityId === id) host.ctx.selectEntity(null);
  }

  private nudge(host: ToolHost, id: string, ddx: number, ddy: number): void {
    const room = host.room();
    if (!room) return;
    const w = roomCols(room) * TILE;
    const h = roomRows(room) * TILE;
    this.nudges.run(host.world().id, room.id, `nudge:${id}`, 'Nudge entity', (r) => {
      const inst = r.entities.find((e) => e.id === id);
      if (!inst) return;
      const fp = footprint(inst);
      inst.x = clampAxis(inst.x + ddx, fp.w, w);
      inst.y = clampAxis(inst.y + ddy, fp.h, h);
    });
  }

  private select(host: ToolHost, id: string | null): void {
    host.ctx.selectEntity(id);
    if (id) host.state.showSidebar('entities');
  }

  /** Release listeners. */
  dispose(): void {
    this.nudges.dispose();
  }
}

/** Short label for a marker drawn on the canvas (warp destination, region name). */
export function markerLabel(inst: EntityInstance, roomName: (world: string, room: string) => string | null): string {
  if (inst.type === 'marker.region') return String(inst.props.name ?? 'region');
  if (inst.type !== 'marker.warp') return '';
  const t = inst.props.target as PropValue;
  if (!t || typeof t !== 'object') return 'warp → (unset)';
  return `→ ${roomName(t.world, t.room) ?? 'missing room'}`;
}
