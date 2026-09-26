// Pause screen: item grid (choose the Y item), quest status (hearts, pieces,
// crystals, passive items), dungeon map (with map/compass), Save / Save & Quit.
// OWNER: triggers+UI agent.
//
// Opens with a quick slide-down under the HUD (which stays visible on top).
// Items page: the cursor moves over owned items only and equips as it moves
// (A/Y confirm); pressing down past the grid reaches SAVE / SAVE & QUIT / SOUND /
// RESUME, which only A/Y confirm. A playtest never writes a save, so there the
// options are QUIT / SOUND / RESUME. SOUND opens a small panel in the options
// window: MUSIC and SFX volume levels (left/right; kept per browser, see
// soundPrefs.ts) and BACK (B also goes back). L or R flip between the items and
// map pages, and so does Select - except in a menu opened on the map with
// Select, where Select closes it again (a map toggle). Start and B close the menu.
import type { ItemId } from '../../core/types';
import type { GameServices, InputState, Renderer } from '../api';
import { EQUIPPABLE_ITEMS } from '../../core/types';
import { ITEM_INFO } from '../../content/ids';
import { wrapText } from '../../gfx/font';
import { ownedEquippables } from '../state';
import { SOUND_LEVELS, type SoundPrefs, applySoundPrefs, loadSoundPrefs, saveSoundPrefs } from '../soundPrefs';
import { drawHud } from './hud';
import { MAP_FRAME, MapPage } from './pauseMap';
import {
  CENTER, RIGHT, SCREEN, UI, drawFrame, drawHeartPieces, drawHearts, drawItem, drawPointer, drawTitlePlate, formatTime, keyLabel,
  outlineText,
} from './theme';

export type PauseResult = 'none' | 'resume' | 'save' | 'saveQuit';

type Page = 'items' | 'map';
type OptionResult = 'save' | 'saveQuit' | 'sound' | 'resume';

export interface PauseMenuOptions {
  /** Whether saving writes a save file (false in playtest: no SAVE option, SAVE & QUIT reads QUIT). */
  persists?: boolean;
}

const SLIDE_TIME = 0.18;
const SAVED_TOAST = 1.6;
const GRID_COLS = 3;
/** Option labels and what picking them does, with and without save files. */
const PLAY_OPTIONS: readonly (readonly [string, OptionResult])[] = [
  ['SAVE', 'save'], ['SAVE & QUIT', 'saveQuit'], ['SOUND', 'sound'], ['RESUME', 'resume'],
];
const PLAYTEST_OPTIONS: readonly (readonly [string, OptionResult])[] = [
  ['QUIT', 'saveQuit'], ['SOUND', 'sound'], ['RESUME', 'resume'],
];
/** Rows of the SOUND panel. */
const SOUND_ROWS = ['MUSIC', 'SFX', 'BACK'] as const;
const BACK_ROW = SOUND_ROWS.length - 1;
const PASSIVES: readonly ItemId[] = ['sword', 'shield', 'boots', 'glove', 'flippers'];

const ITEMS_FRAME = { x: 8, y: 46, w: 128, h: 84 } as const;
const GEAR_FRAME = { x: 140, y: 46, w: 108, h: 84 } as const;
/** Gear labels start this far into the frame and keep this clear of its right edge (px). */
const GEAR_TEXT_X = 28;
const GEAR_TEXT_PAD = 5;
const INFO_FRAME = { x: 8, y: 136, w: 240, h: 30 } as const;
const STATUS_FRAME = { x: 8, y: 170, w: 156, h: 42 } as const;
const OPTIONS_FRAME = { x: 168, y: 170, w: 80, h: 42 } as const;
/** Text rows of the options window: [first row y offset, pitch] for 3 rows and for 4 (tighter). */
const ROWS_3 = [7, 11] as const;
const ROWS_4 = [4, 9] as const;
/** Volume bars of the SOUND panel: left edge offset in the window, bar width and pitch (px). */
const BARS = { x: 48, w: 3, pitch: 5 } as const;
const CELL = { x0: 32, y0: 72, pitchX: 36, pitchY: 30, size: 24 } as const;
/** Corner directions of the item cursor brackets. */
const CORNERS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const PASSIVE_MISSING = { screen: true, alpha: 0.15 } as const;
const NO_CRYSTAL = { screen: true, alpha: 0.3 } as const;
const NO_ITEMS = 'No items to equip yet.';
const CHOOSE_ITEM = `Choose an item for the ${keyLabel('y')} button.`;

