// Page editor of the Dialogue tab: one card per page with speaker, text (live
// character / line / box counter, "Insert button" for {btn:x} codes), an
// optional 2-3 answer choice with a flag, and add / duplicate / remove /
// reorder, under a line explaining the text codes. Text commits on change (one
// undo step) while typing feeds the live preview through PageEditHost.draft.
import type { EditorContext } from '../context';
import type { Dialogue, DialoguePage } from '../../core/types';
import { button, el, field, setChildren, textArea, textInput } from '../ui/dom';
import { flagInput, focusKey, keyedCheckbox, retarget, warningBox } from '../entities/widgets';
import { BUTTON_TOKENS, CHOICE_OPTIONS, blankAnswersWarning, blankPage, choiceCountWarning, pageStats, statsText } from './dialogueModel';

export interface PageEditOpts {
  /** Rebuild the cards afterwards (structure changed). */
  rebuild?: boolean;
  /** Page to select afterwards. */
  select?: number;
}

/** What the page cards need from the Dialogue tab. */
export interface PageEditHost {
  readonly ctx: EditorContext;
  readonly dialogue: Dialogue;
  readonly selected: number;
  /** Apply `fn` to the (fresh) dialogue as one undo step. */
  edit(label: string, fn: (d: Dialogue) => void, opts?: PageEditOpts): void;
  /** A page was focused or clicked (the preview follows). */
  selectPage(index: number): void;
  /** Uncommitted page content while typing (the preview follows). */
  draft(index: number, page: DialoguePage): void;
}

const { min: MIN_OPTIONS, max: MAX_OPTIONS } = CHOICE_OPTIONS;

/** The text codes, explained once above the pages. */
function codesHelp(): HTMLElement {
  const code = (t: string): HTMLElement => el('code', { class: 'qf-dlg-codes__code' }, t);
  return el('p', { class: 'qf-dlg-codes' },
    'Codes: ', code('{name}'), ' the player’s name',
    BUTTON_TOKENS.map((t) => [' · ', code(t.token), ` ${t.label}`]),
    '. Buttons show as the key or controller button the player is using.');
}

/** All page cards plus "+ Add page" (focus then moves to the new page's text). */
export function buildPages(h: PageEditHost): HTMLDivElement {
  const n = h.dialogue.pages.length;
  const add = button('+ Add page', (e) => {
    retarget(e, `page:${n}:text`);
    h.edit('Add page', (d) => { d.pages.push(blankPage()); }, { rebuild: true, select: n });
  }, { title: 'Add a page at the end' });
  return el('div', { class: 'qf-dlg-pages' },
    codesHelp(),
    h.dialogue.pages.map((page, i) => pageCard(h, page, i, n)),
    focusKey(add, 'page:add'));
}

/** "Insert button…": puts a {btn:x} code at the text's caret and commits it (one undo step). */
function insertButton(text: HTMLTextAreaElement, key: string, live: () => void): HTMLSelectElement {
  const picker = focusKey(el('select', {
    class: 'qf-select qf-dlg-insert',
    title: 'Insert a button code at the cursor: the game shows it as the key or controller button the player uses',
    'aria-label': 'Insert a button code',
  },
  el('option', { value: '' }, 'Insert button…'),
  BUTTON_TOKENS.map((t) => el('option', { value: t.token }, `${t.token}  ${t.label}`))), key);
  picker.addEventListener('change', () => {
    const token = picker.value;
    picker.value = '';
    if (!token) return;
    const start = text.selectionStart ?? text.value.length;
    text.setRangeText(token, start, text.selectionEnd ?? start, 'end');
    text.focus();
    live();
    text.dispatchEvent(new Event('change'));
  });
  return picker;
}

function movePage(h: PageEditHost, from: number, to: number): void {
  if (to < 0 || to >= h.dialogue.pages.length) return;
  h.edit('Reorder pages', (d) => {
    const [pg] = d.pages.splice(from, 1);
    if (pg) d.pages.splice(to, 0, pg);
  }, { rebuild: true, select: to });
}

