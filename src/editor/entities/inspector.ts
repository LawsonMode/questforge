// Inspector for the selected placed entity: header (icon, type, id), position,
// inline warnings, a form generated from the catalog PropSchema list, and
// Duplicate / Delete. Every edit is one undo step over the instance.
import type { EditorContext } from '../context';
import type { Dialogue, EntityInstance, ItemId, PropValue, Room, World } from '../../core/types';
import { entityInfo, propOf, type EntityTypeInfo, type PropSchema } from '../../core/catalog';
import { findRoom, roomCols, roomRows } from '../../core/project';
import { TILE } from '../../core/constants';
import { button, el, field, select, setChildren, textArea, textInput, type Child } from '../ui/dom';
import { CATEGORY_LABELS, asWarpTarget, entityLabel, enumLabel, findInRoom } from './labels';
import { entityWarnings } from './warnings';
import { entityUsages } from './refs';
import { drawIcon, iconCanvas, instanceIcon } from './icons';
import { commit, dialoguesPart, duplicateInstance, entityPart, roomEntitiesPart, type Part } from './edit';
import {
  choiceDialog, copyButton, dialoguePicker, entityPicker, flagInput, focusKey, fractionInput, inline, intInput, itemSelect,
  keepFocus, keyedCheckbox, musicSelect, usageBody, warningBox, warpField,
} from './widgets';

/** Undo label of the inspector's Delete. */
const DELETE_LABEL = 'Delete entity';
/** Help under free-text props (a sign's text): the game shows them in the dialogue box, codes and all. */
const TEXT_HELP = '{name} = the hero’s name; {btn:a}, {btn:b}, {btn:y}, {btn:start}, {btn:move}… show as the player’s keys or controller buttons.';

/** What the form was built for (the selection may change before a blur commits; edits re-find it by id). */
interface Ref {
  world: World;
  room: Room;
  inst: EntityInstance;
}

interface EditOpts {
  /** Rebuild the form afterwards (selects/buttons); text fields only refresh derived bits. */
  rebuild?: boolean;
  /** Dialogue created by a "New" button, added in the same undo step. */
  created?: Dialogue;
}

export class EntityInspector {
  readonly element: HTMLDivElement = el('div', { class: 'qf-ent-insp' });
  private warnHost: HTMLDivElement | null = null;
  private headIcon: HTMLCanvasElement | null = null;
  private tileText: HTMLSpanElement | null = null;
  private shown: Ref | null = null;
  /** The entity this inspector last deleted (selected again when that delete is undone). */
  private deleted: { world: string; room: string; id: string } | null = null;

  /**
   * `mute` runs a mutation while the owning panel ignores its own change events;
   * `afterPress` runs a light refresh after the click in progress (RenderScheduler.afterPress).
   */
  constructor(
    private readonly ctx: EditorContext,
    private readonly mute: (fn: () => void) => void,
    private readonly afterPress: (fn: () => void) => void,
  ) {}

  render(): void {
    keepFocus(this.element, () => setChildren(this.element, this.build()));
  }

  /** Whether the last render shows a placed entity's form. */
  get editing(): boolean {
    return this.shown !== null;
  }

  /** After an undo/redo labelled `label`: if it brought back the entity deleted here, select it again. */
  reselectRestored(label: string): void {
    const d = this.deleted;
    if (label !== DELETE_LABEL || !d) return;
    this.deleted = null;
    const { ctx } = this;
    if (ctx.entityId !== null || ctx.roomId !== d.room) return;
    if (findInRoom(findRoom(ctx.project, d.world, d.room), d.id)) ctx.selectEntity(d.id);
  }

  /** Refresh what depends on prop values without rebuilding the form. */
  updateDerived(): void {
    const cur = this.shown && this.live(this.shown);
    if (!this.shown || !cur || !this.warnHost) return;
    setChildren(this.warnHost, warningBox(entityWarnings(this.ctx.project, this.shown.world, cur.room, cur.inst)));
    if (this.headIcon) drawIcon(this.headIcon, this.ctx.assets, instanceIcon(cur.inst));
    if (this.tileText) this.tileText.textContent = tileOf(cur.inst);
  }

