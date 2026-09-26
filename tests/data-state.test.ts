// Data layer: SaveData rules (new game, items, levels, hearts, keys, crystals, taking items).
import { describe, expect, it } from 'vitest';
import type { ItemId, Project, SaveData } from '../src/core/types';
import { createBlankProject } from '../src/core/project';
import {
  applyItem, dungeonState, hasItem, healSave, itemLevel, newSave, ownedEquippables, takeItem,
} from '../src/game/state';
import { DEFAULT_MAX_ARROWS, DEFAULT_MAX_BOMBS, DEFAULT_MAX_MAGIC, MAX_RUPEES } from '../src/core/constants';

const W = 'w_dungeon';
const W2 = 'w_other';

function project(mut?: (p: Project) => void): Project {
  const p = createBlankProject('State');
  mut?.(p);
  return p;
}

function fresh(mut?: (p: Project) => void): SaveData {
  return newSave(project(mut), 0, 'Hero');
}

describe('newSave', () => {
  it('derives hearts, magic, caps, items and respawn from the project', () => {
    const p = project();
    const s = newSave(p, 2, 'Ada');
    expect(s.slot).toBe(2);
    expect(s.name).toBe('Ada');
    expect(s.projectId).toBe(p.id);
    expect([s.hp, s.maxHp]).toEqual([6, 6]);
    expect([s.magic, s.maxMagic]).toEqual([DEFAULT_MAX_MAGIC, DEFAULT_MAX_MAGIC]);
    expect([s.maxBombs, s.maxArrows]).toEqual([DEFAULT_MAX_BOMBS, DEFAULT_MAX_ARROWS]);
    expect([s.bombs, s.arrows, s.rupees]).toEqual([0, 0, 0]);
    expect(s.items).toEqual({ sword: 1, shield: 1 });
    expect(s.equipped).toBeNull();
    expect(s.respawn).toEqual(p.start);
    expect(s.respawn).not.toBe(p.start);
    expect(s.flags).toEqual({});
    expect(s.dungeons).toEqual({});
    expect([s.crystals, s.deaths, s.playTime, s.heartPieces]).toEqual([0, 0, 0, 0]);
    expect(s.created).toBeGreaterThan(0);
    expect(s.updated).toBe(s.created);
  });

  it('puts counters in counters, gear in items, and equips the first equippable', () => {
    const s = fresh((p) => {
      p.settings.startHearts = 5;
      p.settings.startItems = { sword: 2, lantern: 1, bow: 1, bombs: 50, arrows: 12, rupees: 5000, heart: 3 };
    });
    expect(s.maxHp).toBe(10);
    expect(s.bombs).toBe(DEFAULT_MAX_BOMBS);
    expect(s.arrows).toBe(12);
    expect(s.rupees).toBe(MAX_RUPEES);
    expect(s.items).toEqual({ sword: 2, lantern: 1, bow: 1, bombs: 1 });
    expect(s.equipped).toBe('bow');
  });

  it('clamps invalid starting hearts to 1..20', () => {
    expect(fresh((p) => { p.settings.startHearts = 0; }).maxHp).toBe(2);
    expect(fresh((p) => { p.settings.startHearts = 50; }).maxHp).toBe(40);
    expect(fresh((p) => { p.settings.startHearts = Number.NaN; }).maxHp).toBe(6);
  });

  it('caps start levels at the item max level', () => {
    const s = fresh((p) => { p.settings.startItems = { glove: 5, boots: 3 }; });
    expect(s.items).toEqual({ glove: 2, boots: 1 });
  });
});

