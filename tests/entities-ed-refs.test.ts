// Entity/trigger/dialogue editors: reference & usage scanning, flag renames,
// clearing dangling dialogue references, trigger defaults and the dialogue
// tab model.
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, Room, Trigger, World } from '../src/core/types';
import { cloneProject, createBlankProject, createRoom } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import {
  clearDialogueRefs, dialogueUsageCounts, dialogueUsages, entityUsages, flagUsageCounts, flagUsages, isEngineFlag, renameFlag,
} from '../src/editor/entities/refs';
import {
  actionTargets, conditionTargets, defaultAction, defaultCondition, duplicateTrigger, newTrigger,
} from '../src/editor/entities/triggerModel';
import { entityAt } from '../src/editor/entities/widgets';
import {
  blankAnswersWarning, choiceCountWarning, dialogueSnippet, duplicateDialogue, filterDialogues, flagNameProblem, pageStats,
  renamedDialogueName, statsText, uniqueDialogueName,
} from '../src/editor/dialogue/dialogueModel';
import { copyName, numberedName, uniqueName } from '../src/editor/entities/names';

const BASE = createBlankProject('Refs');

function ent(id: string, type: string, props: EntityInstance['props'] = {}): EntityInstance {
  return { id, type, x: 40, y: 40, props: { ...defaultProps(type), ...props } };
}

function trig(id: string, extra: Partial<Trigger> = {}): Trigger {
  return { id, name: id, on: 'auto', conditions: [], actions: [], once: true, ...extra };
}

/** Two rooms; the dialogue "d_hi" and flag "met" are referenced from several places. */
function fixture(): { p: Project; world: World; village: Room; shop: Room } {
  const p = cloneProject(BASE);
  const world = p.worlds[0]!;
  world.name = 'Ellendor';
  const village = world.rooms[0]!;
  village.name = 'Village';
  const shop = createRoom({ name: 'Shop', gx: 1, gy: 0 });
  world.rooms.push(shop);
  p.dialogues.push(
    { id: 'd_hi', name: 'Greeting', pages: [{ text: 'Hello there.' }, { text: 'Want to trade?', choice: { options: ['Yes', 'No'], flag: 'met' } }] },
    { id: 'd_bye', name: 'Farewell', pages: [{ speaker: 'Mira', text: '  Safe\n travels!  ' }] },
  );
  p.flags.push({ name: 'met', description: 'Talked to Mira' }, { name: 'unused' });
  p.settings.introDialogue = 'd_hi';
  village.entities.push(
    ent('e_mira', 'npc.person', { name: 'Mira', dialogue: 'd_hi' }),
    ent('e_sign', 'obj.sign', { dialogue: 'd_bye' }),
    ent('e_door', 'obj.door'),
  );
  village.triggers.push(
    trig('t_talk', { name: 'Talk', on: 'talk', source: 'e_mira', conditions: [{ kind: 'flag', flag: 'met', value: false }],
      actions: [{ kind: 'dialogue', dialogue: 'd_hi' }, { kind: 'setFlag', flag: 'met', value: true }, { kind: 'dialogue', dialogue: 'd_hi' }] }),
    trig('t_door', { name: 'Open', conditions: [{ kind: 'flag', flag: 'met', value: true }], actions: [{ kind: 'openDoor', target: 'e_door' }] }),
  );
  shop.triggers.push(trig('t_shop', { name: 'Shop', actions: [{ kind: 'dialogue', dialogue: 'd_bye' }, { kind: 'setFlag', flag: 'bought', value: true }] }));
  return { p, world, village, shop };
}

describe('dialogue usages', () => {
  it('finds the intro, entity props and trigger actions (counting repeats)', () => {
    const { p, world, village } = fixture();
    const uses = dialogueUsages(p, 'd_hi');
    expect(uses.map((u) => u.label)).toEqual([
      'Project settings · Intro dialogue',
      'Ellendor › Village · Person “Mira” (e_mira) · Dialogue',
      'Ellendor › Village · Trigger “Talk” ×2',
    ]);
    expect(uses[0]!.where).toEqual({ settings: true });
    expect(uses[1]!.where).toEqual({ world: world.id, room: village.id, entity: 'e_mira' });
    expect(uses[2]!.where).toEqual({ world: world.id, room: village.id, trigger: 't_talk' });
    expect(dialogueUsages(p, 'd_bye').map((u) => u.label)).toEqual([
      'Ellendor › Village · Sign (e_sign) · Dialogue',
      'Ellendor › Shop · Trigger “Shop”',
    ]);
    expect(dialogueUsages(p, '')).toEqual([]);
  });

  it('counts every dialogue in one pass, matching the usage lists', () => {
    const { p, shop } = fixture();
    shop.entities.push(ent('e_ghost', 'npc.person', { dialogue: 'd_gone' }));
    const counts = dialogueUsageCounts(p);
    expect(Object.fromEntries(counts)).toEqual({ d_hi: 3, d_bye: 2, d_gone: 1 });
    for (const [id, n] of counts) expect(dialogueUsages(p, id)).toHaveLength(n);
  });

  it('clears every reference and reports how many', () => {
    const { p, village } = fixture();
    expect(clearDialogueRefs(p, 'd_hi')).toBe(4);
    expect(p.settings.introDialogue).toBeUndefined();
    expect(village.entities[0]!.props.dialogue).toBe('');
    expect(village.triggers[0]!.actions).toEqual([{ kind: 'setFlag', flag: 'met', value: true }]);
    expect(dialogueUsages(p, 'd_hi')).toEqual([]);
    expect(dialogueUsages(p, 'd_bye')).toHaveLength(2);
  });
});

