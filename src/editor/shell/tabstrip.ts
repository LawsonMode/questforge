// Editor tab strip (Map | Art | Dialogue | Project) with number-key hints and
// a breadcrumb of the current selection on the right.
import type { EditorTabId } from '../context';
import { el, setChildren } from '../ui/dom';
import { icon, type IconName } from './icons';

/** The editor tabs in strip order (number keys 1-4, or Alt+1-4). */
export const EDITOR_TABS: readonly { id: EditorTabId; label: string; icon: IconName; hint: string }[] = [
  { id: 'map', label: 'Map', icon: 'map', hint: 'Worlds, rooms, tiles, entities and triggers' },
  { id: 'art', label: 'Art', icon: 'art', hint: 'Tiles, sprites, palettes and terrains' },
  { id: 'dialogue', label: 'Dialogue', icon: 'dialogue', hint: 'Dialogue pages, choices and flags' },
  { id: 'project', label: 'Project', icon: 'project', hint: 'Settings, start location and validation' },
];

/** The tab strip element and its updaters. */
export interface TabStrip {
  readonly element: HTMLElement;
  setActive(id: EditorTabId): void;
  /** Breadcrumb parts shown on the right (e.g. world, room). */
  setTrail(parts: readonly string[]): void;
}

/** Build the tab strip; `onSelect` runs when a tab is clicked or arrowed to. */
export function createTabStrip(onSelect: (id: EditorTabId) => void): TabStrip {
  const buttons = new Map<EditorTabId, HTMLButtonElement>();
  const list = el('div', { class: 'qf-shell__tablist', role: 'tablist', 'aria-label': 'Editor sections' });
  EDITOR_TABS.forEach((t, i) => {
    const b = el('button', {
      class: 'qf-tab qf-shell__tab', type: 'button', role: 'tab', id: `qf-tab-${t.id}`,
      title: `${t.hint} (${i + 1} or Alt+${i + 1})`, dataset: { tab: t.id }, 'aria-controls': `qf-tabpanel-${t.id}`,
      on: { click: () => onSelect(t.id) },
    }, icon(t.icon), el('span', null, t.label), el('span', { class: 'qf-shell__tabkey', 'aria-hidden': 'true' }, String(i + 1)));
    buttons.set(t.id, b);
    list.appendChild(b);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const at = EDITOR_TABS.findIndex((t) => buttons.get(t.id) === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = EDITOR_TABS[(at + (e.key === 'ArrowRight' ? 1 : EDITOR_TABS.length - 1)) % EDITOR_TABS.length]!;
    onSelect(next.id);
    buttons.get(next.id)?.focus();
  });
  const trail = el('div', { class: 'qf-shell__trail', 'aria-live': 'polite' });
  return {
    element: el('nav', { class: 'qf-shell__tabs' }, list, trail),
    setActive(id: EditorTabId) {
      for (const [k, b] of buttons) {
        const on = k === id;
        b.classList.toggle('qf-tab--active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    },
    setTrail(parts: readonly string[]) {
      setChildren(trail, parts.map((p, i) => [
        i > 0 ? el('span', { class: 'qf-shell__trail-sep', 'aria-hidden': 'true' }, '›') : null,
        el('span', { class: i === parts.length - 1 ? 'qf-shell__trail-last' : '' }, p),
      ]));
    },
  };
}
