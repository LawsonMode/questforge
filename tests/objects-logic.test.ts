// Objects & NPCs: pure rules (door anims/flags, switch modes, peg state, pickup
// looks) plus behaviour checks for every object type ticked against a mock
// GameServices on a real ActiveRoom (so tile collision uses the engine's rules).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Dir, EntityInstance, ItemId, Project, PropValue, Room, TileDef, WarpTarget, World } from '../src/core/types';
import type { Button, GameEvent, GameServices, Hit, PlayerApi } from '../src/game/api';
import { DIR_VEC, OPPOSITE, rectsOverlap, type Rect } from '../src/core/math';
import { STEP, TILE } from '../src/core/constants';
import { defaultProps } from '../src/core/catalog';
import { Entity } from '../src/game/entity';
import { ActiveRoom } from '../src/game/world';
import { isRegistered } from '../src/game/registry';
import { IMMUNE, wantsFanfare } from '../src/game/entities/objects/base';
import { BIG_CHEST_LOCKED, Chest } from '../src/game/entities/objects/chest';
import { Sign } from '../src/game/entities/objects/sign';
import {
  BombableDoor, CLOSE_DEPTH, DOOR_SLIDE_TIME, Door, DoorJamb, JAMB, depthInside, doorAnim, doorFlag, doorSprite,
} from '../src/game/entities/objects/door';
import { Block, PUSH_TIME } from '../src/game/entities/objects/block';
import { FloorSwitch, nextSwitchState } from '../src/game/entities/objects/floorSwitch';
import { CRYSTAL_COOLDOWN, CrystalSwitch, togglesCrystal } from '../src/game/entities/objects/crystalSwitch';
import { Peg, pegRaised } from '../src/game/entities/objects/peg';
import { TORCH_LIGHT, Torch } from '../src/game/entities/objects/torch';
import { Pot, potKeyId } from '../src/game/entities/objects/pot';
import { BLINK_AT, BODY_REACH, CLAIM_TIME, Pickup, VANISH_AT, blinkHidden, pickupLook } from '../src/game/entities/objects/pickup';
import {
  ALREADY_FULL_HEALTH, CANT_CARRY_MORE, alreadyOwned, NOT_ENOUGH_RUPEES, PriceTag, ShopItem, purchaseRefusal,
} from '../src/game/entities/objects/shopItem';
import { Region, Warp, warpTarget } from '../src/game/entities/objects/markers';
import { PACE_DIST, Person, WANDER_RADIUS } from '../src/game/entities/npcs/person';
import '../src/game/entities/objects/index';
import '../src/game/entities/npcs/index';

// ---------------------------------------------------------------- pure rules

describe('registration', () => {
  it('registers every object, pickup, marker and NPC type', () => {
    for (const t of [
      'obj.chest', 'obj.sign', 'obj.door', 'obj.block', 'obj.switch', 'obj.crystalSwitch', 'obj.peg', 'obj.torch',
      'obj.pot', 'obj.pickup', 'obj.shopItem', 'marker.warp', 'marker.region', 'npc.person',
    ]) expect(isRegistered(t), t).toBe(true);
  });
});

describe('door rules', () => {
  it('shares one flag per link, else per id', () => {
    expect(doorFlag('d1', '')).toBe('door:d1');
    expect(doorFlag('d1', ' boss ')).toBe('door:boss');
  });

  it('picks sprite and anim from wall, kind and state', () => {
    expect(doorSprite('up')).toBe('obj.doorNS');
    expect(doorSprite('left')).toBe('obj.doorEW');
    expect(doorAnim('locked', 'up', false)).toBe('locked_up');
    expect(doorAnim('locked', 'up', true)).toBe('open_up');
    expect(doorAnim('bigKey', 'right', false)).toBe('bigKey_right');
    expect(doorAnim('shutter', 'down', false)).toBe('shutter_down');
    expect(doorAnim('bombable', 'left', false)).toBe('cracked_left');
    expect(doorAnim('bombable', 'left', true)).toBe('bombed_left');
    expect(doorAnim('open', 'down', false)).toBe('open_down');
  });

  it('measures how far a point is past the doorway, per wall', () => {
    const top: Rect = { x: 112, y: 0, w: 32, h: 16 };
    expect(depthInside('up', top, 128, 40)).toBe(24);
    expect(depthInside('up', top, 128, 10)).toBeLessThan(0);
    const bottom: Rect = { x: 112, y: 208, w: 32, h: 16 };
    expect(depthInside('down', bottom, 128, 180)).toBe(28);
    const left: Rect = { x: 0, y: 96, w: 16, h: 32 };
    expect(depthInside('left', left, 50, 112)).toBe(34);
    const right: Rect = { x: 240, y: 96, w: 16, h: 32 };
    expect(depthInside('right', right, 200, 112)).toBe(40);
  });
});

describe('switch, crystal and peg rules', () => {
  it('once latches, hold follows, toggle flips on each press', () => {
    expect(nextSwitchState('once', false, true)).toBe(true);
    expect(nextSwitchState('once', true, false)).toBe(true);
    expect(nextSwitchState('hold', false, true)).toBe(true);
    expect(nextSwitchState('hold', true, false)).toBe(false);
    expect(nextSwitchState('toggle', false, true)).toBe(true);
    expect(nextSwitchState('toggle', true, false)).toBe(true);
    expect(nextSwitchState('toggle', true, true)).toBe(false);
  });

  it('crystal switches react to the hero attack kinds only', () => {
    for (const k of ['sword', 'spin', 'arrow', 'boomerang', 'thrown', 'bomb', 'hookshot'] as const) expect(togglesCrystal(k)).toBe(true);
    for (const k of ['contact', 'projectile', 'fire', 'beam', 'spikes', 'fall'] as const) expect(togglesCrystal(k)).toBe(false);
  });

  it('red pegs stand while the state is false, blue while true', () => {
    expect(pegRaised('red', false)).toBe(true);
    expect(pegRaised('blue', false)).toBe(false);
    expect(pegRaised('red', true)).toBe(false);
    expect(pegRaised('blue', true)).toBe(true);
  });
});

describe('pickup rules', () => {
  it('maps items and amounts to pickup anims, falling back to item icons', () => {
    expect(pickupLook('rupees', 1)).toEqual({ sprite: 'pickup', anim: 'rupee_green' });
    expect(pickupLook('rupees', 5).anim).toBe('rupee_blue');
    expect(pickupLook('rupees', 19).anim).toBe('rupee_blue');
    expect(pickupLook('rupees', 20).anim).toBe('rupee_red');
    expect(pickupLook('magic', 8).anim).toBe('magic_small');
    expect(pickupLook('magic', 16).anim).toBe('magic_large');
    for (const i of ['heart', 'smallKey', 'bigKey', 'bombs', 'arrows', 'heartContainer', 'heartPiece', 'fairy', 'crystal'] as const) {
      expect(pickupLook(i, 1)).toEqual({ sprite: 'pickup', anim: i });
    }
    expect(pickupLook('bow', 1)).toEqual({ sprite: 'item', anim: 'bow' });
    expect(pickupLook('sword', 2)).toEqual({ sprite: 'item', anim: 'sword2' });
  });

  it('only quiet refills skip the fanfare', () => {
    for (const i of ['rupees', 'heart', 'arrows', 'bombs', 'magic', 'fairy', 'smallKey'] as const) expect(wantsFanfare(i)).toBe(false);
    for (const i of ['bow', 'bigKey', 'heartContainer', 'heartPiece', 'crystal', 'map'] as const) expect(wantsFanfare(i)).toBe(true);
  });

  it('blinks only after BLINK_AT', () => {
    const hidden = (from: number) => Array.from({ length: 40 }, (_, i) => blinkHidden(from + i / 60)).some(Boolean);
    expect(hidden(0)).toBe(false);
    expect(hidden(BLINK_AT)).toBe(true);
  });

  it('validates warp targets', () => {
    expect(warpTarget(null)).toBeNull();
    expect(warpTarget({ world: 'w', room: 'r' })).toBeNull();
    expect(warpTarget({ world: 'w', room: 'r', x: 8, y: 8 })).toEqual({ world: 'w', room: 'r', x: 8, y: 8 });
  });
});

