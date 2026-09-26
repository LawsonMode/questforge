// Shared plumbing of the Project tab's sections.
import type { EditorContext } from '../context';

/** What every Project tab section gets. */
export interface ProjectTabEnv {
  readonly ctx: EditorContext;
  /** Apply `next` through `set` as one undoable 'settings' change (no-op when equal to get()). */
  commit<T>(label: string, get: () => T, set: (v: T) => void, next: T): void;
}

/** One section of the tab: its panels plus a re-read from the project. */
export interface Section {
  readonly elements: HTMLElement[];
  sync(): void;
  destroy?(): void;
}

/** Build a ProjectTabEnv whose commits are undoable and notify the editor. */
export function createEnv(ctx: EditorContext): ProjectTabEnv {
  return {
    ctx,
    commit<T>(label: string, get: () => T, set: (v: T) => void, next: T): void {
      const before = JSON.stringify(get() ?? null);
      const after = JSON.stringify(next ?? null);
      if (before === after) return;
      const restore = (json: string): void => set(JSON.parse(json) as T);
      restore(after);
      ctx.undo.push({ label, undo: () => restore(before), redo: () => restore(after) });
      ctx.changed('settings');
    },
  };
}
