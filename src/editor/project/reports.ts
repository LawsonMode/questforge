// Project tab read-outs: start location (with a preview and "Pick on map"),
// live validation report with jump-to buttons, worlds summary and stats.
import type { Dir, Room, WarpTarget } from '../../core/types';
import type { Problem } from '../../core/validate';
import type { ProjectTabEnv, Section } from './env';
import { validateProject } from '../../core/validate';
import { SCREEN_H, SCREEN_W } from '../../core/constants';
import { findRoom, findWorld } from '../../core/project';
import { button, el, panel, pixelCanvas, setChildren, setSelectOptions, type Child } from '../ui/dom';
import { icon } from '../shell/icons';
import { hasSaveStatus } from '../shell/context';
import { requestDialogueFocus, requestEntityFocus, requestTriggerFocus } from '../entities/focus';
import { paintStartScreen, type StartPaint } from '../../app/thumbnail';
import { fullDate, plural, relativeTime } from '../../app/format';
import { capRows, groupProblems, problemTarget, projectStats, summarizeWorld, type ProblemTarget, type WorldSummary } from './stats';

const DIRS: readonly Dir[] = ['down', 'up', 'left', 'right'];
const KIND_LABEL = { overworld: 'Overworld', dungeon: 'Dungeon', interior: 'Interior' } as const;

/** Show a problem's location in the editor (the map opens the trigger's or entity's sidebar, the Dialogue tab selects the dialogue). */
function goTo(env: ProjectTabEnv, t: NonNullable<ProblemTarget>, revealStart: () => void, origin: HTMLElement): void {
  const { ctx } = env;
  if (t.tab === 'project') {
    if (t.section === 'start') revealStart();
    else revealIntro(origin);
    return;
  }
  if (t.tab === 'map') {
    if (t.trigger && t.room) requestTriggerFocus(t.room, t.trigger);
    if (t.entity && t.room) requestEntityFocus(t.room, t.entity);
    ctx.selectRoom(t.world, t.room);
    if (t.entity) ctx.selectEntity(t.entity);
  } else if (t.tab === 'dialogue') {
    requestDialogueFocus(t.dialogue);
  } else if (t.tile !== undefined) {
    ctx.selectTile(t.tile);
  }
  ctx.switchTab(t.tab);
}

/** Scroll to and focus the Intro dialogue setting of the Project tab holding `origin`. */
function revealIntro(origin: HTMLElement): void {
  const tab = origin.closest('[role="tabpanel"]') ?? document;
  const select = tab.querySelector<HTMLSelectElement>('select[aria-label="Intro dialogue"]');
  if (!select) return;
  select.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  select.focus({ preventScroll: true });
}

function goLabel(t: NonNullable<ProblemTarget>): string {
  if (t.tab === 'map') return t.entity ? 'Show the entity on the map' : t.trigger ? 'Show the trigger on the map' : 'Open the room on the map';
  if (t.tab === 'project') return t.section === 'intro' ? 'Show the intro dialogue setting' : 'Show the start location';
  return t.tab === 'dialogue' ? 'Open the dialogue' : 'Open the Art tab';
}

// ---------------------------------------------------------------- start location

/** Why the preview cannot show the real start screen, or null when it can. */
type StartIssue = Exclude<StartPaint, 'exact'> | 'outside' | null;

const START_NOTICE: Readonly<Record<NonNullable<StartIssue>, [string, string]>> = {
  none: ['No rooms yet', 'Add a room on the Map tab, then pick where the game begins.'],
  fallback: ['Start room missing', 'Use “Pick on map” to choose where a new game begins.'],
  outside: ['Start is outside the room', 'Use “Pick on map” to choose a spot inside it.'],
};

function startIssue(painted: StartPaint, room: Room | undefined, s: WarpTarget): StartIssue {
  if (painted !== 'exact') return painted;
  if (!room) return 'fallback';
  const inside = s.x >= 0 && s.y >= 0 && s.x < room.gw * SCREEN_W && s.y < room.gh * SCREEN_H;
  return inside ? null : 'outside';
}

/** What the preview says when it cannot show the real start screen. */
function startNotice(issue: NonNullable<StartIssue>): Child[] {
  const [title, text] = START_NOTICE[issue];
  return [icon('warning', 18), el('b', null, title), el('span', null, text)];
}

