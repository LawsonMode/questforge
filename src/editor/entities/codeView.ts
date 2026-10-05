// "Show as code" box under the trigger form: the selected trigger as
// highlighted pseudocode (triggerCode.ts), open or closed as the student last
// left it (setting `codeView`). Opening it is recorded as reading code.
import type { Project, Room, Trigger } from '../../core/types';
import { getSetting, setSetting } from '../../core/storage';
import '../../learning/learning.css';
import { el } from '../ui/dom';
import { noteCodeViewed } from '../../learning/editorObserver';
import { tokenizeCode, triggerCodeLines } from './triggerCode';

const SETTING = 'codeView';

/** Fill `pre` with the highlighted lines of the trigger's code. */
export function renderTriggerCode(pre: HTMLElement, p: Project, room: Room, t: Trigger): void {
  pre.replaceChildren(...triggerCodeLines(p, room, t).flatMap((line, i) => [
    ...(i > 0 ? ['\n'] : []),
    ...tokenizeCode(line).map((tok) => (tok.kind === 'txt' ? tok.text : el('span', { class: `qf-code__${tok.kind}` }, tok.text))),
  ]));
}

export interface TriggerCodeBox {
  element: HTMLDetailsElement;
  /** Re-read the trigger (after an edit). */
  update(p: Project, room: Room, t: Trigger): void;
}

export function triggerCodeBox(p: Project, room: Room, t: Trigger): TriggerCodeBox {
  const pre = el('pre', { class: 'qf-code', 'aria-label': 'Trigger as code' });
  let shown = { room, t };
  const element = el('details', { class: 'qf-trig-code', open: getSetting<boolean>(SETTING, false) },
    el('summary', { class: 'qf-trig-code__summary', title: 'See this trigger written as a program' }, 'Show as code'),
    pre,
    el('p', { class: 'qf-trig-code__note' },
      '“when” is the event, “if” checks the conditions (all must be true), and the indented lines run top to bottom.'));
  element.addEventListener('toggle', () => {
    setSetting(SETTING, element.open);
    if (element.open) noteCodeViewed(shown.room, shown.t);
  });
  const update = (proj: Project, r: Room, trig: Trigger): void => {
    shown = { room: r, t: trig };
    renderTriggerCode(pre, proj, r, trig);
    if (element.open) noteCodeViewed(r, trig);
  };
  update(p, room, t);
  return { element, update };
}
