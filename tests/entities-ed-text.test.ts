// Entity/trigger editor: human-readable trigger summaries, validation hints,
// labels and inline entity warnings.
import { describe, expect, it } from 'vitest';
import type { Action, Condition, EntityInstance, Project, Room, Trigger, World } from '../src/core/types';
import { cloneProject, createBlankProject, createRoom, createWorld } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { actionText, conditionText, triggerIssues, triggerSummary } from '../src/editor/entities/triggerText';
import { asWarpTarget, entityLabel, enumLabel, itemAmount, musicLabel, sfxLabel, warpLabel } from '../src/editor/entities/labels';
import { entityWarnings, matchingDoor } from '../src/editor/entities/warnings';
import { createSampleProject } from '../src/content/sample/sampleProject';

const BASE = createBlankProject('Text');

function ent(id: string, type: string, props: EntityInstance['props'] = {}, x = 40, y = 40): EntityInstance {
  return { id, type, x, y, props: { ...defaultProps(type), ...props } };
}

function trig(extra: Partial<Trigger> = {}): Trigger {
  return { id: 't_1', name: 'Reward', on: 'auto', conditions: [], actions: [], once: true, ...extra };
}

function fixture(): { p: Project; world: World; room: Room } {
  const p = cloneProject(BASE);
  const world = p.worlds[0]!;
  const room = world.rooms[0]!;
  room.name = 'Hall';
  room.entities.push(
    ent('e_x1', 'obj.chest', { item: 'bow', hidden: true }),
    ent('e_sw', 'obj.switch'),
    ent('e_door', 'obj.door', { kind: 'shutter', link: 'hall-north' }),
    ent('e_mira', 'npc.person', { name: 'Mira' }),
    ent('e_bat', 'enemy.bat'),
    ent('e_reg', 'marker.region'),
  );
  p.dialogues.push({ id: 'd_hi', name: 'Greeting', pages: [{ text: 'Hi!' }] });
  return { p, world, room };
}