// ---------------------------------------------------------------- mock world

const TILES: TileDef[] = (['floor', 'solid', 'pit', 'stairs'] as const).map((collision, i) => ({
  id: i + 1, key: collision.toUpperCase(), name: collision, palette: 'p', frames: [], collision, tags: [],
}));
const CHAR_TILE: Record<string, number> = { '.': 1, '#': 2, o: 3, s: 4 };

/** A plain walking thing (an enemy or NPC stand-in). */
class Walker extends Entity {}

/** Stand-in hero: position, facing, state, lock and recorded hits. */
class Hero extends Entity {
  state: PlayerApi['state'] = 'normal';
  locked = false;
  hurtPlayer(_hit: Hit): 'hit' | 'blocked' | 'ignored' {
    return 'hit';
  }
  setLocked(v: boolean): void {
    this.locked = v;
  }
}

interface Gift { item: ItemId; amount: number | undefined; fanfare: boolean }

interface Rig {
  game: GameServices;
  room: ActiveRoom;
  hero: Hero;
  list: Entity[];
  events: GameEvent[];
  sfx: string[];
  gifts: Gift[];
  dialogues: string[];
  warps: { target: WarpTarget; style: string | undefined }[];
  flags: Record<string, boolean>;
  items: Partial<Record<ItemId, number>>;
  held: Set<Button>;
  pegs: { state: boolean };
  add<T extends Entity>(make: (g: GameServices, inst: EntityInstance) => T, type: string, x: number, y: number, props?: Record<string, PropValue>, id?: string): T;
  /** Hero centre + facing (tile-free px). */
  place(x: number, y: number, facing?: Dir): void;
  run(seconds: number, until?: () => boolean): number;
}

let seq = 0;

/** A 16x14 room from a char grid ('.' floor, '#' wall, 'o' pit, 's' stairs); missing rows/cols are floor. */
function rig(grid: string[] = [], opts: { cleared?: () => boolean } = {}): Rig {
  const cols = 16;
  const rows = 14;
  const bg: number[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) bg.push(CHAR_TILE[grid[y]?.[x] ?? '.'] ?? 1);
  const def: Room = {
    id: 'r', name: 'R', gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, entities: [], triggers: [],
    layers: { bg, fg: new Array<number>(bg.length).fill(0), over: new Array<number>(bg.length).fill(0) },
  };
  const world: World = { id: 'w', name: 'W', kind: 'dungeon', music: 'none', rooms: [def] };
  const flags: Record<string, boolean> = {};
  const room = new ActiveRoom({ tiles: TILES }, world, def, flags);
  const list: Entity[] = [];
  const events: GameEvent[] = [];
  const sfx: string[] = [];
  const gifts: Gift[] = [];
  const dialogues: string[] = [];
  const warps: { target: WarpTarget; style: string | undefined }[] = [];
  const items: Partial<Record<ItemId, number>> = {};
  const held = new Set<Button>();
  const pegs = { state: false };
  const save = {
    rupees: 0, bombs: 0, maxBombs: 10, arrows: 0, maxArrows: 30, magic: 0, maxMagic: 32, hp: 6, maxHp: 6, items,
    respawn: { world: '', room: '', x: 0, y: 0 },
  };
  let time = 0;
  const count = (i: ItemId) => (i === 'rupees' ? save.rupees : items[i] ?? 0);
  const game = {
    project: { sprites: [] } as unknown as Project,
    room,
    entities: list,
    save,
    get time() { return time; },
    audio: { sfx: (id: string) => sfx.push(id) },
    input: { held: (b: Button) => held.has(b) },
    camera: { x: 0, y: 0, shake: () => {} },
    spawn: <T extends Entity>(e: T) => { list.push(e); return e; },
    findEntity: (id: string) => list.find((e) => e.id === id && !e.dead),
    entitiesIn: (r: Rect, f?: (e: Entity) => boolean) => list.filter((e) => !e.dead && rectsOverlap(e.hitbox(), r) && (!f || f(e))),
    solidEntityAt: (r: Rect, self: Entity | null) =>
      list.find((e) => e.solid && e !== self && !e.dead && rectsOverlap(e.hitbox(), r)) ?? null,
    emit: (e: GameEvent) => events.push(e),
    enemiesCleared: () => opts.cleared?.() ?? true,
    dialogue: (text: string) => { dialogues.push(text); return Promise.resolve(-1); },
    giveItem: (item: ItemId, amount?: number, o?: { fanfare?: boolean }) => {
      gifts.push({ item, amount, fanfare: o?.fanfare === true });
      if (item === 'rupees') save.rupees += amount ?? 1;
      else items[item] = (items[item] ?? 0) + (amount ?? 1);
    },
    hasItem: (item: ItemId, min = 1) => count(item) >= min,
    takeItem: (item: ItemId, amount = 1) => {
      if (count(item) < amount) return false;
      if (item === 'rupees') save.rupees -= amount;
      else items[item] = count(item) - amount;
      return true;
    },
    flag: (n: string) => flags[n] === true,
    setFlag: (n: string, v = true) => { if (v) flags[n] = true; else delete flags[n]; },
    warp: (target: WarpTarget, style?: string) => warps.push({ target, style }),
    effect: () => {},
    dropLoot: () => {},
    pegState: () => pegs.state,
    togglePegs: () => { pegs.state = !pegs.state; },
  } as unknown as GameServices & { player: PlayerApi };
  const hero = new Hero(game, null, 'player');
  hero.team = 'player';
  hero.mover = 'player';
  (game as { player: PlayerApi }).player = hero as unknown as PlayerApi;
  list.push(hero);
  return {
    game, room, hero, list, events, sfx, gifts, dialogues, warps, flags, items, held, pegs,
    add(make, type, x, y, props = {}, id) {
      const inst: EntityInstance = { id: id ?? `${type}_${seq++}`, type, x, y, props: { ...defaultProps(type), ...props } };
      return game.spawn(make(game, inst));
    },
    place(x, y, facing) {
      hero.x = x;
      hero.y = y;
      if (facing) hero.facing = facing;
    },
    run(seconds, until) {
      let t = 0;
      while (t < seconds - 1e-9) {
        hero.animT += STEP;
        for (const e of [...list]) {
          if (e.dead || e === hero) continue;
          e.tickCommon(STEP);
          if (e.stun <= 0 || e.ignoresStun) e.update(STEP);
          if (!e.dead && e.onPlayerTouch && e.overlaps(hero)) e.onPlayerTouch();
        }
        for (let i = list.length - 1; i >= 0; i--) if (list[i]!.dead) { list[i]!.onRemove?.(); list.splice(i, 1); }
        t += STEP;
        time += STEP;
        if (until?.()) break;
      }
      return t;
    },
  };
}

