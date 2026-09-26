// Help & shortcuts modal for the editor. The game controls list the keyboard
// keys and the controller buttons for playtesting (in the connected or last-used
// controller's own labels; A/B/X/Y otherwise), redrawn if the device changes.
import { el, modal, setChildren, type ModalHandle } from '../ui/dom';
import { onControlsChange, onPadConnection } from '../../input/devices';
import { GAME_CONTROLS, keyboardKeys, knownPad, labelPad, padButtons, padGlyph, padWord } from '../../app/controls';
import { focusTopDialog, restoreFocus } from './dialogs';

type Row = readonly [keys: readonly string[], what: string];

const EDITOR_KEYS: readonly Row[] = [
  [['Ctrl', 'S'], 'Save now (the editor also autosaves)'],
  [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'Y'], 'Redo (also Ctrl+Shift+Z)'],
  [['F5'], 'Playtest from the project start'],
  [['Shift', 'F5'], 'Playtest from the selected room'],
  [['1 – 4'], 'Map, Art, Dialogue or Project tab'],
  [['Alt', '1 – 4'], 'Switch tab from anywhere (in the pixel editor on the Art tab, plain digits pick colours)'],
  [['?'], 'This help'],
];

const PLAYTEST_KEYS: readonly Row[] = [
  [['Esc'], 'Return to the editor'],
  [['F1'], 'Show hitboxes'],
  [['F2'], 'Invincible'],
  [['F3'], 'Walk through walls (noclip)'],
  [['F4'], 'Frame rate'],
];

function table(title: string, rows: readonly Row[]): HTMLElement {
  return el('section', { class: 'qf-help__section' },
    el('h3', { class: 'qf-help__title' }, title),
    el('dl', { class: 'qf-help__keys' }, rows.map(([keys, what]) => [
      el('dt', null, keys.map((k, i) => [i > 0 ? ' + ' : null, el('kbd', { class: 'qf-kbd' }, k)])),
      el('dd', null, what),
    ])));
}

/** Playtest keys plus the controller's way back (when a controller is known). */
function playtestTable(): HTMLElement {
  const section = table('Playtest', PLAYTEST_KEYS);
  const pad = knownPad();
  if (pad) {
    section.querySelector('dl')?.append(
      el('dt', { class: 'qf-help__pad' }, 'hold ', padGlyph(padWord('start', pad)), ' + ', padGlyph(padWord('select', pad))),
      el('dd', null, 'Return to the editor (controller)'));
  }
  return section;
}

/** The game's controls: keyboard | controller | what. */
function gameTable(): HTMLElement {
  const pad = labelPad();
  return el('section', { class: 'qf-help__section' },
    el('h3', { class: 'qf-help__title' }, 'Game controls'),
    el('div', { class: 'qf-help__game' },
      el('span', { class: 'qf-help__colhead' }, 'Keyboard'), el('span', { class: 'qf-help__colhead' }, 'Controller'), el('span'),
      GAME_CONTROLS.map(({ button, what }) => [
        el('span', { class: 'qf-help__cell' }, keyboardKeys(button).map((k) => el('kbd', { class: 'qf-kbd' }, k))),
        el('span', { class: 'qf-help__cell qf-help__pad' }, padButtons(button, pad).map((k) => padGlyph(k))),
        el('span', null, what),
      ])));
}

/** Show the help modal (focus moves into it and returns to the trigger); `onClose` runs once it closes. */
export function showHelp(onClose?: () => void): ModalHandle {
  const trigger = document.activeElement;
  const playtestHost = el('div');
  const drawPlaytest = (): void => setChildren(playtestHost, playtestTable(), gameTable());
  drawPlaytest();
  const offs = [onControlsChange(drawPlaytest), onPadConnection(drawPlaytest)];
  const handle = modal({
    title: 'Questforge editor — help',
    wide: true,
    onClose: () => {
      for (const off of offs) off();
      restoreFocus(trigger);
      onClose?.();
    },
    body: el('div', { class: 'qf-help' },
      el('p', { class: 'qf-help__intro' },
        'Build rooms on the ', el('b', null, 'Map'), ' tab, draw tiles and sprites on the ', el('b', null, 'Art'),
        ' tab, write conversations on the ', el('b', null, 'Dialogue'), ' tab and set up the start of your game on the ',
        el('b', null, 'Project'), ' tab. Press ', el('kbd', { class: 'qf-kbd' }, 'F5'), ' any time to play.'),
      el('div', { class: 'qf-help__grid' },
        table('Editor', EDITOR_KEYS),
        playtestHost),
      el('p', { class: 'qf-help__note' },
        'Your work is saved automatically in this browser. Use Export to keep a .questforge.json backup or share your game — anyone can import it from the main menu.')),
  });
  focusTopDialog('dialog');
  return handle;
}
