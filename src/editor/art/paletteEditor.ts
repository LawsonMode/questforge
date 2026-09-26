// Palette editing: the 16-swatch colour editor (SNES 5-bit R/G/B sliders, hex
// and native colour input, all snapped to the BGR555 gamut), the palette
// section shown beside tiles & sprites (assign / duplicate / usage) and the
// Palettes sub-tab view (big editor + every asset drawn with the palette).
// Slider and colour-picker drags update every canvas live and record a single
// undo step when released.
import type { Palette } from '../../core/types';
import type { EditorContext } from '../context';
import { PALETTE_SIZE } from '../../core/constants';
import { clamp } from '../../core/math';
import { paletteById } from '../../core/project';
import { hexToRgb, rgbToHex, snapHex } from '../../gfx/palette';
import { normalizeHexColor } from '../../core/validate';
import { button, el, setChildren, textInput } from '../ui/dom';
import { uniqueId, type ArtActions, type PixelAsset } from './model';
import { THUMB, drawSpriteThumb, drawTileThumb, smallCanvas } from './raster';
import { paletteUsage } from './usage';
import { fk, nameField, paletteSelect, section } from './widgets';

/** 8-bit channel -> SNES 5-bit level (exact for both x8 and snapHex-expanded colours). */
export function to5(v: number): number {
  return clamp(Math.floor(v) >> 3, 0, 31);
}

/** SNES 5-bit level -> 8-bit channel (the same expansion snapHex uses). */
export function from5(c: number): number {
  const v = clamp(Math.round(c), 0, 31);
  return (v << 3) | (v >> 2);
}

const CHANNELS = ['R', 'G', 'B'] as const;

export interface PaletteEditorHost {
  readonly ctx: EditorContext;
  readonly actions: ArtActions;
}

/** Swatch grid + colour controls for one palette (show() switches palettes, keeping the selected index). */
export class PaletteEditor {
  readonly element: HTMLDivElement;
  private id: string | null = null;
  private index = 1;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly chans: { input: HTMLInputElement; value: HTMLSpanElement }[] = [];
  private readonly hex: HTMLInputElement;
  private readonly native: HTMLInputElement;
  private readonly heading = el('span', { class: 'qf-art-pe__heading' });
  /** Palette snapshot taken when a live (dragged) edit started. */
  private liveBefore: string | null = null;
  /** Colour the live edit last set. */
  private liveColour = '';

