// Live frame previews under the pixel canvas: 1x, 2x and (tiles) a 3x3 repeat
// at 2x to check seams. Drawn from the working bitmap, so they follow a stroke
// while it is being painted.
import { el } from '../ui/dom';
import type { Bitmap } from './ops';
import { rasterBitmap, smallCanvas } from './raster';

export class FramePreviews {
  readonly element: HTMLDivElement;
  private readonly one = smallCanvas(1, 1, 'qf-checker');
  private readonly two = smallCanvas(1, 1, 'qf-checker');
  private readonly tiled = smallCanvas(1, 1, 'qf-checker');
  private readonly tiledBox: HTMLDivElement;

  constructor() {
    this.tiledBox = el('div', { class: 'qf-art-prev', title: '3x3 repeat at 2x (seam check)' }, this.tiled, el('span', null, '3×3'));
    this.element = el('div', { class: 'qf-art-prevs' },
      el('div', { class: 'qf-art-prev', title: 'Actual size' }, this.one, el('span', null, '1×')),
      el('div', { class: 'qf-art-prev', title: 'Double size' }, this.two, el('span', null, '2×')),
      this.tiledBox);
  }

  /** Redraw from the working bitmap (rasterised once, then blitted into every preview). */
  update(work: Bitmap, rgba: Uint32Array, repeat: boolean): void {
    const src = rasterBitmap(work, rgba);
    if (!src) return;
    this.paint(this.one, src, 1, 1);
    this.paint(this.two, src, 2, 1);
    this.tiledBox.hidden = !repeat;
    if (repeat) this.paint(this.tiled, src, 2, 3);
  }

  private paint(c: HTMLCanvasElement, src: HTMLCanvasElement, scale: number, times: number): void {
    const tw = src.width * scale;
    const th = src.height * scale;
    if (c.width !== tw * times || c.height !== th * times) {
      c.width = tw * times;
      c.height = th * times;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < times; ty++) {
      for (let tx = 0; tx < times; tx++) g.drawImage(src, tx * tw, ty * th, tw, th);
    }
  }
}
