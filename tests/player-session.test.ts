// The hero's combat & item state machine, driven tick by tick inside a real
// Session on arena rooms with a scriptable pad: sword, charge/spin, tink, cut,
// lift/carry/throw, push, shield, dash, bow, bombs, boomerang, hookshot, lantern.
import { describe, expect, it } from 'vitest';
import type { AudioApi, Button, DebugFlags, Hit, InputState } from '../src/game/api';
import type { Dir, EntityInstance, MusicId, SfxId } from '../src/core/types';
import type { Vec } from '../src/core/math';
import { rectsOverlap } from '../src/core/math';
import { STEP } from '../src/core/constants';
import { T } from '../src/content/ids';
import { type ArenaOptions, buildArenaProject } from '../src/dev/arena';
import { createTestProject } from '../src/content/testProject';
import type { Project, WarpTarget } from '../src/core/types';
import { newSave } from '../src/game/state';
import { Entity } from '../src/game/entity';
import type { GameServices } from '../src/game/api';
import { registerEntity } from '../src/game/registry';
import { Session } from '../src/game/session';
import { Arrow } from '../src/game/projectiles/arrow';
import { Bomb } from '../src/game/projectiles/bomb';
import { Boomerang } from '../src/game/projectiles/boomerang';
import { Hookshot } from '../src/game/projectiles/hookshot';
import { ThrownObject } from '../src/game/projectiles/thrown';
import { SPIN_TIME, SWING_TIME } from '../src/game/player/sword';

/** A pad whose buttons change between ticks (pressed/released last exactly one tick). */
class Pad implements InputState {
  private readonly down = new Set<Button>();
  private prev = new Set<Button>();
  private now = new Set<Button>();
  private readonly since = new Map<Button, number>();
  hold(...bs: Button[]): void { for (const b of bs) this.down.add(b); }
  release(...bs: Button[]): void { for (const b of bs) this.down.delete(b); }
  /** Advance one tick (call before Session.tick). */
  step(): void {
    this.prev = this.now;
    this.now = new Set(this.down);
    for (const b of this.now) this.since.set(b, (this.since.get(b) ?? -STEP) + STEP);
    for (const b of [...this.since.keys()]) if (!this.now.has(b)) this.since.delete(b);
  }
  held(b: Button): boolean { return this.now.has(b); }
  pressed(b: Button): boolean { return this.now.has(b) && !this.prev.has(b); }
  released(b: Button): boolean { return !this.now.has(b) && this.prev.has(b); }
  heldTime(b: Button): number { return this.now.has(b) ? (this.since.get(b) ?? 0) + STEP : 0; }
  dir(): Vec {
    return {
      x: (this.now.has('right') ? 1 : 0) - (this.now.has('left') ? 1 : 0),
      y: (this.now.has('down') ? 1 : 0) - (this.now.has('up') ? 1 : 0),
    };
  }
  anyPressed(): boolean { return [...this.now].some((b) => !this.prev.has(b)); }
  typed(): string { return ''; }
}

class FakeAudio implements AudioApi {
  readonly log: SfxId[] = [];
  currentMusic: MusicId | 'none' = 'none';
  sfx(id: SfxId): void { this.log.push(id); }
  music(id: MusicId | 'none'): void { this.currentMusic = id; }
  duck(): void {}
  setVolumes(): void {}
  unlock(): void {}
  setMuted(): void {}
}

/** Enemy stand-in: `hp` prop, never moves or attacks. */
class Dummy extends Entity {
  lastHit: Hit | null = null;
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst, 'ptest.dummy');
    this.team = 'enemy';
    this.hp = this.maxHp = Number(inst.props['hp'] ?? 1);
    this.w = 12;
    this.h = 12;
  }
  override hurt(hit: Hit): boolean {
    this.lastHit = hit;
    return super.hurt(hit);
  }
}

/** Solid pushable / hookable / ignitable block. */
class Post extends Entity {
  pushes: Dir[] = [];
  lit = false;
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst, 'ptest.post');
    this.solid = true;
    this.hookable = true;
    this.w = 16;
    this.h = 16;
  }
  override hurt(): boolean { return false; }
  override onPush(dir: Dir): boolean {
    this.pushes.push(dir);
    return true;
  }
  override ignite(): boolean {
    this.lit = true;
    return true;
  }
}