describe('flag usages', () => {
  it('lists triggers and dialogue choices that use a flag', () => {
    const { p } = fixture();
    expect(flagUsages(p, 'met').map((u) => u.label)).toEqual([
      'Ellendor › Village · Trigger “Talk” ×2',
      'Ellendor › Village · Trigger “Open”',
      'Dialogue “Greeting” · page 2 choice',
    ]);
    expect(flagUsages(p, 'met')[2]!.where).toEqual({ dialogue: 'd_hi' });
    expect(flagUsages(p, 'unused')).toEqual([]);
  });

  it('counts every referenced flag, declared or not', () => {
    const { p } = fixture();
    expect(Object.fromEntries(flagUsageCounts(p))).toEqual({ met: 4, bought: 1 });
  });

  it('recognises engine-managed flags', () => {
    expect(isEngineFlag('crystal:keep')).toBe(true);
    expect(isEngineFlag('chest:e_1')).toBe(true);
    expect(isEngineFlag('met')).toBe(false);
    expect(isEngineFlag('my:thing')).toBe(false);
  });

  it('renames the definition and every reference', () => {
    const { p, village, shop } = fixture();
    expect(renameFlag(p, 'met', 'talked_to_mira')).toBe(4);
    expect(p.flags.map((f) => f.name)).toEqual(['talked_to_mira', 'unused']);
    expect(village.triggers[0]!.conditions[0]).toEqual({ kind: 'flag', flag: 'talked_to_mira', value: false });
    expect(village.triggers[0]!.actions[1]).toEqual({ kind: 'setFlag', flag: 'talked_to_mira', value: true });
    expect(p.dialogues[0]!.pages[1]!.choice!.flag).toBe('talked_to_mira');
    expect(shop.triggers[0]!.actions[1]).toEqual({ kind: 'setFlag', flag: 'bought', value: true });
    expect(flagUsages(p, 'met')).toEqual([]);
    expect(renameFlag(p, 'x', 'x')).toBe(0);
  });
});

describe('entity usages', () => {
  it('finds triggers that target or listen to an entity', () => {
    const { world, village } = fixture();
    expect(entityUsages(world, village, 'e_mira').map((u) => u.where.trigger)).toEqual(['t_talk']);
    expect(entityUsages(world, village, 'e_door').map((u) => u.label)).toEqual(['Ellendor › Village · Trigger “Open”']);
    expect(entityUsages(world, village, 'e_sign')).toEqual([]);
  });
});

describe('entity picking', () => {
  it('hits the topmost entity whose footprint contains the point', () => {
    const { village } = fixture();
    village.entities.push({ ...ent('e_region', 'marker.region', { w: 4, h: 4 }), x: 48, y: 48 }, { ...ent('e_top', 'obj.block'), x: 44, y: 44 });
    const any = (): boolean => true;
    expect(entityAt(village, 44, 44, any)?.id).toBe('e_top');
    expect(entityAt(village, 44, 44, (e) => e.type === 'marker.region')?.id).toBe('e_region');
    expect(entityAt(village, 79, 79, any)?.id).toBe('e_region');
    expect(entityAt(village, 200, 10, any)).toBeUndefined();
  });

  it('finds a small entity placed off the tile grid from a neighbouring tile centre', () => {
    const { village } = fixture();
    village.entities.length = 0;
    village.entities.push({ ...ent('e_npc', 'npc.person'), x: 96, y: 104 }, { ...ent('e_far', 'npc.person'), x: 120, y: 104 });
    const any = (): boolean => true;
    expect(entityAt(village, 88, 104, any)?.id).toBe('e_npc');
    expect(entityAt(village, 104, 104, any)?.id).toBe('e_npc');
    expect(entityAt(village, 120, 104, any)?.id).toBe('e_far');
    expect(entityAt(village, 88, 136, any)).toBeUndefined();
  });
});