function pageCard(h: PageEditHost, page: DialoguePage, i: number, n: number): HTMLElement {
  const stats = el('div', { class: 'qf-dlg-page__stats' }, statsText(pageStats(page)));
  const options: HTMLInputElement[] = [];
  const speaker = focusKey(textInput(page.speaker ?? '', (v) => h.edit('Set speaker', (d) => {
    const pg = d.pages[i];
    if (!pg) return;
    if (v.trim()) pg.speaker = v.trim();
    else delete pg.speaker;
  }), { placeholder: 'Speaker (optional)' }), `page:${i}:speaker`);
  const text = focusKey(textArea(page.text, (v) => h.edit('Edit text', (d) => {
    const pg = d.pages[i];
    if (pg) pg.text = v;
  }), { rows: 4, placeholder: 'What is said… ({name} = the player’s name, {btn:a} = the action button)' }), `page:${i}:text`);
  text.classList.add('qf-dlg-page__text');
  text.spellcheck = true;

  /** The page as currently typed (not yet committed). */
  const typed = (): DialoguePage => {
    const out: DialoguePage = { text: text.value };
    if (speaker.value.trim()) out.speaker = speaker.value.trim();
    if (page.choice) out.choice = { ...page.choice, options: options.map((o) => o.value) };
    return out;
  };
  const live = (): void => {
    const pg = typed();
    stats.textContent = statsText(pageStats(pg));
    h.draft(i, pg);
  };
  speaker.addEventListener('input', live);
  text.addEventListener('input', live);

  const up = button('▲', (e) => {
    retarget(e, `page:${i - 1}:up`);
    movePage(h, i, i - 1);
  }, { small: true, kind: 'ghost', disabled: i === 0, title: 'Move up' });
  const down = button('▼', (e) => {
    retarget(e, `page:${i + 1}:down`);
    movePage(h, i, i + 1);
  }, { small: true, kind: 'ghost', disabled: i === n - 1, title: 'Move down' });
  const duplicate = button('Duplicate', (e) => {
    retarget(e, `page:${i + 1}:text`);
    h.edit('Duplicate page', (d) => {
      const pg = d.pages[i];
      if (pg) d.pages.splice(i + 1, 0, structuredClone(pg));
    }, { rebuild: true, select: i + 1 });
  }, { small: true, kind: 'ghost' });
  const remove = button('✕', (e) => {
    retarget(e, 'page:add');
    h.edit('Delete page', (d) => { d.pages.splice(i, 1); }, { rebuild: true, select: Math.max(0, i - 1) });
  }, { small: true, kind: 'ghost', disabled: n <= 1, title: n <= 1 ? 'A dialogue needs at least one page' : 'Delete this page' });
  const card = el('div', { class: `qf-dlg-page${i === h.selected ? ' qf-dlg-page--active' : ''}`, dataset: { page: String(i) } },
    el('div', { class: 'qf-dlg-page__head' },
      el('span', { class: 'qf-dlg-page__title' }, `Page ${i + 1}`),
      focusKey(up, `page:${i}:up`, `page:${i}:down`),
      focusKey(down, `page:${i}:down`, `page:${i}:up`),
      focusKey(duplicate, `page:${i}:dup`),
      focusKey(remove, `page:${i}:del`)),
    field('Speaker', speaker),
    field('Text', el('div', { class: 'qf-dlg-page__textwrap' }, text,
      el('div', { class: 'qf-dlg-page__textfoot' }, insertButton(text, `page:${i}:insert`, live), stats))),
    choiceEditor(h, page, i, options, live));
  card.addEventListener('focusin', () => h.selectPage(i));
  card.addEventListener('click', (e) => {
    if (!(e.target instanceof Element && e.target.closest('button'))) h.selectPage(i);
  });
  return card;
}

function choiceEditor(h: PageEditHost, page: DialoguePage, i: number, inputs: HTMLInputElement[], live: () => void): HTMLElement {
  const choice = page.choice;
  const toggle = keyedCheckbox(!!choice, (on) => h.edit(on ? 'Add choice' : 'Remove choice', (d) => {
    const pg = d.pages[i];
    if (!pg) return;
    if (on) pg.choice = { options: ['Yes', 'No'] };
    else delete pg.choice;
  }, { rebuild: true }), `Ask a question (${MIN_OPTIONS}–${MAX_OPTIONS} answers)`, `page:${i}:choice`);
  if (!choice) return el('div', { class: 'qf-dlg-choice' }, toggle);
  const count = choice.options.length;
  const countMsg = choiceCountWarning(count);
  const answerHint = el('div', { class: 'qf-ent-warnhost' });
  const checkAnswers = (): void => {
    const msgs = [countMsg, blankAnswersWarning(inputs.map((o) => o.value))].filter((m): m is string => m !== null);
    setChildren(answerHint, warningBox(msgs));
  };
  const rows = choice.options.map((opt, k) => {
    const input = focusKey(textInput(opt, (v) => h.edit('Edit answer', (d) => {
      const c = d.pages[i]?.choice;
      if (c) c.options[k] = v;
    }), { placeholder: `Answer ${k + 1}` }), `page:${i}:opt:${k}`);
    input.addEventListener('input', live);
    input.addEventListener('input', checkAnswers);
    inputs.push(input);
    return el('div', { class: 'qf-dlg-choice__row' },
      el('span', { class: 'qf-dlg-choice__num' }, `${k + 1}.`),
      input,
      focusKey(button('✕', (e) => {
        retarget(e, `page:${i}:opt:add`);
        h.edit('Remove answer', (d) => { d.pages[i]?.choice?.options.splice(k, 1); }, { rebuild: true });
      }, { small: true, kind: 'ghost', disabled: count <= MIN_OPTIONS, title: count <= MIN_OPTIONS ? `A choice needs ${MIN_OPTIONS} answers` : 'Remove this answer' }),
      `page:${i}:opt:${k}:del`));
  });
  const add = focusKey(button('+ Answer', (e) => {
    retarget(e, `page:${i}:opt:${count}`);
    h.edit('Add answer', (d) => { d.pages[i]?.choice?.options.push(`Answer ${count + 1}`); }, { rebuild: true });
  }, { small: true, disabled: count >= MAX_OPTIONS, title: count >= MAX_OPTIONS ? `At most ${MAX_OPTIONS} answers` : 'Add an answer' }),
  `page:${i}:opt:add`);
  const flag = flagInput(h.ctx, choice.flag ?? '', (v) => h.edit('Set choice flag', (d) => {
    const c = d.pages[i]?.choice;
    if (!c) return;
    if (v) c.flag = v;
    else delete c.flag;
  }), `page:${i}:flag`);
  checkAnswers();
  return el('div', { class: 'qf-dlg-choice qf-dlg-choice--on' },
    toggle,
    el('div', { class: 'qf-dlg-choice__rows' }, rows, add),
    answerHint,
    field('Sets flag', flag, 'Optional: set true when answer 1 is chosen, false otherwise.'));
}
