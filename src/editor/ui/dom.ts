// Tiny DOM toolkit shared by all editor/app UI. Styling lives in ui.css
// (class names prefixed "qf-"). No framework: build elements with el(), keep
// references, and update them imperatively in refresh().
import './ui.css';

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  title?: string;
  id?: string;
  dataset?: Record<string, string>;
  /** Event listeners, e.g. { click: fn }. */
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
  /** Any other attribute/property (value, type, disabled, placeholder, tabIndex, ...). */
  [attr: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') node.setAttribute('style', v);
        else Object.assign(node.style, v);
      } else if (k === 'dataset') Object.assign(node.dataset, v as Record<string, string>);
      else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) node.addEventListener(ev, fn);
      } else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children. */
export function setChildren(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

export type ButtonKind = 'default' | 'primary' | 'danger' | 'ghost';

export function button(label: Child, onClick: (ev: MouseEvent) => void, opts: { title?: string; kind?: ButtonKind; small?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  const cls = ['qf-btn'];
  if (opts.kind && opts.kind !== 'default') cls.push(`qf-btn--${opts.kind}`);
  if (opts.small) cls.push('qf-btn--small');
  return el('button', { class: cls.join(' '), type: 'button', title: opts.title, disabled: opts.disabled, on: { click: onClick } }, label);
}

export type Option<T extends string> = T | { value: T; label: string };

export function select<T extends string>(options: readonly Option<T>[], value: T, onChange: (v: T) => void, opts: { title?: string } = {}): HTMLSelectElement {
  const s = el('select', { class: 'qf-select', title: opts.title });
  setSelectOptions(s, options, value);
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function setSelectOptions<T extends string>(s: HTMLSelectElement, options: readonly Option<T>[], value: T): void {
  clear(s);
  for (const o of options) {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    s.appendChild(el('option', { value: v }, l));
  }
  s.value = value;
}

export function numberInput(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; title?: string } = {}): HTMLInputElement {
  const i = el('input', { class: 'qf-input qf-input--num', type: 'number', value: String(value), title: opts.title });
  if (opts.min !== undefined) i.min = String(opts.min);
  if (opts.max !== undefined) i.max = String(opts.max);
  if (opts.step !== undefined) i.step = String(opts.step);
  // A cleared or unreadable entry puts back the value shown when editing began (or last committed) instead of committing 0.
  let last = i.value;
  i.addEventListener('focus', () => { last = i.value; });
  i.addEventListener('change', () => {
    let v = Number(i.value);
    if (i.value.trim() === '' || !Number.isFinite(v)) {
      i.value = last;
      return;
    }
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    i.value = String(v);
    onChange(v);
    last = i.value;
  });
  return i;
}

export function textInput(value: string, onChange: (v: string) => void, opts: { placeholder?: string; title?: string; live?: boolean } = {}): HTMLInputElement {
  const i = el('input', { class: 'qf-input', type: 'text', value, placeholder: opts.placeholder, title: opts.title });
  i.addEventListener(opts.live ? 'input' : 'change', () => onChange(i.value));
  return i;
}

export function textArea(value: string, onChange: (v: string) => void, opts: { rows?: number; placeholder?: string; live?: boolean } = {}): HTMLTextAreaElement {
  const t = el('textarea', { class: 'qf-input qf-textarea', rows: opts.rows ?? 3, placeholder: opts.placeholder });
  t.value = value;
  t.addEventListener(opts.live ? 'input' : 'change', () => onChange(t.value));
  return t;
}

export function checkbox(checked: boolean, onChange: (v: boolean) => void, label?: string): HTMLLabelElement {
  const i = el('input', { type: 'checkbox', checked });
  i.addEventListener('change', () => onChange(i.checked));
  return el('label', { class: 'qf-check' }, i, label ? el('span', null, label) : null);
}

/** Labelled form row. */
export function field(label: string, control: Child, help?: string): HTMLDivElement {
  return el('div', { class: 'qf-field' },
    el('label', { class: 'qf-field__label' }, label),
    el('div', { class: 'qf-field__control' }, control),
    help ? el('div', { class: 'qf-field__help' }, help) : null);
}

/** Titled box; returns the panel with `.body` for content. */
export function panel(title: Child, ...children: Child[]): HTMLDivElement & { body: HTMLDivElement } {
  const body = el('div', { class: 'qf-panel__body' }, ...children);
  const p = el('div', { class: 'qf-panel' }, el('div', { class: 'qf-panel__title' }, title), body) as HTMLDivElement & { body: HTMLDivElement };
  p.body = body;
  return p;
}

export interface TabsHandle {
  element: HTMLDivElement;
  setActive(id: string): void;
}

export function tabs(items: readonly { id: string; label: string; title?: string }[], active: string, onChange: (id: string) => void): TabsHandle {
  const element = el('div', { class: 'qf-tabs', role: 'tablist' });
  const btns = new Map<string, HTMLButtonElement>();
  for (const it of items) {
    const b = el('button', { class: 'qf-tab', type: 'button', role: 'tab', title: it.title, on: { click: () => { setActive(it.id); onChange(it.id); } } }, it.label);
    btns.set(it.id, b);
    element.appendChild(b);
  }
  function setActive(id: string): void {
    for (const [k, b] of btns) b.classList.toggle('qf-tab--active', k === id);
  }
  setActive(active);
  return { element, setActive };
}

export interface ModalButton {
  label: string;
  kind?: ButtonKind;
  /** Return false to keep the modal open. */
  onClick?: () => boolean | void | Promise<boolean | void>;
}

export interface ModalHandle {
  close(): void;
  body: HTMLDivElement;
}

export function modal(opts: { title: string; body: Child; buttons?: ModalButton[]; onClose?: () => void; wide?: boolean }): ModalHandle {
  const body = el('div', { class: 'qf-modal__body' }, opts.body);
  const footer = el('div', { class: 'qf-modal__footer' });
  const box = el('div', { class: `qf-modal${opts.wide ? ' qf-modal--wide' : ''}`, role: 'dialog' },
    el('div', { class: 'qf-modal__title' }, opts.title), body, footer);
  const backdrop = el('div', { class: 'qf-modal-backdrop' }, box);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  for (const b of opts.buttons ?? [{ label: 'Close' }]) {
    footer.appendChild(button(b.label, async () => {
      const r = await b.onClick?.();
      if (r !== false) close();
    }, { kind: b.kind }));
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  const first = box.querySelector<HTMLElement>('input, textarea, select');
  first?.focus();
  return { close, body };
}

export function confirmDialog(message: string, opts: { title?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    modal({
      title: opts.title ?? 'Confirm',
      body: el('p', null, message),
      buttons: [
        { label: 'Cancel' },
        { label: opts.ok ?? 'OK', kind: opts.danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(message: string, initial = '', opts: { title?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = el('input', { class: 'qf-input', type: 'text', value: initial });
    const h = modal({
      title: opts.title ?? 'Enter a value',
      body: el('div', null, el('p', null, message), input),
      buttons: [
        { label: 'Cancel' },
        { label: opts.ok ?? 'OK', kind: 'primary', onClick: () => { result = input.value; } },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        result = input.value;
        h.close();
      }
    });
    input.select();
  });
}

let toastHost: HTMLDivElement | null = null;

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info', ms = 2600): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', { class: 'qf-toasts' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: `qf-toast qf-toast--${kind}` }, message);
  toastHost.appendChild(t);
  setTimeout(() => {
    t.classList.add('qf-toast--out');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/** Canvas with crisp pixel scaling (CSS size = w*scale x h*scale). */
export function pixelCanvas(w: number, h: number, scale = 1, cls = ''): HTMLCanvasElement {
  const c = el('canvas', { class: `qf-canvas ${cls}`.trim() });
  c.width = w;
  c.height = h;
  c.style.width = `${w * scale}px`;
  c.style.height = `${h * scale}px`;
  const ctx = c.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  return c;
}

/** Keyboard shortcut helper: returns an unbind function. Ignores key events from inputs. */
export function shortcut(combo: string, fn: (e: KeyboardEvent) => void, target: Document | HTMLElement = document): () => void {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const need = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') };
  const handler = (e: Event): void => {
    const ke = e as KeyboardEvent;
    const t = ke.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if ((ke.ctrlKey || ke.metaKey) !== need.ctrl || ke.shiftKey !== need.shift || ke.altKey !== need.alt) return;
    if (ke.key.toLowerCase() !== key) return;
    ke.preventDefault();
    fn(ke);
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