describe('applyItem: gear', () => {
  it('level items step up and cap at maxLevel', () => {
    const s = fresh();
    s.items = {};
    expect(applyItem(s, W, 'sword').message).toMatch(/You got the Sword!.*Z/);
    expect(itemLevel(s, 'sword')).toBe(1);
    expect(applyItem(s, W, 'sword').message).toMatch(/Sword/);
    expect(itemLevel(s, 'sword')).toBe(2);
    applyItem(s, W, 'sword');
    expect(itemLevel(s, 'sword')).toBe(2);
  });

  it('says so when the item is already owned at that level', () => {
    const s = fresh();
    expect(applyItem(s, W, 'sword', 1).message).toBe('You already have the Sword.');
    expect(applyItem(s, W, 'sword').message).toMatch(/glows with new power/);
    expect(applyItem(s, W, 'sword').message).toBe('You already have the Sword.');
    expect(itemLevel(s, 'sword')).toBe(2);
    expect(applyItem(s, W, 'shield').message).toBe('You already have the Shield.');
    expect(applyItem(s, W, 'bow').message).toMatch(/You got the Bow!/);
    expect(applyItem(s, W, 'bow').message).toBe('You already have the Bow.');
  });

  it('an amount of 0 steps a level item up, like omitting it', () => {
    const s = fresh();
    applyItem(s, W, 'glove', 0);
    expect(itemLevel(s, 'glove')).toBe(1);
    applyItem(s, W, 'glove', 0);
    expect(itemLevel(s, 'glove')).toBe(2);
  });

  it('explicit level never downgrades', () => {
    const s = fresh();
    applyItem(s, W, 'glove', 2);
    expect(itemLevel(s, 'glove')).toBe(2);
    applyItem(s, W, 'glove', 1);
    expect(itemLevel(s, 'glove')).toBe(2);
    applyItem(s, W, 'boomerang', 1);
    expect(itemLevel(s, 'boomerang')).toBe(1);
    applyItem(s, W, 'boomerang', 7);
    expect(itemLevel(s, 'boomerang')).toBe(2);
  });

  it('one-level gear is set to 1', () => {
    const s = fresh();
    for (const item of ['shield', 'bow', 'hookshot', 'lantern', 'boots', 'flippers'] as const) {
      applyItem(s, W, item, 3);
      expect(itemLevel(s, item)).toBe(1);
    }
  });

  it('gives friendly messages with control hints', () => {
    const s = fresh();
    expect(applyItem(s, W, 'bow').message).toBe('You got the Bow! Select it in the menu (Enter) and press C to shoot.');
    expect(applyItem(s, W, 'boots').message).toMatch(/Dash Boots.*X/);
    expect(applyItem(s, W, 'glove').message).toMatch(/Stone Gauntlet.*X/);
    expect(applyItem(s, W, 'hookshot').message).toMatch(/Grapple Claw.*C/);
  });

  it('equips the first equippable only when nothing is equipped', () => {
    const s = fresh();
    applyItem(s, W, 'boots');
    expect(s.equipped).toBeNull();
    applyItem(s, W, 'hookshot');
    expect(s.equipped).toBe('hookshot');
    applyItem(s, W, 'bow');
    expect(s.equipped).toBe('hookshot');
    expect(ownedEquippables(s)).toEqual(['bow', 'hookshot']);
  });
});

