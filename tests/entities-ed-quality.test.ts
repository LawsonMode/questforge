// Entity editor quality-pass regressions: a duplicated door starts unlinked,
// a small-key door sharing its link with more than its partner is flagged, and
// the validation "Go" for a missing intro dialogue points at the Project tab.
import { describe, expect, it } from 'vitest';
import type { EntityInstance } from '../src/core/types';
import { createBlankProject, createRoom } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { validateProject } from '../src/core/validate';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { duplicateInstance } from '../src/editor/entities/edit';
import { entityWarnings } from '../src/editor/entities/warnings';
import { problemTarget } from '../src/editor/project/stats';

function door(id: string, props: EntityInstance['props'], x: number, y: number): EntityInstance {
  return { id, type: 'obj.door', x, y, props: { ...defaultProps('obj.door'), ...props } };
}

describe('duplicated doors', () => {
  it('get a fresh id and no link; other entities keep their props', () => {
    const src = door('e_d', { kind: 'locked', link: 'hall-east', dir: 'right' }, 248, 112);
    const copy = duplicateInstance(src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.props).toMatchObject({ kind: 'locked', link: '', dir: 'right' });
    expect(src.props.link).toBe('hall-east');
    const sign = duplicateInstance({ id: 'e_s', type: 'obj.sign', x: 8, y: 8, props: { text: 'Hi' } });
    expect(sign.props).toEqual({ text: 'Hi' });
  });

  it('the sample Guard Hall door copied with its link is flagged; the sample itself has no such warning', () => {
    const p = createSampleProject();
    const all = p.worlds.flatMap((w) => w.rooms.flatMap((r) => r.entities.map((e) => ({ w, r, e }))));
    expect(all.filter(({ w, r, e }) => e.type === 'obj.door' && entityWarnings(p, w, r, e).some((m) => m.startsWith('Shares link'))), 'sample doors').toEqual([]);
    const original = all.find(({ e }) => e.id === 'kp_g1_door_e');
    expect(original).toBeDefined();
    const { w, r, e } = original!;
    const clone: EntityInstance = { ...structuredClone(e), id: 'e_clone', x: e.x - 16 }; // the old Ctrl+D result
    r.entities.push(clone);
    expect(entityWarnings(p, w, r, clone).some((m) => /Shares link .* one small key opens all of them/.test(m))).toBe(true);
    expect(entityWarnings(p, w, r, e).some((m) => m.startsWith('Shares link'))).toBe(true);
  });

  it('two linked shutters in one room are fine (only small-key doors are flagged)', () => {
    const p = createBlankProject('T');
    const world = p.worlds[0]!;
    const room = createRoom({ name: 'Hall', gx: 0, gy: 0 });
    world.rooms.splice(0, world.rooms.length, room);
    const a = door('e_a', { kind: 'shutter', link: 'pair', opensWhen: 'enemiesCleared' }, 128, 8);
    const b = door('e_b', { kind: 'shutter', link: 'pair', opensWhen: 'enemiesCleared', dir: 'down' }, 128, 216);
    room.entities.push(a, b);
    expect(entityWarnings(p, world, room, a).filter((m) => m.startsWith('Shares link'))).toEqual([]);
  });
});

describe('validation jump for a missing intro dialogue', () => {
  it('goes to the Project tab intro setting, not an empty Dialogue tab', () => {
    const p = createBlankProject('T');
    p.settings.introDialogue = 'd_gone';
    const problem = validateProject(p).find((x) => /Intro dialogue/.test(x.message));
    expect(problem).toBeDefined();
    expect(problemTarget(p, problem!)).toEqual({ tab: 'project', section: 'intro' });
    // A dialogue problem elsewhere still opens the dialogue.
    p.dialogues.push({ id: 'd_here', name: 'Here', pages: [{ text: '' }] });
    expect(problemTarget(p, { level: 'warning', message: '', where: { dialogue: 'd_here' } })).toEqual({ tab: 'dialogue', dialogue: 'd_here' });
  });
});