/** Liftable pot stand-in (liftWeight 0, drops nothing). */
class Jar extends Entity {
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst, 'ptest.jar');
    this.solid = true;
    this.liftWeight = 0;
    this.w = 16;
    this.h = 16;
  }
  override hurt(): boolean { return false; }
  override onLift() { return { sprite: 'obj.pot', anim: 'idle', drop: 'none' as const }; }
}

/** Remotely collectable pickup stand-in. */
class Gem extends Entity {
  collected = 0;
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst, 'ptest.gem');
    this.w = 8;
    this.h = 8;
  }
  override collect(): void {
    this.collected++;
    this.dead = true;
  }
}

/** Plain solid obstacle (not hookable, not pushable). */
class Pillar extends Entity {
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst, 'ptest.pillar');
    this.solid = true;
    this.w = 16;
    this.h = 16;
  }
  override hurt(): boolean { return false; }
}

registerEntity('ptest.dummy', (g, i) => new Dummy(g, i));
registerEntity('ptest.pillar', (g, i) => new Pillar(g, i));
registerEntity('ptest.post', (g, i) => new Post(g, i));
registerEntity('ptest.jar', (g, i) => new Jar(g, i));
registerEntity('ptest.gem', (g, i) => new Gem(g, i));

interface Rig {
  s: Session;
  pad: Pad;
  audio: FakeAudio;
}

function arena(opts: ArenaOptions): Rig {
  return rigFor(buildArenaProject({ theme: 'dungeon', ...opts }));
}

/** A grass arena (open edges) with an identical empty room east of it. */
function twoRooms(opts: ArenaOptions): Rig {
  const project = buildArenaProject({ theme: 'grass', ...opts });
  const world = project.worlds[0]!;
  const east = structuredClone(world.rooms[0]!);
  east.id = 'room2';
  east.name = 'Room 2';
  east.gx = 1;
  east.entities = [];
  world.rooms.push(east);
  return rigFor(project);
}

function rigFor(project: Project, start: WarpTarget = project.start): Rig {
  const pad = new Pad();
  const audio = new FakeAudio();
  const debug: DebugFlags = { hitboxes: false, invincible: false, noclip: false, fps: false };
  const save = newSave(project, 0, 'T');
  const host = { mode: 'playtest' as const, persist: async () => {}, exit: () => {} };
  const s = new Session(host, project, pad, audio, save, debug, start);
  return { s, pad, audio };
}

function tick(r: Rig, seconds: number, until?: () => boolean): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    r.pad.step();
    r.s.tick(STEP);
    if (until?.()) return;
  }
}

/** Press a button for `ticks` ticks, then release it for one tick (so the next tap is a fresh press). */
function tap(r: Rig, b: Button, ticks = 2): void {
  r.pad.hold(b);
  tick(r, ticks * STEP);
  r.pad.release(b);
  tick(r, STEP);
}

const find = <T extends Entity>(r: Rig, cls: abstract new (...a: never[]) => T): T[] =>
  r.s.entities.filter((e): e is T => e instanceof cls && !e.dead);
const byId = (r: Rig, id: string) => r.s.entities.find((e) => e.id === id);