const at = (tx: number) => tx * TILE + 8;
const bomb: Hit = { damage: 2, kind: 'bomb', source: null, dx: 0, dy: 0 };
const sword: Hit = { damage: 1, kind: 'sword', source: null, dx: 0, dy: -1 };

beforeEach(() => { seq = 0; });

// ---------------------------------------------------------------- behaviours

describe('objects are immune to generic damage', () => {
  it('a bomb blast hurting everything leaves chests, signs, pickups and NPCs alone', () => {
    const r = rig();
    const things = [
      r.add((g, i) => new Chest(g, i), 'obj.chest', at(3), at(3)),
      r.add((g, i) => new Sign(g, i), 'obj.sign', at(5), at(3)),
      r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(7), at(3)),
      r.add((g, i) => new Person(g, i), 'npc.person', at(9), at(3)),
      r.add((g, i) => new Pot(g, i), 'obj.pot', at(11), at(3)),
    ];
    for (const e of things) {
      expect(e.invuln).toBe(IMMUNE);
      expect(e.hurt(bomb)).toBe(false);
      expect(e.dead).toBe(false);
    }
  });

  it('only attack-reactive objects override hurt (they stay hittable)', () => {
    const r = rig();
    const crystal = r.add((g, i) => new CrystalSwitch(g, i), 'obj.crystalSwitch', at(4), at(4));
    const wall = r.add((g, i) => new BombableDoor(g, i), 'obj.door', 128, 8, { kind: 'bombable' });
    expect(crystal.invuln).toBe(0);
    expect(wall.invuln).toBe(0);
    expect(crystal.hurt).not.toBe(Entity.prototype.hurt);
    const chest = r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(8));
    expect(chest.hurt).toBe(Entity.prototype.hurt);
  });
});

describe('chest', () => {
  it('opens facing up against its bottom edge: sfx, fanfare, flag, event; stays open', () => {
    const r = rig();
    const c = r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(5), { item: 'bow', amount: 1 }, 'c1');
    expect(c.solid && c.hookable).toBe(true);
    r.place(at(8), at(5) + 14, 'left');
    expect(c.onInteract()).toBe(false);
    r.place(at(8), at(5) + 14, 'up');
    expect(c.onInteract()).toBe(true);
    expect(c.isOpen).toBe(true);
    expect(c.anim).toBe('open');
    expect(r.sfx).toContain('chest');
    expect(r.gifts).toEqual([{ item: 'bow', amount: 1, fanfare: true }]);
    expect(r.flags['chest:c1']).toBe(true);
    expect(r.events).toContainEqual({ type: 'chestOpened', id: 'c1' });
    expect(c.onInteract()).toBe(false);
    expect(r.gifts).toHaveLength(1);
    const again = r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(5), { item: 'bow' }, 'c1');
    expect(again.isOpen).toBe(true);
    expect(again.anim).toBe('open');
  });

  it('passes rupee amounts unchanged and only opens from close by', () => {
    const r = rig();
    const c = r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(5), { item: 'rupees', amount: 20 });
    r.place(at(8), at(5) + 40, 'up');
    expect(c.onInteract()).toBe(false);
    r.place(at(8), at(5) + 14, 'up');
    c.onInteract();
    expect(r.gifts[0]).toEqual({ item: 'rupees', amount: 20, fanfare: true });
  });

  it('big chests need the big key', () => {
    const r = rig();
    const c = r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(5), { item: 'hookshot', big: true });
    expect(c.w).toBe(32);
    expect(c.sprite).toBe('obj.bigChest');
    r.place(at(8) + 8, at(5) + 14, 'up');
    expect(c.onInteract()).toBe(true);
    expect(r.dialogues).toEqual([BIG_CHEST_LOCKED]);
    expect(c.isOpen).toBe(false);
    r.items.bigKey = 1;
    c.onInteract();
    expect(c.isOpen).toBe(true);
    expect(r.items.bigKey).toBe(1);
  });
});

describe('sign', () => {
  it('reads from the front only, dialogue id first', () => {
    const r = rig();
    const s = r.add((g, i) => new Sign(g, i), 'obj.sign', at(8), at(5), { text: 'Hello there' });
    r.place(at(8) + 5, at(5) + 15, 'up');
    expect(s.onInteract()).toBe(true);
    expect(r.dialogues).toEqual(['Hello there']);
    r.place(at(8), at(5) - 15, 'down');
    expect(s.onInteract()).toBe(false);
    r.place(at(8) - 15, at(5), 'right');
    expect(s.onInteract()).toBe(false);
    const d = r.add((g, i) => new Sign(g, i), 'obj.sign', at(3), at(5), { dialogue: 'dlg_sign', text: 'ignored' });
    expect(d.message).toBe('dlg_sign');
    expect(s.liftWeight).toBe(0);
    expect(s.onLift()).toMatchObject({ sprite: 'obj.sign', drop: 'none' });
  });
});

