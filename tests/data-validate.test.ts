// Data layer: project validation and migration.
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, Room, Trigger } from '../src/core/types';
import { cloneProject, createBlankProject, createRoom, createWorld, parseProject, serializeProject } from '../src/core/project';
import { migrateProject, validateProject, type Problem } from '../src/core/validate';
import { paintTerrain } from '../src/core/autotile';
import { defaultProps } from '../src/core/catalog';
import { T } from '../src/content/ids';
import { createSampleProject } from '../src/content/sample/sampleProject';

const BASE = createBlankProject('Validate');

function fresh(): { p: Project; room: Room } {
  const p = cloneProject(BASE);
  return { p, room: p.worlds[0]!.rooms[0]! };
}

function ent(id: string, type: string, props: EntityInstance['props'] = {}, x = 40, y = 40): EntityInstance {
  return { id, type, x, y, props: { ...defaultProps(type), ...props } };
}

function trig(id: string, extra: Partial<Trigger> = {}): Trigger {
  return { id, name: id, on: 'auto', conditions: [], actions: [{ kind: 'secret' }], once: false, ...extra };
}

function find(p: Project, level: Problem['level'], pattern: RegExp): Problem | undefined {
  return validateProject(p).find((x) => x.level === level && pattern.test(x.message));
}

function expectOnly(p: Project, level: Problem['level'], pattern: RegExp): void {
  const all = validateProject(p);
  expect(all.filter((x) => pattern.test(x.message)).map((x) => x.level), JSON.stringify(all, null, 1)).toEqual([level]);
}

describe('validateProject: duplicates', () => {
  it('flags duplicate ids of every kind', () => {
    const { p, room } = fresh();
    const world = p.worlds[0]!;
    p.worlds.push({ ...createWorld({ name: 'Copy', kind: 'interior' }), id: world.id });
    p.tiles.push({ ...p.tiles[0]! });
    p.sprites.push({ ...p.sprites[0]! });
    p.palettes.push({ ...p.palettes[0]! });
    p.dialogues.push({ id: 'd', name: 'a', pages: [{ text: '' }] }, { id: 'd', name: 'b', pages: [{ text: '' }] });
    const other = createRoom({ id: room.id, name: 'Other', gx: 5, gy: 5 });
    other.entities.push(ent('e1', 'obj.pot'));
    other.triggers.push(trig('t1'));
    world.rooms.push(other);
    room.entities.push(ent('e1', 'obj.pot'));
    room.triggers.push(trig('t1'));
    const msgs = validateProject(p).filter((x) => x.level === 'error').map((x) => x.message).join('\n');
    for (const what of ['world id', 'room id', 'entity id', 'trigger id', 'tile id', 'sprite id', 'palette id', 'dialogue id']) {
      expect(msgs).toContain(`Duplicate ${what}`);
    }
  });
});

describe('validateProject: assets', () => {
  it('checks tile frames, palettes and behaviours', () => {
    const { p } = fresh();
    const grass = p.tiles.find((t) => t.id === T.GRASS)!;
    grass.frames = ['0'.repeat(255)];
    expectOnly(p, 'error', /Tile "Grass".*frame 0 must be 256 hex digits/);
    grass.frames = ['G'.repeat(256)];
    expect(find(p, 'error', /frame 0 must be 256/)).toBeDefined();
    grass.frames = [];
    expect(find(p, 'error', /Tile "Grass".*has no frames/)).toBeDefined();
    const bush = p.tiles.find((t) => t.id === T.BUSH)!;
    bush.palette = 'pal.nope';
    bush.cut = { to: 4242 };
    expect(find(p, 'error', /Bush.*missing palette "pal.nope"/)).toBeDefined();
    expect(find(p, 'error', /Bush.*cut behaviour turns into a missing tile 4242/)).toBeDefined();
  });

  it('checks sprite frame sizes and animation frame indices', () => {
    const { p } = fresh();
    const hero = p.sprites.find((s) => s.id === 'hero')!;
    hero.frames[0] = hero.frames[0]!.slice(1);
    expectOnly(p, 'error', /Sprite "Hero" frame 0 must be 384 hex digits/);
    const { p: p2 } = fresh();
    const hero2 = p2.sprites.find((s) => s.id === 'hero')!;
    hero2.anims.idle_down!.frames = [hero2.frames.length];
    expectOnly(p2, 'error', /animation "idle_down" uses frame \d+, which does not exist/);
    hero2.palette = 'pal.gone';
    expect(find(p2, 'error', /Hero.*missing palette/)).toBeDefined();
  });

  it('checks palettes and terrains', () => {
    const { p } = fresh();
    p.palettes[0]!.colors.pop();
    p.palettes[1]!.colors[3] = 'red';
    p.terrains[0]!.ne = 9999;
    expect(find(p, 'error', /has 15 colours/)).toBeDefined();
    expect(find(p, 'error', /invalid colour "red"/)).toBeDefined();
    expect(find(p, 'error', /Terrain "Water" references missing tiles for: ne/)).toBeDefined();
  });
});

