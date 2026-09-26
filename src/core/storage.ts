// Persistence: projects & save games in IndexedDB (falls back to in-memory when
// IndexedDB is unavailable, e.g. node tests), settings in localStorage,
// file import/export. OWNER: data agent. Every function must be safe to call
// in a private window (catch storage exceptions, degrade gracefully).
import type { Project, SaveData } from './types';
import { SAMPLE_PROJECT_ID, SAVE_SLOTS } from './constants';
import { cloneProject, newId, parseProject, serializeProject } from './project';
import { migrateProject } from './validate';

export interface ProjectMeta {
  id: string;
  name: string;
  author: string;
  created: number;
  modified: number;
  rooms: number;
}

const DB_NAME = 'questforge';
/** v2 adds the light `meta` store (one ProjectMeta per project) so the menu never loads whole projects to list them. */
const DB_VERSION = 2;
const SETTINGS_PREFIX = 'questforge:';
type StoreName = 'projects' | 'saves' | 'meta';

/**
 * Project ids the app itself answers for: the built-in sample (SAMPLE_PROJECT_ID) and the engine
 * test project ('test', TEST_PROJECT_ID in src/content/testProject.ts, which #/play/test runs).
 * A stored project with one of these ids would be shadowed, so imports get a fresh id instead.
 */
const RESERVED_IDS: ReadonlySet<string> = new Set([SAMPLE_PROJECT_ID, 'test']);

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** One write in a multi-store transaction: a put (keyed by value.id unless `key` is given) or a delete. */
type WriteOp =
  | { store: StoreName; value: unknown; key?: string }
  | { store: StoreName; remove: string };

/** Minimal key/value store API shared by IndexedDB and the in-memory fallback. */
interface Backend {
  getAll(store: StoreName): Promise<unknown[]>;
  get(store: StoreName, key: string): Promise<unknown>;
  /** Apply every op atomically (one IndexedDB transaction over the stores involved). */
  write(ops: readonly WriteOp[]): Promise<void>;
}

/** Stores keyed by the value's own `id` (in IndexedDB: keyPath 'id'). */
const KEYED_BY_ID: ReadonlySet<StoreName> = new Set(['projects', 'meta']);

/** Values are cloned on the way in and out, mirroring IndexedDB semantics. */
class MemoryBackend implements Backend {
  private readonly stores: Record<StoreName, Map<string, unknown>> = { projects: new Map(), saves: new Map(), meta: new Map() };

  async getAll(store: StoreName): Promise<unknown[]> {
    return [...this.stores[store].values()].map((v) => structuredClone(v));
  }

  async get(store: StoreName, key: string): Promise<unknown> {
    const v = this.stores[store].get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async write(ops: readonly WriteOp[]): Promise<void> {
    // Clone everything first so a value that cannot be cloned leaves the stores untouched (like an aborted transaction).
    const staged = ops.map((op) => ('remove' in op ? op : { ...op, value: structuredClone(op.value) }));
    for (const op of staged) {
      if ('remove' in op) this.stores[op.store].delete(op.remove);
      else this.stores[op.store].set(op.key ?? String((op.value as { id: unknown }).id), op.value);
    }
  }
}

class IdbBackend implements Backend {
  constructor(private readonly db: IDBDatabase) {}

  private run<T>(
    stores: StoreName[], mode: IDBTransactionMode, op: (tx: IDBTransaction) => IDBRequest<T> | void,
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      let req: IDBRequest<T> | void;
      try {
        req = op(tx);
      } catch (err) {
        // e.g. a DataCloneError from put(): undo the ops already queued in this transaction.
        try {
          tx.abort();
        } catch {
          // already finished
        }
        reject(err);
        return;
      }
      const where = stores.join(', ');
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error(`Storage error in "${where}"`));
      tx.onabort = () => reject(tx.error ?? new Error(`Storage transaction aborted in "${where}"`));
    });
  }

  async getAll(store: StoreName): Promise<unknown[]> {
    return (await this.run([store], 'readonly', (tx) => tx.objectStore(store).getAll())) ?? [];
  }

  get(store: StoreName, key: string): Promise<unknown> {
    return this.run([store], 'readonly', (tx) => tx.objectStore(store).get(key));
  }

  async write(ops: readonly WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    const stores = [...new Set(ops.map((op) => op.store))];
    await this.run(stores, 'readwrite', (tx) => {
      for (const op of ops) {
        const s = tx.objectStore(op.store);
        if ('remove' in op) s.delete(op.remove);
        else if (op.key === undefined || KEYED_BY_ID.has(op.store)) s.put(op.value);
        else s.put(op.value, op.key);
      }
    });
  }
}