describe('trigger model', () => {
  it('targets the first suitable entity and uses sensible defaults', () => {
    const { p, village } = fixture();
    village.entities.push(ent('e_sw', 'obj.crystalSwitch'), ent('e_bat', 'enemy.bat'), ent('e_chest', 'obj.chest', { hidden: true }));
    expect(defaultCondition('switch', village)).toEqual({ kind: 'switch', target: 'e_sw', on: true });
    expect(defaultCondition('defeated', village)).toEqual({ kind: 'defeated', target: 'e_bat' });
    expect(defaultCondition('blockPushed', village)).toEqual({ kind: 'blockPushed', target: '' });
    expect(defaultCondition('enemiesCleared', village)).toEqual({ kind: 'enemiesCleared' });
    const d = { project: p, room: village, tile: 42 };
    expect(defaultAction('openDoor', d)).toEqual({ kind: 'openDoor', target: 'e_door' });
    expect(defaultAction('showEntity', d)).toEqual({ kind: 'showEntity', target: 'e_chest' });
    // Left unset so the "pick a dialogue" hint shows (never silently the project's first dialogue).
    expect(defaultAction('dialogue', d)).toEqual({ kind: 'dialogue', dialogue: '' });
    expect(defaultAction('setTile', d)).toEqual({ kind: 'setTile', layer: 'bg', tx: 0, ty: 0, tile: 42 });
    expect(defaultAction('warp', d)).toEqual({ kind: 'warp', target: p.start });
    expect(conditionTargets('flag')).toBeNull();
    const defeatable = conditionTargets('defeated')!;
    expect(defeatable(ent('e_eye', 'enemy.eye'))).toBe(false);
    expect(defeatable(ent('e_trap', 'enemy.bladeTrap'))).toBe(false);
    expect(defeatable(ent('e_worm', 'boss.worm'))).toBe(true);
    expect(defeatable(ent('e_npc', 'npc.person'))).toBe(false);
    expect(actionTargets('hideEntity')?.(village.entities[0]!)).toBe(true);
  });

  it('creates and duplicates triggers with fresh ids and unique names', () => {
    const room = createRoom({ name: 'Hall', gx: 0, gy: 0 });
    room.triggers.push(trig('t_a', { name: 'Trigger 1' }), trig('t_b', { name: 'Trigger 2' }));
    const t = newTrigger(room);
    expect(t).toMatchObject({ name: 'Trigger 3', on: 'auto', conditions: [], actions: [], once: true });
    room.triggers.push(t);
    t.actions.push({ kind: 'secret' });
    const copy = duplicateTrigger(t, room);
    expect(copy.id).not.toBe(t.id);
    expect(copy.name).toBe('Trigger 3 copy');
    expect(copy.actions).toEqual(t.actions);
    expect(copy.actions).not.toBe(t.actions);
    room.triggers.push(copy);
    // Copying a copy counts up instead of stacking "copy copy".
    expect(duplicateTrigger(copy, room).name).toBe('Trigger 3 copy 2');
    // After a delete the count no longer matches the numbers in use: still no clash.
    room.triggers.splice(0, 1);
    expect(room.triggers.map((x) => x.name)).toEqual(['Trigger 2', 'Trigger 3', 'Trigger 3 copy']);
    expect(newTrigger(room).name).toBe('Trigger 4');
  });
});