describe('validateProject: rooms', () => {
  it('checks layer lengths and unknown tile ids', () => {
    const { p, room } = fresh();
    room.layers.fg.pop();
    room.layers.bg[5] = 777;
    room.layers.over[9] = 778;
    expect(find(p, 'error', /fg layer has 223 cells \(needs 224\)/)).toBeDefined();
    expect(find(p, 'error', /bg layer uses unknown tile ids: 777/)).toBeDefined();
    expect(find(p, 'error', /over layer uses unknown tile ids: 778/)).toBeDefined();
  });

  it('checks room sizes', () => {
    const { p, room } = fresh();
    room.gw = 5;
    expect(find(p, 'error', /width must be 1-4 screens \(is 5\)/)).toBeDefined();
    room.gw = 1;
    room.gh = 0;
    expect(find(p, 'error', /height must be 1-4 screens \(is 0\)/)).toBeDefined();
  });

  it('flags overlapping rooms on the same floor only', () => {
    const { p } = fresh();
    const world = p.worlds[0]!;
    world.rooms.push(createRoom({ name: 'Big', gx: -1, gy: -1, gw: 2, gh: 2, fill: T.GRASS }));
    expectOnly(p, 'error', /Rooms "Start" and "Big" overlap on floor 0/);
    world.rooms[1]!.floor = 1;
    expect(find(p, 'error', /overlap/)).toBeUndefined();
    world.rooms.push(createRoom({ name: 'Side', gx: 1, gy: 0, fill: T.GRASS }));
    expect(find(p, 'error', /overlap/)).toBeUndefined();
  });

  it('checks room music and pit targets', () => {
    const { p, room } = fresh();
    room.music = 'disco' as never;
    room.pitTarget = { world: p.worlds[0]!.id, room: 'nowhere', x: 8, y: 8 };
    expect(find(p, 'error', /unknown music "disco"/)).toBeDefined();
    expect(find(p, 'error', /pit destination points to a missing room "nowhere"/)).toBeDefined();
  });

  it('reports a project with no rooms', () => {
    const { p } = fresh();
    p.worlds[0]!.rooms = [];
    expect(find(p, 'error', /no rooms/)).toBeDefined();
  });
});

describe('validateProject: entities', () => {
  it('flags unknown entity types', () => {
    const { p, room } = fresh();
    room.entities.push({ id: 'x', type: 'enemy.dragon', x: 8, y: 8, props: {} });
    expectOnly(p, 'error', /unknown type "enemy.dragon"/);
  });

  it('checks prop references and options', () => {
    const { p, room } = fresh();
    const world = p.worlds[0]!;
    const other = createRoom({ name: 'Other', gx: 1, gy: 0, fill: T.GRASS });
    other.entities.push(ent('far', 'obj.pot'));
    world.rooms.push(other);
    room.entities.push(
      ent('npc', 'npc.person', { dialogue: 'd_missing', sprite: 'npc.wizard' }),
      ent('chest', 'obj.chest', { item: 'triforce', amount: 'lots' }),
      ent('sign', 'obj.sign', { dialogue: '' }),
    );
    expect(find(p, 'error', /Person "npc".*missing dialogue "d_missing"/)).toBeDefined();
    expect(find(p, 'error', /Person "npc".*invalid option "npc.wizard"/)).toBeDefined();
    expect(find(p, 'error', /Chest "chest".*unknown item "triforce"/)).toBeDefined();
    expect(find(p, 'error', /Chest "chest".*should be a number/)).toBeDefined();
    expect(validateProject(p).filter((x) => x.where?.entity === 'sign')).toEqual([]);
  });

  it('warns about out-of-range numbers and entities outside the room', () => {
    const { p, room } = fresh();
    room.entities.push(ent('eye', 'enemy.eye', { cooldown: 99 }), ent('lost', 'obj.pot', {}, 999, 20));
    expect(find(p, 'warning', /Eye Statue "eye".*99, outside 0.5..10/)).toBeDefined();
    expect(find(p, 'warning', /Pot "lost".*outside the room/)).toBeDefined();
  });

  it('treats the far room edge as outside (x == width, y == height)', () => {
    const { p, room } = fresh();
    room.entities.push(ent('edge', 'obj.pot', {}, 256, 224), ent('in', 'obj.pot', {}, 255.5, 223.5), ent('x', 'obj.pot', {}, 256, 100));
    expect(find(p, 'warning', /Pot "edge".*outside the room \(256, 224\)/)).toBeDefined();
    expect(find(p, 'warning', /Pot "x".*outside the room/)).toBeDefined();
    expect(validateProject(p).filter((x) => x.where?.entity === 'in')).toEqual([]);
    room.entities.length = 0;
    room.entities.push(ent('w1', 'marker.warp', { target: { world: p.worlds[0]!.id, room: room.id, x: 128, y: 224 } }));
    expectOnly(p, 'warning', /lands outside room "Start" \(128, 224\)/);
  });

  it('warns about item amounts that act as key counts or levels', () => {
    const { p, room } = fresh();
    room.entities.push(
      ent('keys', 'obj.chest', { item: 'smallKey', amount: 20 }),
      ent('sword', 'obj.chest', { item: 'sword', amount: 20 }),
      ent('sword2', 'obj.chest', { item: 'sword', amount: 2 }),
      ent('bow', 'obj.chest', { item: 'bow' }),
      ent('rupees', 'obj.chest', { item: 'rupees' }),
      ent('key1', 'obj.pickup', { item: 'smallKey' }),
      ent('shop', 'obj.shopItem', { item: 'glove', amount: 3 }),
    );
    room.triggers.push(trig('gift', {
      actions: [{ kind: 'giveItem', item: 'smallKey', amount: 3 }, { kind: 'giveItem', item: 'boomerang', amount: 9 }],
    }));
    expectOnly(p, 'warning', /Chest "keys".*gives 20 Small Keys/);
    expectOnly(p, 'warning', /Chest "sword".*gives the level-2 Sword straight away/);
    expectOnly(p, 'warning', /Shop Item "shop".*level-2 Stone Gauntlet/);
    expectOnly(p, 'warning', /"gift" .*giveItem\) gives 3 Small Keys/);
    expectOnly(p, 'warning', /"gift" .*giveItem\) gives the level-2 Boomerang/);
    for (const id of ['sword2', 'bow', 'rupees', 'key1']) {
      expect(validateProject(p).filter((x) => x.where?.entity === id), id).toEqual([]);
    }
  });

  it('checks warp markers', () => {
    const { p, room } = fresh();
    room.entities.push(ent('w1', 'marker.warp'));
    expectOnly(p, 'warning', /Warp "w1".*has no destination/);
    room.entities[0]!.props.target = { world: p.worlds[0]!.id, room: 'r_gone', x: 8, y: 8 };
    expectOnly(p, 'error', /Warp "w1".*missing room "r_gone"/);
    room.entities[0]!.props.target = { world: 'w_gone', room: room.id, x: 8, y: 8 };
    expectOnly(p, 'error', /missing world "w_gone"/);
    room.entities[0]!.props.target = { world: p.worlds[0]!.id, room: room.id, x: 5000, y: 8 };
    expectOnly(p, 'warning', /lands outside room "Start"/);
    room.entities[0]!.props.target = { world: p.worlds[0]!.id, room: room.id, x: 40, y: 40, dir: 'up' };
    expect(validateProject(p)).toEqual([]);
  });

  it('warns when a warp, trigger warp or pit destination lands on ground the hero cannot stand on', () => {
    const { p, room } = fresh();
    const w = p.worlds[0]!.id;
    const cell = 2 * 16 + 2; // the tile under (40, 40)
    room.entities.push(ent('w1', 'marker.warp', { target: { world: w, room: room.id, x: 40, y: 40 } }));
    room.layers.fg[cell] = T.TREE_SMALL!;
    expectOnly(p, 'warning', /Warp "w1".*lands on a solid tile in room "Start" \(40, 40\)/);
    room.layers.fg[cell] = 0;
    room.layers.bg[cell] = 0;
    expectOnly(p, 'warning', /Warp "w1".*lands on a void tile/);
    room.layers.bg[cell] = T.WATER!;
    expectOnly(p, 'warning', /Warp "w1".*lands on a deep water tile/);
    room.entities.length = 0;
    room.pitTarget = { world: w, room: room.id, x: 40, y: 40 };
    expectOnly(p, 'warning', /pit destination lands on a deep water tile/);
    delete room.pitTarget;
    room.triggers.push(trig('go', { actions: [{ kind: 'warp', target: { world: w, room: room.id, x: 40, y: 40 } }] }));
    expectOnly(p, 'warning', /\(warp\) lands on a deep water tile/);
    room.layers.bg[cell] = T.GRASS!;
    expect(validateProject(p).filter((x) => /lands on/.test(x.message))).toEqual([]);
  });
});

