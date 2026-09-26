// Menu project cards: a thumbnail of the start screen, name, room count,
// modified time and the Play / Edit / Duplicate / Export / Delete actions.
import type { Project } from '../core/types';
import type { ProjectMeta } from '../core/storage';
import { AssetCache } from '../gfx/imageCache';
import { el, pixelCanvas } from '../editor/ui/dom';
import { icon, type IconName } from '../editor/shell/icons';
import { paintStartScreen } from './thumbnail';
import { fullDate, plural, relativeTime } from './format';

/** Handlers behind a card's buttons. */
export interface CardActions {
  play(): void;
  edit(): void;
  duplicate(): void;
  exportFile(): void;
  /** Omitted for the built-in sample. */
  remove?(): void;
}

/** A rendered project card. */
export interface Card {
  readonly element: HTMLElement;
  /** Draw the project's start screen into the thumbnail ("No rooms yet" when there is none). */
  paint(project: Project): void;
  /** The thumbnail could not be drawn. */
  fail(): void;
}

/** Text shown on a card. */
export interface CardInfo {
  id: string;
  name: string;
  /** Second line, e.g. "3 rooms · edited 5 min ago". */
  meta: string;
  metaTitle?: string;
  badge?: string;
  /** Label of the edit button ("Edit", "Edit a copy"). */
  editLabel?: string;
}

/** Card text for a stored project. */
export function metaInfo(m: ProjectMeta): CardInfo {
  return {
    id: m.id, name: m.name,
    meta: `${plural(m.rooms, 'room')} · edited ${relativeTime(m.modified)}`,
    metaTitle: `Last saved ${fullDate(m.modified)}${m.author ? ` · by ${m.author}` : ''}`,
  };
}

function iconAction(name: IconName, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return el('button', {
    class: `qf-btn qf-btn--ghost qf-menu-card__icon ${cls}`.trim(), type: 'button', title: label, 'aria-label': label,
    on: { click: onClick },
  }, icon(name));
}

/** Build a project card (thumbnail painted later via paint()). */
export function createCard(info: CardInfo, actions: CardActions): Card {
  const canvas = pixelCanvas(256, 224, 1, 'qf-menu-card__canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Start screen of ${info.name}`);
  const thumb = el('div', { class: 'qf-menu-card__thumb qf-menu-card__thumb--loading' }, canvas);
  const titleId = `qf-card-${info.id}`;
  const element = el('article', { class: 'qf-menu-card', dataset: { projectId: info.id }, 'aria-labelledby': titleId },
    thumb,
    el('div', { class: 'qf-menu-card__body' },
      el('h3', { class: 'qf-menu-card__name', id: titleId, title: info.name }, info.name),
      info.badge ? el('span', { class: 'qf-menu-card__badge' }, info.badge) : null,
      el('div', { class: 'qf-menu-card__meta', title: info.metaTitle ?? '' }, info.meta)),
    el('div', { class: 'qf-menu-card__actions' },
      el('button', { class: 'qf-btn qf-btn--primary qf-menu-card__play', type: 'button', title: `Play ${info.name}`, on: { click: actions.play } },
        icon('play', 14), 'Play'),
      el('button', { class: 'qf-btn qf-menu-card__edit', type: 'button', title: `Open ${info.name} in the editor`, on: { click: actions.edit } },
        icon('edit', 14), info.editLabel ?? 'Edit'),
      el('div', { class: 'qf-grow' }),
      iconAction('copy', `Duplicate ${info.name}`, actions.duplicate, 'qf-menu-card__duplicate'),
      iconAction('download', `Export ${info.name} as a .questforge.json file`, actions.exportFile, 'qf-menu-card__export'),
      actions.remove ? iconAction('trash', `Delete ${info.name}`, actions.remove, 'qf-menu-card__delete') : null));
  return {
    element,
    paint(project: Project) {
      const painted = paintStartScreen(canvas, project, new AssetCache(project));
      thumb.classList.remove('qf-menu-card__thumb--loading');
      thumb.classList.toggle('qf-menu-card__thumb--empty', painted === 'none');
    },
    fail() {
      thumb.classList.remove('qf-menu-card__thumb--loading');
      thumb.classList.add('qf-menu-card__thumb--missing');
    },
  };
}
