// Small art-tab widgets: property sections, validated number fields, tag chip
// editor and the tile picker (thumbnail dropdown with search and a "use map
// brush" shortcut).
import type { TileDef } from '../../core/types';
import type { EditorContext } from '../context';
import { clamp } from '../../core/math';
import { append, checkbox, el, select, textInput, type Child } from '../ui/dom';
import { THUMB, drawTileThumb, smallCanvas } from './raster';

/** Titled block inside the properties column (extra = controls on the title row). */
export function section(title: string | { title: string; extra: Child }, ...children: Child[]): HTMLDivElement {
  const head = typeof title === 'string' ? title : title.title;
  const extra = typeof title === 'string' ? null : title.extra;
  return el('div', { class: 'qf-art-sec' },
    el('div', { class: 'qf-art-sec__title' }, el('span', { class: 'qf-grow' }, head), extra), ...children);
}

/** Labelled properties row (controls laid out inline). */
export function propRow(label: string, ...controls: Child[]): HTMLDivElement {
  return el('div', { class: 'qf-field' },
    el('label', { class: 'qf-field__label' }, label),
    el('div', { class: 'qf-field__control qf-row qf-art-nowrap' }, controls));
}

/** Checkbox with a label whose input carries a focus key (see rebuild()). */
export function checkField(checked: boolean, onChange: (v: boolean) => void, label: string, key: string): HTMLLabelElement {
  const box = checkbox(checked, onChange, label);
  box.querySelector('input')!.dataset.fk = key;
  return box;
}

/** Tag a control with a focus key so rebuild() can give it focus back. */
export function fk<T extends HTMLElement>(node: T, key: string): T {
  node.dataset.fk = key;
  return node;
}

/** Name field: commits the trimmed text; clearing it puts the current name back. */
export function nameField(current: () => string, commit: (name: string) => void, title = 'Name shown in the editor'): HTMLInputElement {
  const input = textInput(current(), (v) => {
    const name = v.trim();
    if (name) commit(name);
    input.value = name || current();
  }, { title });
  return fk(input, 'name');
}

export interface NumFieldOpts {
  min: number;
  max: number;
  step?: number;
  /** Round to whole numbers (pixel sizes and positions). */
  integer?: boolean;
  title?: string;
}

/** The value a number field's text stands for: null when empty or unparsable, else rounded (integer fields) and clamped. */
export function parseNumberEntry(text: string, opts: Pick<NumFieldOpts, 'min' | 'max' | 'integer'>): number | null {
  const s = text.trim();
  const v = s === '' ? NaN : Number(s);
  if (!Number.isFinite(v)) return null;
  return clamp(opts.integer ? Math.round(v) : v, opts.min, opts.max);
}

/**
 * Number input that commits only real values: an empty or unparsable entry puts
 * the current value back without an edit (see parseNumberEntry). Unchanged
 * values commit nothing.
 */
export function numField(value: number, commit: (v: number) => void, opts: NumFieldOpts): HTMLInputElement {
  let current = value;
  const input = el('input', {
    class: 'qf-input qf-input--num', type: 'number', value: String(value), title: opts.title,
    min: String(opts.min), max: String(opts.max), step: String(opts.step ?? (opts.integer ? 1 : 'any')),
  });
  input.addEventListener('change', () => {
    const v = parseNumberEntry(input.value, opts);
    input.value = String(v ?? current);
    if (v === null || v === current) return;
    current = v;
    commit(v);
  });
  return input;
}

/**
 * Replace a container's children with what `build` returns, keeping its scroll
 * position and giving focus (and the text caret) back to the control with the
 * same focus key. The focus is read before `build` runs, because building may
 * re-parent a long-lived control (the palette editor), which drops its focus.
 */
export function rebuild(container: HTMLElement, build: () => Child): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && container.contains(active) ? active.dataset.fk : undefined;
  const caret = active instanceof HTMLInputElement && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = container.scrollTop;
  const children = build();
  container.replaceChildren();
  append(container, [children]);
  container.scrollTop = scroll;
  if (!key) return;
  const next = container.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`);
  next?.focus({ preventScroll: true });
  if (caret && next instanceof HTMLInputElement && next.type === 'text') next.setSelectionRange(caret[0], caret[1]);
}

/** Dropdown of every palette ("name (id)"). */
export function paletteSelect(ctx: EditorContext, value: string, onChange: (id: string) => void): HTMLSelectElement {
  const options = ctx.project.palettes.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` }));
  if (!options.some((o) => o.value === value)) options.unshift({ value, label: `${value} (missing)` });
  return select(options, value, onChange, { title: 'Palette used to draw this asset' });
}

