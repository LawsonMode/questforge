// File select: 3 save slots (name, hearts, items, play time), create (name entry
// via on-screen letter grid or typing), erase with confirmation.
// OWNER: triggers+UI agent.
//
// Confirm is A/Y or the Enter key; cancel is B or the Escape key. Enter and
// Escape both press Start, so Start only counts when typed() tells which key it
// was: '\n' (Enter) confirms, '\u001b' (Escape, once the input layer reports
// it) cancels. A gamepad's Start (Start with neither, from the pad in use)
// opens the file under the cursor and finishes a name, but never confirms an
// erase, so it can never erase a file by accident; any other Start is ignored.
// Name entry takes both the letter grid (d-pad or stick + A/Y to pick, with
// auto-repeat while a direction is held; B deletes; END or a pad's Start
// finishes) and the keyboard (input.typed(): letters, Backspace, Enter; Escape
// cancels the entry). The keys that double as pad buttons (X K Space = A, Z J = B,
// C L = Y) type their letter unless the grid cursor was the last thing moved, in
// which case they act as the buttons; a key that typed a character is never also
// a button. Hints name the buttons of the device in use; a gamepad player is also
// told to click or press a key while browser audio is still locked.
import type { ItemId, Project, SaveData } from '../../core/types';
import type { AudioApi, Button, InputState, Renderer } from '../api';
import { currentControls } from '../../input/devices';
import {
  GOLD_BANDS, SOUND_HINT, UI, bigText, drawFrame, drawHearts, drawItem, drawPointer, formatTime, keyLabel, liveText,
  needsSoundHint, outlineText,
} from './theme';
import { padStart, repeated } from './menuInput';

export type FileSelectResult =
  | { kind: 'none' }
  | { kind: 'play'; slot: number; save: SaveData }
  | { kind: 'create'; slot: number; name: string }
  | { kind: 'erase'; slot: number }
  | { kind: 'back' };

/** Longest save-file name. */
export const NAME_MAX = 8;

type Mode = 'select' | 'name' | 'erase' | 'confirmErase';

const NONE: FileSelectResult = { kind: 'none' };
const SLOTS = 3;
/** Cursor index of the ERASE / CANCEL option under the slots. */
const OPTION = SLOTS;
const GEAR: readonly ItemId[] = ['sword', 'shield', 'bow', 'boomerang', 'hookshot', 'bombs', 'lantern', 'boots', 'glove', 'flippers'];

const SLOT = { x: 24, y: 32, w: 216, h: 44, pitch: 48 } as const;

const GRID_ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789-.!'] as const;
const GRID_COLS = 13;
/** The last grid row holds three wide buttons; each spans these columns. */
const SPECIALS = [
  { label: 'SPACE', from: 0, to: 4 },
  { label: 'DEL', from: 5, to: 8 },
  { label: 'END', from: 9, to: 12 },
] as const;
const GRID = { x: 16, y: 92, w: 224, h: 104, cellX: 32, cellY: 106, pitchX: 16, pitchY: 13 } as const;
const NAME_BOX = { x: 52, y: 40, w: 152, h: 34 } as const;
/** Pad buttons and the keyboard keys that press them (whose typed letters are ambiguous). */
const BUTTON_KEYS: readonly (readonly [Button, string])[] = [['a', 'xk '], ['b', 'zj'], ['y', 'cl']];
/** typed() markers for the Enter and Escape keys. */
const ENTER = '\n';
const ESC = '\u001b';

/** Screen y of the gamepad sound hint: under the slot list, and between the name box and the grid. */
const SOUND_HINT_Y = { list: 197, name: 81 } as const;

const selectHint = liveText(() => `${keyLabel('a')} / ${keyLabel('start')}: START   ${keyLabel('b')}: BACK`);
const eraseHint = liveText(() => `${keyLabel('a')}: ERASE   ${keyLabel('b')}: CANCEL`);
/** Name entry: typing on a keyboard; the grid buttons on a gamepad. */
const nameHint = liveText(() => (currentControls().device === 'gamepad'
  ? `${keyLabel('a')}: PICK   ${keyLabel('b')}: DELETE   ${keyLabel('start')}: DONE`
  : `TYPE OR PICK LETTERS   ${keyLabel('start')}: DONE`));

