// Room sidebar tab: name, size (undoable resize), grid position, floor, music
// (with preview), darkness, pit target (picked on the map), wall stamping and
// room actions. Re-renders are batched per frame, keep keyboard focus on the
// same control, and wait until the tab is visible (refresh()); Enter in a field
// commits it and returns the keyboard to the map. While the pit target is being
// picked, the tab stays on the room the pick is for.
import type { MusicId, Room, WarpTarget, World } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapState } from './mapState';
import type { WallStyle } from './walls';
import { MAX_ROOM_SCREENS, SCREEN_H, SCREEN_W } from '../../core/constants';
import { MUSIC_IDS } from '../../core/types';
import { findRoom, findWorld, gridOverlaps, roomCols, roomRows } from '../../core/project';
import { getAudio } from '../../audio/audio';
import { button, checkbox, confirmDialog, el, field, numberInput, select, textInput } from '../ui/dom';
import { MergingRoomEdit, commitTiles, editRoom } from './history';
import { mapIcon } from './icons';
import { GRID_LIMIT, floorLabel, moveRoom, resizeLoss, resizeRoomUndoable, withinGrid, type ResizeLoss } from './roomOps';
import { TileEdit } from './tileEdit';
import { WALL_STYLE_LABELS, detectWalls, stampWalls, wallStyleFor, wallStyleForFill } from './walls';
import { dominantTile } from './geometry';

type RoomMusic = MusicId | 'none' | 'inherit';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const MUSIC_OPTIONS: readonly { value: RoomMusic; label: string }[] = [
  { value: 'inherit', label: 'Same as world' },
  { value: 'none', label: 'Silence' },
  ...MUSIC_IDS.map((m) => ({ value: m, label: cap(m) })),
];

