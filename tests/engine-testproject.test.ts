// The engine test project is valid and its rooms connect as intended.
import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/core/types';
import { createTestProject } from '../src/content/testProject';
import { findRoom, neighborRoom } from '../src/core/project';
import { validateProject } from '../src/core/validate';
import { ActiveRoom } from '../src/game/world';
import { T } from '../src/content/ids';

describe('createTestProject', () => {
  const p = createTestProject();

  it('validates without errors', () => {
    const errors = validateProject(p).filter((x) => x.level === 'error');
    expect(errors).toEqual([]);
  });

  it('only uses known tile ids', () => {
    const ids = new Set(p.tiles.map((t) => t.id));
    for (const w of p.worlds) {
      for (const r of w.rooms) {
        for (const layer of ['bg', 'fg', 'over'] as const) {
          for (const id of r.layers[layer]) if (id !== 0) expect(ids.has(id), `${r.id}.${layer} ${id}`).toBe(true);
        }
      }
    }
  });

  it('connects the overworld rooms through open edges', () => {
    const ow = p.worlds.find((w) => w.id === 'ow')!;
    const link = (from: string, dir: Dir, along: number, to: string) => {
      const room = findRoom(p, 'ow', from)!;
      expect(neighborRoom(ow, room, dir, along)?.id, `${from} ${dir} -> ${to}`).toBe(to);
      const rt = new ActiveRoom(p, ow, room);
      const edge = dir === 'up' ? { x: along, y: 4 } : dir === 'down' ? { x: along, y: rt.height - 4 }
        : dir === 'left' ? { x: 4, y: along } : { x: rt.width - 4, y: along };
      expect(rt.blocked({ x: edge.x - 6, y: edge.y - 6, w: 12, h: 12 }, 'player'), `${from} ${dir} edge open`).toBe(false);
    };
    link('ow_meadow', 'right', 110, 'ow_lake');
    link('ow_meadow', 'down', 128, 'ow_ledges');
    link('ow_lake', 'down', 128, 'ow_cross');
    link('ow_ledges', 'right', 70, 'ow_cross');
    link('ow_ledges', 'down', 128, 'ow_field');
    link('ow_cross', 'down', 128, 'ow_field');
    link('ow_field', 'up', 384, 'ow_cross');
  });

  it('has a hop-down ledge band, a hole, tall grass and a dark dungeon room', () => {
    const all = p.worlds.flatMap((w) => w.rooms);
    const bgHas = (id: number) => all.some((r) => r.layers.bg.includes(id));
    expect(bgHas(T.LEDGE_S!)).toBe(true);
    expect(bgHas(T.HOLE!)).toBe(true);
    expect(bgHas(T.TALL_GRASS!)).toBe(true);
    expect(bgHas(T.SHALLOW_WATER!)).toBe(true);
    expect(findRoom(p, 'dg', 'dg_dark')?.dark).toBe(true);
    expect(p.start).toMatchObject({ world: 'ow', room: 'ow_meadow' });
  });
});