describe('dialogue tab model', () => {
  it('measures pages with the in-game box layout', () => {
    expect(pageStats({ text: 'Hi!' })).toEqual({ chars: 3, lines: 1, boxes: 1 });
    expect(pageStats({ text: '' })).toEqual({ chars: 0, lines: 0, boxes: 0 });
    const long = pageStats({ text: 'word '.repeat(60) });
    expect(long.boxes).toBeGreaterThan(1);
    expect(long.lines).toBeGreaterThan(3);
    expect(pageStats({ text: 'Well?', choice: { options: ['Yes', 'No'] } })).toEqual({ chars: 5, lines: 1, boxes: 1 });
    expect(statsText({ chars: 1, lines: 1, boxes: 1 })).toBe('1 character · 1 line · 1 box');
    expect(statsText({ chars: 0, lines: 0, boxes: 0 })).toBe('0 characters · 0 lines · empty page (skipped in game)');
    expect(statsText({ chars: 200, lines: 7, boxes: 3 })).toBe('200 characters · 7 lines · 3 boxes (3 lines each)');
  });

  it('names, duplicates, searches and snippets dialogues', () => {
    const { p } = fixture();
    expect(uniqueDialogueName(p, 'Greeting')).toBe('Greeting 2');
    expect(uniqueDialogueName(p, 'Other')).toBe('Other');
    const copy = duplicateDialogue(p, p.dialogues[0]!);
    expect(copy.name).toBe('Greeting copy');
    p.dialogues.push(copy);
    expect(duplicateDialogue(p, copy).name).toBe('Greeting copy 2');
    expect(duplicateDialogue(p, p.dialogues[0]!).name).toBe('Greeting copy 2');
    p.dialogues.pop();
    expect(copy.id).not.toBe('d_hi');
    expect(copy.pages).toEqual(p.dialogues[0]!.pages);
    expect(filterDialogues(p.dialogues, 'mira').map((d) => d.id)).toEqual(['d_bye']);
    expect(filterDialogues(p.dialogues, '').map((d) => d.id)).toEqual(['d_bye', 'd_hi']);
    const numbered = ['Dialogue 10', 'dialogue 2', 'Dialogue 1'].map((name, i) => ({ id: `d_${i}`, name, pages: [{ text: '' }] }));
    expect(filterDialogues(numbered, '').map((d) => d.name)).toEqual(['Dialogue 1', 'dialogue 2', 'Dialogue 10']);
    expect(dialogueSnippet(p.dialogues[1]!)).toBe('Safe travels!');
    expect(dialogueSnippet({ id: 'x', name: 'x', pages: [{ text: 'a'.repeat(80) }] }, 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('validates new flag names', () => {
    const { p } = fixture();
    expect(flagNameProblem(p, 'fresh')).toBeNull();
    expect(flagNameProblem(p, '')).toBe('Enter a flag name.');
    expect(flagNameProblem(p, '   ')).toBe('Enter a flag name.');
    expect(flagNameProblem(p, ' met ')).toBe('There is already a flag called “met”.');
    expect(flagNameProblem(p, 'met')).toBe('There is already a flag called “met”.');
    expect(flagNameProblem(p, 'met', 'met')).toBeNull();
    expect(flagNameProblem(p, 'chest:e_1')).toBe('Names starting with “chest:” are used by the engine.');
  });

  it('keeps dialogue names unique on rename', () => {
    const { p } = fixture();
    const [hi, bye] = p.dialogues;
    expect(renamedDialogueName(p, hi!.id, '  Welcome  ')).toBe('Welcome');
    expect(renamedDialogueName(p, hi!.id, bye!.name)).toBe(`${bye!.name} 2`);
    expect(renamedDialogueName(p, hi!.id, hi!.name)).toBe(hi!.name);
    expect(renamedDialogueName(p, hi!.id, '   ')).toBeNull();
  });

  it('warns about choices with too few or too many answers', () => {
    expect(choiceCountWarning(2)).toBeNull();
    expect(choiceCountWarning(3)).toBeNull();
    expect(choiceCountWarning(1)).toBe('A choice needs at least 2 answers; this one has 1. Add an answer.');
    expect(choiceCountWarning(4)).toBe('The game\'s dialogue box fits at most 3 answers; this choice has 4. Remove one.');
    expect(choiceCountWarning(6)).toBe('The game\'s dialogue box fits at most 3 answers; this choice has 6. Remove 3.');
  });

  it('warns about blank choice answers', () => {
    expect(blankAnswersWarning(['Yes', 'No'])).toBeNull();
    expect(blankAnswersWarning(['', 'No'])).toBe('Answer 1 is blank: the player would see an empty choice.');
    expect(blankAnswersWarning(['Yes', ' ', ''])).toBe('Answers 2 and 3 are blank: the player would see empty choices.');
    expect(blankAnswersWarning(['', '', ''])).toBe('Answers 1, 2 and 3 are blank: the player would see empty choices.');
  });
});

describe('unique names', () => {
  const taken = new Set(['Door', 'Door 2', 'Trigger 3', 'Chest copy', 'Chest copy 2']);

  it('numbers a clashing base name', () => {
    expect(uniqueName('Key', taken)).toBe('Key');
    expect(uniqueName('Door', taken)).toBe('Door 3');
  });

  it('counts up from a start number past used ones', () => {
    expect(numberedName('Trigger', 3, taken)).toBe('Trigger 4');
    expect(numberedName('Trigger', 1, taken)).toBe('Trigger 1');
    expect(numberedName('Trigger', 0, new Set())).toBe('Trigger 1');
  });

  it('names copies without stacking "copy"', () => {
    expect(copyName('Door', taken)).toBe('Door copy');
    expect(copyName('Chest', taken)).toBe('Chest copy 3');
    expect(copyName('Chest copy', taken)).toBe('Chest copy 3');
    expect(copyName('Chest copy 2', taken)).toBe('Chest copy 3');
    expect(copyName('Photocopy', taken)).toBe('Photocopy copy');
  });
});
