// Data layer: storage falls back to memory whenever IndexedDB cannot be used, including a
// `window.indexedDB` getter that throws (Chrome does this in opaque-origin / sandboxed iframes)
// and an indexedDB.open that throws synchronously.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlankProject } from '../src/core/project';

type StorageModule = typeof import('../src/core/storage');

async function freshStorage(defineIdb: () => void): Promise<StorageModule> {
  vi.resetModules();
  defineIdb();
  return import('../src/core/storage');
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  vi.restoreAllMocks();
});

async function expectWorkingMemoryStore(s: StorageModule): Promise<void> {
  expect(await s.storageIsPersistent()).toBe(false);
  const p = createBlankProject('Fallback');
  await s.saveProject(p);
  expect((await s.listProjects()).map((m) => m.name)).toEqual(['Fallback']);
  expect((await s.loadProject(p.id))?.name).toBe('Fallback');
  await s.deleteProject(p.id);
  expect(await s.listProjects()).toEqual([]);
}

describe('storage fallback', () => {
  it('uses memory when reading window.indexedDB throws a SecurityError', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await freshStorage(() => {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException("Failed to read the 'indexedDB' property from 'Window': access is denied.", 'SecurityError');
        },
      });
    });
    await expectWorkingMemoryStore(s);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses memory when indexedDB.open throws synchronously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await freshStorage(() => {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: { open() { throw new DOMException('denied', 'SecurityError'); } },
      });
    });
    await expectWorkingMemoryStore(s);
  });
});
