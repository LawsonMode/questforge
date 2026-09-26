// Keyboard + gamepad -> abstract SNES buttons. OWNER: input/audio agent.
//
// Edge model: raw key/pad state is sampled once per tick in update(). A press
// that starts and ends between two updates is latched so it still reads as
// pressed (and held) for exactly one tick, then released on the next.
import type { Vec } from '../core/math';
import { FPS } from '../core/constants';
import { BUTTONS, type Button, type InputManager } from '../game/api';

/** KeyboardEvent.code -> Button. See the key map documented on Button in game/api.ts. */
export const DEFAULT_KEYMAP: Readonly<Record<string, Button>> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyZ: 'b', KeyJ: 'b',
  KeyX: 'a', KeyK: 'a', Space: 'a',
  KeyC: 'y', KeyL: 'y',
  Enter: 'start', Escape: 'start',
  ShiftLeft: 'select', ShiftRight: 'select', KeyM: 'select',
  KeyQ: 'l', KeyE: 'r',
};

/** Human-readable control hints for menus/HUD. */
export const CONTROL_HINTS: Readonly<Record<'b' | 'a' | 'y' | 'start' | 'select', string>> = {
  b: 'Z', a: 'X', y: 'C', start: 'Enter', select: 'Shift',
};

/** Standard-mapping gamepad button index -> Button. */
export const PAD_BUTTONS: Readonly<Record<number, Button>> = {
  0: 'b', 1: 'a', 2: 'y', 3: 'x', 4: 'l', 5: 'r', 8: 'select', 9: 'start',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

/** Radial left-stick deadzone: deflections beyond it read as one of 8 d-pad directions. */
export const STICK_DEADZONE = 0.5;
/** Angular width of each of the stick's 8 direction sectors. */
const STICK_SECTOR = Math.PI / 4;

/** The subset of KeyboardEvent the handlers read (lets tests pass plain objects). */
export interface KeyLike {
  code: string;
  key?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
  preventDefault?(): void;
  /** Used to tell AltGr (reported as Ctrl+Alt on Windows) from real shortcuts. */
  getModifierState?(key: string): boolean;
}

/** Minimal gamepad shape read by the poller (matches the Gamepad API). */
interface PadLike {
  connected: boolean;
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: readonly number[];
}

const COUNT = BUTTONS.length;
const INDEX = Object.fromEntries(BUTTONS.map((b, i) => [b, i])) as Record<Button, number>;
/** [pad button index, button slot] pairs, precomputed for polling. */
const PAD_SLOTS: ReadonlyArray<readonly [number, number]> =
  Object.entries(PAD_BUTTONS).map(([idx, b]) => [Number(idx), INDEX[b]] as const);

/** True for form fields / contenteditable, whose keys belong to the editor UI. */
function isEditable(target: EventTarget | null | undefined): boolean {
  if (!target) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** AltGr composes characters on international layouts; it is not a shortcut modifier. */
function isAltGr(e: KeyLike): boolean {
  return e.getModifierState?.('AltGraph') === true;
}

/** Ctrl/Meta/Alt held for a browser or OS shortcut (not AltGr). */
function isShortcut(e: KeyLike): boolean {
  return !isAltGr(e) && !!(e.ctrlKey || e.metaKey || e.altKey);
}

/** The window that owns a listener target (the target itself when it is a window). */
function ownerWindow(target: Window | HTMLElement): Window | null {
  const t = target as { window?: unknown; ownerDocument?: Document | null };
  if (t.window === target) return target as Window;
  return t.ownerDocument?.defaultView ?? null;
}

function readPads(): ReadonlyArray<PadLike | null> {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return navigator.getGamepads() as ReadonlyArray<PadLike | null>;
  } catch {
    return [];
  }
}

/**
 * Keyboard + standard-gamepad input with once-per-tick edge detection (see the edge model
 * above). Create one per game, attach() it to the window or canvas host, and call update()
 * once per simulation tick.
 */
export class Input implements InputManager {
  private readonly keymap: Readonly<Record<string, Button>>;
  private target: Window | HTMLElement | null = null;
  private win: Window | null = null;

  /** Physical key codes currently down (mapped keys only). */
  private readonly keysDown = new Set<string>();
  /** Per button: number of mapped keys holding it. */
  private readonly keyCount = new Array<number>(COUNT).fill(0);
  private readonly sim = new Array<boolean>(COUNT).fill(false);
  private readonly pad = new Array<boolean>(COUNT).fill(false);
  /** Pad buttons held through a reset: ignored until released. */
  private readonly padSuppressed = new Array<boolean>(COUNT).fill(false);
  private readonly padScratch = new Array<boolean>(COUNT).fill(false);
  /** Up->down transitions of event-driven sources since the last update (the latch). */
  private readonly downEdges = new Array<number>(COUNT).fill(0);

  private readonly heldNow = new Array<boolean>(COUNT).fill(false);
  private readonly pressedNow = new Array<boolean>(COUNT).fill(false);
  private readonly releasedNow = new Array<boolean>(COUNT).fill(false);
  /** Ticks each button has been held, counting the current one (integer, so heldTime never drifts). */
  private readonly heldTicks = new Array<number>(COUNT).fill(0);

  private typedBuffer = '';
  private typedTick = '';

  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.handleKeyUp(e);
  private readonly onBlur = (): void => this.reset();

  constructor(keymap: Readonly<Record<string, Button>> = DEFAULT_KEYMAP) {
    this.keymap = keymap;
  }

  /**
   * Listens for keydown/keyup on `target`. Keyups are also taken from the target's own window
   * (which may be an iframe or popup), so a key released after focus left an element target
   * never sticks; blur of that window resets everything.
   */
  attach(target: Window | HTMLElement): void {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    const win = ownerWindow(target);
    if (win) {
      this.win = win;
      win.addEventListener('blur', this.onBlur);
      if (win !== target) win.addEventListener('keyup', this.onKeyUp);
    }
  }

  /** Removes every listener added by attach() and clears all state. */
  detach(): void {
    this.target?.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target?.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.win?.removeEventListener('blur', this.onBlur);
    this.win?.removeEventListener('keyup', this.onKeyUp);
    this.target = null;
    this.win = null;
    this.reset();
  }

  /**
   * Keydown handler (public so tests can feed KeyboardEvent-like objects).
   * Keys typed into form fields are left entirely to the page; shortcuts (Ctrl/Meta/Alt) are
   * never game buttons; AltGr combinations only produce typed() characters.
   */
  handleKeyDown(e: KeyLike): void {
    if (isEditable(e.target)) return;
    const shortcut = isShortcut(e);
    if (!shortcut) this.recordTyped(e);
    const b = this.keymap[e.code];
    if (!b || shortcut || isAltGr(e)) return;
    e.preventDefault?.();
    if (e.repeat || this.keysDown.has(e.code)) return;
    this.keysDown.add(e.code);
    const i = INDEX[b];
    this.sourceDown(i);
    this.keyCount[i]++;
  }

  /** Keyup handler. Always processed (even from form fields) so keys never stick. */
  handleKeyUp(e: KeyLike): void {
    if (!this.keysDown.delete(e.code)) return;
    const b = this.keymap[e.code];
    if (!b) return;
    this.keyCount[INDEX[b]]--;
    if (!isEditable(e.target)) e.preventDefault?.();
  }

  /** Samples keys, pads and latched presses; computes this tick's edges. Call once per tick. */
  update(): void {
    this.pollPads();
    for (let i = 0; i < COUNT; i++) {
      const raw = this.keyCount[i] > 0 || this.sim[i] || this.pad[i];
      const edges = this.downEdges[i];
      const was = this.heldNow[i];
      const now = raw || edges > 0;
      const pressed = now && (!was || edges > 0);
      this.pressedNow[i] = pressed;
      this.releasedNow[i] = was && !now;
      this.heldTicks[i] = now ? (pressed ? 1 : this.heldTicks[i] + 1) : 0;
      this.heldNow[i] = now;
      this.downEdges[i] = 0;
    }
    this.typedTick = this.typedBuffer;
    this.typedBuffer = '';
  }

  /** Releases everything silently (no released edges); pad buttons still held are ignored until let go. */
  reset(): void {
    this.keysDown.clear();
    for (let i = 0; i < COUNT; i++) {
      if (this.pad[i]) this.padSuppressed[i] = true;
      this.keyCount[i] = 0;
      this.sim[i] = false;
      this.pad[i] = false;
      this.downEdges[i] = 0;
      this.heldNow[i] = false;
      this.pressedNow[i] = false;
      this.releasedNow[i] = false;
      this.heldTicks[i] = 0;
    }
    this.typedBuffer = '';
    this.typedTick = '';
  }

  held(b: Button): boolean {
    return this.heldNow[INDEX[b]];
  }

  pressed(b: Button): boolean {
    return this.pressedNow[INDEX[b]];
  }

  released(b: Button): boolean {
    return this.releasedNow[INDEX[b]];
  }

  /**
   * Seconds held, counting the current tick: ticks x STEP, so STEP on the press tick and 0 when
   * up. Computed as ticks / FPS (one rounding), so thresholds like `>= 0.1` land on the exact tick.
   */
  heldTime(b: Button): number {
    return this.heldTicks[INDEX[b]] / FPS;
  }

  /** D-pad vector (a fresh object each call, safe to modify); opposite directions cancel. */
  dir(): Vec {
    const h = this.heldNow;
    return {
      x: (h[INDEX.right] ? 1 : 0) - (h[INDEX.left] ? 1 : 0),
      y: (h[INDEX.down] ? 1 : 0) - (h[INDEX.up] ? 1 : 0),
    };
  }

  anyPressed(): boolean {
    return this.pressedNow.includes(true);
  }

  /** Printable characters typed since the previous update, plus '\b' (Backspace), '\n' (Enter) and '\u001b' (Escape). */
  typed(): string {
    return this.typedTick;
  }

  /** Test hook: simulate a button state change (used by e2e/unit tests). */
  simulate(b: Button, down: boolean): void {
    const i = INDEX[b];
    if (down) this.sourceDown(i);
    this.sim[i] = down;
  }

  /** An event-driven source is going down: latch an edge unless the button is already down. */
  private sourceDown(i: number): void {
    if (!this.sim[i] && this.keyCount[i] === 0 && !this.pad[i]) this.downEdges[i]++;
  }

  private recordTyped(e: KeyLike): void {
    const key = e.key ?? '';
    if (key === 'Backspace') this.typedBuffer += '\b';
    else if (key === 'Enter') this.typedBuffer += '\n';
    else if (key === 'Escape') this.typedBuffer += '\u001b';
    else if (key.length === 1) this.typedBuffer += key;
  }

  private pollPads(): void {
    const next = this.padScratch.fill(false);
    for (const p of readPads()) {
      if (!p || !p.connected) continue;
      for (const [idx, slot] of PAD_SLOTS) {
        const btn = p.buttons[idx];
        if (btn && (btn.pressed || btn.value > 0.5)) next[slot] = true;
      }
      this.readStick(p.axes[0] ?? 0, p.axes[1] ?? 0, next);
    }
    for (let i = 0; i < COUNT; i++) {
      if (this.padSuppressed[i]) {
        if (!next[i]) this.padSuppressed[i] = false;
        this.pad[i] = false;
      } else {
        this.pad[i] = next[i];
      }
    }
  }

  /** Radial deadzone, then snap the stick angle to the nearest of 8 directions (y+ is down). */
  private readStick(ax: number, ay: number, out: boolean[]): void {
    if (!(Math.hypot(ax, ay) > STICK_DEADZONE)) return;
    const sector = Math.round(Math.atan2(ay, ax) / STICK_SECTOR) * STICK_SECTOR;
    const x = Math.round(Math.cos(sector));
    const y = Math.round(Math.sin(sector));
    if (x < 0) out[INDEX.left] = true;
    if (x > 0) out[INDEX.right] = true;
    if (y < 0) out[INDEX.up] = true;
    if (y > 0) out[INDEX.down] = true;
  }
}
