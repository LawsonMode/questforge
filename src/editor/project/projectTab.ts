// Project tab: settings (title, subtitle, author, description, start hearts &
// items, intro dialogue, title music with preview, start location), worlds
// summary, live validation report with jump-to buttons and project stats.
import './project.css';
import type { EditorContext, Panel, ProjectChange } from '../context';
import type { Section } from './env';
import { createEnv } from './env';
import { settingsForm } from './settingsForm';
import { reportSections } from './reports';
import { el } from '../ui/dom';
import { hasSaveStatus } from '../shell/context';

/** Quiet period before validation & stats re-run after an edit. */
const REPORT_DELAY_MS = 250;

/** Changes that affect the settings form (dialogue list, names, start). */
const FORM_CHANGES: ReadonlySet<ProjectChange> = new Set(['settings', 'dialogues', 'all']);
/** Changes that affect the start preview. */
const START_CHANGES: ReadonlySet<ProjectChange> = new Set(['settings', 'worlds', 'rooms', 'room', 'entities', 'tiles', 'sprites', 'palettes', 'all']);

/** Mount the Project tab into `root`. */
export function mountProjectTab(root: HTMLElement, ctx: EditorContext): Panel {
  const env = createEnv(ctx);
  const form = settingsForm(env);
  const reports = reportSections(env);
  const view = el('div', { class: 'qf-proj' },
    el('header', { class: 'qf-proj__head' },
      el('h2', { class: 'qf-proj__title' }, 'Project'),
      el('p', { class: 'qf-proj__lead qf-muted' }, 'How your adventure starts, what it is called, and whether anything needs fixing before you share it.')),
    el('div', { class: 'qf-proj__grid' },
      el('div', { class: 'qf-proj__col' }, form.elements),
      el('div', { class: 'qf-proj__col' },
        reports.start.elements, reports.validation.elements, reports.worlds.elements, reports.stats.elements)));
  root.appendChild(view);

  const live: Section[] = [reports.validation, reports.worlds, reports.stats];
  const stale = { form: false, start: false, reports: false };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const shown = (): boolean => view.isConnected && view.offsetParent !== null;
  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!shown()) return;
    if (stale.form) form.sync();
    if (stale.start) reports.start.sync();
    if (stale.reports) for (const s of live) s.sync();
    stale.form = stale.start = stale.reports = false;
  };
  /** Mark parts stale; visible parts refresh (form & start at once, reports after a pause). */
  const invalidate = (parts: { form?: boolean; start?: boolean }): void => {
    stale.form ||= !!parts.form;
    stale.start ||= !!parts.start;
    stale.reports = true;
    if (!shown()) return;
    if (parts.form) form.sync();
    if (parts.start) reports.start.sync();
    stale.form = stale.start = false;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, REPORT_DELAY_MS);
  };

  const offs = [
    ctx.bus.on('project', ({ what }) => invalidate({ form: FORM_CHANGES.has(what), start: START_CHANGES.has(what) })),
    ctx.bus.on('assets', () => invalidate({ form: true, start: true })),
    ctx.bus.on('undo', () => invalidate({ form: true, start: true })),
    ctx.bus.on('tab', ({ id }) => {
      if (id !== 'project') form.stopPreview();
    }),
  ];
  // "Last saved" follows the autosave (hidden, the next show refreshes everything anyway).
  if (hasSaveStatus(ctx)) {
    offs.push(ctx.onSaveStatus((status) => {
      if (status === 'saved' && shown()) reports.stats.syncDates();
    }));
  }

  const refreshAll = (): void => {
    stale.form = stale.start = stale.reports = true;
    flush();
  };
  refreshAll();

  return {
    refresh: refreshAll,
    destroy() {
      for (const off of offs) off();
      if (timer !== null) clearTimeout(timer);
      form.destroy?.();
      view.remove();
    },
  };
}
