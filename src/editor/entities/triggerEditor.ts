// Form for one trigger: name, when (auto/enter/talk + source), once, the
// condition list and the action list with typed fields per kind, drag / ▲▼
// reordering and validation hints. Edits go through TriggerEditHost.edit, which
// looks the trigger up fresh, so the form never holds stale objects. Every
// control carries a focus key, so keyboard focus survives the rebuild after an edit.
import type { EditorContext } from '../context';
import type {
  Action, Condition, Dialogue, LayerName, Room, SfxId, Trigger, TriggerOn,
} from '../../core/types';
import { LAYERS, SFX_IDS } from '../../core/types';
import { entityInfo } from '../../core/catalog';
import { TILE } from '../../core/constants';
import { findRoom } from '../../core/project';
import { getAudio } from '../../audio/audio';
import { button, el, field, select, textInput, type Child, type Option } from '../ui/dom';
import { findInRoom, refLabel, sfxLabel } from './labels';
import {
  ACTION_KINDS, CONDITION_KINDS, TRIGGER_ONS, actionKindLabel, actionTargets, conditionKindLabel, conditionTargets,
  defaultAction, defaultCondition, talkSources, type ActionKind, type ConditionKind, type EntityFilter,
} from './triggerModel';
import { clearCountingEnemies, switchStateText, triggerIssues } from './triggerText';
import {
  dialoguePicker, entityPicker, flagInput, focusKey, fractionInput, inline, intInput, itemSelect, keyedCheckbox,
  musicSelect, pickPoint, retarget, warningBox, warpField,
} from './widgets';
import { tileField } from './tilePicker';
import { commit, entityPart } from './edit';

export interface EditOpts {
  /** Rebuild the form afterwards (selects, buttons); text fields leave it alone. */
  rebuild?: boolean;
  /** Dialogue created by a "New" button, added in the same undo step. */
  created?: Dialogue;
}

/** What the trigger form needs from its panel. */
export interface TriggerEditHost {
  readonly ctx: EditorContext;
  readonly room: Room;
  readonly trigger: Trigger;
  /** Apply `fn` to the (fresh) trigger as one undo step. */
  edit(label: string, fn: (t: Trigger) => void, opts?: EditOpts): void;
}

type CondOf<K extends ConditionKind> = Extract<Condition, { kind: K }>;
type ActOf<K extends ActionKind> = Extract<Action, { kind: K }>;

const SET_UNSET: readonly Option<'1' | '0'>[] = [{ value: '1', label: 'is set' }, { value: '0', label: 'is not set' }];
const SET_CLEAR: readonly Option<'1' | '0'>[] = [{ value: '1', label: 'Set (true)' }, { value: '0', label: 'Clear (false)' }];
const LAYER_LABELS: Readonly<Record<LayerName, string>> = { bg: 'Ground (bg)', fg: 'Objects (fg)', over: 'Overhead (over)' };
const SFX_OPTIONS: readonly Option<SfxId>[] = SFX_IDS.map((s) => ({ value: s, label: sfxLabel(s) }));