/** Tag editor: removable chips plus an input (Enter / comma adds, Backspace on empty removes the last). */
export function chipEditor(values: readonly string[], onChange: (v: string[]) => void, suggestions: readonly string[]): HTMLDivElement {
  let tags = [...values];
  const listId = `qf-art-tags-${Math.random().toString(36).slice(2, 8)}`;
  const input = el('input', { class: 'qf-art-chips__input', type: 'text', placeholder: 'add tag…', dataset: { fk: 'tags' } });
  input.setAttribute('list', listId);
  const chips = el('span', { class: 'qf-art-chips__list' });
  const root = el('div', { class: 'qf-art-chips' }, chips, input,
    el('datalist', { id: listId }, suggestions.map((s) => el('option', { value: s }))));
  const commit = (next: string[]): void => {
    tags = next;
    render();
    onChange([...tags]);
  };
  const addFromInput = (): void => {
    const add = input.value.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && !tags.includes(s));
    input.value = '';
    if (add.length) commit([...tags, ...add]);
  };
  function render(): void {
    chips.replaceChildren(...tags.map((t) => el('span', { class: 'qf-art-chip' }, t,
      el('button', { class: 'qf-art-chip__x', type: 'button', title: `Remove "${t}"`, on: { click: () => commit(tags.filter((x) => x !== t)) } }, '×'))));
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addFromInput();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      commit(tags.slice(0, -1));
    }
  });
  input.addEventListener('change', addFromInput);
  render();
  return root;
}

export interface TilePickerOpts {
  value: number;
  onChange: (id: number) => void;
  /** Offer "none" (id 0). */
  allowNone?: boolean;
  title?: string;
}

/** Button showing a tile; opens a searchable thumbnail grid. `setValue` updates it without firing onChange. */
export function tilePicker(ctx: EditorContext, opts: TilePickerOpts): HTMLButtonElement & { setValue(id: number): void } {
  let value = opts.value;
  const thumb = smallCanvas(THUMB, THUMB, 'qf-checker qf-art-tpick__thumb');
  const label = el('span', { class: 'qf-art-tpick__label' });
  const btn = el('button', { class: 'qf-art-tpick', type: 'button', title: opts.title ?? 'Choose a tile' }, thumb, label) as
    HTMLButtonElement & { setValue(id: number): void };
  const render = (): void => {
    drawTileThumb(thumb, ctx.assets, value);
    const def = ctx.assets.tileDef(value);
    label.textContent = value === 0 ? 'none' : def ? `${def.id} ${def.key}` : `${value} (missing)`;
  };
  btn.setValue = (id: number) => {
    value = id;
    render();
  };
  btn.addEventListener('click', () => openTileMenu(ctx, btn, value, !!opts.allowNone, (id) => {
    value = id;
    render();
    opts.onChange(id);
  }));
  render();
  return btn;
}

/** Closes the open tile-picker popover (null when none is open). */
let closeOpenMenu: (() => void) | null = null;

/** Close the tile-picker popover if one is open (the art tab calls it when hidden or destroyed). */
export function closeTileMenu(): void {
  closeOpenMenu?.();
}

/** Popover grid of every tile (search by id/key/name/tag); closes on pick, Escape or outside click. */
function openTileMenu(ctx: EditorContext, anchor: HTMLElement, current: number, allowNone: boolean, pick: (id: number) => void): void {
  closeTileMenu();
  const search = el('input', { class: 'qf-input', type: 'search', placeholder: 'Search tiles…' });
  const grid = el('div', { class: 'qf-art-pop__grid' });
  const brush = ctx.assets.tileDef(ctx.tile);
  const pop = el('div', { class: 'qf-art-pop' },
    el('div', { class: 'qf-row' }, search),
    el('div', { class: 'qf-row qf-art-pop__quick' },
      brush ? el('button', { class: 'qf-btn qf-btn--small', type: 'button', on: { click: () => choose(brush.id) } }, `Use map brush (${brush.id} ${brush.key})`) : null,
      allowNone ? el('button', { class: 'qf-btn qf-btn--small', type: 'button', on: { click: () => choose(0) } }, 'None') : null),
    grid);
  const close = (): void => {
    if (closeOpenMenu === close) closeOpenMenu = null;
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  function choose(id: number): void {
    close();
    pick(id);
  }
  const outside = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const cell = (t: TileDef): HTMLButtonElement => {
    const c = smallCanvas(THUMB, THUMB, 'qf-checker');
    drawTileThumb(c, ctx.assets, t.id);
    return el('button', {
      class: `qf-art-pop__cell${t.id === current ? ' is-active' : ''}`, type: 'button',
      title: `${t.id} ${t.key} — ${t.name}`, on: { click: () => choose(t.id) },
    }, c);
  };
  const render = (): void => {
    const text = search.value.trim();
    const q = text.toLowerCase();
    const hits = ctx.project.tiles.filter((t) => !q || `${t.id} ${t.key} ${t.name} ${t.tags.join(' ')}`.toLowerCase().includes(q));
    grid.replaceChildren(...(hits.length ? hits.map(cell) : [el('div', { class: 'qf-empty qf-art-pop__empty' }, `No tiles match “${text}”.`)]));
  };
  search.addEventListener('input', render);
  render();
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, r.left))}px`;
  pop.style.top = `${r.bottom + ph + 8 > window.innerHeight ? Math.max(8, r.top - ph - 4) : r.bottom + 4}px`;
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey, true);
  closeOpenMenu = close;
  search.focus();
}