describe('applyItem: counters', () => {
  it('bombs default to 5, own the bag, cap at maxBombs, equip', () => {
    const s = fresh();
    expect(applyItem(s, W, 'bombs').message).toBe('You got 5 Bombs! Select them in the menu (Enter) and press C to place one.');
    expect(s.bombs).toBe(5);
    expect(s.items.bombs).toBe(1);
    expect(s.equipped).toBe('bombs');
    expect(applyItem(s, W, 'bombs', 1).message).toBe('You got a Bomb!');
    applyItem(s, W, 'bombs', 99);
    expect(s.bombs).toBe(DEFAULT_MAX_BOMBS);
  });

  it('arrows default to 10 and cap', () => {
    const s = fresh();
    expect(applyItem(s, W, 'arrows').message).toBe('You got 10 Arrows!');
    applyItem(s, W, 'arrows', 100);
    expect(s.arrows).toBe(DEFAULT_MAX_ARROWS);
  });

  it('rupees add and cap at MAX_RUPEES', () => {
    const s = fresh();
    expect(applyItem(s, W, 'rupees', 20).message).toBe('You got 20 Gems!');
    expect(applyItem(s, W, 'rupees', 1).message).toBe('You got a Gem!');
    expect(s.rupees).toBe(21);
    applyItem(s, W, 'rupees', 5000);
    expect(s.rupees).toBe(MAX_RUPEES);
  });

  it('an explicit 0 gives nothing; negative or invalid amounts use the default', () => {
    const s = fresh();
    applyItem(s, W, 'rupees', 0);
    applyItem(s, W, 'arrows', 0);
    applyItem(s, W, 'smallKey', 0);
    expect([s.rupees, s.arrows, dungeonState(s, W).keys]).toEqual([0, 0, 0]);
    applyItem(s, W, 'rupees', -5);
    applyItem(s, W, 'arrows', Number.NaN);
    applyItem(s, W, 'smallKey', -1);
    expect([s.rupees, s.arrows, dungeonState(s, W).keys]).toEqual([1, 10, 1]);
  });

  it('magic defaults to 16 and caps', () => {
    const s = fresh();
    s.magic = 0;
    applyItem(s, W, 'magic');
    expect(s.magic).toBe(16);
    applyItem(s, W, 'magic', 100);
    expect(s.magic).toBe(s.maxMagic);
  });
});

describe('applyItem: health', () => {
  it('hearts and fairies heal up to maxHp', () => {
    const s = fresh();
    s.hp = 1;
    expect(applyItem(s, W, 'heart').message).toMatch(/recovered a heart/);
    expect(s.hp).toBe(3);
    applyItem(s, W, 'heart', 5);
    expect(s.hp).toBe(6);
    s.maxHp = 20;
    s.hp = 2;
    applyItem(s, W, 'fairy');
    expect(s.hp).toBe(16);
    applyItem(s, W, 'fairy');
    expect(s.hp).toBe(20);
  });

  it('heart vessels add a heart, fully heal and cap at 20 hearts', () => {
    const s = fresh();
    s.hp = 1;
    expect(applyItem(s, W, 'heartContainer').message).toMatch(/Heart Vessel/);
    expect([s.hp, s.maxHp]).toEqual([8, 8]);
    s.maxHp = 39;
    applyItem(s, W, 'heartContainer');
    expect(s.maxHp).toBe(40);
    applyItem(s, W, 'heartContainer');
    expect([s.hp, s.maxHp]).toEqual([40, 40]);
  });

  it('every fourth heart piece becomes a container', () => {
    const s = fresh();
    s.hp = 2;
    expect(applyItem(s, W, 'heartPiece').message).toMatch(/3 more/);
    applyItem(s, W, 'heartPiece');
    expect(applyItem(s, W, 'heartPiece').message).toMatch(/1 more/);
    expect([s.heartPieces, s.maxHp, s.hp]).toEqual([3, 6, 2]);
    expect(applyItem(s, W, 'heartPiece').message).toMatch(/full heart/);
    expect([s.heartPieces, s.maxHp, s.hp]).toEqual([0, 8, 8]);
  });

  it('containers and pieces always count as one, whatever the amount (e.g. a chest default of 20)', () => {
    const s = fresh();
    applyItem(s, W, 'heartContainer', 20);
    expect([s.hp, s.maxHp]).toEqual([8, 8]);
    applyItem(s, W, 'heartPiece', 5);
    expect([s.heartPieces, s.maxHp]).toEqual([1, 8]);
    applyItem(s, W, 'heartPiece', 20);
    applyItem(s, W, 'heartPiece', 20);
    expect(applyItem(s, W, 'heartPiece', 20).message).toMatch(/full heart/);
    expect([s.heartPieces, s.maxHp]).toEqual([0, 10]);
  });

  it('healSave clamps to 0..maxHp', () => {
    const s = fresh();
    healSave(s, 100);
    expect(s.hp).toBe(6);
    healSave(s, -100);
    expect(s.hp).toBe(0);
  });
});