describe('validateProject: triggers', () => {
  it('checks sources, condition targets and action references', () => {
    const { p, room } = fresh();
    const world = p.worlds[0]!;
    const other = createRoom({ name: 'Other', gx: 1, gy: 0, fill: T.GRASS });
    other.entities.push(ent('far', 'obj.switch'));
    world.rooms.push(other);
    room.entities.push(ent('sw', 'obj.switch'), ent('pot', 'obj.pot'));
    room.triggers.push(
      trig('talk1', { on: 'talk' }),
      trig('talk2', { on: 'talk', source: 'ghost' }),
      trig('c1', { conditions: [{ kind: 'switch', target: 'nope', on: true }] }),
      trig('c2', { conditions: [{ kind: 'switch', target: 'far', on: true }] }),
      trig('c3', { conditions: [{ kind: 'switch', target: 'pot', on: true }] }),
      trig('c4', { conditions: [{ kind: 'hasItem', item: 'cape' as never, min: 1 }, { kind: 'flag', flag: '', value: true }] }),
      trig('a1', {
        actions: [
          { kind: 'dialogue', dialogue: 'd_none' },
          { kind: 'giveItem', item: 'potion' as never, amount: 1 },
          { kind: 'warp', target: { world: world.id, room: 'r_none', x: 8, y: 8 } },
          { kind: 'setTile', layer: 'fg', tx: 99, ty: 0, tile: 4321 },
          { kind: 'sound', sfx: 'boing' as never },
          { kind: 'showEntity', target: 'far' },
          { kind: 'openDoor', target: 'missingDoor' },
        ],
      }),
      trig('empty', { actions: [] }),
    );
    const errors = validateProject(p).filter((x) => x.level === 'error').map((x) => x.message);
    const warnings = validateProject(p).filter((x) => x.level === 'warning').map((x) => x.message);
    const has = (list: string[], re: RegExp): boolean => list.some((m) => re.test(m));
    expect(has(errors, /"talk1".*fires on talk but has no source/)).toBe(true);
    expect(has(errors, /"talk2".*source refers to a missing entity "ghost"/)).toBe(true);
    expect(has(errors, /"c1".*missing entity "nope"/)).toBe(true);
    expect(has(errors, /"c2".*entity "far" in another room/)).toBe(true);
    expect(has(warnings, /"c3".*expects a obj.switch but "pot" is a obj.pot/)).toBe(true);
    expect(has(errors, /"c4".*unknown item "cape"/)).toBe(true);
    expect(has(errors, /"c4".*empty flag name/)).toBe(true);
    expect(has(errors, /"a1".*missing dialogue "d_none"/)).toBe(true);
    expect(has(errors, /"a1".*unknown item "potion"/)).toBe(true);
    expect(has(errors, /"a1".*missing room "r_none"/)).toBe(true);
    expect(has(errors, /"a1".*missing tile 4321/)).toBe(true);
    expect(has(errors, /"a1".*tile \(99, 0\) outside the room/)).toBe(true);
    expect(has(errors, /"a1".*unknown sound "boing"/)).toBe(true);
    expect(has(errors, /"a1".*missing entity "missingDoor"/)).toBe(true);
    expect(has(errors, /"a1".*"far"/)).toBe(false); // showEntity may target another room
    expect(has(warnings, /"empty".*has no actions/)).toBe(true);
  });

  it('hints when enemiesCleared / torchesLit can never hold', () => {
    const { p, room } = fresh();
    room.triggers.push(trig('t', { conditions: [{ kind: 'enemiesCleared' }, { kind: 'torchesLit' }] }));
    expect(find(p, 'warning', /enemies to be cleared, but the room has none/)).toBeDefined();
    expect(find(p, 'warning', /torches, but the room has none/)).toBeDefined();
    room.entities.push(ent('s', 'enemy.soldier'), ent('t1', 'obj.torch'));
    expect(validateProject(p)).toEqual([]);
  });
});

