// Editor shell: Project tab summaries, menu formatters and route parsing.
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, Room } from '../src/core/types';
import { validateProject, type Problem } from '../src/core/validate';
import { createBlankProject, createRoom, createWorld, USER_TILE_BASE } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { MAX_PROBLEM_ROWS, capRows, groupProblems, problemTarget, projectStats, summarizeWorld } from '../src/editor/project/stats';
import { createEnv } from '../src/editor/project/env';
import { plural, relativeTime, shortName, uniqueName } from '../src/app/format';
import { parseRoute } from '../src/app/nav';
import type { EditorContext, ProjectChange } from '../src/editor/context';
import { UndoStack } from '../src/editor/undo';

let n = 0;
function ent(type: string, props: Record<string, unknown> = {}): EntityInstance {
  return { id: `e${++n}`, type, x: 40, y: 40, props: { ...defaultProps(type), ...props } as EntityInstance['props'] };
}

function dungeonProject(): { p: Project; room: Room } {
  const p = createBlankProject('Stats');
  const world = createWorld({ id: 'dng', name: 'Crypt', kind: 'dungeon' });
  const room = createRoom({ id: 'r1', name: 'Hall', gx: 0, gy: 0, gw: 2 });
  const room2 = createRoom({ id: 'r2', name: 'Vault', gx: 2, gy: 0 });
  room.entities.push(
    ent('obj.chest', { item: 'smallKey', amount: 1 }),
    ent('obj.chest', { item: 'bigKey', big: false }),
    ent('obj.door', { kind: 'locked', link: 'a' }),
    ent('obj.pot', { contents: 'smallKey' }),
  );
  room2.entities.push(ent('obj.door', { kind: 'locked', link: 'a' }), ent('obj.door', { kind: 'locked', link: '' }), ent('obj.door', { kind: 'shutter' }));
  room2.triggers.push({ id: 't1', name: 'Gift', on: 'enter', conditions: [], actions: [{ kind: 'giveItem', item: 'smallKey', amount: 2 }], once: true });
  world.rooms.push(room, room2);
  p.worlds.push(world);
  return { p, room };
}

describe('summarizeWorld', () => {
  it('counts rooms, screens, keys, linked doors once, chests and the big key', () => {
    const { p } = dungeonProject();
    const s = summarizeWorld(p.worlds[1]!);
    expect(s).toMatchObject({ name: 'Crypt', kind: 'dungeon', rooms: 2, screens: 3, smallKeys: 4, lockedDoors: 2, chests: 2, bigKey: true, boss: false });
  });
});

describe('projectStats', () => {
  it('totals the whole project', () => {
    const { p } = dungeonProject();
    p.tiles.push({ ...p.tiles[0]!, id: USER_TILE_BASE, key: 'MINE' });
    p.dialogues.push({ id: 'd1', name: 'Hi', pages: [{ text: 'a' }, { text: 'b' }] });
    const s = projectStats(p);
    expect(s.worlds).toBe(2);
    expect(s.rooms).toBe(3);
    expect(s.screens).toBe(4);
    expect(s.entities).toBe(7);
    expect(s.objects).toBe(7);
    expect(s.triggers).toBe(1);
    expect(s.dialogues).toBe(1);
    expect(s.dialoguePages).toBe(2);
    expect(s.customTiles).toBe(1);
  });
});

describe('problems', () => {
  it('groups by severity keeping order', () => {
    const list: Problem[] = [
      { level: 'warning', message: 'w1' }, { level: 'error', message: 'e1' }, { level: 'warning', message: 'w2' },
    ];
    const g = groupProblems(list);
    expect(g.errors.map((x) => x.message)).toEqual(['e1']);
    expect(g.warnings.map((x) => x.message)).toEqual(['w1', 'w2']);
  });

  it('caps the rows a report group lists and counts the rest', () => {
    const many = Array.from({ length: 5003 }, (_, i) => i);
    const { shown, more } = capRows(many);
    expect(shown).toHaveLength(MAX_PROBLEM_ROWS);
    expect(shown[0]).toBe(0);
    expect(more).toBe(5003 - MAX_PROBLEM_ROWS);
    expect(capRows([1, 2, 3], 5)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capRows([1, 2, 3], 2)).toEqual({ shown: [1, 2], more: 1 });
  });

  it('resolves where a problem points to', () => {
    const { p, room } = dungeonProject();
    const e = room.entities[0]!;
    expect(problemTarget(p, { level: 'error', message: '' })).toBeNull();
    expect(problemTarget(p, { level: 'error', message: '', where: { entity: e.id } })).toEqual({ tab: 'map', world: 'dng', room: 'r1', entity: e.id });
    expect(problemTarget(p, { level: 'error', message: '', where: { room: 'r2' } })).toEqual({ tab: 'map', world: 'dng', room: 'r2' });
    expect(problemTarget(p, { level: 'error', message: '', where: { world: 'dng', room: 'r2', trigger: 't1' } }))
      .toEqual({ tab: 'map', world: 'dng', room: 'r2', trigger: 't1' });
    expect(problemTarget(p, { level: 'error', message: '', where: { world: 'dng' } })).toEqual({ tab: 'map', world: 'dng', room: 'r1' });
    expect(problemTarget(p, { level: 'warning', message: '', where: { dialogue: 'd9' } })).toEqual({ tab: 'dialogue', dialogue: 'd9' });
    expect(problemTarget(p, { level: 'warning', message: '', where: { tile: 5 } })).toEqual({ tab: 'art', tile: 5 });
    expect(problemTarget(p, { level: 'warning', message: '', where: { palette: 'x' } })).toEqual({ tab: 'art' });
    expect(problemTarget(p, { level: 'warning', message: '', where: { entity: 'missing' } })).toBeNull();
  });

  it('points start-location problems at the Start location panel', () => {
    const { p } = dungeonProject();
    p.start = { world: 'dng', room: 'gone', x: 10, y: 10 };
    const starts = validateProject(p).filter((x) => /start location/i.test(x.message));
    expect(starts.length).toBeGreaterThan(0);
    for (const x of starts) expect(problemTarget(p, x)).toEqual({ tab: 'project', section: 'start' });
    p.start = { world: 'nowhere', room: 'r1', x: 10, y: 10 };
    const noWorld = validateProject(p).find((x) => /start location/i.test(x.message));
    expect(noWorld && problemTarget(p, noWorld)).toEqual({ tab: 'project', section: 'start' });
  });
});

