// Map tab: world list + world overview (left), the room canvas with its toolbar
// and status bar (centre), and a sidebar with the tile palette, the entity panel
// (mountEntityPanel), the trigger panel (mountTriggerPanel) and room properties
// (right). Owns the map keyboard shortcuts, registers ctx.setLocationPicker
// (a pick ends when the tab is left), keeps the Entities sidebar and the entity
// tool together and opens the sidebar a jump from another tab points at (a
// trigger or an entity).
import './map.css';
import type { LayerName } from '../../core/types';
import type { EditorContext, Panel } from '../context';
import type { SidebarTab } from './mapState';
import { LAYERS } from '../../core/types';
import { el, tabs } from '../ui/dom';
import { mountEntityPanel } from '../entities/entityPanel';
import { mountTriggerPanel } from '../entities/triggerPanel';
import { hasTriggerFocus, takeEntityFocus } from '../entities/focus';
import { ArtWatch } from './artStamp';
import { MapState } from './mapState';
import { MapToolbar } from './toolbar';
import { RoomCanvas } from './roomCanvas';
import { StatusBar } from './statusBar';
import { TilePalette } from './tilePalette';
import { RoomProps } from './roomProps';
import { WorldPanel } from './worldPanel';
import { closeMenu } from './contextMenu';
import { ownsCharacterKeys } from '../shell/keys';
import { TILE_TOOLS, toolForKey } from './tools/tool';
import { hasClip } from './tools/select';

const SIDEBAR_TABS: readonly { id: SidebarTab; label: string; title: string }[] = [
  { id: 'tiles', label: 'Tiles', title: 'Tile palette & terrain brushes' },
  { id: 'entities', label: 'Entities', title: 'Place and edit enemies, objects, NPCs and markers' },
  { id: 'triggers', label: 'Triggers', title: 'Room event rules' },
  { id: 'room', label: 'Room', title: 'Room properties' },
];

type Mount = (el: HTMLElement, ctx: EditorContext) => Panel;

