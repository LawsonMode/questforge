// Learning layer: the event log, the observer's evidence and the proposed levels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityInstance, Project, Trigger } from '../src/core/types';
import type { EditorContext, EditorEvents } from '../src/editor/context';
import { Emitter } from '../src/core/events';
import { cloneProject, createBlankProject } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { proposeLevels } from '../src/learning/levels';
import { clearLearning, listLearning, makeEvent, setLearningContext, type Facts, type LearningEvent } from '../src/learning/log';
import { notePlaytest, observeEditor } from '../src/learning/editorObserver';
import { buildLearningExport } from '../src/learning/export';
import { ACTIVITIES } from '../src/learning/activities';
import { SKILLS } from '../src/learning/standards';
import type { ActivityId } from '../src/learning/activities';

let clock = Date.parse('2026-10-05T09:00:00Z');

function ev(activity: ActivityId, facts: Facts = {}, extra: { ref?: string; room?: string; project?: string } = {}): LearningEvent {
  setLearningContext({ projectId: () => extra.project ?? 'p1', projectName: () => 'Quest', mode: 'editor' });
  clock += 60_000;
  const e = makeEvent(activity, { ref: extra.ref, roomId: extra.room ?? 'r1', facts }, new Date(clock))!;
  setLearningContext(null);
  return e;
}

function built(ref: string, facts: Partial<Facts>, room = 'r1'): LearningEvent {
  return ev('qf.trigger.built', {
    on: 'auto', once: true, conditions: 0, conditionKinds: [], actions: 1, actionKinds: ['secret'],
    negated: false, blockingThenMore: false, setsFlags: [], readsFlags: [], authored: 'self', ...facts,
  } as Facts, { ref, room });
}

const level = (events: LearningEvent[], skill: string): number => proposeLevels(events).find((l) => l.skill === skill)!.level;

