// Editor shell: top bar (project name, save state, undo/redo, playtest, export,
// back), tab strip (Map | Art | Dialogue | Project), EditorContext
// implementation (selection, events, autosave to storage, asset invalidation),
// keyboard shortcuts (Ctrl+Z/Y/S, F5 playtest), playtest overlay hosting a Game
// in 'playtest' mode (Escape returns). A field still being typed in commits
// before the editor closes, the page unloads or the tab is hidden. Saves never
// silently replace a newer copy stored by another browser tab: the user picks
// reload, overwrite or save-as-copy (a closing editor keeps its work as a copy).
import './shell/shell.css';
import type { Project, WarpTarget } from '../core/types';
import type { EditorContext, EditorTabId, Panel } from './context';
import type { Game } from '../game/game';
import { SCREEN_H, SCREEN_W } from '../core/constants';
import { findRoom, newId } from '../core/project';
import { downloadProject, listProjects, loadProject, saveProject, storageIsPersistent } from '../core/storage';
import { AssetCache } from '../gfx/imageCache';
import { button, el, toast, type ModalHandle } from './ui/dom';
import { Autosave } from './shell/autosave';
import { ShellContext } from './shell/context';
import { createTopBar, type TopBar } from './shell/topbar';
import { EDITOR_TABS, createTabStrip, type TabStrip } from './shell/tabstrip';
import { openPlaytest, type PlaytestHandle } from './shell/playtest';
import { showHelp } from './shell/help';
import { choiceAction, confirmAction } from './shell/dialogs';
import { editorShortcut } from './shell/keys';
import { applyNaming, namingOf, renamed } from './shell/rename';
import { icon } from './shell/icons';
import { shortName, uniqueName } from '../app/format';
import { noteExported, notePlaytest, observeEditor } from '../learning/editorObserver';

/** Host callbacks and flags for the editor. */
export interface EditorOptions {
  /** Back to the main menu. */
  onExit: () => void;
  /** True if the project is not yet in storage (e.g. an unsaved copy of the sample): first save stores it. */
  unsaved?: boolean;
  /** The playtest overlay opened (its Game) or closed (null). */
  onGame?: (game: Game | null) => void;
  /** A playtest stopped after an uncaught error. */
  onError?: (message: string) => void;
  /** An unsaved project was stored for the first time under `id`. */
  onStored?: (id: string) => void;
}

type Mount = (el: HTMLElement, ctx: EditorContext) => Panel;

/**
 * Tabs load on first use (code-split): a tab whose module fails to load shows
 * its error in place and the rest of the editor keeps working.
 */
const LOADERS: Readonly<Record<EditorTabId, () => Promise<Mount>>> = {
  map: async () => (await import('./map/mapTab')).mountMapTab,
  art: async () => (await import('./art/artTab')).mountArtTab,
  dialogue: async () => (await import('./dialogue/dialogueTab')).mountDialogueTab,
  project: async () => (await import('./project/projectTab')).mountProjectTab,
};

/** Editors post `{ id, modified }` here after each save so other tabs on the same project learn of it at once. */
export const PROJECT_CHANNEL = 'questforge-projects';

/** A save refused because another browser tab stored this project after this editor loaded (or last saved) it. */
export class SaveConflictError extends Error {
  constructor() {
    super('This project was changed in another tab.');
    this.name = 'SaveConflictError';
  }
}

/** How the user settles a save conflict. */
type ConflictChoice = 'reload' | 'overwrite' | 'copy';

interface TabSlot {
  section: HTMLElement;
  panel: Panel | null;
  /** Settles once the panel is mounted (or replaced by an error message). */
  ready: Promise<void> | null;
}

/** Blur the focused control so a half-typed value commits (its 'change' fires synchronously); returns what had focus. */
function commitPendingEdit(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  active.blur();
  return active;
}

function modalOpen(): boolean {
  return document.querySelector('.qf-modal-backdrop') !== null;
}