/** Open the database; `onLost` runs once if the connection later closes (version change or browser close). */
function openDatabase(onLost: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
      if (!db.objectStoreNames.contains('meta')) {
        const meta = db.createObjectStore('meta', { keyPath: 'id' });
        // One-time fill from the projects stored before v2 (runs inside the upgrade transaction).
        const cursor = req.transaction?.objectStore('projects').openCursor();
        if (cursor) {
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return;
            if (isRecord(c.value)) meta.put(metaOf(c.value));
            c.continue();
          };
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        onLost();
      };
      db.onclose = onLost;
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
  });
}

let backendPromise: Promise<Backend> | null = null;

/**
 * IndexedDB when it opens, otherwise an in-memory store (data lasts for this page session only).
 * Any failure falls back to memory, including a `window.indexedDB` getter that throws (opaque-origin
 * or sandboxed iframes) and a synchronous throw from indexedDB.open. A lost IndexedDB connection
 * is dropped so the next call reopens it.
 */
function backend(): Promise<Backend> {
  if (backendPromise) return backendPromise;
  const current: Promise<Backend> = (async (): Promise<Backend> => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return new MemoryBackend();
      return new IdbBackend(await openDatabase(() => {
        if (backendPromise === current) backendPromise = null;
      }));
    } catch (err) {
      console.warn('Questforge: IndexedDB unavailable, projects will not persist.', err);
      return new MemoryBackend();
    }
  })();
  backendPromise = current;
  return current;
}

/**
 * Whether projects and saves persist across page loads (false when IndexedDB is unavailable
 * and the in-memory fallback is in use, e.g. some private windows). The shell can use this
 * to warn the user to export their work.
 */
export async function storageIsPersistent(): Promise<boolean> {
  return (await backend()) instanceof IdbBackend;
}