describe('sword', () => {
  it('swings for SWING_TIME, strikes each enemy once per swing and kills it on the second', () => {
    const r = arena({ entities: [{ id: 'd', type: 'ptest.dummy', x: 128, y: 116, props: { hp: 2 } }] });
    const d = byId(r, 'd') as Dummy;
    tap(r, 'b');
    expect(r.s.player.state).toBe('attack');
    expect(r.s.player.swordRect()).not.toBeNull();
    tick(r, SWING_TIME);
    expect(r.s.player.state).toBe('normal');
    expect(r.s.player.swordRect()).toBeNull();
    expect(d.hp).toBe(1);
    expect(d.lastHit?.kind).toBe('sword');
    expect(d.lastHit?.dy).toBeLessThan(0);
    tick(r, 0.4);
    // The first hit knocked it 16px away; walk up and strike again.
    r.pad.hold('up');
    tick(r, 0.2);
    r.pad.release('up');
    tap(r, 'b');
    tick(r, SWING_TIME);
    expect(d.dead).toBe(true);
    expect(r.audio.log).toContain('sword');
  });

  it('an enemy still blinking from an earlier hit is struck once its i-frames run out, in the same swing', () => {
    const r = arena({ entities: [{ id: 'd', type: 'ptest.dummy', x: 128, y: 116, props: { hp: 3 } }] });
    const d = byId(r, 'd') as Dummy;
    d.invuln = 0.2;
    tap(r, 'b');
    tick(r, SWING_TIME);
    expect(d.hp).toBe(2);
  });

  it('cuts bushes and tall grass under the blade', () => {
    const r = arena({
      theme: 'grass',
      player: { x: 120, y: 120, dir: 'up' },
      tiles: [{ tx: 7, ty: 6, tile: 'BUSH' }, { tx: 8, ty: 7, tile: 'TALL_GRASS', layer: 'bg' }],
    });
    tap(r, 'b');
    tick(r, SWING_TIME);
    // Facing up, the arc sweeps from the hero's right side (the grass) to straight ahead (the bush).
    expect(r.s.room.tile('fg', 7, 6)).toBe(T.GRASS);
    expect(r.s.room.tile('bg', 8, 7)).toBe(T.GRASS);
    expect(r.audio.log).toContain('cut');
  });

  it('tinks off a wall with a small recoil', () => {
    const r = arena({ player: { x: 128, y: 24, dir: 'up' } });
    const y0 = r.s.player.y;
    tap(r, 'b');
    tick(r, SWING_TIME);
    expect(r.audio.log).toContain('swordTink');
    expect(r.s.player.y).toBeGreaterThan(y0);
  });

  it('holding B charges; releasing a charged sword spins, hitting all around for double damage', () => {
    const r = arena({ items: { sword: 1 } });
    r.pad.hold('b');
    tick(r, SWING_TIME + 0.1);
    expect(r.s.player.state).toBe('charge');
    tick(r, 0.6);
    expect(r.audio.log).toContain('swordCharge');
    // Targets on all four sides, placed once charged so the opening swing can't knock them away.
    const around = [[128, 116], [128, 156], [108, 136], [148, 136]] as const;
    const dummies = around.map(([x, y], i) => r.s.spawn(new Dummy(r.s, { id: `d${i}`, type: 'ptest.dummy', x, y, props: { hp: 5 } })));
    r.pad.release('b');
    tick(r, STEP);
    expect(r.s.player.state).toBe('spin');
    tick(r, SPIN_TIME + 0.05);
    expect(r.audio.log).toContain('swordSpin');
    dummies.forEach((d, i) => {
      expect(d.lastHit?.kind, `dummy ${i}`).toBe('spin');
      expect(d.lastHit?.damage).toBe(2);
    });
    expect(r.s.player.state).toBe('normal');
  });

  it('walking a charged blade into a wall pokes it (tink, recoil), again and again', () => {
    const r = arena({ player: { x: 128, y: 60, dir: 'up' } });
    r.pad.hold('b');
    tick(r, SWING_TIME + STEP);
    expect(r.audio.log).not.toContain('swordTink');
    r.pad.hold('up');
    tick(r, 1.5);
    expect(r.s.player.state).toBe('charge');
    expect(r.audio.log.filter((id) => id === 'swordTink').length).toBeGreaterThanOrEqual(2);
  });

  it('a charged blade pushed against a wall keeps poking it; standing still does not', () => {
    const r = arena({ player: { x: 128, y: 24, dir: 'up' } });
    r.pad.hold('b');
    tick(r, 1);
    const tinks = () => r.audio.log.filter((id) => id === 'swordTink').length;
    const still = tinks();
    expect(still).toBe(1);
    r.pad.hold('up');
    tick(r, 1);
    expect(tinks() - still).toBeGreaterThanOrEqual(3);
  });

  it('releasing before the charge completes just sheathes', () => {
    const r = arena({});
    r.pad.hold('b');
    tick(r, 0.5);
    r.pad.release('b');
    tick(r, 0.1);
    expect(r.s.player.state).toBe('normal');
    expect(r.audio.log).not.toContain('swordSpin');
  });

  it('taking damage cancels the charge', () => {
    const r = arena({});
    r.pad.hold('b');
    tick(r, 0.5);
    expect(r.s.player.state).toBe('charge');
    r.s.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 1, dy: 0 });
    expect(r.s.player.state).toBe('hurt');
    tick(r, 0.8);
    r.pad.release('b');
    tick(r, 0.1);
    expect(r.audio.log).not.toContain('swordSpin');
  });
});

