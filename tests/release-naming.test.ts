// Release checks on player- and builder-facing text: every visible string uses
// Questforge's own item names (the ITEM_INFO display names), never the names of
// the game that inspired it. Internal ids ('rupees', 'hookshot', 'glove', ...)
// are baked into saved projects and stay as they are.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ITEM_INFO, SPRITE_SPECS } from '../src/content/ids';
import { applyItem, newSave } from '../src/game/state';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { enumLabel } from '../src/editor/entities/labels';
import { NOT_ENOUGH_RUPEES } from '../src/game/entities/objects/shopItem';

const SRC = join(__dirname, '..', 'src');
const OLD_NAMES = /\brupees?\b|hookshot|power glove|heart containers?|pieces? of heart|- LIFE -/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|html|css)$/.test(name)) out.push(path);
  }
  return out;
}

/** Quoted string / template literal bodies on one line (good enough for a lint-style scan). */
function literals(line: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  // Interpolations (`${ITEM_INFO.rupees.name}`) resolve to the display names and are not text.
  for (let m = re.exec(line); m; m = re.exec(line)) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ''));
  return out;
}

describe('original naming', () => {
  it('no visible string literal in src uses the old item names (ids excepted)', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import\s/.test(line)) return;
        for (const lit of literals(line)) {
          // Bare identifiers / ids / paths are internal ('rupees', 'proj.hookshot', '../projectiles/hookshot').
          if (/^[\w./-]*$/.test(lit)) continue;
          if (OLD_NAMES.test(lit)) hits.push(`${relative(SRC, file)}:${i + 1}: ${lit}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('item display names are the original ones', () => {
    expect(ITEM_INFO.hookshot.name).toBe('Grapple Claw');
    expect(ITEM_INFO.glove.name).toBe('Stone Gauntlet');
    expect(ITEM_INFO.rupees.name).toBe('Gems');
    expect(ITEM_INFO.heartContainer.name).toBe('Heart Vessel');
    expect(ITEM_INFO.heartPiece.name).toBe('Heart Shard');
    expect(SPRITE_SPECS.find((s) => s.id === 'proj.hookshot')?.name).toBe('Grapple Claw');
  });

  it('item-get messages, the shop refusal and the loot labels agree with them', () => {
    const p = createSampleProject();
    const save = newSave(p, 0, 'Hero');
    const world = p.worlds[0]!.id;
    expect(applyItem(save, world, 'rupees', 5).message).toBe('You got 5 Gems!');
    expect(applyItem(save, world, 'hookshot', 1).message).toContain('Grapple Claw');
    expect(applyItem(save, world, 'glove', 1).message).toContain('Stone Gauntlet');
    expect(applyItem(save, world, 'heartContainer', 1).message).toContain('Heart Vessel');
    expect(applyItem(save, world, 'heartPiece', 1).message).toContain('Heart Shard');
    expect(NOT_ENOUGH_RUPEES).toBe("You don't have enough Gems.");
    expect(['rupee', 'rupee5', 'rupee20'].map(enumLabel)).toEqual(['Gem', '5 Gems', '20 Gems']);
  });
});
