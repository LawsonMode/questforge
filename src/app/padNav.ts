// Controller navigation for the DOM views (menu hub, message pages, gallery).
// While a pad is connected it polls the pads once per animation frame (no loop
// runs without one; a connection starts it): the d-pad or left
// stick moves focus SPATIALLY to the nearest focusable control in that
// direction (key repeat: 0.35 s, then every 0.12 s), the game's action button
// 'a' (right face; bottom with swapped face buttons) or Start activates the
// focused control, 'b' closes the open dialog (or runs onBack) and the right
// stick scrolls. An open dialog traps pad focus. A focus ring class marks
// the focused control while the pad drives focus (programmatic focus does not
// trigger :focus-visible); keyboard use (devices.ts) or a click in the view
// or its open dialog hands focus styling back to the browser.
//
// Buttons act on RELEASE: a button still held when the view changes (e.g.
// "Play" -> the title screen) never reaches the next view, which polls the
// pads through its own Input; buttons already held when navigation starts are
// ignored until let go. Stop it when the view unmounts: the game and the
// editor never see menu polling.
import { controllerPrefs, faceOf, notePad, onControlsChange, onPadConnection } from '../input/devices';

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** First repeat of a held direction after this long (ms)... */
export const REPEAT_DELAY_MS = 350;
/** ...then one move per this long (ms). */
export const REPEAT_RATE_MS = 120;
/** Left-stick deflection that counts as a direction. */
export const STICK_DEADZONE = 0.5;
/** Right-stick deflection below this does not scroll. */
const SCROLL_DEADZONE = 0.25;
/** Right-stick scroll speed at full deflection (px/s). */
const SCROLL_SPEED = 1200;

/** Class on the control focused by the pad (the visible focus ring). */
export const PAD_FOCUS_CLASS = 'qf-pad-focus';
/** Class on that control while the activate button is held down. */
export const PAD_PRESSED_CLASS = 'qf-pad-pressed';

/** Standard-mapping indices of the face buttons by position, Start and the d-pad. */
const FACE_INDEX = { bottom: 0, right: 1, left: 2, top: 3 } as const;
const START_INDEX = 9;
const DPAD: Readonly<Record<NavDir, number>> = { up: 12, down: 13, left: 14, right: 15 };

/** Minimal gamepad shape read here (matches the Gamepad API). */
export interface NavPad {
  connected: boolean;
  id?: string;
  index?: number;
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: readonly number[];
}

/** One frame of pad state, merged over every connected pad. */
export interface NavInput {
  dir: NavDir | null;
  /** Activate: the game's 'a' button or Start. */
  confirm: boolean;
  /** Back: the game's 'b' button. */
  back: boolean;
  /** Right-stick vertical deflection beyond its deadzone (-1..1), else 0. */
  scroll: number;
  /** The first pad that did anything this frame (for notePad). */
  active: NavPad | null;
}

function down(p: NavPad, i: number): boolean {
  const b = p.buttons[i];
  return !!b && (b.pressed || b.value > 0.5);
}