describe('trigger summaries', () => {
  it('reads like the spec example', () => {
    const { p, room } = fixture();
    const t = trig({ conditions: [{ kind: 'enemiesCleared' }], actions: [{ kind: 'showEntity', target: 'e_x1' }, { kind: 'secret' }] });
    expect(triggerSummary(p, room, t)).toBe('When all enemies are defeated → show Chest (e_x1), play secret');
  });

  it('describes enter / talk events, joined conditions and repeats', () => {
    const { p, room } = fixture();
    expect(triggerSummary(p, room, trig({ on: 'enter', actions: [{ kind: 'music', music: 'boss' }] })))
      .toBe('On entering the room → play music Boss');
    const talk = trig({
      on: 'talk', source: 'e_mira', once: false,
      conditions: [{ kind: 'flag', flag: 'met', value: false }, { kind: 'hasItem', item: 'rupees', min: 50 }],
      actions: [{ kind: 'dialogue', dialogue: 'd_hi' }, { kind: 'setFlag', flag: 'met', value: true }],
    });
    expect(triggerSummary(p, room, talk)).toBe(
      'When talking to Person “Mira” (e_mira), if flag “met” is not set and the player has at least 50 Gems'
      + ' → say “Greeting”, set flag “met” (repeats)');
    expect(triggerSummary(p, room, trig())).toBe('As soon as the room starts → do nothing yet');
  });

  it('names every condition kind', () => {
    const { room } = fixture();
    expect(conditionText(room, { kind: 'switch', target: 'e_sw', on: true })).toBe('Floor Switch (e_sw) is on');
    expect(conditionText(room, { kind: 'torchesLit' })).toBe('all torches are lit');
    expect(conditionText(room, { kind: 'hasItem', item: 'bow', min: 1 })).toBe('the player has Bow');
    expect(conditionText(room, { kind: 'inRegion', target: 'e_reg' })).toBe('the player is in Region “region” (e_reg)');
    expect(conditionText(room, { kind: 'defeated', target: 'e_bat' })).toBe('Bat (e_bat) is defeated');
    expect(conditionText(room, { kind: 'blockPushed', target: 'gone' })).toBe('missing entity (gone) was pushed');
    expect(conditionText(room, { kind: 'flag', flag: '', value: true })).toBe('flag “?” is set');
  });

  it('words a crystal switch by its colour (on = blue pegs raised)', () => {
    const { room } = fixture();
    room.entities.push(ent('e_cr', 'obj.crystalSwitch'));
    expect(conditionText(room, { kind: 'switch', target: 'e_cr', on: true })).toBe('Crystal Switch (e_cr) is blue');
    expect(conditionText(room, { kind: 'switch', target: 'e_cr', on: false })).toBe('Crystal Switch (e_cr) is red');
    expect(conditionText(room, { kind: 'switch', target: 'e_sw', on: false })).toBe('Floor Switch (e_sw) is off');
  });

  it('names every action kind', () => {
    const { p, world, room } = fixture();
    const text = (a: Parameters<typeof actionText>[2]): string => actionText(p, room, a);
    expect(text({ kind: 'openDoor', target: 'e_door' })).toBe('open Door (e_door)');
    expect(text({ kind: 'closeDoor', target: '' })).toBe('close (no door picked)');
    expect(text({ kind: 'hideEntity', target: 'e_bat' })).toBe('hide Bat (e_bat)');
    expect(text({ kind: 'setFlag', flag: 'x', value: false })).toBe('clear flag “x”');
    expect(text({ kind: 'dialogue', dialogue: 'nope' })).toBe('say “missing dialogue (nope)”');
    expect(text({ kind: 'dialogue', dialogue: '' })).toBe('say (no dialogue picked)');
    expect(text({ kind: 'giveItem', item: 'rupees', amount: 20 })).toBe('give 20 Gems');
    expect(text({ kind: 'takeItem', item: 'smallKey', amount: 1 })).toBe('take Small Key');
    expect(text({ kind: 'setTile', layer: 'fg', tx: 3, ty: 4, tile: 0 })).toBe('set fg tile (3,4) to empty (#0)');
    expect(text({ kind: 'sound', sfx: 'swordSpin' })).toBe('play sound “sword spin”');
    expect(text({ kind: 'music', music: 'none' })).toBe('stop the music');
    expect(text({ kind: 'warp', target: { world: world.id, room: room.id, x: 40.4, y: 60 } })).toBe(`warp to ${world.name} › Hall (40,60)`);
    expect(text({ kind: 'heal', amount: 1 })).toBe('heal 1 half-heart');
    expect(text({ kind: 'heal', amount: 2 })).toBe('heal 1 heart');
    expect(text({ kind: 'heal', amount: 6 })).toBe('heal 3 hearts');
    expect(text({ kind: 'shake', seconds: 0.5 })).toBe('shake the screen 0.5 s');
    expect(text({ kind: 'wait', seconds: 2 })).toBe('wait 2 s');
  });

  it('words unset targets and kinds from newer / hand-edited files without "undefined"', () => {
    const { p, room } = fixture();
    const t = trig({
      on: 'talk',
      conditions: [{ kind: 'switch', target: '', on: true }, { kind: 'timeOfDay' } as unknown as Condition],
      actions: [{ kind: 'spawnEntity' } as unknown as Action, { kind: 'hideEntity', target: '' }],
    });
    expect(triggerSummary(p, room, t)).toBe(
      'When talking to (no person picked), if (no switch picked) is on and unknown condition “timeOfDay”'
      + ' → unknown action “spawnEntity”, hide (no entity picked)');
    expect(triggerIssues(p, room, t)).toEqual([
      'Pick who the player talks to.',
      'Condition 1 (Switch state): pick a target.',
      'Condition 2 has an unknown kind (“timeOfDay”): the game treats it as never true, so this trigger never fires. Remove it.',
      'Action 1 has an unknown kind (“spawnEntity”): the game skips it. Remove it.',
      'Action 2 (Hide entity): pick a target.',
    ]);
  });
});

