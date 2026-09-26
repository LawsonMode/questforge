// TriggerSystem against mock services: every condition kind, the 'auto' rising
// edge, 'enter'/'talk' firing (checked before any of them fires; 'enter' starts
// on the first update after entry), once flags (recorded when the trigger
// fires), sequential actions (dialogue, wait, fanfare and warp blocking),
// flushing on the hero's death, setTile in the sequence's own room, missing
// targets and the dungeon-complete flow.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, Condition, EntityInstance, Room, Trigger, WarpTarget, World } from '../src/core/types';
import type { GameEvent, GameServices } from '../src/game/api';
import { CRYSTAL_EXIT_DELAY, CRYSTAL_JINGLE_DELAY, TriggerSystem, dungeonExit } from '../src/game/triggers';
import { tileFlagName } from '../src/game/world';

const STEP = 1 / 60;

interface FakeEntity {
  id: string;
  type: string;
  dead: boolean;
  countsForClear: boolean;
  on?: boolean;
  lit?: boolean;
  setOpen?: (open: boolean) => void;
  hitbox(): { x: number; y: number; w: number; h: number };
}

function fakeEntity(id: string, type: string, extra: Partial<FakeEntity> = {}): FakeEntity {
  return { id, type, dead: false, countsForClear: false, hitbox: () => ({ x: 0, y: 0, w: 16, h: 16 }), ...extra };
}

function inst(id: string, type: string, x: number, y: number, props: EntityInstance['props'] = {}): EntityInstance {
  return { id, type, x, y, props };
}

function room(id: string, triggers: Trigger[], entities: EntityInstance[] = []): Room {
  return {
    id, name: id, gx: 0, gy: 0, gw: 1, gh: 1, floor: 0, layers: { bg: [], fg: [], over: [] }, entities, triggers,
  };
}

function trigger(id: string, on: Trigger['on'], conditions: Condition[], actions: Action[], extra: Partial<Trigger> = {}): Trigger {
  return { id, name: id, on, conditions, actions, once: false, ...extra };
}

/** Mock GameServices: records calls, dialogues resolve when the test says so. */
class Rig {
  readonly flags: Record<string, boolean> = {};
  readonly entities: FakeEntity[] = [];
  readonly log: string[] = [];
  readonly dialogues: { id: string; resolve: (n: number) => void; reject: (e: Error) => void }[] = [];
  readonly items = new Set<string>();
  readonly player = {
    x: 128, y: 112, state: 'normal', locked: false,
    heal: (n: number) => this.log.push(`heal:${n}`),
    setLocked: (locked: boolean) => { this.player.locked = locked; },
  };
  readonly setTile = vi.fn();
  readonly worlds: World[];
  world: World;
  current: Room;
  pegs = false;
  visited: string[] = [];
  readonly start: WarpTarget = { world: 'ow', room: 'home', x: 10, y: 20 };
  readonly save: { flags: Record<string, boolean>; respawn: WarpTarget };

  constructor(rooms: Room[], kind: World['kind'] = 'overworld', others: World[] = []) {
    this.world = { id: 'w1', name: 'Moss Keep', kind, music: 'dungeon', rooms };
    this.worlds = [this.world, ...others];
    this.current = rooms[0]!;
    this.save = { flags: this.flags, respawn: { world: 'w1', room: rooms[0]!.id, x: 8, y: 8 } };
  }

