// "Under the hood" strip under the pixel canvas: the frame as the hex digits
// it is stored as, and the hovered pixel's palette index and colour in bits.
// Collapsed by default (setting `hoodOpen`); opening it is recorded as
// inspecting an image (learning evidence). Updates live while drawing.
import '../../learning/learning.css';
import type { Palette } from '../../core/types';
import { getSetting, setSetting } from '../../core/storage';
import { el } from '../ui/dom';
import { noteInspected } from '../../learning/editorObserver';
import { bits, colourBits, frameSize, hexRows } from '../../learning/pixelBits';
import type { Bitmap, Pt } from './ops';
import type { PixelAsset } from './model';

const SETTING = 'hoodOpen';

export class UnderTheHood {
  readonly element: HTMLDetailsElement;
  private readonly grid = el('pre', { class: 'qf-code qf-hood__grid', 'aria-label': 'Frame pixels as hex digits' });
  private readonly facts = el('div', { class: 'qf-hood__facts' });
  private last: { a: PixelAsset; work: Bitmap; hover: Pt | null; palette: Palette | undefined } | null = null;
  private key = '';

  constructor() {
    this.element = el('details', { class: 'qf-hood', open: getSetting<boolean>(SETTING, false) },
      el('summary', { title: 'See how this image is stored as numbers and bits' }, 'Under the hood: pixels as bits'),
      el('div', { class: 'qf-hood__body' }, this.grid, this.facts));
    this.element.addEventListener('toggle', () => {
      setSetting(SETTING, this.element.open);
      if (this.element.open && this.last) {
        this.key = '';
        this.update(this.last.a, this.last.work, this.last.hover, this.last.palette);
      }
    });
  }

  /** Show `work` (the frame being edited) and the hovered pixel. Cheap when closed. */
  update(a: PixelAsset, work: Bitmap, hover: Pt | null, palette: Palette | undefined): void {
    this.last = { a, work, hover, palette };
    if (!this.element.open) return;
    noteInspected(a.kind, a.id, String(a.id));
    const inside = hover && hover.x >= 0 && hover.y >= 0 && hover.x < work.w && hover.y < work.h ? hover : null;
    const rows = hexRows(work.px, work.w, work.h);
    const key = `${a.kind}:${a.id}:${rows.join('')}:${inside ? `${inside.x},${inside.y}` : ''}:${palette?.colors.join('') ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    this.grid.replaceChildren(...rows.flatMap((row, y) => {
      const line: (Node | string)[] = y > 0 ? ['\n'] : [];
      if (!inside || inside.y !== y) return [...line, row];
      return [...line, el('span', { class: 'qf-hood__row' },
        row.slice(0, inside.x), el('span', { class: 'qf-hood__hl' }, row[inside.x] ?? ''), row.slice(inside.x + 1))];
    }));
    const size = frameSize(work.w, work.h);
    const summary = el('p', null,
      el('b', null, `${work.w} × ${work.h} = ${size.pixels} pixels.`), ' Each pixel is one hex digit = ',
      el('b', null, '4 bits'), ', the number of a palette colour (0–15; 0 is see-through). This frame takes ',
      el('b', null, `${size.pixels} × 4 = ${size.bits} bits = ${size.bytes} bytes`), '.');
    if (!inside) {
      this.facts.replaceChildren(summary, el('p', null, 'Point at a pixel to see its number in binary and its colour as bits.'));
      return;
    }
    const index = work.px[inside.y * work.w + inside.x] ?? 0;
    const hex = palette?.colors[index] ?? '#000000';
    const c = colourBits(hex);
    const row = (label: string, ...cells: (Node | string)[]): HTMLTableRowElement =>
      el('tr', null, el('th', null, label), ...cells.map((x) => el('td', null, x)));
    const table = el('table', { class: 'qf-hood__table' },
      el('tbody', null,
        row('Pixel', `x ${inside.x}, y ${inside.y}`),
        row('Palette index', String(index), `hex ${index.toString(16)}`, el('span', { class: 'qf-hood__bits' }, bits(index, 4))),
        row('Colour', el('span', null, el('span', { class: 'qf-hood__swatch', style: { background: hex } }), index === 0 ? `${hex} (see-through)` : hex)),
        ...(c ? [
          row('Red (5 bits)', String(c.r), el('span', { class: 'qf-hood__bits' }, bits(c.r, 5))),
          row('Green (5 bits)', String(c.g), el('span', { class: 'qf-hood__bits' }, bits(c.g, 5))),
          row('Blue (5 bits)', String(c.b), el('span', { class: 'qf-hood__bits' }, bits(c.b, 5))),
          row('As 15 bits', `0x${c.bgr555.toString(16).padStart(4, '0')}`, el('span', { class: 'qf-hood__bits' }, bits(c.bgr555, 15))),
        ] : [])));
    this.facts.replaceChildren(summary, table,
      el('p', null, 'The 15 bits are blue, green, red (5 each), the way the SNES packed a colour.'));
  }
}
