// Tiles sidebar tab: current brush preview, search, recently used tiles, the
// terrain brushes and every tile grouped by tag (collapsible; the current
// world's kind first), drawn at 2x from the asset cache. Clicking a tile makes
// it the brush; a terrain selects the terrain tool. Re-renders wait until the
// panel is visible.
import type { Project, Terrain, TileDef, WorldKind } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapState } from './mapState';
import { terrainPieces } from '../../core/autotile';
import { getSetting, setSetting } from '../../core/storage';
import { el, pixelCanvas } from '../ui/dom';
import { mapIcon } from './icons';
import { BRUSH_TOOLS } from './mapState';
import { layerLabel } from './tools/paint';

const GROUP_ORDER = ['overworld', 'dungeon', 'interior', 'cave'];
const RECENT_MAX = 14;
const COLLAPSED_KEY = 'map.palette.collapsed';
/** Recently used tiles, per browser (ids missing from the open project are skipped). */
const RECENT_KEY = 'map.recent';

export interface TileSubgroup { tag: string; tiles: TileDef[] }
export interface TileGroup { tag: string; subs: TileSubgroup[]; count: number }

/** Palette group shown first for a world kind. */
const KIND_GROUP: Readonly<Record<WorldKind, string>> = { overworld: 'overworld', dungeon: 'dungeon', interior: 'interior' };

/**
 * Group tiles by their first tag, sub-grouped by their second tag. Autotile edge
 * pieces (`pieces`) go to a trailing "autotile pieces" subgroup of their group.
 * Groups follow GROUP_ORDER, with `lead` (e.g. the world's kind) moved first.
 */
export function groupTiles(tiles: readonly TileDef[], pieces: ReadonlySet<number>, lead?: string): TileGroup[] {
  const groups = new Map<string, Map<string, TileDef[]>>();
  for (const t of [...tiles].sort((a, b) => a.id - b.id)) {
    const tag = t.tags[0] ?? 'custom';
    const sub = pieces.has(t.id) ? 'autotile pieces' : t.tags[1] ?? 'general';
    let subs = groups.get(tag);
    if (!subs) groups.set(tag, (subs = new Map()));
    let list = subs.get(sub);
    if (!list) subs.set(sub, (list = []));
    list.push(t);
  }
  const rank = (tag: string): number => {
    if (tag === lead) return -1;
    const i = GROUP_ORDER.indexOf(tag);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([tag, subs]) => {
      const list = [...subs.entries()]
        .sort(([a], [b]) => Number(a === 'autotile pieces') - Number(b === 'autotile pieces'))
        .map(([sub, ts]) => ({ tag: sub, tiles: ts }));
      return { tag, subs: list, count: list.reduce((n, s) => n + s.tiles.length, 0) };
    });
}

/** Whether a tile matches a search query (name, key, tag or id). */
export function tileMatches(t: TileDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || String(t.id) === q || t.tags.some((g) => g.toLowerCase().includes(q));
}

