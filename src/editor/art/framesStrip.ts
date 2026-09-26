// Frames strip (timeline) under the pixel canvas: one thumbnail per frame of
// the edited tile / sprite; click to edit a frame, drag to reorder, buttons to
// add a blank frame, duplicate, delete and move. Sprite anims follow their
// frames (see frames.ts).
import type { EditorContext } from '../context';
import { blankFrame } from '../../gfx/pixels';
import { button, el } from '../ui/dom';
import { appendFrame, deleteFrame, duplicateFrame, moveFrame, type FrameList } from './frames';
import type { ArtActions, ArtState, PixelAsset } from './model';
import { smallCanvas } from './raster';

/** Tallest thumbnail edge in CSS px. */
const THUMB_MAX = 48;

export interface FramesHost {
  readonly ctx: EditorContext;
  readonly state: ArtState;
  readonly actions: ArtActions;
  asset(): PixelAsset | null;
  /** Show another frame on the canvas. */
  selectFrame(index: number): void;
}

export class FramesStrip {
  readonly element: HTMLDivElement;
  private readonly list = el('div', { class: 'qf-art-frames__list' });
  private readonly count = el('span', { class: 'qf-muted qf-small' });
  private readonly delBtn: HTMLButtonElement;
  private readonly leftBtn: HTMLButtonElement;
  private readonly rightBtn: HTMLButtonElement;
  private thumbs: HTMLCanvasElement[] = [];
  private dragFrom: number | null = null;

  constructor(private readonly host: FramesHost) {
    this.delBtn = button('Delete', () => this.op('Delete frame', (l, f) => deleteFrame(l, f), (f, n) => Math.min(f, n - 2)),
      { small: true, kind: 'ghost', title: 'Delete this frame (anims pointing at it fall back to the previous frame)' });
    this.leftBtn = button('◀', () => this.move(-1), { small: true, kind: 'ghost', title: 'Move this frame left' });
    this.rightBtn = button('▶', () => this.move(1), { small: true, kind: 'ghost', title: 'Move this frame right' });
    this.element = el('div', { class: 'qf-art-frames' },
      el('div', { class: 'qf-art-frames__bar' },
        el('span', { class: 'qf-art-frames__title' }, 'Frames'), this.count,
        el('span', { class: 'qf-grow' }),
        button('+ Blank', () => this.addBlank(), { small: true, kind: 'ghost', title: 'Append an empty frame' }),
        button('Duplicate', () => this.op('Duplicate frame', (l, f) => duplicateFrame(l, f), (f) => f + 1),
          { small: true, kind: 'ghost', title: 'Insert a copy of this frame after it' }),
        this.delBtn, this.leftBtn, this.rightBtn),
      this.list);
  }

  /** Rebuild the thumbnails for the current asset / frame count. */
  render(): void {
    const a = this.host.asset();
    this.element.hidden = !a;
    if (!a) return;
    const n = a.frames.length;
    const frame = this.host.state.frame;
    const scale = Math.max(1, Math.floor(THUMB_MAX / Math.max(a.w, a.h)));
    const users = a.kind === 'sprite' ? this.frameUsers(a) : [];
    this.thumbs = a.frames.map(() => smallCanvas(a.w, a.h, 'qf-checker'));
    this.list.replaceChildren(...this.thumbs.map((c, i) => {
      c.style.width = `${a.w * scale}px`;
      c.style.height = `${a.h * scale}px`;
      const used = users[i]?.length ? `\nUsed by: ${users[i]!.join(', ')}` : '';
      const cell = el('button', {
        class: `qf-art-frame${i === frame ? ' is-active' : ''}`, type: 'button', draggable: true,
        title: `Frame ${i}${used}\nClick to edit · drag to reorder`, dataset: { frame: String(i) },
        on: {
          click: () => this.host.selectFrame(i),
          dragstart: (e: DragEvent) => {
            this.dragFrom = i;
            e.dataTransfer?.setData('text/plain', String(i));
          },
          dragover: (e: DragEvent) => {
            if (this.dragFrom === null) return;
            e.preventDefault();
            cell.classList.add('is-drop');
          },
          dragleave: () => cell.classList.remove('is-drop'),
          drop: (e: DragEvent) => {
            e.preventDefault();
            cell.classList.remove('is-drop');
            this.dropOn(i);
          },
          dragend: () => { this.dragFrom = null; },
        },
      }, c, el('span', { class: 'qf-art-frame__n' }, String(i)));
      return cell;
    }));
    this.count.textContent = `${frame + 1} / ${n}`;
    this.delBtn.disabled = n <= 1;
    this.leftBtn.disabled = frame <= 0;
    this.rightBtn.disabled = frame >= n - 1;
    this.visuals();
    this.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Pixels changed: redraw the thumbnails from the asset cache. */
  visuals(): void {
    const a = this.host.asset();
    if (!a) return;
    const assets = this.host.ctx.assets;
    this.thumbs.forEach((c, i) => {
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      const img = a.kind === 'tile' ? assets.tile(a.id as number, i) : assets.sprite(a.id as string, i);
      if (img) g.drawImage(img, 0, 0);
    });
  }

  /** Anim names referencing each frame (sprites). */
  private frameUsers(a: PixelAsset): string[][] {
    const def = this.host.ctx.assets.spriteDef(a.id as string);
    const out: string[][] = a.frames.map(() => []);
    if (!def) return out;
    for (const [name, anim] of Object.entries(def.anims)) {
      for (const f of new Set(anim.frames)) out[f]?.push(name);
    }
    return out;
  }

  private addBlank(): void {
    const a = this.host.asset();
    if (!a) return;
    const blank = blankFrame(a.w, a.h);
    this.op('Add frame', (l) => appendFrame(l, blank), (_, n) => n);
  }

  private move(delta: number): void {
    const from = this.host.state.frame;
    this.op('Move frame', (l) => moveFrame(l, from, from + delta), () => from + delta);
  }

  private dropOn(to: number): void {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null || from === to) return;
    this.op('Reorder frames', (l) => moveFrame(l, from, to), () => to);
  }

  /**
   * Apply a frame-list operation as one undo step, then show frame
   * next(currentFrame, frameCountBefore).
   */
  private op(label: string, fn: (list: FrameList, frame: number) => FrameList, next: (frame: number, n: number) => number): void {
    const a = this.host.asset();
    if (!a) return;
    const frame = this.host.state.frame;
    const n = a.frames.length;
    const { actions } = this.host;
    if (a.kind === 'tile') {
      actions.edit('tile', a.id as number, `${label} (tile ${a.id})`, (t) => {
        t.frames = fn({ frames: t.frames, anims: {} }, frame).frames;
      }, true);
    } else {
      actions.edit('sprite', a.id as string, `${label} (sprite ${a.id})`, (s) => {
        const r = fn({ frames: s.frames, anims: s.anims }, frame);
        s.frames = r.frames;
        s.anims = r.anims;
      }, true);
    }
    const count = this.host.asset()?.frames.length ?? 1;
    this.host.selectFrame(Math.max(0, Math.min(count - 1, next(frame, n))));
  }
}
