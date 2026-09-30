// Main menu / project hub: animated pixel banner, "Play the sample adventure"
// and "Build your own", the "Your projects" grid (play, edit, duplicate,
// export, delete), new project (blank or from the sample), import of
// .questforge.json files (button, or a drop anywhere on the page), controls
// help (keyboard and controller columns), a sound on/off toggle and the
// version footer. With a controller: pad navigation (padNav.ts) and the
// controller banner (padBanner.ts: button layout, vibration).
import './menu.css';
import type { Project } from '../core/types';
import type { Nav } from './nav';
import { version as APP_VERSION } from '../../package.json';
import { SAMPLE_PROJECT_ID } from '../core/constants';
import {
  deleteProject, downloadProject, duplicateProject, listProjects, loadProject, readProjectFile, saveProject,
  storageIsPersistent, type ProjectMeta,
} from '../core/storage';
import { createSampleProject } from '../content/sample/sampleProject';
import { currentControls, onControlsChange, onPadConnection } from '../input/devices';
import { el, setChildren, toast } from '../editor/ui/dom';
import { icon } from '../editor/shell/icons';
import { confirmAction } from '../editor/shell/dialogs';
import { createBanner } from './banner';
import { createCard, metaInfo, type Card } from './projectCards';
import { DEFAULT_PROJECT_NAME, showNewProjectDialog } from './newProject';
import { plural, shortName, uniqueName } from './format';
import { createSoundToggle } from './soundToggle';
import { GAME_CONTROLS, keyboardKeys, knownPad, labelPad, padButtons, padGlyph } from './controls';
import { createPadBanner } from './padBanner';
import { startPadNav } from './padNav';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function heroButton(iconName: 'play' | 'edit', title: string, text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  return el('button', { class: `qf-menu-cta${primary ? ' qf-menu-cta--primary' : ''}`, type: 'button', on: { click: onClick } },
    el('span', { class: 'qf-menu-cta__icon' }, icon(iconName, 22)),
    el('span', { class: 'qf-menu-cta__text' },
      el('span', { class: 'qf-menu-cta__title' }, title),
      el('span', { class: 'qf-menu-cta__sub' }, text)));
}

/** The Controls card: keyboard keys and controller buttons side by side, redrawn when the controller changes. */
function controlsCard(): { element: HTMLElement; destroy(): void } {
  const table = el('div', { class: 'qf-menu-keys-table' });
  const note = el('p', { class: 'qf-menu-side__note' });
  const draw = (): void => {
    const pad = labelPad();
    table.replaceChildren(
      el('div', { class: 'qf-menu-keys__head', 'aria-hidden': 'true' },
        el('span'), el('span', null, 'Keyboard'), el('span', null, 'Controller')),
      el('dl', { class: 'qf-menu-keys' }, GAME_CONTROLS.map(({ button, what, short }) => {
        const keys = keyboardKeys(button);
        const pads = padButtons(button, pad);
        return el('div', { class: 'qf-menu-keys__row', title: what },
          el('dt', { class: 'qf-menu-keys__kb', 'aria-label': `Keyboard: ${keys.join(' or ')}` },
            keys.map((k) => el('kbd', { class: 'qf-kbd' }, k))),
          el('dt', { class: 'qf-menu-keys__pad', 'aria-label': `Controller: ${pads.join(' or ')}` },
            pads.map((k) => padGlyph(k))),
          el('dd', null, short));
      })));
    note.replaceChildren(
      knownPad() ? 'Your controller finds its way around this page too. ' : 'Plug in a controller and press a button to use it here and in the game. ',
      'In the editor, press ', el('kbd', { class: 'qf-kbd' }, 'F5'), ' to playtest and ', el('kbd', { class: 'qf-kbd' }, 'Esc'), ' to come back.');
  };
  const offs = [onControlsChange(draw), onPadConnection(draw)];
  draw();
  const element = el('section', { class: 'qf-menu-side__card', 'aria-labelledby': 'qf-menu-controls' },
    el('h2', { class: 'qf-menu-side__title', id: 'qf-menu-controls' }, 'Controls'), table, note);
  return {
    element,
    destroy: () => {
      for (const off of offs) off();
    },
  };
}

