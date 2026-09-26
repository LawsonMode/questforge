// The engine: fixed-60Hz loop, top-level state machine (title -> file select ->
// playing <-> paused/dialogue/transition/game over), room management, entity
// lifecycle, rendering order, GameServices implementation. OWNER: engine agent.
// Gameplay itself (GameServices, rooms, entities, sub-states) lives in
// session.ts; this file owns the canvas, input, audio, loop and the screens
// shown before a save file is being played. It also watches the gamepads: when
// the one in use is unplugged mid-game the session pauses (see Session.
// controllerLost). A playtest is left with Escape, or on a gamepad by holding
// Start + Select for EXIT_HOLD seconds (a progress bar shows after EXIT_HINT_AT).
import type { Project, SaveData, WarpTarget } from '../core/types';
import type { DebugFlags, GameServices } from './api';
import { SAVE_SLOTS, STEP } from '../core/constants';
import { CanvasRenderer } from '../gfx/renderer';
import { wrapText } from '../gfx/font';
import { Input } from '../input/input';
import { type PadConnection, onPadConnection } from '../input/devices';
import { getAudio } from '../audio/audio';
import { deleteSave, listSaves, writeSave } from '../core/storage';
import { DEFAULT_HERO_NAME, newSave } from './state';
import { applySoundPrefs, loadSoundPrefs } from './soundPrefs';
import { Session, type SessionHost } from './session';
import { TitleScreen } from './ui/titleScreen';
import { FileSelect } from './ui/fileSelect';
import { SCREEN, UI, drawFrame, outlineText } from './ui/theme';

export interface GameOptions {
  /** 'play' = title screen & file select; 'playtest' = straight into gameplay (editor/test). */
  mode: 'play' | 'playtest';
  /** Playtest spawn override (default project.start). */
  start?: WarpTarget;
  /** Initial debug toggles (playtest F1-F4 flip them at runtime). */
  debug?: Partial<DebugFlags>;
  /** Called when the player quits to the host (menu "Save & Quit" in play mode; Escape or held Start + Select in playtest). */
  onExit?: () => void;
  /** Called once if the game stops after an uncaught error (the canvas also shows the message). */
  onError?: (message: string) => void;
}

/** Top-level state names (Game.state). */
export type GameStateName =
  | 'title' | 'loading' | 'fileSelect' | 'playing' | 'paused' | 'dialogue' | 'transition' | 'gameOver';

/** At most this many simulation steps per animation frame (avoids the spiral of death). */
const MAX_STEPS = 5;
/**
 * Frame deltas within this (s) of one step count as exactly one step, and the
 * accumulator runs a step once it is within STEP_SLACK of STEP: rAF jitter on
 * 60 Hz displays would otherwise alternate 0- and 2-step frames (micro-stutter).
 */
const STEP_SNAP = 0.002;
const STEP_SLACK = 0.001;
const DEBUG_KEYS: Readonly<Record<string, keyof DebugFlags>> = {
  F1: 'hitboxes', F2: 'invincible', F3: 'noclip', F4: 'fps',
};
/** Playtest: hold Start + Select this long (s) to leave; the progress hint shows from EXIT_HINT_AT. */
export const EXIT_HOLD = 1;
const EXIT_HINT_AT = 0.3;
const EXIT_HINT = { w: 132, h: 26, y: 186, bar: 104 } as const;

type Screen = 'title' | 'loading' | 'fileSelect' | 'session';

