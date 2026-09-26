// Left column of the map tab: the worlds list (add / rename / reorder / delete,
// world music, a dungeon's prize name), the floor selector, the world overview
// mini-map and room create / delete buttons.
import type { Room, World } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapState } from './mapState';
import type { MapIcon } from './icons';
import type { MenuEntry } from './contextMenu';
import { confirmDialog, el, promptDialog, select, setSelectOptions, textInput } from '../ui/dom';
import { plural } from '../../app/format';
import { MAX_FLOOR } from '../../core/validate';
import { openMenu } from './contextMenu';
import { mapIcon } from './icons';
import { ThumbCache } from './thumbs';
import { WorldOverview } from './worldOverview';
import { WORLD_MUSIC_OPTIONS, openNewRoomDialog, openNewWorldDialog } from './dialogs';
import { deleteRoom, floorLabel, freeSpot } from './roomOps';
import { PRIZE_NAME_MAX, WORLD_KIND_LABELS, deleteWorld, entryRoom, moveWorld, renameWorld, setWorldMusic, setWorldPrize } from './worldOps';

const KIND_SHORT: Readonly<Record<World['kind'], string>> = { overworld: 'OW', dungeon: 'DG', interior: 'IN' };

function iconButton(icon: MapIcon, title: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return el('button', {
    class: `qf-map-iconbtn ${cls}`.trim(), type: 'button', title, 'aria-label': title,
    on: { click: (e: MouseEvent) => { e.stopPropagation(); onClick(e); } },
  }, mapIcon(icon, 14));
}

/**
 * Floors to offer for a world, top first: the floors in use, the current one and
 * its neighbours, and one past the top and bottom (to start a new floor). Never
 * the whole range between far-apart floors (an imported world with rooms on
 * floors -99 and 99 lists a handful of entries, not 200), always within +-MAX_FLOOR.
 */
export function floorChoices(world: World, current: number): number[] {
  const floors = new Set<number>(world.rooms.map((r) => r.floor));
  floors.add(current);
  const top = Math.max(...floors);
  const bottom = Math.min(...floors);
  for (const f of [current + 1, current - 1, top + 1, bottom - 1]) floors.add(f);
  return [...floors].filter((f) => Number.isInteger(f) && Math.abs(f) <= MAX_FLOOR).sort((x, y) => y - x);
}

export class WorldPanel {
  readonly element: HTMLDivElement;
  readonly overview: WorldOverview;
  readonly thumbs: ThumbCache;
  private readonly list: HTMLUListElement;
  private readonly musicSel: HTMLSelectElement;
  /** Dungeon worlds only: what the dungeon's crystal is called. */
  private readonly prizeRow: HTMLDivElement;
  private readonly prizeInput: HTMLInputElement;
  private readonly floorRow: HTMLDivElement;
  private readonly floorSel: HTMLSelectElement;
  private readonly caption: HTMLDivElement;
  private readonly deleteBtn: HTMLButtonElement;

