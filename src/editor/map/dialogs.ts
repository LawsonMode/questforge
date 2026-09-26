// Modal dialogs of the map tab: create a room (size picker, floor fill, wall
// border, grid position) and create a world (name, kind, music).
import type { MusicId, WorldKind } from '../../core/types';
import type { EditorContext } from '../context';
import type { ModalHandle } from '../ui/dom';
import type { WallStyle } from './walls';
import { MAX_ROOM_SCREENS, SCREEN_COLS, SCREEN_ROWS } from '../../core/constants';
import { MUSIC_IDS } from '../../core/types';
import { defaultWorldMusic, findWorld, gridOverlaps } from '../../core/project';
import { T } from '../../content/ids';
import { checkbox, el, field, modal, numberInput, pixelCanvas, select, textInput } from '../ui/dom';
import { GRID_LIMIT, ROOM_FILLS, addRoom, buildRoom, defaultFillKey, floorLabel, nextRoomName, withinGrid } from './roomOps';
import { WALL_STYLE_LABELS, wallStyleForFill } from './walls';
import { WORLD_KIND_LABELS, addWorld } from './worldOps';

/** 4 x 4 grid for choosing a room size in screens. */
function sizePicker(initial: { w: number; h: number }, onChange: (w: number, h: number) => void): HTMLDivElement {
  let chosen = { ...initial };
  const readout = el('div', { class: 'qf-map-size__readout' });
  const cells: HTMLButtonElement[] = [];
  const paint = (w: number, h: number): void => {
    cells.forEach((c, i) => {
      const on = i % MAX_ROOM_SCREENS < w && Math.floor(i / MAX_ROOM_SCREENS) < h;
      c.classList.toggle('qf-map-size__cell--on', on);
      c.setAttribute('aria-pressed', String(i % MAX_ROOM_SCREENS === chosen.w - 1 && Math.floor(i / MAX_ROOM_SCREENS) === chosen.h - 1));
    });
    readout.textContent = `${w} × ${h} screen${w * h > 1 ? 's' : ''} (${w * SCREEN_COLS} × ${h * SCREEN_ROWS} tiles)`;
  };
  const restore = (): void => paint(chosen.w, chosen.h);
  const grid = el('div', { class: 'qf-map-size__grid', role: 'group', 'aria-label': 'Room size in screens', on: { mouseleave: restore, focusout: restore } });
  for (let y = 1; y <= MAX_ROOM_SCREENS; y++) {
    for (let x = 1; x <= MAX_ROOM_SCREENS; x++) {
      const cell = el('button', {
        class: 'qf-map-size__cell', type: 'button', title: `${x} × ${y}`, 'aria-label': `${x} by ${y} screens`, dataset: { w: String(x), h: String(y) },
        on: {
          mouseenter: () => paint(x, y),
          focus: () => paint(x, y),
          click: () => {
            chosen = { w: x, h: y };
            paint(x, y);
            onChange(x, y);
          },
        },
      });
      cells.push(cell);
      grid.appendChild(cell);
    }
  }
  paint(chosen.w, chosen.h);
  return el('div', { class: 'qf-map-size' }, grid, readout);
}

/** Enter in a text or number field of the dialog presses its primary button. */
function submitOnEnter(h: ModalHandle): void {
  h.body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox') return;
    e.preventDefault();
    // Commit the field's value first (number inputs apply on 'change').
    e.target.dispatchEvent(new Event('change'));
    h.body.parentElement?.querySelector<HTMLButtonElement>('.qf-modal__footer .qf-btn--primary')?.click();
  });
}

/** Small 2x tile swatch. */
function tileSwatch(ctx: EditorContext, id: number): HTMLCanvasElement {
  const c = pixelCanvas(16, 16, 2, 'qf-map-swatch');
  const g = c.getContext('2d');
  if (g) ctx.assets.drawTileTo(g, id, 0, 0, 1);
  return c;
}