describe('validateProject: start & settings', () => {
  it('errors when the start world or room is missing', () => {
    const { p } = fresh();
    p.start.world = 'w_nope';
    expectOnly(p, 'error', /start location uses a missing world/);
    const { p: p2 } = fresh();
    p2.start.room = 'r_nope';
    expectOnly(p2, 'error', /start location uses a missing room/);
    const { p: p3 } = fresh();
    p3.start.x = -4;
    expectOnly(p3, 'error', /start location .* is outside room/);
  });

  it('warns when the start is inside a solid tile', () => {
    const { p, room } = fresh();
    room.layers.fg[7 * 16 + 8] = T.TREE_SMALL!;
    expectOnly(p, 'warning', /start location is on a solid tile/);
    room.layers.fg[7 * 16 + 8] = 0;
    room.layers.bg[7 * 16 + 8] = 0;
    expectOnly(p, 'warning', /start location is on a void tile/);
    room.layers.bg[7 * 16 + 8] = T.WATER!;
    expectOnly(p, 'warning', /start location is on a deep water tile/);
  });

  it('checks settings', () => {
    const { p } = fresh();
    p.settings.startHearts = 0;
    p.settings.introDialogue = 'd_intro';
    p.settings.startItems = { sword: 1, crystal: 1, laser: 1 } as never;
    expect(find(p, 'error', /Starting hearts/)).toBeDefined();
    expect(find(p, 'error', /Intro dialogue "d_intro" does not exist/)).toBeDefined();
    expect(find(p, 'error', /Unknown starting item "laser"/)).toBeDefined();
    expect(find(p, 'warning', /"Crystal" has no effect at game start/)).toBeDefined();
  });
});

describe('validateProject: dungeon keys', () => {
  function dungeon(): { p: Project; room: Room } {
    const { p } = fresh();
    const world = createWorld({ id: 'w_dun', name: 'Keep', kind: 'dungeon' });
    const room = createRoom({ id: 'r_dun', name: 'Hall', gx: 0, gy: 0, fill: T.DFLOOR });
    world.rooms.push(room);
    p.worlds.push(world);
    return { p, room };
  }

  it('warns when locked doors outnumber small keys', () => {
    const { p, room } = dungeon();
    room.entities.push(ent('d1', 'obj.door', { kind: 'locked', link: 'a' }), ent('d2', 'obj.door', { kind: 'locked', link: '' }));
    expectOnly(p, 'warning', /Dungeon "Keep" has 2 locked door\(s\) but only 0 small key\(s\)/);
    room.entities.push(ent('k1', 'obj.pickup', { item: 'smallKey', amount: 1 }), ent('k2', 'enemy.soldier', { drop: 'smallKey' }));
    expect(find(p, 'warning', /locked door/)).toBeUndefined();
  });

  it('counts linked door pairs once and keys from chests and triggers', () => {
    const { p, room } = dungeon();
    room.entities.push(
      ent('d1', 'obj.door', { kind: 'locked', link: 'x', dir: 'up' }, 128, 8),
      ent('d2', 'obj.door', { kind: 'locked', link: 'x', dir: 'down' }, 128, 216),
      ent('d3', 'obj.door', { kind: 'locked', link: 'y', dir: 'left' }, 8, 112),
      ent('c1', 'obj.chest', { item: 'smallKey', amount: 1 }),
    );
    expectOnly(p, 'warning', /2 locked door\(s\) but only 1 small key/);
    room.triggers.push(trig('gift', { actions: [{ kind: 'giveItem', item: 'smallKey', amount: 1 }] }));
    expect(find(p, 'warning', /locked door/)).toBeUndefined();
  });

  it('counts a multi-key gift as given in play, and flags it separately', () => {
    const { p, room } = dungeon();
    for (let i = 0; i < 5; i++) room.entities.push(ent(`d${i}`, 'obj.door', { kind: 'locked', link: `l${i}` }));
    room.entities.push(ent('c1', 'obj.chest', { item: 'smallKey', amount: 20 }));
    expect(find(p, 'warning', /locked door/)).toBeUndefined();
    expect(find(p, 'warning', /Chest "c1".*gives 20 Small Keys/)).toBeDefined();
    room.entities[5]!.props.amount = 1;
    expect(find(p, 'warning', /5 locked door\(s\) but only 1 small key/)).toBeDefined();
  });

  it('ignores overworlds', () => {
    const { p, room } = fresh();
    room.entities.push(ent('d1', 'obj.door', { kind: 'locked' }));
    expect(find(p, 'warning', /locked door/)).toBeUndefined();
  });
});

