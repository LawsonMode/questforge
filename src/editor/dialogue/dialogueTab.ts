// Dialogue tab: searchable dialogue list (add / duplicate / rename / delete with
// reference checks), page editor (speaker, text, choices), live preview drawn
// by the game's own dialogue box, "Used by" list with jump buttons, and the
// project flags manager.
import '../entities/entities.css';
import './dialogue.css';
import type { EditorContext, Panel, ProjectChange } from '../context';
import type { Dialogue, DialoguePage } from '../../core/types';
import { button, el, panel, promptDialog, setChildren, textInput, type Child } from '../ui/dom';
import { allRoomRefsPart, commit, dialoguePart, dialoguesPart, settingsPart } from '../entities/edit';
import { clearDialogueRefs, dialogueUsageCounts, dialogueUsages, type UsageWhere } from '../entities/refs';
import { takeDialogueFocus } from '../entities/focus';
import {
  RenderScheduler, choiceDialog, copyButton, focusKey, isShown, keepFocus, newDialogue, retarget, usageBody,
} from '../entities/widgets';
import { dialogueSnippet, duplicateDialogue, filterDialogues, renamedDialogueName, uniqueDialogueName } from './dialogueModel';
import { buildPages, type PageEditHost, type PageEditOpts } from './pageEditor';
import { DialoguePreview } from './preview';
import { FlagsManager } from './flagsManager';
import { jumpToUsage, usageList } from './usage';

/** Project changes that can alter what the tab shows. */
const TAB_CHANGES: ReadonlySet<ProjectChange> = new Set<ProjectChange>([
  'dialogues', 'flags', 'entities', 'triggers', 'settings', 'room', 'rooms', 'worlds', 'all',
]);

class DialogueTab {
  readonly element: HTMLDivElement;
  private readonly listHost = el('div', { class: 'qf-dlg-list' });
  private readonly mainHost = el('div', { class: 'qf-dlg-main__body' });
  private readonly usedHost = el('div', { class: 'qf-dlg-used' });
  private readonly preview: DialoguePreview;
  private readonly flags: FlagsManager;
  private readonly toolbar: HTMLButtonElement[];
  private readonly scheduler: RenderScheduler;
  private selectedId: string | null = null;
  private selectedPage = 0;
  private query = '';
  private draftPage: { index: number; page: DialoguePage } | null = null;
  private muted = false;
  /** Scroll the selected dialogue into view (and maybe focus its text) once the tab is shown. */
  private reveal: { text: boolean } | null = null;