describe('doors', () => {
  const wallRow = ['################'];

  it('carves the doorway so only the door blocks, and is solid while closed', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'locked' });
    expect(r.room.collisionAt(120, 8)).toBe('floor');
    expect(r.room.collisionAt(136, 8)).toBe('floor');
    expect(r.room.collisionAt(100, 8)).toBe('solid');
    expect(d.solid).toBe(true);
    expect(d.drawLayer).toBe('ground');
    expect(d.anim).toBe('locked_up');
  });

  it('locked: walking into it with a key uses the key, unlocks, persists and frees the way', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'locked', link: 'L1' }, 'door1');
    r.place(128, 16 + 6, 'up');
    r.held.add('up');
    r.run(0.1);
    expect(d.isOpen).toBe(false);
    expect(r.sfx.filter((s) => s === 'locked')).toHaveLength(1);
    r.items.smallKey = 1;
    r.run(STEP);
    expect(d.isOpen).toBe(true);
    expect(d.solid).toBe(false);
    expect(r.items.smallKey).toBe(0);
    expect(r.sfx).toContain('unlock');
    expect(r.flags['door:L1']).toBe(true);
    expect(r.events).toContainEqual({ type: 'doorOpened', id: 'door1' });
    expect(d.anim).toBe('open_up');
    const other = r.add((g, i) => new Door(g, i), 'obj.door', 128, 216, { kind: 'locked', dir: 'down', link: 'L1' });
    expect(other.isOpen).toBe(true);
    expect(other.solid).toBe(false);
  });

  it('locked: needs the hero to face and push toward it', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'locked' });
    r.items.smallKey = 1;
    r.place(128, 22, 'up');
    r.run(0.1);
    expect(d.isOpen).toBe(false);
    r.held.add('up');
    r.hero.facing = 'left';
    r.run(0.1);
    expect(d.isOpen).toBe(false);
    r.hero.facing = 'up';
    r.run(STEP);
    expect(d.isOpen).toBe(true);
  });

  it('bigKey doors need the big key and keep it', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'bigKey' });
    r.place(128, 22, 'up');
    r.held.add('up');
    r.items.smallKey = 3;
    r.run(0.1);
    expect(d.isOpen).toBe(false);
    r.items.bigKey = 1;
    r.run(STEP);
    expect(d.isOpen).toBe(true);
    expect(r.items.bigKey).toBe(1);
    expect(r.items.smallKey).toBe(3);
  });

  it('shutters open when enemies are cleared (instantly if the room has none)', () => {
    let enemies = 2;
    const r = rig(wallRow, { cleared: () => enemies === 0 });
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', opensWhen: 'enemiesCleared' }, 'sh');
    r.run(0.5);
    expect(d.isOpen).toBe(false);
    enemies = 0;
    r.run(STEP);
    expect(d.isOpen).toBe(true);
    expect(r.sfx).toContain('door');
    expect(r.flags['door:sh']).toBe(true);

    const empty = rig(wallRow, { cleared: () => true });
    const e = empty.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', opensWhen: 'enemiesCleared' });
    empty.run(STEP);
    expect(e.isOpen).toBe(true);
    expect(empty.sfx).not.toContain('door');
  });

  it('closeOnEnter shutters start open and shut once the hero is 24 px inside', () => {
    let enemies = 1;
    const r = rig(wallRow, { cleared: () => enemies === 0 });
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', opensWhen: 'enemiesCleared', closeOnEnter: true });
    expect(d.isOpen).toBe(true);
    r.place(128, 16 + CLOSE_DEPTH - 2);
    r.run(0.2);
    expect(d.isOpen).toBe(true);
    r.place(128, 16 + CLOSE_DEPTH);
    r.run(STEP);
    expect(d.isOpen).toBe(false);
    expect(d.solid).toBe(true);
    expect(r.sfx).toContain('door');
    enemies = 0;
    r.run(STEP);
    expect(d.isOpen).toBe(true);
    r.run(0.5);
    expect(d.isOpen).toBe(true);
  });

  it('a flagged closeOnEnter shutter stays open', () => {
    const r = rig(wallRow, { cleared: () => false });
    r.flags['door:S'] = true;
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', closeOnEnter: true, link: 'S' });
    r.place(128, 120);
    r.run(0.2);
    expect(d.isOpen).toBe(true);
  });

  it('trigger shutters follow setOpen; opening persists and animates', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', opensWhen: 'trigger' }, 'tr');
    r.run(0.3);
    expect(d.isOpen).toBe(false);
    d.setOpen(true);
    expect(d.isOpen).toBe(true);
    expect(r.flags['door:tr']).toBe(true);
    expect((d as unknown as { slideT: number }).slideT).toBeCloseTo(DOOR_SLIDE_TIME);
    d.setOpen(false, true);
    expect(d.isOpen).toBe(false);
    expect(d.solid).toBe(true);
  });

  it('bombable doors open to a bomb only', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new BombableDoor(g, i), 'obj.door', 128, 8, { kind: 'bombable' }, 'bw');
    expect(d.anim).toBe('cracked_up');
    expect(d.hurt(sword)).toBe(false);
    expect(d.isOpen).toBe(false);
    expect(d.hurt(bomb)).toBe(true);
    expect(d.isOpen).toBe(true);
    expect(d.anim).toBe('bombed_up');
    expect(r.sfx).toContain('secret');
    expect(r.flags['door:bw']).toBe(true);
    expect(d.hurt(bomb)).toBe(false);
  });

  it('open doors are never solid; linked doors in one room open together', () => {
    const r = rig(wallRow);
    const open = r.add((g, i) => new Door(g, i), 'obj.door', 64, 8, { kind: 'open' });
    expect(open.solid).toBe(false);
    open.setOpen(false);
    expect(open.solid).toBe(false);
    const a = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'shutter', link: 'pair' });
    const b = r.add((g, i) => new Door(g, i), 'obj.door', 192, 8, { kind: 'shutter', link: 'pair' });
    a.setOpen(true);
    expect(b.isOpen).toBe(true);
  });

  it('side doors use the EW sprite and a tall hitbox', () => {
    const r = rig();
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 8, 112, { kind: 'locked', dir: 'left' });
    expect(d.sprite).toBe('obj.doorEW');
    expect([d.w, d.h]).toEqual([16, 32]);
    expect(d.anim).toBe('locked_left');
  });

  it('keeps solid jambs at both ends: an open doorway is passed through its middle only', () => {
    const r = rig(wallRow);
    const d = r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'open' });
    const jambs = r.list.filter((e): e is DoorJamb => e instanceof DoorJamb);
    expect(jambs.map((j) => [j.left, j.top, j.w, j.h])).toEqual([[112, 0, JAMB, 16], [144 - JAMB, 0, JAMB, 16]]);
    expect(jambs.every((j) => j.solid && !j.hookable && !j.visible && j.invuln === IMMUNE)).toBe(true);
    const hero = (x: number): Rect => ({ x: x - 6, y: 2, w: 12, h: 12 });
    expect(r.game.solidEntityAt(hero(128 - 4), r.hero)).toBeNull();
    expect(r.game.solidEntityAt(hero(128 + 4), r.hero)).toBeNull();
    expect(r.game.solidEntityAt(hero(128 - 5), r.hero)).toBeInstanceOf(DoorJamb);
    expect(r.game.solidEntityAt(hero(128 + 5), r.hero)).toBeInstanceOf(DoorJamb);
    d.dead = true;
    r.run(STEP);
    expect(r.list.some((e) => e instanceof DoorJamb)).toBe(false);
  });

  it('side doors stack their jambs vertically', () => {
    const r = rig();
    r.add((g, i) => new Door(g, i), 'obj.door', 8, 112, { kind: 'open', dir: 'left' });
    const jambs = r.list.filter((e): e is DoorJamb => e instanceof DoorJamb);
    expect(jambs.map((j) => [j.left, j.top, j.w, j.h])).toEqual([[0, 96, 16, JAMB], [0, 128 - JAMB, 16, JAMB]]);
  });
});

