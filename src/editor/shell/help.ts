// Help & shortcuts modal for the editor.
import { el, modal, type ModalHandle } from '../ui/dom';
import { CONTROL_HINTS } from '../../input/input';
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

const GAME_KEYS: readonly Row[] = [
  [['Arrows'], 'Move (WASD works too)'],
  [[CONTROL_HINTS.b], 'Sword (hold to charge a spin)'],
  [[CONTROL_HINTS.a], 'Action: talk, read, lift, throw, open, dash'],
  [[CONTROL_HINTS.y], 'Use the selected item'],
  [[CONTROL_HINTS.start], 'Pause & inventory'],
  [[CONTROL_HINTS.select], 'Map'],
];

function table(title: string, rows: readonly Row[]): HTMLElement {
  return el('section', { class: 'qf-help__section' },
    el('h3', { class: 'qf-help__title' }, title),
    el('dl', { class: 'qf-help__keys' }, rows.map(([keys, what]) => [
      el('dt', null, keys.map((k, i) => [i > 0 ? ' + ' : null, el('kbd', { class: 'qf-kbd' }, k)])),
      el('dd', null, what),
    ])));
}

/** Show the help modal (focus moves into it and returns to the trigger); `onClose` runs once it closes. */
export function showHelp(onClose?: () => void): ModalHandle {
  const trigger = document.activeElement;
  const handle = modal({
    title: 'Questforge editor — help',
    wide: true,
    onClose: () => {
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
        el('div', null, table('Playtest', PLAYTEST_KEYS), table('Game controls', GAME_KEYS))),
      el('p', { class: 'qf-help__note' },
        'Your work is saved automatically in this browser. Use Export to keep a .questforge.json backup or share your game — anyone can import it from the main menu.')),
  });
  focusTopDialog('dialog');
  return handle;
}