/** Build the whole form for `h.trigger`. */
export function buildTriggerForm(h: TriggerEditHost): HTMLDivElement {
  const t = h.trigger;
  const name = focusKey(textInput(t.name, (v) => {
    let stored = v;
    h.edit('Rename trigger', (x) => {
      x.name = v.trim() || x.name;
      stored = x.name;
    });
    name.value = stored;
  }, { placeholder: 'Trigger name' }), 'trig:name');
  return el('div', { class: 'qf-ent-trig-form' },
    field('Name', name),
    field('When', focusKey(select(TRIGGER_ONS, t.on, (v) => h.edit('Change trigger event', (x) => setOn(x, v, h.room), { rebuild: true })), 'trig:on')),
    t.on === 'talk'
      ? field('Talk to', entityPicker(h.ctx, h.room, t.source ?? '', talkSources, (id) => h.edit('Set talk source', (x) => { x.source = id; }, { rebuild: true }),
        { empty: '(pick a person)', key: 'trig:source' }))
      : null,
    firesField(h),
    section('Conditions', 'All must be true. None = always.', 'No conditions.', t.conditions.map((c, i) => conditionCard(h, c, i)),
      addSelect('+ Add condition…', CONDITION_KINDS, 'cond:add', (k) => h.edit(`Add condition: ${conditionKindLabel(k)}`, (x) => {
        x.conditions.push(defaultCondition(k, h.room));
      }, { rebuild: true }))),
    section('Actions', 'Run top to bottom; dialogue and wait finish before the next one.', 'No actions yet.', t.actions.map((a, i) => actionCard(h, a, i)),
      addSelect('+ Add action…', ACTION_KINDS, 'act:add', (k) => h.edit(`Add action: ${actionKindLabel(k)}`, (x) => {
        x.actions.push(defaultAction(k, { project: h.ctx.project, room: h.room, tile: h.ctx.tile }));
      }, { rebuild: true }))));
}

/** "Only once" checkbox; a once-trigger names the save flag that remembers it. */
function firesField(h: TriggerEditHost): HTMLDivElement {
  const t = h.trigger;
  const f = field('Fires', keyedCheckbox(t.once, (v) => h.edit('Toggle once', (x) => { x.once = v; }, { rebuild: true }), 'Only once per save file', 'trig:once'));
  f.append(el('div', { class: 'qf-field__help' }, ...(t.once
    ? ['Remembered as flag ', el('code', { class: 'qf-ent-code' }, `trigger:${t.id}`)]
    : ['Every time the event happens and the conditions hold.'])));
  return f;
}

/** Validation hints for the trigger (null when fine). */
export function triggerIssueBox(h: Pick<TriggerEditHost, 'ctx' | 'room' | 'trigger'>): HTMLUListElement | null {
  return warningBox(triggerIssues(h.ctx.project, h.room, h.trigger));
}

function setOn(t: Trigger, on: TriggerOn, room: Room): void {
  t.on = on;
  if (on !== 'talk') {
    delete t.source;
    return;
  }
  if (!t.source) t.source = room.entities.find(talkSources)?.id ?? '';
}

// ---------------------------------------------------------------- list sections

type ListKey = 'conditions' | 'actions';

/** Focus-key prefix of a list's controls. */
const PREFIX: Readonly<Record<ListKey, string>> = { conditions: 'cond', actions: 'act' };

function section(title: string, help: string, empty: string, cards: HTMLElement[], add: HTMLSelectElement): HTMLElement {
  return el('section', { class: 'qf-ent-trig-sec' },
    el('div', { class: 'qf-ent-trig-sec__head' }, el('strong', null, title), el('span', { class: 'qf-muted qf-small' }, help)),
    cards.length ? el('ol', { class: 'qf-ent-trig-list' }, cards) : el('div', { class: 'qf-ent-trig-empty' }, empty),
    add);
}

/** "+ Add …" select that resets after each choice. */
function addSelect<K extends string>(
  placeholder: string, kinds: readonly { kind: K; label: string; help: string }[], key: string, onPick: (k: K) => void,
): HTMLSelectElement {
  const s = focusKey(el('select', { class: 'qf-select qf-ent-trig-add' },
    el('option', { value: '' }, placeholder),
    kinds.map((k) => el('option', { value: k.kind, title: k.help }, k.label))), key);
  s.addEventListener('change', () => {
    const v = s.value as K | '';
    s.value = '';
    if (v) onPick(v);
  });
  return s;
}

/** Move item `from` to position `to` inside a trigger list. */
function moveItem(h: TriggerEditHost, key: ListKey, from: number, to: number): void {
  const n = h.trigger[key].length;
  if (from === to || to < 0 || to >= n) return;
  h.edit(key === 'actions' ? 'Reorder actions' : 'Reorder conditions', (x) => {
    const list = x[key] as unknown[];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  }, { rebuild: true });
}