describe('push block', () => {
  it('slides exactly one tile in 0.25 s, then locks (once) and reports', () => {
    const r = rig();
    const b = r.add((g, i) => new Block(g, i), 'obj.block', at(8), at(6), {}, 'blk');
    expect(b.onPush('right')).toBe(true);
    expect(r.sfx).toContain('push');
    expect(b.onPush('right')).toBe(false);
    r.run(PUSH_TIME / 2);
    expect(b.x).toBeGreaterThan(at(8));
    expect(b.x).toBeLessThan(at(9));
    r.run(PUSH_TIME);
    expect(b.x).toBe(at(9));
    expect(b.y).toBe(at(6));
    expect(b.pushed).toBe(true);
    expect(r.events).toContainEqual({ type: 'blockPushed', id: 'blk' });
    expect(b.onPush('right')).toBe(false);
  });

  it('free blocks keep moving; walls, pits, solid things and enemies stop it', () => {
    const r = rig(['', '', '', '', '', '', '..........#', '', '', '..........o']);
    const b = r.add((g, i) => new Block(g, i), 'obj.block', at(8), at(6), { pushes: 'free' });
    expect(b.onPush('right')).toBe(true);
    r.run(0.3);
    expect(b.onPush('right')).toBe(false);
    expect(b.onPush('down')).toBe(true);
    r.run(0.3);
    r.add((g, i) => new Pot(g, i), 'obj.pot', at(9), at(8));
    expect(b.onPush('down')).toBe(false);
    const enemy = r.add((g, i) => new Pot(g, i), 'obj.pot', at(9), at(6));
    enemy.solid = false;
    enemy.team = 'enemy';
    expect(b.onPush('up')).toBe(false);
    const c = r.add((g, i) => new Block(g, i), 'obj.block', at(10), at(8), { pushes: 'free' });
    expect(c.onPush('down')).toBe(false);
  });

  it('never enters a doorway, a warp or stairs (it could seal the exit)', () => {
    const r = rig(['################', '', '', '', '', '', '', '...........s']);
    r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'open' });
    const toDoor = r.add((g, i) => new Block(g, i), 'obj.block', 128, 24, { pushes: 'free' });
    expect(r.room.collisionAt(128, 8)).toBe('floor');
    expect(toDoor.onPush('up')).toBe(false);
    r.add((g, i) => new Warp(g, i), 'marker.warp', at(5), at(4), { target: { world: 'w', room: 'r', x: 8, y: 8 } });
    const toWarp = r.add((g, i) => new Block(g, i), 'obj.block', at(4), at(4), { pushes: 'free' });
    expect(toWarp.onPush('right')).toBe(false);
    expect(toWarp.onPush('down')).toBe(true);
    const toStairs = r.add((g, i) => new Block(g, i), 'obj.block', at(10), at(7), { pushes: 'free' });
    expect(toStairs.onPush('right')).toBe(false);
    expect(toStairs.onPush('left')).toBe(true);
  });

  it('honours its direction limit and needs the glove when heavy', () => {
    const r = rig();
    const b = r.add((g, i) => new Block(g, i), 'obj.block', at(8), at(6), { dir: 'up' });
    expect(b.onPush('left')).toBe(false);
    expect(b.onPush('up')).toBe(true);
    const h = r.add((g, i) => new Block(g, i), 'obj.block', at(3), at(6), { heavy: true });
    expect(h.anim).toBe('heavy');
    expect(h.onPush('left')).toBe(false);
    r.items.glove = 1;
    expect(h.onPush('left')).toBe(true);
  });
});

describe('floor switch', () => {
  it('once: the hero presses it for good', () => {
    const r = rig();
    const s = r.add((g, i) => new FloorSwitch(g, i), 'obj.switch', at(8), at(6), { mode: 'once' }, 'sw');
    expect(s.drawLayer).toBe('ground');
    r.place(at(3), at(3));
    r.run(0.1);
    expect(s.on).toBe(false);
    r.place(at(8) + 5, at(6));
    r.run(STEP);
    expect(s.on).toBe(true);
    expect(s.anim).toBe('down');
    expect(r.events).toEqual([{ type: 'switch', id: 'sw', on: true }]);
    r.place(at(3), at(3));
    r.run(0.1);
    expect(s.on).toBe(true);
    expect(r.events).toHaveLength(1);
  });

  it('ignores an airborne hero', () => {
    const r = rig();
    const s = r.add((g, i) => new FloorSwitch(g, i), 'obj.switch', at(8), at(6));
    r.place(at(8), at(6));
    r.hero.z = 6;
    r.run(0.1);
    expect(s.on).toBe(false);
  });

  it('hold: on only while a block rests on it', () => {
    const r = rig();
    const s = r.add((g, i) => new FloorSwitch(g, i), 'obj.switch', at(9), at(6), { mode: 'hold' }, 'h');
    const b = r.add((g, i) => new Block(g, i), 'obj.block', at(8), at(6), { pushes: 'free' });
    b.onPush('right');
    r.run(0.4);
    expect(s.on).toBe(true);
    b.onPush('right');
    r.run(0.4);
    expect(s.on).toBe(false);
    expect(r.events.filter((e) => e.type === 'switch')).toEqual([
      { type: 'switch', id: 'h', on: true }, { type: 'switch', id: 'h', on: false },
    ]);
  });

  it('toggle: each new press flips it; pots count too', () => {
    const r = rig();
    const s = r.add((g, i) => new FloorSwitch(g, i), 'obj.switch', at(8), at(6), { mode: 'toggle' });
    const pot = r.add((g, i) => new Pot(g, i), 'obj.pot', at(8), at(6));
    r.run(STEP);
    expect(s.on).toBe(true);
    pot.dead = true;
    r.run(STEP);
    expect(s.on).toBe(true);
    r.place(at(8), at(6));
    r.run(STEP);
    expect(s.on).toBe(false);
  });
});

describe('crystal switch and pegs', () => {
  it('a hit toggles the pegs with a cooldown and swaps its colour', () => {
    const r = rig();
    const c = r.add((g, i) => new CrystalSwitch(g, i), 'obj.crystalSwitch', at(4), at(4), {}, 'cs');
    const red = r.add((g, i) => new Peg(g, i), 'obj.peg', at(8), at(8), { color: 'red' });
    const blue = r.add((g, i) => new Peg(g, i), 'obj.peg', at(9), at(8), { color: 'blue' });
    expect(c.solid).toBe(true);
    expect([red.raised, red.solid, red.hookable, red.drawLayer]).toEqual([true, true, true, 'normal']);
    expect([blue.raised, blue.solid, blue.hookable, blue.drawLayer]).toEqual([false, false, false, 'ground']);
    expect(c.hurt({ ...sword, kind: 'contact' })).toBe(false);
    expect(r.pegs.state).toBe(false);
    expect(c.hurt(sword)).toBe(true);
    expect(r.pegs.state).toBe(true);
    expect(r.sfx).toContain('switch');
    expect(r.events).toContainEqual({ type: 'switch', id: 'cs', on: true });
    expect(c.hurt({ ...sword, kind: 'arrow' })).toBe(true);
    expect(r.pegs.state).toBe(true);
    r.run(STEP);
    expect(red.anim).toBe('red_down');
    expect(red.solid).toBe(false);
    expect(blue.anim).toBe('blue_up');
    expect(blue.solid).toBe(true);
    r.run(CRYSTAL_COOLDOWN);
    expect(c.hurt({ ...sword, kind: 'bomb' })).toBe(true);
    expect(r.pegs.state).toBe(false);
  });
});

describe('peg occupants', () => {
  it('a peg due to rise waits until an enemy standing on it has moved off', () => {
    const r = rig();
    const blue = r.add((g, i) => new Peg(g, i), 'obj.peg', at(8), at(8), { color: 'blue' });
    const foe = r.game.spawn(new Walker(r.game, null, 'enemy.test'));
    foe.x = at(8) + 4;
    foe.y = at(8);
    r.pegs.state = true;
    r.run(STEP);
    expect(blue.raised).toBe(false);
    expect(blue.anim).toBe('blue_down');
    expect(foe.isBlockedAt(foe.x, foe.y)).toBe(false);
    foe.x = at(10);
    r.run(STEP);
    expect(blue.raised).toBe(true);
    foe.x = at(8);
    r.run(STEP);
    expect(blue.raised).toBe(true);
  });

  it('rises under the hero (the engine moves the hero off)', () => {
    const r = rig();
    const red = r.add((g, i) => new Peg(g, i), 'obj.peg', at(8), at(8), { color: 'red' });
    r.pegs.state = true;
    r.run(STEP);
    r.place(at(8), at(8));
    r.pegs.state = false;
    r.run(STEP);
    expect(red.raised).toBe(true);
  });
});

