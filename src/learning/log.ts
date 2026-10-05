// Learning log: the student's learning events, in Quark's draft event format
// (xAPI-lite: who did what, where, with what result), kept in this browser.
//
// Events stay local. They go to IndexedDB (database `questforge-learning`, its
// own database so the project store's version never changes for it) with an
// in-memory fallback. A LearningSink receives every new event too: the local
// store is the only sink today; a Quark sink is added later with addLearningSink
// once Quark's SDK exists (actor = the Quark student id once signed in).
import { version as APP_VERSION } from '../../package.json';
import { newId } from '../core/project';
import { activityInfo, type ActivityId, type Verb } from './activities';
import { STANDARDS_VERSION } from './standards';

export type FactValue = string | number | boolean | string[];
export type Facts = Record<string, FactValue>;

export interface LearningEvent {
  id: string;
  /** ISO time. Shown on the timeline; levels only use it to order events. */
  time: string;
  /** Quark student id; null until Quark sign-in exists. */
  actor: string | null;
  verb: Verb;
  object: {
    app: 'questforge';
    activity: ActivityId;
    /** What the activity was about inside the project, e.g. "<roomId>/<triggerId>" or "tile:1003". */
    ref?: string;
    /** Readable name of that thing ("Open the gate"). */
    name?: string;
  };
  result?: {
    /** The student's work sample (trigger code, pixel hex). */
    response?: string;
    facts?: Facts;
  };
  context: {
    appVersion: string;
    standardsVersion: string;
    projectId: string;
    projectName: string;
    roomId?: string;
    mode: 'editor' | 'play' | 'playtest';
    /** One id per page load. */
    session: string;
  };
}

/** Where events go. The local store is always one; Quark becomes another. */
export interface LearningSink {
  record(e: LearningEvent): void | Promise<void>;
}

/** What the recorder needs to know about the place events come from. */
export interface LearningContext {
  projectId(): string;
  projectName(): string;
  mode: LearningEvent['context']['mode'];
}

export interface RecordData {
  ref?: string;
  name?: string;
  roomId?: string;
  response?: string;
  facts?: Facts;
}

const SESSION = newId('s');
const DB_NAME = 'questforge-learning';
const STORE = 'events';

// ---------------------------------------------------------------------------
// Local store (IndexedDB, else memory)
// ---------------------------------------------------------------------------

interface Store {
  all(): Promise<LearningEvent[]>;
  put(e: LearningEvent): Promise<void>;
  clear(): Promise<void>;
}

class MemoryStore implements Store {
  private readonly events: LearningEvent[] = [];
  async all(): Promise<LearningEvent[]> {
    return this.events.map((e) => structuredClone(e));
  }
  async put(e: LearningEvent): Promise<void> {
    this.events.push(structuredClone(e));
  }
  async clear(): Promise<void> {
    this.events.length = 0;
  }
}

class IdbStore implements Store {
  constructor(private readonly db: IDBDatabase) {}
  private req<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const r = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error ?? new Error('Learning log storage error'));
      tx.onabort = () => reject(tx.error ?? new Error('Learning log transaction aborted'));
    });
  }
  async all(): Promise<LearningEvent[]> {
    const rows = await this.req('readonly', (s) => s.getAll());
    return (rows as LearningEvent[]).sort((a, b) => a.time.localeCompare(b.time));
  }
  async put(e: LearningEvent): Promise<void> {
    await this.req('readwrite', (s) => s.put(e));
  }
  async clear(): Promise<void> {
    await this.req('readwrite', (s) => s.clear());
  }
}

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  storePromise ??= (async (): Promise<Store> => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return new MemoryStore();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const opened = req.result;
          opened.onversionchange = () => {
            opened.close();
            storePromise = null;
          };
          resolve(opened);
        };
        req.onerror = () => reject(req.error ?? new Error('Could not open the learning log'));
      });
      return new IdbStore(db);
    } catch (err) {
      console.warn('Questforge: the learning log is kept in memory only.', err);
      return new MemoryStore();
    }
  })();
  return storePromise;
}

const localSink: LearningSink = {
  record: async (e) => {
    await (await store()).put(e);
  },
};

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const sinks: LearningSink[] = [localSink];
const listeners = new Set<(e: LearningEvent) => void>();
let context: LearningContext | null = null;
/** Writes still in flight (tests and the export wait for them). */
let pending: Promise<unknown> = Promise.resolve();

/** Where events come from right now (the editor sets it while open); null = recording is off. */
export function setLearningContext(c: LearningContext | null): void {
  context = c;
}

/** Add a destination for new events (Quark later). Returns a remover. */
export function addLearningSink(s: LearningSink): () => void {
  sinks.push(s);
  return () => {
    const i = sinks.indexOf(s);
    if (i > 0) sinks.splice(i, 1);
  };
}

/** Called for each new event (the My Learning page refreshes live). */
export function onLearning(fn: (e: LearningEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Build an event for `activity` in the current context (null when recording is off). */
export function makeEvent(activity: ActivityId, data: RecordData = {}, now = new Date()): LearningEvent | null {
  const info = activityInfo(activity);
  if (!context || !info) return null;
  const result = data.response !== undefined || data.facts ? { response: data.response, facts: data.facts } : undefined;
  return {
    id: newId('ev'),
    time: now.toISOString(),
    actor: null,
    verb: info.verb,
    object: { app: 'questforge', activity, ref: data.ref, name: data.name },
    result,
    context: {
      appVersion: APP_VERSION,
      standardsVersion: STANDARDS_VERSION,
      projectId: context.projectId(),
      projectName: context.projectName(),
      roomId: data.roomId,
      mode: context.mode,
      session: SESSION,
    },
  };
}

/** Record one learning event (no-op while recording is off). Never throws. */
export function recordLearning(activity: ActivityId, data: RecordData = {}): LearningEvent | null {
  const e = makeEvent(activity, data);
  if (!e) return null;
  for (const s of sinks) {
    pending = pending.then(() => s.record(e)).catch((err) => console.warn('Questforge: a learning event was not stored.', err));
  }
  for (const fn of listeners) fn(e);
  return e;
}

/** Every stored event, oldest first (waits for writes in flight). */
export async function listLearning(): Promise<LearningEvent[]> {
  await pending;
  const all = await (await store()).all();
  return all.sort((a, b) => a.time.localeCompare(b.time));
}

/** Delete every stored event in this browser. */
export async function clearLearning(): Promise<void> {
  await pending;
  await (await store()).clear();
}

/** The page-load session id stamped on events. */
export function learningSession(): string {
  return SESSION;
}
