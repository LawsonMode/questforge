import { describe, expect, it } from 'vitest';
import type { Project, SpriteDef, TileDef } from '../src/core/types';
import { createBlankProject } from '../src/core/project';
import { T } from '../src/content/ids';
import { blankFrame } from '../src/gfx/pixels';
import {
  isDefaultSprite, isDefaultTile, paletteDeleteBlocker, paletteUsage, spriteDeleteBlocker, spriteUsage,
  tileDeleteBlocker, tileUsage,
} from '../src/editor/art/usage';

function project(): Project {
  const p = createBlankProject('Usage');
  p.tiles.push(customTile(1000));
  p.sprites.push(customSprite('custom.sprite1'));
  p.palettes.push({ id: 'pal.custom1', name: 'Mine', colors: new Array<string>(16).fill('#000000') });
  return p;
}

function customTile(id: number): TileDef {
  return { id, key: `TILE_${id}`, name: `Tile ${id}`, palette: 'pal.custom1', frames: [blankFrame(16, 16)], collision: 'floor', tags: [] };
}

function customSprite(id: string): SpriteDef {
  return { id, name: id, palette: 'pal.custom1', w: 16, h: 16, ox: 8, oy: 8, frames: [blankFrame(16, 16)], anims: {}, tags: [] };
}

const room = (p: Project) => p.worlds[0]!.rooms[0]!;

describe('art usage: built-in assets', () => {
  it('knows the fixed tile ids and engine sprite ids', () => {
    expect(isDefaultTile(T.GRASS!)).toBe(true);
    expect(isDefaultTile(1000)).toBe(false);
    expect(isDefaultSprite('hero')).toBe(true);
    expect(isDefaultSprite('custom.sprite1')).toBe(false);
  });

  it('never lets built-ins be deleted, even when unused', () => {
    const p = project();
    expect(tileDeleteBlocker(p, T.CAVE_EXIT!)).toMatch(/Built-in/);
    expect(spriteDeleteBlocker(p, 'fx.poof')).toMatch(/Built-in/);
  });
});

describe('art usage: tiles', () => {
  it('reports room cells, terrain slots and behaviours that reference a tile', () => {
    const p = project();
    const uses = tileUsage(p, T.GRASS!);
    expect(uses.some((u) => /Start: \d+ cells/.test(u))).toBe(true);
    expect(uses.some((u) => u.includes('Tile BUSH becomes it (cut, lift)'))).toBe(true);
    expect(tileUsage(p, T.WATER!).some((u) => u.startsWith('Terrain "Water": center'))).toBe(true);
  });

  it('allows deleting an unused custom tile', () => {
    expect(tileDeleteBlocker(project(), 1000)).toBeNull();
  });

  it('blocks deleting a custom tile painted in a room', () => {
    const p = project();
    room(p).layers.fg[5] = 1000;
    expect(tileDeleteBlocker(p, 1000)).toMatch(/Start: 1 cell/);
  });

  it('blocks deleting a tile used by a terrain, a behaviour or a setTile trigger', () => {
    let p = project();
    p.terrains[0]!.ise = 1000;
    expect(tileDeleteBlocker(p, 1000)).toMatch(/Terrain "Water": ise/);
    p = project();
    p.tiles.push({ ...customTile(1001), bomb: { to: 1000 } });
    expect(tileDeleteBlocker(p, 1000)).toMatch(/TILE_1001 becomes it \(bomb\)/);
    p = project();
    room(p).triggers.push({
      id: 't1', name: 'Open', on: 'enter', conditions: [], once: true,
      actions: [{ kind: 'setTile', layer: 'bg', tx: 1, ty: 1, tile: 1000 }],
    });
    expect(tileDeleteBlocker(p, 1000)).toMatch(/Trigger "Open"/);
  });
});

describe('art usage: sprites', () => {
  it('lists engine use and entity icons of built-in sprites', () => {
    const uses = spriteUsage(project(), 'enemy.soldier');
    expect(uses[0]).toMatch(/Built-in/);
    expect(uses).toContain('Entity icon: Soldier');
  });

  it('blocks deleting a custom sprite that a placed entity references', () => {
    const p = project();
    expect(spriteDeleteBlocker(p, 'custom.sprite1')).toBeNull();
    room(p).entities.push({ id: 'e1', type: 'npc.person', x: 40, y: 40, props: { sprite: 'custom.sprite1' } });
    expect(spriteDeleteBlocker(p, 'custom.sprite1')).toMatch(/Start: 1 entity/);
  });
});

describe('art usage: palettes', () => {
  it('lists the tiles and sprites drawn with a palette', () => {
    const p = project();
    const u = paletteUsage(p, 'pal.custom1');
    expect(u.tiles.map((t) => t.id)).toEqual([1000]);
    expect(u.sprites.map((s) => s.id)).toEqual(['custom.sprite1']);
  });

  it('counts palette-swap roles as uses', () => {
    const u = paletteUsage(project(), 'pal.soldier.blue');
    expect(u.refs).toContain('enemy.soldier variant "blue"');
    expect(paletteDeleteBlocker(project(), 'pal.soldier.blue')).toMatch(/variant "blue"/);
  });

  it('allows deleting an unused palette', () => {
    const p = project();
    p.tiles.pop();
    p.sprites.pop();
    expect(paletteDeleteBlocker(p, 'pal.custom1')).toBeNull();
  });
});
