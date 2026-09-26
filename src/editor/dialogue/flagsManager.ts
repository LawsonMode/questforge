// Flags manager (Dialogue tab): the project flag list with usage counts, add,
// rename (rewrites every reference), describe and delete (warns when used),
// plus flags that are referenced but never declared.
import type { EditorContext } from '../context';
import type { FlagDef } from '../../core/types';
import { button, el, modal, promptDialog, setChildren, type Child } from '../ui/dom';
import { allRoomRefsPart, commit, dialoguesPart, flagsPart } from '../entities/edit';
import { flagUsageCounts, flagUsages, isEngineFlag, renameFlag, type UsageWhere } from '../entities/refs';
import { choiceDialog, defineFlag, focusKey, keepFocus, usageBody } from '../entities/widgets';
import { compareNames } from '../entities/labels';
import { flagNameProblem } from './dialogueModel';
import { usageList } from './usage';

/** What the flags manager needs from the Dialogue tab. */
export interface FlagsHost {
  /** Run a mutation while the tab ignores its own change events. */
  mute(fn: () => void): void;
  /** Show where a usage lives. */
  jump(where: UsageWhere): void;
  /** Re-render the whole tab: renames and deletes also change the page cards' flag fields. */
  refresh(): void;
}

export class FlagsManager {
  readonly element: HTMLDivElement = el('div', { class: 'qf-dlg-flags' });

  constructor(private readonly ctx: EditorContext, private readonly host: FlagsHost) {}

  render(): void {
    keepFocus(this.element, () => setChildren(this.element, this.build()));
  }

  private build(): Child[] {
    const p = this.ctx.project;
    const counts = flagUsageCounts(p);
    const name = focusKey(el('input', { class: 'qf-input', type: 'text', placeholder: 'new_flag_name', title: 'Name of a new flag' }), 'flags:new');
    const add = (): void => this.add(name.value);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
    const declared = [...p.flags].sort((a, b) => compareNames(a.name, b.name));
    const others = [...counts.keys()].filter((n) => !p.flags.some((f) => f.name === n)).sort(compareNames);
    const undeclared = others.filter((n) => !isEngineFlag(n));
    const engine = others.filter(isEngineFlag);
    return [
      el('div', { class: 'qf-dlg-flags__add' }, name, button('Add', add, { small: true, kind: 'primary', title: 'Declare a new flag' })),
      declared.length
        ? el('ul', { class: 'qf-dlg-flags__list' }, declared.map((f) => this.row(f, counts.get(f.name) ?? 0)))
        : el('div', { class: 'qf-dlg-usage__empty' }, 'No flags yet. Flags remember choices and events in the save file (e.g. talked_to_elder).'),
      undeclared.length ? el('div', { class: 'qf-dlg-flags__undeclared' },
        el('div', { class: 'qf-dlg-flags__subtitle' }, 'Used but not declared'),
        el('ul', { class: 'qf-dlg-flags__list' }, undeclared.map((n) => el('li', { class: 'qf-dlg-flag' },
          el('code', { class: 'qf-dlg-flag__name' }, n),
          this.countBadge(n, counts.get(n) ?? 0),
          button('Declare', () => this.declare(n), { small: true, title: 'Add it to the project flag list' }))))) : null,
      engine.length ? el('div', { class: 'qf-dlg-flags__engine' },
        el('div', { class: 'qf-dlg-flags__subtitle qf-dlg-flags__subtitle--engine', title: 'Set by the game itself (chests opened, crystals won, …); triggers may read them.' }, 'Engine flags read by triggers'),
        el('ul', { class: 'qf-dlg-flags__list' }, engine.map((n) => el('li', { class: 'qf-dlg-flag' },
          el('code', { class: 'qf-dlg-flag__name' }, n),
          this.countBadge(n, counts.get(n) ?? 0))))) : null,
    ];
  }

  private row(f: FlagDef, count: number): HTMLLIElement {
    return el('li', { class: 'qf-dlg-flag', dataset: { flag: f.name } },
      el('div', { class: 'qf-dlg-flag__main' },
        el('code', { class: 'qf-dlg-flag__name' }, f.name),
        f.description ? el('div', { class: 'qf-dlg-flag__desc' }, f.description) : null),
      this.countBadge(f.name, count),
      el('div', { class: 'qf-dlg-flag__actions' },
        button('Rename', () => void this.rename(f.name), { small: true, kind: 'ghost', title: 'Rename everywhere' }),
        button('Describe', () => void this.describe(f.name), { small: true, kind: 'ghost', title: 'Add a note about what it means' }),
        button('Delete', () => void this.remove(f.name), { small: true, kind: 'ghost', title: 'Remove from the flag list' })));
  }

