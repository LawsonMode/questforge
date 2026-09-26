// Structural checks for the built-in sample adventure "The Hollow Crown":
// validation is clean, references resolve, warps land on walkable ground,
// everything starts on open ground, a direction held through a warp or a pit
// fall never carries the hero on into another, dungeon doors pair up with
// matching links, dialogue fits the box, and the Hollow Keep's keys can never
// be spent in an order that locks the hero out.
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { validateProject } from '../src/core/validate';
import { findRoom, neighborRoom, roomCols, roomRows } from '../src/core/project';
import { footprint, propOf } from '../src/core/catalog';
import { terrainPieces } from '../src/core/autotile';
import { wrapText } from '../src/gfx/font';
import { PIECES_PER_HEART } from '../src/game/state';
import { SAMPLE_PROJECT_ID, SCREEN_H, SCREEN_W, TILE } from '../src/core/constants';
import type { Collision, Dir, EntityInstance, PropValue, Room, Terrain, WarpTarget, World } from '../src/core/types';
import { W, KP, CRYSTAL_FLAG, FLAG } from '../src/content/sample/ids';

const p = createSampleProject();
const tiles = new Map(p.tiles.map((t) => [t.id, t]));

function collision(room: Room, x: number, y: number): Collision {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const i = ty * roomCols(room) + tx;
  const fg = room.layers.fg[i] ?? 0;
  const id = fg !== 0 ? fg : room.layers.bg[i] ?? 0;
  return id === 0 ? 'solid' : tiles.get(id)?.collision ?? 'floor';
}

const WALKABLE: ReadonlySet<Collision> = new Set(['floor', 'tallgrass', 'shallow', 'stairs']);

function prop(e: EntityInstance, key: string): string {
  return String(propOf<PropValue>(e, key, ''));
}

function allEntities(): { world: World; room: Room; e: EntityInstance }[] {
  return p.worlds.flatMap((world) => world.rooms.flatMap((room) => room.entities.map((e) => ({ world, room, e }))));
}

function warpTargets(): { label: string; target: WarpTarget }[] {
  const out: { label: string; target: WarpTarget }[] = [{ label: 'start', target: p.start }];
  for (const { room, e } of allEntities()) {
    if (e.type === 'marker.warp') out.push({ label: e.id, target: e.props.target as WarpTarget });
  }
  for (const world of p.worlds) {
    for (const room of world.rooms) {
      if (room.pitTarget) out.push({ label: `${room.id} pitTarget`, target: room.pitTarget });
      for (const t of room.triggers) {
        for (const a of t.actions) if (a.kind === 'warp') out.push({ label: `${t.id} warp`, target: a.target });
      }
    }
  }
  return out;
}

