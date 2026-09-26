// Map tab keyboard & mouse reference (opened from the toolbar).
import { el, modal } from '../ui/dom';

/** Alternative key combos (joined by " / "), each a list of keys pressed together (joined by " + "). */
type Row = readonly [combos: readonly (readonly string[])[], what: string];

const SECTIONS: readonly { title: string; rows: readonly Row[] }[] = [
  {
    title: 'Tools',
    rows: [
      [[['P'], ['B']], 'Pencil — Shift+click draws a line'],
      [[['R']], 'Rectangle — Shift for an outline'],
      [[['F']], 'Fill — Shift+click replaces the tile everywhere'],
      [[['E']], 'Eraser'],
      [[['I']], 'Eyedropper (Alt+click with any tile tool)'],
      [[['S']], 'Select tiles — Shift for all layers'],
      [[['T']], 'Terrain brush — right-drag erases'],
      [[['N']], 'Entities — place, select, drag (opening the Entities tab picks it too)'],
    ],
  },
  {
    title: 'View',
    rows: [
      [[['Wheel'], ['Ctrl', 'wheel']], 'Zoom at the cursor (trackpad: pinch to zoom, scroll to pan)'],
      [[['+'], ['−']], 'Zoom in / out (25% – 600%)'],
      [[['0']], 'Fit the room'],
      [[['Space', 'drag']], 'Pan (also middle-drag or arrow keys)'],
      [[['['], [']']], 'Previous / next layer'],
      [[['G']], 'Tile grid'],
      [[['C']], 'Collision overlay'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      [[['Ctrl', 'C / X / V']], 'Copy / cut / paste tiles (click stamps)'],
      [[['Ctrl', 'A']], 'Select the whole room (Shift: all layers)'],
      [[['Del']], 'Clear the selection or delete the entity'],
      [[['Ctrl', 'D']], 'Duplicate the selected entity'],
      [[['Arrows']], 'Nudge the entity 1 px (Shift: 8 px) — not while a sidebar control has focus'],
      [[['Esc']], 'Undo the stroke or drag in progress, deselect, or stop placing'],
      [[['Right-click']], 'Playtest from here, set the start, add a warp'],
      [[['Enter']], 'In a Room-tab field: apply it and return to the map keys'],
    ],
  },
  {
    title: 'Worlds & overview',
    rows: [
      [[['↑'], ['↓']], 'Worlds list: move between worlds (Enter opens one)'],
      [[['F2']], 'Rename the focused world'],
      [[['Alt', '↑ / ↓']], 'Move the focused world up / down'],
      [[['Shift', 'F10']], 'World or room actions menu'],
      [[['Arrows']], 'Overview: select the next room that way'],
      [[['Alt', 'arrows']], 'Overview: move the selected room one screen (Esc cancels a drag)'],
      [[['Enter'], ['Del']], 'Overview: room properties / delete the room'],
    ],
  },
];

/** Show the map shortcuts modal. */
export function showMapHelp(): void {
  modal({
    title: 'Map editor — keys & mouse',
    wide: true,
    body: el('div', { class: 'qf-map-help' }, SECTIONS.map((s) => el('section', null,
      el('h3', { class: 'qf-map-help__title' }, s.title),
      el('dl', { class: 'qf-map-help__keys' }, s.rows.map(([combos, what]) => [
        el('dt', null, combos.map((combo, i) => [
          i > 0 ? ' / ' : null,
          combo.map((k, j) => [j > 0 ? ' + ' : null, el('kbd', { class: 'qf-kbd' }, k)]),
        ])),
        el('dd', null, what),
      ]))))),
  });
}