/** The left stick as one of 4 directions (dominant axis), or null inside the deadzone. */
export function stickDir(x: number, y: number): NavDir | null {
  if (!(Math.hypot(x, y) > STICK_DEADZONE)) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** Read the navigation buttons of every connected pad (`swap` = ControllerPrefs.swapFaceButtons). */
export function readNavInput(pads: ReadonlyArray<NavPad | null>, swap: boolean): NavInput {
  const out: NavInput = { dir: null, confirm: false, back: false, scroll: 0, active: null };
  const confirmIndex = FACE_INDEX[faceOf('a', swap) ?? 'right'];
  const backIndex = FACE_INDEX[faceOf('b', swap) ?? 'bottom'];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    let dir: NavDir | null = null;
    for (const d of ['up', 'down', 'left', 'right'] as const) if (down(p, DPAD[d])) dir ??= d;
    dir ??= stickDir(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const scroll = p.axes[3] ?? 0;
    const confirm = down(p, confirmIndex) || down(p, START_INDEX);
    const back = down(p, backIndex);
    out.dir ??= dir;
    out.confirm ||= confirm;
    out.back ||= back;
    if (out.scroll === 0 && Math.abs(scroll) > SCROLL_DEADZONE) out.scroll = scroll;
    const anyButton = p.buttons.some((b) => b.pressed || b.value > 0.5);
    if (!out.active && (anyButton || dir !== null || Math.abs(scroll) > SCROLL_DEADZONE)) out.active = p;
  }
  return out;
}

/** Key repeat for a held direction: moves on the press, after REPEAT_DELAY_MS, then every REPEAT_RATE_MS. */
export class DirRepeat {
  private dir: NavDir | null = null;
  private next = Infinity;

  /** The direction to move this frame (`now` in ms), or null. */
  update(dir: NavDir | null, now: number): NavDir | null {
    if (dir !== this.dir) {
      this.dir = dir;
      this.next = now + REPEAT_DELAY_MS;
      return dir;
    }
    if (dir === null || now < this.next) return null;
    this.next = now + REPEAT_RATE_MS;
    return dir;
  }

  /** Ignore `dir` (held when navigation started) until it is let go or changes. */
  suppress(dir: NavDir | null): void {
    this.dir = dir;
    this.next = Infinity;
  }
}

// ---------------------------------------------------------------- geometry

function spanGap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1);
}

/**
 * Index of the rect to move to from `from` in direction `dir` (-1 when none).
 * Candidates start past our far edge (a few px of overlap allowed, e.g. a
 * control lifted by its focus style); failing any, those whose centre is past
 * it. The score is the gap along `dir` plus a penalty for being off to the
 * side, heavier for left/right so a row is followed before jumping rows.
 */
