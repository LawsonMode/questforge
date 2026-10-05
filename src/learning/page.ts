// My Learning page (#/learning): the proposed level (1-4) for every skill, why,
// the work that proves it (trigger code, pixel data), the standards each skill
// maps to, a timeline, and what Questforge records (the activity manifest, for
// teachers). Export writes the file Quark (or the teacher) reads.
import './learning.css';
import { el, setChildren, toast } from '../editor/ui/dom';
import { confirmAction } from '../editor/shell/dialogs';
import { tokenizeCode } from '../editor/entities/triggerCode';
import { ACTIVITIES, activityInfo } from './activities';
import { downloadLearningExport } from './export';
import { proposeLevels, type SkillLevel } from './levels';
import { clearLearning, listLearning, onLearning, type LearningEvent } from './log';
import { LEVEL_NAMES, SKILLS, skillById, type Level, type Skill } from './standards';

const ALL = '';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function codeBlock(text: string): HTMLPreElement {
  return el('pre', { class: 'qf-code' }, text.split('\n').flatMap((line, i) => [
    ...(i > 0 ? ['\n'] : []),
    ...tokenizeCode(line).map((t) => (t.kind === 'txt' ? t.text : el('span', { class: `qf-code__${t.kind}` }, t.text))),
  ]));
}

function eventLine(e: LearningEvent): HTMLElement {
  const info = activityInfo(e.object.activity);
  const response = e.result?.response;
  const isCode = e.object.activity === 'qf.trigger.built' || e.object.activity === 'qf.trigger.fixed';
  return el('div', { class: 'qf-learn-ev' },
    el('div', null, el('b', null, info?.label ?? e.object.activity), e.object.name ? ` — ${e.object.name}` : ''),
    el('div', { class: 'qf-learn-ev__meta' }, `${when(e.time)} · ${e.context.projectName}`),
    response && isCode ? codeBlock(response) : null,
    response && !isCode && e.object.activity === 'qf.pixels.drawn' ? el('pre', { class: 'qf-code' }, (response.match(/.{1,16}/g) ?? []).join('\n')) : null);
}

function meter(level: Level, max: Level): HTMLElement {
  return el('div', { class: 'qf-learn-meter', role: 'img', 'aria-label': `Level ${level} of 4` },
    [1, 2, 3, 4].map((n) => el('span', { class: n <= level ? 'on' : n > max ? 'cap' : '' })));
}

function skillCard(s: Skill, lv: SkillLevel, byId: Map<string, LearningEvent>): HTMLElement {
  const next = lv.level < 4 ? (lv.level < s.maxLevel ? (s.levels as readonly string[])[lv.level] : s.beyond) : null;
  const codes = [
    ...s.codes.idaho.map((c) => ({ text: `Idaho ${c.code}${c.weight ? (c.weight === 'essential' ? ' (E)' : ' (S)') : ''}`, c })),
    ...s.codes.dl.map((c) => ({ text: `DL ${c.code}`, c })),
    ...s.codes.csta.map((c) => ({ text: `CSTA ${c.code}`, c })),
    ...s.codes.iste.map((c) => ({ text: `ISTE ${c.code}`, c })),
  ];
  const evidence = lv.evidence.map((id) => byId.get(id)).filter((e): e is LearningEvent => !!e);
  return el('article', { class: 'qf-learn-skill', dataset: { skill: s.id } },
    el('div', { class: 'qf-learn-skill__top' },
      el('span', { class: 'qf-learn-skill__name' }, s.name),
      el('span', { class: 'qf-learn-skill__lvl' }, `Level ${lv.level} · ${LEVEL_NAMES[lv.level]}`)),
    meter(lv.level, s.maxLevel),
    el('p', { class: 'qf-learn-skill__ican' }, s.iCan),
    el('div', { class: 'qf-learn-codes' }, codes.map(({ text, c }) =>
      el('span', { class: c.verify ? 'verify' : '', title: `${c.label}${c.verify ? ' (proposed alignment: verify)' : ''}` }, text))),
    lv.reasons.length ? el('ul', null, lv.reasons.map((r) => el('li', null, r))) : null,
    next ? el('p', { class: 'qf-learn-skill__next' }, el('b', null, lv.level < s.maxLevel ? `Next (level ${lv.level + 1}): ` : 'Beyond this app: '), next) : null,
    evidence.length ? el('details', null, el('summary', null, `Evidence (${evidence.length})`),
      el('div', { class: 'qf-learn-evidence' }, evidence.map(eventLine))) : null);
}