  private countBadge(name: string, count: number): HTMLButtonElement {
    return el('button', {
      class: `qf-badge qf-dlg-flag__count${count ? '' : ' qf-dlg-flag__count--unused'}`,
      type: 'button',
      title: count ? `Used ${count} time${count === 1 ? '' : 's'}: click to see where` : 'Not used anywhere',
      disabled: !count,
      on: { click: () => this.showUsages(name) },
    }, count ? `${count} use${count === 1 ? '' : 's'}` : 'unused');
  }

  private showUsages(name: string): void {
    const h = modal({
      title: `Flag “${name}” is used by`,
      body: usageList(flagUsages(this.ctx.project, name), (w) => {
        h.close();
        this.host.jump(w);
      }, 'Nothing uses it.'),
    });
  }

  // ---------------------------------------------------------------- edits

  private add(raw: string): void {
    const problem = flagNameProblem(this.ctx.project, raw);
    if (problem) {
      this.ctx.toast(problem, 'error');
      return;
    }
    this.declare(raw.trim());
  }

  private declare(name: string): void {
    this.host.mute(() => defineFlag(this.ctx, name));
    this.host.refresh();
  }

  private async rename(from: string): Promise<void> {
    const { ctx } = this;
    const typed = await promptDialog(`New name for “${from}”. Every trigger, entity and dialogue choice using it is updated.`, from, { title: 'Rename flag', ok: 'Rename' });
    const to = typed?.trim();
    if (to === undefined || to === from) return;
    const problem = flagNameProblem(ctx.project, to, from);
    if (problem) {
      ctx.toast(problem, 'error');
      return;
    }
    if (!(await this.confirmMerge(from, to))) return;
    let n = 0;
    this.host.mute(() => {
      commit(ctx, 'Rename flag', [flagsPart(ctx), allRoomRefsPart(ctx), dialoguesPart(ctx)], () => { n = renameFlag(ctx.project, from, to); });
      for (const what of ['flags', 'triggers', 'entities', 'dialogues'] as const) ctx.changed(what);
    });
    ctx.toast(`Renamed to “${to}” (${n} reference${n === 1 ? '' : 's'} updated).`, 'success');
    this.host.refresh();
  }

  /** A rename onto a name that is used but not declared joins two flags: ask first. */
  private async confirmMerge(from: string, to: string): Promise<boolean> {
    const uses = flagUsages(this.ctx.project, to);
    if (!uses.length) return true;
    const body = usageBody(`“${to}” is already used (not declared) by:`, uses.map((u) => u.label),
      `Renaming “${from}” to it merges the two flags: everything that reads or sets either one will share a single value.`);
    return (await choiceDialog('Merge flags?', body, [{ label: 'Merge', value: true, kind: 'danger' }])) === true;
  }

  private async describe(name: string): Promise<void> {
    const { ctx } = this;
    const current = ctx.project.flags.find((f) => f.name === name)?.description ?? '';
    const text = await promptDialog(`What does “${name}” mean? (shown as a hint in flag pickers)`, current, { title: 'Describe flag', ok: 'Save' });
    if (text === null) return;
    this.host.mute(() => {
      commit(ctx, 'Describe flag', [flagsPart(ctx)], () => {
        const f = ctx.project.flags.find((x) => x.name === name);
        if (!f) return;
        if (text.trim()) f.description = text.trim();
        else delete f.description;
      });
      ctx.changed('flags');
    });
    this.host.refresh();
  }

  private async remove(name: string): Promise<void> {
    const { ctx } = this;
    const uses = flagUsages(ctx.project, name);
    if (uses.length) {
      const body = usageBody(`“${name}” is used by:`, uses.map((u) => u.label),
        'Remove it from the list anyway? Those references keep working, but the flag will show as undeclared.');
      if (!(await choiceDialog('Delete flag', body, [{ label: 'Delete', value: true, kind: 'danger' }]))) return;
    }
    this.host.mute(() => {
      commit(ctx, 'Delete flag', [flagsPart(ctx)], () => {
        const at = ctx.project.flags.findIndex((f) => f.name === name);
        if (at >= 0) ctx.project.flags.splice(at, 1);
      });
      ctx.changed('flags');
    });
    this.host.refresh();
  }
}
