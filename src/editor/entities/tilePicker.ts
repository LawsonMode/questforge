// Tile chooser for trigger "Change tile" actions: a swatch with the tile name,
// "Use brush" (the map's current tile brush) and a searchable modal grid of
// every project tile.
import type { EditorContext } from '../context';
import type { TileDef } from '../../core/types';
import { button, el, modal, pixelCanvas, textInput } from '../ui/dom';
import { tileLabel } from './labels';
import { focusKey, inline } from './widgets';

const SWATCH_SCALE = 2;
const TILE_PX = 16;

function swatch(ctx: EditorContext, id: number, scale: number): HTMLCanvasElement {
  const c = pixelCanvas(TILE_PX * scale, TILE_PX * scale, 1, 'qf-ent-tile qf-checker');
  const g = c.getContext('2d');
  if (g) ctx.assets.drawTileTo(g, id, 0, 0, scale);
  return c;
}

function matches(t: TileDef, q: string): boolean {
  return !q || String(t.id) === q || [t.name, t.key, ...t.tags].some((s) => s.toLowerCase().includes(q));
}

/** Modal grid of all tiles (plus "empty"); resolves the chosen id or null when dismissed. */
export function chooseTile(ctx: EditorContext, current: number): Promise<number | null> {
  return new Promise((resolve) => {
    let result: number | null = null;
    const grid = el('div', { class: 'qf-ent-tilegrid' });
    const cell = (id: number, title: string): HTMLButtonElement => el('button', {
      class: `qf-ent-tilegrid__cell${id === current ? ' qf-ent-tilegrid__cell--active' : ''}`,
      type: 'button',
      title,
      dataset: { tile: String(id) },
      on: { click: () => { result = id; handle.close(); } },
    }, swatch(ctx, id, SWATCH_SCALE));
    const fill = (q: string): void => {
      grid.replaceChildren(cell(0, tileLabel(ctx.project, 0)),
        ...ctx.project.tiles.filter((t) => matches(t, q)).map((t) => cell(t.id, `${t.name} (#${t.id})${t.tags.length ? ` · ${t.tags.join(', ')}` : ''}`)));
    };
    const search = textInput('', (v) => fill(v.trim().toLowerCase()), { placeholder: 'Search tiles by name, key or tag…', live: true });
    fill('');
    const handle = modal({
      title: 'Choose a tile',
      wide: true,
      body: el('div', { class: 'qf-ent-tilepick' }, search, grid),
      buttons: [{ label: 'Cancel' }],
      onClose: () => resolve(result),
    });
  });
}

/** Swatch + name + "Choose…" + "Use brush" (focus keys `${key}:choose` / `${key}:brush`). */
export function tileField(ctx: EditorContext, value: number, onChange: (id: number) => void, key: string): HTMLDivElement {
  const choose = focusKey(button('Choose…', async () => {
    const id = await chooseTile(ctx, value);
    choose.focus();
    if (id !== null) onChange(id);
  }, { small: true, title: 'Pick from all tiles' }), `${key}:choose`);
  const brush = focusKey(button('Use brush', () => onChange(ctx.tile), {
    small: true, disabled: ctx.tile === value, title: `Use the map's current tile brush: ${tileLabel(ctx.project, ctx.tile)}`,
  }), `${key}:brush`, `${key}:choose`);
  return el('div', { class: 'qf-ent-tilefield' },
    swatch(ctx, value, SWATCH_SCALE),
    el('div', { class: 'qf-ent-tilefield__main' },
      el('div', { class: 'qf-ent-tilefield__name' }, tileLabel(ctx.project, value)),
      inline(choose, brush)));
}
