// Tile-level flood fill over the whole sample adventure, walking like the hero:
// floors, tall grass, shallows, stairs and spikes are walkable; ledges hop one
// way; room edges scroll into neighbours; warps and pit targets teleport. Keys,
// bombs and switches are assumed (their logic is tested in sample-project).
// Checks every room, chest, person, sign, shop item, pickup and warp is reachable,
// that every ledge the hero can walk up to hops, that no reachable edge tile
// runs into a wall on the neighbouring screen, and that every reachable tile
// leads back to the start (nothing strands the hero).
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { neighborRoom, roomCols, roomRows } from '../src/core/project';
import { footprint, propOf } from '../src/core/catalog';
import { SCREEN_COLS, SCREEN_ROWS, TILE } from '../src/core/constants';
import type { Collision, Dir, EntityInstance, PropValue, Room, WarpTarget, World } from '../src/core/types';

const p = createSampleProject();
const tiles = new Map(p.tiles.map((t) => [t.id, t]));
const STEPS: readonly [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
const WALK: ReadonlySet<Collision> = new Set(['floor', 'tallgrass', 'shallow', 'stairs', 'hurt']);
/** Static solid things that can narrow a path (the gate guard steps aside, so it is left out). */
const SOLID_TYPES = new Set(['obj.chest', 'obj.sign', 'obj.torch', 'obj.shopItem', 'enemy.eye', 'obj.crystalSwitch']);

interface Place { world: World; room: Room }
const rooms = new Map<string, Place>(p.worlds.flatMap((world) => world.rooms.map((room) => [room.id, { world, room }] as const)));

function tileDef(room: Room, tx: number, ty: number) {
  const i = ty * roomCols(room) + tx;
  const fg = room.layers.fg[i] ?? 0;
  const id = fg !== 0 ? fg : room.layers.bg[i] ?? 0;
  return id === 0 ? undefined : tiles.get(id);
}

/** Collision with bombable tiles already blown open. */
function collision(room: Room, tx: number, ty: number): Collision {
  const def = tileDef(room, tx, ty);
  if (!def) return 'solid';
  if (def.bomb) return tiles.get(def.bomb.to)?.collision ?? 'floor';
  return def.collision;
}

const blockedCells = new Map<string, Set<string>>();
function blocked(room: Room): Set<string> {
  let set = blockedCells.get(room.id);
  if (set) return set;
  set = new Set();
  for (const e of room.entities) {
    const still = e.type === 'npc.person' && propOf(e, 'behavior', 'still') === 'still' && e.id !== 'vil_guard';
    if (!SOLID_TYPES.has(e.type) && !still) continue;
    const fp = footprint(e);
    for (let x = e.x - fp.w / 2 + 1; x < e.x + fp.w / 2; x += TILE) {
      for (let y = e.y - fp.h / 2 + 1; y < e.y + fp.h / 2; y += TILE) set.add(`${Math.floor(x / TILE)},${Math.floor(y / TILE)}`);
    }
  }
  blockedCells.set(room.id, set);
  return set;
}

function walkable(room: Room, tx: number, ty: number): boolean {
  return WALK.has(collision(room, tx, ty)) && !blocked(room).has(`${tx},${ty}`);
}

const key = (room: Room, tx: number, ty: number): string => `${room.id}:${tx},${ty}`;

/** Where stepping off (tx, ty) along a direction lands in the neighbouring room, if any. */
function across(place: Place, tx: number, ty: number, dir: Dir): { place: Place; tx: number; ty: number } | null {
  const { world, room } = place;
  const along = dir === 'up' || dir === 'down' ? tx * TILE + TILE / 2 : ty * TILE + TILE / 2;
  const next = neighborRoom(world, room, dir, along);
  if (!next) return null;
  const [, dx, dy] = STEPS.find(([d]) => d === dir)!;
  const gx = room.gx * SCREEN_COLS + tx + dx;
  const gy = room.gy * SCREEN_ROWS + ty + dy;
  return { place: { world, room: next }, tx: gx - next.gx * SCREEN_COLS, ty: gy - next.gy * SCREEN_ROWS };
}

function warpsAt(room: Room, tx: number, ty: number): WarpTarget[] {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  return room.entities.filter((e) => e.type === 'marker.warp').filter((e) => {
    const fp = footprint(e);
    return Math.abs(cx - e.x) < fp.w / 2 && Math.abs(cy - e.y) < fp.h / 2;
  }).map((e) => e.props.target as WarpTarget);
}

/** A tile of some room the hero can stand on. */
interface Spot { place: Place; tx: number; ty: number }

/** Every tile one move away from (tx, ty): a step, a ledge hop, an edge scroll, a warp or a pit drop with a target. */
function successors(place: Place, tx: number, ty: number): Spot[] {
  const out: Spot[] = [];
  const land = (t: WarpTarget): void => {
    const to = rooms.get(t.room);
    if (to) out.push({ place: to, tx: Math.floor(t.x / TILE), ty: Math.floor(t.y / TILE) });
  };
  const { room } = place;
  for (const t of warpsAt(room, tx, ty)) land(t);
  for (const [dir, dx, dy] of STEPS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= roomCols(room) || ny >= roomRows(room)) {
      const next = across(place, tx, ty, dir);
      if (next && walkable(next.place.room, next.tx, next.ty)) out.push(next);
      continue;
    }
    const c = collision(room, nx, ny);
    if (c === 'pit' && room.pitTarget) land(room.pitTarget);
    else if (c === 'ledge' && tileDef(room, nx, ny)?.ledgeDir === dir && walkable(room, nx + dx, ny + dy)) {
      out.push({ place, tx: nx + dx, ty: ny + dy });
    } else if (walkable(room, nx, ny)) out.push({ place, tx: nx, ty: ny });
  }
  return out;
}

