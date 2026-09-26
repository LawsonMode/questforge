// Controller banner of the menu hub, shown while a controller is connected or
// in use: "<pad> connected — (A) select · (B) back" in that pad's own glyphs,
// plus the button layout (Classic SNES positions / Swapped bottom and right)
// and vibration toggles, which set the shared 'controller' preferences (the
// game's Input and the hub's pad navigation read them).
import { controllerPrefs, onControlsChange, onPadConnection, rumble, setControllerPrefs } from '../input/devices';
import { el } from '../editor/ui/dom';
import { icon } from '../editor/shell/icons';
import { knownPad, padGlyph, padWord } from './controls';

export interface PadBanner {
  readonly element: HTMLElement;
  /** Drop the device listeners. */
  destroy(): void;
}

function toggle(label: string, title: string, onClick: () => void): HTMLButtonElement {
  return el('button', { class: 'qf-btn qf-btn--small qf-menu-pad__opt', type: 'button', title, 'aria-pressed': 'false', on: { click: onClick } }, label);
}

/** Build the banner (hidden while no controller is known); it follows device changes until destroy(). */
export function createPadBanner(): PadBanner {
  const message = el('span', { class: 'qf-menu-pad__msg' });
  const classic = toggle('Classic (SNES)', 'Right button = action & select, bottom button = sword & back (the game’s SNES positions)',
    () => setControllerPrefs({ swapFaceButtons: false }));
  const swapped = toggle('Swapped', 'Bottom button = action & select, right button = sword & back',
    () => setControllerPrefs({ swapFaceButtons: true }));
  const vibration = toggle('Vibration', 'Rumble on hits and big moments (controllers that support it)', () => {
    const on = !controllerPrefs().vibration;
    setControllerPrefs({ vibration: on });
    if (on) rumble('tap');
  });
  vibration.classList.add('qf-menu-pad__vibration');
  const element = el('section', { class: 'qf-menu-pad', 'aria-label': 'Controller', hidden: true },
    el('span', { class: 'qf-menu-pad__icon' }, icon('gamepad', 22)),
    message,
    el('div', { class: 'qf-menu-pad__opts' },
      el('span', { class: 'qf-menu-pad__label', id: 'qf-menu-pad-layout' }, 'Button layout'),
      el('div', { class: 'qf-menu-pad__seg', role: 'group', 'aria-labelledby': 'qf-menu-pad-layout' }, classic, swapped),
      vibration));

  const refresh = (): void => {
    const pad = knownPad();
    element.hidden = !pad;
    if (!pad) return;
    message.replaceChildren(
      el('b', { class: 'qf-menu-pad__name' }, pad.padName ?? 'Controller'), ' connected — ',
      padGlyph(padWord('a', pad)), ' select ', el('span', { class: 'qf-menu-pad__dot', 'aria-hidden': 'true' }, '·'),
      ' ', padGlyph(padWord('b', pad)), ' back');
    const prefs = controllerPrefs();
    classic.setAttribute('aria-pressed', String(!prefs.swapFaceButtons));
    swapped.setAttribute('aria-pressed', String(prefs.swapFaceButtons));
    vibration.setAttribute('aria-pressed', String(prefs.vibration));
    vibration.textContent = prefs.vibration ? 'Vibration on' : 'Vibration off';
  };
  const offs = [onControlsChange(refresh), onPadConnection(refresh)];
  refresh();
  return {
    element,
    destroy: () => {
      for (const off of offs) off();
    },
  };
}
