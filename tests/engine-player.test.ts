// Hero movement rules (pure helpers) and loot rolls.
import { describe, expect, it } from 'vitest';
import type { Dir, SaveData } from '../src/core/types';
import { DIAGONAL_FACTOR, WALK_SPEED, heldDirs, nextFacing, walkVelocity } from '../src/game/player/facing';
import { NOTHING_CHANCE, randomTable, rollLoot } from '../src/game/loot';
import { Rng } from '../src/core/rng';

const none: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };

describe('nextFacing (ALttP rules)', () => {
  it('keeps facing while that direction is still held', () => {
    expect(nextFacing('up', { ...none, up: true, right: true }, { ...none, right: true })).toBe('up');
  });

  it('takes the newly pressed direction when the facing is released', () => {
    expect(nextFacing('up', { ...none, left: true, down: true }, { ...none, left: true })).toBe('left');
    expect(nextFacing('down', { ...none, right: true }, none)).toBe('right');
  });

  it('keeps facing with no input', () => {
    expect(nextFacing('left', none, none)).toBe('left');
  });

  it('heldDirs reads a dir() vector', () => {
    expect(heldDirs({ x: -1, y: 1 })).toEqual({ up: false, down: true, left: true, right: false });
  });
});

describe('walkVelocity', () => {
  it('moves 88 px/s on one axis and x0.75 per axis diagonally', () => {
    expect(walkVelocity({ x: 1, y: 0 })).toEqual({ x: WALK_SPEED, y: 0 });
    expect(walkVelocity({ x: -1, y: 1 })).toEqual({ x: -WALK_SPEED * DIAGONAL_FACTOR, y: WALK_SPEED * DIAGONAL_FACTOR });
    expect(walkVelocity({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(walkVelocity({ x: 0, y: -1 }, 50)).toEqual({ x: 0, y: -50 });
  });
});

function save(extra: Partial<SaveData> = {}): SaveData {
  return {
    version: 1, slot: 0, name: 'T', projectId: 'p', hp: 6, maxHp: 6, heartPieces: 0, magic: 0, maxMagic: 32,
    rupees: 0, bombs: 0, maxBombs: 10, arrows: 0, maxArrows: 30, items: {}, equipped: null, dungeons: {}, flags: {},
    respawn: { world: 'w', room: 'r', x: 0, y: 0 }, crystals: 0, playTime: 0, deaths: 0, created: 0, updated: 0,
    ...extra,
  };
}

describe('loot', () => {
  it('named kinds drop exactly that', () => {
    const s = save();
    expect(rollLoot('none', s)).toBeNull();
    expect(rollLoot('smallKey', s)).toEqual({ item: 'smallKey', amount: 1 });
    expect(rollLoot('rupee20', s)).toEqual({ item: 'rupees', amount: 20 });
    expect(rollLoot('bombs', s)?.item).toBe('bombs');
  });

  it('random drops nothing about 45% of the time and only offers owned ammo', () => {
    const rng = new Rng(42);
    const s = save();
    let nothing = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const d = rollLoot('random', s, rng);
      if (!d) nothing++;
      else seen.add(d.item);
    }
    expect(nothing / 4000).toBeGreaterThan(NOTHING_CHANCE - 0.04);
    expect(nothing / 4000).toBeLessThan(NOTHING_CHANCE + 0.04);
    expect([...seen].sort()).toEqual(['heart', 'rupees']);
  });

  it('favours hearts at low health and adds ammo/magic for owned gear', () => {
    const weight = (t: ReturnType<typeof randomTable>, item: string) => t.find(([d]) => d.item === item)?.[1] ?? 0;
    const low = randomTable(save({ hp: 2 }));
    const full = randomTable(save({ hp: 6 }));
    expect(weight(low, 'heart')).toBeGreaterThan(weight(full, 'heart'));
    const geared = randomTable(save({ items: { bombs: 1, bow: 1, lantern: 1 } }));
    expect(weight(geared, 'bombs')).toBeGreaterThan(0);
    expect(weight(geared, 'arrows')).toBeGreaterThan(0);
    expect(weight(geared, 'magic')).toBeGreaterThan(0);
  });
});