export function pickNeighbor(from: Rect, rects: readonly Rect[], dir: NavDir): number {
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const fx = (from.left + from.right) / 2;
  const fy = (from.top + from.bottom) / 2;
  const far = horizontal ? (sign > 0 ? from.right : from.left) : (sign > 0 ? from.bottom : from.top);
  const tol = Math.min(8, (horizontal ? from.right - from.left : from.bottom - from.top) / 4);
  const pick = (strict: boolean): number => {
    let best = -1;
    let bestScore = Infinity;
    rects.forEach((r, i) => {
      const near = horizontal ? (sign > 0 ? r.left : r.right) : (sign > 0 ? r.top : r.bottom);
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (strict ? (near - far) * sign < -tol : ((horizontal ? cx : cy) - far) * sign <= 0) return;
      const gap = Math.max(0, (near - far) * sign);
      const side = horizontal ? spanGap(from.top, from.bottom, r.top, r.bottom) : spanGap(from.left, from.right, r.left, r.right);
      const centreOff = Math.abs(horizontal ? cy - fy : cx - fx);
      const score = gap + side * (horizontal ? 4 : 1) + (side > 0 ? (horizontal ? 60 : 16) : 0) + centreOff * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  };
  const strict = pick(true);
  return strict >= 0 ? strict : pick(false);
}

/** Index of the rect whose centre is nearest to the centre of `to` (-1 for none). */
export function pickNearest(to: Rect, rects: readonly Rect[]): number {
  const x = (to.left + to.right) / 2;
  const y = (to.top + to.bottom) / 2;
  let best = -1;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    const d = Math.hypot((r.left + r.right) / 2 - x, (r.top + r.bottom) / 2 - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------- DOM

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** The newest open modal dialog's backdrop (dom.ts modal()), if any. */
function topBackdrop(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.qf-modal-backdrop');
  return all[all.length - 1] ?? null;
}

function isCandidate(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false;
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** The box a control shows as: a visually hidden radio / checkbox uses its label's. */
function rectOf(el: HTMLElement): Rect {
  const label = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') ? el.closest('label') : null;
  return (label ?? el).getBoundingClientRect();
}

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));
}

/** The element that scrolls `el` (nearest scrollable ancestor, else the page). */
function scrollerOf(el: Element | null): Element | null {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return document.scrollingElement;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readPads(): ReadonlyArray<NavPad | null> {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return navigator.getGamepads() as ReadonlyArray<NavPad | null>;
  } catch {
    return [];
  }
}

export interface PadNavOptions {
  /** 'b' pressed with no dialog open (e.g. back to the menu from a message page). */
  onBack?: () => void;
  /** Where focus starts when the pad is used with nothing focused (default: the first control). */
  initial?: () => HTMLElement | null;
  /** Focus the initial control right away (with the ring) when the last-used device is a pad. */
  autofocus?: boolean;
}

/** A running pad navigator. */
export interface PadNav {
  /** Stop polling and drop every listener (idempotent). */
  stop(): void;
}

let running = 0;

/** Pad navigators started and not yet stopped (e2e checks that none leaks into the game or the editor). */
export function padNavCount(): number {
  return running;
}

/** Start pad navigation over `root` (and any modal dialog opened on top of it). */
export function startPadNav(root: HTMLElement, opts: PadNavOptions = {}): PadNav {
  const repeat = new DirRepeat();
  let raf = 0;
  let stopped = false;
  /** The polling loop is running (only while a pad is connected). */
  let looping = false;
  let first = true;
  /** Focus is being driven by the pad: focused controls get the ring. */
  let padMode = false;
  let prev = { confirm: false, back: false };
  /** A press of that button started while navigating (so its release acts). */
  const armed = { confirm: false, back: false };
  /** Where pad focus last was (focus is lost when a re-render replaces the control). */
  let lastRect: Rect | null = null;
  /** The control focused in `root` before a dialog opened (focus returns to it). */
  let rootFocus: HTMLElement | null = null;
  let inDialog = false;
  let lastFrame = 0;
  /** The control wearing the ring. */
  let ringed: HTMLElement | null = null;

  const scope = (): HTMLElement => topBackdrop()?.querySelector<HTMLElement>('.qf-modal') ?? topBackdrop() ?? root;
  const candidates = (within: HTMLElement): HTMLElement[] => [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isCandidate);

  /** Put the ring on `el` (the focused control) while in pad mode; take it off otherwise. */
  const ring = (el: Element | null): void => {
    const next = padMode && el instanceof HTMLElement && el !== document.body ? el : null;
    if (next === ringed) return;
    ringed?.classList.remove(PAD_FOCUS_CLASS, PAD_PRESSED_CLASS);
    next?.classList.add(PAD_FOCUS_CLASS);
    ringed = next;
  };

  /** Keyboard or mouse use: native focus styles take over until the pad is used again. */
  const leavePadMode = (): void => {
    padMode = false;
    ring(null);
  };

  const focus = (el: HTMLElement): void => {
    el.focus({ preventScroll: true });
    ring(el);
    lastRect = rectOf(el);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  /** The focused control if the pad may act on it (inside the current scope). */
  const focused = (within: HTMLElement): HTMLElement | null => {
    const a = document.activeElement;
    return a instanceof HTMLElement && a !== within && within.contains(a) && isCandidate(a) ? a : null;
  };

  /** Nothing usable is focused: focus where pad focus last was, else the initial control. */
  const refocus = (within: HTMLElement): void => {
    const list = candidates(within);
    if (!list.length) return;
    let target: HTMLElement | undefined;
    if (within === root && lastRect) target = list[pickNearest(lastRect, list.map(rectOf))];
    if (!target && within === root) {
      const start = opts.initial?.();
      if (start && list.includes(start)) target = start;
    }
    focus(target ?? list[0]!);
  };

  const move = (dir: NavDir): void => {
    const within = scope();
    const current = focused(within);
    if (!current) {
      refocus(within);
      return;
    }
    const list = candidates(within).filter((c) => c !== current);
    const next = list[pickNeighbor(rectOf(current), list.map(rectOf), dir)];
    if (next) focus(next);
    else if (dir === 'up' || dir === 'down') {
      // Nothing further that way (e.g. the gallery's long pages): scroll instead.
      const s = scrollerOf(current);
      s?.scrollBy({ top: (dir === 'down' ? 1 : -1) * s.clientHeight * 0.4, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  const activate = (): void => {
    const within = scope();
    const el = focused(within);
    if (!el) {
      refocus(within);
      return;
    }
    if (isTextField(el)) {
      el.focus();
      el.select();
      return;
    }
    el.click();
  };

  const back = (): void => {
    const dialog = topBackdrop();
    // dom.ts modals close when their backdrop is pressed: the same as Escape or Cancel, without
    // faking a key (a synthetic Escape would also mark the keyboard as the device in use).
    if (dialog) dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    else opts.onBack?.();
  };

  const onPointer = (e: Event): void => {
    if (e.isTrusted && padMode) leavePadMode();
  };
  root.addEventListener('pointerdown', onPointer, true);
  /** The open dialog's backdrop, watched for clicks too: dialogs sit outside `root`. */
  let watchedDialog: HTMLElement | null = null;
  const watchDialog = (backdrop: HTMLElement | null): void => {
    if (backdrop === watchedDialog) return;
    watchedDialog?.removeEventListener('pointerdown', onPointer, true);
    backdrop?.addEventListener('pointerdown', onPointer, true);
    watchedDialog = backdrop;
  };
  // devices.ts notes every key press: the keyboard became the device in use.
  const offControls = onControlsChange((info) => {
    if (info.device === 'keyboard' && padMode) leavePadMode();
  });

  const frame = (now: number): void => {
    raf = 0;
    if (stopped) return;
    if (!root.isConnected) {
      stop();
      return;
    }
    const pads = readPads();
    if (!pads.some((p) => p?.connected)) {
      // The last pad went away: idle until the next connection.
      looping = false;
      return;
    }
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    const input = readNavInput(pads, controllerPrefs().swapFaceButtons);
    if (first) {
      // Held over from the previous view: ignored until let go.
      first = false;
      prev = { confirm: input.confirm, back: input.back };
      repeat.suppress(input.dir);
      return;
    }

    // A dialog closed: focus goes back to where it was in the view (the new-project dialog does not restore it).
    const backdrop = topBackdrop();
    watchDialog(backdrop);
    const dialogOpen = backdrop !== null;
    if (inDialog && !dialogOpen && padMode && !root.contains(document.activeElement) && rootFocus?.isConnected) focus(rootFocus);
    inDialog = dialogOpen;

    if (input.active) {
      notePad(input.active.index ?? 0, input.active.id ?? '');
      padMode = true;
    }
    // The ring follows focus, wherever it moved (a dialog focusing its first field, a re-render).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== root && root.contains(active)) rootFocus = active;
    ring(active);

    const dir = repeat.update(input.dir, now);
    if (dir) move(dir);

    if (input.confirm && !prev.confirm) {
      armed.confirm = true;
      focused(scope())?.classList.add(PAD_PRESSED_CLASS);
    }
    if (!input.confirm && prev.confirm && armed.confirm) {
      armed.confirm = false;
      for (const el of document.querySelectorAll(`.${PAD_PRESSED_CLASS}`)) el.classList.remove(PAD_PRESSED_CLASS);
      activate();
    }
    if (input.back && !prev.back) armed.back = true;
    if (!input.back && prev.back && armed.back) {
      armed.back = false;
      back();
    }
    prev = { confirm: input.confirm, back: input.back };

    if (input.scroll !== 0 && dt > 0) {
      const within = scope();
      scrollerOf(focused(within) ?? within)?.scrollBy({ top: input.scroll * SCROLL_SPEED * dt });
    }
  };

  /** (Re)start polling; buttons held at that moment are ignored until let go. */
  const startLoop = (): void => {
    if (looping || stopped) return;
    looping = true;
    first = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  };
  const offPads = onPadConnection(() => {
    if (readPads().some((p) => p?.connected)) startLoop();
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    running--;
    cancelAnimationFrame(raf);
    root.removeEventListener('pointerdown', onPointer, true);
    watchDialog(null);
    offControls();
    offPads();
    for (const el of document.querySelectorAll(`.${PAD_FOCUS_CLASS}, .${PAD_PRESSED_CLASS}`)) el.classList.remove(PAD_FOCUS_CLASS, PAD_PRESSED_CLASS);
  };

  running++;
  if (readPads().some((p) => p?.connected)) startLoop();
  if (opts.autofocus) {
    padMode = true;
    refocus(root);
  }
  return { stop };
}
