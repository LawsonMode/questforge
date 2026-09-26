// A centred message card (not-found pages) with the title in the game's font.
import { el } from '../editor/ui/dom';
import { pixelTextCanvas } from './pixelText';

/** Content of a message card. */
export interface AppMessage {
  title: string;
  text: string;
  actions: { label: string; primary?: boolean; onClick: () => void }[];
}

/** Show the card in `root`; returns its unmount function. */
export function showAppMessage(root: HTMLElement, msg: AppMessage): () => void {
  const buttons = msg.actions.map((a) => el('button', {
    class: `qf-btn${a.primary ? ' qf-btn--primary' : ''}`, type: 'button', on: { click: a.onClick },
  }, a.label));
  const view = el('div', { class: 'qf-app-message', role: 'main' },
    pixelTextCanvas('?!', { color: '#f0c040', outline: '#2a1408', shadow: '#0c0618' }, 4),
    el('h1', null, msg.title),
    el('p', null, msg.text),
    el('div', { class: 'qf-app-message__actions' }, buttons));
  root.appendChild(view);
  buttons[0]?.focus();
  return () => view.remove();
}