const FLIP_KEYS = `${keyLabel('l')}/${keyLabel('r')}`;
const ITEMS_HINT = `${FLIP_KEYS} OR ${keyLabel('select')}: MAP   ${keyLabel('start')}: CLOSE`;
/** Items page of a menu opened with Select (which then closes it instead of flipping pages). */
const ITEMS_HINT_MAP_TOGGLE = `${FLIP_KEYS}: MAP   ${keyLabel('select')}: CLOSE`;

export class PauseMenu {
  private readonly game: GameServices;
  private readonly map: MapPage;
  private readonly options: readonly (readonly [string, OptionResult])[];
  private isOpen = false;
  private page: Page = 'items';
  /** Opened on the map with Select: Select closes it again. */
  private mapToggle = false;
  private mapHint = '';
  private t = 0;
  /** Index into EQUIPPABLE_ITEMS under the cursor. */
  private cell = 0;
  /** Options focus: index into `options`, or -1 while the item grid has focus. */
  private option = -1;
  /** SOUND panel row under the cursor, or -1 while the panel is closed. */
  private soundRow = -1;
  private sound: SoundPrefs = { music: SOUND_LEVELS, sfx: SOUND_LEVELS, muted: false };
  private toast = 0;
  /** Owned equippable items, read on open (nothing can give or take items while the game is paused). */
  private owned: ItemId[] = [];

  constructor(game: GameServices, opts: PauseMenuOptions = {}) {
    this.game = game;
    this.map = new MapPage(game);
    this.options = opts.persists === false ? PLAYTEST_OPTIONS : PLAY_OPTIONS;
  }

  get active(): boolean {
    return this.isOpen;
  }

  /** Open on the item screen ('items') or directly on the map ('map'). */
  open(page: 'items' | 'map' = 'items'): void {
    this.isOpen = true;
    this.mapToggle = page === 'map';
    this.t = 0;
    this.toast = 0;
    this.option = -1;
    this.soundRow = -1;
    this.owned = ownedEquippables(this.game.save);
    const owned = this.owned;
    const equipped = this.game.save.equipped;
    const start = equipped && owned.includes(equipped) ? equipped : owned[0];
    this.cell = start ? EQUIPPABLE_ITEMS.indexOf(start) : 0;
    if (!start) this.option = this.options.length - 1;
    this.showPage(page);
    this.game.audio.sfx('menuOpen');
  }

  update(dt: number, input: InputState): PauseResult {
    if (!this.isOpen) return 'resume';
    this.t += dt;
    this.toast = Math.max(0, this.toast - dt);
    if (this.page === 'items' && this.soundRow >= 0 && input.pressed('b')) {
      this.closeSound();
      return 'none';
    }
    if (input.pressed('start') || input.pressed('b') || (this.mapToggle && input.pressed('select'))) return this.close();
    if (input.pressed('l') || input.pressed('r') || input.pressed('select')) {
      this.showPage(this.page === 'items' ? 'map' : 'items');
      this.game.audio.sfx('menuMove');
      return 'none';
    }
    return this.page === 'items' ? this.updateItems(input) : this.updateMap(input);
  }

  draw(r: Renderer): void {
    if (!this.isOpen) return;
    const k = Math.min(1, this.t / SLIDE_TIME);
    r.overlay('#000010', 0.55 * k);
    const ctx = r.ctx;
    ctx.save();
    ctx.translate(0, -Math.round((1 - k) * (1 - k) * 190));
    if (this.page === 'items') this.drawItemsPage(r);
    else {
      this.map.draw(r, r.time);
      hint(r, this.mapHint);
    }
    ctx.restore();
    drawHud(r, this.game);
  }

  // ------------------------------------------------------------------ input

  private close(): PauseResult {
    this.isOpen = false;
    this.game.audio.sfx('menuClose');
    return 'resume';
  }

  private showPage(page: Page): void {
    this.page = page;
    if (page !== 'map') return;
    this.map.refresh();
    this.mapHint = this.map.hint(keyLabel(this.mapToggle ? 'select' : 'start'));
  }

  private updateMap(input: InputState): PauseResult {
    const step = (input.pressed('up') ? 1 : 0) - (input.pressed('down') ? 1 : 0);
    if (step !== 0 && this.map.changeFloor(step)) this.game.audio.sfx('menuMove');
    return 'none';
  }