const startSpot = (): Spot => ({ place: rooms.get(p.start.room)!, tx: Math.floor(p.start.x / TILE), ty: Math.floor(p.start.y / TILE) });

/** Breadth-first search from `from` along `next`; returns every spot found, by key. */
function search(from: Spot, next: (s: Spot) => Spot[]): Map<string, Spot> {
  const seen = new Map<string, Spot>([[key(from.place.room, from.tx, from.ty), from]]);
  const queue = [from];
  while (queue.length > 0) {
    for (const n of next(queue.shift()!)) {
      const k = key(n.place.room, n.tx, n.ty);
      if (seen.has(k)) continue;
      seen.set(k, n);
      queue.push(n);
    }
  }
  return seen;
}

const reachedSpots = search(startSpot(), (s) => successors(s.place, s.tx, s.ty));
const reached = new Set(reachedSpots.keys());
const at = (room: Room, x: number, y: number): boolean => reached.has(key(room, Math.floor(x / TILE), Math.floor(y / TILE)));

function everyEntity(filter: (e: EntityInstance) => boolean): { room: Room; e: EntityInstance }[] {
  return p.worlds.flatMap((w) => w.rooms.flatMap((room) => room.entities.filter(filter).map((e) => ({ room, e }))));
}

describe('sample adventure: everything is reachable on foot', () => {
  it('every room can be entered from the start', () => {
    const entered = new Set([...reached].map((k) => k.split(':')[0]));
    const missing = [...rooms.keys()].filter((id) => !entered.has(id));
    expect(missing).toEqual([]);
  });

  it('every chest can be opened from below', () => {
    const bad = everyEntity((e) => e.type === 'obj.chest').filter(({ room, e }) => {
      const below = e.y + TILE;
      return propOf<PropValue>(e, 'big', false) ? !at(room, e.x - 8, below) && !at(room, e.x + 8, below) : !at(room, e.x, below);
    }).map(({ e }) => e.id);
    expect(bad).toEqual([]);
  });

  it('every person and shop item has a reachable side; every sign can be read from below', () => {
    const sides = everyEntity((e) => e.type === 'npc.person' || e.type === 'obj.shopItem')
      .filter(({ room, e }) => !STEPS.some(([, dx, dy]) => at(room, e.x + dx * TILE, e.y + dy * TILE)));
    const signs = everyEntity((e) => e.type === 'obj.sign').filter(({ room, e }) => !at(room, e.x, e.y + TILE));
    expect([...sides, ...signs].map(({ e }) => e.id)).toEqual([]);
  });

  it('every pickup and every warp zone can be walked onto', () => {
    const pickups = everyEntity((e) => e.type === 'obj.pickup').filter(({ room, e }) => !at(room, e.x, e.y)).map(({ e }) => e.id);
    const warps = everyEntity((e) => e.type === 'marker.warp').filter(({ room, e }) => {
      const fp = footprint(e);
      for (let x = e.x - fp.w / 2 + 8; x < e.x + fp.w / 2; x += TILE) {
        for (let y = e.y - fp.h / 2 + 8; y < e.y + fp.h / 2; y += TILE) if (at(room, x, y)) return false;
      }
      return true;
    }).map(({ e }) => e.id);
    expect([...pickups, ...warps]).toEqual([]);
  });

  it('no reachable edge tile scrolls into something solid on the next screen', () => {
    const bad: string[] = [];
    for (const k of reached) {
      const [roomId, pos] = k.split(':') as [string, string];
      const [tx, ty] = pos.split(',').map(Number) as [number, number];
      const place = rooms.get(roomId)!;
      for (const [dir, dx, dy] of STEPS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx >= 0 && ny >= 0 && nx < roomCols(place.room) && ny < roomRows(place.room)) continue;
        const next = across(place, tx, ty, dir);
        if (next && !walkable(next.place.room, next.tx, next.ty)) bad.push(`${roomId} (${tx},${ty}) ${dir} -> ${next.place.room.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every ledge the hero can walk up to hops (nothing blocks its landing)', () => {
    const dead: string[] = [];
    for (const { place, tx, ty } of reachedSpots.values()) {
      const { room } = place;
      for (const [dir, dx, dy] of STEPS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= roomCols(room) || ny >= roomRows(room)) continue;
        if (collision(room, nx, ny) !== 'ledge' || tileDef(room, nx, ny)?.ledgeDir !== dir) continue;
        if (!walkable(room, nx + dx, ny + dy)) dead.push(`${room.id} (${nx},${ny}) ${dir}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('no reachable tile runs off a room edge that has no screen beyond it (unless a warp covers it)', () => {
    const bad: string[] = [];
    for (const k of reached) {
      const [roomId, pos] = k.split(':') as [string, string];
      const [tx, ty] = pos.split(',').map(Number) as [number, number];
      const place = rooms.get(roomId)!;
      if (warpsAt(place.room, tx, ty).length > 0) continue;
      for (const [dir, dx, dy] of STEPS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx >= 0 && ny >= 0 && nx < roomCols(place.room) && ny < roomRows(place.room)) continue;
        if (!across(place, tx, ty, dir)) bad.push(`${roomId} (${tx},${ty}) ${dir}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('from every reachable tile the way leads back to the start (no one-way ledge, warp or pit traps)', () => {
    const back = new Map<string, Spot[]>();
    for (const s of reachedSpots.values()) {
      for (const n of successors(s.place, s.tx, s.ty)) {
        const k = key(n.place.room, n.tx, n.ty);
        const list = back.get(k) ?? [];
        list.push(s);
        back.set(k, list);
      }
    }
    const home = search(startSpot(), (s) => back.get(key(s.place.room, s.tx, s.ty)) ?? []);
    const stranded = [...reached].filter((k) => !home.has(k));
    expect(stranded).toEqual([]);
  });

  it('the cave behind the cracked wall and the dungeon crystal are reachable', () => {
    expect([...reached].some((k) => k.startsWith('in_cave:'))).toBe(true);
    const crystal = everyEntity((e) => propOf<PropValue>(e, 'item', '') === 'crystal')[0]!;
    expect(at(crystal.room, crystal.e.x, crystal.e.y)).toBe(true);
  });
});
