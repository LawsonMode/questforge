// App entry: hash router that mounts the menu, the game, the editor or the gallery
// (a friendly page for unknown routes, missing projects and stored projects too
// broken to open). The engine, the editor and the gallery are code-split and
// load with their first route. Every view returns an unmount function that
// releases everything it holds; leaving an editor whose latest save failed asks
// first. A file dropped outside the menu is never opened in place of the app.
// Controllers: plugging one in or out shows a toast anywhere in the app; the
// menu, the message pages and the gallery can be driven with one (padNav.ts;
// 'b' on a message page or the gallery goes back to the menu).
// Exposes window.__qf for e2e tests and debugging.
import './editor/ui/ui.css';
import './app/app.css';
import type { Project, WarpTarget } from './core/types';
import type { Game } from './game/game';
import type { Editor } from './editor/editor';
import { SAMPLE_PROJECT_ID } from './core/constants';
import { parseRoute, type Nav, type Route } from './app/nav';
import { mountMenu } from './app/menu';
import { showAppMessage } from './app/message';
import { createSampleProject } from './content/sample/sampleProject';
import { TEST_PROJECT_ID, createTestProject } from './content/testProject';
import { cloneProject, newId } from './core/project';
import { deleteProject, downloadProject, listProjects, loadProject } from './core/storage';
import { uniqueName } from './app/format';
import { usabilityError } from './core/validate';
import { confirmAction } from './editor/shell/dialogs';
import { el, toast } from './editor/ui/dom';
import { onPadConnection, trackDevices } from './input/devices';
import { startPadNav } from './app/padNav';

declare global {
  interface Window {
    __qf: {
      route: Route | null;
      game: Game | null;
      editor: Editor | null;
      /** True once the current view has finished mounting. */
      ready: boolean;
      error: string | null;
    };
  }
}

window.__qf = { route: null, game: null, editor: null, ready: false, error: null };
trackDevices();

/** Last connection state per pad slot: one toast per real change (a repeated event says nothing new). */
const padSlots = new Map<number, string>();
onPadConnection((e) => {
  const state = `${e.connected ? '+' : '-'}${e.name}`;
  if (padSlots.get(e.index) === state) return;
  padSlots.set(e.index, state);
  toast(e.connected ? `Controller connected: ${e.name}` : `Controller disconnected: ${e.name}`, 'info', 3200);
});

const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;
/** Bumped per render so a slow load never mounts over a newer route. */
let renderSeq = 0;
/** The address of the view on screen (put back when leaving it is cancelled). */
let shownHash = location.hash;
/** A leave confirmation is open. */
let guarding = false;

const nav: Nav = {
  go(hash: string) {
    if (location.hash === hash) void render();
    else location.hash = hash;
  },
  current: () => parseRoute(location.hash),
};

async function getProject(id: string, forEdit: boolean): Promise<{ project: Project; unsaved: boolean } | null> {
  if (id === SAMPLE_PROJECT_ID) {
    const p = createSampleProject();
    if (!forEdit) return { project: p, unsaved: false };
    const copy = cloneProject(p);
    copy.id = newId('p');
    // Unique like the menu's Duplicate: a second "Edit a copy" gives "(copy 2)", not a same-named twin.
    copy.name = uniqueName(p.name, [p.name, ...(await listProjects().catch(() => [])).map((m) => m.name)], 'copy');
    copy.created = copy.modified = Date.now();
    return { project: copy, unsaved: true };
  }
  if (id === TEST_PROJECT_ID && !forEdit) return { project: createTestProject(), unsaved: false };
  const p = await loadProject(id);
  return p ? { project: p, unsaved: false } : null;
}

function reportError(message: string): void {
  window.__qf.error = message;
}

function showError(msg: string): void {
  reportError(msg);
  root.appendChild(el('div', { class: 'qf-app-error', role: 'alert' },
    el('h2', null, 'Something went wrong'),
    el('pre', null, msg),
    el('a', { href: '#/' }, 'Back to menu')));
}

/** A view driven by the pad too, where 'b' goes back to the menu; returns the combined unmount. */
function withPadNav(unmountView: () => void): () => void {
  const pad = startPadNav(root, { onBack: () => nav.go('#/') });
  return () => {
    pad.stop();
    unmountView();
  };
}

function notFound(title: string, text: string): () => void {
  document.title = 'Not found — Questforge';
  return withPadNav(showAppMessage(root, {
    title, text,
    actions: [
      { label: 'Back to the menu', primary: true, onClick: () => nav.go('#/') },
      { label: 'Play the sample adventure', onClick: () => nav.go('#/play/sample') },
    ],
  }));
}