  private updateItems(input: InputState): PauseResult {
    if (this.soundRow >= 0) return this.updateSound(input);
    if (this.option >= 0) return this.updateOptions(input);
    const owned = this.owned;
    if (input.pressed('left') || input.pressed('right')) {
      this.cycle(owned, input.pressed('right') ? 1 : -1);
    } else if (input.pressed('down')) {
      if (!this.moveRow(owned, 1)) this.focusOptions();
    } else if (input.pressed('up')) {
      this.moveRow(owned, -1);
    } else if (input.pressed('a') || input.pressed('y')) {
      this.equip(this.cellItem(), 'menuSelect');
    }
    return 'none';
  }

  private updateOptions(input: InputState): PauseResult {
    const g = this.game;
    const n = this.options.length;
    if (input.pressed('up')) {
      if (this.option === 0 && this.owned.length > 0) this.option = -1;
      else this.option = (this.option + n - 1) % n;
      g.audio.sfx('menuMove');
      return 'none';
    }
    if (input.pressed('down')) {
      this.option = (this.option + 1) % n;
      g.audio.sfx('menuMove');
      return 'none';
    }
    if (!input.pressed('a') && !input.pressed('y')) return 'none';
    const result = this.options[this.option]![1];
    if (result === 'resume') return this.close();
    g.audio.sfx('menuSelect');
    if (result === 'sound') {
      this.openSound();
      return 'none';
    }
    if (result === 'save') this.toast = SAVED_TOAST;
    return result;
  }

  private openSound(): void {
    this.sound = loadSoundPrefs();
    this.soundRow = 0;
    this.toast = 0;
  }

  private closeSound(): void {
    this.soundRow = -1;
    this.game.audio.sfx('menuClose');
  }

  /** SOUND panel: up/down pick a row, left/right change its level (heard at once), A/Y on BACK returns. */
  private updateSound(input: InputState): PauseResult {
    const g = this.game;
    const n = SOUND_ROWS.length;
    if (input.pressed('up') || input.pressed('down')) {
      this.soundRow = (this.soundRow + (input.pressed('down') ? 1 : n - 1)) % n;
      g.audio.sfx('menuMove');
      return 'none';
    }
    const step = (input.pressed('right') ? 1 : 0) - (input.pressed('left') ? 1 : 0);
    const key = this.soundRow === 0 ? 'music' : this.soundRow === 1 ? 'sfx' : null;
    if (step !== 0 && key) {
      const next = Math.min(SOUND_LEVELS, Math.max(0, this.sound[key] + step));
      if (next !== this.sound[key] || this.sound.muted) {
        // Changing a level also switches a mute (set from the menu hub / playtest bar toggle) off, so it is heard.
        this.sound = { ...this.sound, [key]: next, muted: false };
        applySoundPrefs(g.audio, this.sound);
        saveSoundPrefs(this.sound);
      }
      // After the change, so the effects row plays its tick at the new volume.
      g.audio.sfx('menuMove');
      return 'none';
    }
    if (this.soundRow === BACK_ROW && (input.pressed('a') || input.pressed('y'))) this.closeSound();
    return 'none';
  }

  private focusOptions(): void {
    this.option = 0;
    this.game.audio.sfx('menuMove');
  }

  private cellItem(): ItemId | undefined {
    return EQUIPPABLE_ITEMS[this.cell];
  }

