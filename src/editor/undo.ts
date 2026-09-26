// Undo/redo stack for the editor.
export interface UndoCommand {
  label: string;
  undo(): void;
  redo(): void;
}

export class UndoStack {
  private done: UndoCommand[] = [];
  private undone: UndoCommand[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly limit = 300) {}

  /** Record an already-applied change. */
  push(cmd: UndoCommand): void {
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone.length = 0;
    this.notify();
  }

  /**
   * Snapshot helper: captures JSON of get() before and after running mutate(),
   * and records a command that restores via set(). No-op if nothing changed.
   */
  snapshot<T>(label: string, get: () => T, set: (v: T) => void, mutate: () => void): void {
    const before = JSON.stringify(get());
    mutate();
    const after = JSON.stringify(get());
    if (before === after) return;
    this.push({
      label,
      undo: () => set(JSON.parse(before) as T),
      redo: () => set(JSON.parse(after) as T),
    });
  }

  undo(): UndoCommand | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo();
    this.undone.push(cmd);
    this.notify();
    return cmd;
  }

  redo(): UndoCommand | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.redo();
    this.done.push(cmd);
    this.notify();
    return cmd;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  peekUndo(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }

  peekRedo(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.notify();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