describe('torch', () => {
  it('ignite lights it once with light 48; burnTime puts it out again', () => {
    const r = rig();
    const t = r.add((g, i) => new Torch(g, i), 'obj.torch', at(4), at(4), { burnTime: 1 }, 't1');
    expect(t.solid && t.hookable).toBe(true);
    expect(t.lit).toBe(false);
    expect(t.light).toBe(0);
    expect(t.ignite()).toBe(true);
    expect(t.lit).toBe(true);
    expect(t.light).toBe(TORCH_LIGHT);
    expect(t.anim).toBe('lit');
    expect(r.sfx).toContain('lantern');
    expect(r.events).toContainEqual({ type: 'torchLit', id: 't1' });
    expect(t.ignite()).toBe(false);
    r.run(0.9);
    expect(t.lit).toBe(true);
    r.run(0.2);
    expect(t.lit).toBe(false);
    expect(t.anim).toBe('unlit');
  });

  it('relighting a timed flame restarts its timer', () => {
    const r = rig();
    const t = r.add((g, i) => new Torch(g, i), 'obj.torch', at(4), at(4), { burnTime: 1 });
    t.ignite();
    r.run(0.8);
    expect(t.ignite()).toBe(false);
    r.run(0.8);
    expect(t.lit).toBe(true);
    r.run(0.3);
    expect(t.lit).toBe(false);
  });

  it('torches placed lit burn for ever, even when relit', () => {
    const r = rig();
    const t = r.add((g, i) => new Torch(g, i), 'obj.torch', at(4), at(4), { lit: true, burnTime: 1 });
    r.run(3);
    expect(t.lit).toBe(true);
    expect(t.ignite()).toBe(false);
    r.run(3);
    expect(t.lit).toBe(true);
  });
});

describe('pot', () => {
  it('is solid, liftable without a glove, and carries its contents', () => {
    const r = rig();
    const p = r.add((g, i) => new Pot(g, i), 'obj.pot', at(4), at(4), { contents: 'rupee5' });
    expect(p.solid).toBe(true);
    expect(p.liftWeight).toBe(0);
    expect(p.onLift()).toEqual({ sprite: 'obj.pot', anim: 'idle', drop: 'rupee5' });
  });

  it('a key pot leaves a one-time placed key where it stood, never a transient drop', () => {
    const r = rig();
    const p = r.add((g, i) => new Pot(g, i), 'obj.pot', at(4), at(4), { contents: 'smallKey' }, 'kp');
    expect(p.onLift()).toEqual({ sprite: 'obj.pot', anim: 'idle', drop: 'none' });
    const key = r.list.find((e): e is Pickup => e instanceof Pickup);
    expect(key?.id).toBe(potKeyId('kp'));
    expect([key?.x, key?.y, key?.item, key?.transient, key?.z]).toEqual([at(4), at(4), 'smallKey', false, 0]);
    expect(r.sfx).not.toContain('secret');
    r.run(VANISH_AT + 1);
    expect(key?.dead).toBe(false);
    key?.collect();
    expect(r.flags[`pickup:${potKeyId('kp')}`]).toBe(true);
    const again = r.add((g, i) => new Pot(g, i), 'obj.pot', at(4), at(4), { contents: 'smallKey' }, 'kp');
    expect(again.contents).toBe('random');
    expect(again.onLift().drop).toBe('random');
    expect(r.list.filter((e) => e instanceof Pickup && !e.dead)).toHaveLength(0);
  });
});

describe('pickups', () => {
  it('placed pickups are collected on touch once, with the right fanfare, and flagged', () => {
    const r = rig();
    const key = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'smallKey', amount: 1 }, 'k1');
    expect([key.w, key.h]).toEqual([10, 10]);
    r.place(at(3), at(3));
    r.run(0.2);
    expect(r.gifts).toHaveLength(0);
    r.place(at(8) + 8, at(6));
    r.run(STEP);
    expect(r.gifts).toEqual([{ item: 'smallKey', amount: 1, fanfare: false }]);
    expect(r.flags['pickup:k1']).toBe(true);
    expect(key.dead).toBe(true);
    const again = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'smallKey' }, 'k1');
    expect(again.dead).toBe(true);
    expect(again.visible).toBe(false);
  });

  it('non-refill items get the fanfare', () => {
    const r = rig();
    const hc = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'heartContainer' });
    hc.collect();
    expect(r.gifts).toEqual([{ item: 'heartContainer', amount: 1, fanfare: true }]);
  });

  it('transient drops pop in, blink after 7 s, vanish at 10 s and set no flag', () => {
    const r = rig();
    const loot = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'rupees', amount: 5, transient: true }, 'loot-1');
    expect(loot.z).toBe(0);
    expect(loot.anim).toBe('rupee_blue');
    r.run(0.1);
    expect(loot.z).toBeGreaterThan(1);
    r.run(VANISH_AT - 0.3);
    expect(loot.dead).toBe(false);
    r.run(0.4);
    expect(loot.dead).toBe(true);
    const drop = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'heart', transient: true }, 'loot-2');
    r.run(0.5);
    drop.collect();
    expect(r.gifts).toEqual([{ item: 'heart', amount: 1, fanfare: false }]);
    expect(Object.keys(r.flags)).toHaveLength(0);
  });

  it('transient keys and prizes never blink away', () => {
    const r = rig();
    const key = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'smallKey', transient: true }, 'loot-k');
    const hc = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(4), at(6), { item: 'heartContainer', transient: true }, 'loot-h');
    expect([key.expires, hc.expires]).toEqual([false, false]);
    r.run(VANISH_AT + 2);
    expect([key.dead, hc.dead]).toEqual([false, false]);
    key.collect();
    expect(r.flags).toEqual({});
  });

  it('the hero body reaches pickups just above its feet, but not while carrying', () => {
    const r = rig();
    const heart = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'heart' });
    const gapBelow = (gap: number) => r.place(at(8), heart.bottom + gap + r.hero.h / 2);
    gapBelow(BODY_REACH + 1);
    r.run(0.1);
    expect(heart.dead).toBe(false);
    gapBelow(BODY_REACH - 1);
    r.hero.state = 'carry';
    r.run(0.1);
    expect(heart.dead).toBe(false);
    r.hero.state = 'normal';
    r.run(STEP);
    expect(heart.dead).toBe(true);
    expect(r.gifts).toEqual([{ item: 'heart', amount: 1, fanfare: false }]);
  });

  it('pickups high in the air cannot be touched', () => {
    const r = rig();
    r.hero.animT = 1;
    const k = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'smallKey' });
    expect(k.z).toBeGreaterThan(20);
    r.place(at(8), at(6));
    r.run(STEP);
    expect(r.gifts).toHaveLength(0);
    r.run(1);
    expect(r.gifts).toHaveLength(1);
  });

  it('fairies drift around their spot', () => {
    const r = rig();
    const f = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'fairy' });
    const xs: number[] = [];
    for (let i = 0; i < 30; i++) {
      r.run(0.1);
      xs.push(f.x);
      expect(Math.abs(f.x - at(8))).toBeLessThanOrEqual(14.01);
      expect(f.z).toBeGreaterThan(4);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
  });

  it('a crystal freezes the hero for the claim, then gives the prize with fanfare', () => {
    const r = rig();
    const c = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'crystal' }, 'cr');
    r.place(at(8), at(6));
    r.run(STEP);
    expect(c.claiming).toBe(true);
    expect(r.hero.locked).toBe(true);
    expect(r.sfx).toContain('crystal');
    expect(r.gifts).toHaveLength(0);
    r.run(CLAIM_TIME);
    expect(r.hero.locked).toBe(false);
    expect(r.gifts).toEqual([{ item: 'crystal', amount: 1, fanfare: true }]);
    expect(r.flags['pickup:cr']).toBe(true);
  });

  it('the claim keeps sparkling from its first moment, whatever the idle glitter timer says', () => {
    const r = rig();
    const sparkles: number[] = [];
    (r.game as { effect: GameServices['effect'] }).effect = () => { sparkles.push(r.game.time); };
    r.place(at(2), at(12));
    r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(6), { item: 'crystal' }, 'cr');
    r.run(0.1);
    // The idle glitter just fired (its next one is 0.9 s away); now the hero touches the crystal.
    r.place(at(8), at(6));
    const start = r.game.time;
    r.run(0.3);
    const during = sparkles.filter((t) => t >= start);
    const afterBurst = during.filter((t) => t > start + STEP);
    expect(during.length).toBeGreaterThanOrEqual(8);
    expect(afterBurst.length).toBeGreaterThanOrEqual(4);
    expect(afterBurst[0]! - start).toBeLessThan(0.1);
  });
});