function aboutCard(): HTMLElement {
  return el('section', { class: 'qf-menu-side__card', 'aria-labelledby': 'qf-menu-about' },
    el('h2', { class: 'qf-menu-side__title', id: 'qf-menu-about' }, 'How it works'),
    el('ol', { class: 'qf-menu-steps' },
      el('li', null, el('b', null, 'Paint rooms'), ' with tiles and terrain brushes on the Map tab.'),
      el('li', null, el('b', null, 'Place'), ' enemies, chests, doors, switches and people.'),
      el('li', null, el('b', null, 'Draw'), ' your own tiles and sprites on the Art tab.'),
      el('li', null, el('b', null, 'Playtest'), ' any time, then export and share your adventure.')),
    el('p', { class: 'qf-menu-side__note' }, 'Projects are saved in this browser. Export a ', el('code', null, '.questforge.json'),
      ' file to back one up or share it — anyone can import it here.'));
}

/** Whether a drag carries files (not text or a dragged element). */
function draggingFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

/** Fallback: the highlight goes this long after the last dragover (dragover repeats while a file is over the page). */
const DRAG_LINGER_MS = 1000;

/**
 * Accept a file dropped anywhere on the page (the browser would otherwise
 * open it in place of the app). `highlight` shows while a file is dragged
 * over the window. Returns the remover.
 */
function fileDropZone(highlight: (on: boolean) => void, onFile: (file: File) => void): () => void {
  /** dragenter minus dragleave: 0 once the pointer has left the window. */
  let depth = 0;
  let linger: ReturnType<typeof setTimeout> | null = null;
  const off = (): void => {
    depth = 0;
    if (linger !== null) clearTimeout(linger);
    linger = null;
    highlight(false);
  };
  const on = (): void => {
    highlight(true);
    if (linger !== null) clearTimeout(linger);
    linger = setTimeout(off, DRAG_LINGER_MS);
  };
  const onEnter = (e: DragEvent): void => {
    if (!draggingFiles(e)) return;
    depth++;
    on();
  };
  const onOver = (e: DragEvent): void => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    on();
  };
  const onLeave = (e: DragEvent): void => {
    if (!draggingFiles(e)) return;
    depth--;
    if (depth <= 0) off();
  };
  const onDrop = (e: DragEvent): void => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    off();
    const file = e.dataTransfer?.files[0];
    if (file) onFile(file);
  };
  const listeners: [string, (e: DragEvent) => void][] = [
    ['dragenter', onEnter], ['dragover', onOver], ['dragleave', onLeave], ['drop', onDrop], ['dragend', off],
  ];
  // On the document, so these run before main.ts's window-level guard against stray drops.
  for (const [type, fn] of listeners) document.addEventListener(type, fn as EventListener);
  return () => {
    for (const [type, fn] of listeners) document.removeEventListener(type, fn as EventListener);
    off();
  };
}