/** Ask for a new room at grid cell (gx, gy) of a world floor; creates it (undoable) on confirm. */
export function openNewRoomDialog(ctx: EditorContext, worldId: string, floor: number, at: { gx: number; gy: number }): void {
  const world = findWorld(ctx.project, worldId);
  if (!world) return;
  const spec = { name: nextRoomName(world), gw: 1, gh: 1, gx: at.gx, gy: at.gy, fillKey: defaultFillKey(world.kind), walls: world.kind !== 'overworld' };
  const error = el('div', { class: 'qf-map-dialog__error', role: 'alert' });
  const wallLabel = el('span');
  const wallBox = checkbox(spec.walls, (v) => { spec.walls = v; }, 'Wall border');
  wallBox.appendChild(wallLabel);
  const wallInput = wallBox.querySelector('input')!;
  const style = (): WallStyle | null => wallStyleForFill(T[spec.fillKey] ?? 0);
  const syncWalls = (): void => {
    const s = style();
    wallInput.disabled = s === null;
    wallInput.checked = s !== null && spec.walls;
    wallLabel.textContent = s ? ` (${WALL_STYLE_LABELS[s]})` : ' (not for grass)';
  };
  const fills = el('div', { class: 'qf-map-fills', role: 'radiogroup' });
  const fillButtons = ROOM_FILLS.map((f) => {
    const b = el('button', {
      class: 'qf-map-fill', type: 'button', role: 'radio', title: f.label, dataset: { fill: f.key },
      on: {
        click: () => {
          spec.fillKey = f.key;
          spec.walls = f.key !== 'GRASS';
          syncFills();
          syncWalls();
        },
      },
    }, tileSwatch(ctx, T[f.key] ?? 0), el('span', null, f.label));
    fills.appendChild(b);
    return b;
  });
  const syncFills = (): void => fillButtons.forEach((b) => {
    const on = b.dataset.fill === spec.fillKey;
    b.classList.toggle('qf-map-fill--on', on);
    b.setAttribute('aria-checked', String(on));
  });
  syncFills();
  syncWalls();
  const body = el('div', { class: 'qf-map-dialog' },
    field('Name', textInput(spec.name, (v) => { spec.name = v; }, { live: true })),
    field('Size', sizePicker({ w: 1, h: 1 }, (w, h) => { spec.gw = w; spec.gh = h; error.textContent = ''; })),
    field('Floor tile', fills),
    field('', wallBox),
    field('Grid position', el('div', { class: 'qf-row' },
      numberInput(spec.gx, (v) => { spec.gx = Math.round(v); error.textContent = ''; }, { step: 1, min: -GRID_LIMIT, max: GRID_LIMIT, title: 'Column (screens)' }),
      numberInput(spec.gy, (v) => { spec.gy = Math.round(v); error.textContent = ''; }, { step: 1, min: -GRID_LIMIT, max: GRID_LIMIT, title: 'Row (screens)' }),
      el('span', { class: 'qf-muted' }, `on floor ${floorLabel(floor)}`))),
    error);
  submitOnEnter(modal({
    title: `New room in “${world.name}”`,
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Create room', kind: 'primary',
        onClick: () => {
          const w = findWorld(ctx.project, worldId);
          if (!w) return true;
          if (gridOverlaps(w, spec.gx, spec.gy, spec.gw, spec.gh, floor)) {
            error.textContent = 'That spot overlaps another room on this floor — pick a smaller size or another position.';
            return false;
          }
          if (!withinGrid(spec.gx, spec.gy, spec.gw, spec.gh)) {
            error.textContent = `Rooms must stay within ${GRID_LIMIT} screens of the origin — pick a position closer to 0, 0.`;
            return false;
          }
          const room = buildRoom({
            name: spec.name.trim() || nextRoomName(w), gx: spec.gx, gy: spec.gy, gw: spec.gw, gh: spec.gh, floor,
            fill: T[spec.fillKey] ?? 0, walls: spec.walls ? style() : null,
          });
          addRoom(ctx, worldId, room);
          return true;
        },
      },
    ],
  }));
}

const KIND_OPTIONS = (Object.keys(WORLD_KIND_LABELS) as WorldKind[]).map((k) => ({ value: k, label: WORLD_KIND_LABELS[k] }));

/** Music choices for worlds ('none' first). */
export const WORLD_MUSIC_OPTIONS: readonly { value: MusicId | 'none'; label: string }[] = [
  { value: 'none', label: 'No music' },
  ...MUSIC_IDS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
];

/** Ask for a new world's name, kind and music; creates it (with a starter room) on confirm. */
export function openNewWorldDialog(ctx: EditorContext): void {
  const spec: { name: string; kind: WorldKind; music: MusicId | 'none'; musicTouched: boolean } = {
    name: `World ${ctx.project.worlds.length + 1}`, kind: 'dungeon', music: defaultWorldMusic('dungeon'), musicTouched: false,
  };
  const music = select(WORLD_MUSIC_OPTIONS, spec.music, (v) => { spec.music = v; spec.musicTouched = true; });
  const kind = select(KIND_OPTIONS, spec.kind, (v) => {
    spec.kind = v;
    if (!spec.musicTouched) {
      spec.music = defaultWorldMusic(v);
      music.value = spec.music;
    }
  });
  submitOnEnter(modal({
    title: 'New world',
    body: el('div', { class: 'qf-map-dialog' },
      field('Name', textInput(spec.name, (v) => { spec.name = v; }, { live: true })),
      field('Kind', kind, 'Dungeons track their own small keys, big key, map and compass.'),
      field('Music', music)),
    buttons: [
      { label: 'Cancel' },
      { label: 'Create world', kind: 'primary', onClick: () => void addWorld(ctx, spec.name.trim() || 'World', spec.kind, spec.music) },
    ],
  }));
}