/** The editor shell: chrome, tabs, shortcuts, autosave and the playtest overlay. */
export class Editor {
  /** The EditorContext shared with every tab (exposed for tests and tools). */
  readonly ctx: ShellContext;
  private readonly project: Project;
  private readonly opts: EditorOptions;
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly topbar: TopBar;
  private readonly tabstrip: TabStrip;
  private readonly autosave: Autosave;
  private readonly slots = new Map<EditorTabId, TabSlot>();
  private readonly cleanups: (() => void)[] = [];
  private readonly prevTitle = document.title;
  private notStored: boolean;
  /** False when the browser keeps projects only in memory (until the tab closes). */
  private persistent = true;
  private playtestHandle: PlaytestHandle | null = null;
  private lastFocus: HTMLElement | null = null;
  private help: ModalHandle | null = null;
  private leavePrompt: Promise<boolean> | null = null;
  /** The user chose to leave although the latest changes could not be saved. */
  private leaveConfirmed = false;
  private destroyed = false;
  /** The stored copy's `modified` as of loading or this editor's last save (another value in storage = another tab saved). */
  private knownModified: number;
  /** A conflict with another tab's save is unresolved: automatic saves pause (the banner offers the choices). */
  private conflict = false;
  /** The next save that meets a conflict asks what to do even while one is unresolved (explicit saves, leaving). */
  private askOnConflict = false;
  /** The next save replaces the stored copy whatever it holds (the user chose Overwrite). */
  private forceOverwrite = false;
  private conflictBanner: HTMLElement | null = null;
  private readonly channel: BroadcastChannel | null = typeof BroadcastChannel === 'function' ? new BroadcastChannel(PROJECT_CHANNEL) : null;