export class Game {
  private readonly project: Project;
  private readonly opts: GameOptions;
  private readonly renderer: CanvasRenderer;
  private readonly input = new Input();
  private readonly audio = getAudio();
  private readonly win: Window;
  private readonly debug: DebugFlags;
  private readonly host: SessionHost;
  private screen: Screen = 'title';
  private title: TitleScreen | null = null;
  private fileSelect: FileSelect | null = null;
  private session: Session | null = null;
  private running = false;
  private destroyed = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private clock = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsSince = 0;
  /** Seconds Start + Select have been held together (playtest exit chord), and whether it fired. */
  private exitHold = 0;
  private exitFired = false;
  private unsubscribe: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, project: Project, opts: GameOptions) {
    this.project = project;
    this.opts = opts;
    this.win = canvas.ownerDocument.defaultView ?? window;
    this.renderer = new CanvasRenderer(canvas, project);
    this.debug = { hitboxes: false, invincible: false, noclip: false, fps: false, ...opts.debug };
    applySoundPrefs(this.audio, loadSoundPrefs());
    this.host = {
      mode: opts.mode,
      persist: (save) => this.persist(save),
      exit: () => this.opts.onExit?.(),
    };
    if (opts.mode === 'playtest') this.beginPlaytest();
    else this.showTitle();
  }

  /** Live services (null until gameplay has started, i.e. during title/file select). */
  get services(): GameServices | null {
    return this.session;
  }

  /** Current top-level state (for tests and hosts). */
  get state(): GameStateName {
    return this.screen === 'session' ? this.session!.mode : this.screen;
  }

  /** Test hook: load a place instantly (no transition). */
  warpNow(target: WarpTarget): void {
    this.session?.warpNow(target);
  }

  /** Begin the loop (requestAnimationFrame) and attach input. */
  start(): void {
    if (this.running || this.destroyed) return;
    this.running = true;
    // Registered before Input attaches (and in the capture phase) so playtest
    // Escape / debug keys can be swallowed before Input sees them.
    this.win.addEventListener('keydown', this.onKeyDown, true);
    this.win.addEventListener('pointerdown', this.onGesture, true);
    this.win.addEventListener('resize', this.onResize);
    this.win.document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubscribe = [onPadConnection(this.onPad)];
    this.input.attach(this.win);
    this.renderer.resize();
    this.last = this.win.performance.now();
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsSince = this.last;
    this.raf = this.win.requestAnimationFrame(this.frame);
  }

  /** Pause the loop and detach input (can start() again). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.win.cancelAnimationFrame(this.raf);
    this.win.removeEventListener('keydown', this.onKeyDown, true);
    this.win.removeEventListener('pointerdown', this.onGesture, true);
    this.win.removeEventListener('resize', this.onResize);
    this.win.document.removeEventListener('visibilitychange', this.onVisibility);
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.input.detach();
  }

  /** Stop and release everything (music, listeners, the display's resize observer). */
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.renderer.dispose();
    this.audio.music('none');
    this.session = null;
    this.title = null;
    this.fileSelect = null;
  }

  // ------------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = this.win.requestAnimationFrame(this.frame);
    if (this.win.document.hidden) {
      this.last = now;
      return;
    }
    let elapsed = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    if (Math.abs(elapsed - STEP) < STEP_SNAP) elapsed = STEP;
    this.acc = Math.min(this.acc + elapsed, STEP * MAX_STEPS);
    try {
      let steps = 0;
      // The slack may leave acc slightly negative; that is carried into the next frame.
      for (; this.acc >= STEP - STEP_SLACK && steps < MAX_STEPS; steps++) {
        this.tick(STEP);
        this.acc -= STEP;
        // A host may stop or destroy the game from inside a tick (onExit): nothing more to run or draw.
        if (!this.running) return;
      }
      // Nothing changed without a simulation step (high-refresh displays): skip the redraw.
      if (steps === 0) return;
      this.countFps(now);
      this.render();
    } catch (err) {
      this.fail(err);
    }
  };

  /** Stop after an uncaught error: one console report, a message on the canvas, and the host's onError. */
  private fail(err: unknown): void {
    this.stop();
    console.error('[game] stopped after an error:', err);
    const message = err instanceof Error ? err.message : String(err);
    try {
      this.drawError(message);
    } catch {
      // The renderer itself may be what failed; the console report stands.
    }
    this.opts.onError?.(message);
  }

  private drawError(message: string): void {
    const r = this.renderer;
    r.overlay('#000000', 0.8);
    r.drawText('GAME STOPPED', r.width / 2, 72, { align: 'center', color: '#ff6060' });
    const lines = wrapText(message, r.width - 24).slice(0, 8);
    lines.forEach((line, i) => r.drawText(line, r.width / 2, 96 + i * 10, { align: 'center', color: '#ffffff' }));
    r.present();
  }

  private tick(dt: number): void {
    this.input.update();
    this.clock += dt;
    if (this.opts.mode === 'playtest' && this.tickExitChord(dt)) return;
    switch (this.screen) {
      case 'title':
        if (this.title!.update(dt, this.input) === 'start') void this.openFileSelect();
        break;
      case 'fileSelect':
        this.tickFileSelect(dt);
        break;
      case 'session':
        this.session!.tick(dt);
        break;
      case 'loading':
        break;
    }
  }

  private render(): void {
    const r = this.renderer;
    r.time = this.clock;
    r.camX = 0;
    r.camY = 0;
    switch (this.screen) {
      case 'title':
        r.clear('#000000');
        this.title!.draw(r);
        break;
      case 'fileSelect':
        r.clear('#000000');
        this.fileSelect!.draw(r);
        break;
      case 'session':
        this.session!.draw(r, this.fps);
        break;
      case 'loading':
        r.clear('#000000');
        break;
    }
    if (this.exitHold >= EXIT_HINT_AT) this.drawExitHint();
    r.present();
  }

  /**
   * Playtest exit chord: a gamepad has no Escape key, so holding Start + Select
   * together for EXIT_HOLD seconds leaves too. True on the tick it fires.
   */
  private tickExitChord(dt: number): boolean {
    if (!this.input.held('start') || !this.input.held('select')) {
      this.exitHold = 0;
      return false;
    }
    this.exitHold += dt;
    if (this.exitHold < EXIT_HOLD || this.exitFired) return false;
    this.exitFired = true;
    this.opts.onExit?.();
    return true;
  }

  /** "LEAVING PLAYTEST" with a bar filling up while the exit chord is held. */
  private drawExitHint(): void {
    const r = this.renderer;
    const h = EXIT_HINT;
    const x = Math.round((r.width - h.w) / 2);
    const k = Math.min(1, (this.exitHold - EXIT_HINT_AT) / (EXIT_HOLD - EXIT_HINT_AT));
    drawFrame(r, x, h.y, h.w, h.h, UI.fillDeep);
    outlineText(r, 'LEAVING PLAYTEST', r.width / 2, h.y + 6, UI.gold, { align: 'center' });
    const bx = Math.round((r.width - h.bar) / 2);
    r.fillRect(bx - 1, h.y + 17, h.bar + 2, 4, UI.outline, SCREEN);
    r.fillRect(bx, h.y + 18, h.bar, 2, UI.shade, SCREEN);
    r.fillRect(bx, h.y + 18, Math.round(h.bar * k), 2, UI.gold, SCREEN);
  }

  private countFps(now: number): void {
    this.fpsFrames++;
    if (now - this.fpsSince < 500) return;
    this.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
    this.fpsFrames = 0;
    this.fpsSince = now;
  }

  // ------------------------------------------------------------------ screens

  private showTitle(): void {
    this.screen = 'title';
    this.fileSelect = null;
    this.title = new TitleScreen(this.project, this.audio);
    this.audio.music(this.project.settings.titleMusic);
  }

  private async openFileSelect(): Promise<void> {
    this.screen = 'loading';
    this.title = null;
    const saves = await this.loadSaves();
    if (this.destroyed || this.screen !== 'loading') return;
    this.fileSelect = new FileSelect(this.project, this.audio, saves);
    this.screen = 'fileSelect';
    this.audio.music('fileSelect');
  }

  private tickFileSelect(dt: number): void {
    const res = this.fileSelect!.update(dt, this.input);
    switch (res.kind) {
      case 'create': {
        const save = newSave(this.project, res.slot, res.name);
        void this.persist(save);
        this.beginSession(save, save.respawn, true);
        break;
      }
      case 'play':
        this.beginSession(res.save, res.save.respawn, false);
        break;
      case 'erase':
        void this.eraseSlot(res.slot);
        break;
      case 'back':
        this.showTitle();
        break;
      case 'none':
        break;
    }
  }

  private async loadSaves(): Promise<(SaveData | null)[]> {
    try {
      return await listSaves(this.project.id);
    } catch (err) {
      console.warn('[game] could not read save slots:', err);
      return new Array<SaveData | null>(SAVE_SLOTS).fill(null);
    }
  }

  private async eraseSlot(slot: number): Promise<void> {
    try {
      await deleteSave(this.project.id, slot);
    } catch (err) {
      console.warn('[game] could not erase save slot:', err);
    }
    const saves = await this.loadSaves();
    this.fileSelect?.setSaves(saves);
  }

  private beginPlaytest(): void {
    const save = newSave(this.project, 0, DEFAULT_HERO_NAME);
    const start = this.opts.start ?? this.project.start;
    save.respawn = { ...start };
    this.beginSession(save, start, false);
  }

  private beginSession(save: SaveData, start: WarpTarget, isNew: boolean): void {
    this.session = new Session(this.host, this.project, this.input, this.audio, save, this.debug, start);
    this.screen = 'session';
    this.title = null;
    this.fileSelect = null;
    const intro = this.project.settings.introDialogue;
    if (isNew && intro && this.opts.mode === 'play') void this.session.dialogue(intro);
  }

  /** Write the save (play mode only; playtest never persists). */
  private async persist(save: SaveData): Promise<void> {
    if (this.opts.mode !== 'play') return;
    save.updated = Date.now();
    try {
      await writeSave(save);
    } catch (err) {
      console.warn('[game] could not write the save file:', err);
    }
  }

  // ------------------------------------------------------------------ DOM events

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.audio.unlock();
    if (this.opts.mode !== 'playtest') return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.opts.onExit?.();
      return;
    }
    const flag = DEBUG_KEYS[e.code];
    if (!flag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) this.debug[flag] = !this.debug[flag];
  };

  private readonly onGesture = (): void => {
    this.audio.unlock();
  };

  /** The pad in use was unplugged (not a spare one): pause the game. */
  private readonly onPad = (e: PadConnection): void => {
    if (e.wasInUse) this.session?.controllerLost();
  };

  private readonly onResize = (): void => {
    this.renderer.resize();
  };

  private readonly onVisibility = (): void => {
    if (this.win.document.hidden) this.input.reset();
    this.last = this.win.performance.now();
    this.acc = 0;
  };
}