describe('trigger issues', () => {
  it('flags missing, wrong and dangling targets', () => {
    const { p, room } = fixture();
    const t = trig({
      on: 'talk',
      source: 'e_x1',
      conditions: [{ kind: 'switch', target: '', on: true }, { kind: 'defeated', target: 'e_sw' }, { kind: 'torchesLit' }],
      actions: [{ kind: 'openDoor', target: 'gone' }, { kind: 'dialogue', dialogue: 'nope' }, { kind: 'setFlag', flag: ' ', value: true }],
    });
    const issues = triggerIssues(p, room, t);
    expect(issues).toEqual([
      'Chest (e_x1) is not a person, so talking to it never fires this trigger.',
      'Condition 1 (Switch state): pick a target.',
      'Condition 2 (Enemy defeated): Floor Switch (e_sw) is not a valid target.',
      'Condition 3 (All torches lit): there are no torches in this room.',
      'Action 1 (Open door): entity gone is not in this room any more.',
      'Action 2 (Show dialogue): the dialogue no longer exists.',
      'Action 3 (Set flag): enter a flag name.',
    ]);
  });

  it('notes a shown entity that is not hidden, empty triggers and bad tiles / warps', () => {
    const { p, room } = fixture();
    expect(triggerIssues(p, room, trig())).toEqual(['Does nothing yet: add an action.']);
    const t = trig({
      actions: [
        { kind: 'showEntity', target: 'e_bat' },
        { kind: 'showEntity', target: 'e_x1' },
        { kind: 'setTile', layer: 'bg', tx: 99, ty: 0, tile: 123456 },
        { kind: 'warp', target: { world: 'nowhere', room: 'r', x: 0, y: 0 } },
      ],
    });
    expect(triggerIssues(p, room, t)).toEqual([
      'Action 1 (Show entity): Bat (e_bat) is not marked Hidden, so it is already visible.',
      'Action 3 (Change tile): tile (99,0) is outside this room.',
      'Action 3 (Change tile): tile #123456 does not exist.',
      'Action 4 (Warp player): the destination room no longer exists.',
    ]);
  });

  it('knows "all enemies defeated" never holds in a room without counting enemies', () => {
    const { p, room } = fixture();
    const cleared = trig({ conditions: [{ kind: 'enemiesCleared' }], actions: [{ kind: 'secret' }] });
    expect(triggerIssues(p, room, cleared)).toEqual([]);
    room.entities = room.entities.filter((e) => e.id !== 'e_bat');
    room.entities.push(ent('e_eye', 'enemy.eye'));
    expect(triggerIssues(p, room, cleared)).toEqual([
      'Condition 1 (All enemies defeated): no enemy in this room counts, so this never becomes true.',
    ]);
    room.entities.push(ent('e_later', 'enemy.bat', { hidden: true }));
    expect(triggerIssues(p, room, cleared)).toEqual([]);
  });

  it('asks for whole numbers where the game needs them', () => {
    const { p, room } = fixture();
    const t = trig({
      conditions: [{ kind: 'hasItem', item: 'rupees', min: 1.5 }],
      actions: [
        { kind: 'setTile', layer: 'bg', tx: 2.5, ty: 1, tile: 0 },
        { kind: 'giveItem', item: 'rupees', amount: 3.7 },
        { kind: 'heal', amount: 2 },
        { kind: 'wait', seconds: 0.5 },
      ],
    });
    expect(triggerIssues(p, room, t)).toEqual([
      'Condition 1 (Player has item): the count must be a whole number.',
      'Action 1 (Change tile): the tile position must be whole numbers.',
      'Action 2 (Give item): the amount must be a whole number.',
    ]);
  });
});

