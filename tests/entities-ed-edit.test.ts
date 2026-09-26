// Entity/trigger/dialogue editors: undoable edits (edit.ts). Multi-part
// commits must be one undo step, restore in place and round-trip to the exact JSON.
import { describe, expect, it } from 'vitest';
import type { EditorContext } from '../src/editor/context';
import type { EntityInstance, Project } from '../src/core/types';
import { createBlankProject } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { UndoStack } from '../src/editor/undo';
import {
  allRoomRefsPart, commit, dialoguesPart, entityPart, flagsPart, roomEntitiesPart, settingsPart, triggerPart,
} from '../src/editor/entities/edit';
import { clearDialogueRefs, renameFlag } from '../src/editor/entities/refs';

function ent(id: string, type: string, props: EntityInstance['props'] = {}): EntityInstance {
  return { id, type, x: 40, y: 40, props: { ...defaultProps(type), ...props } };
}

/** Exact JSON: undo must restore values and key order (exports stay byte-identical). */
const json = (v: unknown): string => JSON.stringify(v);

function setup(): { p: Project; ctx: EditorContext; undo: UndoStack; worldId: string; roomId: string } {
  const p = createBlankProject('Edits');
  const world = p.worlds[0]!;
  const room = world.rooms[0]!;
  p.dialogues.push({ id: 'd_hi', name: 'Greeting', pages: [{ text: 'Hi', choice: { options: ['Yes', 'No'], flag: 'met' } }] });
  p.flags.push({ name: 'met' });
  p.settings.introDialogue = 'd_hi';
  room.entities.push(ent('e_mira', 'npc.person', { name: 'Mira', dialogue: 'd_hi' }), ent('e_sign', 'obj.sign'));
  room.triggers.push({
    id: 't_1', name: 'Talk', on: 'talk', source: 'e_mira', once: true,
    conditions: [{ kind: 'flag', flag: 'met', value: false }],
    actions: [{ kind: 'dialogue', dialogue: 'd_hi' }, { kind: 'setFlag', flag: 'met', value: true }],
  });
  const undo = new UndoStack();
  const ctx = { project: p, undo } as unknown as EditorContext;
  return { p, ctx, undo, worldId: world.id, roomId: room.id };
}

describe('undoable edits', () => {
  it('records an entity edit plus a created dialogue as one step and keeps the instance object', () => {
    const { p, ctx, undo, worldId, roomId } = setup();
    const room = p.worlds[0]!.rooms[0]!;
    const sign = room.entities[1]!;
    const before = json(p);
    commit(ctx, 'Set dialogue', [entityPart(ctx, worldId, roomId, 'e_sign'), dialoguesPart(ctx)], () => {
      p.dialogues.push({ id: 'd_new', name: 'Sign', pages: [{ text: '' }] });
      sign.props.dialogue = 'd_new';
    });
    const after = json(p);
    expect(undo.peekUndo()).toBe('Set dialogue');
    undo.undo();
    expect(json(p)).toBe(before);
    expect(room.entities[1]).toBe(sign);
    expect(p.dialogues.map((d) => d.id)).toEqual(['d_hi']);
    undo.redo();
    expect(json(p)).toBe(after);
    expect(room.entities[1]).toBe(sign);
    expect(sign.props.dialogue).toBe('d_new');
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(undo.canUndo()).toBe(false);
  });

  it('undoes a dialogue delete that cleared references everywhere, settings included', () => {
    const { p, ctx, undo } = setup();
    const room = p.worlds[0]!.rooms[0]!;
    const entities = room.entities;
    const triggers = room.triggers;
    const before = json(p);
    commit(ctx, 'Delete dialogue', [dialoguesPart(ctx), allRoomRefsPart(ctx), settingsPart(ctx)], () => {
      p.dialogues.splice(0, 1);
      clearDialogueRefs(p, 'd_hi');
    });
    expect(p.settings.introDialogue).toBeUndefined();
    expect(room.triggers[0]!.actions).toHaveLength(1);
    const after = json(p);
    undo.undo();
    expect(json(p)).toBe(before);
    expect(p.settings.introDialogue).toBe('d_hi');
    expect(room.entities).toBe(entities);
    expect(room.triggers).toBe(triggers);
    undo.redo();
    expect(json(p)).toBe(after);
  });

  it('undoes a flag rename across flags, triggers and dialogue choices', () => {
    const { p, ctx, undo } = setup();
    const before = json(p);
    commit(ctx, 'Rename flag', [flagsPart(ctx), allRoomRefsPart(ctx), dialoguesPart(ctx)], () => {
      expect(renameFlag(p, 'met', 'met_mira')).toBe(3);
    });
    const after = json(p);
    expect(after).not.toContain('"met"');
    undo.undo();
    expect(json(p)).toBe(before);
    undo.redo();
    expect(json(p)).toBe(after);
  });

  it('restores trigger and list edits in place and skips no-op edits', () => {
    const { p, ctx, undo, worldId, roomId } = setup();
    const room = p.worlds[0]!.rooms[0]!;
    const trigger = room.triggers[0]!;
    commit(ctx, 'Rename trigger', [triggerPart(ctx, worldId, roomId, 't_1')], () => { trigger.name = 'Chat'; });
    commit(ctx, 'Delete entity', [roomEntitiesPart(ctx, worldId, roomId)], () => { room.entities.splice(1, 1); });
    commit(ctx, 'Nothing', [roomEntitiesPart(ctx, worldId, roomId)], () => {});
    expect(undo.peekUndo()).toBe('Delete entity');
    undo.undo();
    expect(room.entities.map((e) => e.id)).toEqual(['e_mira', 'e_sign']);
    undo.undo();
    expect(room.triggers[0]).toBe(trigger);
    expect(trigger.name).toBe('Talk');
    undo.redo();
    expect(trigger.name).toBe('Chat');
  });
});
