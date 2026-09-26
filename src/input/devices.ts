// Which input device the player is using right now (keyboard or a gamepad, and
// which gamepad family), how to name its buttons on screen, controller
// preferences (vibration, swapped face buttons) and rumble. Shared by the game
// (hints, dialogue {btn:x} tokens, rumble), the menu hub and the editor.
//
// The "current device" is whichever was used last: Input.handleKeyDown calls
// noteKeyboard(), Input.pollPads (and the menu's own pad polling) call notePad().
// trackDevices() adds global listeners so DOM views notice keyboard use and pads
// being plugged in or out even when no game is running.
//
// Face buttons are named by POSITION (the game uses SNES positions: bottom =
// sword 'b', right = action 'a', left = item 'y', top = 'x'), so every family
// shows the glyph printed on the button the player must press. PlayStation
// shapes use private-use characters the bitmap font draws (PS_GLYPHS); DOM text
// asks for real Unicode shapes with { unicode: true }.
import type { Button } from '../game/api';
import { getSetting, setSetting } from '../core/storage';
import { CONTROL_HINTS, DEFAULT_KEYMAP } from './input';

export type InputDevice = 'keyboard' | 'gamepad';
export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export interface ControlsInfo {
  readonly device: InputDevice;
  /** Family of the last-used pad ('generic' until one is used). */
  readonly family: PadFamily;
  /** Short display name of the last-used pad, e.g. "Xbox Wireless Controller". */
  readonly padName: string | null;
  /** navigator.getGamepads() index of the last-used pad. */
  readonly padIndex: number | null;
}

/** Private-use characters the bitmap font renders as PlayStation button shapes. */
export const PS_GLYPHS = { cross: '', circle: '', square: '', triangle: '' } as const;
const PS_UNICODE: Readonly<Record<string, string>> = {
  [PS_GLYPHS.cross]: '✕', [PS_GLYPHS.circle]: '○', [PS_GLYPHS.square]: '□', [PS_GLYPHS.triangle]: '△',
};

type Face = 'bottom' | 'right' | 'left' | 'top';

const FACE_LABELS: Readonly<Record<PadFamily, Readonly<Record<Face, string>>>> = {
  xbox: { bottom: 'A', right: 'B', left: 'X', top: 'Y' },
  generic: { bottom: 'A', right: 'B', left: 'X', top: 'Y' },
  nintendo: { bottom: 'B', right: 'A', left: 'Y', top: 'X' },
  playstation: { bottom: PS_GLYPHS.cross, right: PS_GLYPHS.circle, left: PS_GLYPHS.square, top: PS_GLYPHS.triangle },
};

const OTHER_LABELS: Readonly<Record<PadFamily, Readonly<Partial<Record<Button, string>>>>> = {
  xbox: { l: 'LB', r: 'RB', start: 'MENU', select: 'VIEW' },
  generic: { l: 'LB', r: 'RB', start: 'START', select: 'SELECT' },
  nintendo: { l: 'L', r: 'R', start: '+', select: '-' },
  playstation: { l: 'L1', r: 'R1', start: 'OPTIONS', select: 'CREATE' },
};

const DPAD_LABELS: Readonly<Partial<Record<Button, string>>> = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

// ---------------------------------------------------------------- preferences

export interface ControllerPrefs {
  /** Rumble on hits, explosions and big moments (pads that support it). */
  vibration: boolean;
  /** Swap the bottom and right face buttons (bottom = action/confirm, right = sword/back). */
  swapFaceButtons: boolean;
}

/** Storage setting holding ControllerPrefs. */
export const CONTROLLER_SETTING = 'controller';
const DEFAULT_PREFS: ControllerPrefs = { vibration: true, swapFaceButtons: false };

function cleanPrefs(v: unknown): ControllerPrefs {
  const o = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    vibration: typeof o.vibration === 'boolean' ? o.vibration : DEFAULT_PREFS.vibration,
    swapFaceButtons: typeof o.swapFaceButtons === 'boolean' ? o.swapFaceButtons : DEFAULT_PREFS.swapFaceButtons,
  };
}

let prefs: ControllerPrefs | null = null;

