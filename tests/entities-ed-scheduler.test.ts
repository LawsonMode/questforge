// Entity/trigger/dialogue editors: RenderScheduler, the pointer-aware render
// queue. A field committing on blur (inside the mousedown of the next click)
// must not refresh anything under the pointer before that click lands.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderScheduler } from '../src/editor/entities/widgets';

/** Stand-ins for the DOM pieces the scheduler touches (tests run in node). */
class FakeSelect extends EventTarget {}

class FakeRoot extends EventTarget {
  isConnected = true;
  getClientRects(): unknown[] {
    return [{}];
  }
}

let doc: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLSelectElement', FakeSelect);
  vi.stubGlobal('HTMLOptionElement', class extends EventTarget {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(): { root: FakeRoot; scheduler: RenderScheduler; run: ReturnType<typeof vi.fn> } {
  const root = new FakeRoot();
  const run = vi.fn();
  const scheduler = new RenderScheduler(root as unknown as HTMLElement, run);
  return { root, scheduler, run };
}

const press = (target: EventTarget): boolean => target.dispatchEvent(new Event('pointerdown'));
const release = (): boolean => doc.dispatchEvent(new Event('pointerup'));
const microtasks = (): Promise<void> => Promise.resolve();

describe('RenderScheduler', () => {
  it('runs light updates at once when no press is in progress', () => {
    const { scheduler } = setup();
    const light = vi.fn();
    scheduler.afterPress(light);
    expect(light).toHaveBeenCalledTimes(1);
  });

  it('holds light updates until the task after the press ends (after its click)', () => {
    const { root, scheduler } = setup();
    const light = vi.fn();
    press(root);
    scheduler.afterPress(light);
    expect(light).not.toHaveBeenCalled();
    release();
    // The click is dispatched right after pointerup, in the same task.
    expect(light).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(light).toHaveBeenCalledTimes(1);
  });

  it('coalesces renders and runs them after the press', async () => {
    const { root, scheduler, run } = setup();
    scheduler.schedule();
    scheduler.schedule();
    await microtasks();
    expect(run).toHaveBeenCalledTimes(1);
    press(root);
    scheduler.schedule();
    await microtasks();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops held light updates when a full render runs instead', async () => {
    const { root, scheduler, run } = setup();
    const light = vi.fn();
    press(root);
    scheduler.afterPress(light);
    release();
    // The click's own edit asks for a rebuild, which covers the light update.
    scheduler.schedule();
    await microtasks();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    expect(light).not.toHaveBeenCalled();
  });

  it('does not hold back work for presses on a select or outside the root', () => {
    const { root, scheduler } = setup();
    const select = new FakeSelect();
    // A pointerdown inside the root whose target is a select (native popups may swallow the pointerup).
    const onSelect = new Event('pointerdown');
    Object.defineProperty(onSelect, 'target', { value: select });
    root.dispatchEvent(onSelect);
    const light = vi.fn();
    scheduler.afterPress(light);
    expect(light).toHaveBeenCalledTimes(1);
    press(new EventTarget());
    scheduler.afterPress(light);
    expect(light).toHaveBeenCalledTimes(2);
  });

  it('skips renders while hidden and forgets everything once destroyed', async () => {
    const { root, scheduler, run } = setup();
    root.isConnected = false;
    scheduler.schedule();
    await microtasks();
    expect(run).not.toHaveBeenCalled();
    root.isConnected = true;
    const light = vi.fn();
    press(root);
    scheduler.afterPress(light);
    scheduler.destroy();
    release();
    vi.runAllTimers();
    expect(light).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