describe('lift, carry, throw', () => {
  it('lifts a bush tile, carries it and throws it about four tiles where it shatters', () => {
    const r = arena({ theme: 'grass', player: { x: 120, y: 136, dir: 'up' }, tiles: [{ tx: 7, ty: 7, tile: 'BUSH' }] });
    tap(r, 'a');
    expect(r.s.player.state).toBe('lift');
    expect(r.s.room.tile('fg', 7, 7)).toBe(T.GRASS);
    tick(r, 0.25);
    expect(r.s.player.state).toBe('carry');
    const obj = r.s.player.carrying as ThrownObject;
    expect(obj).toBeInstanceOf(ThrownObject);
    expect(obj.info.tile).toBe(T.BUSH);
    expect(obj.z).toBeGreaterThan(15);
    tap(r, 'a');
    expect(r.s.player.carrying).toBeNull();
    const y0 = r.s.player.y;
    let landedY = 0;
    tick(r, 1, () => {
      if (!obj.dead) landedY = obj.y;
      return obj.dead;
    });
    expect(obj.dead).toBe(true);
    expect(y0 - landedY).toBeGreaterThan(50);
    expect(y0 - landedY).toBeLessThan(76);
    expect(r.audio.log).toContain('shatter');
  });

  it('lifts a liftable entity (onLift) and drops it when hurt', () => {
    const r = arena({ entities: [{ id: 'j', type: 'ptest.jar', x: 128, y: 120 }] });
    tap(r, 'a');
    tick(r, 0.3);
    expect(byId(r, 'j')).toBeUndefined();
    expect(r.s.player.state).toBe('carry');
    const obj = r.s.player.carrying!;
    r.s.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: 1 });
    expect(r.s.player.carrying).toBeNull();
    tick(r, 0.5);
    expect(obj.dead).toBe(true);
  });

  it('cannot lift a rock without the glove, can with it', () => {
    const r = arena({ theme: 'grass', player: { x: 120, y: 136, dir: 'up' }, tiles: [{ tx: 7, ty: 7, tile: 'ROCK' }] });
    tap(r, 'a');
    expect(r.s.player.state).toBe('normal');
    r.s.giveItem('glove', 1);
    tap(r, 'a');
    expect(r.s.player.state).toBe('lift');
  });
});

describe('carrying across rooms', () => {
  it('a held object scrolls into the next room with the hero and can be thrown there', () => {
    const project = createTestProject();
    const r = rigFor(project, { ...project.start, room: 'ow_meadow', x: 200, y: 110, dir: 'right' });
    r.s.spawn(new Jar(r.s, { id: 'jar', type: 'ptest.jar', x: 214, y: 110, props: {} }));
    tap(r, 'a');
    tick(r, 0.3);
    expect(r.s.player.state).toBe('carry');
    const jar = r.s.player.carrying!;
    r.pad.hold('right');
    tick(r, 2, () => r.s.mode === 'transition');
    r.pad.release('right');
    expect(r.s.room.def.id).toBe('ow_lake');
    // Already overhead at the hero's new spot while the rooms slide (not left behind, off-screen).
    expect(r.s.entities).toContain(jar);
    expect({ x: jar.x, y: jar.y }).toEqual({ x: r.s.player.x, y: r.s.player.y });
    tick(r, 0.8);
    expect(r.s.mode).toBe('playing');
    expect(r.s.player.state).toBe('carry');
    expect(r.s.player.carrying).toBe(jar);
    expect(r.s.entities).toContain(jar);
    expect(jar.dead).toBe(false);
    tap(r, 'a');
    tick(r, 1);
    expect(jar.dead).toBe(true);
  });
});