function manifestTable(): HTMLElement {
  return el('table', { class: 'qf-learn__manifest' },
    el('thead', null, el('tr', null, el('th', null, 'Activity'), el('th', null, 'Verb'), el('th', null, 'Evidence for'), el('th', null, 'What it is'))),
    el('tbody', null, ACTIVITIES.map((a) => el('tr', null,
      el('td', null, el('code', null, a.id)),
      el('td', null, a.verb),
      el('td', null, a.skills.map((s) => skillById(s)?.name ?? s).join(', ') || '—'),
      el('td', null, a.description)))));
}

export function mountLearning(root: HTMLElement, opts: { back: () => void }): () => void {
  let alive = true;
  let events: LearningEvent[] = [];
  let project = ALL;
  const picker = el('select', { class: 'qf-select', title: 'Show the evidence from one project or all of them' });
  const skills = el('div', { class: 'qf-learn__skills' });
  const timeline = el('ul', { class: 'qf-learn__timeline' });
  const empty = el('p', { class: 'qf-learn__empty', hidden: true },
    'Nothing recorded yet. Open a project in the editor: build triggers, open “Show as code”, playtest, and draw on the Art tab. Your work shows up here.');
  const btn = (label: string, onClick: () => void, cls = 'qf-btn'): HTMLButtonElement =>
    el('button', { class: cls, type: 'button', on: { click: onClick } }, label);

  const render = (): void => {
    const projects = new Map<string, string>();
    for (const e of events) projects.set(e.context.projectId, e.context.projectName);
    if (project !== ALL && !projects.has(project)) project = ALL;
    setChildren(picker, el('option', { value: ALL }, 'All projects'),
      [...projects].map(([id, name]) => el('option', { value: id }, name)));
    picker.value = project;
    const shown = project === ALL ? events : events.filter((e) => e.context.projectId === project);
    const byId = new Map(shown.map((e) => [e.id, e]));
    const levels = proposeLevels(shown);
    setChildren(skills, SKILLS.map((s) => skillCard(s, levels.find((l) => l.skill === s.id)!, byId)));
    setChildren(timeline, [...shown].reverse().slice(0, 60).map((e) => el('li', null,
      el('time', { dateTime: e.time }, when(e.time)),
      el('span', null, activityInfo(e.object.activity)?.label ?? e.object.activity, e.object.name ? ` — ${e.object.name}` : ''),
      el('span', { class: 'qf-learn-ev__meta' }, e.context.projectName))));
    empty.hidden = shown.length > 0;
  };

  const load = async (): Promise<void> => {
    try {
      events = await listLearning();
    } catch (err) {
      toast(`Couldn't read your learning log: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
      events = [];
    }
    if (alive) render();
  };

  picker.addEventListener('change', () => {
    project = picker.value;
    render();
  });

  const clear = async (): Promise<void> => {
    const ok = await confirmAction('Delete everything recorded in this browser? Export it first if you need to turn it in. This cannot be undone.', {
      title: 'Clear my learning log', ok: 'Delete it all', danger: true,
    });
    if (!ok) return;
    await clearLearning();
    await load();
    toast('Learning log cleared.');
  };

  const view = el('div', { class: 'qf-learn' },
    el('header', { class: 'qf-learn__head' },
      el('h1', null, 'My Learning'),
      picker,
      btn('Export for my teacher', () => downloadLearningExport(project === ALL ? events : events.filter((e) => e.context.projectId === project)), 'qf-btn qf-btn--primary'),
      btn('Clear…', () => void clear()),
      btn('Back to the menu', opts.back)),
    el('p', { class: 'qf-learn__intro' },
      'Questforge keeps a record of what you build: the triggers you write (saved as code), the bugs you fix, your playtests and your pixel art. ',
      'From that work it proposes a level from 1 to 4 for each skill below. Your teacher looks at the evidence and confirms it. ',
      'The record stays in this browser until you export it.'),
    empty,
    skills,
    el('h2', null, 'Recent activity'),
    timeline,
    el('h2', null, 'For teachers: what Questforge records'),
    el('p', { class: 'qf-learn__intro' },
      'Standards are mapped by activity (below), never claimed by an event. Codes with a dashed border are proposed alignments to verify. ',
      'Levels 3-4 count only triggers the student wrote: work that came with the sample or an import counts at most as level 2.'),
    manifestTable());
  root.appendChild(view);
  const off = onLearning(() => void load());
  void load();
  return () => {
    alive = false;
    off();
    view.remove();
  };
}