  constructor(private readonly ctx: EditorContext) {
    this.preview = new DialoguePreview(ctx);
    this.flags = new FlagsManager(ctx, {
      mute: (fn) => this.mutate(fn),
      jump: (w) => this.jump(w),
      refresh: () => this.render(),
    });
    const search = textInput('', (v) => {
      this.query = v;
      this.renderList();
    }, { placeholder: 'Search dialogues…', live: true });
    search.classList.add('qf-dlg-search');
    this.toolbar = [
      button('+ New', () => this.add(), { small: true, kind: 'primary', title: 'Create a dialogue' }),
      button('Duplicate', () => this.duplicate(), { small: true }),
      button('Rename', () => void this.rename(), { small: true }),
      button('Delete', () => void this.remove(), { small: true, kind: 'danger' }),
    ];
    const listPanel = panel('Dialogues', el('div', { class: 'qf-dlg-listbar' }, search, el('div', { class: 'qf-ent-inline' }, this.toolbar)), this.listHost);
    listPanel.classList.add('qf-dlg-listpanel');
    const flagsPanel = panel('Flags', this.flags.element);
    flagsPanel.classList.add('qf-dlg-flagspanel');
    const previewPanel = panel('Preview', this.preview.element);
    const usedPanel = panel('Used by', this.usedHost);
    this.element = el('div', { class: 'qf-dlg' },
      el('aside', { class: 'qf-dlg-side' }, listPanel, flagsPanel),
      el('main', { class: 'qf-dlg-main' }, this.mainHost),
      el('aside', { class: 'qf-dlg-right' }, previewPanel, usedPanel));
    this.scheduler = new RenderScheduler(this.element, () => this.render());
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Select dialogue `id` (e.g. from a "jump to" request) and bring it into view; `editText` also focuses its first page. */
  focus(id: string, editText = false): void {
    if (!this.ctx.project.dialogues.some((d) => d.id === id)) return;
    if (id !== this.selectedId) this.selectedPage = 0;
    this.selectedId = id;
    this.reveal = { text: editText };
    this.clearSearch();
  }

  /** Re-render soon (after the click when a press is in progress). */
  schedule(): void {
    this.scheduler.schedule();
  }

  render(): void {
    keepFocus(this.element, () => {
      this.renderList();
      setChildren(this.mainHost, this.buildMain());
      this.renderUsed();
      this.flags.render();
    });
    this.renderPreview();
    this.revealSelected();
  }

  /** Stop a running preview playback (e.g. when the tab is left). */
  stopPreview(): void {
    this.preview.stop();
  }

  destroy(): void {
    this.scheduler.destroy();
    this.preview.destroy();
    this.element.remove();
  }

  private clearSearch(): void {
    this.query = '';
    const search = this.element.querySelector<HTMLInputElement>('.qf-dlg-search');
    if (search) search.value = '';
  }

  /** Honour a pending reveal once the tab is on screen: scroll the selected item into view, maybe focus its text. */
  private revealSelected(): void {
    const r = this.reveal;
    if (!r || !isShown(this.listHost)) return;
    this.reveal = null;
    this.listHost.querySelector('.qf-list__item--active')?.scrollIntoView({ block: 'nearest' });
    if (r.text) this.mainHost.querySelector<HTMLTextAreaElement>('.qf-dlg-page__text')?.focus();
  }

  // ---------------------------------------------------------------- state

  private current(): Dialogue | null {
    const list = this.ctx.project.dialogues;
    const d = list.find((x) => x.id === this.selectedId) ?? null;
    if (d) return d;
    const first = filterDialogues(list, this.query)[0] ?? list[0] ?? null;
    this.selectedId = first?.id ?? null;
    this.selectedPage = 0;
    return first;
  }

  private select(id: string): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.selectedPage = 0;
    this.draftPage = null;
    this.render();
  }

  // ---------------------------------------------------------------- sections

  private renderList(): void {
    const d = this.current();
    for (const b of this.toolbar.slice(1)) b.disabled = !d;
    const shown = filterDialogues(this.ctx.project.dialogues, this.query);
    if (!shown.length) {
      setChildren(this.listHost, el('div', { class: 'qf-dlg-usage__empty' },
        this.ctx.project.dialogues.length ? 'No dialogue matches that search.' : 'No dialogues yet. Press “+ New” to write one.'));
      return;
    }
    const counts = dialogueUsageCounts(this.ctx.project);
    setChildren(this.listHost, el('ul', { class: 'qf-list' }, shown.map((x, i) => {
      const uses = counts.get(x.id) ?? 0;
      return el('li', {
        class: `qf-list__item qf-dlg-item${x === d ? ' qf-list__item--active' : ''}`,
        dataset: { dialogue: x.id, fk: `dlg-item:${x.id}` },
        tabIndex: 0,
        on: {
          click: () => this.select(x.id),
          keydown: (e: KeyboardEvent) => this.onItemKey(e, shown, i),
        },
      },
      el('div', { class: 'qf-dlg-item__top' },
        el('span', { class: 'qf-dlg-item__name' }, x.name || x.id),
        el('span', { class: 'qf-dlg-item__meta' }, `${x.pages.length} p`),
        el('span', { class: `qf-badge${uses ? '' : ' qf-dlg-item__unused'}`, title: uses ? `Used ${uses}×` : 'Not used anywhere' }, uses ? `${uses}×` : 'unused')),
      el('div', { class: 'qf-dlg-item__snippet' }, dialogueSnippet(x) || '(empty)'));
    })));
  }

  /** Enter / Space selects the item; ↑ ↓ select (and focus) the neighbour in the displayed list. */
  private onItemKey(e: KeyboardEvent, shown: readonly Dialogue[], i: number): void {
    const item = shown[i];
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.select(item.id);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const to = shown[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!to) return;
    retarget(e, `dlg-item:${to.id}`);
    this.select(to.id);
  }