const SIZE_OPTIONS = Array.from({ length: MAX_ROOM_SCREENS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

/** "World › Room (x, y)" for a warp target, or a hint when unset / dangling. */
export function targetLabel(p: { worlds: readonly World[] }, t: WarpTarget | undefined): string {
  if (!t) return 'Not set — falling hurts and respawns the player';
  const world = p.worlds.find((w) => w.id === t.world);
  const room = world?.rooms.find((r) => r.id === t.room);
  if (!world || !room) return 'Missing room — pick a new target';
  return `${world.name} › ${room.name} (${t.x}, ${t.y})`;
}

/** Tag a control so keyboard focus can find it again after a re-render. */
function keyed<T extends HTMLElement>(key: string, node: T): T {
  const target = node instanceof HTMLLabelElement ? node.querySelector('input') ?? node : node;
  target.dataset.key = key;
  return node;
}

export interface RoomPropsActions {
  deleteRoom(room: Room): void;
}

export class RoomProps {
  readonly element: HTMLDivElement;
  private readonly offs: (() => void)[] = [];
  private readonly merged: MergingRoomEdit;
  private previewing: MusicId | null = null;
  private previewBtn: HTMLButtonElement | null = null;
  /** Room whose pit target is being picked (the tab stays on it until the pick ends). */
  private picking: { world: string; room: string } | null = null;
  private raf = 0;

  constructor(private readonly ctx: EditorContext, private readonly state: MapState, private readonly actions: RoomPropsActions) {
    this.element = el('div', { class: 'qf-map-props' });
    // Enter commits a text / number field and hands the keyboard back to the map shortcuts.
    this.element.addEventListener('keydown', (e) => {
      const field = e.target;
      if (e.key === 'Enter' && field instanceof HTMLInputElement && (field.type === 'text' || field.type === 'number')) field.blur();
    });
    this.merged = new MergingRoomEdit(ctx);
    this.offs.push(
      ctx.bus.on('selection', ({ what }) => {
        if (what !== 'room') return;
        if (!this.picking) this.stopPreview();
        this.requestRender();
      }),
      ctx.bus.on('project', ({ what }) => {
        if (what === 'room' || what === 'rooms' || what === 'worlds' || what === 'all' || what === 'entities' || what === 'triggers') this.requestRender();
      }),
      ctx.bus.on('undo', () => this.requestRender()),
      // The preview belongs to this tab: leaving the Map tab or the Room sidebar stops it.
      ctx.bus.on('tab', ({ id }) => {
        if (id !== 'map') this.stopPreview();
      }),
      state.bus.on('sidebar', (tab) => {
        if (tab !== 'room') this.stopPreview();
      }),
      state.bus.on('pick', () => this.requestRender()),
    );
    this.render();
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.stopPreview();
    this.merged.dispose();
    for (const off of this.offs.splice(0)) off();
    this.element.remove();
  }

  /** Render before the next frame if visible (refresh() renders when the tab is shown). */
  private requestRender(): void {
    if (this.element.offsetParent === null || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** The room shown: the one a pending pit pick is for, else the selected room. */
  private shown(): { world: World; room: Room } | null {
    const p = this.picking;
    if (p && this.state.pickPrompt !== null) {
      const world = findWorld(this.ctx.project, p.world);
      const room = findRoom(this.ctx.project, p.world, p.room);
      if (world && room) return { world, room };
    }
    const room = this.ctx.room();
    return room ? { world: this.ctx.world(), room } : null;
  }

  private render(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.element.contains(active) ? active.dataset.key : undefined;
    const shown = this.shown();
    if (!shown) {
      this.element.replaceChildren(el('div', { class: 'qf-empty' }, 'Select a room in the world overview to edit its properties.'));
      return;
    }
    const pinned = this.picking !== null && this.state.pickPrompt !== null;
    const body = el('div', { class: `qf-map-props__body${pinned ? ' qf-map-props__body--pinned' : ''}`, inert: pinned },
      ...this.sections(shown.world, shown.room));
    if (pinned) this.element.replaceChildren(this.pickNotice(shown.room), body);
    else this.element.replaceChildren(body);
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  private sections(world: World, room: Room): (HTMLElement | null)[] {
    const { ctx } = this;
    const edit = (label: string, mutate: (r: Room) => void): void => {
      editRoom(ctx, world.id, room.id, label, 'room', mutate);
    };
    return [
      el('div', { class: 'qf-map-props__head' },
        el('div', { class: 'qf-map-props__title' }, room.name),
        el('div', { class: 'qf-map-props__id' },
          el('code', { title: 'Room id (used by warps and triggers)' }, room.id),
          keyed('copyid', button(mapIcon('copy', 12), () => void this.copyId(room.id), { small: true, kind: 'ghost', title: 'Copy the room id' })))),
      this.group('General',
        field('Name', keyed('name', textInput(room.name, (v) => {
          const name = v.trim();
          if (name) edit('Rename room', (r) => { r.name = name; });
          else this.requestRender();
        }))),
        field('Size', el('div', { class: 'qf-row qf-map-props__size' },
          keyed('gw', select(SIZE_OPTIONS, String(room.gw), (v) => void this.resize(world, room, Number(v), room.gh), { title: 'Width in screens' })),
          el('span', { class: 'qf-muted' }, '×'),
          keyed('gh', select(SIZE_OPTIONS, String(room.gh), (v) => void this.resize(world, room, room.gw, Number(v)), { title: 'Height in screens' })),
          el('span', { class: 'qf-muted qf-small' }, `screens · ${roomCols(room)}×${roomRows(room)} tiles`)),
        'Walled rooms move their right / bottom walls (with their doorways, and the warps arriving at them). Shrinking asks first when it would drop entities, painted tiles or trigger tile changes.'),
        field('Position', el('div', { class: 'qf-row qf-map-props__pos' },
          el('span', { class: 'qf-muted qf-small' }, 'X'),
          keyed('gx', numberInput(room.gx, (v) => this.place(world, room, Math.round(v), room.gy), { step: 1, min: -GRID_LIMIT, max: GRID_LIMIT - room.gw + 1, title: 'Grid column (screens)' })),
          el('span', { class: 'qf-muted qf-small' }, 'Y'),
          keyed('gy', numberInput(room.gy, (v) => this.place(world, room, room.gx, Math.round(v)), { step: 1, min: -GRID_LIMIT, max: GRID_LIMIT - room.gh + 1, title: 'Grid row (screens)' }))),
        'Top-left screen on the world grid. Rooms whose edges touch connect.'),
        field('Floor', el('div', { class: 'qf-row' },
          keyed('floor', numberInput(room.floor, (v) => this.setFloor(world, room, Math.round(v)), { step: 1, min: -9, max: 9, title: 'Floor index (0 = ground)' })),
          el('span', { class: 'qf-muted qf-small' }, floorLabel(room.floor))),
        'Edges only connect rooms on the same floor.')),
      this.group('Atmosphere',
        field('Music', el('div', { class: 'qf-row qf-map-props__music' },
          keyed('music', select(MUSIC_OPTIONS, room.music ?? 'inherit', (v) => {
            this.stopPreview();
            // Arrowing through the list is one undo step.
            this.merged.run(world.id, room.id, 'music', 'Room music', 'room', (r) => { r.music = v; });
          })),
          keyed('preview', this.previewButton(world, room)))),
        field('', keyed('dark', checkbox(!!room.dark, (v) => edit(v ? 'Make room dark' : 'Light room', (r) => { r.dark = v; }), 'Dark room (lantern & torches light it)')))),
      this.group('Pits',
        field('Pit target', el('div', { class: 'qf-map-props__target' },
          el('div', { class: `qf-map-props__targetlabel${room.pitTarget ? '' : ' qf-muted'}` }, targetLabel(ctx.project, room.pitTarget)),
          el('div', { class: 'qf-row' },
            keyed('pick', button([mapIcon('target', 14), 'Pick on map…'], () => void this.pickPit(world.id, room), { small: true })),
            room.pitTarget ? keyed('clearpit', button('Clear', () => edit('Clear pit target', (r) => { delete r.pitTarget; }), { small: true, kind: 'ghost' })) : null)),
        'Where the player lands after falling into a pit here (e.g. the floor below).')),
      this.wallsGroup(world, room),
      this.group('Room',
        el('div', { class: 'qf-map-props__stats qf-muted qf-small' },
          `${room.entities.length} entit${room.entities.length === 1 ? 'y' : 'ies'} · ${room.triggers.length} trigger${room.triggers.length === 1 ? '' : 's'}`),
        el('div', { class: 'qf-row' },
          keyed('playtest', button([mapIcon('play', 14), 'Playtest room'], () => ctx.playtest({ world: world.id, room: room.id, x: (room.gw * SCREEN_W) / 2, y: (room.gh * SCREEN_H) / 2, dir: 'down' }), { small: true })),
          keyed('delete', button([mapIcon('trash', 14), 'Delete room…'], () => this.actions.deleteRoom(room), { small: true, kind: 'danger' })))),
    ];
  }

  /** Banner shown while the pit target of `room` is being picked. */
  private pickNotice(room: Room): HTMLElement {
    return el('div', { class: 'qf-map-props__picking', role: 'status' },
      mapIcon('target', 14),
      el('span', { class: 'qf-grow' }, 'Picking the pit landing spot for ', el('b', null, `“${room.name}”`), ' — click a spot in any room on the map.'),
      keyed('cancelpick', button('Cancel', () => this.state.endPick(null), { small: true })));
  }

  private group(title: string, ...children: (Node | null)[]): HTMLElement {
    return el('section', { class: 'qf-map-props__group' }, el('div', { class: 'qf-map-props__gtitle' }, title), ...children);
  }

  /** Wall stamping, for dungeon / interior rooms and cave or wood rooms elsewhere (none for plain overworld rooms). */
  private wallsGroup(world: World, room: Room): HTMLElement | null {
    const current = detectWalls(room);
    const fallback = wallStyleFor(world.kind) ?? wallStyleForFill(dominantTile(room.layers.bg));
    if (!current && !fallback) return null;
    let style: WallStyle = current ?? fallback!;
    const styles = (Object.keys(WALL_STYLE_LABELS) as WallStyle[]).map((s) => ({ value: s, label: WALL_STYLE_LABELS[s] }));
    return this.group('Walls',
      field('Border', el('div', { class: 'qf-row' },
        keyed('wallstyle', select(styles, style, (v) => { style = v; })),
        keyed('stamp', button([mapIcon('walls', 14), 'Stamp walls'], () => this.stampWalls(world.id, room.id, style), { small: true, title: 'Draw a one-tile wall border around the ground layer' }))),
      current ? `This room has a ${WALL_STYLE_LABELS[current].toLowerCase()} border.` : 'Draws a one-tile border of wall pieces around the room.'));
  }

  /** Whether the preview still plays (a playtest or another tab may have changed the music since). */
  private previewPlaying(): boolean {
    if (this.previewing !== null && getAudio().currentMusic !== this.previewing) this.previewing = null;
    return this.previewing !== null;
  }

  private previewButton(world: World, room: Room): HTMLButtonElement {
    const music = room.music === undefined || room.music === 'inherit' ? world.music : room.music;
    const playing = this.previewPlaying() && this.previewing === music;
    const b = button(mapIcon(playing ? 'stop' : 'play', 12), () => {
      if (this.previewPlaying()) this.stopPreview();
      else if (music !== 'none') this.startPreview(music, b);
    }, { small: true, title: music === 'none' ? 'No music plays here' : playing ? 'Stop preview' : `Preview “${cap(music)}”`, disabled: music === 'none' });
    this.previewBtn = b;
    return b;
  }

  private startPreview(music: MusicId, b: HTMLButtonElement): void {
    const audio = getAudio();
    audio.unlock();
    audio.music(music);
    this.previewing = music;
    b.replaceChildren(mapIcon('stop', 12));
    b.title = 'Stop preview';
  }

  private stopPreview(): void {
    if (this.previewing === null) return;
    // Music someone else started since (a playtest) is not ours to stop.
    if (this.previewPlaying()) getAudio().music('none');
    this.previewing = null;
    if (this.previewBtn) {
      this.previewBtn.replaceChildren(mapIcon('play', 12));
      this.previewBtn.title = 'Preview';
    }
  }

  private async resize(world: World, room: Room, gw: number, gh: number): Promise<void> {
    if (gw === room.gw && gh === room.gh) return;
    if (gridOverlaps(world, room.gx, room.gy, gw, gh, room.floor, room.id)) {
      this.ctx.toast('That size would overlap a neighbouring room — move one of them first.', 'error');
      this.requestRender();
      return;
    }
    const loss = resizeLoss(this.ctx.project, room, gw, gh);
    const shrinking = gw < room.gw || gh < room.gh;
    if ((shrinking && !(await this.confirmShrink(room, gw, gh, loss))) || !resizeRoomUndoable(this.ctx, world.id, room.id, gw, gh)) {
      this.requestRender();
      return;
    }
    if (loss.arrivals > 0) {
      this.ctx.toast(`Moved ${loss.arrivals} arrival point${loss.arrivals === 1 ? '' : 's'} into “${room.name}” (warps, pit targets, start) along with its walls.`, 'info');
    }
  }

  /** Ask before a shrink drops entities, painted tiles or trigger tile changes (true when nothing would be lost). */
  private confirmShrink(room: Room, gw: number, gh: number, loss: ResizeLoss): Promise<boolean> {
    const parts = [
      loss.entities > 0 ? `${loss.entities} entit${loss.entities === 1 ? 'y' : 'ies'}` : '',
      loss.tiles > 0 ? `${loss.tiles} painted tile${loss.tiles === 1 ? '' : 's'}` : '',
      loss.actions > 0 ? `${loss.actions} trigger tile change${loss.actions === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    if (parts.length === 0) return Promise.resolve(true);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return confirmDialog(
      `Shrinking “${room.name}” to ${gw}×${gh} screens removes ${list}. Undo (Ctrl+Z) brings them back.`,
      { title: 'Shrink room?', ok: 'Shrink', danger: true },
    );
  }

  private place(world: World, room: Room, gx: number, gy: number): void {
    if (gx === room.gx && gy === room.gy) return;
    if (!moveRoom(this.ctx, world.id, room.id, gx, gy)) {
      this.ctx.toast(withinGrid(gx, gy, room.gw, room.gh)
        ? 'Another room already covers that spot on this floor.'
        : `Rooms must stay within ${GRID_LIMIT} screens of the origin.`, 'error');
      this.requestRender();
    }
  }

  private setFloor(world: World, room: Room, floor: number): void {
    if (floor === room.floor) return;
    if (!moveRoom(this.ctx, world.id, room.id, room.gx, room.gy, floor)) {
      this.ctx.toast(`Another room already sits at this grid position on ${floorLabel(floor)}.`, 'error');
      this.requestRender();
      return;
    }
    this.state.setFloor(floor);
  }

  private async pickPit(worldId: string, room: Room): Promise<void> {
    this.picking = { world: worldId, room: room.id };
    let target: WarpTarget | null;
    try {
      target = await this.ctx.pickLocation(`pit landing spot for “${room.name}”`);
    } finally {
      this.picking = null;
    }
    this.requestRender();
    if (!target) return;
    this.ctx.selectRoom(worldId, room.id);
    editRoom(this.ctx, worldId, room.id, 'Set pit target', 'room', (r) => { r.pitTarget = target; });
    this.state.showSidebar('room');
  }

  private stampWalls(worldId: string, roomId: string, style: WallStyle): void {
    const room = findRoom(this.ctx.project, worldId, roomId);
    if (!room || !findWorld(this.ctx.project, worldId)) return;
    const edit = new TileEdit(room);
    stampWalls(edit, style);
    commitTiles(this.ctx, worldId, roomId, 'Stamp walls', edit.changes());
  }

  private async copyId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      this.ctx.toast('Room id copied', 'success');
    } catch {
      this.ctx.toast(id, 'info');
    }
  }
}