  /** Next/previous owned item in grid order (wrapping). */
  private cycle(owned: readonly ItemId[], step: number): void {
    if (owned.length === 0) return;
    const n = EQUIPPABLE_ITEMS.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.cell + step * i + n * 2) % n;
      if (owned.includes(EQUIPPABLE_ITEMS[idx]!)) {
        this.cell = idx;
        this.equip(EQUIPPABLE_ITEMS[idx], 'menuMove');
        return;
      }
    }
  }

  /** Move to the nearest owned item one row up/down; false if there is none. */
  private moveRow(owned: readonly ItemId[], step: number): boolean {
    const col = this.cell % GRID_COLS;
    const row = Math.floor(this.cell / GRID_COLS) + step;
    const candidates = EQUIPPABLE_ITEMS
      .map((item, i) => ({ item, i }))
      .filter(({ item, i }) => Math.floor(i / GRID_COLS) === row && owned.includes(item))
      .sort((a, b) => Math.abs((a.i % GRID_COLS) - col) - Math.abs((b.i % GRID_COLS) - col));
    const best = candidates[0];
    if (!best) return false;
    this.cell = best.i;
    this.equip(best.item, 'menuMove');
    return true;
  }

  private equip(item: ItemId | undefined, sound: 'menuMove' | 'menuSelect'): void {
    if (!item || !this.owned.includes(item)) return;
    this.game.save.equipped = item;
    this.game.audio.sfx(sound);
  }

  // ------------------------------------------------------------------ drawing

  private drawItemsPage(r: Renderer): void {
    this.drawItemGrid(r);
    this.drawGear(r);
    this.drawInfo(r);
    this.drawStatus(r);
    this.drawOptions(r);
    hint(r, this.mapToggle ? ITEMS_HINT_MAP_TOGGLE : ITEMS_HINT);
  }

  private drawItemGrid(r: Renderer): void {
    const f = ITEMS_FRAME;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    drawTitlePlate(r, 'ITEMS', f.x + 14, f.y);
    const save = this.game.save;
    const owned = this.owned;
    const half = CELL.size / 2;
    for (let i = 0; i < EQUIPPABLE_ITEMS.length; i++) {
      const item = EQUIPPABLE_ITEMS[i]!;
      const cx = cellX(i);
      const cy = cellY(i);
      r.fillRect(cx - half, cy - half, CELL.size, CELL.size, UI.fill, SCREEN);
      r.strokeRect(cx - half, cy - half, CELL.size, CELL.size, UI.shade, SCREEN);
      if (!owned.includes(item)) continue;
      drawItem(r, save, item, cx, cy);
      const ammo = item === 'bow' ? save.arrows : item === 'bombs' ? save.bombs : null;
      if (ammo !== null) outlineText(r, String(ammo), cx + half + 1, cy + 5, ammo > 0 ? UI.text : UI.red, RIGHT);
    }
    if (this.option < 0 && owned.length > 0) drawCellCursor(r, cellX(this.cell), cellY(this.cell), this.t);
  }

  private drawGear(r: Renderer): void {
    const f = GEAR_FRAME;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    drawTitlePlate(r, 'GEAR', f.x + 8, f.y);
    const save = this.game.save;
    PASSIVES.forEach((item, i) => {
      const cy = f.y + 17 + i * 14;
      const level = save.items[item] ?? 0;
      const name = ITEM_INFO[item].name;
      const withLevel = level >= 2 ? `${name} L${level}` : name;
      // A long name keeps the frame: its level goes on the icon instead (like the ammo counts).
      const fits = r.measureText(withLevel) <= f.w - GEAR_TEXT_X - GEAR_TEXT_PAD;
      if (level > 0) drawItem(r, save, item, f.x + 16, cy);
      else r.drawSpriteAnim('item', ITEM_INFO[item].icon, 0, f.x + 16, cy, PASSIVE_MISSING);
      outlineText(r, level > 0 ? (fits ? withLevel : name) : '- - -', f.x + GEAR_TEXT_X, cy - 4, level > 0 ? UI.text : UI.shade);
      if (level >= 2 && !fits) outlineText(r, String(level), f.x + 24, cy + 1, UI.gold, RIGHT);
    });
  }

  private drawInfo(r: Renderer): void {
    const f = INFO_FRAME;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    const owned = this.owned;
    const item = this.option < 0 ? this.cellItem() : this.game.save.equipped ?? undefined;
    if (!item || !owned.includes(item)) {
      outlineText(r, owned.length === 0 ? NO_ITEMS : CHOOSE_ITEM, f.x + 10, f.y + 11, UI.dim);
      return;
    }
    drawTitlePlate(r, ITEM_INFO[item].name, f.x + 8, f.y);
    const lines = descriptionLines(item);
    for (let i = 0; i < lines.length; i++) outlineText(r, lines[i]!, f.x + 10, f.y + 7 + i * 10, UI.text);
  }

  private drawStatus(r: Renderer): void {
    const f = STATUS_FRAME;
    const save = this.game.save;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    drawHearts(r, f.x + 8, f.y + 6, save.hp, save.maxHp);
    drawHeartPieces(r, f.x + 94, f.y + 23, save.heartPieces);
    r.drawSpriteAnim('item', 'crystal', 0, f.x + 124, f.y + 29, save.crystals > 0 ? SCREEN : NO_CRYSTAL);
    outlineText(r, `x${save.crystals}`, f.x + 133, f.y + 26, save.crystals > 0 ? UI.text : UI.dim);
    outlineText(r, 'TIME', f.x + 8, f.y + 27, UI.mid);
    outlineText(r, formatTime(save.playTime), f.x + 36, f.y + 27, UI.text);
  }

  private drawOptions(r: Renderer): void {
    const f = OPTIONS_FRAME;
    drawFrame(r, f.x, f.y, f.w, f.h, UI.fillDeep);
    if (this.toast > 0) {
      outlineText(r, 'SAVED!', f.x + f.w / 2, f.y + 17, UI.green, CENTER);
      return;
    }
    if (this.soundRow >= 0) {
      this.drawSound(r);
      return;
    }
    const [first, pitch] = this.options.length > 3 ? ROWS_4 : ROWS_3;
    for (let i = 0; i < this.options.length; i++) {
      this.drawRow(r, this.options[i]![0], f.y + first + i * pitch, i === this.option);
    }
  }

  private drawSound(r: Renderer): void {
    const f = OPTIONS_FRAME;
    const [first, pitch] = ROWS_3;
    for (let i = 0; i < SOUND_ROWS.length; i++) {
      const y = f.y + first + i * pitch;
      const selected = i === this.soundRow;
      this.drawRow(r, SOUND_ROWS[i]!, y, selected);
      if (i < BACK_ROW) drawLevel(r, f.x + BARS.x, y, i === 0 ? this.sound.music : this.sound.sfx, selected);
    }
  }

  private drawRow(r: Renderer, label: string, y: number, selected: boolean): void {
    const f = OPTIONS_FRAME;
    outlineText(r, label, f.x + 16, y, selected ? UI.gold : UI.text);
    if (selected) drawPointer(r, f.x + 6 + (Math.floor(this.t * 4) % 2), y, UI.gold);
  }
}

