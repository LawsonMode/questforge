// Live dialogue preview: drives the game's own DialogueBox on an off-screen
// CanvasRenderer and shows the bottom of the 256x224 screen at 2x, so the box,
// speaker plate, wrapping and choice cursor look exactly as in game. "▶ Play"
// types the dialogue out in real time (click / Space / Z to advance, ↑↓ to
// choose); otherwise the selected page is shown fully revealed. {btn:x} codes
// show as the button names of the device in use (redrawn when it changes) or
// of the device picked under "Buttons as".
import type { EditorContext } from '../context';
import type { AudioApi, Button, InputState } from '../../game/api';
import type { DialoguePage, MusicId, SfxId } from '../../core/types';
import type { Vec } from '../../core/math';
import { CanvasRenderer } from '../../gfx/renderer';
import { DialogueBox } from '../../game/ui/dialogueBox';
import { boxLength, layoutDialogue } from '../../game/ui/dialogueLayout';
import { getAudio } from '../../audio/audio';
import { SCREEN_H, SCREEN_W, STEP, TILE } from '../../core/constants';
import { T } from '../../content/ids';
import { button, el, pixelCanvas, select } from '../ui/dom';
import { onControlsChange, type ControlsInfo, type LabelOpts } from '../../input/devices';
import { PREVIEW_NAME, withButtons } from './dialogueModel';

/** Screen rows shown: the dialogue box, its speaker plate and a strip of backdrop. */
const VIEW_Y = 126;
const VIEW_H = SCREEN_H - VIEW_Y;
const SCALE = 2;
/** Fast-forward speed used to reveal a static box (the game's "hold A" speed). */
const REVEAL_TICKS_PER_CHAR = 0.5;
const MAX_TICKS = 2000;
const BACKDROP = '#205028';

/** Whose button names {btn:x} codes show: the device in use, or a chosen one. */
type ButtonsAs = 'auto' | 'keyboard' | 'xbox' | 'playstation' | 'nintendo';

const BUTTONS_AS: readonly { value: ButtonsAs; label: string }[] = [
  { value: 'auto', label: 'Device in use' },
  { value: 'keyboard', label: 'Keyboard (Z X C)' },
  { value: 'xbox', label: 'Controller (A B X Y)' },
  { value: 'playstation', label: 'Controller (✕ ○ □ △)' },
  { value: 'nintendo', label: 'Controller (B A Y X)' },
];

/** Label options for a "Buttons as" choice (undefined = the device in use). */
function labelOpts(as: ButtonsAs): LabelOpts | undefined {
  if (as === 'auto') return undefined;
  const info: ControlsInfo = as === 'keyboard'
    ? { device: 'keyboard', family: 'generic', padName: null, padIndex: null }
    : { device: 'gamepad', family: as, padName: null, padIndex: null };
  return { info };
}

const KEY_BUTTONS: Readonly<Record<string, Button>> = {
  Space: 'a', Enter: 'a', KeyZ: 'a', KeyX: 'a', KeyC: 'a', ArrowUp: 'up', ArrowDown: 'down', KeyW: 'up', KeyS: 'down',
};

/** Scripted pad for the preview: buttons are pressed by code, key and mouse events. */
class PreviewInput implements InputState {
  private readonly down = new Set<Button>();
  private readonly edge = new Set<Button>();

  press(b: Button): void {
    if (!this.down.has(b)) this.edge.add(b);
    this.down.add(b);
  }

  release(b: Button): void {
    this.down.delete(b);
  }

  /** Pressed for one tick without being held. */
  tap(b: Button): void {
    this.edge.add(b);
  }

  reset(): void {
    this.down.clear();
    this.edge.clear();
  }

  /** Call after each simulated tick. */
  endTick(): void {
    this.edge.clear();
  }

  held(b: Button): boolean { return this.down.has(b); }
  pressed(b: Button): boolean { return this.edge.has(b); }
  released(): boolean { return false; }
  heldTime(b: Button): number { return this.down.has(b) ? STEP : 0; }
  dir(): Vec { return { x: 0, y: 0 }; }
  anyPressed(): boolean { return this.edge.size > 0; }
  typed(): string { return ''; }
}