  constructor(private readonly host: PaletteEditorHost, large = false) {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      this.swatches.push(el('button', {
        class: 'qf-art-pe__sw', type: 'button', dataset: { index: String(i) },
        title: i === 0 ? 'Index 0 — always transparent in game (its colour is only the editor backdrop)' : `Index ${i}`,
        on: { click: () => this.select(i) },
      }));
    }
    const rows = CHANNELS.map((name, c) => {
      const input = el('input', { class: 'qf-art-pe__range', type: 'range', min: '0', max: '31', step: '1', title: `${name} (SNES 0-31)` });
      fk(input, `pe-${name}`);
      input.addEventListener('input', () => this.liveSet(this.fromSliders()));
      input.addEventListener('change', () => this.commitLive());
      const value = el('span', { class: 'qf-art-pe__val' });
      this.chans[c] = { input, value };
      return el('label', { class: 'qf-art-pe__chan' }, el('span', { class: 'qf-art-pe__cname' }, name), input, value);
    });
    this.hex = fk(textInput('', (v) => this.setHex(v), { title: 'Hex colour (snapped to SNES 5-bit steps)' }), 'pe-hex');
    this.hex.classList.add('qf-art-pe__hex');
    this.native = fk(el('input', { class: 'qf-color', type: 'color', title: 'Pick a colour (snapped to SNES 5-bit steps)' }), 'pe-native');
    this.native.addEventListener('input', () => this.liveSet(safeColour(this.native.value)));
    this.native.addEventListener('change', () => this.commitLive());
    this.element = el('div', { class: `qf-art-pe${large ? ' qf-art-pe--large' : ''}` },
      el('div', { class: 'qf-art-pe__grid' }, this.swatches),
      el('div', { class: 'qf-art-pe__edit' },
        el('div', { class: 'qf-row qf-art-pe__top' }, this.heading, el('span', { class: 'qf-grow' }), this.native, this.hex),
        rows));
  }

  get paletteId(): string | null {
    return this.id;
  }

  /** Edit another palette (null = none); re-reads the colours either way. */
  show(id: string | null): void {
    if (id !== this.id) {
      this.commitLive();
      this.id = id;
    }
    this.update();
  }

  /** Select the colour index being edited. */
  select(index: number): void {
    this.commitLive();
    this.index = clamp(index, 0, PALETTE_SIZE - 1);
    this.update();
  }

  /** Re-read the palette's colours into the controls (a focused hex field keeps what is being typed). */
  update(): void {
    const pal = this.palette();
    this.element.classList.toggle('is-empty', !pal);
    this.swatches.forEach((b, i) => {
      const colour = normalizeHexColor(pal?.colors[i]);
      b.style.setProperty('--sw', colour);
      b.classList.toggle('qf-art-pe__sw--clear', i === 0);
      b.classList.toggle('is-active', i === this.index);
    });
    const colour = normalizeHexColor(pal?.colors[this.index]);
    const rgb = hexToRgb(colour);
    this.chans.forEach(({ input, value }, c) => {
      input.value = String(to5(rgb[c]!));
      value.textContent = input.value;
      const lo = [...rgb] as number[];
      const hi = [...rgb] as number[];
      lo[c] = 0;
      hi[c] = 255;
      input.style.background = `linear-gradient(to right, ${rgbToHex(lo[0]!, lo[1]!, lo[2]!)}, ${rgbToHex(hi[0]!, hi[1]!, hi[2]!)})`;
    });
    if (document.activeElement !== this.hex) this.hex.value = colour;
    this.native.value = colour;
    this.heading.textContent = this.index === 0 ? 'Index 0 (transparent)' : `Index ${this.index}`;
  }

  private palette(): Palette | undefined {
    return this.id === null ? undefined : paletteById(this.host.ctx.project, this.id);
  }

  private fromSliders(): string {
    const [r, g, b] = this.chans.map(({ input }) => from5(Number(input.value)));
    return rgbToHex(r!, g!, b!);
  }

  /** Change the selected colour without an undo step yet (drag in progress). */
  private liveSet(picked: string): void {
    const colour = safeColour(picked);
    const pal = this.palette();
    if (!pal || pal.colors[this.index] === colour) return;
    this.liveBefore ??= this.host.actions.snapshot('palette', pal.id);
    pal.colors[this.index] = colour;
    this.liveColour = colour;
    this.host.actions.live('palette', pal.id);
    this.update();
  }

  /**
   * Undo / redo ran during a live edit. If it restored this palette, the live
   * colour is gone and the edit's step must start from the restored colours;
   * the old snapshot would bring the undone change back.
   */
  historyMoved(): void {
    if (this.liveBefore === null) return;
    const pal = this.palette();
    if (pal?.colors[this.index] === this.liveColour) return;
    this.liveBefore = pal ? this.host.actions.snapshot('palette', pal.id) : null;
  }

  /** Record the finished drag as one undo step. */
  private commitLive(): void {
    const before = this.liveBefore;
    this.liveBefore = null;
    if (before === null || this.id === null) return;
    this.host.actions.commitSince('palette', this.id, before, colourLabel(this.index, this.palette()?.name ?? this.id), true);
  }

  private setHex(text: string): void {
    const pal = this.palette();
    const s = text.trim();
    if (!pal || !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) {
      this.update();
      return;
    }
    const colour = safeColour(s);
    const index = this.index;
    this.host.actions.edit('palette', pal.id, colourLabel(index, pal.name), (p) => {
      p.colors[index] = colour;
    }, true);
    this.update();
  }
}

/**
 * Every colour the editor stores or puts into CSS goes through the project's
 * palette sanitiser (lowercase #rrggbb, never a CSS value such as url(...)) and
 * is snapped to the SNES 5-bit gamut.
 */
export function safeColour(value: string): string {
  return snapHex(normalizeHexColor(value));
}

/** Undo label of a colour edit, e.g. "Edit colour 1 of Meadow". */
function colourLabel(index: number, paletteName: string): string {
  return `Edit colour ${index} of ${paletteName}`;
}

/** Copy of a palette under a fresh id ("<id>.copy", "<id>.copy2", ...). */
export function copyPalette(ctx: EditorContext, src: Palette): Palette {
  const taken = new Set(ctx.project.palettes.map((p) => p.id));
  return { id: uniqueId(`${src.id}.copy`, taken), name: `${src.name} copy`, colors: [...src.colors] };
}

function usageText(ctx: EditorContext, id: string): { text: string; detail: string; shared: boolean } {
  const u = paletteUsage(ctx.project, id);
  const n = u.tiles.length + u.sprites.length;
  const parts = [`${u.tiles.length} tile${u.tiles.length === 1 ? '' : 's'}`, `${u.sprites.length} sprite${u.sprites.length === 1 ? '' : 's'}`];
  const detail = [...u.tiles.map((t) => `tile ${t.key}`), ...u.sprites.map((s) => `sprite ${s.id}`), ...u.refs].slice(0, 40).join('\n');
  return { text: `Used by ${parts.join(' and ')}${u.refs.length ? ` + ${u.refs.length} swap role${u.refs.length === 1 ? '' : 's'}` : ''}`, detail, shared: n > 1 };
}

/**
 * The "Palette" section beside a tile / sprite: assign dropdown, usage,
 * duplicate-and-assign, and the colour editor (kept by the caller so the
 * selected colour survives rebuilds).
 */
