// Pure frame-list operations for tiles & sprites (unit-tested in node). Sprite
// anims reference frames by index, so every structural change returns the
// remapped anims alongside the new frame list.
import type { PixelData, SpriteAnim } from '../../core/types';

export type Anims = Record<string, SpriteAnim>;

export interface FrameList {
  frames: PixelData[];
  anims: Anims;
}

/** Apply an index mapping (old -> new) to every anim frame reference. */
function remap(anims: Anims, map: (i: number) => number): Anims {
  const out: Anims = {};
  for (const [name, a] of Object.entries(anims)) out[name] = { ...a, frames: a.frames.map(map) };
  return out;
}

/** Append a frame (no anim references change). */
export function appendFrame(list: FrameList, data: PixelData): FrameList {
  return { frames: [...list.frames, data], anims: list.anims };
}

/** Insert a copy of frame `index` right after it; references to later frames shift up. */
export function duplicateFrame(list: FrameList, index: number): FrameList {
  const src = list.frames[index];
  if (src === undefined) return list;
  const frames = [...list.frames];
  frames.splice(index + 1, 0, src);
  return { frames, anims: remap(list.anims, (i) => (i > index ? i + 1 : i)) };
}

/**
 * Remove frame `index` (the last remaining frame cannot be removed). References
 * to it fall back to the previous frame (or the new first one); later ones shift down.
 */
export function deleteFrame(list: FrameList, index: number): FrameList {
  if (list.frames.length <= 1 || index < 0 || index >= list.frames.length) return list;
  const frames = list.frames.filter((_, i) => i !== index);
  return { frames, anims: remap(list.anims, (i) => (i < index ? i : i === index ? Math.max(0, index - 1) : i - 1)) };
}

/** Move frame `from` to position `to`; anim references follow their frames. */
export function moveFrame(list: FrameList, from: number, to: number): FrameList {
  const n = list.frames.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return list;
  const frames = [...list.frames];
  const [moved] = frames.splice(from, 1);
  frames.splice(to, 0, moved!);
  const map = (i: number): number => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (to < from && i >= to && i < from) return i + 1;
    return i;
  };
  return { frames, anims: remap(list.anims, map) };
}

/** Parse an anim frame list like "0, 1,2 1" (commas and/or spaces); null if any entry is not a valid index. */
export function parseFrameList(text: string, frameCount: number): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n >= frameCount) return null;
    out.push(n);
  }
  return out;
}

/** Anim frame list as shown in the table ("0,1,2,1"). */
export function formatFrameList(frames: readonly number[]): string {
  return frames.join(',');
}
