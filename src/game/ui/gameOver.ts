// Game over screen: the scene sinks into red, then darkness; "GAME OVER" drops
// in letter by letter; then CONTINUE / SAVE & QUIT. OWNER: triggers+UI agent.
//
// Input is ignored for the first INPUT_AT seconds, so buttons mashed through
// the death can't skip the screen; after that A/Y/Start skip the build-up to the
// moment the letters have landed. The menu then ignores input for MENU_LOCK
// seconds and needs a fresh press; only A/Y/Start confirm (never B, the sword).
import type { AudioApi, Button, InputState, Renderer } from '../api';
import { UI, bigText, drawFrame, drawPointer, outlineText, type TextBand } from './theme';

/** Timeline (s): red wash, fade to dark, letters, then the menu. */
const RED_END = 0.9;
const DARK_END = 1.7;
const LETTERS_START = 1.5;
const LETTER_GAP = 0.08;
const LETTER_DROP = 0.25;
/** Nothing reacts to buttons before this (s). */
export const INPUT_AT = 1;
/** The menu appears (the last letter has landed). */
export const MENU_AT = 2.4;
/** The menu ignores buttons this long (s) after appearing. */
export const MENU_LOCK = 0.3;
const TITLE = 'GAME OVER';
const TITLE_Y = 64;
const SCALE = 3;
const OPTIONS = ['CONTINUE', 'SAVE & QUIT'] as const;
const RESULTS = ['continue', 'saveQuit'] as const;
const MENU = { x: 72, y: 124, w: 112, h: 44 } as const;
const CONFIRM: readonly Button[] = ['a', 'y', 'start'];

const RED_BANDS: readonly TextBand[] = [
  { from: 0, to: 2, color: '#f8b8a0' },
  { from: 2, to: 5, color: '#f85030' },
  { from: 5, to: 8, color: '#b01818' },
];

export class GameOverScreen {
  private readonly audio: AudioApi;
  private t = 0;
  private cursor = 0;

  constructor(audio: AudioApi) {
    this.audio = audio;
  }

  /** Call when the player dies, before the first update. */
  reset(): void {
    this.t = 0;
    this.cursor = 0;
    this.audio.music('gameover');
  }

  update(dt: number, input: InputState): 'none' | 'continue' | 'saveQuit' {
    this.t += dt;
    if (this.t < INPUT_AT) return 'none';
    if (this.t < MENU_AT) {
      if (CONFIRM.some((b) => input.pressed(b))) this.t = MENU_AT;
      return 'none';
    }
    if (this.t < MENU_AT + MENU_LOCK) return 'none';
    const move = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);
    if (move !== 0) {
      this.cursor = (this.cursor + move + OPTIONS.length) % OPTIONS.length;
      this.audio.sfx('menuMove');
      return 'none';
    }
    if (!CONFIRM.some((b) => input.pressed(b))) return 'none';
    this.audio.sfx('menuSelect');
    return RESULTS[this.cursor]!;
  }

  draw(r: Renderer): void {
    const red = Math.min(1, this.t / RED_END);
    r.overlay('#c01010', red * 0.55);
    const dark = Math.max(0, Math.min(1, (this.t - RED_END) / (DARK_END - RED_END)));
    r.overlay('#080000', dark * 0.8);
    this.drawTitle(r);
    if (this.t >= MENU_AT) this.drawMenu(r);
  }

  private drawTitle(r: Renderer): void {
    const w = r.measureText(TITLE) * SCALE;
    let x = Math.round(r.width / 2 - w / 2);
    for (let i = 0; i < TITLE.length; i++) {
      const ch = TITLE[i]!;
      const adv = (r.measureText(ch) + 1) * SCALE;
      const k = (this.t - LETTERS_START - i * LETTER_GAP) / LETTER_DROP;
      if (k > 0 && ch !== ' ') {
        const drop = Math.round((1 - Math.min(1, k)) ** 2 * -40);
        bigText(r, ch, x, TITLE_Y + drop, { scale: SCALE, bands: RED_BANDS, outline: '#200000', outlineWidth: 2 });
      }
      x += adv;
    }
  }

  private drawMenu(r: Renderer): void {
    drawFrame(r, MENU.x, MENU.y, MENU.w, MENU.h, UI.fillDeep);
    OPTIONS.forEach((label, i) => {
      const y = MENU.y + 11 + i * 14;
      const selected = i === this.cursor;
      outlineText(r, label, MENU.x + 30, y, selected ? UI.gold : UI.text);
      if (selected) drawPointer(r, MENU.x + 14 + (Math.floor(this.t * 4) % 2), y, UI.gold);
    });
  }
}
