// Input edge detection, latching, keyboard filtering, typed text and gamepad polling.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEP } from '../src/core/constants';
import { DEFAULT_KEYMAP, Input, type KeyLike } from '../src/input/input';

function key(code: string, extra: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } {
  const e = {
    code,
    key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
    prevented: false,
    preventDefault() { e.prevented = true; },
    ...extra,
  };
  return e;
}

describe('Input edges', () => {
  it('reports pressed only on the first tick, then held, then released once', () => {
    const inp = new Input();
    inp.simulate('b', true);
    inp.update();
    expect([inp.pressed('b'), inp.held('b'), inp.released('b')]).toEqual([true, true, false]);
    inp.update();
    expect([inp.pressed('b'), inp.held('b'), inp.released('b')]).toEqual([false, true, false]);
    inp.simulate('b', false);
    inp.update();
    expect([inp.pressed('b'), inp.held('b'), inp.released('b')]).toEqual([false, false, true]);
    inp.update();
    expect(inp.released('b')).toBe(false);
  });

  it('latches a press and release that both happen between updates', () => {
    const inp = new Input();
    inp.simulate('a', true);
    inp.simulate('a', false);
    inp.update();
    expect(inp.pressed('a')).toBe(true);
    expect(inp.held('a')).toBe(true);
    expect(inp.anyPressed()).toBe(true);
    inp.update();
    expect(inp.pressed('a')).toBe(false);
    expect(inp.released('a')).toBe(true);
    expect(inp.anyPressed()).toBe(false);
  });

  it('registers a quick re-press while held as a new press', () => {
    const inp = new Input();
    inp.simulate('y', true);
    inp.update();
    inp.update();
    inp.simulate('y', false);
    inp.simulate('y', true);
    inp.update();
    expect(inp.pressed('y')).toBe(true);
    expect(inp.released('y')).toBe(false);
    expect(inp.heldTime('y')).toBe(STEP);
  });

  it('counts heldTime in whole ticks without float drift, and zeroes it on release', () => {
    const inp = new Input();
    inp.simulate('b', true);
    for (let n = 1; n <= 240; n++) {
      inp.update();
      expect(inp.heldTime('b')).toBe(n / 60);
    }
    inp.simulate('b', false);
    inp.update();
    expect(inp.heldTime('b')).toBe(0);
  });

  it('crosses round-number thresholds on the exact tick', () => {
    const inp = new Input();
    inp.simulate('b', true);
    const firstTick = (seconds: number): number => {
      inp.reset();
      inp.simulate('b', true);
      for (let n = 1; ; n++) {
        inp.update();
        if (inp.heldTime('b') >= seconds) return n;
      }
    };
    expect([0.1, 0.25, 0.35, 0.5, 0.8, 1].map(firstTick)).toEqual([6, 15, 21, 30, 48, 60]);
  });

  it('dir() is digital and opposite directions cancel', () => {
    const inp = new Input();
    inp.simulate('right', true);
    inp.simulate('up', true);
    inp.update();
    expect(inp.dir()).toEqual({ x: 1, y: -1 });
    inp.simulate('left', true);
    inp.update();
    expect(inp.dir()).toEqual({ x: 0, y: -1 });
  });

  it('reset() clears everything', () => {
    const inp = new Input();
    inp.simulate('start', true);
    inp.update();
    inp.reset();
    expect(inp.held('start')).toBe(false);
    expect(inp.pressed('start')).toBe(false);
    inp.update();
    expect(inp.held('start')).toBe(false);
  });
});