let dragging: { key: ListKey; trigger: string; from: number } | null = null;

/**
 * A numbered card with drag handle, kind label, ▲ ▼ ✕ and its fields. After a
 * keyboard move, focus follows the card; after ✕ it lands on the list's "+ Add".
 */
function card(h: TriggerEditHost, key: ListKey, i: number, title: string, help: string, body: Child): HTMLLIElement {
  const n = h.trigger[key].length;
  const p = PREFIX[key];
  const handle = el('span', { class: 'qf-ent-trig-card__grip', title: 'Drag to reorder' }, '⠿');
  const up = focusKey(button('▲', (e) => {
    retarget(e, `${p}:${i - 1}:up`);
    moveItem(h, key, i, i - 1);
  }, { small: true, kind: 'ghost', disabled: i === 0, title: 'Move up' }), `${p}:${i}:up`, `${p}:${i}:down`);
  const down = focusKey(button('▼', (e) => {
    retarget(e, `${p}:${i + 1}:down`);
    moveItem(h, key, i, i + 1);
  }, { small: true, kind: 'ghost', disabled: i === n - 1, title: 'Move down' }), `${p}:${i}:down`, `${p}:${i}:up`);
  const remove = button('✕', (e) => {
    retarget(e, `${p}:add`);
    h.edit(key === 'actions' ? 'Remove action' : 'Remove condition', (x) => { x[key].splice(i, 1); }, { rebuild: true });
  }, { small: true, kind: 'ghost', title: 'Remove' });
  const li = el('li', { class: 'qf-ent-trig-card', dataset: { index: String(i) } },
    el('div', { class: 'qf-ent-trig-card__head' },
      handle,
      el('span', { class: 'qf-ent-trig-card__title', title: help }, `${i + 1}. ${title}`),
      up, down, focusKey(remove, `${p}:${i}:del`)),
    el('div', { class: 'qf-ent-trig-card__body' }, body));
  makeDraggable(h, li, handle, key, i);
  return li;
}

/**
 * The card is draggable only while its grip is pressed, so mouse text selection
 * in its inputs keeps working. A started drag cancels the pointer (no pointerup);
 * dragend then resets it.
 */
function makeDraggable(h: TriggerEditHost, li: HTMLLIElement, handle: HTMLElement, key: ListKey, i: number): void {
  const id = h.trigger.id;
  handle.addEventListener('pointerdown', () => {
    li.draggable = true;
    document.addEventListener('pointerup', () => { li.draggable = false; }, { capture: true, once: true });
  });
  li.addEventListener('dragstart', (e) => {
    dragging = { key, trigger: id, from: i };
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    li.classList.add('qf-ent-trig-card--dragging');
  });
  li.addEventListener('dragend', () => {
    li.draggable = false;
    dragging = null;
    li.classList.remove('qf-ent-trig-card--dragging');
  });
  const accepts = (): boolean => dragging !== null && dragging.key === key && dragging.trigger === id && dragging.from !== i;
  li.addEventListener('dragover', (e) => {
    if (!accepts()) return;
    e.preventDefault();
    li.classList.add('qf-ent-trig-card--drop');
  });
  li.addEventListener('dragleave', () => li.classList.remove('qf-ent-trig-card--drop'));
  li.addEventListener('drop', (e) => {
    li.classList.remove('qf-ent-trig-card--drop');
    if (!accepts() || !dragging) return;
    e.preventDefault();
    const from = dragging.from;
    dragging = null;
    moveItem(h, key, from, i);
  });
}

// ---------------------------------------------------------------- conditions

function conditionCard(h: TriggerEditHost, c: Condition, i: number): HTMLLIElement {
  const info = CONDITION_KINDS.find((k) => k.kind === c.kind);
  return card(h, 'conditions', i, info?.label ?? `Unknown “${c.kind}”`, info?.help ?? '', conditionFields(h, c, i));
}

