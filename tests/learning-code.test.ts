// Learning layer: triggers as code, and images as bits.
import { describe, expect, it } from 'vitest';
import type { EntityInstance, Project, Room, Trigger } from '../src/core/types';
import { cloneProject, createBlankProject } from '../src/core/project';
import { defaultProps } from '../src/core/catalog';
import { tokenizeCode, triggerCode, triggerCodeLines } from '../src/editor/entities/triggerCode';
import { bits, colourBits, frameSize, hexRows } from '../src/learning/pixelBits';
import { createSampleProject } from '../src/content/sample/sampleProject';

const BASE = createBlankProject('Code');

function ent(id: string, type: string, props: EntityInstance['props'] = {}): EntityInstance {
  return { id, type, x: 40, y: 40, props: { ...defaultProps(type), ...props } };
}

function fixture(): { p: Project; room: Room } {
  const p = cloneProject(BASE);
  const room = p.worlds[0]!.rooms[0]!;
  room.entities.push(ent('e_sw', 'obj.switch'), ent('e_door', 'obj.door'), ent('e_mira', 'npc.person', { name: 'Mira' }));
  p.dialogues.push({ id: 'd_hi', name: 'Greeting', pages: [{ text: 'Hi!' }] });
  return { p, room };
}

function trig(extra: Partial<Trigger>): Trigger {
  return { id: 't_1', name: 'Open the gate', on: 'enter', conditions: [], actions: [], once: true, ...extra };
}

describe('trigger as code', () => {
  it('writes event, condition and ordered actions as pseudocode', () => {
    const { p, room } = fixture();
    const t = trig({
      conditions: [{ kind: 'switch', target: 'e_sw', on: true }, { kind: 'flag', flag: 'gotKey', value: false }],
      actions: [{ kind: 'openDoor', target: 'e_door' }, { kind: 'wait', seconds: 1 }, { kind: 'secret' }],
    });
    expect(triggerCodeLines(p, room, t)).toEqual([
      '# Open the gate (runs once per save file)',
      'when room.enter:',
      '    if switch_on("e_sw") and not flag("gotKey"):',
      '        open_door("e_door")  # Door (e_door)',
      '        wait(1)  # seconds; the next line waits too',
      '        play_secret()',
    ]);
  });

  it('auto triggers fire when their conditions become true; talk names the person', () => {
    const { p, room } = fixture();
    expect(triggerCode(p, room, trig({ on: 'auto', conditions: [{ kind: 'enemiesCleared' }], actions: [{ kind: 'secret' }] }), false))
      .toBe('when becomes_true(enemies_defeated()):\n    play_secret()');
    expect(triggerCode(p, room, trig({ on: 'auto', once: false }), false)).toBe('when room.start:\n    pass  # no actions yet');
    expect(triggerCodeLines(p, room, trig({ on: 'talk', source: 'e_mira', actions: [{ kind: 'dialogue', dialogue: 'd_hi' }] }), false))
      .toEqual(['when talk_to("e_mira"):  # Person “Mira” (e_mira)', '    say("Greeting")']);
  });

  it('uses the Questforge item names, never internal ids', () => {
    const { p, room } = fixture();
    const code = triggerCode(p, room, trig({
      conditions: [{ kind: 'hasItem', item: 'rupees', min: 20 }],
      actions: [{ kind: 'giveItem', item: 'hookshot', amount: 1 }],
    }));
    expect(code).toContain('count("Gems") >= 20');
    expect(code).toContain('give("Grapple Claw", 1)');
    expect(code).not.toMatch(/rupees|hookshot/);
  });

  it('renders every sample trigger, and tokens rebuild each line', () => {
    const p = createSampleProject();
    let n = 0;
    for (const w of p.worlds) for (const r of w.rooms) for (const t of r.triggers) {
      for (const line of triggerCodeLines(p, r, t)) {
        expect(tokenizeCode(line).map((x) => x.text).join('')).toBe(line);
        expect(line).not.toMatch(/unknown/);
      }
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });

  it('highlights keywords, calls, strings, numbers and comments', () => {
    const kinds = tokenizeCode('    if has("Bow") and count("Gems") >= 20:  # note').filter((t) => t.kind !== 'txt');
    expect(kinds.map((t) => `${t.kind}:${t.text}`)).toEqual([
      'kw:if', 'fn:has', 'str:"Bow"', 'kw:and', 'fn:count', 'str:"Gems"', 'num:20', 'com:# note',
    ]);
  });
});

describe('images as bits', () => {
  it('binary, colour channels and the 15-bit SNES colour', () => {
    expect(bits(10, 4)).toBe('1010');
    expect(bits(1, 5)).toBe('00001');
    expect(colourBits('#f8f8f8')).toEqual({ r: 31, g: 31, b: 31, bgr555: 0x7fff });
    expect(colourBits('#f80000')).toEqual({ r: 31, g: 0, b: 0, bgr555: 31 });
    expect(colourBits('#0000f8')?.bgr555).toBe(31 << 10);
    expect(colourBits('red')).toBeNull();
  });

  it('frame size at 4 bits per pixel, and hex rows', () => {
    expect(frameSize(16, 16)).toEqual({ pixels: 256, bits: 1024, bytes: 128 });
    expect(hexRows([0, 1, 10, 15, 2, 3], 3, 2)).toEqual(['01a', 'f23']);
  });
});