describe('applyItem: dungeon items', () => {
  it('small keys are counted per dungeon', () => {
    const s = fresh();
    expect(applyItem(s, W, 'smallKey').message).toBe('You found a Small Key!');
    expect(applyItem(s, W, 'smallKey', 2).message).toBe('You found 2 Small Keys!');
    applyItem(s, W2, 'smallKey');
    expect(dungeonState(s, W).keys).toBe(3);
    expect(dungeonState(s, W2).keys).toBe(1);
    expect(hasItem(s, W, 'smallKey', 3)).toBe(true);
    expect(hasItem(s, W2, 'smallKey', 2)).toBe(false);
    expect(hasItem(s, 'w_none', 'smallKey')).toBe(false);
    expect(s.dungeons.w_none).toBeUndefined();
  });

  it('big key / map / compass are dungeon flags', () => {
    const s = fresh();
    for (const item of ['bigKey', 'map', 'compass'] as const) {
      expect(hasItem(s, W, item)).toBe(false);
      expect(applyItem(s, W, item).message).toMatch(/You found the/);
      expect(hasItem(s, W, item)).toBe(true);
      expect(hasItem(s, W2, item)).toBe(false);
    }
    expect(dungeonState(s, W)).toMatchObject({ bigKey: true, map: true, compass: true });
  });

  it('crystals set the flag, count once and complete the dungeon', () => {
    const s = fresh();
    expect(applyItem(s, W, 'crystal').message).toMatch(/Crystal/);
    expect(s.flags['crystal:w_dungeon']).toBe(true);
    expect(s.crystals).toBe(1);
    expect(dungeonState(s, W).complete).toBe(true);
    applyItem(s, W, 'crystal');
    expect(s.crystals).toBe(1);
    applyItem(s, W2, 'crystal');
    expect(s.crystals).toBe(2);
    expect(hasItem(s, W, 'crystal')).toBe(true);
  });

  it('hasItem crystal: own world for min 1, otherwise the total count', () => {
    const s = fresh();
    expect(hasItem(s, W, 'crystal')).toBe(false);
    expect(hasItem(s, 'w_overworld', 'crystal')).toBe(false);
    applyItem(s, W, 'crystal');
    expect(hasItem(s, W, 'crystal')).toBe(true);
    expect(hasItem(s, 'w_overworld', 'crystal', 1)).toBe(true);
    expect(hasItem(s, 'w_overworld', 'crystal', 3)).toBe(false);
    applyItem(s, W2, 'crystal');
    applyItem(s, 'w_third', 'crystal');
    expect(hasItem(s, 'w_overworld', 'crystal', 3)).toBe(true);
    expect(hasItem(s, W, 'crystal', 4)).toBe(false);
  });

  it('dungeonState creates once and returns the same object', () => {
    const s = fresh();
    const d = dungeonState(s, W);
    expect(d).toEqual({ keys: 0, bigKey: false, map: false, compass: false, visited: [], complete: false });
    expect(dungeonState(s, W)).toBe(d);
  });
});

describe('hasItem', () => {
  it('uses counters, levels and min', () => {
    const s = fresh();
    expect(hasItem(s, W, 'sword')).toBe(true);
    expect(hasItem(s, W, 'sword', 2)).toBe(false);
    expect(hasItem(s, W, 'bow')).toBe(false);
    s.rupees = 30;
    expect(hasItem(s, W, 'rupees', 30)).toBe(true);
    expect(hasItem(s, W, 'rupees', 31)).toBe(false);
    expect(hasItem(s, W, 'bombs')).toBe(false);
    s.bombs = 1;
    expect(hasItem(s, W, 'bombs')).toBe(true);
    s.heartPieces = 2;
    expect(hasItem(s, W, 'heartPiece', 2)).toBe(true);
    expect(hasItem(s, W, 'magic', DEFAULT_MAX_MAGIC)).toBe(true);
  });
});

