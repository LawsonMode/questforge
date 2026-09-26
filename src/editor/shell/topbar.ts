// Editor top bar: logo, editable project name, save status, undo/redo,
// playtest, export, help and back-to-menu.
import type { SaveStatus } from './autosave';
import { el } from '../ui/dom';
import { icon, type IconName } from './icons';
import { pixelTextCanvas } from '../../app/pixelText';
import { NAME_MAX_LENGTH } from './rename';

/** Handlers behind the top bar's controls. */
export interface TopBarActions {
  rename(name: string): void;
  undo(): void;
  redo(): void;
  save(): void;
  playtest(): void;
  exportFile(): void;
  help(): void;
  back(): void;
}

/** The top bar element and its updaters. */
export interface TopBar {
  readonly element: HTMLElement;
  setName(name: string): void;
  /** `notStored` = an untouched copy that is not in storage yet. */
  setStatus(status: SaveStatus, notStored: boolean): void;
  /** False when the browser keeps projects only in memory (saves last until the tab closes). */
  setPersistent(persistent: boolean): void;
  setHistory(undoLabel: string | null, redoLabel: string | null): void;
  /** Briefly show (and announce) what an undo/redo just did, e.g. "Undid: Paint tiles". */
  announceHistory(text: string): void;
  /** Stop the pending history-note timer. */
  destroy(): void;
}

const STATUS_TEXT: Readonly<Record<SaveStatus, [string, string]>> = {
  saved: ['Saved', 'All changes are saved in this browser. Ctrl+S saves now.'],
  dirty: ['Unsaved changes', 'Changes are saved automatically in a moment. Ctrl+S saves now.'],
  saving: ['Saving…', 'Saving your changes…'],
  error: ['Save failed', 'Your latest changes could not be saved. Click to try again.'],
};

/** "Saved" states that need a different wording: an untouched sample copy, and storage that is memory only. */
const NOT_STORED_TEXT: [string, string] = ['Not saved yet', 'A copy of the sample: it is stored as a new project as soon as you change something.'];
const VOLATILE_TEXT: [string, string] = ['Saved (this tab only)',
  'This browser is not letting Questforge store projects (private window?): your work lasts only until this tab closes. Use Export to keep a copy.'];

/** How long the "Undid: …" note stays up. */
const HISTORY_NOTE_MS = 2200;

/** Icon button with an accessible label (tooltip = title). */
export function iconButton(name: IconName, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return el('button', {
    class: `qf-btn qf-btn--ghost qf-shell__iconbtn ${cls}`.trim(), type: 'button', title: label,
    'aria-label': label, on: { click: onClick },
  }, icon(name));
}

/** Build the editor's top bar. */
export function createTopBar(initialName: string, actions: TopBarActions): TopBar {
  const name = el('input', {
    class: 'qf-shell__name', type: 'text', value: initialName, maxLength: NAME_MAX_LENGTH,
    title: 'Project name (click to rename)', 'aria-label': 'Project name',
  });
  name.spellcheck = false;
  let committed = initialName;
  name.addEventListener('change', () => {
    const v = name.value.trim();
    if (!v) name.value = committed;
    else if (v !== committed) actions.rename(v);
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
    if (e.key === 'Escape') {
      name.value = committed;
      name.blur();
    }
  });

  const statusText = el('span', { class: 'qf-shell__status-text' });
  const status = el('button', { class: 'qf-shell__status', type: 'button', on: { click: () => actions.save() } },
    el('span', { class: 'qf-shell__status-dot' }), statusText);

  let shown: [SaveStatus, boolean] = ['saved', false];
  let persistent = true;
  const paintStatus = (): void => {
    const [s, notStored] = shown;
    const state = s !== 'saved' ? s : notStored ? 'new' : persistent ? 'saved' : 'volatile';
    const [text, tip] = state === 'new' ? NOT_STORED_TEXT : state === 'volatile' ? VOLATILE_TEXT : STATUS_TEXT[s];
    status.dataset.state = state;
    statusText.textContent = text;
    status.setAttribute('aria-label', text); // the text is hidden at phone width
    status.title = tip;
  };

  const undoBtn = iconButton('undo', 'Undo', actions.undo);
  const redoBtn = iconButton('redo', 'Redo', actions.redo);
  const historyNote = el('span', { class: 'qf-shell__history-note', role: 'status', 'aria-live': 'polite' });
  let noteTimer: ReturnType<typeof setTimeout> | null = null;
  const hideNote = (): void => {
    if (noteTimer !== null) clearTimeout(noteTimer);
    noteTimer = null;
    historyNote.classList.remove('qf-shell__history-note--show');
  };

  const brand = el('a', { class: 'qf-shell__brand', href: '#/', title: 'Questforge — back to the menu', on: { click: (e: MouseEvent) => { e.preventDefault(); actions.back(); } } },
    el('span', { class: 'qf-shell__logo-icon' }, icon('sword', 18)),
    pixelTextCanvas('QUESTFORGE', { color: '#f0c040', shadow: '#3a2a08' }, 2));

  const element = el('header', { class: 'qf-shell__bar' },
    brand,
    el('div', { class: 'qf-shell__project' }, name, status),
    el('div', { class: 'qf-shell__group qf-shell__history', role: 'group', 'aria-label': 'History' }, undoBtn, redoBtn, historyNote),
    el('div', { class: 'qf-grow' }),
    el('div', { class: 'qf-shell__group' },
      el('button', { class: 'qf-btn qf-btn--primary qf-shell__playtest', type: 'button', 'aria-label': 'Playtest (F5)', title: 'Playtest from the start (F5). Shift+F5 plays from the selected room.', on: { click: actions.playtest } },
        icon('play'), el('span', { class: 'qf-shell__playtest-label' }, 'Playtest'), el('span', { class: 'qf-kbd qf-shell__kbd' }, 'F5')),
      el('button', { class: 'qf-btn qf-btn--ghost', type: 'button', title: 'Download this project as a .questforge.json file', on: { click: actions.exportFile } },
        icon('download'), el('span', { class: 'qf-shell__label' }, 'Export')),
      iconButton('help', 'Help & shortcuts (?)', actions.help),
      el('button', { class: 'qf-btn qf-btn--ghost', type: 'button', title: 'Back to the main menu', on: { click: actions.back } },
        icon('back'), el('span', { class: 'qf-shell__label' }, 'Menu'))),
  );

  return {
    element,
    setName(v: string) {
      committed = v;
      if (document.activeElement !== name) name.value = v;
    },
    setStatus(s: SaveStatus, notStored: boolean) {
      shown = [s, notStored];
      paintStatus();
    },
    setPersistent(ok: boolean) {
      persistent = ok;
      paintStatus();
    },
    setHistory(u: string | null, r: string | null) {
      undoBtn.disabled = u === null;
      redoBtn.disabled = r === null;
      undoBtn.title = u === null ? 'Nothing to undo' : `Undo: ${u} (Ctrl+Z)`;
      redoBtn.title = r === null ? 'Nothing to redo' : `Redo: ${r} (Ctrl+Y)`;
      undoBtn.setAttribute('aria-label', undoBtn.title);
      redoBtn.setAttribute('aria-label', redoBtn.title);
    },
    announceHistory(text: string) {
      hideNote();
      historyNote.textContent = text;
      historyNote.title = text;
      historyNote.classList.add('qf-shell__history-note--show');
      noteTimer = setTimeout(hideNote, HISTORY_NOTE_MS);
    },
    destroy: hideNote,
  };
}