/** Audio for the box: silent for static snapshots, the shared chip audio while playing. */
class PreviewAudio implements AudioApi {
  enabled = false;
  readonly currentMusic: MusicId | 'none' = 'none';
  sfx(id: SfxId): void {
    if (this.enabled) getAudio().sfx(id);
  }
  music(): void {}
  duck(): void {}
  setVolumes(): void {}
  unlock(): void {
    getAudio().unlock();
  }
  setMuted(): void {}
}

export class DialoguePreview {
  readonly element: HTMLDivElement;
  private readonly view = pixelCanvas(SCREEN_W, VIEW_H, SCALE, 'qf-dlg-preview__canvas');
  private readonly display = document.createElement('canvas');
  private readonly renderer: CanvasRenderer;
  private readonly input = new PreviewInput();
  private readonly audio = new PreviewAudio();
  private readonly status = el('div', { class: 'qf-dlg-preview__status' });
  private readonly playBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  /** The pages as written (with {btn:x} codes). */
  private source: DialoguePage[] = [];
  /** The pages as the game shows them (codes replaced). */
  private pages: DialoguePage[] = [];
  private buttonsAs: ButtonsAs = 'auto';
  private readonly offControls: () => void;
  private pageIndex = 0;
  private boxIndex = 0;
  private playing: DialogueBox | null = null;
  private raf = 0;
  private last = 0;
  private acc = 0;

  constructor(private readonly ctx: EditorContext) {
    this.renderer = new CanvasRenderer(this.display, ctx.project, ctx.assets);
    this.view.tabIndex = 0;
    this.view.title = 'While playing: click, Space or Z to continue; ↑ ↓ to choose';
    this.view.addEventListener('keydown', (e) => this.onKey(e, true));
    this.view.addEventListener('keyup', (e) => this.onKey(e, false));
    this.view.addEventListener('mousedown', () => {
      if (this.playing) this.input.tap('a');
    });
    this.playBtn = button('▶ Play', () => (this.playing ? this.stop() : this.play()), { small: true, kind: 'primary', title: 'Type the dialogue out like the game does, from this page on' });
    this.prevBtn = button('‹ Box', () => this.stepBox(-1), { small: true, title: 'Previous box of this page (long pages are split into boxes)' });
    this.nextBtn = button('Box ›', () => this.stepBox(1), { small: true, title: 'Next box of this page' });
    const buttonsAs = select(BUTTONS_AS, this.buttonsAs, (v) => {
      this.buttonsAs = v;
      this.refreshButtons();
    }, { title: 'Button codes like {btn:a} show as the keys or controller buttons of this device' });
    buttonsAs.classList.add('qf-dlg-preview__as');
    this.element = el('div', { class: 'qf-dlg-preview' },
      el('div', { class: 'qf-dlg-preview__screen' }, this.view),
      el('div', { class: 'qf-dlg-preview__bar' }, this.playBtn, this.prevBtn, this.nextBtn, this.status),
      el('label', { class: 'qf-dlg-preview__opts' }, el('span', null, 'Buttons as'), buttonsAs));
    // The player switched device (or swapped the face buttons): codes name other buttons now.
    this.offControls = onControlsChange(() => {
      if (this.buttonsAs === 'auto') this.refreshButtons();
    });
  }

  /** Show page `index` of `pages` fully revealed (restarts at its first box when the page changes). */
  show(pages: DialoguePage[], index: number): void {
    if (this.playing) this.stop();
    if (index !== this.pageIndex) this.boxIndex = 0;
    this.source = pages;
    this.pages = this.withCodes(pages);
    this.pageIndex = index;
    this.drawStatic();
  }

  /** Stop playback and release resources. */
  destroy(): void {
    this.offControls();
    this.stop();
    this.renderer.dispose();
  }

  private withCodes(pages: readonly DialoguePage[]): DialoguePage[] {
    const opts = labelOpts(this.buttonsAs);
    return pages.map((pg) => withButtons(pg, opts));
  }

  /** Button names changed: redraw the static page (a playback in progress keeps its text). */
  private refreshButtons(): void {
    this.pages = this.withCodes(this.source);
    if (!this.playing) this.drawStatic();
  }

  // ---------------------------------------------------------------- static

  private boxesOfPage(): number {
    const page = this.pages[this.pageIndex];
    return page ? layoutDialogue([page], PREVIEW_NAME).length : 0;
  }

  private stepBox(delta: number): void {
    const n = this.boxesOfPage();
    this.boxIndex = Math.max(0, Math.min(n - 1, this.boxIndex + delta));
    this.drawStatic();
  }

