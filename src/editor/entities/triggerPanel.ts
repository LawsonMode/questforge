// Room trigger list + editor (on/source, conditions, actions with typed
// pickers). Mounted by the map tab's right sidebar; shows the current room.
import './entities.css';
import type { EditorContext, Panel, ProjectChange } from '../context';
import type { Room, Trigger } from '../../core/types';
import { findRoom } from '../../core/project';
import { button, el, setChildren } from '../ui/dom';
import { commit, dialoguesPart, roomTriggersPart, triggerPart, type Part } from './edit';
import { takeTriggerFocus } from './focus';
import { duplicateTrigger, newTrigger } from './triggerModel';
import { triggerIssues, triggerSummary } from './triggerText';
import { buildTriggerForm, triggerIssueBox, type EditOpts, type TriggerEditHost } from './triggerEditor';
import { RenderScheduler, focusKey, inline, isShown, keepFocus, retarget } from './widgets';

/** Project changes that can alter the list or the form. */
const TRIGGER_CHANGES: ReadonlySet<ProjectChange> = new Set<ProjectChange>([
  'triggers', 'entities', 'dialogues', 'flags', 'tiles', 'room', 'rooms', 'worlds', 'all',
]);

class TriggerPanel {
  private readonly head = el('div', { class: 'qf-ent-trig-head' });
  /** The list's scroll container: only its items are replaced, so the scroll position survives edits. */
  private readonly list = el('ul', { class: 'qf-list qf-ent-trig-ul' });
  private readonly body = el('div', { class: 'qf-ent-trig-body' });
  readonly element: HTMLDivElement = el('div', { class: 'qf-ent-trig' }, this.head, this.list, this.body);
  private readonly scheduler = new RenderScheduler(this.element, () => this.render());
  private issuesHost: HTMLDivElement | null = null;
  /** Selected trigger id per room. */
  private readonly selected = new Map<string, string>();
  private muted = false;
  /** Scroll the selected trigger into view once the panel is shown. */
  private reveal = false;

  constructor(private readonly ctx: EditorContext) {}

  get isMuted(): boolean {
    return this.muted;
  }

  /** Re-render soon (after the click when a press is in progress). */
  schedule(): void {
    this.scheduler.schedule();
  }

  render(): void {
    keepFocus(this.element, () => this.build());
    if (this.reveal && isShown(this.list)) {
      this.reveal = false;
      this.list.querySelector('.qf-list__item--active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  destroy(): void {
    this.scheduler.destroy();
    this.element.remove();
  }

  private build(): void {
    const { ctx } = this;
    this.issuesHost = null;
    const room = ctx.room();
    if (!room) {
      setChildren(this.head);
      setChildren(this.list);
      setChildren(this.body, el('div', { class: 'qf-ent-hint' }, 'Select a room to edit its triggers.'));
      return;
    }
    const focus = takeTriggerFocus(room.id);
    if (focus) {
      this.selected.set(room.id, focus);
      this.reveal = true;
    }
    const current = this.current(room);
    setChildren(this.head,
      el('span', { class: 'qf-ent-trig-head__title' }, `Triggers in ${room.name}`),
      el('span', { class: 'qf-badge' }, String(room.triggers.length)),
      focusKey(button('+ Add', () => this.add(room), { small: true, kind: 'primary', title: 'Add a trigger to this room' }), 'trig:add'));
    this.renderList(room, current);
    setChildren(this.body, current ? this.editor(room, current) : el('div', { class: 'qf-ent-hint' }, room.triggers.length
      ? 'Select a trigger to edit it.'
      : 'Triggers make things happen: open a door when all enemies are defeated, show a chest when a switch is pressed, talk, warp…'));
  }

  private editor(room: Room, current: Trigger): HTMLElement {
    const host = this.host(room, current);
    this.issuesHost = el('div', { class: 'qf-ent-warnhost' }, triggerIssueBox(host));
    const i = room.triggers.indexOf(current);
    return el('div', { class: 'qf-ent-trig-editor' },
      el('div', { class: 'qf-ent-trig-editor__bar' },
        el('code', { class: 'qf-ent-id', title: 'Trigger id' }, current.id),
        inline(
          focusKey(button('▲', () => this.move(room, i, i - 1), { small: true, disabled: i === 0, title: 'Move up (triggers run in list order)' }), 'trig:up', 'trig:down'),
          focusKey(button('▼', () => this.move(room, i, i + 1), { small: true, disabled: i === room.triggers.length - 1, title: 'Move down' }), 'trig:down', 'trig:up'),
          focusKey(button('Duplicate', () => this.duplicate(room, current), { small: true }), 'trig:dup'),
          button('Delete', (e) => {
            retarget(e, 'trig:add');
            this.remove(room, current);
          }, { small: true, kind: 'danger' }))),
      this.issuesHost,
      buildTriggerForm(host));
  }

  /**
   * The selected trigger of `room`, else the first one. A selected id that is
   * missing for now (e.g. its "Add" was undone) is kept, so a redo selects it again.
   */
  private current(room: Room): Trigger | null {
    const id = this.selected.get(room.id);
    return room.triggers.find((x) => x.id === id) ?? room.triggers[0] ?? null;
  }

  private renderList(room: Room, current: Trigger | null): void {
    const p = this.ctx.project;
    setChildren(this.list, room.triggers.map((t) => {
      const issues = triggerIssues(p, room, t).length;
      return el('li', {
        class: `qf-list__item qf-ent-trig-item${t === current ? ' qf-list__item--active' : ''}`,
        dataset: { trigger: t.id, fk: `trig-item:${t.id}` },
        tabIndex: 0,
        on: {
          click: () => this.select(room, t.id),
          keydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.select(room, t.id);
            }
          },
        },
      },
      el('div', { class: 'qf-ent-trig-item__top' },
        el('span', { class: 'qf-ent-trig-item__name' }, t.name || t.id),
        el('span', { class: 'qf-badge', title: 'Event' }, t.on),
        el('span', { class: 'qf-badge', title: t.once ? 'Fires once per save file' : 'Fires every time' }, t.once ? 'once' : 'repeat'),
        issues ? el('span', { class: 'qf-ent-trig-item__warn', title: `${issues} problem${issues === 1 ? '' : 's'}` }, `⚠ ${issues}`) : null),
      el('div', { class: 'qf-ent-trig-item__summary' }, triggerSummary(p, room, t)));
    }));
  }

