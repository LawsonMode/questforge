// ActiveRoom: layer copies, persisted tile flags, collision resolution (fg over
// bg, solid masks), mover rules, the half-open rect rule and out-of-room rules.
import { describe, expect, it } from 'vitest';
import type { Room, TileDef, World } from '../src/core/types';
import { ActiveRoom, blocksMover, probeLedge, tileFlagName } from '../src/game/world';

const COLS = 16;
const ROWS = 14;

function tile(id: number, collision: TileDef['collision'], extra: Partial<TileDef> = {}): TileDef {
  return { id, key: `T${id}`, name: `t${id}`, palette: 'p', frames: ['0'.repeat(256)], collision, tags: [], ...extra };
}

const FLOOR = 1;
const WALL = 2;
const WATER = 3;
const PIT = 4;
const LEDGE_S = 5;
const BRIDGE = 6;
const HALF_WALL = 7; // top half solid
const SHALLOW = 8;
const BUSH = 9;

const TILES: TileDef[] = [
  tile(FLOOR, 'floor'),
  tile(WALL, 'solid'),
  tile(WATER, 'deep'),
  tile(PIT, 'pit'),
  tile(LEDGE_S, 'ledge', { ledgeDir: 'down' }),
  tile(BRIDGE, 'floor'),
  tile(HALF_WALL, 'solid', { solidMask: 0b0011 }),
  tile(SHALLOW, 'shallow'),
  tile(BUSH, 'solid', { cut: { to: FLOOR } }),
];

function makeRoom(id = 'r1', gw = 1): Room {
  const n = COLS * gw * ROWS;
  return {
    id, name: id, gx: 0, gy: 0, gw, gh: 1, floor: 0,
    layers: { bg: new Array<number>(n).fill(FLOOR), fg: new Array<number>(n).fill(0), over: new Array<number>(n).fill(0) },
    entities: [], triggers: [],
  };
}

function put(room: Room, layer: 'bg' | 'fg', tx: number, ty: number, id: number): void {
  room.layers[layer][ty * room.gw * COLS + tx] = id;
}

const WORLD: World = { id: 'w', name: 'w', kind: 'overworld', music: 'overworld', rooms: [] };

function active(room: Room, flags: Record<string, boolean> = {}): ActiveRoom {
  return new ActiveRoom({ tiles: TILES }, WORLD, room, flags);
}

describe('ActiveRoom basics', () => {
  it('sizes from the room grid and copies layers', () => {
    const def = makeRoom('r', 2);
    const r = active(def);
    expect([r.cols, r.rows, r.width, r.height]).toEqual([32, 14, 512, 224]);
    r.setTile('bg', 3, 3, WALL);
    expect(r.tile('bg', 3, 3)).toBe(WALL);
    expect(def.layers.bg[3 * 32 + 3]).toBe(FLOOR);
    expect(r.tile('bg', -1, 0)).toBe(0);
  });

  it('applies persisted tile flags for its own room only', () => {
    const flags = {
      [tileFlagName('r1', 'bg', 2, 3, WALL)]: true,
      [tileFlagName('r2', 'bg', 4, 4, WALL)]: true,
      [tileFlagName('r1', 'fg', 5, 5, BRIDGE)]: false,
    };
    const r = active(makeRoom('r1'), flags);
    expect(r.tile('bg', 2, 3)).toBe(WALL);
    expect(r.tile('bg', 4, 4)).toBe(FLOOR);
    expect(r.tile('fg', 5, 5)).toBe(0);
  });

  it('setTile(persist) records one flag per cell, replacing older ones', () => {
    const flags: Record<string, boolean> = {};
    const r = active(makeRoom('r1'), flags);
    r.setTile('fg', 1, 1, WALL, true);
    r.setTile('fg', 1, 1, BRIDGE, true);
    r.setTile('fg', 2, 1, WALL);
    expect(Object.keys(flags)).toEqual([tileFlagName('r1', 'fg', 1, 1, BRIDGE)]);
    expect(active(makeRoom('r1'), flags).tile('fg', 1, 1)).toBe(BRIDGE);
  });

  it('finds interactive tiles fg first', () => {
    const def = makeRoom();
    put(def, 'bg', 3, 3, BUSH);
    const r = active(def);
    expect(r.interactiveTile(3, 3)).toEqual({ layer: 'bg', def: TILES[8] });
    expect(r.interactiveTile(4, 3)).toBeNull();
  });
});

