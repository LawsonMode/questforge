// CONTROLS page of the pause menu (a third page beside ITEMS and MAP, flipped
// to with L/R): the device in use (the keyboard, or the gamepad the browser
// names), what every button does on that device (key caps with its labels -
// PlayStation shapes are font glyphs) and the controller options, kept per
// browser (input/devices.ts controllerPrefs): VIBRATION on/off and SWAP, which
// trades the bottom and right face buttons (sword <-> action). Up/down pick an
// option; A/Y or left/right flip it. Everything follows a device switch at once.
// A swap changes what the button that flipped it means while it is still held,
// so the menu waits for A and B to be let go before it reads buttons again
// (holding()). OWNER: triggers+UI agent.
import type { AudioApi, Button, InputState, Renderer } from '../api';
import { measureText, wrapText } from '../../gfx/font';
import {
  type ControlsInfo, buttonLabel, connectedPads, controllerPrefs, currentControls, moveLabel, rumble, setControllerPrefs,
} from '../../input/devices';
import { MAP_FRAME } from './pauseMap';
import { SCREEN, UI, drawFrame, drawKeyCap, drawPointer, drawTitlePlate, outlineText } from './theme';

type Option = 'vibration' | 'swap';
const OPTIONS: readonly Option[] = ['vibration', 'swap'];
/** Buttons that flip the selected option. */
const FLIP_BUTTONS: readonly Button[] = ['a', 'y', 'left', 'right'];

/** A reference row: what the player does, and the button(s) doing it ('move' = the d-pad / arrows). */
type Reference = readonly [string, Button | 'move' | 'pages'];
const LEFT_COLUMN: readonly Reference[] = [['MOVE', 'move'], ['SWORD', 'b'], ['ACTION', 'a'], ['ITEM', 'y']];
const RIGHT_COLUMN: readonly Reference[] = [['MENU', 'start'], ['MAP', 'select'], ['PAGES', 'pages']];

const F = MAP_FRAME;
/** Layout inside the frame (screen px). */
const DEVICE_Y = F.y + 12;
const DETAIL_Y = F.y + 23;
const VALUE_X = F.x + 64;
const RULES = [F.y + 36, F.y + 103] as const;
const REF_Y = F.y + 45;
const REF_PITCH = 14;
const COLUMNS = [{ label: F.x + 14, cap: F.x + 62 }, { label: F.x + 128, cap: F.x + 168 }] as const;
const OPTION_Y = F.y + 112;
const OPTION_PITCH = 14;
const OPTION_LABEL_X = F.x + 26;
const ON_X = F.x + 150;
const OFF_X = F.x + 176;
const NOTE_Y = F.y + 142;
const TEXT_W = F.w - 28;

const VIBRATION_NOTE = 'The gamepad rumbles when you are hurt, when bombs go off and at big moments.';
const KEYBOARD_NOTE = 'You are playing with the keyboard: these options take effect on a gamepad.';

export class ControlsPage {
  private readonly audio: AudioApi;
  private row = 0;
  /** A swap was just made: A/B still held mean something else now (see holding()). */
  private latched = false;

  constructor(audio: AudioApi) {
    this.audio = audio;
  }

  /** Back on the first option (called when the menu opens). */
  reset(): void {
    this.row = 0;
    this.latched = false;
  }

  /** True while the button that flipped SWAP is still down: the menu reads no buttons meanwhile. */
  holding(input: InputState): boolean {
    if (!this.latched) return false;
    if (input.held('a') || input.held('b')) return true;
    this.latched = false;
    return false;
  }

  update(input: InputState): void {
    const n = OPTIONS.length;
    if (input.pressed('up') || input.pressed('down')) {
      this.row = (this.row + (input.pressed('down') ? 1 : n - 1)) % n;
      this.audio.sfx('menuMove');
      return;
    }
    if (FLIP_BUTTONS.some((b) => input.pressed(b))) this.flip(OPTIONS[this.row]!);
  }

  private flip(option: Option): void {
    const prefs = controllerPrefs();
    if (option === 'vibration') {
      setControllerPrefs({ vibration: !prefs.vibration });
      // A little buzz to show it is back on (only reaches a gamepad in use).
      if (!prefs.vibration) rumble('tap');
    } else {
      setControllerPrefs({ swapFaceButtons: !prefs.swapFaceButtons });
      this.latched = true;
    }
    this.audio.sfx('menuSelect');
  }

