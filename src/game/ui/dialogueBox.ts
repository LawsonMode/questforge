// Typewriter dialogue box: a framed 232x64 window at the bottom (or top) of the
// screen with a speaker name plate, 3 word-wrapped lines revealed at ~40 chars/s
// (hold A/B/Y to speed up; a text blip every other letter), page by page with a
// blinking "next" arrow, and choice lists (up/down, A/B/Y to confirm; ignored for
// CHOICE_DELAY after the options appear, so mashing through the text never picks
// one unseen). Long pages are split into several boxes automatically; open()
// calls made while a dialogue is showing queue behind it. The window is opaque.
// A box stays invisible until its first update (a dialogue opened during a room
// scroll or fade appears once the new room is on screen, instead of as a
// collapsed bar over the transition).
// OWNER: triggers+UI agent.
import type { DialoguePage, Project } from '../../core/types';
import type { AudioApi, InputState, Renderer } from '../api';
import { BOX_LINES, boxLength, layoutDialogue, type DialogueBoxPage } from './dialogueLayout';
import { UI, drawFrame, drawPointer, outlineText, flatText } from './theme';

export type DialoguePosition = 'top' | 'bottom';

export interface DialogueOpenOptions {
  /** Replaces {name}. */
  name?: string;
  /**
   * Where the box sits (default 'bottom'). The session picks the side that hides
   * neither the hero nor the speaker the hero faces (see DIALOGUE_SPANS).
   */
  position?: DialoguePosition;
  /** Called when a choice is confirmed (e.g. to set the page's choice flag). */
  onChoice?: (page: DialoguePage, index: number) => void;
}

/** Typewriter speed (characters per second) and the multiplier while A/B/Y is held. */
export const CHARS_PER_SECOND = 40;
const FAST_FACTOR = 4;
/** A 'text' blip every this many revealed letters, at most every BLIP_GAP seconds. */
const BLIP_EVERY = 2;
const BLIP_GAP = 0.045;
const OPEN_TIME = 0.1;
/** Choice options take no input for this long (s) after they appear. */
export const CHOICE_DELAY = 0.25;

/** Box frame; the top position leaves the HUD (item box and counters, to y 37) clear of the speaker plate. */
const BOX = { x: 12, w: 232, h: 64, bottomY: 150, topY: 50 } as const;
/** How far (px) the speaker plate reaches above the frame. */
const PLATE_ABOVE = 12;
/** Screen rows [top, bottom) a box covers at each position, speaker plate included. */
export const DIALOGUE_SPANS: Readonly<Record<DialoguePosition, readonly [number, number]>> = {
  top: [BOX.topY - PLATE_ABOVE, BOX.topY + BOX.h],
  bottom: [BOX.bottomY - PLATE_ABOVE, BOX.bottomY + BOX.h],
};
const TEXT_X = BOX.x + 14;
const TEXT_Y = 12;
const LINE_PITCH = 14;
/** Rows of a box holding more than BOX_LINES rows (a question line + 3 options) sit closer. */
const TIGHT_TEXT_Y = 9;
const TIGHT_PITCH = 12;
const OPTION_INDENT = 14;

interface Request {
  boxes: DialogueBoxPage[];
  name: string;
  position: DialoguePosition;
  onChoice?: (page: DialoguePage, index: number) => void;
  resolve: (choice: number) => void;
  choice: number;
}

const ADVANCE = ['a', 'b', 'y'] as const;

export class DialogueBox {
  private readonly audio: AudioApi;
  private readonly queue: Request[] = [];
  private current: Request | null = null;
  private boxIndex = 0;
  private reveal = 0;
  /** Seconds since the current box's text was fully revealed. */
  private shownT = 0;
  private cursor = 0;
  private openT = 0;
  private time = 0;
  private blipT = 0;
  private blipCount = 0;

  constructor(project: Project, audio: AudioApi) {
    void project;
    this.audio = audio;
  }

  get active(): boolean {
    return this.current !== null;
  }

