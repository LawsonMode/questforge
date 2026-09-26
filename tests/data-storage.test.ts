// Data layer: persistence via the in-memory fallback (node has no IndexedDB / localStorage).
import { describe, expect, it } from 'vitest';
import { cloneProject, createBlankProject, serializeProject } from '../src/core/project';
import {
  deleteProject, deleteSave, duplicateProject, getSetting, listProjects, listSaves, loadProject, readProjectFile,
  saveProject, setSetting, storageIsPersistent, writeSave,
} from '../src/core/storage';
import { newSave } from '../src/game/state';
import { SAMPLE_PROJECT_ID, SAVE_SLOTS } from '../src/core/constants';

describe('backend', () => {
  it('reports the in-memory fallback as not persistent', async () => {
    expect(await storageIsPersistent()).toBe(false);
  });
});

describe('projects', () => {
  it('saves, lists, loads and deletes', async () => {
    const p = createBlankProject('Stored');
    p.modified = 0;
    await saveProject(p);
    expect(p.modified).toBeGreaterThan(0);
    const metas = await listProjects();
    const meta = metas.find((m) => m.id === p.id);
    expect(meta).toEqual({ id: p.id, name: 'Stored', author: 'You', created: p.created, modified: p.modified, rooms: 1 });
    const loaded = await loadProject(p.id);
    expect(loaded).toEqual(p);
    expect(loaded).not.toBe(p);
    await deleteProject(p.id);
    expect(await loadProject(p.id)).toBeNull();
    expect((await listProjects()).some((m) => m.id === p.id)).toBe(false);
  });

  it('stores a snapshot, not a live reference', async () => {
    const p = createBlankProject('Snapshot');
    await saveProject(p);
    p.name = 'Changed later';
    expect((await loadProject(p.id))?.name).toBe('Snapshot');
    await deleteProject(p.id);
  });

  it('replaces on save and lists newest first', async () => {
    const a = createBlankProject('A');
    const b = createBlankProject('B');
    await saveProject(a);
    await new Promise((r) => setTimeout(r, 5));
    await saveProject(b);
    let ids = (await listProjects()).map((m) => m.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    await new Promise((r) => setTimeout(r, 5));
    a.name = 'A2';
    await saveProject(a);
    const metas = await listProjects();
    ids = metas.map((m) => m.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(metas.filter((m) => m.id === a.id)).toHaveLength(1);
    expect(metas.find((m) => m.id === a.id)?.name).toBe('A2');
    await deleteProject(a.id);
    await deleteProject(b.id);
  });

  it('duplicates under a new id and name', async () => {
    const p = createBlankProject('Original');
    await saveProject(p);
    const copy = await duplicateProject(p, 'Copy');
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Copy');
    expect(copy.worlds).toEqual(p.worlds);
    expect((await loadProject(copy.id))?.name).toBe('Copy');
    expect((await loadProject(p.id))?.name).toBe('Original');
    await deleteProject(p.id);
    await deleteProject(copy.id);
  });

  it('refuses to store the built-in sample, but its duplicate is fine', async () => {
    const sample = createBlankProject('Sample');
    sample.id = SAMPLE_PROJECT_ID;
    await expect(saveProject(sample)).rejects.toThrow(/sample adventure cannot be saved over/);
    expect(await loadProject(SAMPLE_PROJECT_ID)).toBeNull();
    const copy = await duplicateProject(sample, 'Mine');
    expect(copy.id).not.toBe(SAMPLE_PROJECT_ID);
    expect((await loadProject(copy.id))?.name).toBe('Mine');
    await deleteProject(copy.id);
  });

  it('returns null for unknown ids', async () => {
    expect(await loadProject('p_doesnotexist')).toBeNull();
  });
});

describe('import', () => {
  it('parses a file and keeps a free id', async () => {
    const p = createBlankProject('Imported');
    const file = new File([serializeProject(p)], 'imported.questforge.json', { type: 'application/json' });
    const got = await readProjectFile(file);
    expect(got.id).toBe(p.id);
    expect(got).toEqual(p);
  });

  it('re-ids when the id is already stored or reserved', async () => {
    const p = createBlankProject('Existing');
    await saveProject(p);
    const got = await readProjectFile(new File([serializeProject(p)], 'x.json'));
    expect(got.id).not.toBe(p.id);
    expect(got.id).toMatch(/^p_/);
    expect(got.name).toBe('Existing');
    const sample = cloneProject(p);
    sample.id = 'sample';
    expect((await readProjectFile(new File([serializeProject(sample)], 's.json'))).id).not.toBe('sample');
    await deleteProject(p.id);
  });

  it('re-ids a file whose id is the engine test project ("test"), which #/play/test would shadow', async () => {
    const p = createBlankProject('My imported quest');
    p.id = 'test';
    const got = await readProjectFile(new File([serializeProject(p)], 't.json'));
    expect(got.id).not.toBe('test');
    expect(got.id).toMatch(/^p_/);
    expect(got.name).toBe('My imported quest');
  });

  it('moves a project stored earlier under the reserved id "test" to a free id when listing', async () => {
    const p = createBlankProject('Old import');
    p.id = 'test';
    await saveProject(p);
    const metas = await listProjects();
    expect(metas.some((m) => m.id === 'test')).toBe(false);
    const moved = metas.find((m) => m.name === 'Old import')!;
    expect(moved.id).toMatch(/^p_/);
    expect((await loadProject(moved.id))?.name).toBe('Old import');
    expect((await loadProject(moved.id))?.id).toBe(moved.id);
    expect(await loadProject('test')).toBeNull();
    expect((await listProjects()).filter((m) => m.name === 'Old import')).toHaveLength(1);
    await deleteProject(moved.id);
  });

  it('moves a reserved-id project only once when two listings overlap', async () => {
    const p = createBlankProject('Raced import');
    p.id = 'test';
    await saveProject(p);
    const [a, b] = await Promise.all([listProjects(), listProjects()]);
    const all = await listProjects();
    const copies = all.filter((m) => m.name === 'Raced import');
    expect(copies).toHaveLength(1);
    expect(a.filter((m) => m.name === 'Raced import').map((m) => m.id)).toEqual([copies[0]!.id]);
    expect(b.filter((m) => m.name === 'Raced import').map((m) => m.id)).toEqual([copies[0]!.id]);
    await deleteProject(copies[0]!.id);
  });

  it('lists from the light meta records, which follow every save, duplicate and delete', async () => {
    const p = createBlankProject('Meta');
    await saveProject(p);
    p.name = 'Meta renamed';
    p.worlds[0]!.rooms.push({ ...p.worlds[0]!.rooms[0]!, id: 'r_two', gx: 1 });
    await saveProject(p);
    const copy = await duplicateProject(p, 'Meta copy');
    const metas = await listProjects();
    expect(metas.find((m) => m.id === p.id)).toMatchObject({ name: 'Meta renamed', rooms: 2, modified: p.modified });
    expect(metas.find((m) => m.id === copy.id)).toMatchObject({ name: 'Meta copy', rooms: 2 });
    await deleteProject(p.id);
    await deleteProject(copy.id);
    expect((await listProjects()).some((m) => m.id === p.id || m.id === copy.id)).toBe(false);
  });

  it('throws a readable error for bad files', async () => {
    await expect(readProjectFile(new File(['not json'], 'bad.json'))).rejects.toThrow(/not valid JSON/);
    await expect(readProjectFile(new File(['{"a":1}'], 'bad.json'))).rejects.toThrow(/not a Questforge project/);
  });
});

describe('saves', () => {
  it('lists SAVE_SLOTS slots, writes, overwrites and deletes', async () => {
    const p = createBlankProject('Saves');
    expect(await listSaves(p.id)).toEqual(new Array(SAVE_SLOTS).fill(null));
    const s1 = newSave(p, 1, 'Ada');
    s1.updated = 0;
    await writeSave(s1);
    expect(s1.updated).toBeGreaterThan(0);
    let slots = await listSaves(p.id);
    expect(slots).toHaveLength(SAVE_SLOTS);
    expect(slots[0]).toBeNull();
    expect(slots[1]).toEqual(s1);
    expect(slots[2]).toBeNull();
    s1.rupees = 77;
    await writeSave(s1);
    slots = await listSaves(p.id);
    expect(slots[1]?.rupees).toBe(77);
    const other = createBlankProject('Other');
    expect(await listSaves(other.id)).toEqual(new Array(SAVE_SLOTS).fill(null));
    await deleteSave(p.id, 1);
    expect(await listSaves(p.id)).toEqual(new Array(SAVE_SLOTS).fill(null));
  });

  it('rejects slots outside 0..SAVE_SLOTS-1', async () => {
    const p = createBlankProject('Slots');
    for (const slot of [-1, SAVE_SLOTS, 1.5, Number.NaN]) {
      await expect(writeSave(newSave(p, slot, 'X'))).rejects.toThrow(/Save slot .* does not exist/);
      await expect(deleteSave(p.id, slot)).rejects.toThrow(/does not exist/);
    }
    expect(await listSaves(p.id)).toEqual(new Array(SAVE_SLOTS).fill(null));
  });

  it('deleting a project removes its saves', async () => {
    const p = createBlankProject('Doomed');
    await saveProject(p);
    await writeSave(newSave(p, 0, 'A'));
    await writeSave(newSave(p, 2, 'C'));
    await deleteProject(p.id);
    expect(await listSaves(p.id)).toEqual(new Array(SAVE_SLOTS).fill(null));
  });
});

describe('settings', () => {
  it('returns the fallback until set, then the stored value', () => {
    expect(getSetting('test.volume', 0.5)).toBe(0.5);
    setSetting('test.volume', 0.8);
    expect(getSetting('test.volume', 0.5)).toBe(0.8);
    setSetting('test.obj', { muted: true, keys: ['z'] });
    const v = getSetting('test.obj', { muted: false, keys: [] as string[] });
    expect(v).toEqual({ muted: true, keys: ['z'] });
    v.keys.push('x');
    expect(getSetting('test.obj', { muted: false, keys: [] as string[] }).keys).toEqual(['z']);
    setSetting('test.null', null);
    expect(getSetting<string | null>('test.null', 'fallback')).toBeNull();
  });
});