export function paletteSection(host: PaletteEditorHost, editor: PaletteEditor, asset: PixelAsset): HTMLDivElement {
  const { ctx, actions } = host;
  const assign = (id: string): void => {
    const label = `Assign palette ${paletteById(ctx.project, id)?.name ?? id}`;
    if (asset.kind === 'tile') actions.edit('tile', asset.id as number, label, (t) => { t.palette = id; }, true);
    else actions.edit('sprite', asset.id as string, label, (s) => { s.palette = id; }, true);
  };
  const duplicate = (): void => {
    const src = paletteById(ctx.project, asset.palette);
    if (!src) return;
    const copy = copyPalette(ctx, src);
    actions.group(`Duplicate palette ${src.name}`, () => {
      actions.add('palette', copy, `Duplicate palette ${src.name}`);
      assign(copy.id);
    });
    ctx.toast(`This ${asset.kind} now uses its own palette “${copy.name}”`, 'success');
  };
  editor.show(asset.palette);
  const usage = usageText(ctx, asset.palette);
  return section('Palette',
    el('div', { class: 'qf-row qf-art-nowrap' }, fk(paletteSelect(ctx, asset.palette, assign), 'palette')),
    el('div', { class: `qf-art-usage${usage.shared ? ' is-shared' : ''}`, title: usage.detail },
      usage.text, usage.shared ? ' — colour edits change all of them.' : ''),
    el('div', { class: 'qf-row' },
      button('Duplicate & assign', duplicate, { small: true, title: 'Copy this palette and use the copy for this asset only' })),
    editor.element);
}

export interface PaletteViewHost extends PaletteEditorHost {
  /** Open an asset that uses the palette in its editor. */
  open(kind: 'tile' | 'sprite', id: number | string): void;
}

/** Palettes sub-tab centre: big colour editor plus every tile and sprite drawn with the palette. */
export class PaletteView {
  readonly element: HTMLDivElement;
  readonly editor: PaletteEditor;
  private readonly usage = el('div', { class: 'qf-art-pv__usage' });
  private readonly thumbs: { canvas: HTMLCanvasElement; draw: () => void }[] = [];

  constructor(private readonly host: PaletteViewHost) {
    this.editor = new PaletteEditor(host, true);
    this.element = el('div', { class: 'qf-art-pv' },
      el('div', { class: 'qf-art-pv__editor' }, this.editor.element),
      this.usage);
  }

  /** Show a palette (null = nothing selected). */
  render(id: string | null): void {
    this.editor.show(id);
    this.thumbs.length = 0;
    if (id === null || !paletteById(this.host.ctx.project, id)) {
      this.usage.replaceChildren(el('div', { class: 'qf-empty' }, 'Select a palette on the left.'));
      return;
    }
    const u = paletteUsage(this.host.ctx.project, id);
    const cell = (kind: 'tile' | 'sprite', aid: number | string, title: string): HTMLButtonElement => {
      const canvas = smallCanvas(THUMB, THUMB, 'qf-checker');
      const draw = kind === 'tile'
        ? () => drawTileThumb(canvas, this.host.ctx.assets, aid as number)
        : () => drawSpriteThumb(canvas, this.host.ctx.assets, aid as string);
      draw();
      this.thumbs.push({ canvas, draw });
      return el('button', { class: 'qf-art-cell', type: 'button', title: `${title} — click to edit`, on: { click: () => this.host.open(kind, aid) } }, canvas);
    };
    setChildren(this.usage,
      el('div', { class: 'qf-art-sec__title' }, `Tiles (${u.tiles.length})`),
      u.tiles.length ? el('div', { class: 'qf-art-grid' }, u.tiles.map((t) => cell('tile', t.id, `${t.id} ${t.key}`))) : el('div', { class: 'qf-muted qf-small' }, 'None'),
      el('div', { class: 'qf-art-sec__title' }, `Sprites (${u.sprites.length})`),
      u.sprites.length ? el('div', { class: 'qf-art-grid' }, u.sprites.map((s) => cell('sprite', s.id, `${s.name} (${s.id})`))) : el('div', { class: 'qf-muted qf-small' }, 'None'),
      u.refs.length ? el('div', { class: 'qf-art-sec__title' }, 'Palette-swap roles') : null,
      u.refs.length ? el('ul', { class: 'qf-art-refs' }, u.refs.map((r) => el('li', null, r))) : null);
  }

  /** Colours changed: redraw the swatches and thumbnails. */
  visuals(): void {
    this.editor.update();
    for (const t of this.thumbs) t.draw();
  }
}

/** Right column for a palette: name, id and usage summary. */
export function paletteProps(host: PaletteEditorHost, pal: Palette): HTMLDivElement[] {
  const usage = usageText(host.ctx, pal.id);
  const current = (): string => paletteById(host.ctx.project, pal.id)?.name ?? pal.name;
  const rename = (name: string): void => host.actions.edit('palette', pal.id, `Rename palette ${pal.id}`, (p) => { p.name = name; });
  return [
    section('Palette',
      el('div', { class: 'qf-field' }, el('label', { class: 'qf-field__label' }, 'Name'), nameField(current, rename)),
      el('div', { class: 'qf-field' }, el('label', { class: 'qf-field__label' }, 'Id'), el('code', { class: 'qf-art-code' }, pal.id)),
      el('div', { class: 'qf-art-usage', title: usage.detail }, usage.text)),
    section('Tips',
      el('p', { class: 'qf-muted qf-small' },
        'Index 0 is always transparent. Channels snap to SNES 5-bit steps (0-31). Every canvas that uses this palette updates while you drag.')),
  ];
}