export class FileSelect {
  private readonly audio: AudioApi;
  private saves: (SaveData | null)[];
  private mode: Mode = 'select';
  private cursor = 0;
  private slot = 0;
  private name = '';
  private gx = 0;
  private gy = 0;
  /** The grid cursor moved more recently than a key typed a letter. */
  private gridActive = false;
  private confirmYes = false;
  private t = 0;
  private errorT = 0;

  constructor(project: Project, audio: AudioApi, saves: (SaveData | null)[]) {
    void project;
    this.audio = audio;
    this.saves = normalize(saves);
    audio.music('fileSelect');
  }

  /** Refresh slot contents (after create/erase). */
  setSaves(saves: (SaveData | null)[]): void {
    this.saves = normalize(saves);
    if (this.mode === 'erase' || this.mode === 'confirmErase') this.mode = 'select';
  }

  update(dt: number, input: InputState): FileSelectResult {
    this.t += dt;
    this.errorT = Math.max(0, this.errorT - dt);
    switch (this.mode) {
      case 'select': return this.updateSelect(input);
      case 'name': return this.updateName(input);
      case 'erase': return this.updateErase(input);
      case 'confirmErase': return this.updateConfirm(input);
    }
  }

  draw(r: Renderer): void {
    drawBackdrop(r, this.t);
    if (this.mode === 'name') {
      this.drawNameEntry(r);
      return;
    }
    const erasing = this.mode !== 'select';
    drawBanner(r, erasing ? 'ERASE WHICH FILE?' : 'CHOOSE A FILE');
    for (let i = 0; i < SLOTS; i++) this.drawSlot(r, i);
    this.drawOption(r, erasing ? 'CANCEL' : 'ERASE A FILE');
    drawHint(r, erasing ? eraseHint() : selectHint());
    this.drawSoundHint(r, SOUND_HINT_Y.list);
    if (this.mode === 'confirmErase') this.drawConfirm(r);
  }

  // ------------------------------------------------------------------ modes

  private updateSelect(input: InputState): FileSelectResult {
    if (this.moveCursor(input)) return NONE;
    if (cancelled(input)) {
      this.audio.sfx('menuClose');
      return { kind: 'back' };
    }
    if (!confirmed(input) && !padStart(input)) return NONE;
    if (this.cursor === OPTION) {
      if (!this.saves.some(Boolean)) return this.fail();
      this.audio.sfx('menuSelect');
      this.mode = 'erase';
      this.cursor = this.saves.findIndex(Boolean);
      return NONE;
    }
    const save = this.saves[this.cursor];
    this.audio.sfx('menuSelect');
    if (save) return { kind: 'play', slot: this.cursor, save };
    this.startNameEntry(this.cursor);
    return NONE;
  }

  private updateErase(input: InputState): FileSelectResult {
    if (this.moveCursor(input)) return NONE;
    const confirm = confirmed(input);
    if (cancelled(input) || (confirm && this.cursor === OPTION)) {
      this.audio.sfx('menuClose');
      this.mode = 'select';
      this.cursor = OPTION;
      return NONE;
    }
    if (!confirm) return NONE;
    if (!this.saves[this.cursor]) return this.fail();
    this.audio.sfx('menuSelect');
    this.mode = 'confirmErase';
    this.confirmYes = false;
    return NONE;
  }

  private updateConfirm(input: InputState): FileSelectResult {
    if (input.pressed('up') || input.pressed('down') || input.pressed('left') || input.pressed('right')) {
      this.confirmYes = !this.confirmYes;
      this.audio.sfx('menuMove');
      return NONE;
    }
    const confirm = confirmed(input);
    if (cancelled(input) || (confirm && !this.confirmYes)) {
      this.audio.sfx('menuClose');
      this.mode = 'erase';
      return NONE;
    }
    if (!confirm) return NONE;
    this.audio.sfx('menuSelect');
    this.mode = 'select';
    return { kind: 'erase', slot: this.cursor };
  }

