import { describe, expect, it } from 'vitest';
import type { EditorContext, ProjectChange } from '../src/editor/context';
import { createBlankProject } from '../src/core/project';
import { T } from '../src/content/ids';
import { snapHex } from '../src/gfx/palette';
import { UndoStack } from '../src/editor/undo';
import { ArtActions, numberedId, tileAsset, uniqueId } from '../src/editor/art/model';
import { from5, to5 } from '../src/editor/art/paletteEditor';
import { parseNumberEntry } from '../src/editor/art/widgets';

/** Just enough EditorContext for ArtActions: project, undo stack and a change log. */
function fakeContext() {
  const project = createBlankProject('Model');
  const undo = new UndoStack();
  const log: string[] = [];
  const ctx = {
    project, undo,
    changed: (what: ProjectChange, id?: string) => log.push(`changed:${what}:${id}`),
    assetsChanged: (kind: string, id?: string | number) => log.push(`assets:${kind}:${id}`),
  } as unknown as EditorContext;
  return { ctx, project, undo, log };
}

describe('art model: ArtActions', () => {
  it('edit records one undo step and restores the same object in place', () => {
    const { ctx, project, undo, log } = fakeContext();
    const actions = new ArtActions(ctx);
    const grass = project.tiles.find((t) => t.id === T.GRASS)!;
    actions.edit('tile', grass.id, 'Rename', (t) => { t.name = 'Lawn'; t.solidMask = 3; });
    expect(grass.name).toBe('Lawn');
    expect(log).toEqual([`changed:tiles:${grass.id}`]);
    undo.undo();
    expect(project.tiles.find((t) => t.id === T.GRASS)).toBe(grass);
    expect(grass.name).toBe('Grass');
    expect('solidMask' in grass).toBe(false);
    undo.redo();
    expect(grass.name).toBe('Lawn');
  });

  it('no-op edits record nothing; pixel edits also invalidate images', () => {
    const { ctx, project, undo, log } = fakeContext();
    const actions = new ArtActions(ctx);
    const id = project.tiles[0]!.id;
    actions.edit('tile', id, 'Nothing', () => {});
    expect(undo.canUndo()).toBe(false);
    actions.edit('tile', id, 'Palette', (t) => { t.palette = 'pal.t.meadow.x'; }, true);
    expect(log).toEqual([`changed:tiles:${id}`, `assets:tile:${id}`]);
  });

  it('setFrame is one step that only re-rasterises', () => {
    const { ctx, project, undo, log } = fakeContext();
    const actions = new ArtActions(ctx);
    const tile = project.tiles[0]!;
    const before = tile.frames[0]!;
    const after = `f${before.slice(1)}`;
    actions.setFrame(tileAsset(tile), 0, after, 'Draw');
    expect(tile.frames[0]).toBe(after);
    expect(log).toEqual([`assets:tile:${tile.id}`]);
    undo.undo();
    expect(tile.frames[0]).toBe(before);
  });

  it('setFrame runs its restore hook after undo and redo re-applied the pixels', () => {
    const { ctx, project, undo } = fakeContext();
    const actions = new ArtActions(ctx);
    const tile = project.tiles[0]!;
    const before = tile.frames[0]!;
    const after = `f${before.slice(1)}`;
    const seen: string[] = [];
    actions.setFrame(tileAsset(tile), 0, after, 'Move selection', {
      undo: () => seen.push(`undo:${tile.frames[0] === before}`),
      redo: () => seen.push(`redo:${tile.frames[0] === after}`),
    });
    expect(seen).toEqual([]);
    undo.undo();
    undo.redo();
    expect(seen).toEqual(['undo:true', 'redo:true']);
  });

  it('live edits commit as a single undo step', () => {
    const { ctx, project, undo } = fakeContext();
    const actions = new ArtActions(ctx);
    const pal = project.palettes[0]!;
    const original = pal.colors[3];
    const snap = actions.snapshot('palette', pal.id)!;
    for (const c of ['#101010', '#202020', '#303030']) {
      pal.colors[3] = c;
      actions.live('palette', pal.id);
    }
    expect(undo.canUndo()).toBe(false);
    actions.commitSince('palette', pal.id, snap, 'Colour', true);
    undo.undo();
    expect(pal.colors[3]).toBe(original);
    expect(undo.canUndo()).toBe(false);
  });

  it('group merges several actions into one undo step', () => {
    const { ctx, project, undo } = fakeContext();
    const actions = new ArtActions(ctx);
    const tile = project.tiles[0]!;
    actions.group('Duplicate palette', () => {
      actions.add('palette', { id: 'pal.x', name: 'X', colors: [] }, 'Add');
      actions.edit('tile', tile.id, 'Assign', (t) => { t.palette = 'pal.x'; }, true);
    });
    expect(undo.peekUndo()).toBe('Duplicate palette');
    undo.undo();
    expect(project.palettes.some((p) => p.id === 'pal.x')).toBe(false);
    expect(tile.palette).not.toBe('pal.x');
    undo.redo();
    expect(tile.palette).toBe('pal.x');
    expect(project.palettes.some((p) => p.id === 'pal.x')).toBe(true);
  });

  it('remove restores the asset at its old position on undo', () => {
    const { ctx, project, undo } = fakeContext();
    const actions = new ArtActions(ctx);
    const second = project.sprites[1]!;
    actions.remove('sprite', second.id, 'Delete');
    expect(project.sprites.some((s) => s.id === second.id)).toBe(false);
    undo.undo();
    expect(project.sprites[1]!.id).toBe(second.id);
  });
});

