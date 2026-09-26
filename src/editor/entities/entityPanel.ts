// Entity palette (categories, icons from the catalog) + schema-driven inspector
// for the selected placed entity (all PropKinds incl. warp picker via
// ctx.pickLocation, dialogue/entity/flag pickers). Mounted by the map tab's
// right sidebar.
import './entities.css';
import type { EditorContext, Panel, ProjectChange } from '../context';
import { el } from '../ui/dom';
import { EntityPalette } from './palette';
import { EntityInspector } from './inspector';
import { RenderScheduler, fromTextControl, isShown } from './widgets';

/** Project changes that can alter what the inspector shows. */
const INSPECTOR_CHANGES: ReadonlySet<ProjectChange> = new Set<ProjectChange>([
  'entities', 'triggers', 'dialogues', 'flags', 'room', 'rooms', 'worlds', 'all',
]);

/** Mount the entity palette + inspector into `host`. */
export function mountEntityPanel(host: HTMLElement, ctx: EditorContext): Panel {
  let muted = false;
  const mute = (fn: () => void): void => {
    muted = true;
    try {
      fn();
    } finally {
      muted = false;
    }
  };
  const root = el('div', { class: 'qf-ent-panel' });
  /** Render the inspector; while it has nothing to edit the palette takes the free height. */
  const render = (): void => {
    inspector.render();
    root.classList.toggle('qf-ent-panel--idle', !inspector.editing);
  };
  const scheduler = new RenderScheduler(root, render);
  const palette = new EntityPalette(ctx);
  const inspector = new EntityInspector(ctx, mute, (fn) => scheduler.afterPress(fn));
  root.append(
    el('div', { class: 'qf-ent-section-title' }, 'Place'),
    palette.element,
    el('div', { class: 'qf-ent-section-title' }, 'Selected'),
    inspector.element);
  host.appendChild(root);
  render();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !ctx.entityType || fromTextControl(e) || !isShown(root)) return;
    if (document.querySelector('.qf-modal-backdrop')) return;
    ctx.selectEntityType(null);
  };
  document.addEventListener('keydown', onKey);

  const offs = [
    ctx.bus.on('selection', ({ what }) => {
      if (what === 'entityType') palette.highlight();
      if (what === 'entityType' || what === 'entity' || what === 'room') scheduler.schedule();
    }),
    ctx.bus.on('project', ({ what }) => {
      if (!muted && INSPECTOR_CHANGES.has(what)) scheduler.schedule();
    }),
    ctx.bus.on('undo', ({ label }) => {
      inspector.reselectRestored(label);
      scheduler.schedule();
    }),
    ctx.bus.on('assets', () => {
      palette.redrawIcons();
      inspector.updateDerived();
    }),
  ];

  return {
    destroy: () => {
      for (const off of offs) off();
      document.removeEventListener('keydown', onKey);
      scheduler.destroy();
      root.remove();
    },
    refresh: () => {
      palette.highlight();
      palette.redrawIcons();
      render();
    },
  };
}