/** A stored project that is broken beyond use (e.g. no worlds): say so, and offer to back it up or remove it. */
function cannotOpen(project: Project, reason: string): () => void {
  document.title = 'Cannot open — Questforge';
  const remove = async (): Promise<void> => {
    const ok = await confirmAction(`Delete “${project.name}”? It cannot be undone.`, { title: 'Delete project', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteProject(project.id);
      nav.go('#/');
    } catch (err) {
      toast(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  };
  return withPadNav(showAppMessage(root, {
    title: 'This project can’t be opened',
    text: `${reason} Export it to keep a backup, or delete it.`,
    actions: [
      { label: 'Back to the menu', primary: true, onClick: () => nav.go('#/') },
      { label: 'Export a backup', onClick: () => downloadProject(project) },
      { label: 'Delete it', onClick: () => void remove() },
    ],
  }));
}

/** The engine and every entity behaviour (registered on import). */
async function loadGame(): Promise<typeof Game> {
  const [{ Game: GameClass }] = await Promise.all([import('./game/game'), import('./game/entities/index')]);
  return GameClass;
}

/** Full-window game (title screen for 'play', straight into gameplay for 'playtest'). */
async function mountGame(project: Project, mode: 'play' | 'playtest', start: WarpTarget | undefined, seq: number): Promise<(() => void) | null> {
  const GameClass = await loadGame();
  if (seq !== renderSeq) return null;
  const host = el('div', { class: 'qf-game-host' });
  const canvas = el('canvas', { class: 'qf-game-canvas', tabIndex: 0, 'aria-label': `${project.settings.title || project.name} — game screen` });
  host.appendChild(canvas);
  root.appendChild(host);
  document.title = `${project.settings.title || project.name} — Questforge`;
  let created: Game | null = null;
  try {
    created = new GameClass(canvas, project, { mode, start, onExit: () => nav.go('#/'), onError: reportError });
    window.__qf.game = created;
    created.start();
  } catch (err) {
    // The full-window host would cover the error screen render() shows: take it (and the half-started game) down first.
    try {
      created?.destroy();
    } catch {
      // Already failing: the original error is the one to report.
    }
    if (window.__qf.game === created) window.__qf.game = null;
    host.remove();
    throw err;
  }
  const game = created;
  canvas.focus();
  return () => {
    game.destroy();
    if (window.__qf.game === game) window.__qf.game = null;
    host.remove();
  };
}

/** The editor is code-split: the menu and the game never load it. */
async function mountEditor(project: Project, unsaved: boolean, seq: number): Promise<(() => void) | null> {
  const { Editor } = await import('./editor/editor');
  if (seq !== renderSeq) return null;
  const editor = new Editor(root, project, {
    unsaved,
    onExit: () => nav.go('#/'),
    onGame: (game) => {
      window.__qf.game = game;
    },
    onError: reportError,
    onStored: (id) => {
      // The copy now lives in storage: point the address at it without re-mounting
      // (only while this editor is still the view on screen).
      if (window.__qf.editor !== editor) return;
      history.replaceState(null, '', `#/edit/${encodeURIComponent(id)}`);
      shownHash = location.hash;
      window.__qf.route = parseRoute(location.hash);
    },
  });
  window.__qf.editor = editor;
  return () => {
    editor.destroy();
    window.__qf.editor = null;
    window.__qf.game = null;
  };
}

function playtestStart(route: Route): WarpTarget | undefined {
  const w = route.params.get('w');
  const r = route.params.get('r');
  if (route.view !== 'playtest' || !w || !r) return undefined;
  const num = (key: string, fallback: number): number => {
    const v = Number(route.params.get(key));
    return route.params.has(key) && Number.isFinite(v) ? v : fallback;
  };
  return { world: w, room: r, x: num('x', 128), y: num('y', 112) };
}

async function mountRoute(route: Route, seq: number): Promise<(() => void) | null> {
  switch (route.view) {
    case 'menu':
      return mountMenu(root, nav);
    case 'gallery': {
      const { mountGallery } = await import('./gfx/gallery');
      if (seq !== renderSeq) return null;
      document.title = 'Asset gallery — Questforge';
      return withPadNav(mountGallery(root, createSampleProject()));
    }
    case 'notFound':
      return notFound('Page not found', `There is nothing at “${route.path ?? location.hash}”. The link may be mistyped or out of date.`);
    case 'play':
    case 'playtest':
    case 'edit': {
      const id = route.id ?? SAMPLE_PROJECT_ID;
      const got = await getProject(id, route.view === 'edit');
      if (seq !== renderSeq) return null;
      if (!got) return notFound('Project not found', `No project with the id “${id}” is stored in this browser. It may have been deleted, or it was made in another browser — export it there and import it here.`);
      const unusable = usabilityError(got.project);
      if (unusable) return cannotOpen(got.project, unusable);
      if (route.view === 'edit') return mountEditor(got.project, got.unsaved, seq);
      return mountGame(got.project, route.view, playtestStart(route), seq);
    }
  }
}

/**
 * Dialogs belong to the view that opened them. Each modal closes itself on
 * Escape (dropping its key listener and settling its promise), so send one;
 * anything still left is removed.
 */
function closeStrayDialogs(): void {
  if (!document.querySelector('.qf-modal-backdrop')) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  for (const stray of document.querySelectorAll('.qf-modal-backdrop')) stray.remove();
}

async function render(): Promise<void> {
  const seq = ++renderSeq;
  shownHash = location.hash;
  unmount?.();
  unmount = null;
  closeStrayDialogs();
  root.textContent = '';
  window.__qf.ready = false;
  window.__qf.error = null;
  try {
    const route = parseRoute(location.hash);
    window.__qf.route = route;
    const mounted = await mountRoute(route, seq);
    if (seq !== renderSeq) {
      mounted?.();
      return;
    }
    unmount = mounted;
    window.__qf.ready = true;
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    showError(err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err));
  }
}

/**
 * Browser Back or a typed address while the editor's latest save failed: put
 * the editor's address back and ask first (the editor retries the save).
 */
async function onHashChange(): Promise<void> {
  const editor = window.__qf.editor;
  if (!editor?.hasUnsavedFailure) {
    void render();
    return;
  }
  const target = location.hash;
  history.replaceState(null, '', shownHash);
  if (guarding) return;
  guarding = true;
  const leave = await editor.confirmLeave().finally(() => { guarding = false; });
  if (!leave || window.__qf.editor !== editor) return;
  history.replaceState(null, '', target);
  void render();
}

/** A file dropped where no view takes it (the menu imports drops) must not make the browser open it in place of the app. */
function refuseStrayFileDrop(e: DragEvent): void {
  if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
}

window.addEventListener('dragover', refuseStrayFileDrop);
window.addEventListener('drop', refuseStrayFileDrop);
window.addEventListener('hashchange', () => void onHashChange());
void render();