describe('createEnv commit', () => {
  it('applies one undoable settings change and skips no-ops', () => {
    const p = createBlankProject('Env');
    const changes: ProjectChange[] = [];
    const undo = new UndoStack();
    const ctx = { project: p, undo, changed: (what: ProjectChange) => changes.push(what) } as unknown as EditorContext;
    const env = createEnv(ctx);
    const get = (): number => p.settings.startHearts;
    const set = (v: number): void => { p.settings.startHearts = v; };
    env.commit('Hearts', get, set, 3);
    expect(undo.canUndo()).toBe(false);
    env.commit('Hearts', get, set, 7);
    expect(p.settings.startHearts).toBe(7);
    expect(changes).toEqual(['settings']);
    undo.undo();
    expect(p.settings.startHearts).toBe(3);
    undo.redo();
    expect(p.settings.startHearts).toBe(7);
    const items = { bow: 1 };
    env.commit('Items', () => p.settings.startItems, (v) => { p.settings.startItems = v; }, items);
    items.bow = 5;
    expect(p.settings.startItems).toEqual({ bow: 1 });
  });
});

describe('format', () => {
  it('pluralises', () => {
    expect(plural(1, 'room')).toBe('1 room');
    expect(plural(3, 'room')).toBe('3 rooms');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });

  it('formats relative times', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(relativeTime(0, now)).toBe('never');
    expect(relativeTime(now - 40 * 86_400_000, now)).toMatch(/\d/);
  });

  it('shortens long names for one-line messages', () => {
    expect(shortName('Short Quest')).toBe('Short Quest');
    expect(shortName('A'.repeat(32))).toBe('A'.repeat(32));
    expect(shortName('A'.repeat(60))).toBe(`${'A'.repeat(31)}…`);
    expect(shortName('The Long Tale of Things', 10)).toBe('The Long…');
    expect([...shortName('🗡'.repeat(40))]).toHaveLength(32);
  });

  it('picks names no stored project uses', () => {
    expect(uniqueName('My Adventure', [])).toBe('My Adventure');
    expect(uniqueName('My Adventure', ['My Adventure'])).toBe('My Adventure 2');
    expect(uniqueName('My Adventure', ['My Adventure', 'My Adventure 2'])).toBe('My Adventure 3');
    expect(uniqueName('Quest', ['Other'], 'imported')).toBe('Quest');
    expect(uniqueName('Quest', ['Quest'], 'imported')).toBe('Quest (imported)');
    expect(uniqueName('Quest', ['Quest', 'Quest (imported)'], 'imported')).toBe('Quest (imported 2)');
    expect(uniqueName('Quest', ['Quest', 'Quest (copy)', 'Quest (copy 2)'], 'copy')).toBe('Quest (copy 3)');
  });
});

describe('parseRoute', () => {
  it('parses the documented routes', () => {
    expect(parseRoute('').view).toBe('menu');
    expect(parseRoute('#/').view).toBe('menu');
    expect(parseRoute('#/play/sample')).toMatchObject({ view: 'play', id: 'sample' });
    expect(parseRoute('#/edit/p_1')).toMatchObject({ view: 'edit', id: 'p_1' });
    const pt = parseRoute('#/playtest/test?w=a&r=b&x=10&y=20');
    expect(pt).toMatchObject({ view: 'playtest', id: 'test' });
    expect(pt.params.get('x')).toBe('10');
    expect(parseRoute('#/gallery').view).toBe('gallery');
  });

  it('reports unknown paths as notFound', () => {
    expect(parseRoute('#/nowhere/else')).toMatchObject({ view: 'notFound', path: '/nowhere/else' });
  });

  it('treats a broken percent-escape as notFound instead of throwing', () => {
    expect(parseRoute('#/edit/%')).toMatchObject({ view: 'notFound', path: '/edit/%' });
    expect(parseRoute('#/edit/%E0%A4%A')).toMatchObject({ view: 'notFound', path: '/edit/%E0%A4%A' });
    expect(parseRoute('#/playtest/%zz?w=a').view).toBe('notFound');
    expect(parseRoute('#/play/My%20Game')).toMatchObject({ view: 'play', id: 'My Game' });
  });
});
