// Unique names for things the editor creates or copies (pure: no DOM), so
// lists and usage labels never show two entries with the same name.

/** `base` when it is free, else the first free `base 2`, `base 3`… */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** First free `${prefix} N` counting up from `start` ("Trigger 4"). */
export function numberedName(prefix: string, start: number, taken: ReadonlySet<string>): string {
  for (let n = Math.max(1, start); ; n++) if (!taken.has(`${prefix} ${n}`)) return `${prefix} ${n}`;
}

/** Name for a copy of `name`: "X copy", then "X copy 2"…; copying a copy never stacks ("X copy copy"). */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  return uniqueName(`${name.replace(/ copy(?: \d+)?$/, '')} copy`, taken);
}