  constructor(private readonly ctx: EditorContext, private readonly state: MapState, openRoomProps: () => void) {
    this.thumbs = new ThumbCache(ctx.assets);
    this.overview = new WorldOverview(ctx, state, this.thumbs, {
      createRoomAt: (gx, gy) => openNewRoomDialog(ctx, ctx.worldId, state.floor, { gx, gy }),
      openRoomProps,
      deleteRoom: (room) => void this.confirmDeleteRoom(room),
    });
    this.list = el('ul', { class: 'qf-map-worlds', role: 'listbox', 'aria-label': 'Worlds' });
    this.musicSel = select(WORLD_MUSIC_OPTIONS, 'none', (v) => setWorldMusic(ctx, ctx.worldId, v), { title: 'Music of this world (rooms can override it)' });
    this.prizeInput = textInput('', (v) => {
      setWorldPrize(ctx, ctx.worldId, v);
      this.prizeInput.value = ctx.world().prizeName ?? '';
    }, { title: 'What this dungeon’s prize is called in the game (“You got the …!”). Blank: “<world name> Crystal”.' });
    this.prizeInput.maxLength = PRIZE_NAME_MAX;
    this.prizeInput.setAttribute('aria-label', 'Prize name');
    this.prizeInput.classList.add('qf-map-left__input');
    this.prizeRow = el('div', { class: 'qf-map-left__row' }, el('span', { class: 'qf-map-left__label' }, 'Prize'), this.prizeInput);
    this.floorSel = select<string>([], '0', (v) => this.pickFloor(Number(v)), { title: 'Floor shown in the overview' });
    this.floorRow = el('div', { class: 'qf-map-left__row' }, el('span', { class: 'qf-map-left__label' }, 'Floor'), this.floorSel);
    this.caption = el('div', { class: 'qf-map-caption' });
    this.deleteBtn = el('button', { class: 'qf-btn qf-btn--small qf-btn--ghost qf-map-danger-ghost', type: 'button', title: 'Delete the selected room', on: { click: () => this.deleteSelected() } },
      mapIcon('trash', 14), 'Delete');
    this.element = el('div', { class: 'qf-map-left' },
      el('div', { class: 'qf-map-left__head' },
        el('span', { class: 'qf-map-left__title' }, 'Worlds'),
        iconButton('plus', 'New world…', () => openNewWorldDialog(ctx))),
      this.list,
      el('div', { class: 'qf-map-left__row' }, el('span', { class: 'qf-map-left__label' }, 'Music'), this.musicSel),
      this.prizeRow,
      el('div', { class: 'qf-map-left__head qf-map-left__head--rooms' },
        el('span', { class: 'qf-map-left__title' }, 'Rooms')),
      this.floorRow,
      this.overview.element,
      this.caption,
      el('div', { class: 'qf-map-left__actions' },
        el('button', { class: 'qf-btn qf-btn--small', type: 'button', title: 'Add a room next to the selected one', on: { click: () => this.addRoomNear() } },
          mapIcon('plus', 14), 'Room'),
        this.deleteBtn),
      el('div', { class: 'qf-map-left__tip qf-muted qf-small' }, 'Double-click an empty cell to add a room · drag rooms to move them'));
    this.refresh();
  }

  /** Rebuild the list, floor choices, caption and overview from the project. */
  refresh(): void {
    this.renderList();
    const world = this.ctx.world();
    this.musicSel.value = world.music;
    this.prizeRow.hidden = world.kind !== 'dungeon';
    this.prizeInput.placeholder = `${world.name} Crystal`;
    if (document.activeElement !== this.prizeInput) this.prizeInput.value = world.prizeName ?? '';
    const floors = floorChoices(world, this.state.floor);
    const showFloors = world.kind === 'dungeon' || new Set(world.rooms.map((r) => r.floor)).size > 1 || this.state.floor !== 0;
    this.floorRow.hidden = !showFloors;
    setSelectOptions(this.floorSel, floors.map((f) => {
      const n = world.rooms.filter((r) => r.floor === f).length;
      return { value: String(f), label: `${floorLabel(f)}${n ? ` · ${n} room${n > 1 ? 's' : ''}` : ' · empty'}` };
    }), String(this.state.floor));
    const room = this.ctx.room();
    this.caption.replaceChildren(room
      ? el('span', null, el('b', null, room.name), ` · ${room.gw}×${room.gh} · ${floorLabel(room.floor)}`)
      : el('span', { class: 'qf-muted' }, 'No room selected'));
    this.deleteBtn.disabled = !room;
    this.overview.refresh();
  }

  destroy(): void {
    this.overview.destroy();
    this.element.remove();
  }

  // ------------------------------------------------------------------ worlds

