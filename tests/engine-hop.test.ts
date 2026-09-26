// Ledge-hop landing search: lands on free ground past the ledge, never through
// walls / deep water / solid entities, never out of a room without a neighbour.
import { describe, expect, it } from 'vitest';
import type { Dir, Room, TileDef, World } from '../src/core/types';
import { ActiveRoom } from '../src/game/world';
import { HOP_MARGIN, hopLanding, type HopQuery } from '../src/game/player/hop';

const COLS = 16;
const ROWS = 14;

function tile(id: number, collision: TileDef['collision'], extra: Partial<TileDef> = {}): TileDef {
  return { id, key: `T${id}`, name: `t${id}`, palette: 'p', frames: ['0'.repeat(256)], collision, tags: [], ...extra };
}

const FLOOR = 1;
const WALL = 2;
const WATER = 3;
const LEDGE_S = 4;
const LEDGE_N = 5;
const TILES = [
  tile(FLOOR, 'floor'), tile(WALL, 'solid'), tile(WATER, 'deep'),
  tile(LEDGE_S, 'ledge', { ledgeDir: 'down' }), tile(LEDGE_N, 'ledge', { ledgeDir: 'up' }),
];
const WORLD: World = { id: 'w', name: 'w', kind: 'overworld', music: 'overworld', rooms: [] };

/** A one-screen room of floor with `rows` filled by the given tile ids (bg). */
function roomWith(rows: Record<number, number>): ActiveRoom {
  const n = COLS * ROWS;
  const def: Room = {
    id: 'r', name: 'r', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0,
    layers: { bg: new Array<number>(n).fill(FLOOR), fg: new Array<number>(n).fill(0), over: new Array<number>(n).fill(0) },
    entities: [], triggers: [],
  };
  for (const [ty, id] of Object.entries(rows)) for (let tx = 0; tx < COLS; tx++) def.layers.bg[Number(ty) * COLS + tx] = id;
  return new ActiveRoom({ tiles: TILES }, WORLD, def);
}

/** Hero-sized (12x12) query standing flush against a ledge; `isFree` defaults to the room's player rule. */
function query(room: ActiveRoom, x: number, y: number, dir: Dir, extra: Partial<HopQuery> = {}): HopQuery {
  const flippers = extra.flippers ?? false;
  return {
    room, x, y, w: 12, h: 12, dir, flippers,
    isFree: (px, py) => !room.blocked({ x: px - 6, y: py - 6, w: 12, h: 12 }, 'player', { flippers }),
    canLeaveRoom: () => false,
    ...extra,
  };
}

// Ledge row 5 covers y [80, 96); a hero with its feet flush on the ledge stands at y = 74.
describe('hopLanding', () => {
  it('lands a full tile past the ledge (plus the carry-on margin)', () => {
    const land = hopLanding(query(roomWith({ 5: LEDGE_S }), 72, 74, 'down'));
    // first clear spot: hitbox top at 96 (y = 102), then HOP_MARGIN more
    expect(land).toEqual({ x: 72, y: 102 + HOP_MARGIN });
  });

  it('needs a ledge facing the hop direction right in front', () => {
    expect(hopLanding(query(roomWith({ 5: LEDGE_S }), 72, 74, 'up'))).toBeNull();
    expect(hopLanding(query(roomWith({ 5: LEDGE_N }), 72, 74, 'down'))).toBeNull();
    expect(hopLanding(query(roomWith({ 5: LEDGE_S }), 72, 60, 'down'))).toBeNull();
  });

  it('never hops over a wall right past the ledge', () => {
    expect(hopLanding(query(roomWith({ 5: LEDGE_S, 6: WALL }), 72, 74, 'down'))).toBeNull();
  });

  it('never hops over a wall a little further down either', () => {
    // clear strip of 16 px after the ledge, then a wall: the hero lands in the strip, short of the wall
    const land = hopLanding(query(roomWith({ 5: LEDGE_S, 7: WALL }), 72, 74, 'down'));
    expect(land).toEqual({ x: 72, y: 106 });
  });

  it('refuses deep water past the ledge unless the hero has flippers', () => {
    const room = roomWith({ 5: LEDGE_S, 6: WATER, 7: WATER });
    expect(hopLanding(query(room, 72, 74, 'down'))).toBeNull();
    expect(hopLanding(query(room, 72, 74, 'down', { flippers: true }))).toEqual({ x: 72, y: 102 + HOP_MARGIN });
  });

  it('refuses a landing spot taken by a solid entity', () => {
    const room = roomWith({ 5: LEDGE_S });
    const blockedFrom = 100;
    const land = hopLanding(query(room, 72, 74, 'down', { isFree: (_x, y) => y < blockedFrom }));
    expect(land).toBeNull();
  });

  it('does not land outside a room edge with no neighbour there', () => {
    const room = roomWith({ 13: LEDGE_S });
    expect(hopLanding(query(room, 72, 202, 'down'))).toBeNull();
    const out = hopLanding(query(room, 72, 202, 'down', { canLeaveRoom: () => true }));
    expect(out).not.toBeNull();
    expect(out!.y).toBeGreaterThan(218);
  });

  it('hops a thick band of matching ledges', () => {
    const land = hopLanding(query(roomWith({ 5: LEDGE_S, 6: LEDGE_S }), 72, 74, 'down'));
    expect(land).toEqual({ x: 72, y: 118 + HOP_MARGIN });
  });
});
