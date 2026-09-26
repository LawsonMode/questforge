// Data layer: 13-piece terrain autotiling.
import { describe, expect, it } from 'vitest';
import type { Room, Terrain } from '../src/core/types';
import { createRoom } from '../src/core/project';
import {
  NB, isTerrainTile, neighborMask, paintTerrain, resolveRoomTerrain, resolveTerrainsAround, resolveTerrainTile,
} from '../src/core/autotile';

const TR: Terrain = {
  id: 'test', name: 'Test', layer: 'bg',
  center: 10, n: 11, s: 12, e: 13, w: 14, ne: 15, nw: 16, se: 17, sw: 18, ine: 19, inw: 20, ise: 21, isw: 22,
};
const GROUND = 1;
const ALL = 255;

function room(): Room {
  return createRoom({ name: 'R', gx: 0, gy: 0, fill: GROUND });
}

const at = (r: Room, tx: number, ty: number): number => r.layers.bg[ty * 16 + tx]!;

/** Paint a w x h block with its top-left at (x, y). */
function block(x: number, y: number, w: number, h: number): { tx: number; ty: number }[] {
  const cells: { tx: number; ty: number }[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) cells.push({ tx, ty });
  return cells;
}

describe('resolveTerrainTile', () => {
  const cases: [string, number, keyof Terrain][] = [
    ['surrounded', ALL, 'center'],
    ['edge N', ALL & ~NB.N, 'n'],
    ['edge S', ALL & ~NB.S, 's'],
    ['edge E', ALL & ~NB.E, 'e'],
    ['edge W', ALL & ~NB.W, 'w'],
    ['corner NE', ALL & ~(NB.N | NB.E), 'ne'],
    ['corner NW', ALL & ~(NB.N | NB.W), 'nw'],
    ['corner SE', ALL & ~(NB.S | NB.E), 'se'],
    ['corner SW', ALL & ~(NB.S | NB.W), 'sw'],
    ['inner NE', ALL & ~NB.NE, 'ine'],
    ['inner NW', ALL & ~NB.NW, 'inw'],
    ['inner SE', ALL & ~NB.SE, 'ise'],
    ['inner SW', ALL & ~NB.SW, 'isw'],
    ['edge wins over a missing diagonal', ALL & ~(NB.N | NB.SE), 'n'],
    ['corner ignores diagonals', NB.S | NB.W | NB.SW, 'ne'],
    ['opposite N+S -> n', ALL & ~(NB.N | NB.S), 'n'],
    ['opposite E+W -> w', ALL & ~(NB.E | NB.W), 'w'],
    ['isolated cell -> nw', 0, 'nw'],
    ['peninsula pointing S (N,E,W missing) -> nw', NB.S | NB.SE | NB.SW, 'nw'],
    ['peninsula pointing N (S,E,W missing) -> sw', NB.N | NB.NE | NB.NW, 'sw'],
    ['peninsula pointing E (N,S,W missing) -> nw', NB.E | NB.NE | NB.SE, 'nw'],
    ['peninsula pointing W (N,S,E missing) -> ne', NB.W | NB.NW | NB.SW, 'ne'],
    ['several missing diagonals -> first inner corner', ALL & ~(NB.SW | NB.NW), 'inw'],
  ];
  it.each(cases)('%s', (_label, mask, piece) => {
    expect(resolveTerrainTile(TR, mask)).toBe(TR[piece]);
  });
});

describe('membership', () => {
  it('isTerrainTile covers exactly the 13 pieces', () => {
    for (let id = 10; id <= 22; id++) expect(isTerrainTile(TR, id)).toBe(true);
    expect(isTerrainTile(TR, 9)).toBe(false);
    expect(isTerrainTile(TR, 23)).toBe(false);
    expect(isTerrainTile(TR, 0)).toBe(false);
  });

  it('neighborMask counts out-of-room neighbours as terrain', () => {
    const r = room();
    expect(neighborMask(r, TR, 0, 0)).toBe(NB.N | NB.NE | NB.NW | NB.W | NB.SW);
    expect(neighborMask(r, TR, 15, 13)).toBe(NB.S | NB.SE | NB.SW | NB.E | NB.NE);
    expect(neighborMask(r, TR, 5, 5)).toBe(0);
    r.layers.bg[4 * 16 + 5] = TR.s; // any piece counts
    r.layers.bg[6 * 16 + 6] = TR.center;
    expect(neighborMask(r, TR, 5, 5)).toBe(NB.N | NB.SE);
  });
});