  /** Up/down over the three slots and the option below them. True if it moved. */
  private moveCursor(input: InputState): boolean {
    const move = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);
    if (move === 0) return false;
    this.cursor = (this.cursor + move + SLOTS + 1) % (SLOTS + 1);
    this.audio.sfx('menuMove');
    return true;
  }

  private fail(): FileSelectResult {
    this.audio.sfx('error');
    this.errorT = 0.3;
    return NONE;
  }

  // ------------------------------------------------------------------ name entry

  private startNameEntry(slot: number): void {
    this.mode = 'name';
    this.slot = slot;
    this.name = '';
    this.gx = 0;
    this.gy = 0;
    this.gridActive = false;
  }

  private updateName(input: InputState): FileSelectResult {
    const ambiguous = this.gridActive ? buttonKeys(input) : '';
    let typedAny = false;
    for (const ch of input.typed()) {
      if (ch === ESC) return this.cancelName();
      if (ch === ENTER) return this.finishName();
      if (ch === '\b') {
        this.deleteChar();
        typedAny = true;
      } else if (!ambiguous.includes(ch.toLowerCase()) && isPrintable(ch)) {
        this.append(ch);
        this.gridActive = false;
        typedAny = true;
      }
    }
    if (typedAny) return NONE;
    if (padStart(input)) return this.finishName();
    if (this.moveGrid(input)) return NONE;
    if (input.pressed('a') || input.pressed('y')) return this.pick();
    return input.pressed('b') ? this.back() : NONE;
  }

  /** B in name entry: delete the last letter, or leave when the name is empty. */
  private back(): FileSelectResult {
    if (this.name.length > 0) {
      this.deleteChar();
      return NONE;
    }
    return this.cancelName();
  }

  /** Leave name entry without creating a file. */
  private cancelName(): FileSelectResult {
    this.audio.sfx('menuClose');
    this.mode = 'select';
    return NONE;
  }

  /** D-pad / stick / arrows move the grid cursor, repeating while held. True if it moved. */
  private moveGrid(input: InputState): boolean {
    const dx = (repeated(input, 'right') ? 1 : 0) - (repeated(input, 'left') ? 1 : 0);
    const dy = (repeated(input, 'down') ? 1 : 0) - (repeated(input, 'up') ? 1 : 0);
    if (dx === 0 && dy === 0) return false;
    const rows = GRID_ROWS.length + 1;
    this.gy = (this.gy + dy + rows) % rows;
    if (this.gy === GRID_ROWS.length) {
      const i = specialAt(this.gx);
      const next = SPECIALS[(i + dx + SPECIALS.length) % SPECIALS.length]!;
      this.gx = dx === 0 ? this.gx : next.from + 1;
    } else {
      this.gx = (this.gx + dx + GRID_COLS) % GRID_COLS;
    }
    this.gridActive = true;
    this.audio.sfx('menuMove');
    return true;
  }

  private pick(): FileSelectResult {
    if (this.gy < GRID_ROWS.length) {
      this.append(GRID_ROWS[this.gy]![this.gx]!);
      if (this.name.length >= NAME_MAX) {
        this.gy = GRID_ROWS.length;
        this.gx = SPECIALS[2].from + 1;
      }
      return NONE;
    }
    switch (SPECIALS[specialAt(this.gx)]!.label) {
      case 'SPACE':
        this.append(' ');
        return NONE;
      case 'DEL':
        this.deleteChar();
        return NONE;
      default:
        return this.finishName();
    }
  }

  private append(ch: string): void {
    if (this.name.length >= NAME_MAX) {
      this.fail();
      return;
    }
    this.name += ch;
    this.audio.sfx('menuSelect');
  }

  private deleteChar(): void {
    if (this.name.length === 0) return;
    this.name = this.name.slice(0, -1);
    this.audio.sfx('menuMove');
  }

  private finishName(): FileSelectResult {
    const name = this.name.trim();
    if (!name) return this.fail();
    this.audio.sfx('menuSelect');
    this.mode = 'select';
    return { kind: 'create', slot: this.slot, name };
  }

  // ------------------------------------------------------------------ drawing

  private drawSlot(r: Renderer, i: number): void {
    const y = SLOT.y + i * SLOT.pitch;
    const selected = this.cursor === i;
    const erasing = this.mode !== 'select';
    const fill = selected ? (erasing ? '#401830' : UI.fillLight) : UI.fill;
    drawFrame(r, SLOT.x, y, SLOT.w, SLOT.h, fill, 0.96);
    bigText(r, String(i + 1), SLOT.x + 10, y + 14, { scale: 2, bands: GOLD_BANDS, outline: '#301008' });
    if (selected) this.drawCursor(r, SLOT.x - 12, y + SLOT.h / 2 - 3);
    const save = this.saves[i];
    if (!save) {
      outlineText(r, 'EMPTY', SLOT.x + 34, y + 18, UI.dim);
      return;
    }
    outlineText(r, save.name, SLOT.x + 34, y + 8, UI.text);
    if (save.crystals > 0) {
      r.drawSpriteAnim('item', 'crystal', 0, SLOT.x + 98, y + 12, { screen: true });
      outlineText(r, `x${save.crystals}`, SLOT.x + 106, y + 8, UI.text);
    }
    GEAR.filter((item) => owns(save, item)).forEach((item, k) => drawItem(r, save, item, SLOT.x + 42 + k * 13, y + 30));
    drawHearts(r, SLOT.x + SLOT.w - 90, y + 7, save.hp, save.maxHp);
    outlineText(r, formatTime(save.playTime), SLOT.x + SLOT.w - 10, y + 29, UI.mid, { align: 'right' });
  }

  private drawOption(r: Renderer, label: string): void {
    const y = SLOT.y + SLOTS * SLOT.pitch + 6;
    const selected = this.cursor === OPTION;
    outlineText(r, label, SLOT.x + 12, y, selected ? UI.gold : UI.text);
    if (selected) this.drawCursor(r, SLOT.x - 2, y);
  }

  private drawConfirm(r: Renderer): void {
    const save = this.saves[this.cursor];
    const x = 48;
    const y = 84;
    drawFrame(r, x, y, 160, 60, UI.fillDeep);
    outlineText(r, `ERASE FILE ${this.cursor + 1}?`, x + 80, y + 9, UI.gold, { align: 'center' });
    if (save) outlineText(r, save.name, x + 80, y + 20, UI.text, { align: 'center' });
    (['NO', 'YES'] as const).forEach((label, k) => {
      const selected = (k === 1) === this.confirmYes;
      const ly = y + 34 + k * 12;
      outlineText(r, label, x + 72, ly, selected ? (k === 1 ? UI.red : UI.gold) : UI.text);
      if (selected) this.drawCursor(r, x + 58, ly);
    });
  }

  private drawNameEntry(r: Renderer): void {
    drawBanner(r, `FILE ${this.slot + 1}: YOUR NAME?`);
    const b = NAME_BOX;
    const shake = this.errorT > 0 ? Math.round(Math.sin(this.t * 80) * 2) : 0;
    drawFrame(r, b.x + shake, b.y, b.w, b.h, UI.fillDeep, 0.96);
    const pitch = 16;
    const left = b.x + shake + Math.round((b.w - NAME_MAX * pitch) / 2) + 2;
    for (let i = 0; i < NAME_MAX; i++) {
      const cx = left + i * pitch + 6;
      const ch = this.name[i];
      if (ch) bigText(r, ch, cx, b.y + 7, { scale: 2, bands: [{ from: 0, to: 8, color: UI.text }], align: 'center' });
      const caret = i === this.name.length && Math.floor(this.t * 3) % 2 === 0;
      r.fillRect(cx - 5, b.y + 26, 11, 1, caret ? UI.gold : UI.shade, { screen: true });
    }
    drawFrame(r, GRID.x, GRID.y, GRID.w, GRID.h, UI.fill, 0.96);
    GRID_ROWS.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        const selected = gy === this.gy && gx === this.gx;
        const x = GRID.cellX + gx * GRID.pitchX;
        const y = GRID.cellY + gy * GRID.pitchY;
        if (selected) this.drawCellCursor(r, x - 5, y - 3, 11, 13);
        outlineText(r, row[gx]!, x, y, selected ? UI.gold : UI.text, { align: 'center' });
      }
    });
    const sy = GRID.cellY + GRID_ROWS.length * GRID.pitchY + 3;
    SPECIALS.forEach((s, i) => {
      const x0 = GRID.cellX + s.from * GRID.pitchX - 6;
      const w = (s.to - s.from) * GRID.pitchX + 12;
      const selected = this.gy === GRID_ROWS.length && specialAt(this.gx) === i;
      if (selected) this.drawCellCursor(r, x0, sy - 3, w, 13);
      outlineText(r, s.label, x0 + w / 2, sy, selected ? UI.gold : UI.mid, { align: 'center' });
    });
    drawHint(r, nameHint());
    this.drawSoundHint(r, SOUND_HINT_Y.name);
  }

  private drawSoundHint(r: Renderer, y: number): void {
    if (needsSoundHint(this.audio)) outlineText(r, SOUND_HINT, r.width / 2, y, UI.gold, { align: 'center' });
  }

  private drawCursor(r: Renderer, x: number, y: number): void {
    drawPointer(r, x + (Math.floor(this.t * 4) % 2), y, UI.gold);
  }

  private drawCellCursor(r: Renderer, x: number, y: number, w: number, h: number): void {
    const color = Math.floor(this.t * 4) % 2 === 0 ? UI.gold : UI.goldDark;
    r.fillRect(x, y, w, h, UI.fillDeep, { screen: true, alpha: 0.8 });
    r.strokeRect(x, y, w, h, color, { screen: true });
  }
}

