// Asset browser (left column of the Art tab): Tiles | Sprites | Palettes |
// Terrains sub-tabs, search + tag filter, thumbnails drawn with the AssetCache,
// and New / Duplicate / Delete (deleting refuses built-in and in-use assets).
import type { Palette, SpriteDef, Terrain, TileDef } from '../../core/types';
import type { EditorContext } from '../context';
import { PALETTE_SIZE, TILE } from '../../core/constants';
import { nextTileId, paletteById, spriteById, tileById } from '../../core/project';
import { T } from '../../content/ids';
import { blankFrame } from '../../gfx/pixels';
import { button, confirmDialog, el, modal, setSelectOptions, tabs, type TabsHandle } from '../ui/dom';
import { numberedId, uniqueId, type ArtActions, type ArtState, type AssetKind } from './model';
import { copyPalette } from './paletteEditor';
import { normalizeHexColor } from '../../core/validate';
import { THUMB, drawSpriteThumb, drawTileThumb, smallCanvas } from './raster';
import {
  isDefaultSprite, isDefaultTile, paletteDeleteBlocker, spriteDeleteBlocker, tileDeleteBlocker,
} from './usage';

export interface BrowserHost {
  readonly ctx: EditorContext;
  readonly state: ArtState;
  readonly actions: ArtActions;
  /** Show another sub-tab. */
  setKind(kind: AssetKind): void;
  /** Select an asset (switching sub-tab if needed). */
  select(kind: AssetKind, id: string | number): void;
}

const KIND_TABS: readonly { id: AssetKind; label: string }[] = [
  { id: 'tile', label: 'Tiles' }, { id: 'sprite', label: 'Sprites' }, { id: 'palette', label: 'Palettes' }, { id: 'terrain', label: 'Terrains' },
];

const NOUN: Readonly<Record<AssetKind, [string, string]>> = {
  tile: ['tile', 'tiles'], sprite: ['sprite', 'sprites'], palette: ['palette', 'palettes'], terrain: ['terrain', 'terrains'],
};

/** Starter colours for a brand-new palette: outline, greys, then red / green / blue / gold / skin ramps. */
const STARTER_COLOURS = [
  '#000000', '#181818', '#404040', '#707070', '#a8a8a8', '#e0e0e0', '#f8f8f8', '#a82828',
  '#e85858', '#288838', '#68c858', '#2850a8', '#6890e8', '#c88820', '#f8d048', '#f8c8a0',
];

type Asset = TileDef | SpriteDef | Palette | Terrain;

interface Thumb {
  kind: AssetKind;
  id: string | number;
  /** Palettes whose edits change this thumbnail. */
  palettes: () => string[];
  draw: () => void;
}

export class AssetBrowser {
  readonly element: HTMLDivElement;
  private readonly tabs: TabsHandle;
  private readonly search: HTMLInputElement;
  private readonly tagSel: HTMLSelectElement;
  private readonly list = el('div', { class: 'qf-art-list' });
  private readonly count = el('span', { class: 'qf-muted qf-small' });
  private readonly delBtn: HTMLButtonElement;
  private readonly dupBtn: HTMLButtonElement;
  private readonly queries: Record<AssetKind, string> = { tile: '', sprite: '', palette: '', terrain: '' };
  private readonly tagFilter: Record<AssetKind, string> = { tile: '', sprite: '', palette: '', terrain: '' };
  private thumbs: Thumb[] = [];

