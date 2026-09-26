// Debounced autosave state machine for the editor shell. Pure logic (no DOM):
// the save function and timers are injected so tests can drive it by hand.

/** Save state shown in the editor's top bar. */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** Timer functions (setTimeout/clearTimeout in the browser, fakes in tests). */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Debounce between the last change and the automatic save. */
export const AUTOSAVE_DELAY_MS = 1200;

/** The browser's setTimeout/clearTimeout. */
export const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Autosave configuration (save function, timing, callbacks). */
export interface AutosaveOptions {
  /** Stores the project; rejects on failure. */
  save: () => Promise<void>;
  delayMs?: number;
  timers?: Timers;
  onStatus?: (status: SaveStatus) => void;
  onError?: (err: unknown) => void;
}

/**
 * Tracks unsaved changes and stores them after a quiet period. Saves never
 * overlap: a change made while saving schedules another save afterwards.
 */
export class Autosave {
  private current: SaveStatus = 'saved';
  /** Bumped on every change. */
  private rev = 0;
  /** Revision captured by the last successful save. */
  private savedRev = 0;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  private readonly timers: Timers;
  private readonly delay: number;

  constructor(private readonly opts: AutosaveOptions) {
    this.timers = opts.timers ?? browserTimers;
    this.delay = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  }

  get status(): SaveStatus {
    return this.current;
  }

  /** True while changes are not yet stored (dirty, saving or failed). */
  get pending(): boolean {
    return this.rev !== this.savedRev || this.inFlight !== null;
  }

  /** Record a change and (re)start the debounce timer. */
  markDirty(): void {
    this.rev++;
    if (!this.inFlight) this.setStatus('dirty');
    this.schedule();
  }

  /** Store pending changes now (no-op when clean). Resolves true when everything is stored. */
  flush(): Promise<boolean> {
    return this.run(false);
  }

  /** Store now even when clean (explicit Ctrl+S). Resolves true on success. */
  saveNow(): Promise<boolean> {
    return this.run(true);
  }

  /** Stop scheduling automatic saves (flush/saveNow keep working). */
  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private schedule(): void {
    this.cancelTimer();
    if (this.disposed) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run(false);
    }, this.delay);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.timers.clear(this.timer);
    this.timer = null;
  }

  private async run(force: boolean): Promise<boolean> {
    this.cancelTimer();
    while (this.inFlight) await this.inFlight;
    if (!force && this.rev === this.savedRev) return true;
    const rev = this.rev;
    this.setStatus('saving');
    let ok = true;
    const attempt = (async () => {
      try {
        await this.opts.save();
        this.savedRev = Math.max(this.savedRev, rev);
      } catch (err) {
        ok = false;
        this.opts.onError?.(err);
      }
    })();
    this.inFlight = attempt;
    await attempt;
    this.inFlight = null;
    if (!ok) {
      this.setStatus('error');
      return false;
    }
    if (this.rev !== this.savedRev) {
      this.setStatus('dirty');
      if (this.timer === null) this.schedule();
      return false;
    }
    this.setStatus('saved');
    return true;
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.current) return;
    this.current = s;
    this.opts.onStatus?.(s);
  }
}