/** Screen x (cellX) and y (cellY) of the centre of item cell `i`. */
function cellX(i: number): number {
  return CELL.x0 + (i % GRID_COLS) * CELL.pitchX;
}

function cellY(i: number): number {
  return CELL.y0 + Math.floor(i / GRID_COLS) * CELL.pitchY;
}

/** An item's description wrapped to the info window (at most 2 lines), cached per item. */
const descriptions = new Map<ItemId, readonly string[]>();

function descriptionLines(item: ItemId): readonly string[] {
  let lines = descriptions.get(item);
  if (!lines) {
    lines = wrapText(ITEM_INFO[item].description, INFO_FRAME.w - 20).slice(0, 2);
    descriptions.set(item, lines);
  }
  return lines;
}

/** A volume level as SOUND_LEVELS rising bars (filled up to `level`), bottoms on the text baseline at `y`. */
function drawLevel(r: Renderer, x: number, y: number, level: number, selected: boolean): void {
  const on = selected ? UI.gold : UI.text;
  for (let i = 0; i < SOUND_LEVELS; i++) {
    const h = 2 + i * 2;
    const bx = x + i * BARS.pitch;
    const by = y + 7 - h;
    r.fillRect(bx - 1, by - 1, BARS.w + 2, h + 2, UI.outline, SCREEN);
    r.fillRect(bx, by, BARS.w, h, i < level ? on : UI.shade, SCREEN);
  }
}

/** Blinking gold corner brackets around an item cell. */
function drawCellCursor(r: Renderer, cx: number, cy: number, t: number): void {
  const o = SCREEN;
  const half = CELL.size / 2 + 2 + (Math.floor(t * 4) % 2);
  const color = UI.gold;
  const len = 6;
  for (const [sx, sy] of CORNERS) {
    const x = sx < 0 ? cx - half : cx + half - 1;
    const y = sy < 0 ? cy - half : cy + half - 1;
    const hx = sx < 0 ? x : x - len + 1;
    const vy = sy < 0 ? y : y - len + 1;
    r.fillRect(hx - 1, y - 1, len + 2, 3, UI.outline, o);
    r.fillRect(x - 1, vy - 1, 3, len + 2, UI.outline, o);
    r.fillRect(hx, y, len, 1, color, o);
    r.fillRect(x, vy, 1, len, color, o);
  }
}

function hint(r: Renderer, text: string): void {
  outlineText(r, text, r.width - 10, MAP_FRAME.y + MAP_FRAME.h + 3, UI.dim, RIGHT);
}
