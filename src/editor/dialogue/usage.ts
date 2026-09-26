// "Used by" lists with jump buttons: go to the room + entity / trigger on the
// map tab, the project settings, or another dialogue.
import type { EditorContext } from '../context';
import { button, el } from '../ui/dom';
import { requestEntityFocus, requestTriggerFocus } from '../entities/focus';
import type { Usage, UsageWhere } from '../entities/refs';

/** Show where a reference lives. `selectDialogue` handles references inside dialogues. */
export function jumpToUsage(ctx: EditorContext, where: UsageWhere, selectDialogue: (id: string) => void): void {
  if (where.dialogue) {
    selectDialogue(where.dialogue);
    ctx.switchTab('dialogue');
    return;
  }
  if (where.settings) {
    ctx.switchTab('project');
    return;
  }
  if (!where.world || !where.room) return;
  if (where.trigger) requestTriggerFocus(where.room, where.trigger);
  if (where.entity) requestEntityFocus(where.room, where.entity);
  ctx.selectRoom(where.world, where.room);
  ctx.selectEntity(where.entity ?? null);
  ctx.switchTab('map');
}

/** Bullet list of usages, each with a "Go" button (empty text when there are none). */
export function usageList(usages: readonly Usage[], onJump: (where: UsageWhere) => void, emptyText: string): HTMLElement {
  if (!usages.length) return el('div', { class: 'qf-dlg-usage__empty' }, emptyText);
  return el('ul', { class: 'qf-dlg-usage' }, usages.map((u) => el('li', { class: 'qf-dlg-usage__item' },
    el('span', { class: 'qf-dlg-usage__label' }, u.label),
    button('Go', () => onJump(u.where), { small: true, title: 'Show it in the editor' }))));
}