describe('collisionAt', () => {
  it('fg (non-zero) wins over bg; bg 0 is solid; outside is solid', () => {
    const def = makeRoom();
    put(def, 'bg', 1, 1, WATER);
    put(def, 'fg', 1, 1, BRIDGE);
    put(def, 'bg', 2, 1, WATER);
    put(def, 'bg', 3, 1, 0);
    const r = active(def);
    expect(r.collisionAt(16 + 8, 16 + 8)).toBe('floor');
    expect(r.collisionAt(32 + 8, 16 + 8)).toBe('deep');
    expect(r.collisionAt(48 + 8, 16 + 8)).toBe('solid');
    expect(r.collisionAt(-1, 10)).toBe('solid');
    expect(r.collisionAt(10, 224)).toBe('solid');
  });

  it('honours solidMask quarters at 8x8 granularity', () => {
    const def = makeRoom();
    put(def, 'bg', 2, 2, HALF_WALL);
    put(def, 'bg', 3, 2, WATER);
    put(def, 'fg', 3, 2, HALF_WALL);
    const r = active(def);
    expect(r.collisionAt(32, 32)).toBe('solid');
    expect(r.collisionAt(47, 39)).toBe('solid');
    expect(r.collisionAt(32, 40)).toBe('floor');
    expect(r.collisionAt(47, 47)).toBe('floor');
    // a masked fg tile decides its whole cell: open quarters are floor, not the bg below (same rule as validate.ts)
    expect(r.collisionAt(48, 32)).toBe('solid');
    expect(r.collisionAt(48, 40)).toBe('floor');
  });

  it('lets a non-zero fg tile override a void bg', () => {
    const def = makeRoom();
    put(def, 'bg', 5, 5, 0);
    put(def, 'fg', 5, 5, BRIDGE);
    expect(active(def).collisionAt(88, 88)).toBe('floor');
  });
});

describe('blocked', () => {
  const def = makeRoom();
  put(def, 'bg', 4, 4, WALL);
  put(def, 'bg', 6, 4, WATER);
  put(def, 'bg', 8, 4, PIT);
  put(def, 'bg', 10, 4, LEDGE_S);
  put(def, 'bg', 12, 4, SHALLOW);
  const r = active(def);
  const at = (tx: number, ty: number) => ({ x: tx * 16 + 2, y: ty * 16 + 2, w: 12, h: 12 });

  it('applies mover rules', () => {
    const table: [number, Record<string, boolean>][] = [
      [4, { player: true, walker: true, flyer: true, projectile: true, ghost: false }],
      [6, { player: true, walker: true, flyer: false, projectile: false, ghost: false }],
      [8, { player: false, walker: true, flyer: false, projectile: false, ghost: false }],
      [10, { player: true, walker: true, flyer: false, projectile: false, ghost: false }],
      [12, { player: false, walker: false, flyer: false, projectile: false, ghost: false }],
    ];
    for (const [tx, expected] of table) {
      for (const [mover, want] of Object.entries(expected)) {
        expect(r.blocked(at(tx, 4), mover as never), `tile ${tx} ${mover}`).toBe(want);
      }
    }
    expect(r.blocked(at(6, 4), 'player', { flippers: true })).toBe(false);
  });

  it('treats rects as half-open', () => {
    // wall occupies x [64, 80): a rect ending exactly at 64 does not touch it
    expect(r.blocked({ x: 52, y: 66, w: 12, h: 12 }, 'walker')).toBe(false);
    expect(r.blocked({ x: 52.5, y: 66, w: 12, h: 12 }, 'walker')).toBe(true);
    expect(r.blocked({ x: 80, y: 66, w: 12, h: 12 }, 'walker')).toBe(false);
    expect(r.blocked({ x: 79.9, y: 66, w: 12, h: 12 }, 'walker')).toBe(true);
    // float noise on a flush edge does not count
    expect(r.blocked({ x: 52 + 1e-9, y: 66, w: 12, h: 12 }, 'walker')).toBe(false);
    expect(r.blocked({ x: 70, y: 70, w: 0, h: 12 }, 'walker')).toBe(false);
  });

  it('outside the room is solid except for the player', () => {
    const edge = { x: -4, y: 100, w: 12, h: 12 };
    expect(r.blocked(edge, 'walker')).toBe(true);
    expect(r.blocked(edge, 'flyer')).toBe(true);
    expect(r.blocked(edge, 'projectile')).toBe(true);
    expect(r.blocked(edge, 'player')).toBe(false);
    expect(r.blocked(edge, 'ghost')).toBe(false);
    expect(r.blocked({ x: 250, y: 216, w: 12, h: 12 }, 'player')).toBe(false);
  });

  it('blocksMover covers every collision kind', () => {
    for (const c of ['floor', 'shallow', 'hurt', 'tallgrass', 'stairs'] as const) {
      expect(blocksMover(c, 'walker')).toBe(false);
      expect(blocksMover(c, 'player')).toBe(false);
    }
    expect(blocksMover('solid', 'ghost')).toBe(false);
  });
});

describe('probeLedge', () => {
  const def = makeRoom();
  for (let tx = 2; tx <= 6; tx++) put(def, 'bg', tx, 5, LEDGE_S);
  put(def, 'bg', 7, 5, WALL);
  const r = active(def);

  it('classifies ledge / blocked / clear and ignores cells outside the room', () => {
    expect(probeLedge(r, { x: 40, y: 69, w: 12, h: 12 }, 'down')).toBe('ledge');
    expect(probeLedge(r, { x: 40, y: 69, w: 12, h: 12 }, 'up')).toBe('blocked');
    expect(probeLedge(r, { x: 104, y: 69, w: 12, h: 12 }, 'down')).toBe('blocked');
    expect(probeLedge(r, { x: 40, y: 100, w: 12, h: 12 }, 'down')).toBe('clear');
    expect(probeLedge(r, { x: 40, y: 220, w: 12, h: 12 }, 'down')).toBe('clear');
  });
});