function startSection(env: ProjectTabEnv): Section & { reveal(): void } {
  const { ctx } = env;
  const p = ctx.project;
  const canvas = pixelCanvas(256, 224, 1, 'qf-proj-start__screen');
  canvas.setAttribute('role', 'img');
  const notice = el('div', { class: 'qf-proj-start__notice', hidden: true });
  const frame = el('div', { class: 'qf-proj-start__frame' }, canvas, notice);
  const place = el('div', { class: 'qf-proj-start__place' });
  const coords = el('div', { class: 'qf-proj-start__coords qf-muted' });
  const facing = el('select', { class: 'qf-select qf-proj-start__facing', 'aria-label': 'Facing at the start' });
  facing.addEventListener('change', () => env.commit('Change start facing', () => p.start.dir ?? 'down',
    (v: Dir) => { p.start.dir = v; }, facing.value as Dir));

  const pick = async (): Promise<void> => {
    // Back to this tab afterwards, unless the user went to another tab (which abandons the pick).
    let left = false;
    const off = ctx.bus.on('tab', ({ id }) => {
      if (id !== 'map') left = true;
    });
    const at = await ctx.pickLocation('Click where a new game should begin').finally(off);
    if (!left) ctx.switchTab('project');
    if (!at) return;
    const next: WarpTarget = { world: at.world, room: at.room, x: Math.round(at.x), y: Math.round(at.y), dir: at.dir ?? p.start.dir ?? 'down' };
    env.commit('Set start location', () => p.start, (v) => { p.start = v; }, next);
    ctx.toast('Start location updated', 'success');
  };

  const pickButton = button([icon('target', 14), 'Pick on map'], () => void pick(), { title: 'Choose the start location on the map' });
  const element = panel([icon('target', 14), 'Start location'],
    el('div', { class: 'qf-proj-start' },
      frame,
      el('div', { class: 'qf-proj-start__info' },
        place, coords,
        el('label', { class: 'qf-proj-start__row' }, el('span', { class: 'qf-muted' }, 'Facing'), facing),
        el('div', { class: 'qf-proj-start__actions' },
          pickButton,
          button([icon('play', 14), 'Playtest from start'], () => ctx.playtest(), { kind: 'primary', title: 'Play from the start location (F5)' })))));

  return {
    elements: [element],
    /** Bring the panel into view with a brief highlight and focus "Pick on map" (validation "Go" for start problems). */
    reveal() {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      element.classList.remove('qf-proj-flash');
      void element.offsetWidth; // restart the highlight animation
      element.classList.add('qf-proj-flash');
      pickButton.focus({ preventScroll: true });
    },
    sync() {
      const s = p.start;
      const world = findWorld(p, s.world);
      const room = findRoom(p, s.world, s.room);
      setChildren(place, room
        ? [el('span', { class: 'qf-muted' }, world?.name ?? s.world), el('span', { class: 'qf-proj-start__sep' }, '›'), el('b', null, room.name)]
        : [icon('warning', 14), el('b', null, 'The start room is missing')]);
      place.classList.toggle('qf-proj-start__place--bad', !room);
      coords.textContent = `x ${Math.round(s.x)}, y ${Math.round(s.y)}`;
      setSelectOptions(facing, DIRS.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })), s.dir ?? 'down');
      const issue = startIssue(paintStartScreen(canvas, p, ctx.assets), room, s);
      frame.classList.toggle('qf-proj-start__frame--missing', issue !== null);
      notice.hidden = issue === null;
      setChildren(notice, issue === null ? null : startNotice(issue));
      canvas.setAttribute('aria-label', issue === null && room ? `Start screen of ${room.name}` : 'Start screen unavailable');
    },
  };
}

// ---------------------------------------------------------------- validation

function problemRow(env: ProjectTabEnv, problem: Problem, revealStart: () => void): HTMLElement {
  const target = problemTarget(env.ctx.project, problem);
  return el('li', { class: `qf-proj-problem qf-proj-problem--${problem.level}` },
    icon(problem.level === 'error' ? 'error' : 'warning', 14),
    el('span', { class: 'qf-proj-problem__msg' }, problem.message),
    target ? button('Go', (e) => goTo(env, target, revealStart, e.currentTarget as HTMLElement), { small: true, title: goLabel(target) }) : null);
}

function problemGroup(env: ProjectTabEnv, title: string, list: readonly Problem[], revealStart: () => void): HTMLElement | null {
  if (list.length === 0) return null;
  const { shown, more } = capRows(list);
  return el('div', { class: 'qf-proj-problems__group' },
    el('div', { class: 'qf-proj-sub' }, `${title} (${list.length})`),
    el('ul', { class: 'qf-proj-problems' },
      shown.map((x) => problemRow(env, x, revealStart)),
      more ? el('li', { class: 'qf-proj-problem qf-proj-problem--more qf-muted' }, `…and ${more} more`) : null));
}

function validationSection(env: ProjectTabEnv, revealStart: () => void): Section {
  const summary = el('div', { class: 'qf-proj-verdict', 'aria-live': 'polite' });
  const body = el('div', { class: 'qf-proj-problems__body' });
  const element = panel([icon('check', 14), 'Validation'], summary, body);
  element.dataset.section = 'validation';
  return {
    elements: [element],
    sync() {
      let problems: Problem[];
      try {
        problems = validateProject(env.ctx.project);
      } catch (err) {
        problems = [{ level: 'error', message: `Validation failed: ${err instanceof Error ? err.message : String(err)}` }];
      }
      const { errors, warnings } = groupProblems(problems);
      const ok = problems.length === 0;
      summary.dataset.state = errors.length ? 'error' : warnings.length ? 'warning' : 'ok';
      setChildren(summary,
        icon(errors.length ? 'error' : warnings.length ? 'warning' : 'check', 16),
        el('span', null, ok
          ? 'No problems found — your adventure is ready to play.'
          : `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`),
        errors.length ? el('span', { class: 'qf-muted qf-small' }, 'Errors can break the game; fix them first.') : null);
      setChildren(body, problemGroup(env, 'Errors', errors, revealStart), problemGroup(env, 'Warnings', warnings, revealStart));
    },
  };
}