describe('paintTerrain', () => {
  it('a 3x3 block gets corners, edges and a centre', () => {
    const r = room();
    paintTerrain(r, TR, block(4, 4, 3, 3));
    expect([at(r, 4, 4), at(r, 5, 4), at(r, 6, 4)]).toEqual([TR.nw, TR.n, TR.ne]);
    expect([at(r, 4, 5), at(r, 5, 5), at(r, 6, 5)]).toEqual([TR.w, TR.center, TR.e]);
    expect([at(r, 4, 6), at(r, 5, 6), at(r, 6, 6)]).toEqual([TR.sw, TR.s, TR.se]);
    expect(at(r, 3, 4)).toBe(GROUND);
    expect(at(r, 7, 7)).toBe(GROUND);
  });

  it('notched blocks produce every inner corner', () => {
    const r = room();
    paintTerrain(r, TR, block(2, 2, 5, 5));
    const changes = paintTerrain(r, TR, [{ tx: 6, ty: 2 }, { tx: 2, ty: 2 }, { tx: 6, ty: 6 }, { tx: 2, ty: 6 }], { erase: true, eraseTo: GROUND });
    expect(at(r, 5, 3)).toBe(TR.ine);
    expect(at(r, 3, 3)).toBe(TR.inw);
    expect(at(r, 5, 5)).toBe(TR.ise);
    expect(at(r, 3, 5)).toBe(TR.isw);
    expect(at(r, 4, 4)).toBe(TR.center);
    expect(at(r, 6, 2)).toBe(GROUND);
    // After erasing the corner, its former neighbours become outer corners.
    expect(at(r, 5, 2)).toBe(TR.ne);
    expect(at(r, 6, 3)).toBe(TR.ne);
    expect(changes.some((c) => c.tx === 6 && c.ty === 2 && c.after === GROUND)).toBe(true);
  });

  it('returns only changed cells with before/after, and repaint is a no-op', () => {
    const r = room();
    const first = paintTerrain(r, TR, [{ tx: 8, ty: 8 }]);
    expect(first).toEqual([{ layer: 'bg', tx: 8, ty: 8, before: GROUND, after: TR.nw }]);
    expect(paintTerrain(r, TR, [{ tx: 8, ty: 8 }])).toEqual([]);
    // (8,8) stays nw (N, S, W still open), so only the new cell is reported.
    expect(paintTerrain(r, TR, [{ tx: 9, ty: 8 }])).toEqual([{ layer: 'bg', tx: 9, ty: 8, before: GROUND, after: TR.ne }]);
    const third = paintTerrain(r, TR, [{ tx: 7, ty: 8 }]);
    expect(third).toHaveLength(2);
    expect(third).toContainEqual({ layer: 'bg', tx: 7, ty: 8, before: GROUND, after: TR.nw });
    expect(third).toContainEqual({ layer: 'bg', tx: 8, ty: 8, before: TR.nw, after: TR.n });
  });

  it('1-wide strips keep one consistent border side', () => {
    const r = room();
    paintTerrain(r, TR, block(3, 2, 1, 4));
    expect([at(r, 3, 2), at(r, 3, 3), at(r, 3, 4), at(r, 3, 5)]).toEqual([TR.nw, TR.w, TR.w, TR.sw]);
    paintTerrain(r, TR, block(6, 8, 4, 1));
    expect([at(r, 6, 8), at(r, 7, 8), at(r, 8, 8), at(r, 9, 8)]).toEqual([TR.nw, TR.n, TR.n, TR.ne]);
  });

  it('edge cells treat the room border as terrain', () => {
    const r = room();
    paintTerrain(r, TR, [{ tx: 0, ty: 0 }]);
    expect(at(r, 0, 0)).toBe(TR.se);
    paintTerrain(r, TR, block(0, 0, 16, 14));
    expect(r.layers.bg.every((v) => v === TR.center)).toBe(true);
  });

  it('erasing defaults to 0 and skips non-terrain cells', () => {
    const r = room();
    paintTerrain(r, TR, block(4, 4, 2, 1));
    const changes = paintTerrain(r, TR, [{ tx: 4, ty: 4 }, { tx: 10, ty: 10 }], { erase: true });
    expect(at(r, 4, 4)).toBe(0);
    expect(at(r, 10, 10)).toBe(GROUND);
    expect(at(r, 5, 4)).toBe(TR.nw); // now isolated
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual({ layer: 'bg', tx: 4, ty: 4, before: TR.nw, after: 0 });
    expect(changes).toContainEqual({ layer: 'bg', tx: 5, ty: 4, before: TR.ne, after: TR.nw });
  });

  it('ignores cells outside the room and works on other layers', () => {
    const r = room();
    const fgTerrain: Terrain = { ...TR, layer: 'fg' };
    const changes = paintTerrain(r, fgTerrain, [{ tx: -1, ty: 0 }, { tx: 16, ty: 3 }, { tx: 3, ty: 14 }, { tx: 1, ty: 1 }]);
    expect(changes).toEqual([{ layer: 'fg', tx: 1, ty: 1, before: 0, after: TR.nw }]);
    expect(r.layers.bg.every((v) => v === GROUND)).toBe(true);
  });
});

