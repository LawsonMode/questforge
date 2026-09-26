// Right-click menu of the room canvas: playtest from the clicked spot, move the
// project start there, drop a warp, pick the tile, and actions for the entity
// under the cursor.
import type { WarpTarget } from '../../core/types';
import type { MenuEntry } from './contextMenu';
import type { Pointer, ToolHost } from './tools/tool';
import type { ToolSet } from './tools';
import { TILE } from '../../core/constants';
import { entityInfo } from '../../core/catalog';
import { roomCols, roomRows } from '../../core/project';
import { focusRoom, reversible } from './history';
import { openMenu } from './contextMenu';
import { hitEntity } from './tools/entityTool';
import { pickBrush } from './tools/paint';

/** The clicked cell's centre as a spawn target facing down. */
export function cellTarget(worldId: string, roomId: string, tx: number, ty: number): WarpTarget {
  return { world: worldId, room: roomId, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, dir: 'down' };
}

function setStart(host: ToolHost, target: WarpTarget): void {
  const { ctx } = host;
  const before = { ...ctx.project.start };
  reversible(ctx, 'Set project start', 'settings', undefined, (forward) => {
    const start = forward ? target : before;
    ctx.project.start = { ...start };
    // Undo / redo show the room the start marker is in now.
    focusRoom(ctx, start.world, start.room);
  });
  ctx.toast('The game now starts here.', 'success');
}

/** Open the canvas context menu for a right-click at `p` (client coordinates x, y). */
export function openCanvasMenu(host: ToolHost, tools: ToolSet, p: Pointer, x: number, y: number): void {
  const room = host.room();
  if (!room) return;
  const { ctx } = host;
  const inside = p.tx >= 0 && p.ty >= 0 && p.tx < roomCols(room) && p.ty < roomRows(room);
  const target = cellTarget(host.world().id, room.id, p.tx, p.ty);
  const entries: MenuEntry[] = [
    { label: 'Playtest from here', icon: 'play', keys: 'Shift+F5', disabled: !inside, action: () => ctx.playtest(target) },
    { label: 'Set project start here', icon: 'flag', disabled: !inside, action: () => setStart(host, target) },
    {
      label: 'Add warp here', icon: 'warp', disabled: !inside,
      action: () => {
        tools.entity.place(host, 'marker.warp', p.x, p.y);
        host.state.setTool('entity');
      },
    },
    { label: 'Pick this tile', icon: 'eyedropper', keys: 'Alt+click', disabled: !inside, action: () => pickBrush(p, host) },
  ];
  const hit = host.visible('entities') ? hitEntity(host.entityBoxes(), p.x, p.y) : null;
  if (hit) {
    const id = hit.inst.id;
    entries.push('separator', { header: `${entityInfo(hit.inst.type)?.name ?? hit.inst.type} · ${id}` },
      {
        label: 'Edit properties', icon: 'edit',
        action: () => {
          ctx.selectEntity(id);
          host.state.showSidebar('entities');
        },
      },
      { label: 'Duplicate', icon: 'copy', keys: 'Ctrl+D', action: () => tools.entity.duplicate(host, id) },
      { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, action: () => void tools.entity.remove(host, id) });
  }
  openMenu(x, y, entries);
}