  private build(): Child[] {
    const { ctx } = this;
    this.shown = null;
    this.warnHost = null;
    this.headIcon = null;
    this.tileText = null;
    const out: Child[] = [];
    if (ctx.entityType) {
      const name = entityInfo(ctx.entityType)?.name ?? ctx.entityType;
      out.push(el('div', { class: 'qf-ent-placing' },
        el('strong', null, `Placing: ${name}`), ' — click the map to place it. ',
        el('span', { class: 'qf-kbd' }, 'Esc'), ' or click it again to stop.'));
    }
    const room = ctx.room();
    const inst = room && ctx.entityId ? findInRoom(room, ctx.entityId) : undefined;
    if (!room || !ctx.entityId) {
      out.push(el('div', { class: 'qf-ent-hint' }, 'Select an entity on the map to edit it, or choose a type above and click the map to place one.'));
      return out;
    }
    const info = inst && entityInfo(inst.type);
    if (!inst || !info) {
      out.push(el('div', { class: 'qf-ent-hint' }, inst ? `Unknown entity type “${inst.type}”.` : `Entity ${ctx.entityId} is not in this room.`));
      return out;
    }
    const ref: Ref = { world: ctx.world(), room, inst };
    this.shown = ref;
    this.warnHost = el('div', { class: 'qf-ent-warnhost' });
    const props = info.props.filter((s) => propApplies(inst, s)).map((s) => this.propField(ref, s));
    out.push(this.header(ref, info), this.position(ref), this.warnHost, ...props, this.footer(ref));
    this.updateDerived();
    return out;
  }

  // ---------------------------------------------------------------- edits

  /** The room and instance as they are now (undo or other panels may have replaced the objects). */
  private live(ref: Ref): { room: Room; inst: EntityInstance } | null {
    const room = findRoom(this.ctx.project, ref.world.id, ref.room.id);
    const inst = findInRoom(room, ref.inst.id);
    return room && inst ? { room, inst } : null;
  }

  private edit(ref: Ref, label: string, mutate: (inst: EntityInstance) => void, opts: EditOpts = {}): void {
    const { ctx } = this;
    const parts: Part[] = [entityPart(ctx, ref.world.id, ref.room.id, ref.inst.id)];
    if (opts.created) parts.push(dialoguesPart(ctx));
    this.mute(() => {
      commit(ctx, label, parts, () => {
        const cur = this.live(ref);
        if (!cur) return;
        if (opts.created) ctx.project.dialogues.push(opts.created);
        mutate(cur.inst);
      });
      if (opts.created) ctx.changed('dialogues', opts.created.id);
      ctx.changed('entities', ref.room.id);
    });
    if (opts.rebuild) this.render();
    else this.afterPress(() => this.updateDerived());
  }

  private setProp(ref: Ref, s: PropSchema, v: PropValue, opts: EditOpts = {}): void {
    this.edit(ref, `Set ${s.label.toLowerCase()}`, (inst) => {
      inst.props[s.key] = v;
    }, opts);
  }

  // ---------------------------------------------------------------- sections

  private header(ref: Ref, info: EntityTypeInfo): HTMLElement {
    this.headIcon = iconCanvas(this.ctx.assets, instanceIcon(ref.inst), 48);
    return el('div', { class: 'qf-ent-head' },
      el('div', { class: 'qf-ent-head__icon qf-checker' }, this.headIcon),
      el('div', { class: 'qf-ent-head__text' },
        el('div', { class: 'qf-ent-head__name', title: info.description }, info.name),
        el('div', { class: 'qf-ent-head__meta' },
          el('span', { class: 'qf-badge' }, CATEGORY_LABELS[info.category]),
          el('code', { class: 'qf-ent-id' }, ref.inst.id),
          copyButton(this.ctx, ref.inst.id))));
  }

  private position(ref: Ref): HTMLElement {
    const maxX = roomCols(ref.room) * TILE;
    const maxY = roomRows(ref.room) * TILE;
    const x = intInput(ref.inst.x, (v) => this.edit(ref, 'Move entity', (i) => { i.x = v; }), 'x', { min: 0, max: maxX, title: 'x (px, entity centre)' });
    const y = intInput(ref.inst.y, (v) => this.edit(ref, 'Move entity', (i) => { i.y = v; }), 'y', { min: 0, max: maxY, title: 'y (px, entity centre)' });
    this.tileText = el('span', { class: 'qf-muted qf-small' }, tileOf(ref.inst));
    return field('Position', el('div', { class: 'qf-ent-xy' },
      el('label', null, 'x', x), el('label', null, 'y', y), this.tileText));
  }

  private propField(ref: Ref, s: PropSchema): HTMLElement {
    return field(s.label, this.control(ref, s), s.help ?? (s.kind === 'text' ? TEXT_HELP : undefined));
  }