describe('art widgets: number entries', () => {
  const size = { min: 4, max: 64, integer: true };

  it('rejects empty and unparsable text instead of treating it as 0', () => {
    expect(parseNumberEntry('', size)).toBeNull();
    expect(parseNumberEntry('   ', size)).toBeNull();
    expect(parseNumberEntry('abc', size)).toBeNull();
    expect(parseNumberEntry('Infinity', size)).toBeNull();
  });

  it('rounds integer fields and clamps every value', () => {
    expect(parseNumberEntry('10.5', size)).toBe(11);
    expect(parseNumberEntry(' 12 ', size)).toBe(12);
    expect(parseNumberEntry('1', size)).toBe(4);
    expect(parseNumberEntry('999', size)).toBe(64);
    expect(parseNumberEntry('0.125', { min: 0.05, max: 5 })).toBe(0.125);
    expect(parseNumberEntry('0', { min: 0.05, max: 5 })).toBe(0.05);
  });
});

describe('art model: ids', () => {
  it('uniqueId appends 2, 3, ... and numberedId counts from 1', () => {
    expect(uniqueId('a.copy', new Set())).toBe('a.copy');
    expect(uniqueId('a.copy', new Set(['a.copy', 'a.copy2']))).toBe('a.copy3');
    expect(numberedId('terrain', new Set(['terrain1']))).toEqual({ id: 'terrain2', n: 2 });
  });
});

describe('art palette: SNES 5-bit channels', () => {
  it('round-trips every 5-bit level and matches snapHex', () => {
    for (let c = 0; c <= 31; c++) expect(to5(from5(c))).toBe(c);
    for (let v = 0; v <= 255; v += 5) {
      const hex = snapHex(`#${v.toString(16).padStart(2, '0').repeat(3)}`);
      const channel = parseInt(hex.slice(1, 3), 16);
      expect(from5(to5(channel))).toBe(channel);
    }
  });

  it('reads multiples-of-8 colours (the default art) at their exact level', () => {
    expect(to5(0xf8)).toBe(31);
    expect(to5(0x08)).toBe(1);
    expect(from5(31)).toBe(255);
    expect(from5(0)).toBe(0);
  });
});
