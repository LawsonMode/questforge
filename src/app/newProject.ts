// "New project" dialog: name, author and a blank or from-the-sample start.
import type { Project } from '../core/types';
import { cloneProject, createBlankProject, newId } from '../core/project';
import { getSetting, setSetting } from '../core/storage';
import { createSampleProject } from '../content/sample/sampleProject';
import { el, modal } from '../editor/ui/dom';
import { icon } from '../editor/shell/icons';
import { NAME_MAX_LENGTH } from '../editor/shell/rename';

/** What a new project starts from. */
export type ProjectTemplate = 'blank' | 'sample';

const AUTHOR_SETTING = 'author';

/** The name a new project is offered (the menu numbers it when taken). */
export const DEFAULT_PROJECT_NAME = 'My Adventure';

/** Build (but do not store) a new project. */
export function buildNewProject(template: ProjectTemplate, name: string, author: string): Project {
  if (template === 'blank') return createBlankProject(name, author);
  const p = cloneProject(createSampleProject());
  const now = Date.now();
  p.id = newId('p');
  p.name = name;
  p.author = author;
  p.created = now;
  p.modified = now;
  return p;
}

function choice(value: ProjectTemplate, title: string, text: string, checked: boolean): HTMLLabelElement {
  return el('label', { class: 'qf-menu-choice' },
    el('input', { type: 'radio', name: 'qf-new-template', value, checked }),
    el('span', { class: 'qf-menu-choice__box' },
      el('span', { class: 'qf-menu-choice__title' }, icon(value === 'blank' ? 'plus' : 'copy', 14), title),
      el('span', { class: 'qf-menu-choice__text' }, text)));
}

/**
 * Ask for the new project's details, offering `defaultName`; `onCreate` stores
 * it (resolve false to keep the dialog open, e.g. after a failed save).
 */
export function showNewProjectDialog(initial: ProjectTemplate, defaultName: string, onCreate: (p: Project) => Promise<boolean>): void {
  const name = el('input', { class: 'qf-input', type: 'text', value: defaultName, maxLength: NAME_MAX_LENGTH, 'aria-label': 'Project name' });
  const author = el('input', { class: 'qf-input', type: 'text', value: getSetting(AUTHOR_SETTING, ''), maxLength: 60, placeholder: 'Your name', 'aria-label': 'Author' });
  const form = el('form', { class: 'qf-menu-new' },
    el('label', { class: 'qf-menu-new__field' }, el('span', null, 'Name'), name),
    el('label', { class: 'qf-menu-new__field' }, el('span', null, 'Author'), author),
    el('fieldset', { class: 'qf-menu-new__choices' },
      el('legend', null, 'Start from'),
      choice('blank', 'Blank', 'One grassy room and all the default tiles, sprites and music.', initial === 'blank'),
      choice('sample', 'The sample adventure', 'A copy of the sample to take apart, study and remix.', initial === 'sample')));
  const build = (): Project | null => {
    const n = name.value.trim() || defaultName;
    const a = author.value.trim();
    const picked = form.querySelector<HTMLInputElement>('input[name="qf-new-template"]:checked');
    const template: ProjectTemplate = picked?.value === 'sample' ? 'sample' : 'blank';
    setSetting(AUTHOR_SETTING, a);
    try {
      return buildNewProject(template, n, a);
    } catch (err) {
      console.error('[menu] could not build the project:', err);
      return null;
    }
  };
  let createButton: HTMLButtonElement | null = null;
  let busy = false;
  /** Build and store once: a double click or a second Enter while storing does nothing. */
  const create = async (): Promise<boolean> => {
    if (busy) return false;
    const project = build();
    if (!project) return false;
    busy = true;
    if (createButton) createButton.disabled = true;
    let ok = false;
    try {
      ok = await onCreate(project);
    } finally {
      // Once stored the dialog closes, so it stays locked; after a failure it can be tried again.
      if (!ok) {
        busy = false;
        if (createButton) createButton.disabled = false;
      }
    }
    return ok;
  };
  const handle = modal({
    title: 'New project',
    body: form,
    buttons: [
      { label: 'Cancel' },
      { label: 'Create project', kind: 'primary', onClick: create },
    ],
  });
  createButton = handle.body.parentElement?.querySelector<HTMLButtonElement>('.qf-modal__footer .qf-btn--primary') ?? null;
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    if (busy) return;
    void create().then((ok) => {
      if (ok) handle.close();
    });
  });
  name.select();
}