describe('room edges', () => {
  it('a charged sword carries on through an edge scroll and spins in the next room', () => {
    const r = twoRooms({ player: { x: 200, y: 120, dir: 'right' } });
    r.pad.hold('b');
    tick(r, 1);
    expect(r.s.player.state).toBe('charge');
    r.pad.hold('right');
    tick(r, 3, () => r.s.mode === 'transition');
    r.pad.release('right');
    tick(r, 0.8);
    expect(r.s.room.def.id).toBe('room2');
    expect(r.s.player.state).toBe('charge');
    expect(r.s.player.swordRect()).not.toBeNull();
    r.pad.release('b');
    tick(r, STEP);
    expect(r.s.player.state).toBe('spin');
  });

  it('a dash runs on through an edge scroll', () => {
    const r = twoRooms({ items: { boots: 1 }, player: { x: 150, y: 120, dir: 'right' } });
    r.pad.hold('a');
    tick(r, 2, () => r.s.mode === 'transition');
    tick(r, 0.7);
    expect(r.s.room.def.id).toBe('room2');
    expect(r.s.player.state).toBe('dash');
    const x0 = r.s.player.x;
    tick(r, 0.1);
    expect(r.s.player.x).toBeGreaterThan(x0 + 10);
  });

  it('arrows, boomerangs, swords and thrown pots meet open air at the edge, not a wall', () => {
    const r = twoRooms({
      items: { bow: 1, arrows: 5, boomerang: 1 }, player: { x: 246, y: 120, dir: 'right' },
    });
    tap(r, 'b');
    tick(r, SWING_TIME);
    r.s.save.equipped = 'bow';
    tap(r, 'y');
    // Flown off the screen within a few ticks (a stuck arrow would quiver on for a while).
    expect(r.s.save.arrows).toBe(4);
    expect(find(r, Arrow)).toHaveLength(0);
    r.s.save.equipped = 'boomerang';
    r.pad.hold('left');
    tick(r, 0.5);
    r.pad.release('left');
    r.pad.hold('right', 'y');
    tick(r, STEP);
    r.pad.release('right', 'y');
    const [boomerang] = find(r, Boomerang);
    expect(boomerang).toBeDefined();
    tick(r, 1.5, () => boomerang!.dead);
    expect(boomerang!.dead).toBe(true);
    expect(boomerang!.x).toBeLessThanOrEqual(r.s.room.width);
    expect(r.audio.log).not.toContain('swordTink');
    expect(r.audio.log).not.toContain('arrowHit');
    // Lift a jar and throw it east off the screen: gone without breaking in mid-air.
    const p = r.s.player;
    r.s.spawn(new Jar(r.s, { id: 'jar', type: 'ptest.jar', x: p.x, y: p.y + 16, props: {} }));
    r.pad.hold('down');
    tick(r, STEP);
    r.pad.release('down');
    tap(r, 'a');
    tick(r, 0.3);
    const pot = r.s.player.carrying!;
    expect(pot).toBeInstanceOf(ThrownObject);
    r.pad.hold('right');
    tick(r, STEP);
    r.pad.release('right');
    tap(r, 'a');
    tick(r, 1, () => pot.dead);
    expect(pot.dead).toBe(true);
    expect(r.audio.log).not.toContain('shatter');
    expect(r.s.room.def.id).toBe('arena_room');
  });

  it('bombs can not be placed past the edge', () => {
    const r = twoRooms({ items: { bombs: 3 }, player: { x: 250, y: 120, dir: 'right' } });
    r.s.save.equipped = 'bombs';
    tap(r, 'y');
    const [bomb] = find(r, Bomb);
    expect(bomb!.x + bomb!.w / 2).toBeLessThanOrEqual(r.s.room.width);
  });
});