  constructor(private readonly host: BrowserHost) {
    this.tabs = tabs(KIND_TABS, host.state.kind, (id) => host.setKind(id as AssetKind));
    this.tabs.element.classList.add('qf-art-kinds');
    this.search = el('input', { class: 'qf-input', type: 'search', placeholder: 'Search…', title: 'Filter by id, key, name or tag' });
    this.search.addEventListener('input', () => {
      this.queries[this.host.state.kind] = this.search.value;
      this.render();
    });
    this.tagSel = el('select', { class: 'qf-select qf-art-tagsel', title: 'Filter by tag' });
    this.tagSel.addEventListener('change', () => {
      this.tagFilter[this.host.state.kind] = this.tagSel.value;
      this.render();
    });
    this.dupBtn = button('Duplicate', () => void this.duplicate(), { small: true, title: 'Copy the selected asset' });
    this.delBtn = button('Delete', () => void this.remove(), { small: true, kind: 'danger', title: 'Delete the selected asset (only if nothing uses it)' });
    this.element = el('div', { class: 'qf-art-browser' },
      this.tabs.element,
      el('div', { class: 'qf-art-browser__filters' }, this.search, this.tagSel),
      this.list,
      el('div', { class: 'qf-art-browser__foot' },
        button('+ New', () => this.create(), { small: true, kind: 'primary', title: 'Create a new asset' }),
        this.dupBtn, this.delBtn, el('span', { class: 'qf-grow' }), this.count));
  }

  /** Rebuild the list for the current sub-tab (filters, selection, thumbnails). */
  render(): void {
    const kind = this.host.state.kind;
    this.tabs.setActive(kind);
    if (document.activeElement !== this.search) this.search.value = this.queries[kind];
    this.renderTagOptions(kind);
    const p = this.host.ctx.project;
    this.thumbs = [];
    let items: HTMLElement[];
    let total: number;
    switch (kind) {
      case 'tile':
        total = p.tiles.length;
        items = p.tiles.filter((t) => this.passes('tile', t)).map((t) => this.tileCell(t));
        break;
      case 'sprite':
        total = p.sprites.length;
        items = p.sprites.filter((s) => this.passes('sprite', s)).map((s) => this.spriteRow(s));
        break;
      case 'palette':
        total = p.palettes.length;
        items = p.palettes.filter((x) => this.passes('palette', x)).map((x) => this.paletteRow(x));
        break;
      default:
        total = p.terrains.length;
        items = p.terrains.filter((x) => this.passes('terrain', x)).map((x) => this.terrainRow(x));
    }
    const scroll = this.list.scrollTop;
    this.list.className = `qf-art-list qf-art-list--${kind}`;
    this.list.replaceChildren(...(items.length ? items : [el('div', { class: 'qf-empty' }, total ? 'Nothing matches.' : `No ${NOUN[kind][1]} yet.`)]));
    this.list.scrollTop = scroll;
    for (const t of this.thumbs) t.draw();
    const [one, many] = NOUN[kind];
    this.count.textContent = items.length === total ? `${total} ${total === 1 ? one : many}` : `${items.length} / ${total}`;
    this.updateButtons();
  }

  /** Whether the current list shows an item with this id. */
  lists(id: string | number): boolean {
    return this.thumbs.some((t) => t.id === id);
  }

  /**
   * Clear the kind's search and tag filter when they would hide this asset, so
   * one selected from outside the list (new, duplicated, opened from the
   * palette view) is listed and highlighted. Call before render().
   */
  unhide(kind: AssetKind, id: string | number): void {
    const item = this.find(kind, id);
    if (!item || this.passes(kind, item)) return;
    this.queries[kind] = '';
    this.tagFilter[kind] = '';
    if (kind === this.host.state.kind) this.search.value = '';
  }

  /** Move the highlight to the current selection (same sub-tab, no rebuild). */
  markSelection(): void {
    const id = this.host.state.sel[this.host.state.kind];
    for (const item of this.list.querySelectorAll<HTMLElement>('[data-id]')) {
      item.classList.toggle('is-active', item.dataset.id === String(id));
    }
    this.updateButtons();
  }

