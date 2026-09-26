// Data layer: project construction, lookups, grid neighbours, resize, (de)serialisation.
import { describe, expect, it } from 'vitest';
import type { Dir, Room, World } from '../src/core/types';
import {
  cloneProject, createBlankProject, createRoom, createWorld, dialogueById, findEntityInstance, findRoom, findWorld,
  gridOverlaps, locateRoom, neighborRoom, newId, nextTileId, paletteById, parseProject, resizeRoom, roomAtGrid,
  roomCols, roomRows, serializeProject, spriteById, tileById, touchProject,
} from '../src/core/project';
import { validateProject } from '../src/core/validate';
import { defaultProps } from '../src/core/catalog';
import { T } from '../src/content/ids';

function worldWith(...rooms: Room[]): World {
  const w = createWorld({ name: 'W', kind: 'overworld' });
  w.rooms.push(...rooms);
  return w;
}

describe('ids & sizes', () => {
  it('newId has a prefix and 8 base36 chars and is unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newId('e');
      expect(id).toMatch(/^e_[0-9a-z]{8}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });

  it('room cols/rows follow screens', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0, gw: 3, gh: 2 });
    expect(roomCols(r)).toBe(48);
    expect(roomRows(r)).toBe(28);
  });

  it('createRoom sizes all layers and fills bg only', () => {
    const r = createRoom({ name: 'R', gx: 2, gy: 1, gw: 2, gh: 1, fill: 7, floor: -1 });
    expect(r.layers.bg).toHaveLength(32 * 14);
    expect(r.layers.fg).toHaveLength(32 * 14);
    expect(r.layers.over).toHaveLength(32 * 14);
    expect(r.layers.bg.every((v) => v === 7)).toBe(true);
    expect(r.layers.fg.every((v) => v === 0)).toBe(true);
    expect(r.floor).toBe(-1);
    expect(r.id).toMatch(/^r_/);
    expect(r.entities).toEqual([]);
    expect(r.triggers).toEqual([]);
  });

  it('createRoom clamps sizes to 1..4 screens', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0, gw: 9, gh: 0 });
    expect([r.gw, r.gh]).toEqual([4, 1]);
    expect(r.layers.bg).toHaveLength(64 * 14);
  });

  it('createWorld picks default music by kind', () => {
    expect(createWorld({ name: 'a', kind: 'overworld' }).music).toBe('overworld');
    expect(createWorld({ name: 'b', kind: 'dungeon' }).music).toBe('dungeon');
    expect(createWorld({ name: 'c', kind: 'interior' }).music).toBe('house');
    expect(createWorld({ name: 'd', kind: 'interior', music: 'none' }).music).toBe('none');
  });
});

describe('blank project', () => {
  const p = createBlankProject('My Quest');

  it('has default assets, one world and a centred start', () => {
    expect(p.format).toBe('questforge');
    expect(p.author).toBe('You');
    expect(p.tiles.length).toBeGreaterThan(100);
    expect(p.sprites.length).toBeGreaterThan(10);
    expect(p.terrains.length).toBe(4);
    expect(p.worlds).toHaveLength(1);
    const world = p.worlds[0]!;
    expect(world.kind).toBe('overworld');
    expect(world.name).toBe('Overworld');
    expect(world.rooms).toHaveLength(1);
    const room = world.rooms[0]!;
    expect(room.name).toBe('Start');
    expect(p.start).toEqual({ world: world.id, room: room.id, x: 128, y: 112, dir: 'down' });
    expect(p.settings).toEqual({ title: 'My Quest', subtitle: '', startHearts: 3, startItems: { sword: 1, shield: 1 }, titleMusic: 'title' });
    expect(p.flags).toEqual([]);
  });

  it('is grassy with some decoration and a clear centre', () => {
    const room = p.worlds[0]!.rooms[0]!;
    const counts = new Map<number, number>();
    for (const id of room.layers.bg) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.get(T.GRASS!)).toBeGreaterThan(180);
    expect(counts.get(T.BUSH!)).toBeGreaterThan(0);
    expect(counts.get(T.FLOWERS!)).toBeGreaterThan(0);
    expect(room.layers.bg[7 * 16 + 8]).toBe(T.GRASS);
  });

  it('validates with zero errors and zero warnings', () => {
    expect(validateProject(p)).toEqual([]);
  });

  it('uses the given author', () => {
    expect(createBlankProject('x', 'Ada').author).toBe('Ada');
  });

  it('clone is deep', () => {
    const c = cloneProject(p);
    c.worlds[0]!.rooms[0]!.layers.bg[0] = 999;
    expect(p.worlds[0]!.rooms[0]!.layers.bg[0]).not.toBe(999);
  });

  it('touch updates modified', () => {
    const c = cloneProject(p);
    c.modified = 0;
    touchProject(c);
    expect(c.modified).toBeGreaterThan(0);
  });
});