describe('sample project: validation', () => {
  it('is the built-in sample with the Hollow Crown settings', () => {
    expect(p.id).toBe(SAMPLE_PROJECT_ID);
    expect(p.name).toBe('The Hollow Crown');
    expect(p.settings.startItems).toEqual({ shield: 1 });
    expect(p.settings.startHearts).toBe(3);
    expect(p.settings.introDialogue).toBeTruthy();
    expect(p.worlds.map((w) => w.kind).sort()).toEqual(['dungeon', 'interior', 'overworld']);
  });

  it('validates with zero errors and zero warnings', () => {
    const problems = validateProject(p);
    expect(problems.map((x) => `${x.level}: ${x.message}`)).toEqual([]);
  });

  it('is plain JSON (round-trips unchanged)', () => {
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('builds a fresh, independent copy each call', () => {
    const a = createSampleProject();
    a.worlds[0]!.rooms[0]!.layers.bg[0] = 999;
    expect(createSampleProject().worlds[0]!.rooms[0]!.layers.bg[0]).not.toBe(999);
  });
});

describe('sample project: references', () => {
  it('every warp, pit target and the start land inside an existing room on walkable ground', () => {
    const bad: string[] = [];
    for (const { label, target } of warpTargets()) {
      const room = findRoom(p, target.world, target.room);
      if (!room) {
        bad.push(`${label}: missing ${target.world}/${target.room}`);
        continue;
      }
      const c = collision(room, target.x, target.y);
      if (!WALKABLE.has(c)) bad.push(`${label}: lands on ${c} in ${room.id} at ${target.x},${target.y}`);
    }
    expect(bad).toEqual([]);
  });

  it('every warp arrival stands outside any warp zone of its room (no bounce loops)', () => {
    const inside = (room: Room, x: number, y: number): string | null => {
      for (const e of room.entities) {
        if (e.type !== 'marker.warp') continue;
        const w = Number(e.props.w) * TILE;
        const h = Number(e.props.h) * TILE;
        if (Math.abs(x - e.x) < w / 2 && Math.abs(y - e.y) < h / 2) return e.id;
      }
      return null;
    };
    const bad = warpTargets().flatMap(({ label, target }) => {
      const room = findRoom(p, target.world, target.room)!;
      const hit = inside(room, target.x, target.y);
      return hit ? [`${label} lands inside ${hit}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('every dialogue referenced by NPCs, signs, triggers and the intro exists', () => {
    const ids = new Set(p.dialogues.map((d) => d.id));
    const refs: string[] = [p.settings.introDialogue ?? ''];
    for (const { e } of allEntities()) {
      if (e.type === 'npc.person' || e.type === 'obj.sign') refs.push(prop(e, 'dialogue'));
    }
    for (const world of p.worlds) {
      for (const room of world.rooms) {
        for (const t of room.triggers) for (const a of t.actions) if (a.kind === 'dialogue') refs.push(a.dialogue);
      }
    }
    const missing = refs.filter((r) => r !== '' && !ids.has(r));
    expect(missing).toEqual([]);
    const npcsWithoutWords = allEntities().filter(({ e }) =>
      (e.type === 'obj.sign' && !prop(e, 'dialogue') && !prop(e, 'text'))
      || (e.type === 'npc.person' && !prop(e, 'dialogue') && !talkTriggers(e.id)));
    expect(npcsWithoutWords.map(({ e }) => e.id)).toEqual([]);
  });

  it('every dialogue page fits in one three-line box (even with a six-letter name)', () => {
    const long = p.dialogues.flatMap((d) => d.pages
      .filter((page) => wrapText(page.text.split('{name}').join('WWWWWW'), 204).length > 3)
      .map((page) => `${d.id}: ${page.text.slice(0, 40)}...`));
    expect(long).toEqual([]);
  });

  it('the quest beats are wired: sword from the Elder, the guard, the crystal hand-in', () => {
    const village = findRoom(p, W.overworld, 'ow_village')!;
    const byId = new Map(village.triggers.map((t) => [t.id, t]));
    const sword = byId.get('t_elder_sword')!;
    expect(sword.on).toBe('talk');
    expect(sword.actions).toContainEqual({ kind: 'giveItem', item: 'sword', amount: 1 });
    expect(sword.actions).toContainEqual({ kind: 'setFlag', flag: FLAG.gotSword, value: true });
    const guard = byId.get('t_guard_aside')!;
    expect(guard.on).toBe('auto');
    expect(guard.once).toBe(true);
    expect(guard.actions).toContainEqual({ kind: 'hideEntity', target: 'vil_guard' });
    const thanks = byId.get('t_elder_thanks')!;
    expect(thanks.conditions).toContainEqual({ kind: 'flag', flag: CRYSTAL_FLAG, value: true });
    expect(thanks.actions).toContainEqual({ kind: 'giveItem', item: 'heartContainer', amount: 1 });
    expect(thanks.actions).toContainEqual({ kind: 'setFlag', flag: FLAG.questDone, value: true });
  });
});

function talkTriggers(id: string): boolean {
  return p.worlds.some((w) => w.rooms.some((r) => r.triggers.some((t) => t.on === 'talk' && t.source === id)));
}

// ---------------------------------------------------------------------------
// Placement and arrivals
// ---------------------------------------------------------------------------

/** Enemies that fly or drift through walls: they may start over anything. */
const AIRBORNE = new Set(['enemy.bat', 'enemy.ghost']);
/** Ground an enemy, person or object may start on. */
const STANDABLE: ReadonlySet<Collision> = new Set(['floor', 'tallgrass', 'shallow']);
/** Ground the hero keeps walking over (a pit or a warp on it counts as walked into). */
const WALK_ON: ReadonlySet<Collision> = new Set(['floor', 'tallgrass', 'shallow', 'stairs', 'hurt', 'pit']);
/** Placed things the hero cannot walk through. */
const SOLID_THINGS = new Set([
  'obj.chest', 'obj.sign', 'obj.torch', 'obj.shopItem', 'obj.pot', 'obj.block', 'obj.crystalSwitch', 'enemy.eye',
]);
const STEP: Record<Dir, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = Object.keys(STEP) as Dir[];

/** Tiles (tx, ty) an entity's footprint overlaps. */
function tilesUnder(e: EntityInstance): [number, number][] {
  const fp = footprint(e);
  const span = (c: number, size: number): number[] => {
    const out: number[] = [];
    for (let t = Math.floor((c - size / 2) / TILE); t * TILE < c + size / 2; t++) out.push(t);
    return out;
  };
  return span(e.x, fp.w).flatMap((tx) => span(e.y, fp.h).map((ty): [number, number] => [tx, ty]));
}

const px = (t: number): number => t * TILE + TILE / 2;
const tileCollision = (room: Room, tx: number, ty: number): Collision => collision(room, px(tx), px(ty));

function inRoom(room: Room, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < roomCols(room) && ty < roomRows(room);
}

/** Warp zone of the room covering tile (tx, ty), if any. */
function warpZoneAt(room: Room, tx: number, ty: number): EntityInstance | undefined {
  return room.entities.find((e) => e.type === 'marker.warp' && tilesUnder(e).some(([x, y]) => x === tx && y === ty));
}

function solidThingAt(room: Room, tx: number, ty: number): boolean {
  return room.entities.some((e) => (SOLID_THINGS.has(e.type) || (e.type === 'npc.person' && prop(e, 'behavior') === 'still'))
    && tilesUnder(e).some(([x, y]) => x === tx && y === ty));
}

/** Directions the hero can walk into a warp zone from: a free tile beside the zone on that side. */
function approaches(room: Room, zone: EntityInstance): Dir[] {
  const cells = tilesUnder(zone);
  const inZone = (x: number, y: number): boolean => cells.some(([cx, cy]) => cx === x && cy === y);
  return DIRS.filter((dir) => cells.some(([tx, ty]) => {
    const fx = tx - STEP[dir][0];
    const fy = ty - STEP[dir][1];
    return inRoom(room, fx, fy) && !inZone(fx, fy) && WALK_ON.has(tileCollision(room, fx, fy)) && !solidThingAt(room, fx, fy);
  }));
}

/** What the hero reaches keeping `dir` held from (tx, ty): a warp zone, a pit, or null once something stops him. */
function walkOn(room: Room, tx: number, ty: number, dir: Dir): string | null {
  const [dx, dy] = STEP[dir];
  for (let x = tx + dx, y = ty + dy; inRoom(room, x, y); x += dx, y += dy) {
    const c = tileCollision(room, x, y);
    if (!WALK_ON.has(c) || solidThingAt(room, x, y)) return null;
    const zone = warpZoneAt(room, x, y);
    if (zone) return `warp ${zone.id} at (${x},${y})`;
    if (c === 'pit') return `a pit at (${x},${y})`;
  }
  return null;
}

describe('sample project: placement and arrivals', () => {
  it('every enemy, person and object starts on open ground (not in a bush, rock, wall, pit or water)', () => {
    const bad = allEntities()
      .filter(({ e }) => !e.type.startsWith('marker.') && e.type !== 'obj.door' && !AIRBORNE.has(e.type))
      .flatMap(({ room, e }) => tilesUnder(e)
        .filter(([tx, ty]) => !STANDABLE.has(tileCollision(room, tx, ty)))
        .map(([tx, ty]) => `${room.id} ${e.id} on ${tileCollision(room, tx, ty)} (${tx},${ty})`));
    expect(bad).toEqual([]);
  });

  it('a direction still held after a warp or a pit fall never walks straight into a warp or a pit', () => {
    const bad: string[] = [];
    const check = (label: string, target: WarpTarget, dirs: readonly Dir[]): void => {
      const room = findRoom(p, target.world, target.room)!;
      const tx = Math.floor(target.x / TILE);
      const ty = Math.floor(target.y / TILE);
      for (const dir of dirs) {
        const hit = walkOn(room, tx, ty, dir);
        if (hit) bad.push(`${label} holding ${dir} walks into ${hit} of ${room.id}`);
      }
    };
    for (const { room, e } of allEntities()) {
      if (e.type === 'marker.warp') check(e.id, e.props.target as WarpTarget, approaches(room, e));
    }
    for (const world of p.worlds) {
      for (const room of world.rooms) if (room.pitTarget) check(`${room.id} pitTarget`, room.pitTarget, DIRS);
    }
    expect(bad).toEqual([]);
  });

  it('every warp zone can be walked into from at least one side', () => {
    const shut = allEntities().filter(({ room, e }) => e.type === 'marker.warp' && approaches(room, e).length === 0);
    expect(shut.map(({ e }) => e.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Screen layout: terrain borders and the HUD band
// ---------------------------------------------------------------------------

/**
 * Cells a 13-piece terrain set cannot draw: 1-tile strips (opposite sides open)
 * and cells needing two borders at once (an edge or corner plus an inner corner,
 * or two inner corners). Out-of-room neighbours count as terrain, as in autotile.
 */
function unrepresentableCells(room: Room, terrain: Terrain): string[] {
  const pieces = new Set(terrainPieces(terrain));
  const cols = roomCols(room);
  const rows = roomRows(room);
  const layer = room.layers[terrain.layer];
  const has = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= cols || y >= rows || pieces.has(layer[y * cols + x] ?? 0);
  const bad: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!has(x, y)) continue;
      const n = has(x, y - 1);
      const s = has(x, y + 1);
      const e = has(x + 1, y);
      const w = has(x - 1, y);
      // Diagonals that must stay terrain: those between two present cardinals.
      const corners: [boolean, boolean, number, number][] = [[n, e, 1, -1], [s, e, 1, 1], [s, w, -1, 1], [n, w, -1, -1]];
      const needed = corners.filter(([a, b]) => a && b);
      const missing = needed.filter(([, , dx, dy]) => !has(x + dx, y + dy)).length;
      const open = [n, s, e, w].filter((v) => !v).length;
      if ((!n && !s) || (!e && !w) || (open > 0 && missing > 0) || missing > 1) bad.push(`${room.id} ${terrain.id} (${x},${y})`);
    }
  }
  return bad;
}

/** HUD boxes drawn over the room (screen px, see src/game/ui/hud.ts): meter + item box, counters, life. */
const HUD_BOXES: readonly { x0: number; y0: number; x1: number; y1: number }[] = [
  { x0: 10, y0: 9, x1: 48, y1: 43 },
  // Gems (3 digits), bombs, arrows (2 each) and the dungeon key count.
  { x0: 55, y0: 11, x1: 126, y1: 29 },
  // "- HEARTS -" and one row of up to 10 hearts.
  { x0: 164, y0: 9, x1: 244, y1: 28 },
];

/** Things the player has to see: they must never sit under the HUD, whatever the camera position. */
const MUST_SEE = new Set([
  'obj.chest', 'obj.sign', 'obj.pickup', 'obj.shopItem', 'npc.person', 'obj.switch', 'obj.crystalSwitch', 'obj.torch',
  'obj.block', 'marker.warp',
]);

/** True if a room-space rect can land under a HUD box for some camera position in the room. */
function underHud(room: Room, x0: number, y0: number, x1: number, y1: number): boolean {
  const maxCx = roomCols(room) * TILE - SCREEN_W;
  const maxCy = roomRows(room) * TILE - SCREEN_H;
  const span = (a0: number, a1: number, b0: number, b1: number, max: number): boolean => {
    for (let c = 0; c <= max; c++) if (a0 - c < b1 && a1 - c > b0) return true;
    return false;
  };
  return HUD_BOXES.some((b) => span(x0, x1, b.x0, b.x1, maxCx) && span(y0, y1, b.y0, b.y1, maxCy));
}

describe('sample project: screen layout', () => {
  it('every terrain cell has a piece that fits its neighbours (no 1-tile strips)', () => {
    const bad = p.worlds.flatMap((w) => w.rooms.flatMap((room) => p.terrains.flatMap((t) => unrepresentableCells(room, t))));
    expect(bad).toEqual([]);
  });

  it('no chest, sign, person, item, switch, torch, block, warp or stairs sits under the HUD', () => {
    const bad: string[] = [];
    for (const { room, e } of allEntities()) {
      if (!MUST_SEE.has(e.type)) continue;
      const fp = footprint(e);
      if (underHud(room, e.x - fp.w / 2, e.y - fp.h / 2, e.x + fp.w / 2, e.y + fp.h / 2)) bad.push(`${room.id} ${e.id}`);
    }
    for (const world of p.worlds) {
      for (const room of world.rooms) {
        room.layers.bg.forEach((id, i) => {
          if (tiles.get(id)?.collision !== 'stairs') return;
          const tx = (i % roomCols(room)) * TILE;
          const ty = Math.floor(i / roomCols(room)) * TILE;
          if (underHud(room, tx, ty, tx + TILE, ty + TILE)) bad.push(`${room.id} stairs (${tx / TILE},${ty / TILE})`);
        });
      }
    }
    expect(bad).toEqual([]);
  });

  it('the life meter never needs a second row, and the Heart Shards add up to whole hearts', () => {
    const items = allEntities().map(({ e }) => prop(e, 'item'));
    const triggerItems = p.worlds.flatMap((w) => w.rooms.flatMap((r) => r.triggers.flatMap((t) => t.actions)))
      .flatMap((a) => (a.kind === 'giveItem' ? [a.item] : []));
    const bosses = allEntities().filter(({ e }) => e.type.startsWith('boss.') && e.props.dropHeart === true).length;
    const pieces = items.filter((i) => i === 'heartPiece').length;
    const containers = [...items, ...triggerItems].filter((i) => i === 'heartContainer').length + bosses;
    expect(pieces % PIECES_PER_HEART).toBe(0);
    expect(p.settings.startHearts + containers + pieces / PIECES_PER_HEART).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Dungeon doors & keys
// ---------------------------------------------------------------------------

const keep = p.worlds.find((w) => w.id === W.keep)!;
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

interface DoorEdge { from: Room; to: Room; door: EntityInstance; other: EntityInstance }

function doorEdges(): DoorEdge[] {
  const out: DoorEdge[] = [];
  for (const room of keep.rooms) {
    for (const door of room.entities.filter((e) => e.type === 'obj.door')) {
      const dir = prop(door, 'dir') as Dir;
      const along = dir === 'up' || dir === 'down' ? door.x : door.y;
      const to = neighborRoom(keep, room, dir, along);
      if (!to) continue;
      const other = to.entities.find((e) => e.type === 'obj.door' && prop(e, 'dir') === OPPOSITE[dir]
        && (dir === 'up' || dir === 'down' ? e.x === door.x : e.y === door.y));
      if (other) out.push({ from: room, to, door, other });
    }
  }
  return out;
}

describe('sample project: the Hollow Keep doors', () => {
  it('every door (except the exit) faces a partner door in the neighbouring room', () => {
    const edges = doorEdges();
    const lonely = keep.rooms.flatMap((room) => room.entities
      .filter((e) => e.type === 'obj.door' && e.id !== 'kp_e1_door_s' && !edges.some((d) => d.door === e))
      .map((e) => e.id));
    expect(lonely).toEqual([]);
  });

  it('locked doors pair with a locked door on the same link; big-key doors with one or a boss shutter', () => {
    const sameLink = (a: EntityInstance, b: EntityInstance): boolean => !!prop(a, 'link') && prop(a, 'link') === prop(b, 'link');
    const bad = doorEdges().filter(({ door, other }) => {
      const kind = prop(door, 'kind');
      if (kind === 'locked' || prop(other, 'kind') === 'locked') return prop(other, 'kind') !== kind || !sameLink(door, other);
      if (kind !== 'bigKey') return false;
      const bossShutter = prop(other, 'kind') === 'shutter' && other.props.closeOnEnter === true;
      return !bossShutter && (prop(other, 'kind') !== 'bigKey' || !sameLink(door, other));
    }).map(({ door }) => door.id);
    expect(bad).toEqual([]);
  });

  it('door gaps are walkable floor under every door', () => {
    const bad = keep.rooms.flatMap((room) => room.entities.filter((e) => e.type === 'obj.door').flatMap((e) => {
      const dir = prop(e, 'dir');
      const cells = dir === 'up' || dir === 'down' ? [[e.x - 8, e.y], [e.x + 8, e.y]] : [[e.x, e.y - 8], [e.x, e.y + 8]];
      return cells.filter(([x, y]) => collision(room, x!, y!) !== 'floor').map(() => e.id);
    }));
    expect(bad).toEqual([]);
  });

  it('the boss room shutters and boss are set up; the entrance room holds the way out', () => {
    const boss = findRoom(p, W.keep, KP.boss)!;
    expect(boss.music).toBe('boss');
    const worm = boss.entities.find((e) => e.type === 'boss.worm')!;
    expect(worm.props.dropHeart).toBe(true);
    const inDoor = boss.entities.find((e) => e.id === 'kp_boss_door_n')!;
    expect(inDoor.props).toMatchObject({ kind: 'shutter', closeOnEnter: true, opensWhen: 'enemiesCleared' });
    const entrance = findRoom(p, W.keep, KP.entrance)!;
    const exit = entrance.entities.find((e) => e.type === 'marker.warp')!;
    expect((exit.props.target as WarpTarget).world).toBe(W.overworld);
    expect(findRoom(p, W.keep, KP.pedestal)!.entities.some((e) => prop(e, 'item') === 'crystal')).toBe(true);
  });
});

/** Extra item needs of doors and chests beyond keys (the design's progression). */
const DOOR_NEEDS: Record<string, string[]> = { kp_r11_door_s: ['bow', 'bigKey'] };

interface KeepState { keys: number; items: Set<string>; opened: Set<string>; unlocked: Set<string> }

/** Items a chest needs besides reaching it: big chests the big key, trigger-shown chests the trigger's needs. */
function chestNeeds(room: Room, chest: EntityInstance): string[] {
  const needs: string[] = propOf(chest, 'big', false) ? ['bigKey'] : [];
  for (const t of room.triggers) {
    if (!t.actions.some((a) => a.kind === 'showEntity' && a.target === chest.id)) continue;
    if (t.conditions.some((c) => c.kind === 'torchesLit')) needs.push('lantern');
  }
  return needs;
}

function passable(edge: DoorEdge, s: KeepState): boolean {
  const kinds = [prop(edge.door, 'kind'), prop(edge.other, 'kind')];
  const needs = [...(DOOR_NEEDS[edge.door.id] ?? []), ...(DOOR_NEEDS[edge.other.id] ?? [])];
  if (!needs.every((n) => s.items.has(n))) return false;
  if (kinds.includes('locked')) return s.unlocked.has(prop(edge.door, 'link'));
  // Shutters open from their own room (enemies cleared / puzzle): open-kind far sides make them one-way.
  if (prop(edge.door, 'kind') === 'shutter' && prop(edge.door, 'opensWhen') === 'never') return false;
  return true;
}

function reachableRooms(s: KeepState): Set<string> {
  const start: string = KP.entrance;
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  const edges = doorEdges();
  while (queue.length > 0) {
    const id = queue.shift()!;
    const room = keep.rooms.find((r) => r.id === id)!;
    const next: string[] = edges.filter((e) => e.from === room && passable(e, s)).map((e) => e.to.id);
    for (const e of room.entities) {
      const t = e.type === 'marker.warp' ? (e.props.target as WarpTarget) : null;
      if (t && t.world === W.keep) next.push(t.room);
    }
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

function stateKey(s: KeepState): string {
  return `${s.keys}|${[...s.opened].sort().join(',')}|${[...s.unlocked].sort().join(',')}`;
}

/** Next states: open one reachable chest, or spend a key on one reachable locked door. */
function successors(s: KeepState): KeepState[] {
  const out: KeepState[] = [];
  const rooms = reachableRooms(s);
  for (const room of keep.rooms.filter((r) => rooms.has(r.id))) {
    for (const chest of room.entities.filter((e) => e.type === 'obj.chest' && !s.opened.has(e.id))) {
      if (!chestNeeds(room, chest).every((n) => s.items.has(n))) continue;
      const item = prop(chest, 'item');
      const items = new Set(s.items);
      if (item !== 'smallKey') items.add(item);
      out.push({ ...s, keys: s.keys + (item === 'smallKey' ? 1 : 0), items, opened: new Set([...s.opened, chest.id]) });
    }
  }
  if (s.keys === 0) return out;
  for (const edge of doorEdges()) {
    const link = prop(edge.door, 'link');
    if (prop(edge.door, 'kind') !== 'locked' || s.unlocked.has(link) || !rooms.has(edge.from.id)) continue;
    out.push({ ...s, keys: s.keys - 1, unlocked: new Set([...s.unlocked, link]) });
  }
  return out;
}

/** The whole state graph reachable from entering the keep empty-handed. */
function exploreKeep(): Map<string, { state: KeepState; next: string[] }> {
  const graph = new Map<string, { state: KeepState; next: string[] }>();
  const stack: KeepState[] = [{ keys: 0, items: new Set(), opened: new Set(), unlocked: new Set() }];
  while (stack.length > 0) {
    const s = stack.pop()!;
    const k = stateKey(s);
    if (graph.has(k)) continue;
    const next = successors(s);
    graph.set(k, { state: s, next: next.map(stateKey) });
    stack.push(...next);
  }
  return graph;
}

describe('sample project: Hollow Keep key balance', () => {
  const graph = exploreKeep();
  const states = [...graph.values()].map((n) => n.state);
  const goal = (s: KeepState): boolean => reachableRooms(s).has(KP.pedestal);

  it('the crystal is reachable, and every chest in the keep can be opened', () => {
    expect(states.some(goal)).toBe(true);
    const opened = new Set(states.flatMap((s) => [...s.opened]));
    const chests = keep.rooms.flatMap((r) => r.entities.filter((e) => e.type === 'obj.chest').map((e) => e.id));
    expect(chests.filter((c) => !opened.has(c))).toEqual([]);
  });

  it('no order of opening chests and doors can soft-lock the hero', () => {
    // Backwards from the states that reach the crystal: every explored state must lead to one.
    const good = new Set([...graph].filter(([, n]) => goal(n.state)).map(([k]) => k));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [k, n] of graph) {
        if (!good.has(k) && n.next.some((x) => good.has(x))) {
          good.add(k);
          grew = true;
        }
      }
    }
    const stuck = [...graph].filter(([k]) => !good.has(k)).map(([k]) => k);
    expect(stuck).toEqual([]);
  });

  it('small keys match locked doors one to one', () => {
    const keys = keep.rooms.flatMap((r) => r.entities).filter((e) => prop(e, 'item') === 'smallKey').length;
    const links = new Set(keep.rooms.flatMap((r) => r.entities)
      .filter((e) => e.type === 'obj.door' && prop(e, 'kind') === 'locked').map((e) => prop(e, 'link')));
    expect(keys).toBe(links.size);
  });
});