describe('proposed levels', () => {
  it('nothing recorded = level 0 everywhere', () => {
    expect(proposeLevels([]).map((l) => l.level)).toEqual(SKILLS.map(() => 0));
  });

  it('selection climbs 1 → 4 with the evidence that proves it', () => {
    const a = built('r1/a', { conditions: 1, conditionKinds: ['switch'] });
    expect(level([a], 'prog.selection')).toBe(1);
    const b = built('r1/b', { conditions: 1, conditionKinds: ['flag'], readsFlags: ['open'] });
    expect(level([a, b], 'prog.selection')).toBe(2);
    const c = built('r1/c', { conditions: 2, conditionKinds: ['switch', 'enemiesCleared'] });
    // Level 3 needs a playtest after the work.
    expect(level([a, b, c], 'prog.selection')).toBe(2);
    const pt = ev('qf.playtest.run');
    expect(level([a, b, c, pt], 'prog.selection')).toBe(3);
    const d = built('r1/d', { actionKinds: ['setFlag'], setsFlags: ['open'], negated: true, conditions: 1, conditionKinds: ['flag'], readsFlags: ['x'] });
    expect(level([a, b, c, pt, d], 'prog.selection')).toBe(3);
    const pt2 = ev('qf.playtest.run');
    const result = proposeLevels([a, b, c, pt, d, pt2]).find((l) => l.skill === 'prog.selection')!;
    expect(result.level).toBe(4);
    expect(result.reasons).toHaveLength(4);
    expect(result.evidence).toContain(d.id);
    expect(result.evidence).toContain(pt2.id);
  });

  it('work that came with the project counts at most as level 2', () => {
    const m = (ref: string, f: Partial<Facts>) => built(ref, { ...f, authored: 'modified' });
    const events = [
      m('r1/a', { conditions: 2, conditionKinds: ['switch', 'flag'], negated: true }),
      m('r1/b', { conditions: 1, conditionKinds: ['torchesLit'] }),
      ev('qf.playtest.run'),
    ];
    expect(level(events, 'prog.selection')).toBe(2);
  });

  it('a playtest before the work does not vouch for it', () => {
    const pt = ev('qf.playtest.run');
    const t = built('r1/a', { actions: 3, actionKinds: ['dialogue', 'openDoor'], blockingThenMore: true });
    expect(level([pt, t], 'prog.sequence')).toBe(2);
    expect(level([pt, t, ev('qf.playtest.run')], 'prog.sequence')).toBe(3);
  });

  it('levels never go down as more events arrive', () => {
    const events: LearningEvent[] = [];
    let prev = proposeLevels(events).map((l) => l.level);
    const stream = [
      built('r1/a', { conditions: 1, conditionKinds: ['switch'], actions: 2, actionKinds: ['openDoor', 'secret'] }),
      ev('qf.code.viewed', {}, { ref: 'r1/a' }),
      ev('qf.playtest.run'),
      built('r2/b', { on: 'enter', conditions: 2, conditionKinds: ['flag', 'hasItem'], readsFlags: ['k'], actions: 3, actionKinds: ['dialogue', 'giveItem', 'setFlag'], setsFlags: ['done'], blockingThenMore: true }, 'r2'),
      ev('qf.trigger.fixed', {}, { ref: 'r1/a' }),
      ev('qf.pixels.inspected'), ev('qf.pixels.drawn', { assetKind: 'tile', frames: 1, authored: 'modified' }),
      ev('qf.playtest.run'),
    ];
    for (const e of stream) {
      events.push(e);
      const now = proposeLevels(events).map((l) => l.level);
      now.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(prev[i]!));
      prev = now;
    }
  });

  it('reading code is capped at level 2 in the app', () => {
    const mine = built('r1/a', {});
    const views = ['r1/a', 'r1/b', 'r1/c', 'r1/d'].map((ref) => ev('qf.code.viewed', {}, { ref }));
    expect(level([mine, ...views], 'prog.trace')).toBe(2);
    expect(SKILLS.find((s) => s.id === 'prog.trace')!.maxLevel).toBe(2);
  });

  it('images: inspect → draw → palette → tile and sprite', () => {
    const steps = [
      ev('qf.pixels.inspected'),
      ev('qf.pixels.drawn', { assetKind: 'tile', frames: 1, authored: 'modified' }),
      ev('qf.palette.edited', { paletteId: 'pal', changed: 1 }),
      ev('qf.pixels.drawn', { assetKind: 'sprite', frames: 4, authored: 'modified' }),
    ];
    expect(steps.map((_, i) => level(steps.slice(0, i + 1), 'data.images'))).toEqual([1, 2, 3, 4]);
  });

  it('the export carries the manifest, skills, proposed levels and events', () => {
    const e = built('r1/a', {});
    const x = buildLearningExport([e], new Date('2026-10-05T12:00:00Z'));
    expect(x.schema).toBe('questforge.learning/1');
    expect(x.actor).toBeNull();
    expect(x.manifest).toBe(ACTIVITIES);
    expect(x.events).toEqual([e]);
    expect(x.proposed.find((l) => l.skill === 'prog.io')!.level).toBe(1);
    expect(JSON.parse(JSON.stringify(x)).skills).toHaveLength(SKILLS.length);
  });

  it('every activity maps to known skills and every skill has 4 level descriptors', () => {
    const ids = new Set(SKILLS.map((s) => s.id));
    for (const a of ACTIVITIES) for (const s of a.skills) expect(ids.has(s)).toBe(true);
    for (const s of SKILLS) expect(s.levels).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// The editor observer, driven through a fake EditorContext
// ---------------------------------------------------------------------------

function ent(id: string, type: string): EntityInstance {
  return { id, type, x: 40, y: 40, props: defaultProps(type) };
}

function fakeCtx(p: Project): EditorContext {
  return { project: p, bus: new Emitter<EditorEvents>() } as unknown as EditorContext;
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5000);
}

describe('editor observer', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await clearLearning();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function project(): Project {
    const p = cloneProject(createBlankProject('Obs'));
    p.worlds[0]!.rooms[0]!.entities.push(ent('e_sw', 'obj.switch'), ent('e_door', 'obj.door'));
    return p;
  }

  it('records a trigger once it works, with its code, and again only when it changes', async () => {
    const p = project();
    const ctx = fakeCtx(p);
    const stop = observeEditor(ctx);
    await settle();
    const room = p.worlds[0]!.rooms[0]!;
    const t: Trigger = { id: 't_new', name: 'Gate', on: 'auto', conditions: [], actions: [], once: true };
    room.triggers.push(t);
    ctx.bus.emit('project', { what: 'triggers' });
    await settle();
    expect(await listLearning()).toHaveLength(0); // no actions yet: not working
    t.conditions.push({ kind: 'switch', target: 'e_sw', on: true });
    t.actions.push({ kind: 'openDoor', target: 'e_door' });
    ctx.bus.emit('project', { what: 'triggers' });
    await settle();
    t.name = 'Renamed';
    ctx.bus.emit('project', { what: 'triggers' });
    await settle();
    const events = await listLearning();
    expect(events.map((e) => e.object.activity)).toEqual(['qf.trigger.built']);
    expect(events[0]!.result?.response).toContain('when becomes_true(switch_on("e_sw")):');
    expect(events[0]!.result?.facts?.authored).toBe('self');
    expect(events[0]!.context.projectId).toBe(p.id);
    stop();
  });

  it('does not credit triggers that came with the project, or unchanged copies of them', async () => {
    const p = project();
    const room = p.worlds[0]!.rooms[0]!;
    const given: Trigger = { id: 't_given', name: 'Given', on: 'auto', conditions: [{ kind: 'switch', target: 'e_sw', on: true }], actions: [{ kind: 'openDoor', target: 'e_door' }], once: true };
    room.triggers.push(given);
    const ctx = fakeCtx(p);
    const stop = observeEditor(ctx);
    await settle();
    room.triggers.push({ ...structuredClone(given), id: 't_copy', name: 'Copy' });
    ctx.bus.emit('project', { what: 'triggers' });
    await settle();
    expect(await listLearning()).toHaveLength(0);
    given.actions.push({ kind: 'secret' });
    ctx.bus.emit('project', { what: 'triggers' });
    await settle();
    const events = await listLearning();
    expect(events).toHaveLength(1);
    expect(events[0]!.result?.facts?.authored).toBe('modified');
    stop();
  });

  it('a broken trigger made to work again is a fix; a playtest records pending edits first', async () => {
    const p = project();
    const room = p.worlds[0]!.rooms[0]!;
    room.triggers.push({ id: 't_b', name: 'Broken', on: 'auto', conditions: [{ kind: 'switch', target: 'e_gone', on: true }], actions: [{ kind: 'openDoor', target: 'e_door' }], once: true });
    const ctx = fakeCtx(p);
    const stop = observeEditor(ctx);
    await settle();
    (room.triggers[0]!.conditions[0] as { target: string }).target = 'e_sw';
    ctx.bus.emit('project', { what: 'triggers' });
    notePlaytest(room.id); // before the scan delay: the fix is recorded first
    await settle();
    const acts = (await listLearning()).map((e) => e.object.activity);
    expect(acts).toEqual(['qf.trigger.fixed', 'qf.trigger.built', 'qf.playtest.run']);
    stop();
  });

  it('records pixel edits after a quiet moment, once per change', async () => {
    const p = project();
    p.tiles.push({ ...structuredClone(p.tiles[0]!), id: 1000, name: 'Mine' });
    const ctx = fakeCtx(p);
    const stop = observeEditor(ctx);
    await settle();
    const tile = p.tiles.find((t) => t.id === 1000)!;
    tile.frames[0] = '1'.repeat(256);
    ctx.bus.emit('assets', { kind: 'tile', id: 1000 });
    ctx.bus.emit('assets', { kind: 'tile', id: 1000 });
    await settle();
    ctx.bus.emit('assets', { kind: 'tile', id: 1000 }); // nothing new
    await settle();
    const events = await listLearning();
    expect(events.map((e) => e.object.activity)).toEqual(['qf.pixels.drawn']);
    expect(events[0]!.result?.facts).toMatchObject({ assetKind: 'tile', colours: 1, authored: 'modified' });
    stop();
  });
});