/** Current controller preferences (read once from storage, then cached). */
export function controllerPrefs(): ControllerPrefs {
  return (prefs ??= cleanPrefs(getSetting<unknown>(CONTROLLER_SETTING, null)));
}

/** Change and persist controller preferences; notifies onControlsChange listeners (labels may change). */
export function setControllerPrefs(change: Partial<ControllerPrefs>): ControllerPrefs {
  prefs = cleanPrefs({ ...controllerPrefs(), ...change });
  setSetting(CONTROLLER_SETTING, prefs);
  emit();
  return prefs;
}

// ---------------------------------------------------------------- current device

let info: ControlsInfo = { device: 'keyboard', family: 'generic', padName: null, padIndex: null };
const listeners = new Set<(i: ControlsInfo) => void>();

function emit(): void {
  for (const fn of [...listeners]) fn(info);
}

function set(next: ControlsInfo): void {
  info = next;
  emit();
}

/** The device used most recently. */
export function currentControls(): ControlsInfo {
  return info;
}

/** Called when the current device, pad or controller prefs change. Returns an unsubscribe function. */
export function onControlsChange(fn: (i: ControlsInfo) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Classify a Gamepad.id string. */
export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense|\bps[345]\b/.test(s)) return 'playstation';
  if (/057e|nintendo|switch|pro controller|joy-?con/.test(s)) return 'nintendo';
  if (/045e|xbox|xinput|microsoft/.test(s)) return 'xbox';
  return 'generic';
}

/** Readable pad name: drops the "(STANDARD GAMEPAD Vendor: ... Product: ...)" suffix browsers append. */
export function padDisplayName(id: string): string {
  const name = id.replace(/\s*\((?:standard gamepad|vendor|.*vendor:).*\)\s*$/i, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
  return (name || 'Controller').slice(0, 48);
}

/** A mapped keyboard key was used. */
export function noteKeyboard(): void {
  if (info.device !== 'keyboard') set({ ...info, device: 'keyboard' });
}

/** A pad was used (a button pressed or the stick pushed). */
export function notePad(index: number, id: string): void {
  if (info.device === 'gamepad' && info.padIndex === index && info.padName === padDisplayName(id)) return;
  set({ device: 'gamepad', family: padFamily(id), padName: padDisplayName(id), padIndex: index });
}

export interface PadConnection {
  connected: boolean;
  index: number;
  name: string;
  family: PadFamily;
  /** A disconnection of the pad that was the device in use (the device is now the keyboard). */
  wasInUse: boolean;
}

const connectionListeners = new Set<(e: PadConnection) => void>();

/** Called when a pad is plugged in or out (needs trackDevices()). Returns an unsubscribe function. */
export function onPadConnection(fn: (e: PadConnection) => void): () => void {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

let tracking = false;

/** Install the global listeners (idempotent): keyboard use and pad connect/disconnect events. */
export function trackDevices(win: Window = window): void {
  if (tracking || typeof win === 'undefined') return;
  tracking = true;
  win.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) noteKeyboard();
  }, true);
  const onPad = (connected: boolean) => (e: Event): void => {
    const pad = (e as GamepadEvent).gamepad;
    if (!pad) return;
    const wasInUse = !connected && info.device === 'gamepad' && info.padIndex === pad.index;
    const ev: PadConnection = { connected, index: pad.index, name: padDisplayName(pad.id), family: padFamily(pad.id), wasInUse };
    if (wasInUse) set({ ...info, device: 'keyboard', padIndex: null });
    for (const fn of [...connectionListeners]) fn(ev);
  };
  win.addEventListener('gamepadconnected', onPad(true));
  win.addEventListener('gamepaddisconnected', onPad(false));
}

