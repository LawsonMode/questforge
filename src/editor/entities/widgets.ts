// Shared editor widgets for the entity inspector, trigger editor and dialogue
// tab: focus-preserving rebuilds, a pointer-aware render scheduler, and typed
// pickers (item, entity, dialogue, flag, warp, music).
import type { EditorContext } from '../context';
import type { Dialogue, Dir, EntityInstance, ItemId, MusicId, Room, WarpTarget } from '../../core/types';
import { ITEM_IDS, MUSIC_IDS } from '../../core/types';
import { ITEM_INFO } from '../../content/ids';
import { footprint } from '../../core/catalog';
import { TILE } from '../../core/constants';
import { newId } from '../../core/project';
import {
  button, checkbox, el, modal, numberInput, select, textInput, type ButtonKind, type Child, type Option,
} from '../ui/dom';
import { compareNames, dialogueLabel, entityLabel, musicLabel, refLabel, warpLabel } from './labels';
import { requestDialogueFocus } from './focus';
import { commit, flagsPart } from './edit';
import { isEngineFlag } from './refs';
import type { EntityFilter } from './triggerModel';
import { uniqueDialogueName } from '../dialogue/dialogueModel';

// ---------------------------------------------------------------- rebuild helpers

/**
 * Tag a control so keepFocus() can put focus (and the caret) back after a
 * rebuild. `alt` is the key to focus instead when the rebuilt control is
 * disabled (e.g. ▲ on a card that moved to the top falls back to its ▼).
 */
export function focusKey<T extends HTMLElement>(node: T, key: string, alt?: string): T {
  node.dataset.fk = key;
  if (alt) node.dataset.fkAlt = alt;
  return node;
}

/** focusKey() when a key is given, else the node unchanged. */
function tagged<T extends HTMLElement>(node: T, key: string | undefined, alt?: string): T {
  return key ? focusKey(node, key, alt) : node;
}

/** Point focus at the control with `key` after the coming rebuild, if the event's control has focus now. */
export function retarget(e: Event, key: string): void {
  const node = e.currentTarget;
  if (node instanceof HTMLElement && document.activeElement === node) node.dataset.fk = key;
}

