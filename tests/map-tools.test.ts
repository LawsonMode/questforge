// Map editor: pure tool logic — stroke interpolation, rectangles, flood fill,
// marquee copy/paste, entity snapping & hit-testing, eyedropper picking.
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Room } from '../src/core/types';
import type { EntityBox } from '../src/editor/map/roomRender';
import type { ToolHost } from '../src/editor/map/tools/tool';
import { createRoom, resizeRoom, roomCols } from '../src/core/project';
import { T } from '../src/content/ids';
import {
  clampAxis, clipRect, dominantTile, floodRegion, lineCells, rectBetween, rectCells, snapAxis, strokeCells,
} from '../src/editor/map/geometry';
import { TileEdit, applyChanges } from '../src/editor/map/tileEdit';
import { clearRegion, clipTargets, copyRegion, pasteClip } from '../src/editor/map/clipboard';
import { fillIndices, topTile } from '../src/editor/map/tools/paint';
import { SelectTool, pasteOrigin } from '../src/editor/map/tools/select';
import { hitEntity, insideRoom, nearestWall, newInstance, snapModeFor, snapPoint } from '../src/editor/map/tools/entityTool';
import { terrainEraseTo } from '../src/editor/map/tools/terrain';
import { toolForKey } from '../src/editor/map/tools/tool';

const GRASS = T.GRASS!;
const SAND = T.SAND!;
const BUSH = T.BUSH!;

function room(fill = GRASS): Room {
  return createRoom({ name: 'R', gx: 0, gy: 0, fill });
}

const at = (r: Room, layer: 'bg' | 'fg' | 'over', tx: number, ty: number): number => r.layers[layer][ty * roomCols(r) + tx]!;

