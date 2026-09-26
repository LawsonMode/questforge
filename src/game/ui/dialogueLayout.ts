// Pure paging for the dialogue box: substitutes {name}, word-wraps each page to
// the box width and splits it into boxes of at most BOX_LINES lines. A page's
// choice options take lines of its last box, so the question text that fits
// stays next to the options - always at least its last line (a question line
// plus 3 options makes one 4-row box). OWNER: triggers+UI agent.
import type { DialoguePage } from '../../core/types';
import { wrapText } from '../../gfx/font';

/** Text lines per box (choice options count as lines). */
export const BOX_LINES = 3;
/** Width (px) available to a line of text. */
export const TEXT_WIDTH = 204;
/** Width available to an option (it is indented behind the pointer). */
const OPTION_WIDTH = TEXT_WIDTH - 14;

/** One box worth of text. `page` is the source page (for its choice flag). */
export interface DialogueBoxPage {
  speaker?: string;
  lines: string[];
  /** `lines` joined: the characters the typewriter reveals, in order. */
  text: string;
  /** Options shown under `lines` once the text is revealed (only on a page's last box). */
  options?: string[];
  page: DialoguePage;
}

/** Replace every {name} with the save-file name. */
export function substituteName(text: string, name: string): string {
  return text.split('{name}').join(name);
}

/** Split lines into consecutive chunks of at most `size`. */
function chunk(lines: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

/** Wrapped lines of a page's text with leading/trailing blank lines removed. */
function pageLines(text: string, name: string): string[] {
  const lines = wrapText(substituteName(text, name), TEXT_WIDTH);
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

/** Truncate an option to one line (options never wrap). */
function fitOption(text: string): string {
  return wrapText(text, OPTION_WIDTH)[0] ?? '';
}

/** Lay out pages into boxes. Pages with neither text nor a choice produce no box. */
export function layoutDialogue(pages: readonly DialoguePage[], name: string): DialogueBoxPage[] {
  const boxes: DialogueBoxPage[] = [];
  for (const page of pages) {
    const lines = pageLines(page.text ?? '', name);
    const options = (page.choice?.options ?? []).slice(0, BOX_LINES).map((o) => fitOption(substituteName(o, name)));
    const speaker = page.speaker ? substituteName(page.speaker, name) : undefined;
    const box = (l: string[], opts?: string[]): DialogueBoxPage => ({
      ...(speaker ? { speaker } : {}), lines: l, text: l.join(''), ...(opts ? { options: opts } : {}), page,
    });
    if (options.length === 0) {
      for (const c of chunk(lines, BOX_LINES)) boxes.push(box(c));
      continue;
    }
    const keep = Math.min(lines.length, Math.max(1, BOX_LINES - options.length));
    for (const c of chunk(lines.slice(0, lines.length - keep), BOX_LINES)) boxes.push(box(c));
    boxes.push(box(lines.slice(lines.length - keep), options));
  }
  return boxes;
}

/** Characters revealed by the typewriter in a box (all of its text lines). */
export function boxLength(box: DialogueBoxPage): number {
  return box.text.length;
}