describe('lookups', () => {
  const p = createBlankProject('L');
  const world = p.worlds[0]!;
  const room = world.rooms[0]!;
  room.entities.push({ id: 'e_chest', type: 'obj.chest', x: 40, y: 40, props: {} });
  p.dialogues.push({ id: 'd_hi', name: 'Hi', pages: [{ text: 'hello' }] });

  it('find world / room / entity', () => {
    expect(findWorld(p, world.id)).toBe(world);
    expect(findWorld(p, 'nope')).toBeUndefined();
    expect(findRoom(p, world.id, room.id)).toBe(room);
    expect(findRoom(p, 'nope', room.id)).toBeUndefined();
    expect(locateRoom(p, room.id)).toEqual({ world, room });
    expect(locateRoom(p, 'nope')).toBeUndefined();
    expect(findEntityInstance(p, 'e_chest')?.entity.type).toBe('obj.chest');
    expect(findEntityInstance(p, 'missing')).toBeUndefined();
  });

  it('asset lookups', () => {
    expect(tileById(p, T.GRASS!)?.key).toBe('GRASS');
    expect(tileById(p, 0)).toBeUndefined();
    expect(spriteById(p, 'hero')?.id).toBe('hero');
    const pal = p.tiles[0]!.palette;
    expect(paletteById(p, pal)?.id).toBe(pal);
    expect(dialogueById(p, 'd_hi')?.name).toBe('Hi');
    expect(dialogueById(p, 'd_no')).toBeUndefined();
  });

  it('stays correct after in-place edits (cache is verified)', () => {
    expect(dialogueById(p, 'd_hi')).toBeDefined();
    p.dialogues.unshift({ id: 'd_new', name: 'New', pages: [] });
    expect(dialogueById(p, 'd_hi')?.name).toBe('Hi');
    expect(dialogueById(p, 'd_new')?.name).toBe('New');
    p.dialogues.splice(1, 1);
    expect(dialogueById(p, 'd_hi')).toBeUndefined();
    p.dialogues[0]!.id = 'd_renamed';
    expect(dialogueById(p, 'd_new')).toBeUndefined();
    expect(dialogueById(p, 'd_renamed')?.name).toBe('New');
  });

  it('tile misses are cached but pick up pushed and removed tiles', () => {
    const c = cloneProject(p);
    expect(tileById(c, 4242)).toBeUndefined();
    expect(tileById(c, 4242)).toBeUndefined();
    c.tiles.push({ ...c.tiles[0]!, id: 4242, key: 'NEW' });
    expect(tileById(c, 4242)?.key).toBe('NEW');
    const at = c.tiles.findIndex((t) => t.id === T.GRASS);
    c.tiles.splice(at, 1);
    expect(tileById(c, T.GRASS!)).toBeUndefined();
    expect(tileById(c, 4242)?.key).toBe('NEW');
    c.tiles = [...c.tiles, { ...c.tiles[0]!, id: T.GRASS!, key: 'GRASS2' }];
    expect(tileById(c, T.GRASS!)?.key).toBe('GRASS2');
  });

  it('nextTileId is the lowest free id >= 1000', () => {
    const c = cloneProject(p);
    expect(nextTileId(c)).toBe(1000);
    c.tiles.push({ ...c.tiles[0]!, id: 1000, key: 'U0' }, { ...c.tiles[0]!, id: 1002, key: 'U2' });
    expect(nextTileId(c)).toBe(1001);
    c.tiles.push({ ...c.tiles[0]!, id: 1001, key: 'U1' });
    expect(nextTileId(c)).toBe(1003);
  });
});