describe('Input keyboard handling', () => {
  it('maps codes through the keymap and prevents default for mapped keys', () => {
    const inp = new Input();
    const z = key('KeyZ');
    inp.handleKeyDown(z);
    inp.update();
    expect(inp.pressed('b')).toBe(true);
    expect(z.prevented).toBe(true);
    const f = key('KeyF');
    inp.handleKeyDown(f);
    expect(f.prevented).toBe(false);
    inp.handleKeyUp(key('KeyZ'));
    inp.update();
    expect(inp.released('b')).toBe(true);
  });

  it('ignores auto-repeat for presses', () => {
    const inp = new Input();
    inp.handleKeyDown(key('ArrowUp'));
    inp.update();
    inp.handleKeyDown(key('ArrowUp', { repeat: true }));
    inp.handleKeyDown(key('ArrowUp'));
    inp.update();
    expect(inp.pressed('up')).toBe(false);
    expect(inp.held('up')).toBe(true);
  });

  it('keeps a button held while any of its keys is down', () => {
    const inp = new Input();
    inp.handleKeyDown(key('ArrowLeft'));
    inp.handleKeyDown(key('KeyA'));
    inp.update();
    inp.handleKeyUp(key('ArrowLeft'));
    inp.update();
    expect(inp.held('left')).toBe(true);
    expect(inp.released('left')).toBe(false);
    inp.handleKeyUp(key('KeyA'));
    inp.update();
    expect(inp.released('left')).toBe(true);
  });

  it('leaves keys typed into form fields alone, but still honours their keyup', () => {
    const inp = new Input();
    const field = { tagName: 'INPUT' } as unknown as EventTarget;
    const e = key('KeyZ', { target: field });
    inp.handleKeyDown(e);
    inp.update();
    expect(inp.held('b')).toBe(false);
    expect(e.prevented).toBe(false);
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    inp.handleKeyDown(key('KeyX', { target: editable }));
    inp.update();
    expect(inp.held('a')).toBe(false);
    inp.handleKeyDown(key('KeyC'));
    inp.handleKeyUp(key('KeyC', { target: field }));
    inp.update();
    inp.update();
    expect(inp.held('y')).toBe(false);
  });

  it('treats AltGr (Ctrl+Alt on Windows) as typing, not as a shortcut or a game button', () => {
    const inp = new Input();
    const altGr = (k: string): boolean => k === 'AltGraph';
    const e = key('KeyQ', { key: '@', ctrlKey: true, altKey: true, getModifierState: altGr });
    inp.handleKeyDown(e);
    inp.update();
    expect(inp.typed()).toBe('@');
    expect(inp.held('l')).toBe(false);
    expect(e.prevented).toBe(false);
  });

  it('lets browser shortcuts with Ctrl/Meta/Alt through', () => {
    const inp = new Input();
    const e = key('KeyS', { ctrlKey: true });
    inp.handleKeyDown(e);
    inp.update();
    expect(e.prevented).toBe(false);
    expect(inp.held('down')).toBe(false);
    expect(inp.typed()).toBe('');
  });

  it('typed() returns characters since the last update, with \\b, \\n and Escape', () => {
    const inp = new Input();
    inp.handleKeyDown(key('KeyH', { key: 'H' }));
    inp.handleKeyDown(key('KeyI', { key: 'i' }));
    inp.handleKeyDown(key('Backspace', { key: 'Backspace' }));
    inp.handleKeyDown(key('Space', { key: ' ' }));
    inp.handleKeyDown(key('Enter', { key: 'Enter' }));
    inp.handleKeyDown(key('ShiftLeft', { key: 'Shift' }));
    inp.handleKeyDown(key('Escape', { key: 'Escape' }));
    expect(inp.typed()).toBe('');
    inp.update();
    expect(inp.typed()).toBe('Hi\b \n\u001b');
    inp.update();
    expect(inp.typed()).toBe('');
  });

  it('accepts a custom keymap', () => {
    const inp = new Input({ ...DEFAULT_KEYMAP, KeyP: 'start' });
    inp.handleKeyDown(key('KeyP'));
    inp.update();
    expect(inp.pressed('start')).toBe(true);
  });

  it('attach() listens on the target and detach() removes the listeners', () => {
    const inp = new Input();
    const target = new EventTarget();
    inp.attach(target as unknown as HTMLElement);
    const down = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyX', key: 'x' });
    target.dispatchEvent(down);
    inp.update();
    expect(inp.pressed('a')).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyX', key: 'x' }));
    inp.update();
    expect(inp.released('a')).toBe(true);
    inp.detach();
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyX', key: 'x' }));
    inp.update();
    expect(inp.held('a')).toBe(false);
  });

  it('takes blur and stray keyups from the window that owns the target (e.g. a playtest iframe)', () => {
    const inp = new Input();
    const frameWin = Object.assign(new EventTarget(), {});
    Object.assign(frameWin, { window: frameWin });
    const host = Object.assign(new EventTarget(), { ownerDocument: { defaultView: frameWin } });
    inp.attach(host as unknown as HTMLElement);
    const keyEvent = (type: string, code: string): Event => Object.assign(new Event(type), { code, key: code });
    host.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    host.dispatchEvent(keyEvent('keydown', 'KeyZ'));
    inp.update();
    expect(inp.held('up') && inp.held('b')).toBe(true);
    frameWin.dispatchEvent(keyEvent('keyup', 'ArrowUp'));
    inp.update();
    expect(inp.released('up')).toBe(true);
    frameWin.dispatchEvent(new Event('blur'));
    inp.update();
    expect(inp.held('b')).toBe(false);
    inp.detach();
    host.dispatchEvent(keyEvent('keydown', 'KeyZ'));
    frameWin.dispatchEvent(new Event('blur'));
    inp.update();
    expect(inp.held('b')).toBe(false);
  });
});