  /** Scroll the selected item into view. */
  reveal(): void {
    this.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  /** Redraw thumbnails affected by an asset change. */
  visuals(kind: 'tile' | 'sprite' | 'palette' | 'all', id?: string | number): void {
    for (const t of this.thumbs) {
      const hit = kind === 'all' || id === undefined
        || (kind === 'palette' ? t.palettes().includes(String(id)) : t.kind === kind && t.id === id)
        || (kind === 'tile' && t.kind === 'terrain');
      if (hit) t.draw();
    }
  }

  // ------------------------------------------------------------------ items

  private isSelected(kind: AssetKind, id: string | number): boolean {
    return this.host.state.sel[kind] === id;
  }

  private tileCell(t: TileDef): HTMLElement {
    const c = smallCanvas(THUMB, THUMB, 'qf-checker');
    this.thumbs.push({ kind: 'tile', id: t.id, palettes: () => [tileById(this.host.ctx.project, t.id)?.palette ?? ''], draw: () => drawTileThumb(c, this.host.ctx.assets, t.id) });
    return el('button', {
      class: `qf-art-cell${this.isSelected('tile', t.id) ? ' is-active' : ''}`, type: 'button',
      title: `${t.id} ${t.key} — ${t.name}${t.tags.length ? `\n[${t.tags.join(', ')}]` : ''}`,
      dataset: { id: String(t.id) }, on: { click: () => this.host.select('tile', t.id) },
    }, c);
  }

  private spriteRow(s: SpriteDef): HTMLElement {
    const c = smallCanvas(THUMB, THUMB, 'qf-checker');
    this.thumbs.push({ kind: 'sprite', id: s.id, palettes: () => [spriteById(this.host.ctx.project, s.id)?.palette ?? ''], draw: () => drawSpriteThumb(c, this.host.ctx.assets, s.id) });
    return this.row('sprite', s.id, c, s.name, `${s.id} · ${s.w}×${s.h}`, isDefaultSprite(s.id) ? null : 'custom');
  }

  private paletteRow(pal: Palette): HTMLElement {
    const bar = el('span', { class: 'qf-art-palbar' });
    const draw = (): void => {
      const cur = paletteById(this.host.ctx.project, pal.id);
      bar.replaceChildren(...Array.from({ length: PALETTE_SIZE - 1 }, (_, i) =>
        el('span', { style: { background: normalizeHexColor(cur?.colors[i + 1]) } })));
    };
    this.thumbs.push({ kind: 'palette', id: pal.id, palettes: () => [pal.id], draw });
    return this.row('palette', pal.id, bar, pal.name, pal.id, null);
  }

  private terrainRow(tr: Terrain): HTMLElement {
    const c = smallCanvas(THUMB, THUMB, 'qf-checker');
    const tile = (): TileDef | undefined => tileById(this.host.ctx.project, tr.center);
    this.thumbs.push({ kind: 'terrain', id: tr.id, palettes: () => [tile()?.palette ?? ''], draw: () => drawTileThumb(c, this.host.ctx.assets, tr.center) });
    return this.row('terrain', tr.id, c, tr.name, `${tr.id} · ${tr.layer}`, null);
  }

  private row(kind: AssetKind, id: string, thumb: HTMLElement, name: string, sub: string, badge: string | null): HTMLElement {
    return el('button', {
      class: `qf-art-row${this.isSelected(kind, id) ? ' is-active' : ''}`, type: 'button', title: `${name} (${id})`,
      dataset: { id }, on: { click: () => this.host.select(kind, id) },
    },
    el('span', { class: 'qf-art-row__thumb' }, thumb),
    el('span', { class: 'qf-art-row__text' }, el('span', { class: 'qf-art-row__name' }, name), el('span', { class: 'qf-art-row__sub' }, sub)),
    badge ? el('span', { class: 'qf-badge' }, badge) : null);
  }

  private renderTagOptions(kind: AssetKind): void {
    const p = this.host.ctx.project;
    const source = kind === 'tile' ? p.tiles : kind === 'sprite' ? p.sprites : [];
    this.tagSel.hidden = source.length === 0;
    if (this.tagSel.hidden) return;
    const all = [...new Set(source.flatMap((x) => x.tags))].sort();
    if (this.tagFilter[kind] && !all.includes(this.tagFilter[kind])) this.tagFilter[kind] = '';
    setSelectOptions(this.tagSel, [{ value: '', label: 'All tags' }, ...all.map((t) => ({ value: t, label: t }))], this.tagFilter[kind]);
  }

  private updateButtons(): void {
    const { kind, sel } = this.host.state;
    const id = sel[kind];
    const exists = id !== null && this.current() !== undefined;
    this.dupBtn.disabled = !exists;
    this.delBtn.disabled = !exists || (kind === 'tile' && isDefaultTile(id as number)) || (kind === 'sprite' && isDefaultSprite(id as string));
    this.delBtn.title = this.delBtn.disabled && exists ? 'Built-in assets can be edited but not deleted' : 'Delete the selected asset (only if nothing uses it)';
  }

  private current(): Asset | undefined {
    const { kind, sel } = this.host.state;
    const id = sel[kind];
    return id === null ? undefined : this.find(kind, id);
  }

  private find(kind: AssetKind, id: string | number): Asset | undefined {
    const p = this.host.ctx.project;
    switch (kind) {
      case 'tile': return typeof id === 'number' ? tileById(p, id) : undefined;
      case 'sprite': return spriteById(p, String(id));
      case 'palette': return paletteById(p, String(id));
      default: return p.terrains.find((t) => t.id === id);
    }
  }

  /** Whether the kind's search text and tag filter let this asset through. */
  private passes(kind: AssetKind, item: Asset): boolean {
    const q = this.queries[kind].trim().toLowerCase();
    const tag = this.tagFilter[kind];
    const tags = 'tags' in item ? item.tags : [];
    if (tag && !tags.includes(tag)) return false;
    return !q || [item.id, 'key' in item ? item.key : '', item.name, ...tags].join(' ').toLowerCase().includes(q);
  }

  // ------------------------------------------------------------------ actions

  private create(): void {
    const { ctx, actions, state } = this.host;
    const p = ctx.project;
    switch (state.kind) {
      case 'tile': {
        const id = nextTileId(p);
        const base = state.sel.tile === null ? undefined : tileById(p, state.sel.tile);
        const tile: TileDef = {
          id, key: uniqueId(`TILE_${id}`, new Set(p.tiles.map((t) => t.key))), name: `Tile ${id}`,
          palette: base?.palette ?? p.palettes[0]?.id ?? '', frames: [blankFrame(TILE, TILE)], collision: 'floor', tags: ['custom'],
        };
        actions.add('tile', tile, `New tile ${id}`);
        this.host.select('tile', id);
        break;
      }
      case 'sprite': {
        const { id, n } = numberedId('custom.sprite', new Set(p.sprites.map((s) => s.id)));
        const base = state.sel.sprite === null ? undefined : spriteById(p, state.sel.sprite);
        const sprite: SpriteDef = {
          id, name: `Sprite ${n}`, palette: base?.palette ?? p.palettes[0]?.id ?? '', w: 16, h: 16, ox: 8, oy: 8,
          frames: [blankFrame(16, 16)], anims: { idle: { frames: [0], fps: 8, loop: true } }, tags: ['custom'],
        };
        actions.add('sprite', sprite, `New sprite ${id}`);
        this.host.select('sprite', id);
        break;
      }
      case 'palette': {
        const { id, n } = numberedId('pal.custom', new Set(p.palettes.map((x) => x.id)));
        actions.add('palette', { id, name: `Palette ${n}`, colors: [...STARTER_COLOURS] }, `New palette ${id}`);
        this.host.select('palette', id);
        break;
      }
      default: {
        const { id, n } = numberedId('terrain', new Set(p.terrains.map((x) => x.id)));
        const fill = state.sel.tile ?? T.GRASS ?? p.tiles[0]?.id ?? 0;
        const tr: Terrain = {
          id, name: `Terrain ${n}`, layer: 'bg', center: fill, n: fill, s: fill, e: fill, w: fill,
          ne: fill, nw: fill, se: fill, sw: fill, ine: fill, inw: fill, ise: fill, isw: fill,
        };
        actions.add('terrain', tr, `New terrain ${id}`);
        this.host.select('terrain', id);
      }
    }
  }

  private duplicate(): void {
    const { ctx, actions, state } = this.host;
    const p = ctx.project;
    const cur = this.current();
    if (!cur) return;
    switch (state.kind) {
      case 'tile': {
        const src = cur as TileDef;
        const id = nextTileId(p);
        const copy: TileDef = { ...structuredClone(src), id, key: uniqueId(`${src.key}_COPY`, new Set(p.tiles.map((t) => t.key))), name: `${src.name} copy` };
        actions.add('tile', copy, `Duplicate tile ${src.key}`, p.tiles.indexOf(src) + 1);
        this.host.select('tile', id);
        break;
      }
      case 'sprite': {
        const src = cur as SpriteDef;
        const id = uniqueId(`${src.id}.copy`, new Set(p.sprites.map((s) => s.id)));
        actions.add('sprite', { ...structuredClone(src), id, name: `${src.name} copy` }, `Duplicate sprite ${src.id}`, p.sprites.indexOf(src) + 1);
        this.host.select('sprite', id);
        break;
      }
      case 'palette': {
        const src = cur as Palette;
        const copy = copyPalette(ctx, src);
        actions.add('palette', copy, `Duplicate palette ${src.id}`, p.palettes.indexOf(src) + 1);
        this.host.select('palette', copy.id);
        break;
      }
      default: {
        const src = cur as Terrain;
        const id = uniqueId(`${src.id}.copy`, new Set(p.terrains.map((t) => t.id)));
        actions.add('terrain', { ...structuredClone(src), id, name: `${src.name} copy` }, `Duplicate terrain ${src.id}`, p.terrains.indexOf(src) + 1);
        this.host.select('terrain', id);
      }
    }
  }

  private async remove(): Promise<void> {
    const { ctx, actions, state } = this.host;
    const p = ctx.project;
    const kind = state.kind;
    const cur = this.current();
    if (!cur) return;
    const blocker = kind === 'tile' ? tileDeleteBlocker(p, cur.id as number)
      : kind === 'sprite' ? spriteDeleteBlocker(p, cur.id as string)
        : kind === 'palette' ? paletteDeleteBlocker(p, cur.id as string) : null;
    if (blocker) {
      modal({ title: `Can't delete ${cur.name}`, body: el('pre', { class: 'qf-art-blocker' }, blocker) });
      return;
    }
    if (!(await confirmDialog(`Delete the ${NOUN[kind][0]} “${cur.name}”? (Undo brings it back.)`, { title: 'Delete', ok: 'Delete', danger: true }))) return;
    const arr: readonly Asset[] = kind === 'tile' ? p.tiles : kind === 'sprite' ? p.sprites : kind === 'palette' ? p.palettes : p.terrains;
    const at = arr.findIndex((x) => x.id === cur.id);
    const label = `Delete ${NOUN[kind][0]} ${cur.name}`;
    if (kind === 'tile') actions.remove('tile', cur.id as number, label);
    else if (kind === 'sprite') actions.remove('sprite', cur.id as string, label);
    else if (kind === 'palette') actions.remove('palette', cur.id as string, label);
    else {
      actions.remove('terrain', cur.id as string, label);
      if (ctx.terrainId === cur.id) ctx.selectTerrain(null);
    }
    // The next listed asset (else the previous one); an unfiltered neighbour only when the filter hides them all.
    const listed = (x: Asset): boolean => this.passes(kind, x);
    const next = arr.slice(at).find(listed) ?? arr.slice(0, at).reverse().find(listed) ?? arr[Math.min(at, arr.length - 1)];
    if (next) this.host.select(kind, next.id);
    else {
      state.sel[kind] = null;
      this.host.setKind(kind);
    }
  }
}
