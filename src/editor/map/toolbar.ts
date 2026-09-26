// Map toolbar: tool buttons, the active-layer selector with per-layer
// visibility eyes (plus entities), and the grid / collision / neighbour
// overlays. Everything reflects MapState & the editor selection.
import type { LayerName } from '../../core/types';
import type { EditorContext } from '../context';
import type { MapState, Visibility } from './mapState';
import type { MapIcon } from './icons';
import { el } from '../ui/dom';
import { mapIcon } from './icons';
import { showMapHelp } from './mapHelp';
import { TOOL_META } from './tools/tool';

const LAYER_CHIPS: readonly { id: LayerName; label: string; title: string }[] = [
  { id: 'bg', label: 'Ground', title: 'Ground layer (bg) — floors, water, walls' },
  { id: 'fg', label: 'Objects', title: 'Objects layer (fg) — bushes, rocks, furniture; its collision wins over the ground' },
  { id: 'over', label: 'Overhead', title: 'Overhead layer (over) — drawn above sprites, no collision (tree tops, arches)' },
];

type Toggle = 'grid' | 'collision' | 'neighbors';

const TOGGLES: readonly { id: Toggle; icon: MapIcon; title: string }[] = [
  { id: 'grid', icon: 'grid', title: 'Tile grid (G)' },
  { id: 'collision', icon: 'collision', title: 'Collision overlay (C)' },
  { id: 'neighbors', icon: 'neighbours', title: 'Neighbouring rooms’ edges' },
];

export class MapToolbar {
  readonly element: HTMLDivElement;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly layerButtons = new Map<LayerName, HTMLButtonElement>();
  /** Visibility toggle of each layer chip, with the layer's name. */
  private readonly eyes = new Map<keyof Visibility, { button: HTMLButtonElement; label: string }>();
  private readonly toggles = new Map<Toggle, HTMLButtonElement>();
  private readonly offs: (() => void)[] = [];

  constructor(private readonly ctx: EditorContext, private readonly state: MapState) {
    const tools = el('div', { class: 'qf-map-toolbar__group', role: 'toolbar', 'aria-label': 'Tools' },
      TOOL_META.map((m) => {
        const title = `${m.label} (${m.keys.join(' / ')})`;
        const b = el('button', {
          class: 'qf-map-tool', type: 'button', title, 'aria-label': title, dataset: { tool: m.id },
          on: { click: () => state.setTool(m.id) },
        }, mapIcon(m.icon));
        this.toolButtons.set(m.id, b);
        return b;
      }));
    const layers = el('div', { class: 'qf-map-toolbar__group qf-map-layers', role: 'group', 'aria-label': 'Layers' },
      LAYER_CHIPS.map((c) => this.layerChip(c.id, c.label, c.title)),
      this.layerChip('entities', 'Entities', 'Placed entities, markers and the start point'));
    const view = el('div', { class: 'qf-map-toolbar__group', role: 'group', 'aria-label': 'Overlays' },
      TOGGLES.map((t) => {
        const b = el('button', {
          class: 'qf-map-tool', type: 'button', title: t.title, 'aria-label': t.title, dataset: { toggle: t.id },
          on: { click: () => state.setPrefs({ [t.id]: !state.prefs[t.id] }) },
        }, mapIcon(t.icon));
        this.toggles.set(t.id, b);
        return b;
      }));
    this.element = el('div', { class: 'qf-map-toolbar' },
      el('div', { class: 'qf-map-toolbar__row' }, tools, el('span', { class: 'qf-grow' }), view),
      el('div', { class: 'qf-map-toolbar__row' }, el('span', { class: 'qf-map-toolbar__label' }, 'Layer'), layers, el('span', { class: 'qf-grow' }),
        el('button', { class: 'qf-map-tool qf-map-tool--text', type: 'button', title: 'Map keys & mouse reference', on: { click: () => showMapHelp() } }, mapIcon('keyboard'), 'Keys')));
    this.offs.push(
      state.bus.on('tool', () => this.refresh()),
      state.bus.on('prefs', () => this.refresh()),
      ctx.bus.on('selection', ({ what }) => {
        if (what === 'layer') this.refresh();
      }),
    );
    this.refresh();
  }

  refresh(): void {
    for (const [id, b] of this.toolButtons) {
      const on = id === this.state.tool;
      b.classList.toggle('qf-map-tool--active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const [id, b] of this.layerButtons) {
      const on = id === this.ctx.layer;
      b.classList.toggle('qf-map-layer--active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const [id, { button: b, label }] of this.eyes) {
      const shown = this.state.prefs.show[id];
      b.replaceChildren(mapIcon(shown ? 'eye' : 'eyeOff', 14));
      b.classList.toggle('qf-map-eye--off', !shown);
      // A toggle button: a fixed name naming its layer, pressed while the layer is hidden.
      b.setAttribute('aria-label', `Hide ${label} layer`);
      b.setAttribute('aria-pressed', String(!shown));
      b.title = shown ? `Hide the ${label} layer` : `The ${label} layer is hidden: click to show it`;
    }
    for (const [id, b] of this.toggles) {
      const on = this.state.prefs[id];
      b.classList.toggle('qf-map-tool--active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  destroy(): void {
    for (const off of this.offs.splice(0)) off();
    this.element.remove();
  }

  /** Layer chip: label selects the active layer (tile layers only), eye toggles visibility. */
  private layerChip(id: keyof Visibility, label: string, title: string): HTMLDivElement {
    const eye = el('button', {
      class: 'qf-map-eye', type: 'button', dataset: { eye: id },
      on: { click: () => this.state.setPrefs({ show: { [id]: !this.state.prefs.show[id] } }) },
    });
    this.eyes.set(id, { button: eye, label });
    const name = el('button', { class: 'qf-map-layer__name', type: 'button', title, dataset: { layer: id } }, label);
    if (id === 'entities') {
      name.addEventListener('click', () => this.state.setTool('entity'));
      name.title = `${title} — click for the entity tool`;
    } else {
      const layer = id;
      name.addEventListener('click', () => this.ctx.selectLayer(layer));
      this.layerButtons.set(layer, name);
    }
    return el('div', { class: 'qf-map-layer', role: 'group', 'aria-label': `${label} layer` }, eye, name);
  }
}