/** Exactly SLOTS entries (missing ones empty). */
function normalize(saves: (SaveData | null)[]): (SaveData | null)[] {
  return Array.from({ length: SLOTS }, (_, i) => saves[i] ?? null);
}

function owns(save: SaveData, item: ItemId): boolean {
  return (save.items[item] ?? 0) > 0 || (item === 'bombs' && save.bombs > 0);
}

function isPrintable(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return ch.length === 1 && c >= 32 && c <= 126;
}

/** Index into SPECIALS of the wide button covering grid column `gx`. */
function specialAt(gx: number): number {
  const i = SPECIALS.findIndex((s) => gx >= s.from && gx <= s.to);
  return i < 0 ? SPECIALS.length - 1 : i;
}

/** A/Y, or Start pressed by the Enter key. */
function confirmed(input: InputState): boolean {
  return input.pressed('a') || input.pressed('y') || (input.pressed('start') && input.typed().includes(ENTER));
}

/** B, or the Escape key. */
function cancelled(input: InputState): boolean {
  return input.pressed('b') || input.typed().includes(ESC);
}

/** Letters of the keys that pressed a pad button this tick (they act as that button, not as typing). */
function buttonKeys(input: InputState): string {
  return BUTTON_KEYS.filter(([b]) => input.pressed(b)).map(([, keys]) => keys).join('');
}

/** Slowly drifting two-tone checkerboard. */
function drawBackdrop(r: Renderer, t: number): void {
  r.fillRect(0, 0, r.width, r.height, '#0c1030', { screen: true });
  const size = 16;
  const off = Math.floor(t * 6) % (size * 2);
  for (let y = -size * 2; y < r.height + size; y += size) {
    for (let x = -size * 2; x < r.width + size; x += size) {
      if (((x + y) / size) % 2 === 0) r.fillRect(x + off, y + off, size, size, '#101640', { screen: true });
    }
  }
}

function drawBanner(r: Renderer, label: string): void {
  const w = r.measureText(label) + 28;
  const x = Math.round(r.width / 2 - w / 2);
  drawFrame(r, x, 6, w, 20, UI.fillLight);
  outlineText(r, label, r.width / 2, 12, UI.gold, { align: 'center' });
}

function drawHint(r: Renderer, text: string): void {
  outlineText(r, text, r.width / 2, 210, UI.dim, { align: 'center' });
}