/** Mount the menu into `root`; returns the unmount function. */
export function mountMenu(root: HTMLElement, nav: Nav): () => void {
  let alive = true;
  let sample: Project | null = null;
  document.title = 'Questforge — build & play 16-bit adventures';

  const getSample = (): Project => (sample ??= createSampleProject());
  const banner = createBanner();
  const padBanner = createPadBanner();
  const controls = controlsCard();
  const warning = el('div', { class: 'qf-menu-warning', role: 'status', hidden: true },
    icon('warning'),
    el('span', null, 'This browser is not letting Questforge store projects (private window?). New projects last only until this tab closes — export anything you want to keep.'));
  const count = el('span', { class: 'qf-menu-count' });
  const grid = el('div', { class: 'qf-menu-grid', role: 'list', 'aria-label': 'Your projects' });
  const fileInput = el('input', { type: 'file', accept: '.json,.questforge.json,application/json', hidden: true, 'aria-hidden': 'true', tabIndex: -1 });
  /** Names of the stored projects as last listed (new-project defaults avoid them). */
  let knownNames: string[] = [];

  /** Stored project names, fresh from storage (an unreadable list counts as empty). */
  const storedNames = async (): Promise<string[]> => (await listProjects().catch(() => [])).map((m) => m.name);

  const newProject = (template: 'blank' | 'sample' = 'blank'): void => {
    showNewProjectDialog(template, uniqueName(DEFAULT_PROJECT_NAME, knownNames), async (p) => {
      try {
        await saveProject(p);
      } catch (err) {
        toast(`Couldn't create the project: ${errorText(err)}`, 'error', 5000);
        return false;
      }
      nav.go(`#/edit/${encodeURIComponent(p.id)}`);
      return true;
    });
  };

  const withProject = async (id: string, fn: (p: Project) => Promise<void> | void): Promise<void> => {
    try {
      const p = id === SAMPLE_PROJECT_ID ? getSample() : await loadProject(id);
      if (!p) throw new Error('It is no longer in this browser.');
      await fn(p);
    } catch (err) {
      toast(`Something went wrong: ${errorText(err)}`, 'error', 5000);
    }
  };

  const duplicate = (id: string): Promise<void> => withProject(id, async (p) => {
    const copy = await duplicateProject(p, uniqueName(p.name, [p.name, ...await storedNames()], 'copy'));
    toast(`Duplicated as “${shortName(copy.name)}”`, 'success');
    await refresh(copy.id);
  });

  const exportFile = (id: string): Promise<void> => withProject(id, (p) => {
    downloadProject(p);
    toast(`Exported “${shortName(p.name)}”`, 'success');
  });

  /** After a delete re-rendered the grid: focus the card that took the deleted one's place (keyboard users keep their spot). */
  const focusNear = (index: number): void => {
    const cards = [...grid.querySelectorAll<HTMLElement>('.qf-menu-card')];
    const card = cards[index] ?? cards[index - 1];
    const target = card?.querySelector<HTMLElement>('.qf-menu-card__delete')
      ?? grid.querySelector<HTMLElement>('.qf-menu-empty .qf-btn')
      ?? card?.querySelector<HTMLElement>('.qf-menu-card__play');
    target?.focus();
  };

  const remove = async (m: ProjectMeta): Promise<void> => {
    const ok = await confirmAction(`Delete “${m.name}”? This removes the project and its save files from this browser. It cannot be undone.`,
      { title: 'Delete project', ok: 'Delete', danger: true });
    if (!ok || !alive) return;
    const index = [...grid.querySelectorAll<HTMLElement>('.qf-menu-card')].findIndex((c) => c.dataset.projectId === m.id);
    try {
      await deleteProject(m.id);
      toast(`Deleted “${shortName(m.name)}”`, 'info');
    } catch (err) {
      toast(`Couldn't delete: ${errorText(err)}`, 'error', 5000);
    }
    await refresh();
    const focused = document.activeElement;
    if (alive && (!focused || focused === document.body || !focused.isConnected)) focusNear(index);
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const p = await readProjectFile(file);
      // A second copy of a project already here (e.g. a backup brought back) must not look identical to it.
      p.name = uniqueName(p.name, await storedNames(), 'imported');
      await saveProject(p);
      toast(`Imported “${shortName(p.name)}”`, 'success');
      await refresh(p.id);
    } catch (err) {
      toast(`Couldn't import ${shortName(file.name)}: ${errorText(err)}`, 'error', 6000);
    }
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importFile(file);
  });

  const sampleCard = createCard(
    { id: SAMPLE_PROJECT_ID, name: 'The sample adventure', meta: 'Built-in example quest', badge: 'Sample', editLabel: 'Edit a copy' },
    {
      play: () => nav.go('#/play/sample'),
      edit: () => nav.go('#/edit/sample'),
      duplicate: () => void duplicate(SAMPLE_PROJECT_ID),
      exportFile: () => void exportFile(SAMPLE_PROJECT_ID),
    });

  /** Load and paint the thumbnails one by one (stops once a newer refresh or the unmount supersedes it). */
  const paintThumbnails = async (cards: readonly [ProjectMeta, Card][], current: () => boolean): Promise<void> => {
    for (const [m, card] of cards) {
      const p = await loadProject(m.id).catch(() => null);
      if (!current()) return;
      if (!p) {
        card.fail();
        continue;
      }
      try {
        card.paint(p);
      } catch (err) {
        // One broken project must not stop the thumbnails after it.
        console.warn(`[menu] couldn't draw the thumbnail of "${m.name}":`, err);
        card.fail();
      }
    }
  };

  let refreshSeq = 0;
  /** Cards for the stored projects (resolves once they are shown; the thumbnails follow). */
  const refresh = async (highlight?: string): Promise<void> => {
    const seq = ++refreshSeq;
    const current = (): boolean => alive && seq === refreshSeq;
    let metas: ProjectMeta[];
    try {
      metas = await listProjects();
    } catch (err) {
      metas = [];
      toast(`Couldn't list your projects: ${errorText(err)}`, 'error', 5000);
    }
    if (!current()) return;
    knownNames = metas.map((m) => m.name);
    count.textContent = metas.length ? plural(metas.length, 'project') : '';
    const cards: [ProjectMeta, Card][] = metas.map((m) => [m, createCard(metaInfo(m), {
      play: () => nav.go(`#/play/${encodeURIComponent(m.id)}`),
      edit: () => nav.go(`#/edit/${encodeURIComponent(m.id)}`),
      duplicate: () => void duplicate(m.id),
      exportFile: () => void exportFile(m.id),
      remove: () => void remove(m),
    })]);
    const empty = metas.length ? null : el('div', { class: 'qf-menu-empty', role: 'listitem' },
      el('div', { class: 'qf-menu-empty__title' }, 'No projects yet'),
      el('p', null, 'Start a new adventure from scratch or from a copy of the sample.'),
      el('button', { class: 'qf-btn qf-btn--primary', type: 'button', on: { click: () => newProject() } }, icon('plus', 14), 'New project'));
    setChildren(grid, sampleCard.element, cards.map(([, c]) => c.element), empty);
    for (const node of grid.children) if (node.classList.contains('qf-menu-card')) node.setAttribute('role', 'listitem');
    if (highlight) {
      const hit = cards.find(([m]) => m.id === highlight)?.[1].element;
      hit?.classList.add('qf-menu-card--new');
      hit?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    void paintThumbnails(cards, current);
  };

  const projects = el('section', { class: 'qf-menu-projects', 'aria-labelledby': 'qf-menu-projects-title' },
    el('div', { class: 'qf-menu-projects__head' },
      el('h2', { class: 'qf-menu-projects__title', id: 'qf-menu-projects-title' }, 'Your projects'), count,
      el('div', { class: 'qf-grow' }),
      el('button', { class: 'qf-btn qf-btn--primary qf-menu-new-btn', type: 'button', on: { click: () => newProject() } }, icon('plus', 14), 'New project'),
      el('button', { class: 'qf-btn qf-menu-import-btn', type: 'button', title: 'Import a project from a .questforge.json file (you can also drop one anywhere on this page)', on: { click: () => fileInput.click() } },
        icon('upload', 14), 'Import .questforge.json'),
      fileInput),
    grid);
  const dropZone = fileDropZone((on) => projects.classList.toggle('qf-menu-projects--drop', on), (file) => void importFile(file));
  const playSample = heroButton('play', 'Play the sample adventure', 'A short quest with a village, a dungeon, puzzles and a boss.', true, () => nav.go('#/play/sample'));
  const view = el('div', { class: 'qf-menu' },
    el('header', { class: 'qf-menu-hero' },
      el('h1', { class: 'qf-sr-only' }, 'Questforge'),
      el('div', { class: 'qf-menu-banner' }, banner.element),
      el('div', { class: 'qf-menu-ctas' },
        playSample,
        heroButton('edit', 'Build your own', 'Start a new adventure — blank, or from a copy of the sample.', false, () => newProject()))),
    el('main', { class: 'qf-menu-main' },
      padBanner.element,
      warning,
      el('div', { class: 'qf-menu-columns' },
        projects,
        el('aside', { class: 'qf-menu-side' }, controls.element, aboutCard()))),
    el('footer', { class: 'qf-menu-footer' },
      el('span', null, `Questforge v${APP_VERSION}`),
      el('span', { class: 'qf-menu-footer__dot', 'aria-hidden': 'true' }, '·'),
      el('span', null, 'Original art, music and story'),
      el('span', { class: 'qf-menu-footer__dot', 'aria-hidden': 'true' }, '·'),
      el('a', { href: '#/gallery' }, 'Asset gallery'),
      el('span', { class: 'qf-menu-footer__dot', 'aria-hidden': 'true' }, '·'),
      createSoundToggle('qf-btn--ghost qf-menu-sound').element,
      el('p', { class: 'qf-menu-tribute' },
        'Inspired by ', el('i', null, 'The Legend of Zelda: A Link to the Past'),
        '. Questforge is an independent fan project with no ties to Nintendo or The Legend of Zelda series. ',
        el('b', null, 'Go play the originals!'))));
  root.appendChild(view);
  // Back from a game played with the pad: focus starts on "Play the sample adventure", ring shown.
  const padNav = startPadNav(view, { initial: () => playSample, autofocus: currentControls().device === 'gamepad' });

  void refresh();
  void storageIsPersistent().then((ok) => {
    if (alive) warning.hidden = ok;
  });
  // Build the sample's thumbnail after the first paint.
  const sampleTimer = setTimeout(() => {
    if (!alive) return;
    try {
      const p = getSample();
      sampleCard.paint(p);
      const rooms = p.worlds.reduce((n, w) => n + w.rooms.length, 0);
      const meta = sampleCard.element.querySelector('.qf-menu-card__meta');
      if (meta) meta.textContent = `${p.name} · ${plural(rooms, 'room')}`;
    } catch (err) {
      console.error('[menu] the sample adventure failed to load:', err);
      sampleCard.fail();
    }
  }, 30);

  return () => {
    alive = false;
    clearTimeout(sampleTimer);
    padNav.stop();
    dropZone();
    banner.destroy();
    padBanner.destroy();
    controls.destroy();
    view.remove();
  };
}
