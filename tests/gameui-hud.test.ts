// HUD counters: values roll toward the save's numbers like the classic rupee
// count (never overshooting), damage shows at once while healing fills up, and
// each save keeps its own displayed values. Plus the dialogue paging rules.
import { describe, expect, it } from 'vitest';
import type { SaveData } from '../src/core/types';
import { HudCounters, hudCounters, rollToward } from '../src/game/ui/hud';
import { BOX_LINES, layoutDialogue, substituteName } from '../src/game/ui/dialogueLayout';
import { heartAnim } from '../src/game/ui/theme';

function save(over: Partial<SaveData> = {}): SaveData {
  return {
    version: 1, slot: 0, name: 'HERO', projectId: 'p', hp: 6, maxHp: 6, heartPieces: 0, magic: 32, maxMagic: 32,
    rupees: 0, bombs: 0, maxBombs: 10, arrows: 0, maxArrows: 30, items: {}, equipped: null, dungeons: {}, flags: {},
    respawn: { world: 'w', room: 'r', x: 0, y: 0 }, crystals: 0, playTime: 0, deaths: 0, created: 0, updated: 0,
    ...over,
  };
}

/** Run the counters at 60 Hz for `seconds`. */
function run(c: HudCounters, s: SaveData, from: number, seconds: number): number {
  let t = from;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += 1 / 60;
    c.update(s, t);
  }
  return t;
}

describe('rollToward', () => {
  it('moves gradually, then lands exactly on the target', () => {
    const a = rollToward(0, 100, 1 / 60, 40);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(100);
    expect(rollToward(99.5, 100, 1 / 60, 40)).toBe(100);
    expect(rollToward(10, 0, 1 / 60, 40)).toBeLessThan(10);
    expect(rollToward(5, 5, 1 / 60, 40)).toBe(5);
    expect(rollToward(5, 9, 0, 40)).toBe(5);
  });
});

describe('HudCounters', () => {
  it('rupees count up over several frames and settle on the real value', () => {
    const s = save();
    const c = new HudCounters(s);
    let t = run(c, s, 0, 0.1);
    s.rupees = 50;
    t = run(c, s, t, 0.1);
    expect(c.rupees).toBeGreaterThan(0);
    expect(c.rupees).toBeLessThan(50);
    run(c, s, t, 1.5);
    expect(c.rupees).toBe(50);
  });

  it('spending counts down and never overshoots', () => {
    const s = save({ rupees: 100 });
    const c = new HudCounters(s);
    s.rupees = 70;
    let t = 0;
    let prev = c.rupees;
    for (let i = 0; i < 90; i++) {
      t = run(c, s, t, 1 / 60);
      expect(c.rupees).toBeLessThanOrEqual(prev);
      expect(c.rupees).toBeGreaterThanOrEqual(70);
      prev = c.rupees;
    }
    expect(c.rupees).toBe(70);
  });

  it('damage shows at once, healing fills up gradually', () => {
    const s = save({ hp: 6 });
    const c = new HudCounters(s);
    let t = run(c, s, 0, 0.05);
    s.hp = 2;
    t = run(c, s, t, 1 / 60);
    expect(c.hp).toBe(2);
    s.hp = 6;
    t = run(c, s, t, 0.1);
    expect(c.hp).toBeGreaterThan(2);
    expect(c.hp).toBeLessThan(6);
    run(c, s, t, 1);
    expect(c.hp).toBe(6);
  });

  it('a long frame gap advances by a bounded step', () => {
    const s = save();
    const c = new HudCounters(s);
    c.update(s, 1);
    s.rupees = 999;
    c.update(s, 60);
    expect(c.rupees).toBeLessThan(999);
  });

  it('keeps displayed values per save object', () => {
    const a = save({ rupees: 10 });
    const b = save({ rupees: 300 });
    expect(hudCounters(a)).toBe(hudCounters(a));
    expect(hudCounters(a).rupees).toBe(10);
    expect(hudCounters(b).rupees).toBe(300);
  });
});

describe('heartAnim', () => {
  it('maps half-hearts to full / half / empty icons', () => {
    expect([0, 1, 2].map((i) => heartAnim(3, i))).toEqual(['heart_full', 'heart_half', 'heart_empty']);
  });
});

describe('dialogue layout', () => {
  it('substitutes {name} and splits long pages into boxes of 3 lines', () => {
    expect(substituteName('Hi {name}, {name}!', 'ANA')).toBe('Hi ANA, ANA!');
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const boxes = layoutDialogue([{ text: long, speaker: 'Elder' }], 'X');
    expect(boxes.length).toBeGreaterThan(1);
    for (const b of boxes) {
      expect(b.lines.length).toBeLessThanOrEqual(BOX_LINES);
      expect(b.speaker).toBe('Elder');
    }
    expect(boxes.flatMap((b) => b.lines).join(' ')).toBe(long);
  });

  it('keeps choice options with the end of their question', () => {
    const boxes = layoutDialogue([{ text: 'Will you help?', choice: { options: ['Yes', 'No'] } }], 'X');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.lines).toEqual(['Will you help?']);
    expect(boxes[0]!.options).toEqual(['Yes', 'No']);
  });

  it('a 3-option choice keeps the last question line in its box', () => {
    const boxes = layoutDialogue([{ text: 'Which path?', choice: { options: ['North', 'East', 'West'] } }], 'X');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.lines).toEqual(['Which path?']);
    expect(boxes[0]!.options).toHaveLength(3);
  });

  it('honours forced line breaks and drops empty pages', () => {
    const boxes = layoutDialogue([{ text: 'one\ntwo' }, { text: '   ' }], 'X');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.lines).toEqual(['one', 'two']);
  });
});