describe('labels', () => {
  it('formats entities, items, audio and warps', () => {
    const { p, world, room } = fixture();
    expect(entityLabel(room.entities.find((e) => e.id === 'e_mira'))).toBe('Person “Mira” (e_mira)');
    expect(entityLabel(undefined, 'e_zz')).toBe('missing entity (e_zz)');
    expect(itemAmount('bow', 1)).toBe('Bow');
    expect(itemAmount('arrows', 10)).toBe('10 Arrows');
    expect(musicLabel('fileSelect')).toBe('File Select');
    expect(musicLabel('inherit')).toBe('Inherit from world');
    expect(sfxLabel('menuMove')).toBe('menu move');
    expect(warpLabel(p, null)).toBe('No destination');
    expect(warpLabel(p, { world: world.id, room: room.id, x: 8, y: 24 })).toBe(`${world.name} › Hall (8,24)`);
    expect(warpLabel(p, { world: world.id, room: 'gone', x: 8, y: 24 })).toBe('Missing room (8,24)');
    expect(asWarpTarget({ world: 'w', room: 'r', x: 1, y: 2 })).toEqual({ world: 'w', room: 'r', x: 1, y: 2 });
    expect(asWarpTarget('nowhere')).toBeNull();
    expect(asWarpTarget({ world: 'w', room: 'r' } as never)).toBeNull();
    expect(asWarpTarget(null)).toBeNull();
  });

  it('makes enum options readable', () => {
    expect(enumLabel('npc.elder')).toBe('Elder');
    expect(enumLabel('bigKey')).toBe('Big key');
    expect(enumLabel('enemiesCleared')).toBe('Enemies cleared');
    expect(enumLabel('rupee20')).toBe('20 Gems');
    expect(enumLabel('rupee')).toBe('Gem');
    expect(enumLabel('toString')).toBe('To string');
    expect(enumLabel('up')).toBe('Up');
  });
});