  private select(room: Room, id: string): void {
    this.selected.set(room.id, id);
    this.reveal = true;
    this.render();
  }

  // ---------------------------------------------------------------- edits

  private host(room: Room, trigger: Trigger): TriggerEditHost {
    const worldId = this.ctx.worldId;
    return {
      ctx: this.ctx,
      room,
      trigger,
      edit: (label, fn, opts) => this.editTrigger(worldId, room, trigger.id, label, fn, opts),
    };
  }

  private editTrigger(worldId: string, room: Room, id: string, label: string, fn: (t: Trigger) => void, opts: EditOpts = {}): void {
    const { ctx } = this;
    const parts: Part[] = [triggerPart(ctx, worldId, room.id, id)];
    if (opts.created) parts.push(dialoguesPart(ctx));
    this.mutate(() => {
      commit(ctx, label, parts, () => {
        const t = findRoom(ctx.project, worldId, room.id)?.triggers.find((x) => x.id === id);
        if (!t) return;
        if (opts.created) ctx.project.dialogues.push(opts.created);
        fn(t);
      });
      if (opts.created) ctx.changed('dialogues', opts.created.id);
      ctx.changed('triggers', room.id);
    });
    if (opts.rebuild) this.scheduler.schedule();
    else this.scheduler.afterPress(() => this.updateDerived());
  }

  /** Refresh the list summaries and the issue box in place, for whatever is selected by then (the form is left alone). */
  private updateDerived(): void {
    const room = this.ctx.room();
    if (!room) return;
    const current = this.current(room);
    keepFocus(this.element, () => this.renderList(room, current));
    if (current && this.issuesHost) setChildren(this.issuesHost, triggerIssueBox({ ctx: this.ctx, room, trigger: current }));
  }

  /** Structural edit of the room's trigger list (one undo step), then re-render. */
  private editList(room: Room, label: string, fn: (list: Trigger[]) => void, select?: string): void {
    const { ctx } = this;
    const worldId = ctx.worldId;
    this.mutate(() => {
      commit(ctx, label, [roomTriggersPart(ctx, worldId, room.id)], () => {
        const live = findRoom(ctx.project, worldId, room.id);
        if (live) fn(live.triggers);
      });
      ctx.changed('triggers', room.id);
    });
    if (select) this.selected.set(room.id, select);
    this.reveal = true;
    this.render();
  }

  private mutate(fn: () => void): void {
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
  }

  /** Append a new trigger, select it and put the caret in its name. */
  private add(room: Room): void {
    const t = newTrigger(room);
    this.editList(room, 'Add trigger', (list) => { list.push(t); }, t.id);
    const name = this.element.querySelector<HTMLInputElement>('[data-fk="trig:name"]');
    name?.focus();
    name?.select();
  }

  private duplicate(room: Room, t: Trigger): void {
    const copy = duplicateTrigger(t, room);
    this.editList(room, 'Duplicate trigger', (list) => {
      const at = list.findIndex((x) => x.id === t.id);
      list.splice(at < 0 ? list.length : at + 1, 0, copy);
    }, copy.id);
  }

  private remove(room: Room, t: Trigger): void {
    const at = room.triggers.indexOf(t);
    const next = room.triggers[at + 1] ?? room.triggers[at - 1];
    this.editList(room, 'Delete trigger', (list) => {
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0) list.splice(i, 1);
    }, next?.id);
    this.ctx.toast(`Deleted “${t.name || t.id}”. Undo brings it back.`);
  }

  private move(room: Room, from: number, to: number): void {
    if (to < 0 || to >= room.triggers.length) return;
    this.editList(room, 'Reorder triggers', (list) => {
      const [t] = list.splice(from, 1);
      if (t) list.splice(to, 0, t);
    });
  }
}

/** Mount the current room's trigger list + editor into `host`. */
export function mountTriggerPanel(host: HTMLElement, ctx: EditorContext): Panel {
  const panel = new TriggerPanel(ctx);
  host.appendChild(panel.element);
  panel.render();
  const schedule = (): void => panel.schedule();
  const offs = [
    ctx.bus.on('selection', ({ what }) => {
      if (what === 'room' || what === 'tile') schedule();
    }),
    ctx.bus.on('project', ({ what }) => {
      if (!panel.isMuted && TRIGGER_CHANGES.has(what)) schedule();
    }),
    ctx.bus.on('undo', schedule),
    ctx.bus.on('tab', ({ id }) => {
      if (id === 'map') schedule();
    }),
  ];
  return {
    destroy: () => {
      for (const off of offs) off();
      panel.destroy();
    },
    refresh: () => panel.render(),
  };
}