function byFocusKey(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`);
}

function isDisabled(node: HTMLElement): boolean {
  return (node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node instanceof HTMLSelectElement) && node.disabled;
}

/** Run `rebuild` (which replaces `root`'s content) and restore focus + caret to the control with the same focus key. */
export function keepFocus(root: HTMLElement, rebuild: () => void): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && root.contains(active) ? active.dataset.fk : undefined;
  const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? [active.selectionStart, active.selectionEnd] as const : null;
  rebuild();
  if (!key) return;
  let next = byFocusKey(root, key);
  const alt = next?.dataset.fkAlt;
  if (next && alt && isDisabled(next)) next = byFocusKey(root, alt) ?? next;
  if (!next) return;
  next.focus();
  if (caret && (next instanceof HTMLTextAreaElement || (next instanceof HTMLInputElement && next.type === 'text'))) {
    next.setSelectionRange(caret[0], caret[1]);
  }
}

/** Whether `node` is laid out (false inside a hidden tab or sidebar panel). */
export function isShown(node: HTMLElement): boolean {
  return node.isConnected && node.getClientRects().length > 0;
}

/**
 * Coalesces re-render requests into one microtask. While a pointer press that
 * started inside `root` is in progress the render waits until after the click,
 * so a rebuild never swallows the button being clicked. Requests made while
 * `root` is hidden are dropped: hosts call the panel's refresh() when showing it.
 */
export class RenderScheduler {
  private pending = false;
  private pressed = false;
  private dead = false;
  /** Light updates held back until the press ends (a full render supersedes them). */
  private deferred: (() => void)[] = [];

  /** Native select popups may swallow the pointerup, and choosing an option never needs protecting. */
  private readonly onDown = (e: PointerEvent): void => {
    const t = e.target as HTMLElement | null;
    this.pressed = !(t instanceof HTMLSelectElement || t instanceof HTMLOptionElement);
  };

  /** The click is dispatched right after pointerup, so work queued during the press runs in the next task. */
  private readonly onUp = (): void => {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.pending || this.deferred.length) setTimeout(() => this.flush(), 0);
  };

  constructor(private readonly root: HTMLElement, private readonly run: () => void) {
    root.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('pointerup', this.onUp, true);
    document.addEventListener('pointercancel', this.onUp, true);
  }

  schedule(): void {
    if (this.pending) return;
    this.pending = true;
    if (!this.pressed) queueMicrotask(() => this.flush());
  }

  /**
   * Run a light update (one that refreshes lists or hints in place) now, or,
   * during a press inside `root`, after its click. A text field commits on
   * 'change' inside the mousedown that blurs it; refreshing then would replace
   * or move the control under the pointer and lose the click.
   */
  afterPress(fn: () => void): void {
    if (this.pressed) this.deferred.push(fn);
    else fn();
  }

  private flush(): void {
    if (this.dead) return;
    const light = this.deferred.splice(0);
    if (!this.pending) {
      for (const fn of light) fn();
      return;
    }
    this.pending = false;
    if (isShown(this.root)) this.run();
  }

  destroy(): void {
    this.dead = true;
    this.deferred = [];
    this.root.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('pointerup', this.onUp, true);
    document.removeEventListener('pointercancel', this.onUp, true);
  }
}

/** True if a key event comes from a text control (shortcuts should ignore it). */
export function fromTextControl(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

// ---------------------------------------------------------------- small pieces

/** Bullet list of warnings (null when there are none). */
export function warningBox(msgs: readonly string[], cls = 'qf-ent-warn'): HTMLUListElement | null {
  return msgs.length ? el('ul', { class: cls }, msgs.map((m) => el('li', null, m))) : null;
}

/** Row of controls that shrink to fit a narrow sidebar. */
export function inline(...children: (Node | null)[]): HTMLDivElement {
  return el('div', { class: 'qf-ent-inline' }, children);
}

/** Small "Copy" button that copies `text` to the clipboard (the API is missing on non-secure origins). */
export function copyButton(ctx: EditorContext, text: string, what = 'Id'): HTMLButtonElement {
  const failed = (): void => ctx.toast('Could not access the clipboard.', 'error');
  return button('Copy', () => {
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard.writeText(text).then(() => ctx.toast(`${what} copied: ${text}`, 'success'), failed);
  }, { small: true, kind: 'ghost', title: `Copy ${text}` });
}

/** Modal with custom buttons; resolves the chosen button's value (null when dismissed). */
export function choiceDialog<T>(title: string, body: Child, choices: readonly { label: string; value: T; kind?: ButtonKind }[]): Promise<T | null> {
  return new Promise((resolve) => {
    let result: T | null = null;
    modal({
      title,
      body,
      buttons: [{ label: 'Cancel' }, ...choices.map((c) => ({ label: c.label, kind: c.kind, onClick: () => { result = c.value; } }))],
      onClose: () => resolve(result),
    });
  });
}

/** Modal body: an intro line, a bullet list of places, and a question. */
export function usageBody(intro: string, items: readonly string[], question: string): HTMLDivElement {
  return el('div', { class: 'qf-ent-usage' },
    el('p', null, intro),
    el('ul', { class: 'qf-ent-usage__list' }, items.map((s) => el('li', null, s))),
    el('p', null, question));
}

/** Checkbox whose input carries focus key `key`. */
export function keyedCheckbox(checked: boolean, onChange: (v: boolean) => void, label: string | undefined, key: string): HTMLLabelElement {
  const box = checkbox(checked, onChange, label);
  const input = box.querySelector('input');
  if (input) focusKey(input, key);
  return box;
}

interface NumOpts {
  min?: number;
  max?: number;
  title?: string;
}

/** Whole-number input: a typed fraction is rounded (and shown rounded) before onChange. */
export function intInput(value: number, onChange: (v: number) => void, key: string, opts: NumOpts = {}): HTMLInputElement {
  const input = focusKey(numberInput(value, (v) => {
    const whole = Math.round(v);
    input.value = String(whole);
    onChange(whole);
  }, { ...opts, step: 1 }), key);
  return input;
}

/** Number input that accepts fractions (seconds and similar). */
export function fractionInput(value: number, onChange: (v: number) => void, key: string, opts: NumOpts = {}): HTMLInputElement {
  const input = focusKey(numberInput(value, onChange, opts), key);
  input.step = 'any';
  return input;
}

// ---------------------------------------------------------------- pickers

const ITEM_OPTIONS: readonly Option<ItemId>[] = ITEM_IDS.map((id) => ({ value: id, label: ITEM_INFO[id].name }));

export function itemSelect(value: ItemId, onChange: (v: ItemId) => void, key?: string): HTMLSelectElement {
  return tagged(select(ITEM_OPTIONS, value, onChange, { title: ITEM_INFO[value]?.description }), key);
}

/** Entities of `room` passing `filter`, "(none)" first; a dangling value stays visible with a ⚠. */
export function entitySelect(room: Room, value: string, filter: EntityFilter, onChange: (id: string) => void, empty = '(none)'): HTMLSelectElement {
  const opts: Option<string>[] = [{ value: '', label: empty }];
  for (const e of room.entities) if (filter(e)) opts.push({ value: e.id, label: entityLabel(e) });
  if (value && !opts.some((o) => typeof o !== 'string' && o.value === value)) {
    opts.push({ value, label: `⚠ ${refLabel(room, value)}` });
  }
  return select(opts, value, onChange);
}

/**
 * Ask the map for a click and put the current room + entity selection back
 * afterwards (the picker may browse other rooms). Positions are rounded.
 */
export async function pickPoint(ctx: EditorContext, prompt: string): Promise<WarpTarget | null> {
  const back = { world: ctx.worldId, room: ctx.roomId, entity: ctx.entityId };
  const t = await ctx.pickLocation(prompt);
  if (back.room && (ctx.worldId !== back.world || ctx.roomId !== back.room)) {
    ctx.selectRoom(back.world, back.room);
    ctx.selectEntity(back.entity);
  }
  return t ? { ...t, x: Math.round(t.x), y: Math.round(t.y) } : null;
}

/**
 * The entity of `room` passing `filter` that a click at (x, y) means: the
 * topmost (last placed) one whose footprint contains the point, else the one
 * overlapping the tile under the point whose centre is nearest. The map picker
 * reports tile centres, so small entities placed off the tile grid stay pickable.
 */
export function entityAt(room: Room, x: number, y: number, filter: EntityFilter): EntityInstance | undefined {
  for (let i = room.entities.length - 1; i >= 0; i--) {
    const e = room.entities[i]!;
    const { w, h } = footprint(e);
    if (filter(e) && Math.abs(x - e.x) <= w / 2 && Math.abs(y - e.y) <= h / 2) return e;
  }
  const left = Math.floor(x / TILE) * TILE;
  const top = Math.floor(y / TILE) * TILE;
  let best: EntityInstance | undefined;
  let bestDist = Infinity;
  for (const e of room.entities) {
    const { w, h } = footprint(e);
    const overlaps = e.x + w / 2 > left && e.x - w / 2 < left + TILE && e.y + h / 2 > top && e.y - h / 2 < top + TILE;
    const dist = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (filter(e) && overlaps && dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

/** entitySelect plus a "pick in room" button that selects the entity clicked on the map. */
export function entityPicker(
  ctx: EditorContext, room: Room, value: string, filter: EntityFilter, onChange: (id: string) => void,
  opts: { empty?: string; key?: string } = {},
): HTMLDivElement {
  const worldId = ctx.worldId;
  const pick = button('Pick', async () => {
    const t = await pickPoint(ctx, 'Click the entity in this room');
    if (!t) return;
    const hit = t.world === worldId && t.room === room.id ? entityAt(room, t.x, t.y, filter) : undefined;
    if (hit) onChange(hit.id);
    else ctx.toast('No suitable entity there: click one inside this room.', 'error');
  }, { small: true, title: 'Pick in room: click the entity on the map' });
  const sel = entitySelect(room, value, filter, onChange, opts.empty);
  return el('div', { class: 'qf-ent-inline qf-ent-inline--picker' },
    tagged(sel, opts.key), tagged(pick, opts.key && `${opts.key}:pick`));
}

export function musicSelect(value: string, withInherit: boolean, onChange: (v: MusicId | 'none' | 'inherit') => void, key?: string): HTMLSelectElement {
  const ids: (MusicId | 'none' | 'inherit')[] = [...(withInherit ? ['inherit' as const] : []), 'none', ...MUSIC_IDS];
  return tagged(select(ids.map((m) => ({ value: m, label: musicLabel(m) })), value as MusicId, onChange), key);
}

/** A new one-page dialogue. */
export function newDialogue(name: string): Dialogue {
  return { id: newId('d'), name, pages: [{ text: '' }] };
}

/** Switch to the Dialogue tab with `id` selected (`editText`: caret in its first page). */
export function openDialogue(ctx: EditorContext, id: string, editText = false): void {
  requestDialogueFocus(id, editText);
  ctx.switchTab('dialogue');
}

/**
 * Dialogue select + "New" + "Edit". onChange gets the chosen id; after "New" it
 * also gets the created (uniquely named) dialogue, which the caller adds in the same undo step.
 */
export function dialoguePicker(
  ctx: EditorContext, value: string, onChange: (id: string, created?: Dialogue) => void, suggestName: () => string, key?: string,
): HTMLDivElement {
  const known = ctx.project.dialogues.some((d) => d.id === value);
  const opts: Option<string>[] = [{ value: '', label: '(none)' }];
  const seen = new Map<string, number>();
  for (const d of ctx.project.dialogues) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
  for (const d of [...ctx.project.dialogues].sort((a, b) => compareNames(a.name || a.id, b.name || b.id))) {
    // Imported projects may hold two dialogues with one name: the id tells them apart.
    const label = !d.name ? d.id : (seen.get(d.name) ?? 0) > 1 ? `${d.name} (${d.id})` : d.name;
    opts.push({ value: d.id, label });
  }
  if (value && !known) opts.push({ value, label: `⚠ ${dialogueLabel(ctx.project, value)}` });
  const sel = select(opts, value, (v) => onChange(v));
  const create = button('New', () => {
    const d = newDialogue(uniqueDialogueName(ctx.project, suggestName()));
    onChange(d.id, d);
    openDialogue(ctx, d.id, true);
  }, { small: true, title: 'Create a new dialogue and edit it in the Dialogue tab' });
  const edit = button('Edit', () => openDialogue(ctx, value), { small: true, disabled: !known, title: 'Edit this dialogue in the Dialogue tab' });
  return el('div', { class: 'qf-ent-inline qf-ent-inline--picker qf-ent-inline--dialogue' },
    tagged(sel, key), tagged(create, key && `${key}:new`), tagged(edit, key && `${key}:edit`, key));
}

/** Add `name` to the project flag list (one undo step). Engine flags are never declared. */
export function defineFlag(ctx: EditorContext, name: string, description?: string): void {
  if (!name || isEngineFlag(name) || ctx.project.flags.some((f) => f.name === name)) return;
  commit(ctx, 'Add flag', [flagsPart(ctx)], () => {
    ctx.project.flags.push(description ? { name, description } : { name });
  });
  ctx.changed('flags');
}

let datalistSeq = 0;

/** Flag name input suggesting project flags, with a "+" that defines a new flag. */
export function flagInput(ctx: EditorContext, value: string, onChange: (v: string) => void, key: string): HTMLDivElement {
  const listId = `qf-ent-flags-${++datalistSeq}`;
  const list = el('datalist', { id: listId }, ctx.project.flags.map((f) => el('option', { value: f.name }, f.description ?? '')));
  const input = focusKey(textInput(value, (v) => onChange(v.trim()), { placeholder: 'flag name' }), key);
  input.setAttribute('list', listId);
  const add = focusKey(button('+', () => defineFlag(ctx, input.value.trim()), { small: true, title: 'Add this name to the project flag list' }), `${key}:add`, key);
  const sync = (): void => {
    const v = input.value.trim();
    const engine = isEngineFlag(v);
    const known = engine || ctx.project.flags.some((f) => f.name === v);
    add.disabled = !v || known;
    input.classList.toggle('qf-ent-unknown', !!v && !known);
    input.title = engine ? 'Engine flag: the game sets it itself.'
      : v && !known ? 'Not in the project flag list yet (it still works). Press + to add it.' : '';
  };
  input.addEventListener('input', sync);
  sync();
  return el('div', { class: 'qf-ent-inline' }, input, list, add);
}

const FACING_OPTIONS: readonly Option<Dir | ''>[] = [
  { value: '', label: 'Keep facing' }, { value: 'up', label: 'Face up' }, { value: 'down', label: 'Face down' },
  { value: 'left', label: 'Face left' }, { value: 'right', label: 'Face right' },
];

function withDir(t: WarpTarget, dir: Dir | ''): WarpTarget {
  const out: WarpTarget = { world: t.world, room: t.room, x: t.x, y: t.y };
  if (dir) out.dir = dir;
  return out;
}

/**
 * Warp destination: "World › Room (x,y)" + Pick on map / Go there / Clear + arrival
 * facing. Picking may browse other rooms; the previous room + entity selection is
 * restored. Re-picking keeps the chosen facing (the picker's own facing only seeds a first pick).
 */
export function warpField(
  ctx: EditorContext, value: WarpTarget | null, onChange: (t: WarpTarget | null) => void,
  opts: { clearable: boolean; prompt: string; key: string },
): HTMLDivElement {
  const { key } = opts;
  const summary = el('div', { class: `qf-ent-warp__summary${value ? '' : ' qf-ent-warp__summary--empty'}` }, warpLabel(ctx.project, value));
  const pick = focusKey(button('Pick on map', async () => {
    const t = await pickPoint(ctx, opts.prompt);
    if (t) onChange(withDir(t, value ? value.dir ?? '' : t.dir ?? ''));
  }, { small: true, kind: 'primary', title: 'Click the destination on the map' }), `${key}:pick`);
  const go = focusKey(button('Go there', () => {
    if (!value) return;
    ctx.selectRoom(value.world, value.room);
    ctx.switchTab('map');
  }, { small: true, disabled: !value, title: 'Show the destination room' }), `${key}:go`, `${key}:pick`);
  const clear = opts.clearable
    ? focusKey(button('Clear', () => onChange(null), { small: true, kind: 'ghost', disabled: !value }), `${key}:clear`, `${key}:pick`)
    : null;
  const facing = value
    ? focusKey(select(FACING_OPTIONS, value.dir ?? '', (d) => onChange(withDir(value, d)), { title: 'Facing on arrival' }), `${key}:dir`)
    : null;
  return el('div', { class: 'qf-ent-warp' }, summary, inline(pick, go, clear), facing);
}
