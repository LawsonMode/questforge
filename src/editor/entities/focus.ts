// Cross-panel "jump to" requests: a panel asks for a dialogue / trigger /
// entity to be shown, then switches tab or room; the target panel takes the
// request on its next render.

/** A request to show a dialogue; `editText` also puts the caret in its first page. */
export interface DialogueFocus {
  id: string;
  editText: boolean;
}

let pendingDialogue: DialogueFocus | null = null;
let pendingTrigger: { room: string; trigger: string } | null = null;
let pendingEntity: { room: string; entity: string } | null = null;

/** Ask the Dialogue tab to select dialogue `id` (call before ctx.switchTab('dialogue')). */
export function requestDialogueFocus(id: string, editText = false): void {
  pendingDialogue = { id, editText };
}

/** Consume the pending dialogue request (null if none). */
export function takeDialogueFocus(): DialogueFocus | null {
  const req = pendingDialogue;
  pendingDialogue = null;
  return req;
}

/** Ask the trigger panel to select `trigger` once room `room` is shown. */
export function requestTriggerFocus(room: string, trigger: string): void {
  pendingTrigger = { room, trigger };
}

/** Consume the pending trigger request if it belongs to `room`. */
export function takeTriggerFocus(room: string): string | null {
  if (!pendingTrigger || pendingTrigger.room !== room) return null;
  const id = pendingTrigger.trigger;
  pendingTrigger = null;
  return id;
}

/** Whether a trigger of `room` is waiting to be shown (e.g. the map can open its Triggers sidebar). */
export function hasTriggerFocus(room: string | null): boolean {
  return pendingTrigger !== null && pendingTrigger.room === room;
}

/** Ask the map to show `entity` of `room` in its Entities sidebar once the map is shown (select it too). */
export function requestEntityFocus(room: string, entity: string): void {
  pendingEntity = { room, entity };
}

/** Consume the pending entity request; its entity id when it belongs to `room`, else null. */
export function takeEntityFocus(room: string | null): string | null {
  const req = pendingEntity;
  pendingEntity = null;
  return req && req.room === room ? req.entity : null;
}