  private drawStatic(): void {
    const page = this.pages[this.pageIndex];
    const boxes = page ? layoutDialogue([page], PREVIEW_NAME) : [];
    this.boxIndex = Math.max(0, Math.min(boxes.length - 1, this.boxIndex));
    const box = new DialogueBox(this.ctx.project, this.audio);
    this.audio.enabled = false;
    this.input.reset();
    if (page && boxes.length) {
      void box.open([page], { name: PREVIEW_NAME });
      this.input.press('a');
      let ticks = 0;
      for (let b = 0; b <= this.boxIndex; b++) {
        const need = Math.ceil(boxLength(boxes[b]!) * REVEAL_TICKS_PER_CHAR) + 12;
        for (let i = 0; i < need && ticks < MAX_TICKS; i++, ticks++) this.tick(box);
        if (b < this.boxIndex) {
          this.input.tap('a');
          this.tick(box);
        }
      }
      this.input.reset();
      // Land on a frame where the blinking "next" arrow is visible.
      while (Math.floor(ticks * STEP * 3) % 2 !== 0 && ticks < MAX_TICKS) {
        this.tick(box);
        ticks++;
      }
    }
    this.paint(box);
    const count = boxes.length;
    this.playBtn.disabled = !this.playable();
    this.prevBtn.disabled = this.boxIndex <= 0;
    this.nextBtn.disabled = this.boxIndex >= count - 1;
    this.status.textContent = !page ? 'No page selected.'
      : count === 0 ? 'Empty page: the game skips it.'
        : `Page ${this.pageIndex + 1} of ${this.pages.length} · box ${this.boxIndex + 1} of ${count}`;
  }

  private tick(box: DialogueBox): void {
    box.update(STEP, this.input);
    this.input.endTick();
  }

  // ---------------------------------------------------------------- playback

  /** Whether the pages from the shown one on produce any box. */
  private playable(): boolean {
    return layoutDialogue(this.pages.slice(this.pageIndex), PREVIEW_NAME).length > 0;
  }

  private play(): void {
    if (!this.playable()) return;
    const pages = this.pages.slice(this.pageIndex);
    this.audio.unlock();
    this.audio.enabled = true;
    this.input.reset();
    const box = new DialogueBox(this.ctx.project, this.audio);
    void box.open(pages, { name: PREVIEW_NAME });
    this.playing = box;
    this.playBtn.textContent = '■ Stop';
    this.prevBtn.disabled = true;
    this.nextBtn.disabled = true;
    this.status.textContent = 'Playing: click the box or press Space / Z to continue, ↑ ↓ to choose.';
    this.view.focus();
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Stop playback (no-op when not playing) and show the static page again. */
  stop(): void {
    if (!this.playing) return;
    cancelAnimationFrame(this.raf);
    this.playing = null;
    this.audio.enabled = false;
    this.input.reset();
    this.playBtn.textContent = '▶ Play';
    this.drawStatic();
  }

  private frame(now: number): void {
    const box = this.playing;
    if (!box) return;
    this.acc = Math.min(this.acc + (now - this.last) / 1000, 0.25);
    this.last = now;
    while (this.acc >= STEP && box.active) {
      this.tick(box);
      this.acc -= STEP;
    }
    if (!box.active) {
      this.stop();
      return;
    }
    this.paint(box);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const b = KEY_BUTTONS[e.code];
    if (!b || !this.playing) return;
    e.preventDefault();
    e.stopPropagation();
    if (down && !e.repeat) this.input.press(b);
    else if (!down) this.input.release(b);
  }

  // ---------------------------------------------------------------- drawing

  private paint(box: DialogueBox): void {
    const r = this.renderer;
    r.clear(BACKDROP);
    const grass = T.GRASS;
    if (grass !== undefined && this.ctx.assets.tileDef(grass)) {
      for (let y = Math.floor(VIEW_Y / TILE) * TILE; y < SCREEN_H; y += TILE) {
        for (let x = 0; x < SCREEN_W; x += TILE) r.drawTile(grass, x, y);
      }
    }
    box.draw(r);
    const g = this.view.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(r.backbuffer, 0, VIEW_Y, SCREEN_W, VIEW_H, 0, 0, SCREEN_W, VIEW_H);
  }
}