  private buildMain(): Child[] {
    const d = this.current();
    if (!d) return [el('div', { class: 'qf-empty' }, 'No dialogue selected. Press “+ New” to write one.')];
    if (this.selectedPage >= d.pages.length) this.selectedPage = Math.max(0, d.pages.length - 1);
    const name = focusKey(textInput(d.name, (v) => this.renameInline(d.id, v, name), { placeholder: 'Dialogue name' }), 'dlg:name');
    name.classList.add('qf-dlg-name');
    return [
      el('div', { class: 'qf-dlg-head' },
        name,
        el('code', { class: 'qf-ent-id', title: 'Dialogue id (used in props & triggers)' }, d.id),
        copyButton(this.ctx, d.id)),
      buildPages(this.pageHost(d)),
    ];
  }

  private renderUsed(): void {
    const d = this.current();
    setChildren(this.usedHost, d
      ? usageList(dialogueUsages(this.ctx.project, d.id), (w) => this.jump(w),
        'Not used yet: choose it in a Person or Sign “Dialogue” field, a trigger “Show dialogue” action, or as the intro in project settings.')
      : null);
  }

  private renderPreview(): void {
    const d = this.current();
    const draft = this.draftPage;
    const pages = d ? d.pages.map((pg, i) => (draft && draft.index === i ? draft.page : pg)) : [];
    this.preview.show(pages, this.selectedPage);
  }

  private jump(where: UsageWhere): void {
    jumpToUsage(this.ctx, where, (id) => {
      this.focus(id);
      this.render();
    });
  }

  // ---------------------------------------------------------------- page host

  private pageHost(d: Dialogue): PageEditHost {
    return {
      ctx: this.ctx,
      dialogue: d,
      selected: this.selectedPage,
      edit: (label, fn, opts) => this.editDialogue(d.id, label, fn, opts),
      selectPage: (i) => this.selectPage(i),
      draft: (i, page) => {
        this.draftPage = { index: i, page };
        this.selectPage(i);
        this.renderPreview();
      },
    };
  }

  private selectPage(i: number): void {
    if (i === this.selectedPage) return;
    this.selectedPage = i;
    if (this.draftPage?.index !== i) this.draftPage = null;
    for (const card of this.mainHost.querySelectorAll<HTMLElement>('.qf-dlg-page')) {
      card.classList.toggle('qf-dlg-page--active', card.dataset.page === String(i));
    }
    this.renderPreview();
  }

  // ---------------------------------------------------------------- edits

  private mutate(fn: () => void): void {
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
  }

  private editDialogue(id: string, label: string, fn: (d: Dialogue) => void, opts: PageEditOpts = {}): void {
    const { ctx } = this;
    this.mutate(() => {
      commit(ctx, label, [dialoguePart(ctx, id)], () => {
        const d = ctx.project.dialogues.find((x) => x.id === id);
        if (d) fn(d);
      });
      ctx.changed('dialogues', id);
    });
    this.draftPage = null;
    if (opts.select !== undefined) this.selectedPage = opts.select;
    if (opts.rebuild) {
      this.scheduler.schedule();
      return;
    }
    // The preview never moves other controls; the list and flag counts are rebuilt after the click.
    this.renderPreview();
    this.scheduler.afterPress(() => {
      keepFocus(this.listHost, () => this.renderList());
      this.flags.render();
      this.revealSelected();
    });
  }

  /** Change the dialogue list (one undo step) and select `select`. */
  private editList(label: string, fn: (list: Dialogue[]) => void, select: string | null): void {
    const { ctx } = this;
    this.mutate(() => {
      commit(ctx, label, [dialoguesPart(ctx)], () => fn(ctx.project.dialogues));
      ctx.changed('dialogues', select ?? undefined);
    });
    this.selectedId = select;
    this.selectedPage = 0;
    this.draftPage = null;
    this.render();
  }

  private add(): void {
    const d = newDialogue(uniqueDialogueName(this.ctx.project, 'New dialogue'));
    this.clearSearch();
    this.reveal = { text: true };
    this.editList('Add dialogue', (list) => { list.push(d); }, d.id);
  }

  private duplicate(): void {
    const d = this.current();
    if (!d) return;
    const copy = duplicateDialogue(this.ctx.project, d);
    this.reveal = { text: false };
    this.editList('Duplicate dialogue', (list) => {
      const at = list.findIndex((x) => x.id === d.id);
      list.splice(at < 0 ? list.length : at + 1, 0, copy);
    }, copy.id);
  }