/** Connected pads right now. */
export function connectedPads(): { index: number; name: string; family: PadFamily }[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected)
      .map((p) => ({ index: p.index, name: padDisplayName(p.id), family: padFamily(p.id) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- labels

export interface LabelOpts {
  /** Label for this device state instead of the current one. */
  info?: ControlsInfo;
  /** DOM text: real Unicode shapes instead of the bitmap font's private-use glyphs. */
  unicode?: boolean;
}

/** Which physical face button produces a game button (honours swapFaceButtons). */
export function faceOf(b: Button, swap = controllerPrefs().swapFaceButtons): Face | null {
  switch (b) {
    case 'b': return swap ? 'right' : 'bottom';
    case 'a': return swap ? 'bottom' : 'right';
    case 'y': return 'left';
    case 'x': return 'top';
    default: return null;
  }
}

function keyboardLabel(b: Button): string {
  const hint = (CONTROL_HINTS as Partial<Record<Button, string>>)[b];
  if (hint) return hint.toUpperCase();
  const code = Object.keys(DEFAULT_KEYMAP).find((k) => DEFAULT_KEYMAP[k] === b) ?? b;
  return code.replace(/^(Key|Arrow)/, '').toUpperCase();
}

/** On-screen name of a game button for the current (or given) device: 'Z' / 'A' / PS cross / 'MENU' ... */
export function buttonLabel(b: Button, opts: LabelOpts = {}): string {
  const i = opts.info ?? info;
  let label: string;
  if (i.device === 'keyboard') label = keyboardLabel(b);
  else {
    const face = faceOf(b);
    label = face ? FACE_LABELS[i.family][face] : OTHER_LABELS[i.family][b] ?? DPAD_LABELS[b] ?? b.toUpperCase();
  }
  return opts.unicode ? label.replace(/[-]/g, (c) => PS_UNICODE[c] ?? c) : label;
}

/** Button name inside a sentence: short labels stay as-is ('Z', 'A', '+'), words are capitalised ('Enter', 'Menu'). */
export function buttonWord(b: Button, opts: LabelOpts = {}): string {
  const label = buttonLabel(b, opts);
  return label.length <= 2 ? label : label[0] + label.slice(1).toLowerCase();
}

/** How to describe movement: 'ARROWS' on a keyboard, 'D-PAD' / stick on a pad. */
export function moveLabel(opts: LabelOpts = {}): string {
  return (opts.info ?? info).device === 'keyboard' ? 'ARROWS' : 'D-PAD';
}

/** Movement inside a sentence, like buttonWord(): 'arrow keys' on a keyboard, 'D-pad' on a pad. */
export function moveWord(opts: LabelOpts = {}): string {
  return (opts.info ?? info).device === 'keyboard' ? 'arrow keys' : 'D-pad';
}

/**
 * Replace {btn:<button>} tokens (b, a, y, x, l, r, start, select, up, down, left, right) and
 * {btn:move} with the current device's labels, as words (buttonWord / moveWord). Unknown
 * tokens are left as written.
 */
export function substituteButtons(text: string, opts: LabelOpts = {}): string {
  return text.replace(/\{btn:([a-z]+)\}/gi, (whole, name: string) => {
    const n = name.toLowerCase();
    if (n === 'move') return moveWord(opts);
    return BUTTON_SET.has(n) ? buttonWord(n as Button, opts) : whole;
  });
}

const BUTTON_SET = new Set<string>(['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select']);

// ---------------------------------------------------------------- rumble

export type RumbleKind = 'tap' | 'hit' | 'heavy';

const RUMBLE: Readonly<Record<RumbleKind, { duration: number; strong: number; weak: number }>> = {
  tap: { duration: 60, strong: 0, weak: 0.45 },
  hit: { duration: 150, strong: 0.55, weak: 0.4 },
  heavy: { duration: 340, strong: 1, weak: 0.7 },
};

interface Actuator {
  playEffect?(type: string, params: Record<string, number>): Promise<unknown> | undefined;
}

/** Rumble the last-used pad (no-op on keyboard, without support, or with vibration turned off). */
export function rumble(kind: RumbleKind): void {
  if (!controllerPrefs().vibration || info.device !== 'gamepad' || info.padIndex === null) return;
  try {
    const pad = navigator.getGamepads?.()[info.padIndex] as (Gamepad & { vibrationActuator?: Actuator }) | null | undefined;
    const fx = RUMBLE[kind];
    const p = pad?.vibrationActuator?.playEffect?.('dual-rumble', {
      startDelay: 0, duration: fx.duration, strongMagnitude: fx.strong, weakMagnitude: fx.weak,
    });
    p?.catch?.(() => undefined);
  } catch {
    // Rumble is a nicety: never let it break the game.
  }
}
