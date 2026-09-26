// Edge / neighbour maths for room scrolls, and the transition timelines.
import { describe, expect, it, vi } from 'vitest';
import type { Room, World } from '../src/core/types';
import {
  FADE_HALF, IRIS_HALF, SCROLL_CARRY, SCROLL_TIME, ScrollTransition, WarpTransition,
  easeInOut, edgeAlong, edgeExit, roomOffset, roomSizePx, roomsAlongScroll, scrollCameraEnd, scrollEntry,
} from '../src/game/transitions';

function room(gx: number, gy: number, gw = 1, gh = 1): Room {
  return {
    id: `r${gx}_${gy}`, name: '', gx, gy, gw, gh, floor: 0,
    layers: { bg: [], fg: [], over: [] }, entities: [], triggers: [],
  };
}

describe('edge maths', () => {
  it('edgeExit reports the crossed edge of the half-open room rect', () => {
    expect(edgeExit(10, 10, 256, 224)).toBeNull();
    expect(edgeExit(10, -0.5, 256, 224)).toBe('up');
    expect(edgeExit(10, 224, 256, 224)).toBe('down');
    expect(edgeExit(-1, 100, 256, 224)).toBe('left');
    expect(edgeExit(256, 100, 256, 224)).toBe('right');
    expect(edgeExit(255.9, 223.9, 256, 224)).toBeNull();
  });

  it('edgeAlong picks and clamps the coordinate along the edge', () => {
    expect(edgeAlong('up', 300, 5, 512, 224)).toBe(300);
    expect(edgeAlong('down', 600, 5, 512, 224)).toBe(511);
    expect(edgeAlong('left', -3, 100, 256, 448)).toBe(100);
    expect(edgeAlong('right', 260, -2, 256, 448)).toBe(0);
  });

  it('roomOffset and roomSizePx use the screen grid', () => {
    expect(roomOffset(room(0, 0), room(1, 0))).toEqual({ x: 256, y: 0 });
    expect(roomOffset(room(1, 1), room(0, 2, 2))).toEqual({ x: -256, y: 224 });
    expect(roomSizePx(room(0, 0, 2, 3))).toEqual({ w: 512, h: 672 });
  });
});

describe('scrollEntry', () => {
  it('carries the player into the room to the right, keeping y', () => {
    expect(scrollEntry(room(0, 0), room(1, 0), 'right', 257, 100)).toEqual({ x: SCROLL_CARRY, y: 100 });
  });

  it('carries the player into the room to the left and above', () => {
    expect(scrollEntry(room(1, 0), room(0, 0), 'left', -1, 90)).toEqual({ x: 256 - SCROLL_CARRY, y: 90 });
    expect(scrollEntry(room(0, 1), room(0, 0), 'up', 120, -1)).toEqual({ x: 120, y: 224 - SCROLL_CARRY });
  });

  it('maps positions along the edge between rooms of different sizes', () => {
    // one-screen room above the right half of a 2x1 room
    expect(scrollEntry(room(1, 1), room(0, 2, 2), 'down', 120, 225)).toEqual({ x: 376, y: SCROLL_CARRY });
    expect(scrollEntry(room(0, 2, 2), room(1, 1), 'up', 300, -1)).toEqual({ x: 44, y: 224 - SCROLL_CARRY });
    // tall room to the left of the lower of two stacked rooms
    expect(scrollEntry(room(1, 1), room(0, 0, 1, 2), 'left', -1, 50)).toEqual({ x: 256 - SCROLL_CARRY, y: 274 });
  });

  it('keeps the landing spot away from the new room side edges', () => {
    expect(scrollEntry(room(0, 0), room(1, 0), 'right', 257, 223)).toEqual({ x: SCROLL_CARRY, y: 216 });
    expect(scrollEntry(room(0, 1), room(0, 0), 'up', 2, -1)).toEqual({ x: 8, y: 224 - SCROLL_CARRY });
  });
});