  constructor(root: HTMLElement, project: Project, opts: EditorOptions) {
    this.project = project;
    this.opts = opts;
    this.notStored = !!opts.unsaved;
    this.knownModified = project.modified;
    this.autosave = new Autosave({
      save: () => this.store(),
      onStatus: (s) => {
        this.topbar.setStatus(s, this.notStored);
        this.ctx.reportSaveStatus(s, !this.notStored);
      },
      onError: (err) => {
        // A conflict explains itself (dialog or banner).
        if (!(err instanceof SaveConflictError)) toast(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
      },
    });
    this.ctx = new ShellContext(project, new AssetCache(project), this.autosave, {
      showTab: (id) => this.showTab(id),
      playtest: (from) => this.playtest(from),
      toast: (msg, kind) => toast(msg, kind),
      tabReady: (id) => this.tabReady(id),
    }, !this.notStored);
    this.topbar = createTopBar(project.name, {
      rename: (name) => this.rename(name),
      undo: () => this.stepHistory(false),
      redo: () => this.stepHistory(true),
      save: () => void this.saveExplicit(),
      playtest: () => this.playtest(),
      exportFile: () => this.exportFile(),
      help: () => this.openHelp(),
      back: () => void this.back(),
    });
    this.tabstrip = createTabStrip((id) => this.ctx.switchTab(id));
    this.body = el('main', { class: 'qf-shell__body' });
    for (const t of EDITOR_TABS) {
      const section = el('section', {
        class: 'qf-shell__panel', id: `qf-tabpanel-${t.id}`, role: 'tabpanel', tabIndex: -1,
        'aria-labelledby': `qf-tab-${t.id}`, dataset: { tab: t.id }, hidden: true,
      });
      this.slots.set(t.id, { section, panel: null, ready: null });
      this.body.appendChild(section);
    }
    this.el = el('div', { class: 'qf-shell' }, this.topbar.element, this.tabstrip.element, this.body);

    this.topbar.setStatus('saved', this.notStored);
    this.refreshHistory();
    this.refreshTitle();
    this.refreshTrail();
    // Attach only once the chrome rendered: a constructor that throws leaves nothing on the page.
    root.appendChild(this.el);
    this.bindEvents();
    this.cleanups.push(() => this.topbar.destroy());
    // Learning evidence (src/learning): stops before the tabs unmount, recording pending edits.
    this.cleanups.push(observeEditor(this.ctx));
    this.ctx.switchTab('map');
    void this.checkPersistence();
  }

  /** True while the playtest overlay is open. */
  get playtesting(): boolean {
    return this.playtestHandle !== null;
  }

  /** True when the latest save failed and leaving now would lose changes (hosts ask via confirmLeave first). */
  get hasUnsavedFailure(): boolean {
    return !this.leaveConfirmed && this.autosave.status === 'error';
  }

  /**
   * Store pending changes before leaving; if that fails, ask whether to leave
   * anyway. Resolves true when it is fine to leave (concurrent calls share one prompt).
   */
  confirmLeave(): Promise<boolean> {
    this.leavePrompt ??= this.askLeave().finally(() => { this.leavePrompt = null; });
    return this.leavePrompt;
  }

  /** Resolves once a tab has been shown and its panel mounted (and had a tick to register itself). */
  async tabReady(id: EditorTabId): Promise<void> {
    await this.slots.get(id)?.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Close the editor: stop any playtest, store pending changes, unmount every tab and drop all listeners. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closePlaytest();
    this.help?.close();
    // Leaving (Back, a new address, a route change) removes a focused field without a 'change': commit it first.
    this.commitField();
    // The channel stays open until that last save has told the other tabs.
    const flushed = this.leaveConfirmed ? Promise.resolve(true) : this.autosave.flush();
    void flushed.finally(() => this.channel?.close());
    this.autosave.dispose();
    for (const fn of this.cleanups.splice(0)) fn();
    for (const slot of this.slots.values()) {
      try {
        slot.panel?.destroy();
      } catch (err) {
        console.error('[editor] a tab failed to clean up:', err);
      }
    }
    this.slots.clear();
    this.ctx.dispose();
    this.el.remove();
    document.title = this.prevTitle;
  }

  // ------------------------------------------------------------------ wiring

  private bindEvents(): void {
    const { bus, undo } = this.ctx;
    this.cleanups.push(
      undo.onChange(() => this.refreshHistory()),
      bus.on('undo', () => this.refreshNames()),
      bus.on('project', ({ what }) => {
        if (what === 'settings' || what === 'all') this.refreshNames();
        else this.refreshTrail();
      }),
      bus.on('selection', () => this.refreshTrail()),
      this.listen(document, 'keydown', (e) => this.onKey(e as KeyboardEvent)),
      this.listen(window, 'beforeunload', (e) => this.onBeforeUnload(e as BeforeUnloadEvent)),
      this.listen(document, 'visibilitychange', () => {
        if (!document.hidden) return;
        this.commitField()?.focus({ preventScroll: true });
        void this.autosave.flush();
      }),
    );
    if (this.channel) {
      this.channel.onmessage = (e: MessageEvent) => {
        const msg = e.data as { id?: unknown; modified?: unknown } | null;
        if (this.destroyed || this.notStored || msg?.id !== this.project.id || msg.modified === this.knownModified) return;
        this.showConflictBanner(false);
      };
    }
  }

  /** Blur a control of this editor that is still being typed in, so its value commits; returns it (to refocus). */
  private commitField(): HTMLElement | null {
    return this.el.contains(document.activeElement) ? commitPendingEdit() : null;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): () => void {
    target.addEventListener(type, fn);
    return () => target.removeEventListener(type, fn);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.playtestHandle) {
      // The game owns the keyboard, but F5 must not reload and Ctrl+S must not open "Save page as".
      const action = editorShortcut(e, false);
      if (action?.kind === 'playtest') e.preventDefault();
      if (action?.kind === 'save') {
        e.preventDefault();
        void this.autosave.flush();
      }
      return;
    }
    if (e.defaultPrevented) return;
    // F5 never reloads the page from the editor (not even behind a dialog).
    if (e.key === 'F5') e.preventDefault();
    const action = editorShortcut(e, modalOpen());
    if (!action) return;
    e.preventDefault();
    switch (action.kind) {
      case 'playtest':
        if (action.here) this.playtestHere();
        else this.playtest();
        break;
      case 'save':
        void this.saveExplicit();
        break;
      case 'undo':
        this.stepHistory(false);
        break;
      case 'redo':
        this.stepHistory(true);
        break;
      case 'tab':
        this.ctx.switchTab(EDITOR_TABS[action.index]!.id);
        break;
      case 'help':
        this.openHelp();
        break;
    }
  }