// ---------------------------------------------------------------- worlds

function worldRow(env: ProjectTabEnv, w: WorldSummary): HTMLElement {
  const dungeon = w.kind === 'dungeon';
  const short = dungeon && w.smallKeys < w.lockedDoors;
  const extras = [w.bigKey ? 'big key' : null, w.boss ? 'boss' : null, w.chests ? plural(w.chests, 'chest') : null].filter(Boolean).join(' · ');
  const first = env.ctx.project.worlds.find((x) => x.id === w.id)?.rooms[0]?.id ?? null;
  return el('tr', null,
    el('td', null, el('b', null, w.name), el('div', { class: 'qf-muted qf-small' }, KIND_LABEL[w.kind] ?? w.kind)),
    el('td', { class: 'qf-num' }, String(w.rooms)),
    el('td', { class: 'qf-num' }, String(w.screens)),
    el('td', { class: `qf-num${short ? ' qf-proj-worlds__short' : ''}`, title: dungeon ? 'Small keys available / locked doors' : '' },
      dungeon ? `${w.smallKeys} / ${w.lockedDoors}` : '—'),
    el('td', { class: 'qf-muted qf-small' }, extras || '—'),
    el('td', null, button('Open', () => {
      env.ctx.selectRoom(w.id, first);
      env.ctx.switchTab('map');
    }, { small: true, kind: 'ghost', title: `Open ${w.name} on the map` })));
}

function worldsSection(env: ProjectTabEnv): Section {
  const tbody = el('tbody');
  const element = panel([icon('map', 14), 'Worlds'],
    el('table', { class: 'qf-proj-table' },
      el('thead', null, el('tr', null,
        el('th', null, 'World'), el('th', { class: 'qf-num' }, 'Rooms'), el('th', { class: 'qf-num' }, 'Screens'),
        el('th', { class: 'qf-num', title: 'Dungeons: small keys available / locked doors' }, 'Keys / doors'),
        el('th', null, 'Contents'), el('th'))),
      tbody));
  return {
    elements: [element],
    sync() {
      setChildren(tbody, env.ctx.project.worlds.map((w) => worldRow(env, summarizeWorld(w))));
    },
  };
}

// ---------------------------------------------------------------- stats

function stat(value: number | string, label: string, detail?: string): HTMLElement {
  return el('div', { class: 'qf-proj-stat', title: detail ?? '' },
    el('div', { class: 'qf-proj-stat__value' }, String(value)),
    el('div', { class: 'qf-proj-stat__label' }, label));
}

/** When the project was last stored (null = never): the shell knows; otherwise `modified`, which each save stamps. */
function lastSaved(env: ProjectTabEnv): number | null {
  return hasSaveStatus(env.ctx) ? env.ctx.lastSaved : env.ctx.project.modified;
}

function statsSection(env: ProjectTabEnv): Section & { syncDates(): void } {
  const grid = el('div', { class: 'qf-proj-stats' });
  const dates = el('div', { class: 'qf-proj-dates qf-muted qf-small' });
  const element = panel([icon('project', 14), 'Stats'], grid, dates);
  const syncDates = (): void => {
    const p = env.ctx.project;
    const saved = lastSaved(env);
    setChildren(dates,
      el('span', { title: fullDate(p.created) }, `Created ${relativeTime(p.created)}`),
      saved === null
        ? el('span', null, 'Not saved yet')
        : el('span', { title: fullDate(saved) }, `Last saved ${relativeTime(saved)}`));
  };
  return {
    elements: [element],
    syncDates,
    sync() {
      const p = env.ctx.project;
      const s = projectStats(p);
      setChildren(grid,
        stat(s.rooms, 'rooms', `${s.worlds} world(s), ${s.screens} screen(s)`),
        stat(s.screens, 'screens'),
        stat(s.enemies, 'enemies & bosses'),
        stat(s.npcs, 'NPCs'),
        stat(s.objects + s.pickups, 'objects & items', `${s.objects} objects, ${s.pickups} items`),
        stat(s.triggers, 'triggers'),
        stat(s.dialogues, 'dialogues', `${s.dialoguePages} page(s)`),
        stat(s.customTiles, 'custom tiles', `${s.tiles} tiles in total`),
        stat(s.sprites, 'sprites'),
        stat(s.palettes, 'palettes'),
        stat(s.flags, 'flags'));
      syncDates();
    },
  };
}

/** The read-out panels (right column of the Project tab). */
export function reportSections(env: ProjectTabEnv): { start: Section; validation: Section; worlds: Section; stats: Section & { syncDates(): void } } {
  const start = startSection(env);
  return { start, validation: validationSection(env, () => start.reveal()), worlds: worldsSection(env), stats: statsSection(env) };
}
