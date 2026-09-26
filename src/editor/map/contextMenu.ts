// Small floating context menu (right-click menus on the canvas and overview).
// Closes on outside press, Escape, any non-menu key (which then works as usual),
// scroll, resize or after an item runs.
import type { MapIcon } from './icons';
import { el } from '../ui/dom';
import { mapIcon } from './icons';

export interface MenuItem {
  label: string;
  icon?: MapIcon;
  /** Shortcut text shown on the right. */
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

export type MenuEntry = MenuItem | { header: string } | 'separator';

let closeOpen: (() => void) | null = null;

/** Keys the open menu itself uses (navigation and activation of the focused item). */
const MENU_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Tab', 'Shift', 'Control', 'Alt', 'Meta']);

/** Close the open menu, if any. */
export function closeMenu(): void {
  closeOpen?.();
}

/**
 * Open a menu at client coordinates (closing any other). Escape or running an
 * item gives keyboard focus back to the element that had it before.
 */
export function openMenu(x: number, y: number, entries: readonly MenuEntry[]): void {
  closeOpen?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const menu = el('div', { class: 'qf-map-menu', role: 'menu' });
  const buttons: HTMLButtonElement[] = [];
  let closed = false;
  const close = (refocus = false): void => {
    if (closed) return;
    closed = true;
    closeOpen = null;
    const hadFocus = menu.contains(document.activeElement);
    menu.remove();
    if (refocus && hadFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', dismiss);
    window.removeEventListener('blur', dismiss);
    document.removeEventListener('scroll', dismiss, true);
  };
  const dismiss = (): void => close();
  for (const entry of entries) {
    if (entry === 'separator') menu.appendChild(el('div', { class: 'qf-map-menu__sep', role: 'separator' }));
    else if ('header' in entry) menu.appendChild(el('div', { class: 'qf-map-menu__header' }, entry.header));
    else {
      const b = el('button', {
        class: `qf-map-menu__item${entry.danger ? ' qf-map-menu__item--danger' : ''}`,
        type: 'button', role: 'menuitem', disabled: entry.disabled,
        on: { click: () => { close(true); entry.action(); } },
      }, entry.icon ? mapIcon(entry.icon, 14) : el('span', { class: 'qf-map-menu__noicon' }),
      el('span', { class: 'qf-grow' }, entry.label),
      entry.keys ? el('span', { class: 'qf-map-menu__keys' }, entry.keys) : null);
      buttons.push(b);
      menu.appendChild(b);
    }
  }
  const onOutside = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const n = enabled.length;
    if (e.key === 'Escape') close(true);
    else if (e.key === 'ArrowDown') enabled[(i + 1) % n]?.focus();
    else if (e.key === 'ArrowUp') enabled[i <= 0 ? n - 1 : i - 1]?.focus();
    else {
      // Enter / Space activate the focused item natively; any other key dismisses the menu and goes on.
      if (!MENU_KEYS.has(e.key)) close(true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', dismiss);
  window.addEventListener('blur', dismiss);
  document.addEventListener('scroll', dismiss, true);
  buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  closeOpen = dismiss;
}