describe('entity warnings', () => {
  it('warns about warps without a target and unreachable placements', () => {
    const { p, world, room } = fixture();
    const warp = ent('e_w', 'marker.warp', {}, -40, 40);
    room.entities.push(warp);
    expect(entityWarnings(p, world, room, warp)).toEqual([
      'Outside the room: the player can never reach it.',
      'Destination: no destination yet. Use “Pick on map”.',
    ]);
  });

  it('warns about shutters nobody opens unless a linked door can open them', () => {
    const { p, world, room } = fixture();
    const door = room.entities.find((e) => e.id === 'e_door')!;
    expect(entityWarnings(p, world, room, door)).toEqual(['This shutter opens by trigger, but no trigger in this room opens it.']);
    room.entities.push(ent('e_far', 'obj.door', { kind: 'locked', link: 'hall-north' }, 200, 200));
    expect(entityWarnings(p, world, room, door)).toEqual([]);
    door.props.link = '';
    room.triggers.push(trig({ actions: [{ kind: 'openDoor', target: 'e_door' }] }));
    expect(entityWarnings(p, world, room, door)).toEqual([]);
  });

  /** Room "North" above room "South"; one door on each side of the doorway between them. */
  function doorway(north: EntityInstance['props'], south: EntityInstance['props']) {
    const p = cloneProject(BASE);
    const world = p.worlds[0]!;
    const top = createRoom({ name: 'North', gx: 0, gy: 0 });
    const bottom = createRoom({ name: 'South', gx: 0, gy: 1 });
    world.rooms.splice(0, world.rooms.length, top, bottom);
    const a = ent('e_a', 'obj.door', { dir: 'down', ...north }, 128, 216);
    const b = ent('e_b', 'obj.door', { dir: 'up', ...south }, 128, 8);
    top.entities.push(a);
    bottom.entities.push(b);
    const warn = (): string[][] => [entityWarnings(p, world, top, a), entityWarnings(p, world, bottom, b)];
    return { world, top, bottom, a, b, warn };
  }

  it('finds the door on the far side of a doorway', () => {
    const { world, top, bottom, a, b } = doorway({}, {});
    expect(matchingDoor(world, top, a)?.door).toBe(b);
    expect(matchingDoor(world, bottom, b)?.door).toBe(a);
    b.x = 160;
    expect(matchingDoor(world, top, a)).toBeUndefined();
    b.x = 136;
    expect(matchingDoor(world, top, a)?.room).toBe(bottom);
    a.y = 100;
    expect(matchingDoor(world, top, a)).toBeUndefined();
  });

  it('asks for a shared link only when both sides of a doorway can be shut', () => {
    const unlinked = doorway({ kind: 'locked' }, { kind: 'locked' }).warn();
    expect(unlinked[0]).toEqual(['No link: the door on the other side (Door (e_b) in South) opens separately. Give both the same Link so opening one opens the other.']);
    expect(unlinked[1]).toEqual(['No link: the door on the other side (Door (e_a) in North) opens separately. Give both the same Link so opening one opens the other.']);
    expect(doorway({ kind: 'locked', link: 'ab' }, { kind: 'locked', link: 'ab' }).warn()).toEqual([[], []]);
    expect(doorway({ kind: 'locked', link: 'ab' }, { kind: 'bombable', link: 'xy' }).warn()[0]).toEqual([
      'The door on the other side (Door (e_b) in South) uses link “xy”, so it stays shut when this one opens. Give both the same Link.',
    ]);
    expect(doorway({ kind: 'locked' }, { kind: 'open' }).warn()).toEqual([[], []]);
    const lone = doorway({ kind: 'locked', link: 'solo' }, {});
    lone.bottom.entities.length = 0;
    expect(lone.warn()[0]).toEqual([]);
  });

  it('never asks a close-on-enter shutter for a link, and warns when it shares one', () => {
    const boss = { kind: 'shutter', opensWhen: 'enemiesCleared', closeOnEnter: true };
    expect(doorway({ kind: 'bigKey', link: 'boss' }, boss).warn()).toEqual([[], []]);
    expect(doorway({ kind: 'bigKey', link: 'boss' }, { ...boss, link: 'boss' }).warn()).toEqual([[], [
      'Shares link “boss” with another door: once that door opens, this close-on-enter shutter starts open and never shuts behind the player.',
    ]]);
  });

  it('finds nothing to warn about in the sample adventure', () => {
    const p = createSampleProject();
    const warnings: string[] = [];
    const issues: string[] = [];
    let pairedDoors = 0;
    for (const world of p.worlds) {
      for (const room of world.rooms) {
        for (const e of room.entities) {
          for (const m of entityWarnings(p, world, room, e)) warnings.push(`${room.id}/${e.id}: ${m}`);
          if (e.type === 'obj.door' && matchingDoor(world, room, e)) pairedDoors++;
        }
        for (const t of room.triggers) for (const m of triggerIssues(p, room, t)) issues.push(`${room.id}/${t.id}: ${m}`);
      }
    }
    expect(warnings).toEqual([]);
    expect(issues).toEqual([]);
    // The door checks really ran: the sample's doorways pair up across rooms.
    expect(pairedDoors).toBeGreaterThan(10);
  });

  it('warns about dungeon items and big chests outside a dungeon, silent people and hidden entities', () => {
    const { p, world, room } = fixture();
    const chest = ent('e_map', 'obj.chest', { item: 'map', big: true });
    room.entities.push(chest);
    expect(entityWarnings(p, world, room, chest)).toEqual([
      'Contents: Dungeon Map only works inside a dungeon world.',
      'Big chests open with a dungeon Big Key; outside a dungeon this one can never be opened.',
    ]);
    const dungeon = createWorld({ name: 'Keep', kind: 'dungeon' });
    const hall = createRoom({ name: 'Vault', gx: 0, gy: 0 });
    dungeon.rooms.push(hall);
    p.worlds.push(dungeon);
    hall.entities.push(chest);
    expect(entityWarnings(p, dungeon, hall, chest)).toEqual([]);
    const mira = room.entities.find((e) => e.id === 'e_mira')!;
    expect(entityWarnings(p, world, room, mira)).toEqual(['Says nothing: pick a dialogue or add a “talk” trigger for this person.']);
    const hidden = room.entities.find((e) => e.id === 'e_x1')!;
    expect(entityWarnings(p, world, room, hidden)).toEqual(['Hidden, but no trigger in this room shows it (add a “Show entity” action).']);
    expect(entityWarnings(p, world, room, { id: 'e_q', type: 'enemy.nope', x: 1, y: 1, props: {} })).toEqual([
      'Unknown entity type “enemy.nope”: the game will skip it.',
    ]);
  });
});