  /**
   * The new name for dialogue `id` from what was typed: null when blank or
   * unchanged; a name another dialogue has is numbered (with a toast).
   */
  private newName(id: string, typed: string): string | null {
    const cur = this.ctx.project.dialogues.find((x) => x.id === id);
    const next = renamedDialogueName(this.ctx.project, id, typed);
    if (!cur || next === null) return null;
    if (next !== typed.trim()) this.ctx.toast(`Another dialogue is already called “${typed.trim()}”, so this one is “${next}”.`);
    if (next === cur.name) return null;
    this.reveal = { text: false };
    return next;
  }

  /** Commit the header name field (it then shows the stored name). */
  private renameInline(id: string, typed: string, input: HTMLInputElement): void {
    const next = this.newName(id, typed);
    if (next !== null) this.editDialogue(id, 'Rename dialogue', (x) => { x.name = next; });
    input.value = this.ctx.project.dialogues.find((x) => x.id === id)?.name ?? input.value;
  }

  private async rename(): Promise<void> {
    const d = this.current();
    if (!d) return;
    const typed = await promptDialog('Dialogue name (for you; players never see it):', d.name, { title: 'Rename dialogue', ok: 'Rename' });
    const next = typed === null ? null : this.newName(d.id, typed);
    if (next !== null) this.editDialogue(d.id, 'Rename dialogue', (x) => { x.name = next; }, { rebuild: true });
  }

  private async remove(): Promise<void> {
    const { ctx } = this;
    const d = this.current();
    if (!d) return;
    const uses = dialogueUsages(ctx.project, d.id);
    let clear = false;
    if (uses.length) {
      const body = usageBody(`“${d.name || d.id}” is used by:`, uses.map((u) => u.label),
        'Clear those references too? Otherwise they point at a missing dialogue (shown as warnings).');
      const choice = await choiceDialog('Delete dialogue', body, [
        { label: 'Delete, keep references', value: 'keep' as const },
        { label: 'Delete and clear references', value: 'clear' as const, kind: 'danger' },
      ]);
      if (!choice) return;
      clear = choice === 'clear';
    }
    const list = ctx.project.dialogues;
    // The neighbour in the list as displayed (sorted, filtered), not in the project array.
    const shown = filterDialogues(list, this.query);
    const at = shown.findIndex((x) => x.id === d.id);
    const next = shown[at + 1] ?? shown[at - 1] ?? null;
    this.mutate(() => {
      commit(ctx, 'Delete dialogue', [dialoguesPart(ctx), allRoomRefsPart(ctx), settingsPart(ctx)], () => {
        const i = list.findIndex((x) => x.id === d.id);
        if (i >= 0) list.splice(i, 1);
        if (clear) clearDialogueRefs(ctx.project, d.id);
      });
      ctx.changed('dialogues', d.id);
      if (clear) for (const what of ['entities', 'triggers', 'settings'] as const) ctx.changed(what);
    });
    ctx.toast(`Deleted “${d.name || d.id}”. Undo brings it back.`);
    this.selectedId = next?.id ?? null;
    this.selectedPage = 0;
    this.draftPage = null;
    this.reveal = { text: false };
    this.render();
  }
}

/** Mount the Dialogue tab into `host`. */
export function mountDialogueTab(host: HTMLElement, ctx: EditorContext): Panel {
  const tab = new DialogueTab(ctx);
  host.appendChild(tab.element);
  /** Take a pending "show this dialogue" request from another panel. */
  const takeFocus = (): void => {
    const req = takeDialogueFocus();
    if (req) tab.focus(req.id, req.editText);
  };
  takeFocus();
  tab.render();
  const schedule = (): void => tab.schedule();
  const offs = [
    ctx.bus.on('project', ({ what }) => {
      if (!tab.isMuted && TAB_CHANGES.has(what)) schedule();
    }),
    ctx.bus.on('undo', schedule),
    ctx.bus.on('tab', ({ id }) => {
      if (id !== 'dialogue') {
        tab.stopPreview();
        return;
      }
      takeFocus();
      schedule();
    }),
    ctx.bus.on('assets', schedule),
  ];
  return {
    destroy: () => {
      for (const off of offs) off();
      tab.destroy();
    },
    refresh: () => {
      takeFocus();
      tab.render();
    },
  };
}