describe('push', () => {
  it('pushing into a solid entity for 0.3 s shows the push pose and calls onPush once', () => {
    const r = arena({ entities: [{ id: 'p', type: 'ptest.post', x: 128, y: 112 }] });
    const post = byId(r, 'p') as Post;
    r.pad.hold('up');
    tick(r, 0.25);
    expect(post.pushes).toEqual([]);
    tick(r, 0.2);
    expect(post.pushes).toEqual(['up']);
    tick(r, 0.1);
    expect(r.s.player.state).toBe('push');
    r.pad.release('up');
    tick(r, STEP * 2);
    expect(r.s.player.state).toBe('normal');
  });

  it('shows the push pose against plain walls too', () => {
    const r = arena({ player: { x: 128, y: 30, dir: 'up' } });
    r.pad.hold('up');
    tick(r, 0.6);
    expect(r.s.player.state).toBe('push');
  });
});

describe('shield', () => {
  const shot = (blockable: boolean, x: number, y: number) => ({ blockable, x, y }) as Entity;

  it('blocks blockable shots from the front, not from behind or without a shield', () => {
    const r = arena({});
    const p = r.s.player;
    expect(p.hurtPlayer({ damage: 1, kind: 'projectile', source: shot(true, 128, 100), dx: 0, dy: 1 })).toBe('blocked');
    expect(r.audio.log).toContain('shield');
    expect(r.s.save.hp).toBe(r.s.save.maxHp);
    expect(p.hurtPlayer({ damage: 1, kind: 'projectile', source: shot(true, 128, 170), dx: 0, dy: -1 })).toBe('hit');
    const r2 = arena({ noDefaultItems: true, items: { sword: 1 } });
    expect(r2.s.player.hurtPlayer({ damage: 1, kind: 'projectile', source: shot(true, 128, 100), dx: 0, dy: 1 })).toBe('hit');
  });

  it('does not block while swinging', () => {
    const r = arena({});
    tap(r, 'b');
    expect(r.s.player.hurtPlayer({ damage: 1, kind: 'projectile', source: shot(true, 128, 100), dx: 0, dy: 1 })).toBe('hit');
  });
});

describe('dash', () => {
  it('winds up, runs at 180 px/s and bonks off a wall', () => {
    const r = arena({ items: { boots: 1 }, player: { x: 128, y: 180, dir: 'up' } });
    const p = r.s.player;
    r.pad.hold('a');
    tick(r, 0.3);
    expect(p.state).toBe('dash');
    expect(p.y).toBe(180);
    tick(r, 0.2);
    expect(p.y).toBeLessThan(170);
    tick(r, 2, () => p.state !== 'dash');
    expect(p.state).toBe('hurt');
    expect(r.audio.log).toContain('hit');
    r.pad.release('a');
    tick(r, 0.3);
    expect(p.state).toBe('normal');
    expect(p.y).toBeGreaterThan(24);
  });

  it('the wind-up can be re-aimed: turning while running in place dashes the new way', () => {
    const r = arena({ items: { boots: 1 }, player: { x: 128, y: 120, dir: 'up' } });
    const p = r.s.player;
    r.pad.hold('a');
    tick(r, 0.1);
    r.pad.hold('left');
    tick(r, 0.4);
    expect(p.state).toBe('dash');
    expect(p.facing).toBe('left');
    expect(p.x).toBeLessThan(120);
    expect(p.y).toBe(120);
  });

  it('releasing the button stops the dash; the sword hurts what it runs into', () => {
    const r = arena({
      items: { boots: 1 }, player: { x: 128, y: 190, dir: 'up' },
      entities: [{ id: 'd', type: 'ptest.dummy', x: 128, y: 120, props: { hp: 5 } }],
    });
    r.pad.hold('a');
    tick(r, 0.8);
    const d = byId(r, 'd') as Dummy;
    expect(d.lastHit?.kind).toBe('sword');
    r.pad.release('a');
    tick(r, STEP * 2);
    expect(r.s.player.state).not.toBe('dash');
  });
});

