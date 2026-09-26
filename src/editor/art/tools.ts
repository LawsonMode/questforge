// Pixel-editor chrome: tool catalogue with hotkeys, the toolbar (tools, mirror
// modes, frame transforms), the view bar (onion/grid, zoom) and the 16-colour
// palette strip.
import type { Palette } from '../../core/types';
import { el } from '../ui/dom';
import { normalizeHexColor } from '../../core/validate';
import { icon, type IconName } from './icons';
import type { ArtState, PixelAsset, ToolId } from './model';

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** Hotkey (KeyboardEvent.code suffix, e.g. 'B' for KeyB). */
  key: string;
  icon: IconName;
  hint: string;
  spriteOnly?: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', icon: 'pencil', hint: 'Left = primary colour, right = secondary' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', hint: 'Paints index 0 (transparent)' },
  { id: 'line', label: 'Line', key: 'L', icon: 'line', hint: 'Shift snaps to 45°' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect', hint: 'Shift = filled' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse', hint: 'Shift = filled' },
  { id: 'fill', label: 'Fill', key: 'G', icon: 'fill', hint: 'Flood-fills the touching area of one colour' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: 'eyedropper', hint: 'Hold Alt with any tool' },
  { id: 'select', label: 'Select & move', key: 'M', icon: 'select', hint: 'Drag a marquee, drag inside to move, arrows nudge' },
  { id: 'origin', label: 'Origin', key: 'P', icon: 'origin', hint: 'Drag the sprite origin crosshair', spriteOnly: true },
];

export type ToggleFlag = 'mirrorX' | 'mirrorY' | 'onion' | 'grid';
export type FrameOp = 'flipX' | 'flipY' | 'rotate';

export interface ToolbarHost {
  setTool(t: ToolId): void;
  toggle(flag: ToggleFlag): void;
  transform(op: FrameOp): void;
  clear(): void;
  zoomBy(steps: number): void;
  zoomFit(): void;
}

function iconButton(name: IconName, title: string, onClick: () => void): HTMLButtonElement {
  return el('button', { class: 'qf-btn qf-btn--ghost qf-art-tb', type: 'button', title, on: { click: onClick } }, icon(name));
}

/** Main toolbar (tools, mirror modes, frame transforms) plus the view bar (onion, grid, zoom) for the status row. */
export class Toolbar {
  readonly element: HTMLDivElement;
  readonly viewBar: HTMLDivElement;
  private readonly toolBtns = new Map<ToolId, HTMLButtonElement>();
  private readonly toggles = new Map<ToggleFlag, HTMLButtonElement>();
  private readonly rotateBtn: HTMLButtonElement;
  private readonly zoomLabel = el('span', { class: 'qf-art-zoom' });

  constructor(host: ToolbarHost) {
    for (const t of TOOLS) {
      const b = iconButton(t.icon, `${t.label} (${t.key}) — ${t.hint}`, () => host.setTool(t.id));
      b.dataset.tool = t.id;
      this.toolBtns.set(t.id, b);
    }
    const toggle = (flag: ToggleFlag, name: IconName, title: string): HTMLButtonElement => {
      const b = iconButton(name, title, () => host.toggle(flag));
      b.dataset.toggle = flag;
      this.toggles.set(flag, b);
      return b;
    };
    this.rotateBtn = iconButton('rotate', 'Rotate 90° clockwise (Shift+R) — square frames / selections', () => host.transform('rotate'));
    this.element = el('div', { class: 'qf-toolbar qf-art-toolbar' },
      [...this.toolBtns.values()],
      el('span', { class: 'qf-sep' }),
      toggle('mirrorX', 'mirrorX', 'Mirror X drawing (left/right symmetry)'),
      toggle('mirrorY', 'mirrorY', 'Mirror Y drawing (top/bottom symmetry)'),
      el('span', { class: 'qf-sep' }),
      iconButton('flipH', 'Flip horizontally (Shift+H)', () => host.transform('flipX')),
      iconButton('flipV', 'Flip vertically (Shift+V)', () => host.transform('flipY')),
      this.rotateBtn,
      iconButton('clear', 'Clear frame / selection (Delete)', () => host.clear()));
    this.viewBar = el('div', { class: 'qf-art-toolbar qf-art-viewbar' },
      toggle('onion', 'onion', 'Onion skin: previous frame at 30%'),
      toggle('grid', 'grid', 'Pixel grid & 8x8 guides'),
      el('span', { class: 'qf-sep' }),
      iconButton('zoomOut', 'Zoom out (wheel) — Space+drag or middle-drag pans', () => host.zoomBy(-1)),
      this.zoomLabel,
      iconButton('zoomIn', 'Zoom in (wheel) — Space+drag or middle-drag pans', () => host.zoomBy(1)),
      iconButton('fit', 'Fit to view', () => host.zoomFit()));
  }