function conditionFields(h: TriggerEditHost, c: Condition, i: number): Child {
  const { ctx, room } = h;
  const set = <K extends ConditionKind>(kind: K, label: string, fn: (x: CondOf<K>) => void, opts: EditOpts = { rebuild: true }): void => {
    h.edit(label, (t) => {
      const cur = t.conditions[i];
      if (cur && cur.kind === kind) fn(cur as CondOf<K>);
    }, opts);
  };
  const fk = (name: string): string => `cond:${i}:${name}`;
  const target = (kind: CondOf<'switch' | 'inRegion' | 'defeated' | 'blockPushed'>['kind'], label: string, value: string): HTMLElement =>
    field(label, entityPicker(ctx, room, value, conditionTargets(kind) as EntityFilter,
      (id) => set(kind, `Set ${label.toLowerCase()}`, (x) => { x.target = id; }), { key: fk('target') }));
  switch (c.kind) {
    case 'enemiesCleared': {
      const n = clearCountingEnemies(room);
      return hint(n
        ? `${n} enem${n === 1 ? 'y' : 'ies'} in this room count${n === 1 ? 's' : ''} (hidden ones once shown).`
        : 'No enemy in this room counts, so this never becomes true (hidden enemies count once shown).');
    }
    case 'torchesLit': {
      const n = room.entities.filter((e) => e.type === 'obj.torch').length;
      return hint(n ? `${n} torch${n === 1 ? '' : 'es'} in this room.` : 'There are no torches in this room.');
    }
    case 'switch':
      return [
        target('switch', 'Switch', c.target),
        field('State', focusKey(select(switchOptions(room, c.target), c.on ? 'on' : 'off',
          (v) => set('switch', 'Set switch state', (x) => { x.on = v === 'on'; })), fk('on')), switchHelp(room, c.target)),
      ];
    case 'flag':
      return [
        field('Flag', flagInput(ctx, c.flag, (v) => set('flag', 'Set flag name', (x) => { x.flag = v; }, {}), fk('flag'))),
        field('Value', focusKey(select(SET_UNSET, c.value ? '1' : '0', (v) => set('flag', 'Set flag value', (x) => { x.value = v === '1'; })), fk('value'))),
      ];
    case 'hasItem':
      return [
        field('Item', itemSelect(c.item, (v) => set('hasItem', 'Set item', (x) => { x.item = v; }), fk('item'))),
        field('At least', intInput(c.min, (v) => set('hasItem', 'Set item count', (x) => { x.min = v; }, {}), fk('min'), { min: 1, max: 999 })),
      ];
    case 'inRegion':
      return target('inRegion', 'Region', c.target);
    case 'defeated':
      return target('defeated', 'Enemy', c.target);
    case 'blockPushed':
      return target('blockPushed', 'Block', c.target);
    default:
      return hint('This editor does not know this kind of condition. The game treats it as never true: remove it with ✕.');
  }
}

/** State choices for a switch condition, worded for a crystal switch when that is the target. */
function switchOptions(room: Room, target: string): Option<'on' | 'off'>[] {
  const crystal = findInRoom(room, target)?.type === 'obj.crystalSwitch';
  const label = (on: boolean): string => {
    const state = switchStateText(room, target, on);
    return crystal ? `is ${state} (${state} pegs raised)` : `is ${state}`;
  };
  return [{ value: 'on', label: label(true) }, { value: 'off', label: label(false) }];
}

function switchHelp(room: Room, target: string): string | undefined {
  return findInRoom(room, target)?.type === 'obj.crystalSwitch'
    ? 'A crystal switch is blue or red like the pegs it raises; hitting it swaps them.'
    : undefined;
}

// ---------------------------------------------------------------- actions

