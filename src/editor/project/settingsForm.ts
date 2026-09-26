// Project tab settings form: game info, player start (hearts & items), intro
// dialogue and title music (with a preview). Every edit is one undo step.
import type { ItemId, MusicId, Project } from '../../core/types';
import type { AssetCache } from '../../gfx/imageCache';
import type { ProjectTabEnv, Section } from './env';
import { ITEM_IDS, MUSIC_IDS } from '../../core/types';
import { DEFAULT_MAX_ARROWS, DEFAULT_MAX_BOMBS, MAX_HEARTS, MAX_RUPEES } from '../../core/constants';
import { ITEM_INFO } from '../../content/ids';
import { getAudio } from '../../audio/audio';
import { el, field, numberInput, panel, setChildren, setSelectOptions, type Child } from '../ui/dom';
import { icon } from '../shell/icons';
import { NAME_MAX_LENGTH, applyNaming, namingOf, renamed } from '../shell/rename';
import { spriteIcon } from '../../app/spriteIcon';

/** Display names of the music tracks. */
export const MUSIC_LABELS: Readonly<Record<MusicId, string>> = {
  title: 'Title theme', overworld: 'Overworld', village: 'Village', forest: 'Forest', dungeon: 'Dungeon',
  cave: 'Cave', house: 'House', boss: 'Boss battle', victory: 'Victory', gameover: 'Game over', fileSelect: 'File select',
};

/** Start items counted rather than levelled, with their maximum and the amount a fresh tick gives. */
const COUNTED: Partial<Record<ItemId, { max: number; initial: number; unit: string }>> = {
  bombs: { max: DEFAULT_MAX_BOMBS, initial: 5, unit: 'bombs' },
  arrows: { max: DEFAULT_MAX_ARROWS, initial: 10, unit: 'arrows' },
  rupees: { max: MAX_RUPEES, initial: 50, unit: 'rupees' },
};

/** Items that do something when owned from the start. */
const START_ITEMS: readonly ItemId[] = ITEM_IDS.filter((id) => ['weapon', 'equip', 'passive', 'ammo', 'currency'].includes(ITEM_INFO[id].kind));

type Sync = () => void;

let fieldSeq = 0;

/** A form row whose label names `control` (screen readers announce it; clicking the label focuses it). `row` = what the row shows, when more than the control. */
function labelledField(label: string, control: HTMLElement, help?: string, row: Child = control): HTMLDivElement {
  control.id ||= `qf-proj-field-${++fieldSeq}`;
  const f = field(label, row, help);
  const caption = f.querySelector('label');
  if (caption) caption.htmlFor = control.id;
  return f;
}

/**
 * Text input/textarea committed on change (through `opts.commit` when given, else
 * one undoable set); its sync skips while the user is typing in it.
 */
function textControl(
  env: ProjectTabEnv, syncs: Sync[], label: string, get: () => string, set: (v: string) => void,
  opts: { multiline?: boolean; required?: boolean; max?: number; placeholder?: string; commit?: (v: string) => void } = {},
): HTMLInputElement | HTMLTextAreaElement {
  const input = opts.multiline
    ? el('textarea', { class: 'qf-input qf-textarea', rows: 3, placeholder: opts.placeholder })
    : el('input', { class: 'qf-input', type: 'text', maxLength: opts.max ?? 80, placeholder: opts.placeholder });
  input.spellcheck = opts.multiline === true;
  input.addEventListener('change', () => {
    const v = opts.multiline ? input.value : input.value.trim();
    if (opts.required && !v) {
      input.value = get();
      return;
    }
    if (opts.commit) opts.commit(v);
    else env.commit(`Change ${label.toLowerCase()}`, get, set, v);
  });
  syncs.push(() => {
    if (document.activeElement !== input) input.value = get();
  });
  return input;
}

