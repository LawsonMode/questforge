// Keyboard-friendly dialog helpers. The shared modal() only focuses an input,
// so a confirm or help dialog opened from the keyboard would leave focus on
// its trigger behind the backdrop (Enter would open a second copy). These
// move focus into the newest dialog and give it back when it closes.
import { confirmDialog, modal, type ButtonKind, type Child } from '../ui/dom';

/**
 * Move focus into the newest open dialog: a footer button ('first' = Cancel,
 * 'last' = OK) or, for reading, the dialog itself ('dialog': Enter does
 * nothing, Tab reaches the buttons, Escape closes).
 */
export function focusTopDialog(which: 'first' | 'last' | 'dialog'): void {
  const backdrops = document.querySelectorAll('.qf-modal-backdrop');
  const box = backdrops[backdrops.length - 1]?.querySelector<HTMLElement>('.qf-modal');
  if (!box) return;
  if (which === 'dialog') {
    box.tabIndex = -1;
    box.focus();
    return;
  }
  const buttons = box.querySelectorAll<HTMLElement>('.qf-modal__footer .qf-btn');
  buttons[which === 'first' ? 0 : buttons.length - 1]?.focus();
}

/** Put focus back on `el` if it is still on the page. */
export function restoreFocus(el: Element | null): void {
  if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
}

/**
 * confirmDialog with focus inside the dialog: on Cancel for dangerous actions
 * (Enter must never delete by accident), on OK otherwise. Focus returns to
 * the trigger afterwards.
 */
export async function confirmAction(message: string, opts: { title?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  const trigger = document.activeElement;
  const answer = confirmDialog(message, opts);
  focusTopDialog(opts.danger ? 'first' : 'last');
  const ok = await answer;
  restoreFocus(trigger);
  return ok;
}

/** One button of a choiceAction dialog. */
export interface ActionChoice<T> {
  label: string;
  value: T;
  kind?: ButtonKind;
}

/**
 * A dialog with several answers (plus a first "cancel" button); resolves the
 * chosen value, or null when cancelled or dismissed. Focus lands on the last
 * choice (put the safest answer last) and returns to the trigger afterwards.
 */
export async function choiceAction<T>(title: string, body: Child, choices: readonly ActionChoice<T>[], cancel = 'Cancel'): Promise<T | null> {
  const trigger = document.activeElement;
  let result: T | null = null;
  const answer = new Promise<void>((resolve) => {
    modal({
      title,
      body,
      buttons: [{ label: cancel }, ...choices.map((c) => ({ label: c.label, kind: c.kind, onClick: () => { result = c.value; } }))],
      onClose: () => resolve(),
    });
  });
  focusTopDialog('last');
  await answer;
  restoreFocus(trigger);
  return result;
}