function actionCard(h: TriggerEditHost, a: Action, i: number): HTMLLIElement {
  const info = ACTION_KINDS.find((k) => k.kind === a.kind);
  return card(h, 'actions', i, info?.label ?? `Unknown “${a.kind}”`, info?.help ?? '', actionFields(h, a, i));
}

function actionFields(h: TriggerEditHost, a: Action, i: number): Child {
  const { ctx, room } = h;
  const set = <K extends ActionKind>(kind: K, label: string, fn: (x: ActOf<K>) => void, opts: EditOpts = { rebuild: true }): void => {
    h.edit(label, (t) => {
      const cur = t.actions[i];
      if (cur && cur.kind === kind) fn(cur as ActOf<K>);
    }, opts);
  };
  const fk = (name: string): string => `act:${i}:${name}`;
  /** Whole-number field (fractions only for seconds). Committed without a rebuild. */
  const num = <K extends ActionKind>(kind: K, label: string, value: number, apply: (x: ActOf<K>, v: number) => void,
    o: { min: number; max: number; seconds?: boolean }): HTMLInputElement => {
    const input = o.seconds ? fractionInput : intInput;
    return input(value, (v) => set(kind, `Set ${label}`, (x) => apply(x, v), {}), fk(label), { min: o.min, max: o.max });
  };
  switch (a.kind) {
    case 'openDoor':
    case 'closeDoor': {
      const kind = a.kind;
      return field('Door', entityPicker(ctx, room, a.target, actionTargets(kind) as EntityFilter,
        (id) => set(kind, 'Set door', (x) => { x.target = id; }), { empty: '(pick a door)', key: fk('target') }));
    }
    case 'showEntity':
    case 'hideEntity': {
      const kind = a.kind;
      return [
        field('Entity', entityPicker(ctx, room, a.target, actionTargets(kind) as EntityFilter,
          (id) => set(kind, 'Set entity', (x) => { x.target = id; }), { empty: '(pick an entity)', key: fk('target') })),
        kind === 'showEntity' ? hiddenHint(h, a.target) : null,
      ];
    }
    case 'setFlag':
      return [
        field('Flag', flagInput(ctx, a.flag, (v) => set('setFlag', 'Set flag name', (x) => { x.flag = v; }, {}), fk('flag'))),
        field('Value', focusKey(select(SET_CLEAR, a.value ? '1' : '0', (v) => set('setFlag', 'Set flag value', (x) => { x.value = v === '1'; })), fk('value'))),
      ];
    case 'dialogue':
      return field('Dialogue', dialoguePicker(ctx, a.dialogue,
        (id, created) => set('dialogue', 'Set dialogue', (x) => { x.dialogue = id; }, { rebuild: true, created }),
        () => h.trigger.name || 'Trigger dialogue', fk('dialogue')));
    case 'giveItem':
    case 'takeItem': {
      const kind = a.kind;
      return [
        field('Item', itemSelect(a.item, (v) => set(kind, 'Set item', (x) => { x.item = v; }), fk('item'))),
        field('Amount', num(kind, 'amount', a.amount, (x, v) => { x.amount = v; }, { min: 1, max: 999 })),
      ];
    }
    case 'setTile':
      return setTileFields(h, a, (label, fn, opts) => set('setTile', label, fn, opts), fk);
    case 'sound':
      return field('Sound', inline(
        focusKey(select(SFX_OPTIONS, a.sfx, (v) => set('sound', 'Set sound', (x) => { x.sfx = v; })), fk('sfx')),
        focusKey(button('▶', () => playSfx(a.sfx), { small: true, title: 'Preview the sound' }), fk('play'))));
    case 'music':
      return field('Music', musicSelect(a.music, false, (v) => set('music', 'Set music', (x) => { x.music = v === 'inherit' ? 'none' : v; }), fk('music')));
    case 'secret':
      return hint('Plays the “secret found” jingle.');
    case 'warp':
      return warpField(ctx, a.target, (t) => { if (t) set('warp', 'Set warp destination', (x) => { x.target = t; }); }, {
        clearable: false, prompt: 'Click where the player should be warped to', key: fk('warp'),
      });
    case 'heal':
      return field('Half-hearts', num('heal', 'amount', a.amount, (x, v) => { x.amount = v; }, { min: 1, max: 40 }), '2 half-hearts = 1 heart.');
    case 'shake':
      return field('Seconds', num('shake', 'seconds', a.seconds, (x, v) => { x.seconds = v; }, { min: 0.1, max: 5, seconds: true }));
    case 'wait':
      return field('Seconds', num('wait', 'seconds', a.seconds, (x, v) => { x.seconds = v; }, { min: 0, max: 30, seconds: true }));
    default:
      return hint('This editor does not know this kind of action. The game skips it: remove it with ✕.');
  }
}