describe('world grid', () => {
  // Layout (screens):      x: 0   1   2   3
  //   y0                     [A  A ] [B ]
  //   y1                     [A  A ] [C ]
  //   y2                     [D ][E      ]
  const A = createRoom({ id: 'A', name: 'A', gx: 0, gy: 0, gw: 2, gh: 2 });
  const B = createRoom({ id: 'B', name: 'B', gx: 2, gy: 0 });
  const C = createRoom({ id: 'C', name: 'C', gx: 2, gy: 1 });
  const D = createRoom({ id: 'D', name: 'D', gx: 0, gy: 2 });
  const E = createRoom({ id: 'E', name: 'E', gx: 1, gy: 2, gw: 2 });
  const U = createRoom({ id: 'U', name: 'Upstairs', gx: 2, gy: 0, floor: 1 });
  const world = worldWith(A, B, C, D, E, U);

  it('roomAtGrid covers the whole multi-screen rect on the same floor', () => {
    expect(roomAtGrid(world, 0, 0, 0)).toBe(A);
    expect(roomAtGrid(world, 1, 1, 0)).toBe(A);
    expect(roomAtGrid(world, 2, 2, 0)).toBe(E);
    expect(roomAtGrid(world, 2, 0, 1)).toBe(U);
    expect(roomAtGrid(world, 3, 0, 0)).toBeUndefined();
    expect(roomAtGrid(world, 0, 0, 1)).toBeUndefined();
  });

  const cases: [Room, Dir, number, Room | undefined][] = [
    // Multi-screen A: right edge picks the screen row from `along` (y).
    [A, 'right', 10, B],
    [A, 'right', 223, B],
    [A, 'right', 224, C],
    [A, 'right', 447, C],
    // Down edge picks the screen column from `along` (x).
    [A, 'down', 100, D],
    [A, 'down', 300, E],
    [A, 'up', 50, undefined],
    [A, 'left', 50, undefined],
    // Single-screen rooms into multi-screen neighbours.
    [B, 'left', 100, A],
    [C, 'left', 100, A],
    [C, 'down', 128, E],
    [C, 'up', 128, B],
    [B, 'up', 128, undefined],
    [D, 'up', 128, A],
    [D, 'right', 100, E],
    [E, 'left', 100, D],
    [E, 'up', 10, A],
    [E, 'up', 300, C],
    [E, 'down', 10, undefined],
    // Other floors never link.
    [U, 'left', 100, undefined],
    [U, 'down', 100, undefined],
  ];
  it.each(cases)('neighbour of %s going %s at %i', (room, dir, along, expected) => {
    expect(neighborRoom(world, room, dir, along)).toBe(expected);
  });

  it('clamps out-of-range edge positions into the room span', () => {
    expect(neighborRoom(world, A, 'right', -5)).toBe(B);
    expect(neighborRoom(world, A, 'right', 9999)).toBe(C);
    expect(neighborRoom(world, E, 'up', 9999)).toBe(C);
  });

  it('gridOverlaps respects floors and the ignored room', () => {
    expect(gridOverlaps(world, 3, 0, 1, 1, 0)).toBe(false);
    expect(gridOverlaps(world, 1, 1, 1, 1, 0)).toBe(true);
    expect(gridOverlaps(world, 3, 1, 1, 2, 0)).toBe(false);
    expect(gridOverlaps(world, 2, 2, 2, 1, 0)).toBe(true);
  });

  it('gridOverlaps edge cases', () => {
    expect(gridOverlaps(world, 3, 0, 1, 2, 0)).toBe(false);
    expect(gridOverlaps(world, 2, 0, 2, 1, 0)).toBe(true);
    expect(gridOverlaps(world, 2, 0, 1, 1, 0, 'B')).toBe(false);
    expect(gridOverlaps(world, 2, 0, 1, 1, 1)).toBe(true);
    expect(gridOverlaps(world, 2, 0, 1, 1, 1, 'U')).toBe(false);
    expect(gridOverlaps(world, -1, -1, 1, 1, 0)).toBe(false);
  });
});