function gamePanel(env: ProjectTabEnv, syncs: Sync[]): HTMLElement {
  const p = env.ctx.project;
  const name = textControl(env, syncs, 'Project name', () => p.name, (v) => { p.name = v; }, {
    required: true, max: NAME_MAX_LENGTH,
    commit: (v) => env.commit('Change project name', () => namingOf(p), (x) => applyNaming(p, x), renamed(p, v)),
  });
  const title = textControl(env, syncs, 'Title', () => p.settings.title, (v) => { p.settings.title = v; }, { max: NAME_MAX_LENGTH });
  const subtitle = textControl(env, syncs, 'Subtitle', () => p.settings.subtitle, (v) => { p.settings.subtitle = v; }, { max: 60, placeholder: 'Shown under the title' });
  const author = textControl(env, syncs, 'Author', () => p.author, (v) => { p.author = v; }, { max: 60 });
  const description = textControl(env, syncs, 'Description', () => p.description, (v) => { p.description = v; }, { multiline: true, placeholder: 'What is your adventure about?' });
  return panel([icon('edit', 14), 'Game'],
    labelledField('Project name', name, 'Shown in the editor and on the menu.'),
    labelledField('Title', title, 'Shown on the title screen.'),
    labelledField('Subtitle', subtitle),
    labelledField('Author', author),
    labelledField('Description', description));
}

/** A number input for whole numbers: a fractional entry is rounded, and the field shows what was stored. */
function wholeNumberInput(value: number, onChange: (v: number) => void, opts: Parameters<typeof numberInput>[2]): HTMLInputElement {
  const input = numberInput(value, (v) => {
    const n = Math.round(v);
    input.value = String(n);
    onChange(n);
  }, opts);
  return input;
}

function heartsPreview(assets: AssetCache, hearts: number): HTMLElement[] {
  return Array.from({ length: hearts }, () => spriteIcon(assets, 'hud', 'heart_full', 2));
}

function heartsField(env: ProjectTabEnv, syncs: Sync[]): HTMLElement {
  const s = env.ctx.project.settings;
  const preview = el('div', { class: 'qf-proj-hearts', 'aria-hidden': 'true' });
  const input = wholeNumberInput(s.startHearts, (v) => env.commit('Change starting hearts', () => s.startHearts, (n) => { s.startHearts = n; }, v),
    { min: 1, max: MAX_HEARTS, step: 1, title: `Starting hearts (1-${MAX_HEARTS})` });
  input.setAttribute('aria-label', 'Starting hearts');
  syncs.push(() => {
    if (document.activeElement !== input) input.value = String(s.startHearts);
    setChildren(preview, heartsPreview(env.ctx.assets, Math.max(0, Math.min(MAX_HEARTS, Math.round(s.startHearts) || 0))));
  });
  const row = labelledField('Hearts', input, undefined, el('div', { class: 'qf-row qf-proj-hearts-row' }, input, preview));
  row.classList.add('qf-proj-hearts-field');
  return row;
}

/** One start-item row: checkbox, icon, name and a level select or an amount input. */
function itemRow(env: ProjectTabEnv, syncs: Sync[], id: ItemId): HTMLElement {
  const s = env.ctx.project.settings;
  const info = ITEM_INFO[id];
  const counted = COUNTED[id];
  const set = (amount: number | null): void => {
    const next = { ...s.startItems };
    if (amount === null || amount <= 0) delete next[id];
    else next[id] = amount;
    env.commit(`Change starting ${info.name.toLowerCase()}`, () => s.startItems, (v) => { s.startItems = v; }, next);
  };
  const check = el('input', { type: 'checkbox', id: `qf-proj-item-${id}` });
  check.addEventListener('change', () => set(check.checked ? (counted?.initial ?? 1) : null));
  let control: HTMLInputElement | HTMLSelectElement | null = null;
  if (counted) {
    control = wholeNumberInput(counted.initial, set, { min: 1, max: counted.max, title: `How many ${counted.unit} (max ${counted.max})` });
  } else if (info.maxLevel > 1) {
    const sel = el('select', { class: 'qf-select qf-proj-items__level', title: 'Level' });
    setSelectOptions(sel, Array.from({ length: info.maxLevel }, (_, i) => ({ value: String(i + 1), label: `Lv ${i + 1}` })), '1');
    sel.addEventListener('change', () => set(Number(sel.value)));
    control = sel;
  }
  control?.setAttribute('aria-label', `${info.name} ${counted ? 'amount' : 'level'}`);
  let picture = spriteIcon(env.ctx.assets, 'item', info.icon, 1);
  const row = el('div', { class: 'qf-proj-items__row', title: info.description },
    check,
    el('label', { class: 'qf-proj-items__label', htmlFor: check.id }, picture, el('span', null, info.name)),
    control);
  syncs.push(() => {
    // Redrawn from the cache: the item's sprite may have been edited on the Art tab.
    const next = spriteIcon(env.ctx.assets, 'item', info.icon, 1);
    picture.replaceWith(next);
    picture = next;
    const owned = Math.floor(Number(s.startItems[id] ?? 0));
    check.checked = owned > 0;
    row.classList.toggle('qf-proj-items__row--on', owned > 0);
    if (!control) return;
    control.disabled = owned <= 0;
    if (document.activeElement !== control) control.value = String(owned > 0 ? owned : (counted?.initial ?? 1));
  });
  return row;
}

