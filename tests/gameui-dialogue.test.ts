// DialogueBox driven tick by tick with a fake pad: typewriter timing and blips,
// paging, choices (cursor + confirm resolves the index, no input right as they
// appear), the onChoice hook and queued dialogues.
import { describe, expect, it } from 'vitest';
import type { AudioApi, Button, InputState } from '../src/game/api';
import type { DialoguePage, Project, SfxId } from '../src/core/types';
import type { Vec } from '../src/core/math';
import { CHOICE_DELAY, DialogueBox } from '../src/game/ui/dialogueBox';

const STEP = 1 / 60;

class Pad implements InputState {
  down = new Set<Button>();
  edge = new Set<Button>();
  held(b: Button): boolean { return this.down.has(b); }
  pressed(b: Button): boolean { return this.edge.has(b); }
  released(): boolean { return false; }
  heldTime(): number { return 0; }
  dir(): Vec { return { x: 0, y: 0 }; }
  anyPressed(): boolean { return this.edge.size > 0; }
  typed(): string { return ''; }
}

function rig(): { box: DialogueBox; pad: Pad; sfx: SfxId[]; tick: (seconds: number) => void; press: (b: Button) => void } {
  const sfx: SfxId[] = [];
  const audio = { sfx: (id: SfxId) => sfx.push(id) } as unknown as AudioApi;
  const box = new DialogueBox({} as Project, audio);
  const pad = new Pad();
  const tick = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) box.update(STEP, pad);
  };
  const press = (b: Button): void => {
    pad.edge.add(b);
    box.update(STEP, pad);
    pad.edge.clear();
  };
  return { box, pad, sfx, tick, press };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('DialogueBox', () => {
  it('types at ~40 chars/s with blips, then pages and closes', async () => {
    const r = rig();
    let result: number | undefined;
    void r.box.open([{ text: 'Hello there, {name}.' }, { text: 'Bye.' }], { name: 'Kai' }).then((n) => { result = n; });
    expect(r.box.active).toBe(true);
    r.press('a');
    r.tick(0.3);
    expect(r.sfx.filter((s) => s === 'text').length).toBeGreaterThan(2);
    r.tick(1);
    r.press('a');
    r.tick(0.5);
    r.press('a');
    await flush();
    expect(r.box.active).toBe(false);
    expect(result).toBe(-1);
  });

  it('holding a button speeds the text up', () => {
    const slow = rig();
    const fast = rig();
    const text = 'A fairly long sentence that takes a while to appear on screen.';
    void slow.box.open([{ text }]);
    void fast.box.open([{ text }]);
    fast.pad.down.add('b');
    slow.tick(0.5);
    fast.tick(0.5);
    expect(fast.sfx.length).toBeGreaterThan(slow.sfx.length);
  });

  it('choices move with up/down and resolve with the chosen index', async () => {
    const r = rig();
    const chosen: [DialoguePage, number][] = [];
    let result: number | undefined;
    const page: DialoguePage = { text: 'Ready?', choice: { options: ['Yes', 'No'], flag: 'ready' } };
    void r.box.open([page], { onChoice: (p, i) => chosen.push([p, i]) }).then((n) => { result = n; });
    r.tick(1);
    r.press('down');
    r.press('down');
    r.press('up');
    expect(r.sfx.filter((s) => s === 'menuMove')).toHaveLength(3);
    r.press('a');
    await flush();
    expect(result).toBe(1);
    expect(chosen).toEqual([[page, 1]]);
    expect(r.sfx).toContain('menuSelect');
  });

  it('choice options ignore buttons mashed right as they appear', async () => {
    const r = rig();
    let result: number | undefined;
    void r.box.open([{ text: 'Go?', choice: { options: ['Sure', 'No'] } }]).then((n) => { result = n; });
    r.tick(0.2);
    r.press('a');
    r.press('down');
    await flush();
    expect(result).toBeUndefined();
    expect(r.box.active).toBe(true);
    r.tick(CHOICE_DELAY);
    r.press('a');
    await flush();
    expect(result).toBe(0);
  });

  it('queues a second dialogue behind the first', async () => {
    const r = rig();
    const done: string[] = [];
    void r.box.open([{ text: 'One.' }]).then(() => done.push('one'));
    void r.box.open([{ text: 'Two.' }]).then(() => done.push('two'));
    r.tick(1);
    r.press('a');
    await flush();
    expect(done).toEqual(['one']);
    expect(r.box.active).toBe(true);
    r.tick(1);
    r.press('a');
    await flush();
    expect(done).toEqual(['one', 'two']);
  });

  it('three options share the box with the question', async () => {
    const r = rig();
    let result: number | undefined;
    void r.box.open([{ text: 'Pick one.', choice: { options: ['A', 'B', 'C'] } }]).then((n) => { result = n; });
    r.tick(1);
    r.press('up');
    r.press('a');
    await flush();
    expect(result).toBe(2);
  });

  it('pages without text or choice resolve at once', async () => {
    const r = rig();
    expect(await r.box.open([{ text: '  ' }])).toBe(-1);
    expect(r.box.active).toBe(false);
  });
});