describe('shop item', () => {
  it('sells for its price, or refuses without enough rupees', () => {
    const r = rig();
    const s = r.add((g, i) => new ShopItem(g, i), 'obj.shopItem', at(8), at(5), { item: 'bombs', amount: 5, price: 30 });
    expect(s.solid).toBe(true);
    expect(s.anim).toBe('bombs');
    r.place(at(8), at(5) + 15, 'up');
    r.game.save.rupees = 20;
    expect(s.onInteract()).toBe(true);
    expect(r.dialogues).toEqual([NOT_ENOUGH_RUPEES]);
    expect(r.gifts).toHaveLength(0);
    r.game.save.rupees = 50;
    s.onInteract();
    expect(r.game.save.rupees).toBe(20);
    expect(r.gifts).toEqual([{ item: 'bombs', amount: 5, fanfare: false }]);
    const bow = r.add((g, i) => new ShopItem(g, i), 'obj.shopItem', at(3), at(5), { item: 'bow', amount: 1, price: 0 });
    r.place(at(3), at(5) + 15, 'up');
    bow.onInteract();
    expect(r.gifts[1]).toEqual({ item: 'bow', amount: 1, fanfare: true });
  });
});

describe('shop refusals', () => {
  it('knows when a purchase would give nothing', () => {
    const r = rig();
    const save = r.game.save;
    expect(purchaseRefusal(r.game, 'bombs', 5)).toBeNull();
    save.bombs = save.maxBombs;
    expect(purchaseRefusal(r.game, 'bombs', 5)).toBe(CANT_CARRY_MORE);
    expect(purchaseRefusal(r.game, 'arrows', 0)).toBe(CANT_CARRY_MORE);
    expect(purchaseRefusal(r.game, 'heart', 1)).toBe(ALREADY_FULL_HEALTH);
    save.hp = 3;
    expect(purchaseRefusal(r.game, 'heart', 1)).toBeNull();
    expect(purchaseRefusal(r.game, 'bow', 1)).toBeNull();
    r.items.bow = 1;
    expect(purchaseRefusal(r.game, 'bow', 1)).toBe('You already have the Bow.');
    r.items.sword = 1;
    expect(purchaseRefusal(r.game, 'sword', 1)).toBe(alreadyOwned('sword'));
    expect(purchaseRefusal(r.game, 'sword', 2)).toBeNull();
    expect(purchaseRefusal(r.game, 'sword', 0)).toBeNull();
    r.items.sword = 2;
    expect(purchaseRefusal(r.game, 'sword', 0)).toBe(alreadyOwned('sword'));
    expect(purchaseRefusal(r.game, 'smallKey', 1)).toBeNull();
    expect(purchaseRefusal(r.game, 'heartPiece', 1)).toBeNull();
  });

  it('refuses without charging, with an error buzz and the reason', () => {
    const r = rig();
    const s = r.add((g, i) => new ShopItem(g, i), 'obj.shopItem', at(8), at(5), { item: 'bombs', amount: 5, price: 30 });
    r.place(at(8), at(5) + 15, 'up');
    r.game.save.rupees = 100;
    r.game.save.bombs = r.game.save.maxBombs;
    expect(s.onInteract()).toBe(true);
    expect(r.game.save.rupees).toBe(100);
    expect(r.gifts).toHaveLength(0);
    expect(r.sfx).toContain('error');
    expect(r.dialogues).toEqual([CANT_CARRY_MORE]);
  });
});

describe('reveals', () => {
  it('room-entry spawns are silent; things revealed later sparkle, even right after a hero placement', () => {
    const r = rig();
    r.add((g, i) => new Chest(g, i), 'obj.chest', at(3), at(3));
    r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(5), at(3), { item: 'smallKey' });
    expect(r.sfx).not.toContain('secret');
    r.run(0.5);
    r.hero.animT = 0;
    const key = r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(8), at(8), { item: 'smallKey' });
    expect(r.sfx.filter((x) => x === 'secret')).toHaveLength(1);
    expect(key.z).toBeGreaterThan(20);
    r.add((g, i) => new Chest(g, i), 'obj.chest', at(10), at(8));
    expect(r.sfx.filter((x) => x === 'secret')).toHaveLength(2);
  });

  it('any object notes the room entry, so a door-only room still sees a later chest as revealed', () => {
    const r = rig(['################']);
    r.add((g, i) => new Door(g, i), 'obj.door', 128, 8, { kind: 'open' });
    r.run(0.5);
    r.hero.animT = 0;
    r.add((g, i) => new Chest(g, i), 'obj.chest', at(8), at(8));
    expect(r.sfx.filter((x) => x === 'secret')).toHaveLength(1);
  });

  it('opened chests and loot never announce themselves', () => {
    const r = rig();
    r.run(0.5);
    r.flags['chest:old'] = true;
    r.add((g, i) => new Chest(g, i), 'obj.chest', at(3), at(3), {}, 'old');
    r.add((g, i) => new Pickup(g, i), 'obj.pickup', at(5), at(3), { item: 'rupees', transient: true });
    expect(r.sfx).not.toContain('secret');
  });
});