  get services(): GameServices {
    const rig = this;
    const s = {
      project: { worlds: this.worlds, start: this.start, dialogues: [], tiles: [] },
      get room() {
        return { def: rig.current, world: rig.world, cols: 16, rows: 14, setTile: rig.setTile };
      },
      get dungeon() {
        return rig.world.kind === 'dungeon' ? { visited: rig.visited } : null;
      },
      save: this.save,
      player: this.player,
      entities: this.entities,
      audio: { sfx: (id: string) => this.log.push(`sfx:${id}`), music: (id: string) => this.log.push(`music:${id}`) },
      camera: { shake: (sec: number) => this.log.push(`shake:${sec}`) },
      findEntity: (id: string) => this.entities.find((e) => e.id === id && !e.dead),
      enemiesRemaining: () => this.entities.filter((e) => e.countsForClear && !e.dead).length,
      enemiesCleared: () => !this.entities.some((e) => e.countsForClear && !e.dead),
      flag: (n: string) => this.flags[n] === true,
      setFlag: (n: string, v = true) => {
        if (v) this.flags[n] = true;
        else delete this.flags[n];
      },
      hasItem: (item: string) => this.items.has(item),
      dialogue: (id: string) => {
        this.log.push(`dialogue:${id}`);
        return new Promise<number>((resolve, reject) => this.dialogues.push({ id, resolve, reject }));
      },
      giveItem: (item: string, amount: number, opts?: { fanfare?: boolean }) =>
        this.log.push(`give:${item}:${amount}:${opts?.fanfare ? 'fanfare' : 'quiet'}`),
      takeItem: (item: string, amount: number) => {
        this.log.push(`take:${item}:${amount}`);
        return true;
      },
      warp: (t: WarpTarget) => this.log.push(`warp:${t.world}/${t.room}`),
      showEntity: (id: string) => this.log.push(`show:${id}`),
      hideEntity: (id: string) => this.log.push(`hide:${id}`),
      pegState: () => this.pegs,
    };
    return s as unknown as GameServices;
  }

  add(e: FakeEntity): FakeEntity {
    this.entities.push(e);
    return e;
  }
}

/** A system that has entered the rig's room and run its first (zero-length) update. */
function system(rig: Rig): TriggerSystem {
  const ts = new TriggerSystem(rig.services);
  enter(ts, rig.current);
  return ts;
}

/** Room entry followed by the first gameplay update (where 'enter' triggers start). */
function enter(ts: TriggerSystem, r: Room): void {
  ts.enterRoom(r);
  ts.update(0);
}