/** Keys that move or delete the room selection; a focused control in a side column keeps them. */
const NAV_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Whether the focused control keeps this key: text entry and selects own every
 * key (the shell's rule), and any control in a side column (`sides`) the
 * navigation / delete keys (sliders, lists), so browsing a list never nudges or
 * deletes the entity behind it. Tool letters and view keys still reach the map
 * from checkboxes and buttons.
 */
function controlOwnsKey(e: KeyboardEvent, sides: readonly HTMLElement[]): boolean {
  const target = e.target;
  if (ownsCharacterKeys(target)) return true;
  return target instanceof Node && NAV_KEYS.has(e.key) && sides.some((side) => side.contains(target));
}

/** A sibling panel mounted lazily into a host; a failure shows its message instead of breaking the tab. */
class LazyPanel {
  private panel: Panel | null = null;

  constructor(readonly host: HTMLElement, private readonly mount: Mount, private readonly ctx: EditorContext, private readonly name: string) {}

  show(): void {
    if (this.panel) {
      this.panel.refresh?.();
      return;
    }
    try {
      this.panel = this.mount(this.host, this.ctx);
    } catch (err) {
      console.error(`[map] the ${this.name} panel failed to load:`, err);
      this.host.replaceChildren(el('div', { class: 'qf-empty' }, `The ${this.name} panel could not be loaded.`));
      this.panel = { destroy: () => this.host.replaceChildren() };
    }
  }

  destroy(): void {
    try {
      this.panel?.destroy();
    } catch (err) {
      console.error(`[map] the ${this.name} panel failed to clean up:`, err);
    }
    this.panel = null;
  }
}

export function mountMapTab(root: HTMLElement, ctx: EditorContext): Panel {
  const state = new MapState();
  state.floor = ctx.room()?.floor ?? 0;
  const status = new StatusBar();
  const canvas = new RoomCanvas(ctx, state, status);
  const toolbar = new MapToolbar(ctx, state);
  const world = new WorldPanel(ctx, state, () => state.showSidebar('room'));
  const palette = new TilePalette(ctx, state);
  const props = new RoomProps(ctx, state, { deleteRoom: (room) => void world.confirmDeleteRoom(room) });

  const hosts: Record<SidebarTab, HTMLDivElement> = {
    tiles: el('div', { class: 'qf-map-right__panel', dataset: { panel: 'tiles' } }, palette.element),
    entities: el('div', { class: 'qf-map-right__panel qf-map-right__panel--scroll', dataset: { panel: 'entities' } }),
    triggers: el('div', { class: 'qf-map-right__panel qf-map-right__panel--scroll', dataset: { panel: 'triggers' } }),
    room: el('div', { class: 'qf-map-right__panel qf-map-right__panel--scroll', dataset: { panel: 'room' } }, props.element),
  };
  const lazy = {
    entities: new LazyPanel(hosts.entities, mountEntityPanel, ctx, 'entities'),
    triggers: new LazyPanel(hosts.triggers, mountTriggerPanel, ctx, 'triggers'),
  };
  const sideTabs = tabs(SIDEBAR_TABS, state.sidebar, (id) => state.showSidebar(id as SidebarTab));
  const showSidebar = (tab: SidebarTab): void => {
    sideTabs.setActive(tab);
    for (const [id, host] of Object.entries(hosts) as [SidebarTab, HTMLDivElement][]) host.hidden = id !== tab;
    if (tab === 'entities' || tab === 'triggers') lazy[tab].show();
    else if (tab === 'room') props.refresh();
    else palette.refresh();
  };

  const right = el('div', { class: 'qf-map-right' }, sideTabs.element, el('div', { class: 'qf-map-right__body' }, ...Object.values(hosts)));
  const element = el('div', { class: 'qf-map' },
    world.element,
    el('div', { class: 'qf-map-center' }, toolbar.element, canvas.element, status.element),
    right);
  const sides = [world.element, right];
  root.appendChild(element);
  showSidebar(state.sidebar);

  // ---------------------------------------------------------------- coordination

  /** Whether the tab is on screen (events while hidden wait for the shell's refresh()). */
  const active = (): boolean => element.isConnected && element.offsetParent !== null;
  const art = new ArtWatch(() => ctx.project);
  /** Repaint only the thumbnail cells whose tile art changed (while hidden, refresh() catches up). */
  const syncArt = (): void => {
    if (active()) world.thumbs.forget(art.changedTiles());
  };
  /** Everything may have changed (project replaced / all assets): drop every thumbnail. */
  const resetArt = (): void => {
    art.reset();
    world.thumbs.invalidate();
  };
  /** Deleted rooms' thumbnails go (room ids are never reused; an undone delete rebuilds its thumbnail). */
  const pruneThumbs = (): void => {
    world.thumbs.prune(new Set(ctx.project.worlds.flatMap((w) => w.rooms.map((r) => r.id))));
  };
  const syncFloor = (): void => {
    const room = ctx.room();
    if (room && room.floor !== state.floor) state.setFloor(room.floor);
  };
  const refreshWorld = (): void => {
    if (!active()) return;
    syncFloor();
    world.refresh();
  };
  /** After a usage or validation jump from another tab, show the sidebar that lists the trigger or entity it selected. */
  const revealJump = (): void => {
    const entity = takeEntityFocus(ctx.roomId);
    if (hasTriggerFocus(ctx.roomId)) {
      state.showSidebar('triggers');
    } else if (entity !== null && entity === ctx.entityId) {
      state.showSidebar('entities'); // picks the entity tool too
    }
  };
  /**
   * The Entities sidebar belongs to the entity tool: opening it picks that tool
   * (so clicking an entity selects it instead of painting under it), and going
   * back to the tiles restores the tile tool used before.
   */
  const onSidebar = (tab: SidebarTab): void => {
    showSidebar(tab);
    if (tab === 'entities') state.setTool('entity');
    else if (tab === 'tiles' && state.tool === 'entity') {
      const prev = state.previousTool;
      state.setTool(prev === 'eyedropper' || TILE_TOOLS.includes(prev) ? prev : 'pencil');
    }
  };
  const onTool = (): void => {
    const tool = state.tool;
    if (tool === 'entity' && state.sidebar === 'tiles') state.showSidebar('entities');
    else if (tool !== 'entity' && state.sidebar === 'entities') state.showSidebar('tiles');
    if (tool !== 'entity' && ctx.entityType) ctx.selectEntityType(null);
    if (tool === 'terrain' && ctx.terrainId === null && ctx.project.terrains[0]) {
      const first = ctx.project.terrains[0];
      ctx.selectTerrain(first.id);
      ctx.selectLayer(first.layer);
    }
  };
  const offs = [
    state.bus.on('sidebar', onSidebar),
    state.bus.on('tool', onTool),
    state.bus.on('floor', () => world.refresh()),
    ctx.bus.on('selection', ({ what }) => {
      if (what === 'room') refreshWorld();
      else if (what === 'entityType' && ctx.entityType) state.setTool('entity');
    }),
    ctx.bus.on('project', ({ what }) => {
      if (what === 'all') resetArt();
      else if (what === 'tiles' || what === 'palettes') syncArt();
      else if (what === 'rooms' || what === 'worlds') pruneThumbs();
      if (['room', 'rooms', 'worlds', 'settings', 'tiles', 'palettes', 'all'].includes(what)) refreshWorld();
    }),
    ctx.bus.on('assets', ({ kind }) => {
      if (kind === 'sprite') return;
      if (kind === 'all') resetArt();
      else syncArt();
      refreshWorld();
    }),
    ctx.bus.on('undo', () => {
      pruneThumbs();
      syncArt();
      refreshWorld();
    }),
    // Leaving the map abandons a location pick (the shell resolves it as cancelled too).
    ctx.bus.on('tab', ({ id }) => {
      if (id === 'map') revealJump();
      else state.endPick(null);
    }),
  ];

  // ---------------------------------------------------------------- keyboard

  const cycleLayer = (dir: number): void => {
    const i = LAYERS.indexOf(ctx.layer);
    ctx.selectLayer(LAYERS[(i + dir + LAYERS.length) % LAYERS.length] as LayerName);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!active() || e.defaultPrevented || controlOwnsKey(e, sides) || document.querySelector('.qf-modal-backdrop')) return;
    if (canvas.handleKey(e)) {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.code === 'KeyV' && hasClip()) {
      e.preventDefault();
      state.setTool('select');
      canvas.tools.select.startPaste(canvas);
      return;
    }
    if (mod && !e.altKey && e.code === 'KeyA') {
      // Select the whole room instead of the page text, from any tool.
      e.preventDefault();
      state.setTool('select');
      canvas.tools.select.selectAll(canvas, e.shiftKey);
      return;
    }
    if (mod || e.altKey) return;
    const tool = e.key.length === 1 ? toolForKey(e.key) : null;
    if (tool && !e.shiftKey) {
      e.preventDefault();
      state.setTool(tool);
      return;
    }
    const actions: Partial<Record<string, () => void>> = {
      g: () => state.setPrefs({ grid: !state.prefs.grid }),
      c: () => state.setPrefs({ collision: !state.prefs.collision }),
      '[': () => cycleLayer(-1),
      ']': () => cycleLayer(1),
      '=': () => canvas.zoomBy(1),
      '+': () => canvas.zoomBy(1),
      '-': () => canvas.zoomBy(-1),
      '0': () => canvas.fit(),
    };
    const run = actions[e.key.toLowerCase()];
    if (run) {
      e.preventDefault();
      run();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => canvas.handleKeyUp(e);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  ctx.setLocationPicker((prompt) => state.beginPick(prompt));

  return {
    refresh(): void {
      world.thumbs.forget(art.changedTiles());
      canvas.refresh();
      syncFloor();
      world.refresh();
      revealJump();
      showSidebar(state.sidebar);
    },
    destroy(): void {
      closeMenu();
      ctx.setLocationPicker(null);
      state.endPick(null);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      for (const off of offs) off();
      lazy.entities.destroy();
      lazy.triggers.destroy();
      props.destroy();
      palette.destroy();
      world.destroy();
      toolbar.destroy();
      canvas.destroy();
      status.dispose();
      element.remove();
    },
  };
}