describe('resolveTerrainsAround', () => {
  const PATH: Terrain = {
    id: 'path', name: 'Path', layer: 'bg',
    center: 30, n: 31, s: 32, e: 33, w: 34, ne: 35, nw: 36, se: 37, sw: 38, ine: 39, inw: 40, ise: 41, isw: 42,
  };

  it('updates the borders of another terrain after painting over it', () => {
    const r = room();
    paintTerrain(r, TR, block(2, 2, 5, 5));
    expect(at(r, 4, 3)).toBe(TR.center);
    paintTerrain(r, PATH, [{ tx: 4, ty: 4 }]);
    expect(at(r, 4, 4)).toBe(PATH.nw);
    expect(at(r, 4, 3)).toBe(TR.center); // paintTerrain alone leaves the water stale
    const changes = resolveTerrainsAround(r, [TR, PATH], [{ tx: 4, ty: 4 }]);
    expect(at(r, 4, 3)).toBe(TR.s);
    expect(at(r, 4, 5)).toBe(TR.n);
    expect(at(r, 3, 4)).toBe(TR.e);
    expect(at(r, 5, 4)).toBe(TR.w);
    expect(at(r, 3, 3)).toBe(TR.ise);
    expect(at(r, 4, 4)).toBe(PATH.nw);
    expect(changes).toHaveLength(8);
    expect(changes).toContainEqual({ layer: 'bg', tx: 4, ty: 3, before: TR.center, after: TR.s });
    expect(resolveTerrainsAround(r, [TR, PATH], [{ tx: 4, ty: 4 }])).toEqual([]);
  });

  it('ignores cells outside the room', () => {
    const r = room();
    expect(resolveTerrainsAround(r, [TR], [{ tx: -3, ty: 0 }, { tx: 99, ty: 99 }])).toEqual([]);
  });
});

describe('resolveRoomTerrain', () => {
  it('re-resolves raw terrain cells in the whole room or a rect', () => {
    const r = room();
    for (const { tx, ty } of block(2, 2, 3, 3)) r.layers.bg[ty * 16 + tx] = TR.center;
    for (const { tx, ty } of block(10, 2, 3, 3)) r.layers.bg[ty * 16 + tx] = TR.center;
    const partial = resolveRoomTerrain(r, TR, { tx: 0, ty: 0, w: 8, h: 14 });
    expect(partial).toHaveLength(8);
    expect(at(r, 2, 2)).toBe(TR.nw);
    expect(at(r, 10, 2)).toBe(TR.center);
    const rest = resolveRoomTerrain(r, TR);
    expect(rest).toHaveLength(8);
    expect(at(r, 12, 4)).toBe(TR.se);
    expect(resolveRoomTerrain(r, TR)).toEqual([]);
  });

  it('clips rects to the room', () => {
    const r = room();
    r.layers.bg[0] = TR.center;
    expect(resolveRoomTerrain(r, TR, { tx: -5, ty: -5, w: 100, h: 100 })).toEqual([
      { layer: 'bg', tx: 0, ty: 0, before: TR.center, after: TR.se },
    ]);
  });
});