type SetTile = (label: string, fn: (x: ActOf<'setTile'>) => void, opts?: EditOpts) => void;

function setTileFields(h: TriggerEditHost, a: ActOf<'setTile'>, set: SetTile, fk: (n: string) => string): Child {
  const { ctx, room } = h;
  const worldId = ctx.worldId;
  const coord = (axis: 'tx' | 'ty'): HTMLInputElement =>
    intInput(a[axis], (v) => set('Set tile position', (x) => { x[axis] = v; }, {}), fk(axis), { min: 0, max: 255, title: axis === 'tx' ? 'Column' : 'Row' });
  const pick = focusKey(button('Pick on map', async () => {
    const p = await pickPoint(ctx, 'Click the tile this action changes');
    if (!p) return;
    if (p.world !== worldId || p.room !== room.id) {
      ctx.toast('Pick a tile inside this room.', 'error');
      return;
    }
    set('Pick tile position', (x) => {
      x.tx = Math.floor(p.x / TILE);
      x.ty = Math.floor(p.y / TILE);
    });
  }, { small: true, kind: 'primary', title: 'Click the tile on the map' }), fk('pick'));
  return [
    field('Layer', focusKey(select(LAYERS.map((l) => ({ value: l, label: LAYER_LABELS[l] })), a.layer,
      (v) => set('Set tile layer', (x) => { x.layer = v; }, { rebuild: true })), fk('layer'))),
    field('Tile at', el('div', { class: 'qf-ent-xy' }, el('label', null, 'x', coord('tx')), el('label', null, 'y', coord('ty')), pick)),
    field('Becomes', tileField(ctx, a.tile, (id) => set('Set tile', (x) => { x.tile = id; }, { rebuild: true }), fk('tile'))),
  ];
}

/** Tip + one-click fix when a "show" target is not placed as Hidden. */
function hiddenHint(h: TriggerEditHost, target: string): Child {
  const inst = findInRoom(h.room, target);
  if (!inst || inst.props.hidden === true) return inst ? hint('Starts hidden; this action reveals it for good.') : null;
  const canHide = entityInfo(inst.type)?.props.some((p) => p.key === 'hidden') ?? false;
  if (!canHide) return hint(`${refLabel(h.room, target)} cannot be placed as Hidden, so it is always visible.`);
  const { ctx, room } = h;
  const worldId = ctx.worldId;
  const fix = button('Mark it Hidden', () => {
    commit(ctx, 'Mark entity hidden', [entityPart(ctx, worldId, room.id, inst.id)], () => {
      const live = findInRoom(findRoom(ctx.project, worldId, room.id), inst.id);
      if (live) live.props.hidden = true;
    });
    ctx.changed('entities', room.id);
  }, { small: true, title: 'Set its Hidden property so it starts invisible' });
  return el('div', { class: 'qf-ent-trig-hint' }, 'It is not marked Hidden, so it is already visible. ', fix);
}

function hint(text: string): HTMLDivElement {
  return el('div', { class: 'qf-ent-trig-hint' }, text);
}

function playSfx(id: SfxId): void {
  const audio = getAudio();
  audio.unlock();
  audio.sfx(id);
}