describe('stroke interpolation', () => {
  it('lineCells includes both ends and never skips a cell', () => {
    for (const [ax, ay, bx, by] of [[0, 0, 7, 3], [5, 5, 0, 0], [2, 9, 2, 1], [0, 0, -4, 6]] as const) {
      const cells = lineCells(ax, ay, bx, by);
      expect(cells[0]).toEqual({ tx: ax, ty: ay });
      expect(cells.at(-1)).toEqual({ tx: bx, ty: by });
      expect(cells.length).toBe(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) + 1);
      for (let i = 1; i < cells.length; i++) {
        expect(Math.abs(cells[i]!.tx - cells[i - 1]!.tx)).toBeLessThanOrEqual(1);
        expect(Math.abs(cells[i]!.ty - cells[i - 1]!.ty)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('strokeCells starts with the pressed cell and then fills gaps without repeating the previous sample', () => {
    expect(strokeCells(null, { tx: 3, ty: 4 })).toEqual([{ tx: 3, ty: 4 }]);
    expect(strokeCells({ tx: 3, ty: 4 }, { tx: 3, ty: 4 })).toEqual([]);
    expect(strokeCells({ tx: 0, ty: 0 }, { tx: 4, ty: 0 })).toEqual([1, 2, 3, 4].map((tx) => ({ tx, ty: 0 })));
  });
});

describe('rectangles', () => {
  it('normalises corners and clips to the room', () => {
    expect(rectBetween({ tx: 5, ty: 1 }, { tx: 2, ty: 3 })).toEqual({ x: 2, y: 1, w: 4, h: 3 });
    expect(clipRect({ x: -2, y: 12, w: 5, h: 5 }, 16, 14)).toEqual({ x: 0, y: 12, w: 3, h: 2 });
    expect(clipRect({ x: 20, y: 0, w: 2, h: 2 }, 16, 14)).toBeNull();
  });

  it('rectCells lists all cells or just the outline', () => {
    const r = { x: 1, y: 1, w: 4, h: 3 };
    expect(rectCells(r)).toHaveLength(12);
    const outline = rectCells(r, true);
    expect(outline).toHaveLength(10);
    expect(outline).not.toContainEqual({ tx: 2, ty: 2 });
  });
});

describe('flood fill', () => {
  it('fills the 4-connected region of equal ids only', () => {
    // 5x3 grid: a wall column of 9s splits the 1s; diagonals do not connect.
    const data = [
      1, 1, 9, 1, 1,
      1, 9, 9, 1, 1,
      9, 1, 9, 1, 1,
    ];
    expect(floodRegion(data, 5, 3, 0, 0).sort((a, b) => a - b)).toEqual([0, 1, 5]);
    expect(floodRegion(data, 5, 3, 4, 2)).toHaveLength(6);
    expect(floodRegion(data, 5, 3, 9, 9)).toEqual([]);
  });

  it('shift-fill replaces the tile everywhere', () => {
    const data = [1, 2, 1, 2, 1, 1];
    expect(fillIndices(data, 3, 2, 0, 0, true)).toEqual([0, 2, 4, 5]);
    expect(fillIndices(data, 3, 2, 0, 0, false)).toEqual([0]);
  });
});

describe('tile edits', () => {
  it('records the original value once, reports net changes and undoes them', () => {
    const r = room();
    const touched: number[] = [];
    const edit = new TileEdit(r, (_layer, i) => touched.push(i));
    edit.set('bg', 1, 1, SAND);
    edit.set('bg', 1, 1, BUSH);
    edit.set('bg', 2, 1, SAND);
    edit.set('bg', 2, 1, GRASS); // back to the original: no net change
    edit.set('bg', 99, 1, SAND); // outside: ignored
    const changes = edit.changes();
    expect(changes).toEqual([{ layer: 'bg', index: 16 + 1, before: GRASS, after: BUSH }]);
    expect(touched.length).toBe(4);
    applyChanges(r, changes, false);
    expect(at(r, 'bg', 1, 1)).toBe(GRASS);
    applyChanges(r, changes, true);
    expect(at(r, 'bg', 1, 1)).toBe(BUSH);
  });

  it('revert() puts every touched cell back and leaves no changes (Esc mid-stroke)', () => {
    const r = room();
    const touched: number[] = [];
    const edit = new TileEdit(r, (_layer, i) => touched.push(i));
    edit.set('bg', 3, 2, SAND);
    edit.set('fg', 4, 2, BUSH);
    touched.length = 0;
    edit.revert();
    expect(at(r, 'bg', 3, 2)).toBe(GRASS);
    expect(at(r, 'fg', 4, 2)).toBe(0);
    expect(touched.sort((a, b) => a - b)).toEqual([2 * 16 + 3, 2 * 16 + 4]);
    expect(edit.changes()).toEqual([]);
  });
});

describe('marquee copy / paste', () => {
  it('copies a single layer and pastes it onto the active layer with 0 as transparent', () => {
    const r = room();
    r.layers.fg[1 * 16 + 1] = BUSH;
    r.layers.fg[2 * 16 + 2] = BUSH;
    const clip = copyRegion(r, { x: 1, y: 1, w: 2, h: 2 }, ['fg']);
    expect(clip).toEqual({ w: 2, h: 2, layers: { fg: [BUSH, 0, 0, BUSH] }, project: '', defs: {} });
    expect(clipTargets(clip, 'over')).toEqual([['fg', 'over']]);
    r.layers.over[6 * 16 + 6] = SAND; // (6, 6) would be under the clip's transparent cell
    const edit = new TileEdit(r);
    pasteClip(edit, clip, 5, 5, 'over');
    expect(at(r, 'over', 5, 5)).toBe(BUSH);
    expect(at(r, 'over', 6, 6)).toBe(BUSH);
    expect(at(r, 'over', 6, 5)).toBe(0);
    expect(edit.changes()).toHaveLength(2);
  });

  it('multi-layer clips keep their layers; pasting off the edge drops outside cells; clear empties', () => {
    const r = room();
    r.layers.fg[0] = BUSH;
    const clip = copyRegion(r, { x: 0, y: 0, w: 2, h: 1 }, ['bg', 'fg']);
    expect(clipTargets(clip, 'over')).toEqual([['bg', 'bg'], ['fg', 'fg']]);
    const edit = new TileEdit(r);
    pasteClip(edit, clip, 15, 13, 'over');
    expect(at(r, 'fg', 15, 13)).toBe(BUSH);
    clearRegion(edit, { x: 0, y: 0, w: 1, h: 1 }, ['bg', 'fg']);
    expect(at(r, 'bg', 0, 0)).toBe(0);
    expect(at(r, 'fg', 0, 0)).toBe(0);
  });

  it('centres a pasted clip on the cursor cell', () => {
    expect(pasteOrigin({ tx: 10, ty: 10 }, 1, 1)).toEqual({ tx: 10, ty: 10 });
    expect(pasteOrigin({ tx: 10, ty: 10 }, 3, 3)).toEqual({ tx: 9, ty: 9 });
    expect(pasteOrigin({ tx: 10, ty: 10 }, 4, 2)).toEqual({ tx: 9, ty: 10 });
  });

  it('never wraps a rect wider than the room into the next row', () => {
    const r = room();
    r.layers.bg[0 * 16 + 15] = SAND; // last cell of row 0
    r.layers.bg[1 * 16 + 0] = BUSH; // first cell of row 1: what a wrapped copy of (16, 0) would read
    const clip = copyRegion(r, { x: 14, y: 0, w: 18, h: 2 }, ['bg']);
    expect(clip.w).toBe(2);
    expect(clip.h).toBe(2);
    expect(clip.layers.bg).toEqual([GRASS, SAND, GRASS, GRASS]);
    expect(copyRegion(r, { x: 20, y: 0, w: 4, h: 4 }, ['bg'])).toEqual({ w: 0, h: 0, layers: { bg: [] }, project: '', defs: {} });
  });

  it('drops a marquee once its room is resized, so a stale rect is never copied', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0, gw: 2, fill: GRASS });
    const flashes: string[] = [];
    const host = {
      ctx: { layer: 'bg' }, room: () => r, redraw: () => undefined, flash: (m: string) => flashes.push(m),
    } as unknown as ToolHost;
    const tool = new SelectTool();
    tool.selectAll(host, false);
    expect(tool.hint(host)).toContain('32×14 tiles');
    resizeRoom(r, 1, 1, GRASS);
    expect(tool.hint(host)).not.toContain('tiles on');
    const ctrlC = { ctrlKey: true, metaKey: false, code: 'KeyC', key: 'c' } as KeyboardEvent;
    expect(tool.key(ctrlC, host)).toBe(true);
    expect(flashes.at(-1)).toMatch(/Select an area first/);
  });

  it('leaves paste mode when another tool takes over, and shows the paste hint at once', () => {
    const r = room();
    let cleared = 0;
    const host = {
      ctx: { layer: 'bg' }, room: () => r, redraw: () => undefined, flash: () => undefined, clearFlash: () => { cleared++; },
    } as unknown as ToolHost;
    const tool = new SelectTool();
    tool.selectAll(host, false);
    expect(tool.key({ ctrlKey: true, metaKey: false, code: 'KeyC', key: 'c' } as KeyboardEvent, host)).toBe(true);
    expect(tool.startPaste(host)).toBe(true);
    expect(cleared).toBe(1);
    expect(tool.hint(host)).toMatch(/^Paste/);
    expect(tool.cursor()).toBe('copy');
    tool.deactivate();
    expect(tool.hint(host)).not.toMatch(/^Paste/);
    expect(tool.cursor()).toBe('crosshair');
  });
});

describe('eyedropper', () => {
  it('picks the top-most non-zero tile among visible layers', () => {
    const r = room();
    r.layers.fg[3 * 16 + 3] = BUSH;
    expect(topTile(r, 3, 3, ['bg', 'fg', 'over'])).toEqual({ layer: 'fg', id: BUSH });
    expect(topTile(r, 3, 3, ['bg'])).toEqual({ layer: 'bg', id: GRASS });
    expect(topTile(r, 4, 3, ['fg', 'over'])).toBeNull();
    expect(topTile(r, -1, 3, ['bg'])).toBeNull();
  });
});

describe('entity snapping', () => {
  it('snaps 1-tile footprints to tile centres and 2-tile footprints to tile edges', () => {
    expect(snapAxis(37, 16)).toBe(40);
    expect(snapAxis(37, 12)).toBe(40);
    expect(snapAxis(37, 32)).toBe(32);
    expect(snapAxis(37, 16, 8)).toBe(40);
    expect(snapAxis(35, 16, 8)).toBe(32);
    expect(snapAxis(37.4, 16, 1)).toBe(37);
  });

  it('keeps footprints inside the room', () => {
    expect(clampAxis(2, 16, 256)).toBe(8);
    expect(clampAxis(255, 32, 256)).toBe(240);
    expect(snapPoint(1, 300, { w: 16, h: 16 }, 256, 224, 'tile')).toEqual({ x: 8, y: 216 });
  });

  it('only places entities from clicks inside the room', () => {
    const r = room();
    expect(insideRoom(r, { x: 0, y: 0 })).toBe(true);
    expect(insideRoom(r, { x: 255.9, y: 223.9 })).toBe(true);
    expect(insideRoom(r, { x: 100, y: 224 })).toBe(false); // the neighbour strip below
    expect(insideRoom(r, { x: -3, y: 50 })).toBe(false);
    expect(insideRoom(null, { x: 10, y: 10 })).toBe(false);
  });

  it('maps modifiers to snap modes', () => {
    expect(snapModeFor({ shift: false, ctrl: false })).toBe('tile');
    expect(snapModeFor({ shift: true, ctrl: false })).toBe(8);
    expect(snapModeFor({ shift: true, ctrl: true })).toBe(1);
  });

  it('new doors face the nearest wall and straddle two tiles on it', () => {
    const r = room();
    expect(nearestWall(128, 5, 256, 224)).toBe('up');
    expect(nearestWall(250, 100, 256, 224)).toBe('right');
    const door = newInstance('obj.door', 130, 6, r, 'tile');
    expect(door.props.dir).toBe('up');
    expect(door).toMatchObject({ x: 128, y: 8 });
    const side = newInstance('obj.door', 3, 100, r, 'tile');
    expect(side.props.dir).toBe('left');
    expect(side).toMatchObject({ x: 8, y: 96 });
    const chest = newInstance('obj.chest', 50, 50, r, 'tile');
    expect(chest).toMatchObject({ x: 56, y: 56, props: { item: 'rupees', amount: 1 } });
    expect(chest.id).toMatch(/^e_/);
  });

  it('hit-testing prefers real entities over markers covering them', () => {
    const inst = (id: string): EntityInstance => ({ id, type: 'x', x: 0, y: 0, props: {} });
    const boxes: EntityBox[] = [
      { inst: inst('enemy'), x: 40, y: 40, w: 16, h: 16, marker: false },
      { inst: inst('region'), x: 0, y: 0, w: 128, h: 128, marker: true },
    ];
    expect(hitEntity(boxes, 45, 45)?.inst.id).toBe('enemy');
    expect(hitEntity(boxes, 100, 100)?.inst.id).toBe('region');
    expect(hitEntity(boxes, 200, 200)).toBeNull();
  });
});

describe('terrain erase & tools', () => {
  it('erasing a ground terrain restores the most common non-terrain tile', () => {
    const r = room(T.DFLOOR!);
    for (let i = 0; i < 40; i++) r.layers.bg[i] = T.PIT!;
    const pit = { id: 'pit', name: 'Pit', layer: 'bg' as const, center: T.PIT!, n: T.PIT_N!, s: T.PIT_S!, e: T.PIT_E!, w: T.PIT_W!, ne: T.PIT_NE!, nw: T.PIT_NW!, se: T.PIT_SE!, sw: T.PIT_SW!, ine: T.PIT_INE!, inw: T.PIT_INW!, ise: T.PIT_ISE!, isw: T.PIT_ISW! };
    expect(terrainEraseTo(r, pit, [pit])).toBe(T.DFLOOR);
    expect(terrainEraseTo(r, { ...pit, layer: 'fg' }, [pit])).toBe(0);
    expect(dominantTile([0, 0, 0, 5, 5, 7])).toBe(5);
  });

  it('maps shortcut letters to tools', () => {
    expect(toolForKey('p')).toBe('pencil');
    expect(toolForKey('B')).toBe('pencil');
    expect(toolForKey('t')).toBe('terrain');
    expect(toolForKey('n')).toBe('entity');
    expect(toolForKey('q')).toBeNull();
  });
});
