// Small text formatters shared by the menu and the editor chrome (pure).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3 rooms", "1 room". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `name` cut to `max` characters with an ellipsis, for one-line messages such as toasts. */
export function shortName(name: string, max = 32): string {
  const chars = [...name];
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * `base` if no name in `taken` uses it, else the first free variant: "Base 2",
 * "Base 3"…, or with a `tag` "Base (tag)", "Base (tag 2)"…
 */
export function uniqueName(base: string, taken: Iterable<string>, tag?: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const variant = (n: number): string => (tag ? `${base} (${tag}${n > 1 ? ` ${n}` : ''})` : `${base} ${n + 1}`);
  let n = 1;
  while (used.has(variant(n))) n++;
  return variant(n);
}

/** Human time since `then` (epoch ms): "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else a date. */
export function relativeTime(then: number, now = Date.now()): string {
  if (!Number.isFinite(then) || then <= 0) return 'never';
  const ago = Math.max(0, now - then);
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  if (ago < 2 * DAY) return 'yesterday';
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)} days ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Full local date & time, for tooltips. */
export function fullDate(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString() : 'unknown';
}