describe('items', () => {
  it('bow: one arrow per press, sticks in the wall; no arrows = error', () => {
    const r = arena({ items: { bow: 1, arrows: 1 } });
    r.s.save.equipped = 'bow';
    tap(r, 'y');
    expect(r.s.player.state).toBe('use');
    expect(r.s.save.arrows).toBe(0);
    const [arrow] = find(r, Arrow);
    expect(arrow).toBeDefined();
    tick(r, 1, () => arrow!.stuck);
    expect(arrow!.stuck).toBe(true);
    expect(arrow!.y).toBeLessThan(40);
    expect(r.audio.log).toContain('arrowHit');
    tick(r, 0.5);
    tap(r, 'y');
    expect(r.audio.log).toContain('error');
  });

  it('bow: arrows hurt enemies for 2', () => {
    const r = arena({ items: { bow: 1, arrows: 5 }, entities: [{ id: 'd', type: 'ptest.dummy', x: 128, y: 60, props: { hp: 5 } }] });
    r.s.save.equipped = 'bow';
    tap(r, 'y');
    tick(r, 0.5);
    const d = byId(r, 'd') as Dummy;
    expect(d.hp).toBe(3);
    expect(d.lastHit?.kind).toBe('arrow');
  });

  it('bombs: placed ahead, explode after the fuse, open a cracked wall for good and hurt nearby enemies', () => {
    const r = arena({
      items: { bombs: 3 }, player: { x: 128, y: 40, dir: 'up' },
      tiles: [{ tx: 8, ty: 1, tile: 'CRACKED_WALL' }],
      entities: [{ id: 'd', type: 'ptest.dummy', x: 150, y: 36, props: { hp: 5 } }],
    });
    r.s.save.equipped = 'bombs';
    tap(r, 'y');
    expect(r.s.save.bombs).toBe(2);
    const [bomb] = find(r, Bomb);
    expect(bomb).toBeDefined();
    // Walk away from the blast.
    r.pad.hold('down');
    tick(r, 0.8);
    r.pad.release('down');
    tick(r, 1.2);
    expect(bomb!.dead).toBe(true);
    expect(r.s.room.tile('fg', 8, 1)).toBe(T.DFLOOR);
    expect(Object.keys(r.s.save.flags).some((k) => k.startsWith('tile:arena_room:fg:8,1='))).toBe(true);
    expect((byId(r, 'd') as Dummy).lastHit?.kind).toBe('bomb');
    expect(r.audio.log).toContain('explode');
  });

  it('bombs can be lifted and thrown while the fuse burns', () => {
    const r = arena({ items: { bombs: 3 } });
    r.s.save.equipped = 'bombs';
    tap(r, 'y');
    tick(r, 0.3);
    tap(r, 'a');
    expect(r.s.player.carrying).toBeInstanceOf(Bomb);
    tick(r, 0.3);
    tap(r, 'a');
    const bomb = find(r, Bomb)[0]!;
    expect(bomb.isFlying).toBe(true);
    tick(r, 2);
    expect(bomb.dead).toBe(true);
    expect(r.s.save.hp).toBe(r.s.save.maxHp);
  });

  it('boomerang: flies out, stuns an enemy, comes back; one at a time', () => {
    const r = arena({ items: { boomerang: 1 }, entities: [{ id: 'd', type: 'ptest.dummy', x: 128, y: 80, props: { hp: 5 } }] });
    r.s.save.equipped = 'boomerang';
    tap(r, 'y');
    const [b] = find(r, Boomerang);
    expect(b).toBeDefined();
    tick(r, 0.1);
    tap(r, 'y');
    expect(find(r, Boomerang)).toHaveLength(1);
    tick(r, 0.4);
    const d = byId(r, 'd') as Dummy;
    expect(d.stun).toBeGreaterThan(1);
    expect(d.hp).toBe(5);
    tick(r, 2, () => b!.dead);
    expect(b!.dead).toBe(true);
  });

  it('boomerang fetches a pickup', () => {
    const r = arena({ items: { boomerang: 1 }, entities: [{ id: 'g', type: 'ptest.gem', x: 128, y: 90 }] });
    r.s.save.equipped = 'boomerang';
    const gem = byId(r, 'g') as Gem;
    tap(r, 'y');
    tick(r, 2, () => gem.dead);
    expect(gem.collected).toBe(1);
  });

  it('hookshot: latches onto a hookable entity across a pit and pulls the hero over', () => {
    const r = arena({
      items: { hookshot: 1 }, player: { x: 128, y: 180, dir: 'up' },
      tiles: [{ layer: 'bg', tx: 6, ty: 5, w: 4, h: 4, tile: 'PIT' }],
      entities: [{ id: 'p', type: 'ptest.post', x: 128, y: 56 }],
    });
    r.s.save.equipped = 'hookshot';
    tap(r, 'y');
    expect(r.s.player.state).toBe('hookshot');
    const [hook] = find(r, Hookshot);
    tick(r, 1.5, () => r.s.player.state !== 'hookshot');
    expect(hook!.dead).toBe(true);
    expect(r.s.player.state).toBe('normal');
    expect(r.s.player.y).toBeCloseTo(64 + 6, 0);
    tick(r, 0.2);
    expect(r.s.player.state).toBe('normal');
  });

  it('hookshot: the pulled hero slides round a corner the claw slipped past instead of clipping it', () => {
    const r = arena({
      items: { hookshot: 1 }, player: { x: 128, y: 180, dir: 'up' },
      entities: [{ id: 'p', type: 'ptest.post', x: 128, y: 56 }, { id: 'w', type: 'ptest.pillar', x: 116, y: 120 }],
    });
    r.s.save.equipped = 'hookshot';
    const wall = byId(r, 'w')!;
    tap(r, 'y');
    let clipped = false;
    tick(r, 1.5, () => {
      if (rectsOverlap(r.s.player.hitbox(), wall.hitbox())) clipped = true;
      return r.s.player.state !== 'hookshot';
    });
    expect(clipped).toBe(false);
    expect(r.s.player.state).toBe('normal');
    expect(r.s.player.y).toBeCloseTo(64 + 6, 0);
  });

  it('bombs placed over a pit drop in, and thrown into deep water splash, without a blast', () => {
    const r = arena({
      theme: 'grass', items: { bombs: 3 }, player: { x: 128, y: 136, dir: 'up' },
      tiles: [{ layer: 'bg', tx: 7, ty: 7, w: 2, h: 1, tile: 'HOLE' }, { layer: 'bg', tx: 6, ty: 3, w: 7, h: 3, tile: 'WATER' }],
    });
    r.s.save.equipped = 'bombs';
    tap(r, 'y');
    expect(r.s.save.bombs).toBe(2);
    expect(find(r, Bomb)).toHaveLength(0);
    // Step aside, place one on the grass, lift it and throw it into the water.
    r.pad.hold('right');
    tick(r, 0.4);
    r.pad.release('right');
    r.pad.hold('up');
    tick(r, STEP);
    r.pad.release('up');
    tick(r, STEP);
    tap(r, 'y');
    tick(r, 0.25);
    tap(r, 'a');
    tick(r, 0.3);
    expect(r.s.player.carrying).toBeInstanceOf(Bomb);
    const thrown = r.s.player.carrying as Bomb;
    tap(r, 'a');
    tick(r, 1, () => thrown.dead);
    expect(thrown.dead).toBe(true);
    expect(r.audio.log).toContain('splash');
    tick(r, 2);
    expect(r.audio.log).not.toContain('explode');
    expect(r.s.save.bombs).toBe(1);
  });

  it('hookshot retracts from walls', () => {
    const r = arena({ items: { hookshot: 1 }, player: { x: 128, y: 60, dir: 'up' } });
    r.s.save.equipped = 'hookshot';
    tap(r, 'y');
    tick(r, 1, () => r.s.player.state !== 'hookshot');
    expect(r.s.player.state).toBe('normal');
    expect(r.s.player.y).toBe(60);
    expect(r.audio.log).toContain('swordTink');
  });

  it('lantern: costs 2 magic, lights what the flame touches; no magic = error', () => {
    const r = arena({ items: { lantern: 1 }, entities: [{ id: 'p', type: 'ptest.post', x: 128, y: 120 }] });
    r.s.save.equipped = 'lantern';
    r.s.save.magic = 3;
    tap(r, 'y');
    tick(r, 0.1);
    expect((byId(r, 'p') as Post).lit).toBe(true);
    expect(r.s.save.magic).toBe(1);
    tick(r, 1);
    tap(r, 'y');
    expect(r.audio.log).toContain('error');
    expect(r.s.save.magic).toBe(1);
  });
});