  draw(r: Renderer, time: number): void {
    drawFrame(r, F.x, F.y, F.w, F.h, UI.fillDeep);
    drawTitlePlate(r, 'CONTROLS', F.x + 14, F.y);
    const info = currentControls();
    const pad = info.device === 'gamepad';
    outlineText(r, 'DEVICE', F.x + 14, DEVICE_Y, UI.mid);
    outlineText(r, pad ? 'GAMEPAD' : 'KEYBOARD', VALUE_X, DEVICE_Y, UI.gold);
    outlineText(r, clip(this.detail(info), F.x + F.w - 10 - VALUE_X), VALUE_X, DETAIL_Y, UI.text);
    for (const y of RULES) r.fillRect(F.x + 10, y, F.w - 20, 1, UI.shade, SCREEN);
    LEFT_COLUMN.forEach((ref, i) => drawReference(r, ref, COLUMNS[0], REF_Y + i * REF_PITCH));
    RIGHT_COLUMN.forEach((ref, i) => drawReference(r, ref, COLUMNS[1], REF_Y + i * REF_PITCH));
    this.drawOptions(r, info, time);
    const note = noteLines(pad ? this.description(OPTIONS[this.row]!, info) : KEYBOARD_NOTE);
    for (let i = 0; i < note.length; i++) outlineText(r, note[i]!, F.x + 14, NOTE_Y + i * 10, UI.dim);
  }

  /** The pad's own name, or on the keyboard whether a gamepad is plugged in. */
  private detail(info: ControlsInfo): string {
    if (info.device === 'gamepad') return info.padName ?? 'Gamepad';
    const pads = connectedPads();
    return pads.length > 0 ? `Gamepad ready: ${pads[0]!.name}` : 'No gamepad connected';
  }

  private drawOptions(r: Renderer, info: ControlsInfo, time: number): void {
    const prefs = controllerPrefs();
    OPTIONS.forEach((option, i) => {
      const y = OPTION_Y + i * OPTION_PITCH;
      const selected = i === this.row;
      const on = option === 'vibration' ? prefs.vibration : prefs.swapFaceButtons;
      const label = option === 'vibration' ? 'VIBRATION' : `SWAP ${faces(info).join(' / ')}`;
      outlineText(r, label, OPTION_LABEL_X, y, selected ? UI.gold : UI.text);
      if (selected) drawPointer(r, F.x + 14 + (Math.floor(time * 4) % 2), y, UI.gold);
      const active = selected ? UI.gold : UI.text;
      outlineText(r, 'ON', ON_X, y, on ? active : UI.shade);
      outlineText(r, 'OFF', OFF_X, y, on ? UI.shade : active);
    });
  }

  private description(option: Option, info: ControlsInfo): string {
    if (option === 'vibration') return VIBRATION_NOTE;
    const pad = padInfo(info);
    const action = buttonLabel('a', { info: pad });
    const sword = buttonLabel('b', { info: pad });
    return `${action} is action and confirm, ${sword} swings the sword and goes back.`;
  }
}

/** The gamepad labels: the last pad used (its family), even while the keyboard is in use. */
function padInfo(info: ControlsInfo): ControlsInfo {
  return info.device === 'gamepad' ? info : { ...info, device: 'gamepad' };
}

/** Labels of the bottom and right face buttons (whichever game buttons they produce now). */
function faces(info: ControlsInfo): [string, string] {
  const pad = padInfo(info);
  const swapped = controllerPrefs().swapFaceButtons;
  return [buttonLabel(swapped ? 'a' : 'b', { info: pad }), buttonLabel(swapped ? 'b' : 'a', { info: pad })];
}

/** One reference row: the job, then its button(s) on key caps. */
function drawReference(r: Renderer, [job, what]: Reference, col: { label: number; cap: number }, y: number): void {
  outlineText(r, job, col.label, y, UI.mid);
  if (what === 'pages') {
    const w = drawKeyCap(r, buttonLabel('l'), col.cap, y);
    drawKeyCap(r, buttonLabel('r'), col.cap + w + 3, y);
  } else {
    drawKeyCap(r, what === 'move' ? moveLabel() : buttonLabel(what), col.cap, y);
  }
}

/** A note wrapped to the page (at most 2 lines), cached by its text (a handful of notes per device). */
const notes = new Map<string, readonly string[]>();

function noteLines(text: string): readonly string[] {
  let lines = notes.get(text);
  if (!lines) {
    if (notes.size >= 32) notes.clear();
    lines = wrapText(text, TEXT_W).slice(0, 2);
    notes.set(text, lines);
  }
  return lines;
}

/** `text` cut (with "..") to fit `maxWidth` px. */
function clip(text: string, maxWidth: number): string {
  if (measureText(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && measureText(`${s}..`) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}..`;
}