  private onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.leaveConfirmed) return;
    // A half-typed field counts as a change: commit it (the caret comes back if the user stays).
    this.commitField()?.focus({ preventScroll: true });
    if (!this.autosave.pending) return;
    void this.autosave.flush();
    e.preventDefault();
    e.returnValue = '';
  }

  // ------------------------------------------------------------------ tabs

  private showTab(id: EditorTabId): void {
    for (const [key, slot] of this.slots) {
      const show = key === id;
      const wasHidden = slot.section.hidden;
      slot.section.hidden = !show;
      if (!show) continue;
      if (slot.panel) {
        if (wasHidden) slot.panel.refresh?.();
      } else {
        slot.ready ??= this.mountTab(id, slot);
      }
    }
    this.tabstrip.setActive(id);
  }

  /** Load and mount a tab; a failing tab shows its error instead of breaking the editor. */
  private async mountTab(id: EditorTabId, slot: TabSlot): Promise<void> {
    const { section } = slot;
    section.replaceChildren(el('div', { class: 'qf-shell__loading', role: 'status' }, 'Loading…'));
    try {
      const mount = await LOADERS[id]();
      if (this.destroyed) return;
      section.replaceChildren();
      slot.panel = mount(section, this.ctx);
    } catch (err) {
      if (this.destroyed) return;
      console.error(`[editor] the ${id} tab failed to load:`, err);
      section.replaceChildren(el('div', { class: 'qf-empty qf-shell__tab-error', role: 'alert' },
        el('h3', null, 'This part of the editor failed to download'),
        el('p', null, 'Your work is kept: it is saved before the editor reloads. Reload to try again.'),
        button('Reload the editor', () => void this.reloadEditor(), { kind: 'primary' }),
        el('pre', null, err instanceof Error ? err.message : String(err))));
      // Try again the next time the tab is shown (a browser that cached the failure needs the reload).
      slot.panel = null;
      slot.ready = null;
    }
  }

  /** Store pending changes, then reload the page (an unsaved sample copy is stored first and reopens under its new address). */
  private async reloadEditor(): Promise<void> {
    await this.autosave.flush();
    if (!this.destroyed) location.reload();
  }

  // ------------------------------------------------------------------ actions

  /** Rename as one undo step (the 'settings' change and 'undo' events refresh the chrome); an unchanged title follows. */
  private rename(name: string): void {
    const p = this.project;
    const before = namingOf(p);
    const after = renamed(p, name);
    applyNaming(p, after);
    this.ctx.undo.push({
      label: 'Rename project',
      undo: () => applyNaming(p, before),
      redo: () => applyNaming(p, after),
    });
    this.ctx.changed('settings');
  }

  /** Undo (or redo) the last step and name it: history is shared by every tab, so the step may belong to a hidden one. */
  private stepHistory(redo: boolean): void {
    const label = redo ? this.ctx.undo.peekRedo() : this.ctx.undo.peekUndo();
    if (redo ? this.ctx.redoLast() : this.ctx.undoLast()) this.topbar.announceHistory(`${redo ? 'Redid' : 'Undid'}: ${label}`);
  }

  /** Ctrl+S / the status button: commit the field being typed in, then store now. */
  private async saveExplicit(): Promise<void> {
    commitPendingEdit()?.focus({ preventScroll: true });
    this.askOnConflict = true;
    if (await this.autosave.saveNow()) toast('Saved', 'success', 1400);
  }

  /**
   * Autosave target: store the project; an unsaved copy becomes a new stored
   * project. A copy stored by another tab since this editor loaded or last
   * saved is never replaced silently (see settleConflict).
   */
  private async store(): Promise<void> {
    const ask = this.askOnConflict;
    this.askOnConflict = false;
    const note = !this.notStored && !this.forceOverwrite ? await this.settleConflict(ask) : null;
    this.forceOverwrite = false;
    await saveProject(this.project);
    this.knownModified = this.project.modified;
    this.conflict = false;
    this.hideConflictBanner();
    try {
      this.channel?.postMessage({ id: this.project.id, modified: this.project.modified });
    } catch {
      // The channel closed with the editor: no tab is left to tell from here.
    }
    if (!this.notStored) return;
    this.notStored = false;
    if (note) toast(note, 'info', 6000);
    else toast(this.persistent ? 'Saved as a new project' : 'Saved as a new project (this tab only)', 'success');
    // After destroy() the host has moved on: its address must not change any more.
    if (!this.destroyed) this.opts.onStored?.(this.project.id);
  }

  /**
   * Before a save: if storage holds a newer copy from another tab, settle it.
   * Returns when the save may go ahead (overwrite, or this copy became a new
   * project), with a note to show once it is stored; throws SaveConflictError
   * when it must not. A closing editor keeps its work as a new project; an
   * unresolved conflict pauses automatic saves without asking again
   * (explicit saves and leaving ask).
   */
  private async settleConflict(ask: boolean): Promise<string | null> {
    if (this.conflict && !ask && !this.destroyed) throw new SaveConflictError();
    const stored = await loadProject(this.project.id).catch(() => null);
    if (!stored || stored.modified === this.knownModified) return null;
    if (this.destroyed) {
      const was = shortName(this.project.name);
      await this.becomeCopy();
      return `“${was}” was changed in another tab, so your latest changes were saved as “${shortName(this.project.name)}”.`;
    }
    this.hideConflictBanner();
    const choice = await this.askConflict();
    if (choice === 'overwrite') return null;
    if (choice === 'copy') {
      await this.becomeCopy();
      return null;
    }
    if (choice === 'reload') {
      this.reloadDiscarding();
    } else {
      this.conflict = true;
      this.showConflictBanner(true);
    }
    throw new SaveConflictError();
  }

  private askConflict(): Promise<ConflictChoice | null> {
    const body = el('div', { class: 'qf-shell__conflict' },
      el('p', null, `“${shortName(this.project.name)}” was saved in another browser tab after you opened it here. Saving this tab’s version now would replace those changes.`),
      el('ul', null,
        el('li', null, el('b', null, 'Reload'), ' opens the stored version: the changes made in this tab are lost.'),
        el('li', null, el('b', null, 'Overwrite'), ' keeps this tab’s version: the other tab’s changes are lost.'),
        el('li', null, el('b', null, 'Save as a copy'), ' keeps both: this tab’s version becomes a new project.')));
    return choiceAction<ConflictChoice>('Changed in another tab', body, [
      { label: 'Reload', value: 'reload' },
      { label: 'Overwrite', value: 'overwrite', kind: 'danger' },
      { label: 'Save as a copy', value: 'copy', kind: 'primary' },
    ], 'Decide later');
  }

  /** Turn this editor's project into a new, not yet stored project (new id, unique "(copy)" name). */
  private async becomeCopy(): Promise<void> {
    const p = this.project;
    const taken = (await listProjects().catch(() => [])).map((m) => m.name);
    p.id = newId('p');
    p.name = uniqueName(p.name, [p.name, ...taken], 'copy');
    p.created = Date.now();
    this.notStored = true;
    if (!this.destroyed) this.refreshNames();
  }

  /** Reload the page on the stored version, dropping this tab's unsaved changes (no leave prompt). */
  private reloadDiscarding(): void {
    this.leaveConfirmed = true;
    location.reload();
  }

  /** A banner under the top bar: another tab saved this project (`paused` = a save here already met the conflict). */
  private showConflictBanner(paused: boolean): void {
    if (this.destroyed) return;
    this.hideConflictBanner();
    const act = async (choice: ConflictChoice): Promise<void> => {
      if (choice === 'reload') {
        if (this.autosave.pending && !await confirmAction('Reload the stored version? The changes made in this tab are lost.', {
          title: 'Reload', ok: 'Reload', danger: true,
        })) return;
        this.reloadDiscarding();
        return;
      }
      this.hideConflictBanner();
      if (choice === 'copy') await this.becomeCopy();
      else this.forceOverwrite = true;
      this.conflict = false;
      if (await this.autosave.saveNow()) toast('Saved', 'success', 1400);
    };
    const text = paused
      ? 'Saving is paused: this project was changed in another tab. Choose which version to keep.'
      : 'This project was just saved in another tab. Reload to continue from that version; saving here would replace it.';
    const banner = el('div', { class: 'qf-shell__banner qf-shell__banner--conflict', role: 'alert' },
      icon('warning'),
      el('span', { class: 'qf-grow' }, text),
      button('Reload', () => void act('reload'), { small: true, kind: paused ? 'default' : 'primary' }),
      paused ? button('Overwrite', () => void act('overwrite'), { small: true, kind: 'danger' }) : null,
      paused ? button('Save as a copy', () => void act('copy'), { small: true, kind: 'primary' }) : null,
      paused ? null : button('Dismiss', () => this.hideConflictBanner(), { small: true, kind: 'ghost' }));
    this.conflictBanner = banner;
    this.el.insertBefore(banner, this.body);
  }

  private hideConflictBanner(): void {
    this.conflictBanner?.remove();
    this.conflictBanner = null;
  }

  private openHelp(): void {
    this.help ??= showHelp(() => { this.help = null; });
  }

  private exportFile(): void {
    try {
      downloadProject(this.project);
      noteExported();
      toast(`Exported “${shortName(this.project.name)}”`, 'success');
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private async back(): Promise<void> {
    if (this.playtestHandle) return;
    if (await this.confirmLeave()) this.opts.onExit();
  }

  private async askLeave(): Promise<boolean> {
    if (this.leaveConfirmed || !this.autosave.pending) return true;
    this.askOnConflict = true;
    if (await this.autosave.flush() || this.destroyed) return true;
    const leave = await confirmAction('Your latest changes could not be saved. Leave the editor anyway and lose them?', {
      title: 'Unsaved changes', ok: 'Leave without saving', danger: true,
    });
    this.leaveConfirmed = leave;
    return leave;
  }

  // ------------------------------------------------------------------ playtest

  private playtest(from?: WarpTarget): void {
    if (this.playtestHandle || this.destroyed) return;
    // Commit a half-typed field first: the playtest copy must include it.
    const focused = commitPendingEdit();
    const start = from ?? this.project.start;
    if (!findRoom(this.project, start.world, start.room)) {
      focused?.focus({ preventScroll: true });
      toast(from ? 'That room no longer exists.' : 'The start location points to a missing room. Set it on the Project tab.', 'error', 4000);
      return;
    }
    this.lastFocus = focused;
    try {
      this.playtestHandle = openPlaytest(this.project, start, {
        onClose: () => this.closePlaytest(),
        onError: (msg) => this.opts.onError?.(msg),
      });
    } catch (err) {
      console.error('[editor] playtest failed to start:', err);
      toast(`Playtest failed to start: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
      return;
    }
    notePlaytest(start.room);
    this.el.hidden = true;
    this.opts.onGame?.(this.playtestHandle.game);
  }

  /** Shift+F5: from the map cursor (if the map tab publishes one) or the selected room's centre. */
  private playtestHere(): void {
    const room = this.ctx.room();
    if (!room) {
      toast('Select a room on the map first — Shift+F5 plays from the selected room.', 'info', 3500);
      return;
    }
    const world = this.ctx.world().id;
    const cursor = this.ctx.mapCursor;
    if (cursor && cursor.world === world && cursor.room === room.id) {
      this.playtest(cursor);
      return;
    }
    this.playtest({ world, room: room.id, x: (room.gw * SCREEN_W) / 2, y: (room.gh * SCREEN_H) / 2, dir: 'down' });
  }

  private closePlaytest(): void {
    const handle = this.playtestHandle;
    if (!handle) return;
    this.playtestHandle = null;
    handle.destroy();
    this.el.hidden = false;
    this.opts.onGame?.(null);
    if (this.destroyed) return;
    // The editor was hidden while the game ran (and the game took over the music): refresh what is shown.
    this.refreshActiveTab();
    const focus = this.lastFocus?.isConnected ? this.lastFocus : this.slots.get(this.ctx.activeTab)?.section;
    focus?.focus({ preventScroll: true });
  }

  private refreshActiveTab(): void {
    try {
      this.slots.get(this.ctx.activeTab)?.panel?.refresh?.();
    } catch (err) {
      console.error('[editor] a tab failed to refresh:', err);
    }
  }

  // ------------------------------------------------------------------ chrome

  private refreshHistory(): void {
    this.topbar.setHistory(this.ctx.undo.peekUndo(), this.ctx.undo.peekRedo());
  }

  private refreshTitle(): void {
    document.title = `${this.project.name} — Questforge editor`;
  }

  /** Project name in the top bar & window title, plus the breadcrumb (world/room names). */
  private refreshNames(): void {
    this.topbar.setName(this.project.name);
    this.refreshTitle();
    this.refreshTrail();
  }

  private refreshTrail(): void {
    const world = this.ctx.world();
    const room = this.ctx.room();
    this.tabstrip.setTrail(room ? [world.name, room.name] : [world.name]);
  }

  private async checkPersistence(): Promise<void> {
    if (await storageIsPersistent() || this.destroyed) return;
    this.persistent = false;
    this.topbar.setPersistent(false);
    const banner = el('div', { class: 'qf-shell__banner', role: 'status' },
      icon('warning'),
      el('span', { class: 'qf-grow' },
        'This browser is not letting Questforge store projects (private window?). Your work lasts only until this tab closes — use Export to keep a copy.'),
      button('Export now', () => this.exportFile(), { small: true, kind: 'primary' }),
      button('Dismiss', () => banner.remove(), { small: true, kind: 'ghost' }));
    this.el.insertBefore(banner, this.body);
  }
}