function tick(ts: TriggerSystem, seconds = STEP): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) ts.update(STEP);
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sound = (n: string): Action => ({ kind: 'sound', sfx: n as never });
const sounds = (rig: Rig): string[] => rig.log.filter((l) => l.startsWith('sfx:'));
const setFlag = (flag: string, value = true): Action => ({ kind: 'setFlag', flag, value });
const flagIs = (flag: string, value: boolean): Condition => ({ kind: 'flag', flag, value });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('auto triggers', () => {
  it('fire on the rising edge of all conditions only', () => {
    const t = trigger('t', 'auto', [flagIs('x', true)], [sound('secret')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    rig.flags['x'] = true;
    tick(ts, 0.1);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    delete rig.flags['x'];
    tick(ts);
    rig.flags['x'] = true;
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:secret']);
  });

  it('a once trigger fires a single time per save and records trigger:<id>', () => {
    const t = trigger('t', 'auto', [], [sound('secret')], { once: true });
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts);
    expect(rig.flags['trigger:t']).toBe(true);
    enter(ts, rig.current);
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
  });

  it('re-arms on room entry (conditions that already hold fire on arrival)', () => {
    const t = trigger('t', 'auto', [], [sound('door')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts, 0.1);
    ts.enterRoom(rig.current);
    tick(ts, 0.1);
    expect(sounds(rig)).toEqual(['sfx:door', 'sfx:door']);
  });
});

describe('once flags', () => {
  it('are recorded the moment the trigger fires', () => {
    const t = trigger('t', 'auto', [], [{ kind: 'wait', seconds: 1 }, { kind: 'showEntity', target: 'key' }], { once: true });
    const rig = new Rig([room('r', [t], [inst('key', 'obj.chest', 40, 40)])]);
    const ts = system(rig);
    expect(rig.flags['trigger:t']).toBe(true);
    tick(ts, 0.5);
    expect(rig.log).toEqual([]);
    tick(ts, 0.6);
    expect(rig.log).toEqual(['show:key']);
  });

  it('a save made mid-sequence never replays the rewards', () => {
    const t = trigger('t', 'enter', [], [{ kind: 'giveItem', item: 'rupees', amount: 50 }, { kind: 'wait', seconds: 3 }], { once: true });
    const rig = new Rig([room('r', [t])]);
    tick(system(rig), 0.5);
    // Save & Quit mid-wait: a new session starts with the saved flags.
    tick(system(rig), 0.5);
    expect(rig.log).toEqual(['give:rupees:50:quiet']);
  });
});

describe('flush', () => {
  it('the hero dying mid-sequence applies its lasting effects at once and drops the rest', () => {
    const t = trigger('t', 'enter', [], [
      { kind: 'closeDoor', target: 'd1' }, { kind: 'wait', seconds: 2 }, sound('door'), { kind: 'openDoor', target: 'd1' },
      { kind: 'dialogue', dialogue: 'The way is open.' }, setFlag('done'), { kind: 'giveItem', item: 'bow', amount: 1 },
      { kind: 'warp', target: { world: 'w1', room: 'r', x: 1, y: 1 } }, { kind: 'heal', amount: 4 },
    ]);
    const rig = new Rig([room('r', [t], [inst('d1', 'obj.door', 128, 8)])]);
    const setOpen = vi.fn();
    rig.add(fakeEntity('d1', 'obj.door', { setOpen }));
    const ts = system(rig);
    tick(ts, 0.5);
    rig.player.state = 'dead';
    tick(ts);
    expect(setOpen.mock.calls).toEqual([[false], [true]]);
    expect(rig.flags['done']).toBe(true);
    expect(rig.log).toEqual(['give:bow:1:quiet']);
    expect(ts.busy).toBe(false);
  });

  it('starts nothing while the hero is dying', () => {
    const t = trigger('t', 'auto', [flagIs('x', true)], [sound('secret')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    rig.player.state = 'dead';
    rig.flags['x'] = true;
    tick(ts, 0.2);
    expect(sounds(rig)).toEqual([]);
  });
});

describe('conditions', () => {
  it('enemiesCleared needs enemies to have been present this visit', () => {
    const t = trigger('t', 'auto', [{ kind: 'enemiesCleared' }], [sound('secret')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts, 0.2);
    expect(sounds(rig)).toEqual([]);
    const enemy = rig.add(fakeEntity('e1', 'enemy.soldier', { countsForClear: true }));
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    enemy.dead = true;
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
  });

  it('switch uses the latest event, else the switch entity state', () => {
    const t = trigger('t', 'auto', [{ kind: 'switch', target: 's1', on: true }], [sound('secret')]);
    const rig = new Rig([room('r', [t], [inst('s1', 'obj.switch', 40, 40)])]);
    const sw = rig.add(fakeEntity('s1', 'obj.switch', { on: false }));
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    ts.handle({ type: 'switch', id: 's1', on: true });
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    // A fresh visit starts from the entity's exposed state.
    sw.on = true;
    enter(ts, rig.current);
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:secret']);
  });

  it('switch on a crystal switch follows the peg state', () => {
    const t = trigger('t', 'auto', [{ kind: 'switch', target: 'c1', on: true }], [sound('secret')]);
    const rig = new Rig([room('r', [t], [inst('c1', 'obj.crystalSwitch', 40, 40)])]);
    rig.add(fakeEntity('c1', 'obj.crystalSwitch'));
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    rig.pegs = true;
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
  });

  it('a crystal switch condition stays true to the pegs when another crystal switch toggles them', () => {
    const t = trigger('t', 'auto', [{ kind: 'switch', target: 'c1', on: true }], [sound('secret')]);
    const rig = new Rig([room('r', [t], [inst('c1', 'obj.crystalSwitch', 40, 40), inst('c2', 'obj.crystalSwitch', 90, 40)])]);
    rig.add(fakeEntity('c1', 'obj.crystalSwitch'));
    rig.add(fakeEntity('c2', 'obj.crystalSwitch'));
    const ts = system(rig);
    const toggle = (id: string): void => {
      rig.pegs = !rig.pegs;
      ts.handle({ type: 'switch', id, on: rig.pegs });
      tick(ts);
    };
    toggle('c1');
    toggle('c2');
    toggle('c2');
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:secret']);
  });

  it('torchesLit needs every torch lit (and at least one torch)', () => {
    const t = trigger('t', 'auto', [{ kind: 'torchesLit' }], [sound('secret')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    const a = rig.add(fakeEntity('a', 'obj.torch', { lit: true }));
    const b = rig.add(fakeEntity('b', 'obj.torch', { lit: false }));
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    b.lit = true;
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    a.lit = false;
    tick(ts);
    a.lit = true;
    tick(ts);
    expect(sounds(rig)).toHaveLength(2);
  });

  it('inRegion tests the hero centre against the region footprint', () => {
    const t = trigger('t', 'auto', [{ kind: 'inRegion', target: 'reg' }], [sound('secret')]);
    const rig = new Rig([room('r', [t], [inst('reg', 'marker.region', 64, 64, { w: 2, h: 2 })])]);
    rig.player.x = 100;
    rig.player.y = 100;
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    rig.player.x = 70;
    rig.player.y = 50;
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
  });

  it('defeated counts deaths this visit and persistDefeat flags', () => {
    const t1 = trigger('t1', 'auto', [{ kind: 'defeated', target: 'e1' }], [sound('secret')]);
    const t2 = trigger('t2', 'auto', [{ kind: 'defeated', target: 'boss' }], [sound('door')]);
    const rig = new Rig([room('r', [t1, t2], [inst('e1', 'enemy.soldier', 40, 40), inst('boss', 'boss.worm', 80, 80)])]);
    rig.flags['defeated:boss'] = true;
    const ts = system(rig);
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:door']);
    ts.handle({ type: 'defeated', id: 'e1', entityType: 'enemy.soldier' });
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:door', 'sfx:secret']);
  });

  it('blockPushed and hasItem', () => {
    const t = trigger('t', 'auto', [{ kind: 'blockPushed', target: 'b1' }, { kind: 'hasItem', item: 'bow', min: 1 }], [sound('secret')]);
    const rig = new Rig([room('r', [t], [inst('b1', 'obj.block', 40, 40)])]);
    const ts = system(rig);
    ts.handle({ type: 'blockPushed', id: 'b1' });
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    rig.items.add('bow');
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret']);
  });

  it('a condition naming a missing entity is false (even "switch off") and warns once', () => {
    const t = trigger('t', 'auto', [{ kind: 'switch', target: 'nope', on: false }], [sound('secret')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    tick(ts, 0.5);
    expect(sounds(rig)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('enter and talk triggers', () => {
  it("'enter' triggers start on the first update after entry (after the scroll or fade)", () => {
    const t = trigger('t', 'enter', [], [sound('door')]);
    const rig = new Rig([room('r', [t])]);
    const ts = new TriggerSystem(rig.services);
    ts.enterRoom(rig.current);
    expect(sounds(rig)).toEqual([]);
    ts.update(STEP);
    expect(sounds(rig)).toEqual(['sfx:door']);
    tick(ts, 0.2);
    expect(sounds(rig)).toEqual(['sfx:door']);
  });

  it("'enter' fires from enterRoom only (the roomEnter event is ignored)", () => {
    const t = trigger('t', 'enter', [], [sound('door')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    ts.handle({ type: 'roomEnter', room: 'r' });
    tick(ts, 0.2);
    expect(sounds(rig)).toEqual(['sfx:door']);
  });

  it("'talk' fires when its source is talked to and conditions hold", () => {
    const t = trigger('t', 'talk', [flagIs('ok', true)], [sound('item')], { source: 'npc1' });
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    const talk: GameEvent = { type: 'talk', id: 'npc1' };
    ts.handle(talk);
    expect(sounds(rig)).toEqual([]);
    rig.flags['ok'] = true;
    ts.handle({ type: 'talk', id: 'other' });
    ts.handle(talk);
    expect(sounds(rig)).toEqual(['sfx:item']);
  });

  it('a first-talk trigger does not also fire its "later" sibling on the same talk', () => {
    const first = trigger('first', 'talk', [flagIs('met', false)], [setFlag('met'), { kind: 'giveItem', item: 'rupees', amount: 5 }], { source: 'npc' });
    const later = trigger('later', 'talk', [flagIs('met', true)], [{ kind: 'dialogue', dialogue: 'Back again?' }], { source: 'npc' });
    const rig = new Rig([room('r', [first, later])]);
    const ts = system(rig);
    ts.handle({ type: 'talk', id: 'npc' });
    expect(rig.log).toEqual(['give:rupees:5:quiet']);
    ts.handle({ type: 'talk', id: 'npc' });
    expect(rig.log).toEqual(['give:rupees:5:quiet', 'dialogue:Back again?']);
  });

  it("'enter' triggers are chosen before any of them runs", () => {
    const first = trigger('first', 'enter', [flagIs('seen', false)], [setFlag('seen'), sound('secret')]);
    const later = trigger('later', 'enter', [flagIs('seen', true)], [sound('door')]);
    const rig = new Rig([room('r', [first, later])]);
    const ts = system(rig);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    enter(ts, rig.current);
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:door']);
  });
});

describe('action sequences', () => {
  it('run in order; dialogue and wait block', async () => {
    const t = trigger('t', 'enter', [], [
      sound('secret'), { kind: 'dialogue', dialogue: 'hello' }, sound('door'), { kind: 'wait', seconds: 0.5 }, sound('item'),
    ]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    expect(rig.log).toEqual(['sfx:secret', 'dialogue:hello']);
    expect(ts.busy).toBe(true);
    tick(ts, 1);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    rig.dialogues[0]!.resolve(-1);
    await flush();
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:door']);
    tick(ts, 0.4);
    expect(sounds(rig)).toHaveLength(2);
    tick(ts, 0.15);
    expect(sounds(rig)).toEqual(['sfx:secret', 'sfx:door', 'sfx:item']);
    expect(ts.busy).toBe(false);
  });

  it('a dialogue that fails to show still lets the sequence carry on', async () => {
    const t = trigger('t', 'talk', [], [{ kind: 'dialogue', dialogue: 'ask' }, sound('item')], { source: 'n' });
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    ts.handle({ type: 'talk', id: 'n' });
    tick(ts);
    expect(sounds(rig)).toEqual([]);
    rig.dialogues[0]!.reject(new Error('no box'));
    await flush();
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:item']);
    expect(ts.busy).toBe(false);
  });

  it('a fanfare giveItem yields a tick; quiet items do not', () => {
    const t = trigger('t', 'enter', [], [
      { kind: 'giveItem', item: 'rupees', amount: 20 }, { kind: 'giveItem', item: 'bow', amount: 1 }, sound('door'),
    ]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    expect(rig.log).toEqual(['give:rupees:20:quiet', 'give:bow:1:fanfare']);
    tick(ts);
    expect(rig.log.at(-1)).toBe('sfx:door');
  });

  it('the rest of the actions reach the right services', () => {
    const t = trigger('t', 'enter', [], [
      setFlag('f'), { kind: 'takeItem', item: 'rupees', amount: 5 },
      { kind: 'setTile', layer: 'fg', tx: 3, ty: 4, tile: 77 }, { kind: 'music', music: 'boss' }, { kind: 'secret' },
      { kind: 'heal', amount: 4 }, { kind: 'shake', seconds: 0.5 }, { kind: 'showEntity', target: 'c' },
      { kind: 'hideEntity', target: 'c' },
    ]);
    const rig = new Rig([room('r', [t], [inst('c', 'obj.chest', 40, 40)])]);
    system(rig);
    expect(rig.flags['f']).toBe(true);
    expect(rig.setTile).toHaveBeenCalledWith('fg', 3, 4, 77, true);
    expect(rig.log).toEqual(['take:rupees:5', 'music:boss', 'sfx:secret', 'heal:4', 'shake:0.5', 'show:c', 'hide:c']);
  });

  it('setTile after the hero left changes the room the sequence started in', () => {
    const t = trigger('t', 'auto', [], [{ kind: 'wait', seconds: 0.5 }, { kind: 'setTile', layer: 'bg', tx: 2, ty: 3, tile: 9 }]);
    const r2 = room('r2', []);
    const rig = new Rig([room('r1', [t]), r2]);
    rig.flags[tileFlagName('r1', 'bg', 2, 3, 5)] = true;
    const ts = system(rig);
    tick(ts);
    rig.current = r2;
    enter(ts, r2);
    tick(ts, 0.6);
    expect(rig.setTile).not.toHaveBeenCalled();
    expect(Object.keys(rig.flags).filter((k) => k.startsWith('tile:'))).toEqual([tileFlagName('r1', 'bg', 2, 3, 9)]);
  });

  it('openDoor uses setOpen, falls back to the door flag elsewhere, and survives missing targets', () => {
    const other = room('r2', [], [inst('far', 'obj.door', 128, 8, { link: 'L1' })]);
    const t = trigger('t', 'enter', [], [
      { kind: 'openDoor', target: 'd1' }, { kind: 'openDoor', target: 'ghost' }, { kind: 'openDoor', target: 'far' },
      { kind: 'setTile', layer: 'bg', tx: 99, ty: 0, tile: 1 }, sound('secret'),
    ]);
    const rig = new Rig([room('r', [t], [inst('d1', 'obj.door', 128, 8)]), other]);
    const setOpen = vi.fn();
    rig.add(fakeEntity('d1', 'obj.door', { setOpen }));
    system(rig);
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(rig.flags['door:L1']).toBe(true);
    expect(sounds(rig)).toEqual(['sfx:secret']);
    expect(rig.setTile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a giveItem of an unknown item is skipped with one warning and the sequence carries on (also when flushed)', () => {
    const bogus = { kind: 'giveItem', item: 'bogus', amount: 1 } as unknown as Action;
    const t = trigger('t', 'enter', [], [setFlag('before'), bogus, setFlag('after'), sound('door')]);
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    expect(rig.flags['before']).toBe(true);
    expect(rig.flags['after']).toBe(true);
    expect(rig.log.filter((l) => l.startsWith('give:'))).toEqual([]);
    expect(sounds(rig)).toEqual(['sfx:door']);
    expect(ts.busy).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // The flush path (hero died mid-sequence) skips it the same way.
    const t2 = trigger('t2', 'talk', [], [{ kind: 'wait', seconds: 5 }, bogus, setFlag('flushed')], { source: 'n' });
    const rig2 = new Rig([room('r', [t2])]);
    const ts2 = system(rig2);
    ts2.handle({ type: 'talk', id: 'n' });
    rig2.player.state = 'dead';
    ts2.update(STEP);
    expect(rig2.flags['flushed']).toBe(true);
    expect(rig2.log.filter((l) => l.startsWith('give:'))).toEqual([]);
  });

  it('warp blocks until the next room is entered', () => {
    const t = trigger('t', 'enter', [], [{ kind: 'warp', target: { world: 'w1', room: 'r2', x: 1, y: 1 } }, sound('door')], { once: true });
    const r2 = room('r2', []);
    const rig = new Rig([room('r', [t]), r2]);
    const ts = system(rig);
    expect(rig.log).toEqual(['warp:w1/r2']);
    expect(rig.flags['trigger:t']).toBe(true);
    tick(ts, 0.5);
    expect(sounds(rig)).toEqual([]);
    rig.current = r2;
    ts.enterRoom(r2);
    tick(ts);
    expect(sounds(rig)).toEqual(['sfx:door']);
  });

  it('a trigger does not restart while its sequence still runs', () => {
    const t = trigger('t', 'talk', [], [{ kind: 'wait', seconds: 1 }, sound('door')], { source: 'n' });
    const rig = new Rig([room('r', [t])]);
    const ts = system(rig);
    ts.handle({ type: 'talk', id: 'n' });
    ts.handle({ type: 'talk', id: 'n' });
    tick(ts, 1.1);
    expect(sounds(rig)).toEqual(['sfx:door']);
  });
});

describe('dungeon completion', () => {
  const overworld: World = { id: 'ow', name: 'Field', kind: 'overworld', music: 'overworld', rooms: [] };
  const cave: World = { id: 'cave', name: 'Cave', kind: 'interior', music: 'house', rooms: [] };
  const other: World = { id: 'dg2', name: 'Other', kind: 'dungeon', music: 'dungeon', rooms: [] };
  const outside: WarpTarget = { world: 'ow', room: 'field', x: 56, y: 170, dir: 'down' };
  const warpTo = (id: string, target: WarpTarget): EntityInstance => inst(id, 'marker.warp', 0, 0, { target: { ...target } });

  it('holds the hero, plays the jingle once gameplay resumes (after the item-get message), then warps out', () => {
    const entry = room('entry', [], [warpTo('inner', { world: 'w1', room: 'boss', x: 1, y: 1 }), warpTo('out', outside)]);
    const boss = room('boss', []);
    const rig = new Rig([boss, entry], 'dungeon', [overworld]);
    rig.visited = ['entry', 'boss'];
    const ts = system(rig);
    ts.handle({ type: 'itemGet', item: 'crystal' });
    // No second message and nothing under the item fanfare: the flow waits for the next gameplay tick.
    expect(rig.log).toEqual([]);
    expect(rig.dialogues).toEqual([]);
    expect(rig.player.locked).toBe(true);
    expect(ts.busy).toBe(true);
    tick(ts, CRYSTAL_JINGLE_DELAY + STEP);
    expect(rig.log).toEqual(['music:victory']);
    tick(ts, CRYSTAL_EXIT_DELAY - 0.2);
    expect(rig.log).toEqual(['music:victory']);
    tick(ts, 0.3);
    expect(rig.log).toEqual(['music:victory', 'warp:ow/field']);
    expect(rig.player.locked).toBe(true);
    ts.enterRoom(rig.current);
    ts.update(STEP);
    expect(ts.busy).toBe(false);
    expect(rig.player.locked).toBe(false);
  });

  it('moves a respawn point inside the dungeon out', () => {
    const rig = new Rig([room('boss', [], [warpTo('out', outside)])], 'dungeon', [overworld]);
    rig.player.state = 'itemGet';
    const ts = system(rig);
    ts.handle({ type: 'itemGet', item: 'crystal' });
    expect(rig.save.respawn).toEqual(outside);
  });

  it('lets go of the hero when the hero dies mid-flow', () => {
    const rig = new Rig([room('boss', [], [warpTo('out', outside)])], 'dungeon', [overworld]);
    const ts = system(rig);
    ts.handle({ type: 'itemGet', item: 'crystal' });
    expect(rig.player.locked).toBe(true);
    rig.player.state = 'dead';
    ts.update(STEP);
    expect(rig.player.locked).toBe(false);
    expect(rig.log.filter((l) => l.startsWith('warp:'))).toEqual([]);
  });

  it('keeps a respawn point outside the dungeon', () => {
    const rig = new Rig([room('boss', [], [warpTo('out', outside)])], 'dungeon', [overworld]);
    const home: WarpTarget = { world: 'ow', room: 'home', x: 40, y: 40 };
    rig.save.respawn = home;
    system(rig).handle({ type: 'itemGet', item: 'crystal' });
    expect(rig.save.respawn).toBe(home);
  });

  it('is skipped when a trigger of the room tests or gives the crystal', () => {
    const tests = trigger('t', 'auto', [{ kind: 'hasItem', item: 'crystal', min: 1 }], [sound('secret')]);
    const gives = trigger('g', 'talk', [], [{ kind: 'giveItem', item: 'crystal', amount: 1 }, sound('door')], { source: 'n' });
    for (const t of [tests, gives]) {
      const rig = new Rig([room('boss', [t])], 'dungeon');
      const ts = system(rig);
      ts.handle({ type: 'itemGet', item: 'crystal' });
      expect(rig.log).toEqual([]);
    }
  });

  it('is skipped while a running sequence gives the crystal', () => {
    const gives = trigger('g', 'enter', [], [{ kind: 'giveItem', item: 'crystal', amount: 1 }]);
    const rig = new Rig([room('hall', [gives]), room('boss', [])], 'dungeon');
    const ts = system(rig);
    rig.current = rig.world.rooms[1]!;
    ts.enterRoom(rig.current);
    ts.handle({ type: 'itemGet', item: 'crystal' });
    expect(rig.log.filter((l) => l.startsWith('music:'))).toEqual([]);
  });

  it('is skipped outside dungeons', () => {
    const rig = new Rig([room('r', [])]);
    const ts = system(rig);
    ts.handle({ type: 'itemGet', item: 'crystal' });
    expect(rig.log).toEqual([]);
  });

  it('dungeonExit prefers the entry room, overworld targets, and falls back to the project start', () => {
    const worlds = [overworld, cave, other];
    const a = room('a', [], [warpTo('wa', { world: 'ow', room: 'A', x: 0, y: 0 })]);
    const b = room('b', [], [warpTo('wb', { world: 'ow', room: 'B', x: 0, y: 0 })]);
    const world: World = { id: 'dg', name: 'D', kind: 'dungeon', music: 'dungeon', rooms: [a, b] };
    const start: WarpTarget = { world: 'ow', room: 'S', x: 0, y: 0 };
    expect(dungeonExit(world, 'b', start, worlds).room).toBe('B');
    expect(dungeonExit(world, undefined, start, worlds).room).toBe('A');
    expect(dungeonExit({ ...world, rooms: [room('c', [])] }, 'c', start, worlds)).toEqual(start);
    const mixed = room('m', [], [
      warpTo('toDungeon', { world: 'dg2', room: 'X', x: 0, y: 0 }),
      warpTo('toCave', { world: 'cave', room: 'C', x: 0, y: 0 }),
      warpTo('broken', { world: 'nowhere', room: 'N', x: 0, y: 0 }),
    ]);
    expect(dungeonExit({ ...world, rooms: [mixed, a] }, 'm', start, worlds).room).toBe('A');
    expect(dungeonExit({ ...world, rooms: [mixed] }, 'm', start, worlds).room).toBe('C');
  });
});
