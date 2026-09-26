// Editor shell: the debounced autosave state machine, driven by fake timers
// and a controllable save function.
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_DELAY_MS, Autosave, type SaveStatus, type Timers } from '../src/editor/shell/autosave';

/** Manual clock: timers fire only when advance() passes their deadline. */
class FakeTimers implements Timers {
  now = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get count(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > this.now) continue;
      this.pending.delete(id);
      t.fn();
    }
  }
}

/** A save function whose calls resolve/reject on demand. */
function controllableSave(): { save: () => Promise<void>; calls: number; resolve(): void; reject(err: Error): void } {
  const waiting: { ok: () => void; fail: (e: Error) => void }[] = [];
  const api = {
    calls: 0,
    save: (): Promise<void> => new Promise<void>((ok, fail) => {
      api.calls++;
      waiting.push({ ok, fail });
    }),
    resolve: () => waiting.shift()?.ok(),
    reject: (err: Error) => waiting.shift()?.fail(err),
  };
  return api;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(): { timers: FakeTimers; saver: ReturnType<typeof controllableSave>; statuses: SaveStatus[]; errors: unknown[]; auto: Autosave } {
  const timers = new FakeTimers();
  const saver = controllableSave();
  const statuses: SaveStatus[] = [];
  const errors: unknown[] = [];
  const auto = new Autosave({ save: saver.save, timers, onStatus: (s) => statuses.push(s), onError: (e) => errors.push(e) });
  return { timers, saver, statuses, errors, auto };
}

describe('Autosave', () => {
  it('uses a ~1.2 s debounce by default', () => {
    expect(AUTOSAVE_DELAY_MS).toBe(1200);
  });

  it('starts clean', () => {
    const { auto } = setup();
    expect(auto.status).toBe('saved');
    expect(auto.pending).toBe(false);
  });

  it('saves once after the quiet period, restarting the timer on every change', async () => {
    const { timers, saver, statuses, auto } = setup();
    auto.markDirty();
    expect(auto.status).toBe('dirty');
    expect(auto.pending).toBe(true);
    timers.advance(1000);
    auto.markDirty();
    timers.advance(1000);
    expect(saver.calls).toBe(0);
    timers.advance(200);
    expect(saver.calls).toBe(1);
    expect(auto.status).toBe('saving');
    saver.resolve();
    await settle();
    expect(auto.status).toBe('saved');
    expect(auto.pending).toBe(false);
    expect(statuses).toEqual(['dirty', 'saving', 'saved']);
    expect(timers.count).toBe(0);
  });

  it('never overlaps saves: a change during a save schedules another one', async () => {
    const { timers, saver, auto } = setup();
    auto.markDirty();
    timers.advance(AUTOSAVE_DELAY_MS);
    expect(saver.calls).toBe(1);
    auto.markDirty();
    expect(auto.status).toBe('saving');
    timers.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saver.calls).toBe(1);
    saver.resolve();
    await settle();
    await settle();
    expect(saver.calls).toBe(2);
    saver.resolve();
    await settle();
    await settle();
    expect(auto.status).toBe('saved');
    expect(auto.pending).toBe(false);
  });

  it('flush saves pending changes immediately and cancels the timer', async () => {
    const { timers, saver, auto } = setup();
    auto.markDirty();
    const done = auto.flush();
    await settle();
    expect(saver.calls).toBe(1);
    expect(timers.count).toBe(0);
    saver.resolve();
    expect(await done).toBe(true);
    expect(auto.status).toBe('saved');
  });

  it('flush is a no-op when clean; saveNow saves anyway', async () => {
    const { saver, auto } = setup();
    expect(await auto.flush()).toBe(true);
    expect(saver.calls).toBe(0);
    const forced = auto.saveNow();
    await settle();
    expect(saver.calls).toBe(1);
    saver.resolve();
    expect(await forced).toBe(true);
  });

  it('reports failures, stays pending and recovers on the next save', async () => {
    const { timers, saver, errors, auto } = setup();
    auto.markDirty();
    timers.advance(AUTOSAVE_DELAY_MS);
    saver.reject(new Error('quota'));
    await settle();
    expect(auto.status).toBe('error');
    expect(auto.pending).toBe(true);
    expect(errors).toHaveLength(1);
    const retry = auto.flush();
    await settle();
    saver.resolve();
    expect(await retry).toBe(true);
    expect(auto.status).toBe('saved');
  });

  it('dispose stops automatic saves but flush still works', async () => {
    const { timers, saver, auto } = setup();
    auto.markDirty();
    auto.dispose();
    timers.advance(AUTOSAVE_DELAY_MS * 2);
    expect(saver.calls).toBe(0);
    auto.markDirty();
    expect(timers.count).toBe(0);
    const done = auto.flush();
    await settle();
    saver.resolve();
    expect(await done).toBe(true);
  });
});