/** Tooltip text for a tile. */
export function tileTooltip(t: TileDef): string {
  const coll = t.collision === 'ledge' && t.ledgeDir ? `ledge (hop ${t.ledgeDir})` : t.collision;
  const extra = [t.cut ? 'cuttable' : '', t.lift ? `liftable${t.lift.weight ? ` (gauntlet ${t.lift.weight})` : ''}` : '', t.bomb ? 'bombable' : '', t.frames.length > 1 ? 'animated' : '']
    .filter(Boolean).join(', ');
  return `${t.name}\n${coll}${extra ? ` · ${extra}` : ''}\nid ${t.id} · ${t.key}`;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything the palette shows that undo can change behind its back. */
function paletteStamp(p: Project): string {
  return JSON.stringify([p.tiles, p.terrains, p.palettes]);
}

export class TilePalette {
  readonly element: HTMLDivElement;
  private readonly brush: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly scroll: HTMLDivElement;
  private readonly buttons = new Map<number, HTMLButtonElement[]>();
  private readonly terrainButtons = new Map<string, HTMLButtonElement>();
  private readonly recent: number[];
  private readonly collapsed: Set<string>;
  private readonly offs: (() => void)[] = [];
  private query = '';
  /** Stamp and world kind of the last render; `dirty` = a render was skipped while hidden. */
  private stamp = '';
  private kind: WorldKind;
  private dirty = false;

  constructor(private readonly ctx: EditorContext, private readonly state: MapState) {
    this.recent = getSetting<number[]>(RECENT_KEY, []).filter((n) => Number.isInteger(n));
    this.collapsed = new Set(getSetting<string[]>(COLLAPSED_KEY, []));
    this.brush = el('div', { class: 'qf-map-brush' });
    this.search = el('input', { class: 'qf-input qf-map-search__input', type: 'search', placeholder: 'Search tiles…', 'aria-label': 'Search tiles' });
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.render();
    });
    this.kind = ctx.world().kind;
    this.scroll = el('div', { class: 'qf-map-palette__scroll' });
    this.element = el('div', { class: 'qf-map-palette' },
      this.brush, el('div', { class: 'qf-map-search' }, mapIcon('search', 14), this.search), this.scroll);
    this.offs.push(
      ctx.bus.on('selection', ({ what }) => {
        if (what === 'tile') this.onTilePicked();
        else if (what === 'layer') this.renderBrush();
        else if (what === 'room' && ctx.world().kind !== this.kind) this.requestRender();
      }),
      ctx.bus.on('project', ({ what }) => {
        if (what === 'tiles' || what === 'terrains' || what === 'palettes' || what === 'all') this.requestRender();
      }),
      ctx.bus.on('assets', ({ kind, id }) => this.onAssets(kind, id)),
      ctx.bus.on('undo', () => {
        if (paletteStamp(ctx.project) !== this.stamp) this.requestRender();
      }),
      state.bus.on('tool', () => this.onBrush()),
    );
    this.render();
  }

  /** Bring the panel up to date (it was hidden, or may be stale). */
  refresh(): void {
    if (this.dirty || this.kind !== this.ctx.world().kind || paletteStamp(this.ctx.project) !== this.stamp) this.render();
    else this.onBrush();
  }

  destroy(): void {
    for (const off of this.offs.splice(0)) off();
    this.element.remove();
  }

  // ------------------------------------------------------------------ rendering

  /** Render now if visible, else when the panel is next refreshed. */
  private requestRender(): void {
    if (this.element.offsetParent === null) this.dirty = true;
    else this.render();
  }

  private render(): void {
    this.dirty = false;
    this.stamp = paletteStamp(this.ctx.project);
    // Another world kind reorders the groups: start from the top instead of a stale offset.
    const kind = this.ctx.world().kind;
    const top = kind === this.kind ? this.scroll.scrollTop : 0;
    this.kind = kind;
    this.buttons.clear();
    this.terrainButtons.clear();
    const tiles = this.ctx.project.tiles.filter((t) => tileMatches(t, this.query));
    const pieces = new Set<number>();
    for (const tr of this.ctx.project.terrains) for (const id of terrainPieces(tr)) if (id !== tr.center) pieces.add(id);
    const sections: HTMLElement[] = [];
    const recent = this.recent.map((id) => this.ctx.assets.tileDef(id)).filter((t): t is TileDef => !!t && tileMatches(t, this.query));
    if (recent.length) sections.push(this.section('recent', 'Recent', el('div', { class: 'qf-map-tiles' }, recent.map((t) => this.tileButton(t))), false));
    const terrains = this.ctx.project.terrains.filter((tr) => !this.query.trim() || tr.name.toLowerCase().includes(this.query.trim().toLowerCase()));
    if (terrains.length) sections.push(this.section('terrains', 'Terrain brushes', el('div', { class: 'qf-map-terrains' }, terrains.map((tr) => this.terrainButton(tr)))));
    for (const g of groupTiles(tiles, pieces, KIND_GROUP[this.kind])) {
      const body = g.subs.map((s) => [
        el('div', { class: 'qf-map-sub' }, cap(s.tag)),
        el('div', { class: 'qf-map-tiles' }, s.tiles.map((t) => this.tileButton(t))),
      ]);
      sections.push(this.section(`tag:${g.tag}`, cap(g.tag), body, true, g.count));
    }
    if (sections.length === 0) sections.push(el('div', { class: 'qf-empty' }, `No tiles match “${this.query}”.`));
    this.scroll.replaceChildren(...sections);
    this.scroll.scrollTop = top;
    this.onBrush();
  }

  private section(key: string, title: string, body: Node | Node[][], collapsible = true, count?: number): HTMLElement {
    const summary = el('summary', { class: 'qf-map-group__title' }, mapIcon('chevron', 12), el('span', { class: 'qf-grow' }, title),
      count !== undefined ? el('span', { class: 'qf-map-group__count' }, String(count)) : null);
    const details = el('details', { class: 'qf-map-group', dataset: { group: key } }, summary, el('div', { class: 'qf-map-group__body' }, body));
    details.open = !collapsible || this.query.trim() !== '' || !this.collapsed.has(key);
    if (collapsible) {
      details.addEventListener('toggle', () => {
        if (this.query.trim()) return;
        if (details.open) this.collapsed.delete(key);
        else this.collapsed.add(key);
        setSetting(COLLAPSED_KEY, [...this.collapsed]);
      });
    } else {
      summary.addEventListener('click', (e) => e.preventDefault());
      summary.classList.add('qf-map-group__title--fixed');
    }
    return details;
  }

  private tileButton(t: TileDef): HTMLButtonElement {
    const c = pixelCanvas(16, 16, 2);
    this.paintTile(c, t.id);
    const b = el('button', {
      class: 'qf-map-tile', type: 'button', title: tileTooltip(t), 'aria-label': t.name, dataset: { tile: String(t.id) },
      on: { click: () => this.pickTile(t.id) },
    }, c);
    let list = this.buttons.get(t.id);
    if (!list) this.buttons.set(t.id, (list = []));
    list.push(b);
    return b;
  }

  private terrainButton(tr: Terrain): HTMLButtonElement {
    const c = pixelCanvas(16, 16, 2);
    this.paintTile(c, tr.center);
    const b = el('button', {
      class: 'qf-map-terrain', type: 'button', dataset: { terrain: tr.id },
      title: `${tr.name} — paints with automatic borders on the ${layerLabel(tr.layer)} layer (T)`,
      on: { click: () => this.pickTerrain(tr) },
    }, c, el('span', { class: 'qf-map-terrain__name' }, tr.name));
    this.terrainButtons.set(tr.id, b);
    return b;
  }

  private paintTile(c: HTMLCanvasElement, id: number): void {
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 16, 16);
    this.ctx.assets.drawTileTo(g, id, 0, 0, 1);
  }

  private renderBrush(): void {
    const { ctx } = this;
    const terrain = this.state.tool === 'terrain' && ctx.terrainId ? ctx.project.terrains.find((t) => t.id === ctx.terrainId) : undefined;
    const id = terrain ? terrain.center : ctx.tile;
    const def = ctx.assets.tileDef(id);
    const c = pixelCanvas(16, 16, 3, 'qf-map-brush__swatch');
    this.paintTile(c, id);
    const title = terrain ? `${terrain.name} terrain` : def?.name ?? (id === 0 ? 'Empty' : `Tile ${id}`);
    const sub = terrain
      ? `Terrain brush · ${layerLabel(terrain.layer)} layer`
      : def ? `${def.collision} · id ${def.id} · painting on ${layerLabel(ctx.layer)}` : '';
    this.brush.replaceChildren(c, el('div', { class: 'qf-map-brush__text' },
      el('div', { class: 'qf-map-brush__label' }, 'Brush'),
      el('div', { class: 'qf-map-brush__name' }, title),
      el('div', { class: 'qf-map-brush__sub' }, sub)));
  }

  // ------------------------------------------------------------------ events

  /** Highlight the brush and show its preview. */
  private onBrush(): void {
    this.highlight();
    this.renderBrush();
  }

  /** Mark the brush the tools paint with: the terrain while the terrain tool is on, else the tile. */
  private highlight(): void {
    const { ctx } = this;
    const terrainTool = this.state.tool === 'terrain';
    for (const [id, list] of this.buttons) for (const b of list) b.classList.toggle('qf-map-tile--on', !terrainTool && id === ctx.tile);
    for (const [id, b] of this.terrainButtons) b.classList.toggle('qf-map-terrain--on', terrainTool && id === ctx.terrainId);
  }

  /** A tile became the brush (palette click, eyedropper...): it joins the recent row. */
  private onTilePicked(): void {
    if (this.pushRecent(this.ctx.tile) && !this.dirty) this.renderRecentOnly();
    this.onBrush();
  }

  private onAssets(kind: string, id: string | number | undefined): void {
    if (kind === 'tile' && id !== undefined && !this.dirty) {
      for (const b of this.buttons.get(Number(id)) ?? []) this.paintTile(b.querySelector('canvas')!, Number(id));
      this.renderBrush();
    } else if (kind !== 'sprite') {
      this.requestRender();
    }
  }

  private pickTile(id: number): void {
    this.ctx.selectTile(id);
    if (!BRUSH_TOOLS.includes(this.state.tool)) this.state.setTool('pencil');
  }

  private pickTerrain(tr: Terrain): void {
    this.ctx.selectTerrain(tr.id);
    this.ctx.selectLayer(tr.layer);
    this.state.setTool('terrain');
    this.onBrush();
  }

  /** Move a tile to the front of the recent list; true if the list changed. */
  private pushRecent(id: number): boolean {
    if (id === 0 || this.recent[0] === id) return false;
    const i = this.recent.indexOf(id);
    if (i >= 0) this.recent.splice(i, 1);
    this.recent.unshift(id);
    this.recent.length = Math.min(this.recent.length, RECENT_MAX);
    setSetting(RECENT_KEY, this.recent);
    return true;
  }

  private renderRecentOnly(): void {
    const section = this.scroll.querySelector('[data-group="recent"]');
    if (!section) {
      this.render();
      return;
    }
    const recent = this.recent.map((id) => this.ctx.assets.tileDef(id)).filter((t): t is TileDef => !!t && tileMatches(t, this.query));
    for (const [id, list] of this.buttons) this.buttons.set(id, list.filter((b) => !section.contains(b)));
    section.querySelector('.qf-map-tiles')?.replaceChildren(...recent.map((t) => this.tileButton(t)));
    this.highlight();
  }
}