  update(state: ArtState, asset: PixelAsset | null, zoom: number, canRotate: boolean): void {
    for (const t of TOOLS) {
      const b = this.toolBtns.get(t.id)!;
      b.classList.toggle('qf-btn--active', state.tool === t.id);
      b.hidden = !!t.spriteOnly && asset?.kind !== 'sprite';
    }
    for (const [flag, b] of this.toggles) b.classList.toggle('qf-btn--active', state[flag]);
    this.rotateBtn.disabled = !canRotate;
    this.zoomLabel.textContent = `${zoom}×`;
  }
}

export interface StripHost {
  pick(index: number, secondary: boolean): void;
  swap(): void;
  /** Double-click: edit that colour. */
  edit(index: number): void;
}

/** The asset's 16 colours: click = primary, right-click = secondary; index 0 shows as transparency. */
export class PaletteStrip {
  readonly element: HTMLDivElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly primaryEl = el('span', { class: 'qf-art-cur qf-art-cur--primary' });
  private readonly secondaryEl = el('span', { class: 'qf-art-cur qf-art-cur--secondary' });

  constructor(host: StripHost) {
    for (let i = 0; i < 16; i++) {
      const key = i < 10 ? `${i}` : `Shift+${i - 10}`;
      const b = el('button', {
        class: 'qf-art-sw', type: 'button',
        title: `Index ${i}${i === 0 ? ' (transparent)' : ''} — key ${key}; right-click = secondary; double-click = edit colour`,
        dataset: { index: String(i) },
        on: {
          click: () => host.pick(i, false),
          dblclick: () => host.edit(i),
          contextmenu: (e: MouseEvent) => {
            e.preventDefault();
            host.pick(i, true);
          },
        },
      });
      this.swatches.push(b);
    }
    const colours = el('div', { class: 'qf-art-curbox', title: 'Primary (left mouse) / secondary (right mouse)' },
      this.secondaryEl, this.primaryEl,
      el('button', { class: 'qf-art-curswap', type: 'button', title: 'Swap colours (X)', on: { click: () => host.swap() } }, icon('swap')));
    this.element = el('div', { class: 'qf-art-strip' }, colours, el('div', { class: 'qf-art-strip__sw' }, this.swatches));
  }

  update(palette: Palette | undefined, primary: number, secondary: number): void {
    this.swatches.forEach((b, i) => {
      const colour = normalizeHexColor(palette?.colors[i]);
      b.style.background = i === 0 ? '' : colour;
      b.classList.toggle('qf-art-sw--clear', i === 0);
      b.classList.toggle('is-primary', i === primary);
      b.classList.toggle('is-secondary', i === secondary);
    });
    paintCurrent(this.primaryEl, palette, primary);
    paintCurrent(this.secondaryEl, palette, secondary);
  }
}

function paintCurrent(node: HTMLElement, palette: Palette | undefined, index: number): void {
  node.style.background = index === 0 ? '' : normalizeHexColor(palette?.colors[index]);
  node.classList.toggle('qf-art-sw--clear', index === 0);
  node.textContent = String(index);
}