describe('shop price tag', () => {
  it('is a solid counter strip in front of its item, on the above layer, and goes with it', () => {
    const r = rig();
    const s = r.add((g, i) => new ShopItem(g, i), 'obj.shopItem', at(8), at(5), { price: 12 });
    const tag = r.list.find((e): e is PriceTag => e instanceof PriceTag);
    expect(tag?.owner).toBe(s);
    expect(tag?.drawLayer).toBe('above');
    expect([tag?.x, tag?.y]).toEqual([s.x, s.y + 14]);
    expect([tag?.w, tag?.h, tag?.solid]).toEqual([16, 12, true]);
    expect(tag?.hurt(bomb)).toBe(false);
    s.dead = true;
    r.run(STEP);
    expect(r.list).not.toContain(tag);
  });

  it('sells the item when the hero faces the counter strip (standing back far enough to see the icon)', () => {
    const r = rig();
    const s = r.add((g, i) => new ShopItem(g, i), 'obj.shopItem', at(8), at(5), { item: 'bombs', amount: 5, price: 30 });
    const tag = r.list.find((e): e is PriceTag => e instanceof PriceTag)!;
    // Against the strip's bottom edge: 26 px below the item, the sprite top (18 px up) at the icon's bottom edge.
    r.place(s.x, s.y + 26, 'up');
    r.game.save.rupees = 50;
    expect(s.onInteract()).toBe(false);
    expect(tag.onInteract()).toBe(true);
    expect(r.gifts).toEqual([{ item: 'bombs', amount: 5, fanfare: false }]);
    expect(r.game.save.rupees).toBe(20);
  });
});

describe('markers', () => {
  const target: WarpTarget = { world: 'w2', room: 'r2', x: 40, y: 50, dir: 'down' };

  it('a warp fires only after the hero has been outside it', () => {
    const r = rig();
    const w = r.add((g, i) => new Warp(g, i), 'marker.warp', at(8), at(6), { target, transition: 'iris', sound: 'door' });
    expect(w.visible).toBe(false);
    r.place(at(8), at(6));
    r.run(0.5);
    expect(r.warps).toHaveLength(0);
    expect(w.isArmed).toBe(false);
    r.place(at(8), at(6) + 20);
    r.run(STEP);
    expect(w.isArmed).toBe(true);
    r.place(at(8) + 7, at(6) + 7);
    r.run(STEP);
    expect(r.warps).toEqual([{ target, style: 'iris' }]);
    expect(r.sfx).toContain('door');
    expect(r.game.save.respawn).toEqual(target);
    r.run(0.5);
    expect(r.warps).toHaveLength(1);
  });

  it('respects setRespawn=false and ignores warps without a destination', () => {
    const r = rig();
    r.add((g, i) => new Warp(g, i), 'marker.warp', at(8), at(6), { target, setRespawn: false, sound: 'none', w: 2, h: 1 });
    r.add((g, i) => new Warp(g, i), 'marker.warp', at(3), at(3), { target: null });
    r.place(at(1), at(1));
    r.run(STEP);
    r.place(at(3), at(3));
    r.run(STEP);
    expect(r.warps).toHaveLength(0);
    r.place(at(8) + 12, at(6));
    r.run(STEP);
    expect(r.warps).toHaveLength(1);
    expect(r.game.save.respawn.world).toBe('');
    expect(r.sfx).toHaveLength(0);
  });

  it('a region is a w x h tile rect centred on its spot', () => {
    const r = rig();
    const g = r.add((gm, i) => new Region(gm, i), 'marker.region', 128, 112, { name: 'hall', w: 4, h: 2 });
    expect(g.name).toBe('hall');
    expect([g.w, g.h]).toEqual([64, 32]);
    expect(g.contains(97, 97)).toBe(true);
    expect(g.contains(95, 112)).toBe(false);
  });
});

describe('npc person', () => {
  it('turns to the hero, shows its dialogue with its name, then emits talk', async () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(8), at(6), { name: 'Ada', dialogue: 'Nice day!', facing: 'down' }, 'npc1');
    expect(n.solid).toBe(true);
    expect(n.anim).toBe('idle_down');
    r.place(at(8) - 14, at(6), 'right');
    expect(n.onInteract()).toBe(true);
    expect(n.facing).toBe('left');
    expect(n.talking).toBe(true);
    expect(r.dialogues).toEqual(['Nice day!']);
    await Promise.resolve();
    await Promise.resolve();
    expect(n.talking).toBe(false);
    expect(r.events).toContainEqual({ type: 'talk', id: 'npc1' });
  });

  it('with no dialogue it still emits talk (for talk triggers)', () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(8), at(6), {}, 'quiet');
    n.onInteract();
    expect(r.dialogues).toHaveLength(0);
    expect(r.events).toContainEqual({ type: 'talk', id: 'quiet' });
  });

  it('interrupted mid-step, it lingers facing the hero before walking on', async () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(8), at(6), { behavior: 'wander', dialogue: 'Hi' });
    r.place(at(1), at(12));
    r.run(6, () => n.anim.startsWith('walk'));
    expect(n.anim.startsWith('walk')).toBe(true);
    const back = DIR_VEC[OPPOSITE[n.facing]];
    r.place(n.x + back.x * 16, n.y + back.y * 16);
    n.onInteract();
    const toHero = n.facing;
    await Promise.resolve();
    await Promise.resolve();
    expect(n.talking).toBe(false);
    const spot = [n.x, n.y];
    r.run(1.2);
    expect([n.x, n.y]).toEqual(spot);
    expect(n.facing).toBe(toHero);
    expect(n.anim).toBe(`idle_${toHero}`);
  });

  it('still NPCs never move', () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(8), at(6), { behavior: 'still' });
    r.run(5);
    expect([n.x, n.y]).toEqual([at(8), at(6)]);
  });

  it('wanderers stay within 2 tiles of home and never step into the hero', () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(8), at(6), { behavior: 'wander' });
    r.place(at(8), at(6) + 16);
    let moved = false;
    for (let i = 0; i < 1200; i++) {
      r.run(STEP);
      if (n.x !== at(8) || n.y !== at(6)) moved = true;
      expect(Math.abs(n.x - at(8))).toBeLessThanOrEqual(WANDER_RADIUS + 0.5);
      expect(Math.abs(n.y - at(6))).toBeLessThanOrEqual(WANDER_RADIUS + 0.5);
      expect(rectsOverlap(n.hitbox(), r.hero.hitbox())).toBe(false);
    }
    expect(moved).toBe(true);
  });

  it('pacers walk 3 tiles along their facing and back', () => {
    const r = rig();
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(4), at(6), { behavior: 'pace', facing: 'right' });
    r.place(at(12), at(12));
    let maxX = n.x;
    let returned = false;
    for (let i = 0; i < 600; i++) {
      r.run(STEP);
      maxX = Math.max(maxX, n.x);
      if (maxX >= at(4) + PACE_DIST - 0.5 && Math.abs(n.x - at(4)) < 0.5) returned = true;
      expect(n.y).toBe(at(6));
      expect(n.x).toBeGreaterThanOrEqual(at(4) - 0.5);
    }
    expect(maxX).toBeCloseTo(at(4) + PACE_DIST, 0);
    expect(returned).toBe(true);
  });

  it('falls back to the villager look and turns back at walls', () => {
    const r = rig(['', '', '', '', '', '', '', '################']);
    const n = r.add((g, i) => new Person(g, i), 'npc.person', at(9), at(5), { behavior: 'pace', facing: 'down', sprite: 'npc.nope' });
    expect(n.sprite).toBe('npc.villager');
    r.place(at(1), at(12));
    let deepest = n.y;
    let back = false;
    for (let i = 0; i < 480; i++) {
      r.run(STEP);
      deepest = Math.max(deepest, n.y);
      if (deepest > at(5) + 8 && Math.abs(n.y - at(5)) < 0.5) back = true;
    }
    expect(deepest).toBeLessThanOrEqual(7 * TILE - n.h / 2);
    expect(back).toBe(true);
  });
});