  /**
   * Rebuild the worlds list. It is one Tab stop (a roving tabindex on the
   * focused row and its actions button): arrows / Home / End move, Enter or
   * Space opens the world, F2 renames, Alt+arrows reorder, Delete deletes and
   * Shift+F10 / the menu key open the actions. Keyboard focus survives rebuilds.
   */
  private renderList(): void {
    const { ctx } = this;
    const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const focusWorld = focused?.closest<HTMLElement>('[data-world]')?.dataset.world;
    const onMore = focused?.classList.contains('qf-map-world__more') ?? false;
    const worlds = ctx.project.worlds;
    const rover = worlds.some((w) => w.id === focusWorld) ? focusWorld : ctx.worldId;
    this.list.replaceChildren(...worlds.map((w, i) => {
      const active = w.id === ctx.worldId;
      const more = iconButton('more', 'World actions (Shift+F10)', (e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.worldMenu(w, i, r.left, r.bottom + 2);
      }, 'qf-map-world__more');
      const item = el('li', {
        class: `qf-map-world${active ? ' qf-map-world--active' : ''}`, role: 'option', 'aria-selected': String(active),
        dataset: { world: w.id },
        title: `${w.name} — ${WORLD_KIND_LABELS[w.kind]}, ${w.rooms.length} room${w.rooms.length === 1 ? '' : 's'}\nEnter opens · F2 renames · Alt+↑/↓ reorders · Delete deletes`,
        on: {
          click: () => this.selectWorld(w),
          dblclick: () => void this.rename(w),
          contextmenu: (e: MouseEvent) => {
            e.preventDefault();
            this.worldMenu(w, i, e.clientX, e.clientY);
          },
          keydown: (e: KeyboardEvent) => this.onWorldKey(e, w, i),
        },
      },
      el('span', { class: `qf-map-world__kind qf-map-world__kind--${w.kind}` }, KIND_SHORT[w.kind]),
      el('span', { class: 'qf-map-world__name' }, w.name),
      el('span', { class: 'qf-map-world__tail' }, el('span', { class: 'qf-map-world__count' }, String(w.rooms.length)), more));
      this.setRoving(item, w.id === rover);
      return item;
    }));
    if (!focusWorld) return;
    const row = this.row(focusWorld) ?? this.row(ctx.worldId);
    (onMore ? row?.querySelector<HTMLElement>('.qf-map-world__more') : row)?.focus({ preventScroll: true });
  }