describe('migrateProject', () => {
  it('throws for values that are clearly not projects', () => {
    expect(() => migrateProject(null)).toThrow(/not a Questforge project/);
    expect(() => migrateProject('hi')).toThrow(/not a Questforge project/);
    expect(() => migrateProject([1, 2])).toThrow(/not a Questforge project/);
    expect(() => migrateProject({ format: 'other', worlds: [] })).toThrow(/format is "other"/);
    expect(() => migrateProject({ tiles: [] })).toThrow(/no "format" or "worlds"/);
  });

  it('fills defaults for a minimal partial project and validates cleanly', () => {
    const raw = {
      name: 'Tiny',
      worlds: [{
        id: 'w1', name: 'Land',
        rooms: [{ id: 'r1', name: 'Home', gx: 0, gy: 0, layers: { bg: new Array(224).fill(T.GRASS), fg: [1, 2, 3] } }],
      }],
    };
    const before = JSON.stringify(raw);
    const p = migrateProject(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(p.format).toBe('questforge');
    expect(p.version).toBe(1);
    expect(p.id).toMatch(/^p_/);
    expect(p.settings).toEqual({ title: 'Tiny', subtitle: '', startHearts: 3, startItems: { sword: 1, shield: 1 }, titleMusic: 'title' });
    expect(p.flags).toEqual([]);
    expect(p.dialogues).toEqual([]);
    expect(p.tiles.length).toBeGreaterThan(100);
    expect(p.terrains.map((t) => t.id)).toEqual(['water', 'path', 'pit', 'plateau']);
    const world = p.worlds[0]!;
    expect(world.kind).toBe('overworld');
    expect(world.music).toBe('overworld');
    const room = world.rooms[0]!;
    expect([room.gw, room.gh, room.floor, room.music]).toEqual([1, 1, 0, 'inherit']);
    expect(room.layers.fg).toHaveLength(224);
    expect(room.layers.fg.slice(0, 4)).toEqual([1, 2, 3, 0]);
    expect(room.layers.over).toHaveLength(224);
    expect(room.entities).toEqual([]);
    expect(room.triggers).toEqual([]);
    expect(p.start).toEqual({ world: 'w1', room: 'r1', x: 128, y: 112, dir: 'down' });
    expect(validateProject(p).filter((x) => x.level === 'error')).toEqual([]);
  });

  it('fills props, trigger fields, dialogue pages and flags', () => {
    const p = migrateProject({
      format: 'questforge',
      settings: { startHearts: 99, startItems: { bow: 1, bogus: 3 }, titleMusic: 'nope' },
      flags: ['a', { name: 'b', description: 'B' }, 7],
      dialogues: [{ id: 'd1', pages: [{ text: 'Hi', choice: { options: ['y', 'n'] } }, {}] }],
      worlds: [{
        kind: 'dungeon',
        rooms: [{
          gw: 2, gh: 1, dark: true,
          entities: [{ id: 'e1', type: 'obj.chest', x: 8, y: 8, props: { item: 'bow' } }, { type: 'obj.pot' }],
          triggers: [{ id: 't1', on: 'talk', source: 'e1', actions: [{ kind: 'secret' }] }, {}],
        }],
      }],
    });
    expect(p.settings.startHearts).toBe(20);
    expect(p.settings.startItems).toEqual({ bow: 1 });
    expect(p.settings.titleMusic).toBe('title');
    expect(p.flags).toEqual([{ name: 'a' }, { name: 'b', description: 'B' }]);
    expect(p.dialogues[0]).toEqual({ id: 'd1', name: 'd1', pages: [{ text: 'Hi', choice: { options: ['y', 'n'] } }, { text: '' }] });
    const world = p.worlds[0]!;
    expect(world.music).toBe('dungeon');
    const room = world.rooms[0]!;
    expect(room.dark).toBe(true);
    expect(room.layers.bg).toHaveLength(32 * 14);
    expect(room.entities[0]!.props).toEqual({ item: 'bow', amount: 1, big: false, hidden: false });
    expect(room.entities[1]!.id).toMatch(/^e_/);
    expect(room.entities[1]!.props).toEqual({ contents: 'random' });
    expect(room.triggers[0]).toEqual({ id: 't1', name: 't1', on: 'talk', source: 'e1', conditions: [], actions: [{ kind: 'secret' }], once: false });
    expect(room.triggers[1]!.on).toBe('auto');
    expect(p.start.room).toBe(room.id);
  });

  it('re-lays out layers when an oversized room is clamped', () => {
    const cols = 5 * 16;
    const bg = new Array(cols * 14).fill(1);
    bg[1 * cols + 2] = 9; // inside the kept area
    bg[0 * cols + 70] = 8; // in the dropped fifth screen
    const p = migrateProject({ format: 'questforge', worlds: [{ rooms: [{ gw: 5, gh: 1, layers: { bg } }] }] });
    const room = p.worlds[0]!.rooms[0]!;
    expect(room.gw).toBe(4);
    expect(room.layers.bg).toHaveLength(64 * 14);
    expect(room.layers.bg[1 * 64 + 2]).toBe(9);
    expect(room.layers.bg.includes(8)).toBe(false);
  });

  it('refuses files from a newer Questforge instead of silently dropping data', () => {
    expect(() => migrateProject({ format: 'questforge', version: 99, worlds: [] })).toThrow(/newer version of Questforge \(format v99\)/);
    expect(migrateProject({ format: 'questforge', version: 1, worlds: [] }).version).toBe(1);
  });

  it('parses numeric strings in layers and zeroes junk', () => {
    const bg: unknown[] = new Array(224).fill(String(T.GRASS));
    bg[0] = 'tree';
    bg[1] = -3;
    bg[2] = null;
    bg[3] = ' ';
    const p = migrateProject({ format: 'questforge', worlds: [{ rooms: [{ layers: { bg } }] }] });
    const layer = p.worlds[0]!.rooms[0]!.layers.bg;
    expect(layer.slice(0, 5)).toEqual([0, 0, 0, 0, T.GRASS]);
    expect(layer.filter((x) => x === T.GRASS)).toHaveLength(220);
  });

  it('normalises malformed sprites and terrains so validation and autotile never throw', () => {
    const raw = JSON.parse(serializeProject(BASE)) as Record<string, unknown> & { sprites: Record<string, unknown>[]; terrains: unknown[] };
    raw.sprites[0]!.anims = { walk: 5, idle: { fps: 'fast' }, run: { frames: [0, 'x', 1], loop: false, flipX: true }, bad: null };
    raw.sprites[1]!.w = 'wide';
    raw.terrains = [{ name: 'Broken' }, 7, { id: 'half', layer: 'sky', center: String(T.GRASS) }];
    const p = parseProject(JSON.stringify(raw));
    const sprite = p.sprites[0]!;
    expect(Object.keys(sprite.anims)).toEqual(['idle', 'run']);
    expect(sprite.anims.idle).toEqual({ frames: [], fps: 8, loop: true });
    expect(sprite.anims.run).toEqual({ frames: [0, 1], fps: 8, loop: false, flipX: true });
    expect(p.sprites[1]!.w).toBe(16);
    expect(p.terrains).toHaveLength(2);
    expect(p.terrains[1]).toMatchObject({ id: 'half', layer: 'bg', center: T.GRASS, ne: 0 });
    let problems: Problem[] = [];
    expect(() => { problems = validateProject(p); }).not.toThrow();
    expect(problems.some((x) => x.level === 'error' && /Terrain "Broken" references missing tiles/.test(x.message))).toBe(true);
    const room = p.worlds[0]!.rooms[0]!;
    expect(() => paintTerrain(room, p.terrains[1]!, [{ tx: 1, ty: 1 }])).not.toThrow();
  });

  it('reports malformed animations built in code instead of throwing', () => {
    const { p } = fresh();
    (p.sprites[0]!.anims as Record<string, unknown>).oops = { fps: 8 };
    expect(() => validateProject(p)).not.toThrow();
    expect(find(p, 'error', /animation "oops" is malformed/)).toBeDefined();
  });

  it('keeps an already-current project identical', () => {
    const p = cloneProject(BASE);
    expect(migrateProject(p)).toEqual(p);
  });

  it('keeps the sample adventure identical through the stricter trigger/prop/palette clean-up', () => {
    const sample = createSampleProject();
    expect(migrateProject(sample)).toEqual(sample);
    expect(parseProject(serializeProject(sample))).toEqual(sample);
  });
});

/** BASE as parsed JSON, changed by `mut`, then imported like a file. */
function imported(mut: (raw: Record<string, any>) => void): Project {
  const raw = JSON.parse(serializeProject(BASE)) as Record<string, any>;
  mut(raw);
  return parseProject(JSON.stringify(raw));
}

describe('migrateProject: partial files get their built-in assets back', () => {
  it('restores a removed built-in sprite, and an empty sprite list, and validation mentions a missing one', () => {
    const p = cloneProject(BASE);
    p.sprites = p.sprites.filter((s) => s.id !== 'hero');
    expect(find(p, 'warning', /Built-in sprite missing.*hero/)).toBeDefined();
    const q = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(q.sprites.filter((s) => s.id === 'hero')).toHaveLength(1);
    const empty = imported((raw) => { raw.sprites = []; });
    expect(empty.sprites.map((s) => s.id).sort()).toEqual(BASE.sprites.map((s) => s.id).sort());
    expect(find(empty, 'warning', /Built-in sprite/)).toBeUndefined();
  });

  it('restores missing built-in tiles (sorted by id) and referenced palettes, keeping user edits', () => {
    const q = imported((raw) => {
      raw.tiles = raw.tiles.filter((t: { id: number }) => t.id !== T.GRASS);
      raw.tiles.find((t: { id: number }) => t.id === T.BUSH).name = 'My bush';
      raw.palettes = raw.palettes.filter((x: { id: string }) => x.id !== raw.sprites.find((s: { id: string }) => s.id === 'hero').palette);
    });
    const grass = q.tiles.find((t) => t.id === T.GRASS);
    expect(grass?.name).toBe('Grass');
    expect(q.tiles.find((t) => t.id === T.BUSH)?.name).toBe('My bush');
    const ids = q.tiles.map((t) => t.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(q.palettes.some((x) => x.id === q.sprites.find((s) => s.id === 'hero')!.palette)).toBe(true);
    expect(validateProject(q).filter((x) => x.level === 'error')).toEqual([]);
    const bare = imported((raw) => { raw.tiles = []; raw.palettes = []; raw.sprites = []; });
    expect(bare.tiles).toHaveLength(BASE.tiles.length);
    expect(validateProject(bare).filter((x) => x.level === 'error')).toEqual([]);
  });

  it('does not bring back an unreferenced default palette the author deleted', () => {
    const q = imported((raw) => { raw.palettes.push({ id: 'pal.mine', name: 'Mine', colors: [] }); });
    const r = imported((raw) => { raw.palettes = raw.palettes.filter((x: { id: string }) => x.id !== 'pal.mine'); });
    expect(q.palettes.some((x) => x.id === 'pal.mine')).toBe(true);
    expect(r.palettes.some((x) => x.id === 'pal.mine')).toBe(false);
  });
});

describe('migrateProject: hostile or malformed files', () => {
  function withTrigger(t: Record<string, unknown>): Trigger {
    const p = imported((raw) => { raw.worlds[0].rooms[0].triggers.push({ id: 'tx', name: 'x', on: 'auto', ...t }); });
    return p.worlds[0]!.rooms[0]!.triggers.find((x) => x.id === 'tx')!;
  }

  it('drops setTile actions with a layer that is not bg/fg/over (no prototype pollution)', () => {
    const t = withTrigger({
      actions: [
        { kind: 'setTile', layer: '__proto__', tx: 0, ty: 0, tile: 'POLLUTED' },
        { kind: 'setTile', layer: 'constructor', tx: 1, ty: 0, tile: 5 },
        { kind: 'setTile', layer: 'fg', tx: '2', ty: 1.6, tile: 'x', junk: { a: 1 } },
      ],
    });
    expect(t.actions).toEqual([{ kind: 'setTile', layer: 'fg', tx: 0, ty: 2, tile: 0 }]);
    expect(({} as Record<number, unknown>)[0]).toBeUndefined();
  });

  it('type-checks every action kind and drops unknown or unusable ones', () => {
    const t = withTrigger({
      actions: [
        { kind: 'heal', amount: 'lots' }, { kind: 'heal', amount: -3 }, { kind: 'heal', amount: 4 },
        { kind: 'giveItem', item: 'bow', amount: 'x' }, { kind: 'giveItem', item: 'potion', amount: 1 },
        { kind: 'takeItem', item: 'rupees', amount: 5 },
        { kind: 'wait', seconds: 'soon' }, { kind: 'shake', seconds: -1 }, { kind: 'wait', seconds: 0.5 },
        { kind: 'sound', sfx: 'boing' }, { kind: 'sound', sfx: 'secret' },
        { kind: 'music', music: 'disco' }, { kind: 'music', music: 'none' },
        { kind: 'warp', target: { world: 'w', room: 'r', x: 'a', y: 1 } },
        { kind: 'warp', target: { world: 'w', room: 'r', x: 8, y: 9, dir: 'sideways', extra: 1 } },
        { kind: 'setFlag', flag: 7, value: 'yes' }, { kind: 'dialogue' }, { kind: 'openDoor', target: 3 },
        { kind: 'secret', x: 1 }, { kind: 'explode' }, { nokind: true },
      ],
    });
    expect(t.actions).toEqual([
      { kind: 'heal', amount: 2 }, { kind: 'heal', amount: 0 }, { kind: 'heal', amount: 4 },
      { kind: 'giveItem', item: 'bow', amount: 1 },
      { kind: 'takeItem', item: 'rupees', amount: 5 },
      { kind: 'wait', seconds: 0 }, { kind: 'shake', seconds: 0 }, { kind: 'wait', seconds: 0.5 },
      { kind: 'sound', sfx: 'secret' },
      { kind: 'music', music: 'none' },
      { kind: 'warp', target: { world: 'w', room: 'r', x: 8, y: 9 } },
      { kind: 'setFlag', flag: '', value: true }, { kind: 'dialogue', dialogue: '' }, { kind: 'openDoor', target: '' },
      { kind: 'secret' },
    ]);
  });

  it('type-checks conditions; an unknown condition stays (never holds) instead of vanishing', () => {
    const t = withTrigger({
      conditions: [
        { kind: 'switch', target: 'sw', on: 'yes' }, { kind: 'flag', flag: 'f', value: false },
        { kind: 'hasItem', item: 'bow', min: 'two' }, { kind: 'defeated', target: 9 },
        { kind: 'torchesLit', extra: 1 }, { kind: 'moonPhase', phase: 3 },
      ],
      actions: [{ kind: 'secret' }],
    });
    expect(t.conditions).toEqual([
      { kind: 'switch', target: 'sw', on: true }, { kind: 'flag', flag: 'f', value: false },
      { kind: 'hasItem', item: 'bow', min: 1 }, { kind: 'defeated', target: '' },
      { kind: 'torchesLit' }, { kind: 'moonPhase' },
    ]);
  });

  it('clamps room floors so the editor never lists millions of floors', () => {
    const p = imported((raw) => {
      raw.worlds[0].rooms.push({ id: 'up', gx: 5, gy: 5, floor: 1e9 }, { id: 'down', gx: 7, gy: 5, floor: -5e6 }, { id: 'f3', gx: 9, gy: 5, floor: 2.6 });
    });
    const floor = (id: string): number => p.worlds[0]!.rooms.find((r) => r.id === id)!.floor;
    expect([floor('up'), floor('down'), floor('f3')]).toEqual([99, -99, 3]);
  });

  it('clamps room grid positions to +-256 screens (and rounds them)', () => {
    const p = imported((raw) => {
      raw.worlds[0].rooms.push(
        { id: 'far', gx: 1e12, gy: -1e12 }, { id: 'odd', gx: 12.6, gy: -3.4 }, { id: 'nan', gx: 'x', gy: null },
      );
    });
    const at = (id: string): number[] => {
      const r = p.worlds[0]!.rooms.find((x) => x.id === id)!;
      return [r.gx, r.gy];
    };
    expect(at('far')).toEqual([256, -256]);
    expect(at('odd')).toEqual([13, -3]);
    expect(at('nan')).toEqual([0, 0]);
  });

  it('normalises palette colours to #rrggbb so no CSS value (url(...)) survives', () => {
    const p = imported((raw) => {
      raw.palettes[0].colors = ['url(https://example.invalid/b.png)', '#ABC', 'ff0080', ' #00FF00 ', 7, 'image-set("x.png" 1x)', '#1234567'];
    });
    const colors = p.palettes[0]!.colors;
    expect(colors).toHaveLength(16);
    expect(colors.slice(0, 8)).toEqual(['#000000', '#aabbcc', '#ff0080', '#00ff00', '#000000', '#000000', '#000000', '#000000']);
    expect(colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(find(p, 'error', /colour/)).toBeUndefined();
  });

  it('keeps sprite frame sizes whole and within 1..64', () => {
    const p = imported((raw) => {
      const hero = raw.sprites.find((s: { id: string }) => s.id === 'hero');
      hero.w = 0.5;
      hero.h = 1e7;
      hero.ox = 'left';
      raw.sprites[1].w = 12.4;
    });
    const hero = p.sprites.find((s) => s.id === 'hero')!;
    expect([hero.w, hero.h, hero.ox]).toEqual([1, 64, 0]);
    expect(p.sprites[1]!.w).toBe(12);
  });

  it('never copies "__proto__" keys onto tiles, sprites, palettes, anims or entity props', () => {
    const raw = JSON.parse(serializeProject(BASE)) as Record<string, any>;
    raw.tiles[0].zzProto = 1;
    raw.sprites[0].zzProto = 1;
    raw.sprites[0].anims.zzProto = 1;
    raw.palettes[0].zzProto = 1;
    raw.worlds[0].rooms[0].entities.push({
      id: 'pot', type: 'obj.pot', x: 8, y: 8,
      props: { zzProto: 1, contents: 'heart', junk: [1], far: { world: 'w', room: 'r', x: 1, y: 2, q: 1 } },
    });
    const text = JSON.stringify(raw).replace(/"zzProto":1/g, '"__proto__":{"polluted":true,"frames":[0]}');
    expect(Object.hasOwn(JSON.parse(text).tiles[0], '__proto__')).toBe(true);
    const q = parseProject(text);
    const props = q.worlds[0]!.rooms[0]!.entities[0]!.props;
    for (const o of [q.tiles[0], q.sprites[0], q.sprites[0]!.anims, q.palettes[0], props]) {
      expect(Object.hasOwn(o!, '__proto__')).toBe(false);
      expect((o as Record<string, unknown>).polluted).toBeUndefined();
    }
    expect(props).toEqual({ contents: 'heart', far: { world: 'w', room: 'r', x: 1, y: 2 } });
  });

  it('cleans tile behaviours so their target is always a tile id', () => {
    const p = imported((raw) => {
      const bush = raw.tiles.find((t: { id: number }) => t.id === T.BUSH);
      bush.cut = { to: 'grass', drops: 'yes' };
      bush.lift = { to: T.GRASS, weight: 9 };
      bush.bomb = 5;
    });
    const bush = p.tiles.find((t) => t.id === T.BUSH)!;
    expect(bush.cut).toEqual({ to: 0 });
    expect(bush.lift).toEqual({ to: T.GRASS, weight: 2 });
    expect(bush.bomb).toBeUndefined();
  });

  it('cuts an enormous dialogue page on load, and warns about one in the editor before that', () => {
    const p = imported((raw) => { raw.dialogues = [{ id: 'd_big', name: 'Big', pages: [{ text: 'M'.repeat(1_000_000) }, { text: 'ok' }] }]; });
    expect(p.dialogues[0]!.pages.map((x) => x.text.length)).toEqual([4000, 2]);
    expect(find(p, 'warning', /characters long/)).toBeUndefined();
    p.dialogues[0]!.pages[0]!.text += 'more';
    expectOnly(p, 'warning', /Dialogue "Big" page 1 is 4004 characters long/);
  });

  it('keeps a dungeon prize name, drops a non-text one', () => {
    const p = imported((raw) => {
      raw.worlds.push({ id: 'd1', kind: 'dungeon', prizeName: 'Sun Crystal', rooms: [{ gx: 0, gy: 0 }] }, { id: 'd2', kind: 'dungeon', prizeName: 7, rooms: [] });
    });
    expect(p.worlds.find((w) => w.id === 'd1')!.prizeName).toBe('Sun Crystal');
    expect('prizeName' in p.worlds.find((w) => w.id === 'd2')!).toBe(false);
  });
});

describe('validateProject: scale and cross-world checks', () => {
  it('reports each overlapping room once and caps the list, so n stacked rooms stay cheap', () => {
    const n = 800;
    const p = imported((raw) => { raw.worlds[0].rooms = Array.from({ length: n }, () => ({})); });
    const t0 = performance.now();
    const overlaps = validateProject(p).filter((x) => /overlap/.test(x.message));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(overlaps).toHaveLength(51);
    expect(overlaps.slice(0, 50).every((x) => x.level === 'error' && x.where?.room)).toBe(true);
    expect(new Set(overlaps.slice(0, 50).map((x) => x.where!.room)).size).toBe(50);
    expect(overlaps[50]!.message).toMatch(/^749 more overlapping rooms in "/);
  });

  it('warns when doors in different worlds share a link (one project-wide door:<link> flag)', () => {
    const { p, room } = fresh();
    const keep = createWorld({ id: 'w_keep', name: 'Keep', kind: 'dungeon' });
    const hall = createRoom({ id: 'r_hall', name: 'Hall', gx: 0, gy: 0, fill: T.DFLOOR });
    keep.rooms.push(hall);
    p.worlds.push(keep);
    room.entities.push(ent('d1', 'obj.door', { kind: 'shut', link: 'gate' }), ent('d2', 'obj.door', { kind: 'shut', link: 'gate' }, 60, 40));
    expect(find(p, 'warning', /Door link/)).toBeUndefined();
    hall.entities.push(ent('d3', 'obj.door', { kind: 'shut', link: 'gate' }), ent('d4', 'obj.door', { kind: 'shut', link: 'gate' }, 60, 40));
    expectOnly(p, 'warning', /Door link "gate" is used in worlds ".*" and "Keep"/);
    expect(find(p, 'warning', /Door link/)!.where).toEqual({ world: 'w_keep', room: 'r_hall', entity: 'd3' });
  });

  it('checks world prize names', () => {
    const { p } = fresh();
    p.worlds[0]!.prizeName = 'Moon Pearl';
    expectOnly(p, 'warning', /prize name, but only dungeon worlds/);
    (p.worlds[0] as { prizeName: unknown }).prizeName = 5;
    expectOnly(p, 'error', /prize name should be text/);
  });
});