describe('scroll camera', () => {
  it('keeps the camera continuous across the scroll axis when the new room allows it', () => {
    // 1x1 room at gx=1 scrolling down into a 2x1 room at gx=0: camera x stays at world 256
    const end = scrollCameraEnd('down', { x: 0, y: 0 }, { x: -256, y: 224 }, { x: 376, y: 10 }, room(0, 2, 2));
    expect(end).toEqual({ x: 256, y: 0 });
  });

  it('clamps into the new room and frames the landing spot along the axis', () => {
    // 2x1 room (camera at 149) scrolling up into a 1x1 room at gx=1
    expect(scrollCameraEnd('up', { x: 149, y: 0 }, { x: 256, y: -224 }, { x: 44, y: 200 }, room(1, 1))).toEqual({ x: 0, y: 0 });
    // horizontal scroll into a tall room: y kept, x framed
    expect(scrollCameraEnd('left', { x: 0, y: 0 }, { x: -256, y: -224 }, { x: 240, y: 300 }, room(0, 0, 1, 2))).toEqual({ x: 0, y: 224 });
  });

  it('lists the other rooms a sliding camera passes over', () => {
    const a = room(0, 1);
    const b = room(1, 1);
    const wide = room(0, 2, 2);
    const far = room(3, 3);
    const world: World = { id: 'w', name: 'w', kind: 'overworld', music: 'overworld', rooms: [a, b, wide, far] };
    // from the 2x1 room (camera x 149) up into b: the camera slides right, over room a's corner
    const got = roomsAlongScroll(world, wide, b, { x: 149, y: 0 }, { x: 0, y: 0 });
    expect(got.map((o) => o.room)).toEqual([a]);
    expect(got[0]!.offset).toEqual({ x: 0, y: -224 });
    // a straight scroll only sees the two rooms involved
    expect(roomsAlongScroll(world, a, wide, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });
});

describe('ScrollTransition', () => {
  const setup = {
    fromCam: { x: 0, y: 0 },
    toCam: { x: 0, y: 0 },
    offset: { x: 256, y: 0 },
    playerFrom: { x: 256, y: 100 },
    playerTo: { x: 16, y: 100 },
  };

  it('lasts SCROLL_TIME and eases the camera across', () => {
    const t = new ScrollTransition(setup);
    expect(t.camera()).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < Math.round(SCROLL_TIME * 60) - 1; i++) t.update(1 / 60);
    expect(t.done).toBe(false);
    t.update(1 / 60);
    expect(t.done).toBe(true);
    expect(t.camera()).toEqual({ x: 256, y: 0 });
    expect(t.playerPos()).toEqual({ x: 272, y: 100 });
  });

  it('paints each room with the player at the interpolated position in its own coordinates', () => {
    const t = new ScrollTransition(setup);
    t.update(SCROLL_TIME / 2);
    const calls: [string, number, number, { x: number; y: number }][] = [];
    t.draw(
      (x, y, p) => calls.push(['old', x, y, p]),
      (x, y, p) => calls.push(['new', x, y, p]),
    );
    const cam = t.camera();
    const pp = t.playerPos();
    expect(calls[0]).toEqual(['old', cam.x, cam.y, pp]);
    expect(calls[1]).toEqual(['new', cam.x - 256, cam.y, { x: pp.x - 256, y: pp.y }]);
    // the same screen position either way
    const [, ox, , op] = calls[0]!;
    const [, nx, , np] = calls[1]!;
    expect(op.x - ox).toBeCloseTo(np.x - nx);
  });

  it('easeInOut is monotonic from 0 to 1', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });
});

describe('WarpTransition', () => {
  it('fades out, loads once at full cover, then fades in', () => {
    const mid = vi.fn();
    const t = new WarpTransition('fade', mid);
    expect(t.cover).toBe(0);
    t.update(FADE_HALF / 2);
    expect(t.cover).toBeCloseTo(0.5);
    expect(mid).not.toHaveBeenCalled();
    t.update(FADE_HALF / 2 + 1e-9);
    expect(mid).toHaveBeenCalledTimes(1);
    expect(t.cover).toBe(1);
    t.update(FADE_HALF + 1e-9);
    expect(t.done).toBe(true);
    expect(mid).toHaveBeenCalledTimes(1);
  });

  it('iris halves are longer than fades', () => {
    const t = new WarpTransition('iris', () => {});
    t.update(FADE_HALF + 0.01);
    expect(t.done).toBe(false);
    expect(IRIS_HALF).toBeGreaterThan(FADE_HALF);
  });
});