function startPanel(env: ProjectTabEnv, syncs: Sync[]): HTMLElement {
  return panel([icon('sword', 14), 'Player start'],
    heartsField(env, syncs),
    el('div', { class: 'qf-proj-sub' }, 'Starting items'),
    el('div', { class: 'qf-proj-items' }, START_ITEMS.map((id) => itemRow(env, syncs, id))),
    el('p', { class: 'qf-field__help qf-proj-note' }, 'Keys, maps and hearts only work when picked up in play, so they are not listed here.'));
}

function dialogueOptions(p: Project): { value: string; label: string }[] {
  const opts = [{ value: '', label: '(none)' }, ...p.dialogues.map((d) => ({ value: d.id, label: d.name || d.id }))];
  const intro = p.settings.introDialogue;
  if (intro && !p.dialogues.some((d) => d.id === intro)) opts.push({ value: intro, label: `(missing) ${intro}` });
  return opts;
}

/** Title music select with a play/stop preview through the game's audio engine. */
function musicField(env: ProjectTabEnv, syncs: Sync[]): { element: HTMLElement; stop: () => void } {
  const s = env.ctx.project.settings;
  const audio = getAudio();
  let previewing: MusicId | null = null;
  const sel = el('select', { class: 'qf-select', 'aria-label': 'Title music' });
  setSelectOptions(sel, MUSIC_IDS.map((id) => ({ value: id, label: MUSIC_LABELS[id] })), s.titleMusic);
  const btn = el('button', { class: 'qf-btn qf-proj-preview', type: 'button' });
  const paint = (): void => {
    const on = previewing !== null && audio.currentMusic === previewing;
    setChildren(btn, icon(on ? 'stop' : 'play', 12), on ? 'Stop' : 'Preview');
    btn.title = on ? 'Stop the preview' : `Play “${MUSIC_LABELS[s.titleMusic]}”`;
    btn.setAttribute('aria-pressed', String(on));
  };
  const stop = (): void => {
    if (previewing !== null && audio.currentMusic === previewing) audio.music('none');
    previewing = null;
    paint();
  };
  const play = (): void => {
    audio.unlock();
    previewing = s.titleMusic;
    audio.music(previewing);
    paint();
  };
  btn.addEventListener('click', () => (previewing !== null && audio.currentMusic === previewing ? stop() : play()));
  sel.addEventListener('change', () => {
    env.commit('Change title music', () => s.titleMusic, (v) => { s.titleMusic = v; }, sel.value as MusicId);
    if (previewing !== null) play();
  });
  syncs.push(() => {
    sel.value = s.titleMusic;
    paint();
  });
  return { element: labelledField('Title music', sel, 'Plays on the title and file select screens.', el('div', { class: 'qf-row qf-proj-music' }, sel, btn)), stop };
}

function storyPanel(env: ProjectTabEnv, syncs: Sync[]): { element: HTMLElement; stop: () => void } {
  const p = env.ctx.project;
  const intro = el('select', { class: 'qf-select', 'aria-label': 'Intro dialogue' });
  intro.addEventListener('change', () => env.commit('Change intro dialogue', () => p.settings.introDialogue ?? null,
    (v: string | null) => {
      if (v) p.settings.introDialogue = v;
      else delete p.settings.introDialogue;
    }, intro.value || null));
  syncs.push(() => setSelectOptions(intro, dialogueOptions(p), p.settings.introDialogue ?? ''));
  const music = musicField(env, syncs);
  const element = panel([icon('music', 14), 'Story & music'],
    labelledField('Intro dialogue', intro, 'Shown when a new game starts. Write it on the Dialogue tab.'),
    music.element);
  return { element, stop: music.stop };
}

/** The settings panels (left column of the Project tab). */
export function settingsForm(env: ProjectTabEnv): Section & { stopPreview(): void } {
  const syncs: Sync[] = [];
  const game = gamePanel(env, syncs);
  const start = startPanel(env, syncs);
  const story = storyPanel(env, syncs);
  const sync = (): void => {
    for (const fn of syncs) fn();
  };
  sync();
  return { elements: [game, start, story.element], sync, stopPreview: story.stop, destroy: story.stop };
}