describe('unknown item ids (hand-edited projects)', () => {
  it('are ignored without changing the save', () => {
    const s = fresh();
    const before = structuredClone(s);
    const bogus = 'cape' as ItemId;
    expect(applyItem(s, W, bogus, 3)).toEqual({ message: '' });
    expect(applyItem(s, W, 'toString' as ItemId)).toEqual({ message: '' });
    expect(hasItem(s, W, bogus)).toBe(false);
    expect(takeItem(s, W, bogus, 0)).toBe(false);
    expect(s).toEqual(before);
  });
});

describe('takeItem', () => {
  it('consumes counters and keys', () => {
    const s = fresh();
    s.rupees = 50;
    s.arrows = 3;
    applyItem(s, W, 'smallKey', 2);
    expect(takeItem(s, W, 'rupees', 30)).toBe(true);
    expect(s.rupees).toBe(20);
    expect(takeItem(s, W, 'arrows')).toBe(true);
    expect(s.arrows).toBe(2);
    expect(takeItem(s, W, 'smallKey')).toBe(true);
    expect(dungeonState(s, W).keys).toBe(1);
  });

  it('fails and leaves state unchanged when there is not enough', () => {
    const s = fresh();
    s.rupees = 10;
    s.bombs = 2;
    applyItem(s, W, 'smallKey');
    const before = structuredClone(s);
    expect(takeItem(s, W, 'rupees', 11)).toBe(false);
    expect(takeItem(s, W, 'bombs', 3)).toBe(false);
    expect(takeItem(s, W, 'smallKey', 2)).toBe(false);
    expect(takeItem(s, W2, 'smallKey')).toBe(false);
    expect(takeItem(s, W, 'bigKey')).toBe(false);
    expect(takeItem(s, W, 'bow')).toBe(false);
    expect(takeItem(s, W, 'sword', 2)).toBe(false);
    expect(takeItem(s, W, 'heart')).toBe(false);
    expect(takeItem(s, W, 'crystal')).toBe(false);
    expect(s).toEqual(before);
  });

  it('an explicit 0 is a successful no-op', () => {
    const s = fresh();
    s.rupees = 10;
    const before = structuredClone(s);
    expect(takeItem(s, W, 'rupees', 0)).toBe(true);
    expect(takeItem(s, W, 'smallKey', 0)).toBe(true);
    expect(takeItem(s, W, 'sword', 0)).toBe(true);
    expect(s).toEqual(before);
    expect(takeItem(s, W, 'rupees')).toBe(true);
    expect(s.rupees).toBe(9);
  });

  it('removes gear and re-equips the next owned item', () => {
    const s = fresh();
    applyItem(s, W, 'bow');
    applyItem(s, W, 'lantern');
    expect(s.equipped).toBe('bow');
    expect(takeItem(s, W, 'bow')).toBe(true);
    expect(s.items.bow).toBeUndefined();
    expect(s.equipped).toBe('lantern');
    expect(takeItem(s, W, 'lantern')).toBe(true);
    expect(s.equipped).toBeNull();
  });

  it('takes big key / map / compass flags', () => {
    const s = fresh();
    applyItem(s, W, 'map');
    expect(takeItem(s, W, 'map')).toBe(true);
    expect(hasItem(s, W, 'map')).toBe(false);
  });

  it('bombs stay equippable while the bag is owned', () => {
    const s = fresh();
    applyItem(s, W, 'bombs', 1);
    expect(takeItem(s, W, 'bombs')).toBe(true);
    expect(s.bombs).toBe(0);
    expect(ownedEquippables(s)).toEqual(['bombs']);
    expect(hasItem(s, W, 'bombs')).toBe(false);
  });
});