  private row(worldId: string): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`[data-world="${CSS.escape(worldId)}"]`);
  }

  /** Put a row (and its actions button) in or out of the Tab order. */
  private setRoving(item: HTMLElement, on: boolean): void {
    item.tabIndex = on ? 0 : -1;
    const more = item.querySelector<HTMLElement>('.qf-map-world__more');
    if (more) more.tabIndex = on ? 0 : -1;
  }

  /** Move keyboard focus to another row of the list. */
  private focusRow(item: HTMLElement | undefined): void {
    if (!item) return;
    for (const li of this.list.children) this.setRoving(li as HTMLElement, li === item);
    item.focus();
  }

  private onWorldKey(e: KeyboardEvent, w: World, index: number): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    const row = e.currentTarget as HTMLElement;
    const rows = [...this.list.children] as HTMLElement[];
    const menu = (): void => {
      const r = row.getBoundingClientRect();
      this.worldMenu(w, index, r.left + 24, r.bottom + 2);
    };
    const move = (to: number): void => this.focusRow(rows[Math.max(0, Math.min(rows.length - 1, to))]);
    const keys: Partial<Record<string, () => void>> = e.altKey
      ? { ArrowUp: () => moveWorld(this.ctx, w.id, -1), ArrowDown: () => moveWorld(this.ctx, w.id, 1) }
      : {
        ArrowUp: () => move(index - 1),
        ArrowDown: () => move(index + 1),
        Home: () => move(0),
        End: () => move(rows.length - 1),
        F2: () => void this.rename(w),
        Delete: () => void this.confirmDeleteWorld(w),
        ContextMenu: menu,
        // On the actions button, Enter / Space press the button instead.
        ...(e.target === row ? { Enter: () => this.selectWorld(w), ' ': () => this.selectWorld(w) } : {}),
      };
    let run: (() => void) | undefined;
    if (e.shiftKey) run = e.key === 'F10' && !e.altKey ? menu : undefined;
    else run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  /** Rename / reorder / delete menu of a world. */
  private worldMenu(w: World, index: number, x: number, y: number): void {
    const { ctx } = this;
    const count = ctx.project.worlds.length;
    const entries: MenuEntry[] = [
      { header: `${w.name} · ${WORLD_KIND_LABELS[w.kind]}` },
      { label: 'Rename…', icon: 'edit', action: () => void this.rename(w) },
      { label: 'Move up', icon: 'up', disabled: index === 0, action: () => moveWorld(ctx, w.id, -1) },
      { label: 'Move down', icon: 'down', disabled: index === count - 1, action: () => moveWorld(ctx, w.id, 1) },
      'separator',
      { label: count > 1 ? 'Delete world…' : 'Delete world (keep at least one)', icon: 'trash', danger: true, disabled: count <= 1, action: () => void this.confirmDeleteWorld(w) },
    ];
    openMenu(x, y, entries);
  }

  private selectWorld(w: World): void {
    if (w.id === this.ctx.worldId) return;
    const roomId = entryRoom(this.ctx.project, w);
    this.state.setFloor(w.rooms.find((r) => r.id === roomId)?.floor ?? 0);
    this.ctx.selectRoom(w.id, roomId);
  }

  private async rename(w: World): Promise<void> {
    const back = this.focusReturn(w.id);
    const name = await promptDialog('World name', w.name, { title: 'Rename world', ok: 'Rename' });
    if (name !== null) renameWorld(this.ctx, w.id, name);
    back();
  }

  private async confirmDeleteWorld(w: World): Promise<void> {
    if (this.ctx.project.worlds.length <= 1) {
      this.ctx.toast('A project needs at least one world.', 'error');
      return;
    }
    const back = this.focusReturn(w.id);
    const hasStart = this.ctx.project.start.world === w.id;
    const n = w.rooms.length;
    const ok = await confirmDialog(
      `Delete “${w.name}” and its ${n} room${n === 1 ? '' : 's'}?${hasStart ? ' The game start is in this world — set a new start afterwards.' : ''} Warps into it will stop working. (Undo brings it back.)`,
      { title: 'Delete world', ok: 'Delete world', danger: true });
    if (ok) deleteWorld(this.ctx, w.id);
    back();
  }

  /** If the list has keyboard focus now, a function that puts it back on a world's row (or the shown world's) after a dialog. */
  private focusReturn(worldId: string): () => void {
    if (!this.list.contains(document.activeElement)) return () => undefined;
    return () => this.focusRow(this.row(worldId) ?? this.row(this.ctx.worldId) ?? undefined);
  }

  // ------------------------------------------------------------------ rooms

  private pickFloor(floor: number): void {
    this.state.setFloor(floor);
    const room = this.ctx.room();
    if (room?.floor !== floor) {
      const first = this.ctx.world().rooms.find((r) => r.floor === floor);
      this.ctx.selectRoom(this.ctx.worldId, first?.id ?? null);
    }
  }

  private addRoomNear(): void {
    const world = this.ctx.world();
    const sel = this.ctx.room();
    const near = sel && sel.floor === this.state.floor ? { gx: sel.gx + sel.gw, gy: sel.gy } : { gx: 0, gy: 0 };
    openNewRoomDialog(this.ctx, world.id, this.state.floor, freeSpot(world, this.state.floor, 1, 1, near));
  }

  private deleteSelected(): void {
    const room = this.ctx.room();
    if (room) void this.confirmDeleteRoom(room);
  }

  /** Ask, then delete a room (if it was selected, the nearest room on its floor is selected instead). */
  async confirmDeleteRoom(room: Room): Promise<void> {
    const world = this.ctx.world();
    const hasStart = this.ctx.project.start.room === room.id;
    const ok = await confirmDialog(
      `Delete room “${room.name}” with its tiles, ${plural(room.entities.length, 'entity', 'entities')} and ${plural(room.triggers.length, 'trigger')}?${hasStart ? ' The game start is in this room — set a new start afterwards.' : ''} (Undo brings it back.)`,
      { title: 'Delete room', ok: 'Delete room', danger: true });
    if (ok) deleteRoom(this.ctx, world.id, room.id);
  }
}