function saveKey(projectId: string, slot: number): string {
  return `${projectId}:${slot}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** The list entry for a full project record. */
function metaOf(p: Record<string, unknown>): ProjectMeta {
  const worlds = Array.isArray(p.worlds) ? p.worlds : [];
  const rooms = worlds.reduce<number>((n, w) => n + (isRecord(w) && Array.isArray(w.rooms) ? w.rooms.length : 0), 0);
  return {
    id: String(p.id),
    name: typeof p.name === 'string' ? p.name : 'Untitled',
    author: typeof p.author === 'string' ? p.author : '',
    created: typeof p.created === 'number' ? p.created : 0,
    modified: typeof p.modified === 'number' ? p.modified : 0,
    rooms,
  };
}

/** A stored meta record read back (tolerates partial records). */
function readMeta(m: Record<string, unknown>): ProjectMeta {
  return { ...metaOf(m), rooms: typeof m.rooms === 'number' ? m.rooms : 0 };
}

/**
 * A project stored before reserved ids were refused on import ('test' is shadowed by the engine
 * test project): move it to a fresh id so Play opens it. Its old save keys are left alone, since
 * they belong to whichever project #/play/<id> actually ran (the engine test project).
 */
async function rekeyReserved(db: Backend, oldId: string): Promise<void> {
  const raw = await db.get('projects', oldId);
  if (!isRecord(raw)) {
    await db.write([{ store: 'meta', remove: oldId }]);
    return;
  }
  const moved = { ...raw, id: newId('p') };
  await db.write([
    { store: 'projects', value: moved },
    { store: 'meta', value: metaOf(moved) },
    { store: 'projects', remove: oldId },
    { store: 'meta', remove: oldId },
  ]);
}

/** Serialises re-keying so two overlapping listProjects() calls never move the same project twice. */
let rekeyChain: Promise<void> = Promise.resolve();

async function readMetas(db: Backend): Promise<ProjectMeta[]> {
  return (await db.getAll('meta')).filter(isRecord).map(readMeta);
}

/**
 * Stored projects, most recently modified first. Reads only the light meta records, never the
 * projects themselves (whose size grows with rooms and art).
 */
export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await backend();
  let metas = await readMetas(db);
  const reserved = metas.filter((m) => RESERVED_IDS.has(m.id)).map((m) => m.id);
  if (reserved.length > 0) {
    const run = rekeyChain.then(async () => {
      for (const id of reserved) {
        try {
          await rekeyReserved(db, id);
        } catch (err) {
          console.warn(`Questforge: could not move stored project "${id}" to a free id.`, err);
        }
      }
    });
    rekeyChain = run;
    await run;
    metas = (await readMetas(db)).filter((m) => !RESERVED_IDS.has(m.id));
  }
  return metas.sort((a, b) => b.modified - a.modified);
}

/** Load (and migrate) a stored project; null if missing or unreadable. */
export async function loadProject(id: string): Promise<Project | null> {
  const raw = await (await backend()).get('projects', id);
  if (raw === undefined) return null;
  try {
    return migrateProject(raw);
  } catch (err) {
    console.warn(`Questforge: stored project "${id}" is unreadable.`, err);
    return null;
  }
}

/**
 * Store (insert or replace) together with its list entry, in one transaction. Updates `modified`.
 * The built-in sample (SAMPLE_PROJECT_ID) is regenerated from code and cannot be stored: duplicate
 * it first (throws a readable Error).
 */
export async function saveProject(p: Project): Promise<void> {
  if (p.id === SAMPLE_PROJECT_ID) {
    throw new Error('The built-in sample adventure cannot be saved over. Duplicate it to make your own copy.');
  }
  p.modified = Date.now();
  await (await backend()).write([
    { store: 'projects', value: p },
    { store: 'meta', value: metaOf(p as unknown as Record<string, unknown>) },
  ]);
}

/** Delete a project, its list entry and its save slots. */
export async function deleteProject(id: string): Promise<void> {
  await (await backend()).write([
    { store: 'projects', remove: id },
    { store: 'meta', remove: id },
    ...Array.from({ length: SAVE_SLOTS }, (_, slot): WriteOp => ({ store: 'saves', remove: saveKey(id, slot) })),
  ]);
}

/** Copy a project under a new id/name; returns the stored copy. */
export async function duplicateProject(p: Project, newName: string): Promise<Project> {
  const copy = cloneProject(p);
  copy.id = newId('p');
  copy.name = newName;
  copy.created = Date.now();
  await saveProject(copy);
  return copy;
}

/** File-system-safe base name. */
function fileBaseName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'project';
}

/** Trigger a browser download of `<name>.questforge.json`. */
export function downloadProject(p: Project): void {
  const blob = new Blob([serializeProject(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBaseName(p.name)}.questforge.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read & parse an imported file (throws readable Error). Gives it a fresh id if one with that id
 * is stored, or if the id is reserved (the sample, the engine test project).
 */
export async function readProjectFile(file: File): Promise<Project> {
  const project = parseProject(await file.text());
  const taken = RESERVED_IDS.has(project.id) || (await (await backend()).get('projects', project.id)) !== undefined;
  if (taken) project.id = newId('p');
  return project;
}

// ---------------------------------------------------------------------------
// Save games (slots 0..SAVE_SLOTS-1)
// ---------------------------------------------------------------------------

/** Save slots for a project; array length SAVE_SLOTS, null = empty slot. */
export async function listSaves(projectId: string): Promise<(SaveData | null)[]> {
  const db = await backend();
  const slots = Array.from({ length: SAVE_SLOTS }, (_, slot) => db.get('saves', saveKey(projectId, slot)));
  return (await Promise.all(slots)).map((v) => (isRecord(v) && v.projectId === projectId ? (v as unknown as SaveData) : null));
}

/** Throws a readable Error unless `slot` is a whole number in 0..SAVE_SLOTS-1. */
function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOTS) {
    throw new Error(`Save slot ${slot} does not exist (slots are 0-${SAVE_SLOTS - 1}).`);
  }
}

/** Write a save into its slot (stamps `updated`). Throws for a slot outside 0..SAVE_SLOTS-1. */
export async function writeSave(save: SaveData): Promise<void> {
  checkSlot(save.slot);
  save.updated = Date.now();
  await (await backend()).write([{ store: 'saves', value: save, key: saveKey(save.projectId, save.slot) }]);
}

/** Clear one save slot. Throws for a slot outside 0..SAVE_SLOTS-1. */
export async function deleteSave(projectId: string, slot: number): Promise<void> {
  checkSlot(slot);
  await (await backend()).write([{ store: 'saves', remove: saveKey(projectId, slot) }]);
}

// ---------------------------------------------------------------------------
// Settings (localStorage, JSON-encoded; this session's writes win if localStorage fails)
// ---------------------------------------------------------------------------

const memorySettings = new Map<string, string>();

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  let json = memorySettings.get(key) ?? null;
  if (json === null) {
    try {
      json = localStore()?.getItem(SETTINGS_PREFIX + key) ?? null;
    } catch {
      json = null;
    }
  }
  if (json === null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting<T>(key: string, value: T): void {
  const json = JSON.stringify(value) ?? 'null';
  memorySettings.set(key, json);
  try {
    localStore()?.setItem(SETTINGS_PREFIX + key, json);
  } catch {
    // Private mode / quota: the in-memory copy keeps this session consistent.
  }
}