  /** Show pages; resolves with the chosen option index of the last choice (-1 if none) when closed. `name` replaces {name}. */
  open(pages: DialoguePage[], opts?: DialogueOpenOptions): Promise<number> {
    const name = opts?.name ?? '';
    const boxes = layoutDialogue(pages, name);
    if (boxes.length === 0) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      this.queue.push({
        boxes, name, position: opts?.position ?? 'bottom', onChoice: opts?.onChoice, resolve, choice: -1,
      });
      if (!this.current) this.startNext();
    });
  }

  update(dt: number, input: InputState): void {
    const req = this.current;
    if (!req) return;
    this.time += dt;
    this.blipT = Math.max(0, this.blipT - dt);
    if (this.openT < OPEN_TIME) {
      this.openT += dt;
      return;
    }
    const box = req.boxes[this.boxIndex]!;
    const total = boxLength(box);
    if (this.reveal < total) {
      this.type(box, total, dt, input);
      return;
    }
    this.shownT += dt;
    if (box.options) this.updateChoice(req, box, input);
    else if (ADVANCE.some((b) => input.pressed(b))) this.advance(req);
  }

  draw(r: Renderer): void {
    const req = this.current;
    if (!req || this.openT <= 0) return;
    const box = req.boxes[this.boxIndex]!;
    const y = req.position === 'top' ? BOX.topY : BOX.bottomY;
    const grow = Math.min(1, this.openT / OPEN_TIME);
    if (grow < 1) {
      const h = Math.max(8, Math.round(BOX.h * grow));
      drawFrame(r, BOX.x, y + Math.round((BOX.h - h) / 2), BOX.w, h, UI.fillDeep, 0.94);
      return;
    }
    if (box.speaker) this.drawSpeaker(r, box.speaker, y);
    drawFrame(r, BOX.x, y, BOX.w, BOX.h, UI.fillDeep);
    this.drawLines(r, box, y);
    const total = boxLength(box);
    if (this.reveal < total) return;
    if (box.options) this.drawOptions(r, box, y);
    else if (Math.floor(this.time * 3) % 2 === 0) drawPointer(r, BOX.x + BOX.w - 16, y + BOX.h - 11, UI.gold, 'down');
  }

  // ------------------------------------------------------------------ flow

  private startNext(): void {
    this.current = this.queue.shift() ?? null;
    this.boxIndex = 0;
    this.openT = 0;
    this.resetBox();
  }

  private resetBox(): void {
    this.reveal = 0;
    this.shownT = 0;
    this.cursor = 0;
    this.blipCount = 0;
  }

  private type(box: DialogueBoxPage, total: number, dt: number, input: InputState): void {
    const fast = ADVANCE.some((b) => input.held(b));
    const before = Math.floor(this.reveal);
    this.reveal = Math.min(total, this.reveal + CHARS_PER_SECOND * (fast ? FAST_FACTOR : 1) * dt);
    const after = Math.floor(this.reveal);
    const text = box.text;
    for (let i = before; i < after; i++) {
      if (text[i] === ' ') continue;
      this.blipCount++;
      if (this.blipCount % BLIP_EVERY === 1 && this.blipT <= 0) {
        this.audio.sfx('text');
        this.blipT = BLIP_GAP;
      }
    }
  }

  private updateChoice(req: Request, box: DialogueBoxPage, input: InputState): void {
    if (this.shownT < CHOICE_DELAY) return;
    const n = box.options!.length;
    const move = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);
    if (move !== 0) {
      this.cursor = (this.cursor + move + n) % n;
      this.audio.sfx('menuMove');
      return;
    }
    if (!ADVANCE.some((b) => input.pressed(b))) return;
    this.audio.sfx('menuSelect');
    req.choice = this.cursor;
    req.onChoice?.(box.page, this.cursor);
    this.advance(req);
  }

  private advance(req: Request): void {
    this.boxIndex++;
    if (this.boxIndex < req.boxes.length) {
      this.resetBox();
      return;
    }
    this.current = null;
    req.resolve(req.choice);
    if (this.queue.length > 0) this.startNext();
  }

  // ------------------------------------------------------------------ drawing

  private drawSpeaker(r: Renderer, speaker: string, y: number): void {
    const w = r.measureText(speaker) + 14;
    drawFrame(r, BOX.x + 8, y - PLATE_ABOVE, w, 16, UI.fillLight);
    outlineText(r, speaker, BOX.x + 15, y - 8, UI.gold);
  }

  private drawLines(r: Renderer, box: DialogueBoxPage, y: number): void {
    let left = Math.floor(this.reveal);
    for (let i = 0; i < box.lines.length && left > 0; i++) {
      const line = box.lines[i]!;
      flatText(r, left >= line.length ? line : line.slice(0, left), TEXT_X, rowY(box, y, i), UI.text);
      left -= line.length;
    }
  }

  private drawOptions(r: Renderer, box: DialogueBoxPage, y: number): void {
    const first = box.lines.length;
    const options = box.options!;
    for (let i = 0; i < options.length; i++) {
      const ly = rowY(box, y, first + i);
      const selected = i === this.cursor;
      flatText(r, options[i]!, TEXT_X + OPTION_INDENT, ly, selected ? UI.gold : UI.text);
      if (selected) drawPointer(r, TEXT_X + 2 + (Math.floor(this.time * 4) % 2), ly, UI.gold);
    }
  }
}

/** Screen y of text row `i` in a box whose frame top is `top`. */
function rowY(box: DialogueBoxPage, top: number, i: number): number {
  const tight = box.lines.length + (box.options?.length ?? 0) > BOX_LINES;
  return top + (tight ? TIGHT_TEXT_Y + i * TIGHT_PITCH : TEXT_Y + i * LINE_PITCH);
}