  private control(ref: Ref, s: PropSchema): Child {
    const { ctx } = this;
    const v = propOf<PropValue>(ref.inst, s.key, s.default);
    const key = `prop:${s.key}`;
    /** Set the prop and rebuild the form (selects, buttons, checkboxes). */
    const choose = (nv: PropValue, created?: Dialogue): void => this.setProp(ref, s, nv, { rebuild: true, created });
    switch (s.kind) {
      case 'string':
        return focusKey(textInput(String(v ?? ''), (nv) => this.setProp(ref, s, nv)), key);
      case 'text':
        return focusKey(textArea(String(v ?? ''), (nv) => this.setProp(ref, s, nv), { rows: 3 }), key);
      case 'number': {
        const input = wholeNumbers(s) ? intInput : fractionInput;
        return input(Number(v) || 0, (nv) => this.setProp(ref, s, nv), key, { min: s.min, max: s.max });
      }
      case 'bool':
        return keyedCheckbox(v === true, choose, undefined, key);
      case 'enum':
        return focusKey(select((s.options ?? []).map((o) => ({ value: o, label: enumLabel(o) })), String(v), choose), key);
      case 'item':
        return itemSelect(String(v) as ItemId, choose, key);
      case 'music':
        return musicSelect(String(v || 'inherit'), true, choose, key);
      case 'dialogue':
        return dialoguePicker(ctx, String(v ?? ''), (id, created) => choose(id, created), () => suggestName(ref.inst), key);
      case 'entity': {
        const filter = (e: EntityInstance): boolean => e.id !== ref.inst.id && (!s.entityFilter || e.type.startsWith(s.entityFilter));
        return entityPicker(ctx, ref.room, String(v ?? ''), filter, choose, { key });
      }
      case 'flag':
        return flagInput(ctx, String(v ?? ''), (nv) => this.setProp(ref, s, nv), key);
      case 'warp':
        return warpField(ctx, asWarpTarget(v), choose, {
          clearable: true, prompt: `Click where “${s.label}” should lead`, key,
        });
    }
  }

  private footer(ref: Ref): HTMLElement {
    return inline(
      focusKey(button('Duplicate', () => this.duplicate(ref), { small: true, title: 'Copy this entity one tile to the right' }), 'insp:dup'),
      button('Delete', () => void this.remove(ref), { small: true, kind: 'danger', title: 'Remove this entity from the room' }),
    );
  }

  private duplicate(ref: Ref): void {
    const { ctx } = this;
    const cur = this.live(ref);
    if (!cur) return;
    const { room, inst } = cur;
    const copy = duplicateInstance(inst);
    const maxX = roomCols(room) * TILE;
    copy.x = inst.x + TILE < maxX ? inst.x + TILE : Math.max(0, inst.x - TILE);
    this.mute(() => {
      commit(ctx, 'Duplicate entity', [roomEntitiesPart(ctx, ref.world.id, room.id)], () => {
        room.entities.splice(room.entities.indexOf(inst) + 1, 0, copy);
      });
      ctx.changed('entities', room.id);
    });
    ctx.selectEntity(copy.id);
  }

  private async remove(ref: Ref): Promise<void> {
    const { ctx } = this;
    const uses = entityUsages(ref.world, ref.room, ref.inst.id);
    if (uses.length) {
      const body = usageBody(`${entityLabel(ref.inst)} is used by:`, uses.map((u) => u.label), 'Delete it anyway? Those references will show as missing.');
      if (!(await choiceDialog('Delete entity', body, [{ label: 'Delete', value: true, kind: 'danger' }]))) return;
    }
    this.mute(() => {
      commit(ctx, DELETE_LABEL, [roomEntitiesPart(ctx, ref.world.id, ref.room.id)], () => {
        const cur = this.live(ref);
        if (cur) cur.room.entities.splice(cur.room.entities.indexOf(cur.inst), 1);
      });
      ctx.changed('entities', ref.room.id);
    });
    this.deleted = { world: ref.world.id, room: ref.room.id, id: ref.inst.id };
    ctx.selectEntity(null);
  }
}

/** Door fields that only shutters use. */
const SHUTTER_PROPS: ReadonlySet<string> = new Set(['opensWhen', 'closeOnEnter']);

/** Whether a prop does anything for this instance (a door's shutter rules only matter on shutters). */
function propApplies(inst: EntityInstance, s: PropSchema): boolean {
  return inst.type !== 'obj.door' || !SHUTTER_PROPS.has(s.key) || propOf<PropValue>(inst, 'kind', 'locked') === 'shutter';
}

/** Number props take whole values unless their bounds are fractional or they are measured in seconds. */
function wholeNumbers(s: PropSchema): boolean {
  const bounds = [s.default, s.min, s.max].filter((b): b is number => typeof b === 'number');
  return bounds.every((b) => Number.isInteger(b)) && !/\(s(ec(onds)?)?\b/.test(s.label);
}

function tileOf(inst: EntityInstance): string {
  return `tile ${Math.floor(inst.x / TILE)},${Math.floor(inst.y / TILE)}`;
}

/** Default name for a dialogue created from an entity ("Mira", "Sign e_ab12"). */
function suggestName(inst: EntityInstance): string {
  const own = typeof inst.props.name === 'string' ? inst.props.name.trim() : '';
  return own || `${entityInfo(inst.type)?.name ?? 'Entity'} ${inst.id}`;
}
