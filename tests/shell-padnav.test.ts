// Menu hub pad navigation: spatial neighbour picking, key repeat and reading the
// navigation buttons (SNES positions, swapped face buttons, stick, several pads).
import { describe, expect, it } from 'vitest';
import {
  DirRepeat, REPEAT_DELAY_MS, REPEAT_RATE_MS, pickNearest, pickNeighbor, readNavInput, stickDir, type NavPad, type Rect,
} from '../src/app/padNav';

const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });

/** A standard-mapping pad with `down` buttons held and the given axes. */
function pad(down: number[] = [], axes: number[] = [0, 0, 0, 0], extra: Partial<NavPad> = {}): NavPad {
  return {
    connected: true, id: 'Test pad', index: 0,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })),
    axes, ...extra,
  };
}

describe('pickNeighbor', () => {
  // Two hero buttons, a row of three card actions below, a footer link.
  const heroL = rect(100, 100, 400, 80);
  const heroR = rect(520, 100, 400, 80);
  const play = rect(40, 400, 60, 30);
  const edit = rect(110, 400, 80, 30);
  const del = rect(300, 400, 30, 30);
  const footer = rect(460, 700, 90, 20);
  const all = [heroL, heroR, play, edit, del, footer];
  const from = (r: Rect, dir: 'up' | 'down' | 'left' | 'right'): Rect | undefined => {
    const others = all.filter((x) => x !== r);
    return others[pickNeighbor(r, others, dir)];
  };

  it('follows a row left and right', () => {
    expect(from(play, 'right')).toBe(edit);
    expect(from(edit, 'right')).toBe(del);
    expect(from(del, 'left')).toBe(edit);
    expect(from(heroL, 'right')).toBe(heroR);
    expect(from(heroR, 'left')).toBe(heroL);
  });

  it('goes to the next row below / above, preferring what lies under it', () => {
    expect(from(heroL, 'down')).toBe(del); // the one centred under it
    expect(from(play, 'up')).toBe(heroL);
    expect(from(del, 'down')).toBe(footer);
  });

  it('finds nothing past the edge', () => {
    expect(pickNeighbor(heroL, [heroR, play], 'up')).toBe(-1);
    expect(pickNeighbor(footer, [heroL, play], 'down')).toBe(-1);
    expect(pickNeighbor(heroR, [heroL, play], 'right')).toBe(-1);
  });

  it('never treats a same-row neighbour nudged by a few px (a lifted focus style) as the next row', () => {
    const lifted = rect(520, 98, 400, 80);
    const below = rect(700, 260, 100, 28);
    expect(pickNeighbor(lifted, [heroL, below], 'down')).toBe(1);
    expect(pickNeighbor(lifted, [heroL], 'down')).toBe(-1);
  });

  it('falls back to centres when nothing starts past the edge (overlapping boxes)', () => {
    const big = rect(0, 0, 200, 200);
    const overlapping = rect(50, 160, 100, 100); // starts inside `big` but its centre is below it
    expect(pickNeighbor(big, [overlapping], 'down')).toBe(0);
  });
});

describe('pickNearest', () => {
  it('picks the rect whose centre is closest', () => {
    const rs = [rect(0, 0, 10, 10), rect(100, 100, 10, 10), rect(48, 52, 10, 10)];
    expect(pickNearest(rect(50, 50, 10, 10), rs)).toBe(2);
    expect(pickNearest(rect(0, 0, 1, 1), [])).toBe(-1);
  });
});

describe('DirRepeat', () => {
  it('moves on the press, after the delay, then at the repeat rate', () => {
    const r = new DirRepeat();
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', REPEAT_DELAY_MS - 1)).toBeNull();
    expect(r.update('down', REPEAT_DELAY_MS)).toBe('down');
    expect(r.update('down', REPEAT_DELAY_MS + REPEAT_RATE_MS - 1)).toBeNull();
    expect(r.update('down', REPEAT_DELAY_MS + REPEAT_RATE_MS)).toBe('down');
    expect(r.update(null, 2000)).toBeNull();
    expect(r.update('left', 2001)).toBe('left');
  });

  it('a new direction moves at once and restarts the delay', () => {
    const r = new DirRepeat();
    r.update('down', 0);
    expect(r.update('right', 50)).toBe('right');
    expect(r.update('right', 50 + REPEAT_DELAY_MS - 1)).toBeNull();
  });

  it('ignores a direction held when navigation started until it is let go', () => {
    const r = new DirRepeat();
    r.suppress('up');
    expect(r.update('up', 0)).toBeNull();
    expect(r.update('up', 5000)).toBeNull();
    expect(r.update(null, 5001)).toBeNull();
    expect(r.update('up', 5002)).toBe('up');
  });
});

describe('stickDir', () => {
  it('uses the dominant axis outside the deadzone', () => {
    expect(stickDir(0.2, 0.1)).toBeNull();
    expect(stickDir(0.9, 0.3)).toBe('right');
    expect(stickDir(-0.9, 0.3)).toBe('left');
    expect(stickDir(0.3, 0.8)).toBe('down');
    expect(stickDir(0.3, -0.8)).toBe('up');
    expect(stickDir(Number.NaN, 0)).toBeNull();
  });
});

describe('readNavInput', () => {
  it('classic (SNES) layout: right face = activate, bottom face = back, Start activates too', () => {
    expect(readNavInput([pad([1])], false)).toMatchObject({ confirm: true, back: false });
    expect(readNavInput([pad([0])], false)).toMatchObject({ confirm: false, back: true });
    expect(readNavInput([pad([9])], false)).toMatchObject({ confirm: true, back: false });
    expect(readNavInput([pad([2, 3])], false)).toMatchObject({ confirm: false, back: false });
  });

  it('swapped face buttons: bottom = activate, right = back', () => {
    expect(readNavInput([pad([0])], true)).toMatchObject({ confirm: true, back: false });
    expect(readNavInput([pad([1])], true)).toMatchObject({ confirm: false, back: true });
  });

  it('reads the d-pad before the stick, and the right stick as scrolling', () => {
    expect(readNavInput([pad([13])], false).dir).toBe('down');
    expect(readNavInput([pad([14], [0.9, 0])], false).dir).toBe('left');
    expect(readNavInput([pad([], [0.9, 0])], false).dir).toBe('right');
    expect(readNavInput([pad([], [0, 0, 0, 0.8])], false)).toMatchObject({ dir: null, scroll: 0.8 });
    expect(readNavInput([pad([], [0, 0, 0, 0.1])], false).scroll).toBe(0);
  });

  it('merges several pads and names the one that did something', () => {
    const idle = pad([], [0, 0, 0, 0], { index: 0, id: 'Idle' });
    const busy = pad([1], [0, 0, 0, 0], { index: 2, id: 'Busy' });
    const got = readNavInput([idle, null, busy], false);
    expect(got.confirm).toBe(true);
    expect(got.active?.id).toBe('Busy');
    expect(readNavInput([idle], false).active).toBeNull();
  });

  it('ignores disconnected pads and counts analog presses past half way', () => {
    expect(readNavInput([pad([1], [0, 0, 0, 0], { connected: false })], false).confirm).toBe(false);
    const analog = pad();
    (analog.buttons as { pressed: boolean; value: number }[])[1] = { pressed: false, value: 0.8 };
    expect(readNavInput([analog], false).confirm).toBe(true);
    expect(readNavInput([], false)).toEqual({ dir: null, confirm: false, back: false, scroll: 0, active: null });
  });
});