describe('Input gamepad polling', () => {
  afterEach(() => vi.unstubAllGlobals());

  function pad(pressed: number[], axes: number[] = [0, 0]) {
    return {
      connected: true,
      axes,
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    };
  }

  it('maps standard buttons and the left stick, merged with keys', () => {
    let pads = [pad([0, 9]), null];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const inp = new Input();
    inp.update();
    expect(inp.pressed('b')).toBe(true);
    expect(inp.pressed('start')).toBe(true);
    pads = [pad([1], [0.2, -0.9])];
    inp.update();
    expect(inp.released('b')).toBe(true);
    expect(inp.pressed('a')).toBe(true);
    expect(inp.dir()).toEqual({ x: 0, y: -1 });
    pads = [pad([15], [-0.8, 0])];
    inp.handleKeyDown(key('ArrowDown'));
    inp.update();
    expect(inp.dir()).toEqual({ x: 0, y: 1 });
    expect(inp.held('left') && inp.held('right')).toBe(true);
  });

  it('reads the stick with a radial deadzone and 8-way sectors', () => {
    let axes = [0, 0];
    vi.stubGlobal('navigator', { getGamepads: () => [pad([], axes)] });
    const inp = new Input();
    const read = (x: number, y: number) => {
      axes = [x, y];
      inp.update();
      return inp.dir();
    };
    expect(read(0.3, 0.3)).toEqual({ x: 0, y: 0 });
    expect(read(0.4, 0.4)).toEqual({ x: 1, y: 1 });
    expect(read(-0.6, 0.1)).toEqual({ x: -1, y: 0 });
    expect(read(0.2, -0.6)).toEqual({ x: 0, y: -1 });
    expect(read(-0.5, -0.45)).toEqual({ x: -1, y: -1 });
    expect(read(0.49, 0)).toEqual({ x: 0, y: 0 });
  });

  it('suppresses pad buttons held through a reset until they are released', () => {
    let pads = [pad([9])];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const inp = new Input();
    inp.update();
    inp.reset();
    inp.update();
    expect(inp.pressed('start')).toBe(false);
    expect(inp.held('start')).toBe(false);
    pads = [pad([])];
    inp.update();
    pads = [pad([9])];
    inp.update();
    expect(inp.pressed('start')).toBe(true);
  });

  it('survives a throwing or missing Gamepad API', () => {
    vi.stubGlobal('navigator', { getGamepads: () => { throw new Error('blocked'); } });
    const inp = new Input();
    expect(() => inp.update()).not.toThrow();
    vi.stubGlobal('navigator', {});
    expect(() => inp.update()).not.toThrow();
  });
});
