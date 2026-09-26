// Entity palette: every catalog type grouped by category with its icon and
// name, a search box, category chips (with counts) that scroll the list to
// their group, and click-to-arm placement (ctx.selectEntityType).
import type { EditorContext } from '../context';
import { ENTITY_TYPES, type EntityCategory, type EntityTypeInfo } from '../../core/catalog';
import { el, textInput } from '../ui/dom';
import { CATEGORY_LABELS } from './labels';
import { drawIcon, iconCanvas } from './icons';

const ICON_PX = 24;

interface Item {
  info: EntityTypeInfo;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
}

interface Group {
  section: HTMLElement;
  items: Item[];
  /** Chip that scrolls the list to this group; shows how many types it lists. */
  chip: HTMLButtonElement;
  count: HTMLSpanElement;
}

export class EntityPalette {
  readonly element: HTMLDivElement;
  private readonly groups: Group[] = [];
  private readonly empty: HTMLDivElement;
  private readonly list: HTMLDivElement = el('div', { class: 'qf-ent-palette__list' });
  private query = '';

  constructor(private readonly ctx: EditorContext) {
    const search = textInput('', (v) => this.setQuery(v), { placeholder: 'Search entities…', live: true });
    search.classList.add('qf-ent-search');
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !search.value) return;
      e.stopPropagation();
      search.value = '';
      this.setQuery('');
    });
    this.empty = el('div', { class: 'qf-ent-none', hidden: true }, 'No entity matches that search.');
    for (const cat of Object.keys(CATEGORY_LABELS) as EntityCategory[]) {
      const items = ENTITY_TYPES.filter((t) => t.category === cat).map((info) => this.item(info));
      if (items.length) this.groups.push(this.group(CATEGORY_LABELS[cat], items));
    }
    this.list.append(...this.groups.map((g) => g.section), this.empty);
    const chips = el('div', { class: 'qf-ent-cats' }, this.groups.map((g) => g.chip));
    this.element = el('div', { class: 'qf-ent-palette' }, search, chips, this.list);
    this.highlight();
  }

  private group(label: string, items: Item[]): Group {
    const section = el('section', { class: 'qf-ent-cat' },
      el('div', { class: 'qf-ent-cat__title' }, label),
      el('div', { class: 'qf-ent-grid' }, items.map((i) => i.button)));
    const count = el('span', { class: 'qf-ent-cat-chip__n' }, String(items.length));
    const chip = el('button', {
      class: 'qf-ent-cat-chip',
      type: 'button',
      title: `Scroll to ${label}`,
      on: { click: () => this.list.scrollTo({ top: section.offsetTop }) },
    }, label, count);
    return { section, items, chip, count };
  }

  private item(info: EntityTypeInfo): Item {
    const canvas = iconCanvas(this.ctx.assets, info.icon, ICON_PX);
    const button = el('button', {
      class: 'qf-ent-item',
      type: 'button',
      title: `${info.name}: ${info.description}`,
      dataset: { type: info.type },
      on: { click: () => this.ctx.selectEntityType(this.ctx.entityType === info.type ? null : info.type) },
    }, canvas, el('span', { class: 'qf-ent-item__name' }, info.name));
    return { info, button, canvas };
  }

  /** Mark the armed type (ctx.entityType). */
  highlight(): void {
    for (const g of this.groups) {
      for (const it of g.items) {
        const on = it.info.type === this.ctx.entityType;
        it.button.classList.toggle('qf-ent-item--active', on);
        it.button.setAttribute('aria-pressed', String(on));
      }
    }
  }

  /** Repaint icons after sprite / palette edits. */
  redrawIcons(): void {
    for (const g of this.groups) for (const it of g.items) drawIcon(it.canvas, this.ctx.assets, it.info.icon);
  }

  private setQuery(q: string): void {
    this.query = q.trim().toLowerCase();
    let any = false;
    for (const g of this.groups) {
      let shown = 0;
      for (const it of g.items) {
        const hit = !this.query || [it.info.name, it.info.type, it.info.description].some((s) => s.toLowerCase().includes(this.query));
        it.button.hidden = !hit;
        if (hit) shown++;
      }
      g.section.hidden = shown === 0;
      g.chip.disabled = shown === 0;
      g.count.textContent = String(shown);
      any ||= shown > 0;
    }
    this.empty.hidden = any;
  }
}