describe('resizeRoom', () => {
  it('grows anchored top-left, filling new bg cells', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0, fill: 5 });
    r.layers.bg[13 * 16 + 15] = 9;
    r.layers.fg[3] = 4;
    r.layers.over[16] = 2;
    resizeRoom(r, 2, 2, 1);
    expect([r.gw, r.gh]).toEqual([2, 2]);
    for (const l of ['bg', 'fg', 'over'] as const) expect(r.layers[l]).toHaveLength(32 * 28);
    expect(r.layers.bg[13 * 32 + 15]).toBe(9);
    expect(r.layers.bg[0]).toBe(5);
    expect(r.layers.bg[16]).toBe(1);
    expect(r.layers.bg[14 * 32]).toBe(1);
    expect(r.layers.fg[3]).toBe(4);
    expect(r.layers.fg[16]).toBe(0);
    expect(r.layers.over[32]).toBe(2);
  });

  it('shrinks, keeping content and dropping entities outside', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0, gw: 2, gh: 2, fill: 1 });
    r.layers.bg[27 * 32 + 31] = 7;
    r.layers.bg[5 * 32 + 5] = 3;
    r.entities.push(
      { id: 'in', type: 'obj.pot', x: 100, y: 100, props: {} },
      { id: 'right', type: 'obj.pot', x: 300, y: 100, props: {} },
      { id: 'below', type: 'obj.pot', x: 100, y: 230, props: {} },
    );
    resizeRoom(r, 1, 1, 0);
    expect(r.layers.bg).toHaveLength(16 * 14);
    expect(r.layers.bg[5 * 16 + 5]).toBe(3);
    expect(r.layers.bg.includes(7)).toBe(false);
    expect(r.entities.map((e) => e.id)).toEqual(['in']);
  });

  it('clamps to 1..4 screens', () => {
    const r = createRoom({ name: 'R', gx: 0, gy: 0 });
    resizeRoom(r, 7, 0, 0);
    expect([r.gw, r.gh]).toEqual([4, 1]);
    expect(r.layers.fg).toHaveLength(64 * 14);
  });
});

describe('serialise / parse', () => {
  it('round-trips a project exactly', () => {
    const p = createBlankProject('Round Trip');
    p.dialogues.push({ id: 'd1', name: 'Intro', pages: [{ speaker: 'Elder', text: 'Hi {name}', choice: { options: ['Yes', 'No'], flag: 'agreed' } }] });
    p.flags.push({ name: 'agreed', description: 'Said yes' });
    const room = p.worlds[0]!.rooms[0]!;
    // Loading fills in catalog defaults, so the sign starts out with them too.
    room.entities.push({ id: 'e_sign', type: 'obj.sign', x: 72, y: 56, props: { ...defaultProps('obj.sign'), dialogue: 'd1', text: 'x' } });
    room.triggers.push({ id: 't1', name: 'Hello', on: 'enter', conditions: [], actions: [{ kind: 'dialogue', dialogue: 'd1' }], once: true });
    room.dark = true;
    const json = serializeProject(p);
    expect(json.includes('\n')).toBe(false);
    const back = parseProject(json);
    expect(back).toEqual(p);
  });

  it('rejects unusable input with readable errors', () => {
    expect(() => parseProject('{nope')).toThrow(/not valid JSON/);
    expect(() => parseProject('42')).toThrow(/not a Questforge project/);
    expect(() => parseProject('[]')).toThrow(/not a Questforge project/);
    expect(() => parseProject('{"format":"tiled","worlds":[]}')).toThrow(/not a Questforge project/);
    expect(() => parseProject('{"hello":"world"}')).toThrow(/not a Questforge project/);
    expect(() => parseProject('{"format":"questforge"}')).toThrow(/no worlds/);
  });

  it('accepts a project with validation problems (editor reports them)', () => {
    const p = createBlankProject('Broken');
    p.start.room = 'missing';
    const back = parseProject(serializeProject(p));
    expect(back.start.room).toBe('missing');
    expect(validateProject(back).some((x) => x.level === 'error')).toBe(true);
  });
});
