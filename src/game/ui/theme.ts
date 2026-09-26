// Shared look of the in-game UI: SNES-style palette, framed windows, outlined
// bitmap text, pointers, heart rows, item icons and the 4-piece heart icon, key
// caps for button names, hint lines that fit whatever the device calls its
// buttons, and the gamepad "press a key for sound" hint.
// Everything draws through the Renderer in screen space. OWNER: triggers+UI agent.
//
// Menus redraw every frame, so the costly pieces are pre-rendered once into
// small offscreen canvases and blitted (in a browser; elsewhere, e.g. unit tests,
// they draw through the Renderer as before, pixel for pixel the same): outlined
// strings (9 text passes each), big title text (up to 20 scaled passes) and the
// pixel-by-pixel heart-piece icon.
import type { ItemId, SaveData } from '../../core/types';
import type { AudioApi, Renderer } from '../api';
import { ITEM_INFO } from '../../content/ids';
import { GLYPH_H, drawTextAligned, measureText } from '../../gfx/font';
import { currentControls } from '../../input/devices';

export { keyLabel, liveText } from '../keys';

/** UI colours (5-bit SNES gamut: channels are multiples of 8). */
export const UI = {
  fill: '#101840',
  fillDeep: '#080c28',
  fillLight: '#203070',
  outline: '#000008',
  light: '#f8f8f8',
  mid: '#a0a8d8',
  shade: '#404890',
  text: '#f8f8f8',
  dim: '#7880a8',
  gold: '#f8d038',
  goldDark: '#a86810',
  red: '#f83838',
  green: '#58e058',
  greenDark: '#188830',
  blue: '#58a0f8',
} as const;

/** Shared draw options (never retained by the renderer, so they are reused instead of allocated per call). */
export const SCREEN = { screen: true } as const;

const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

type Align = 'left' | 'center' | 'right';

export interface OutlineOpts {
  align?: Align;
  outline?: string;
}

/** Common outline options. */
export const CENTER: OutlineOpts = { align: 'center' };
export const RIGHT: OutlineOpts = { align: 'right' };

/** Reused text options (mutated per call). */
const TEXT: { color: string; shadow: false; align: Align } = { color: '', shadow: false, align: 'left' };

// ---------------------------------------------------------------- offscreen caches

/** Most pre-rendered images kept (least recently used dropped first). */
const CACHE_MAX = 160;
/** A string is pre-rendered once it has been drawn this many times (one-off strings never are). */
const CACHE_AFTER = 2;

/** Small LRU of pre-rendered images by key; null = the key cannot be cached. */
class ImageCache {
  private readonly images = new Map<string, HTMLCanvasElement>();
  private readonly seen = new Map<string, number>();

  /** The cached image for `key`, building it with `paint` once the key has been asked for CACHE_AFTER times. */
  get(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
    const hit = this.images.get(key);
    if (hit) {
      this.images.delete(key);
      this.images.set(key, hit);
      return hit;
    }
    const n = (this.seen.get(key) ?? 0) + 1;
    if (n < CACHE_AFTER) {
      if (this.seen.size >= CACHE_MAX * 4) this.seen.clear();
      this.seen.set(key, n);
      return null;
    }
    this.seen.delete(key);
    const img = offscreen(w, h, paint);
    if (!img) return null;
    if (this.images.size >= CACHE_MAX) {
      const oldest = this.images.keys().next();
      if (!oldest.done) this.images.delete(oldest.value);
    }
    this.images.set(key, img);
    return img;
  }
}

/** A w x h canvas painted by `paint`, or null without a DOM. */
function offscreen(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  return canvas;
}

/** Whether pre-rendered images can be blitted onto this renderer (a real 2D context in a browser). */
function canBlit(r: Renderer): boolean {
  return typeof document !== 'undefined' && typeof r.ctx?.drawImage === 'function';
}

/** No line breaks (only single lines are pre-rendered). */
function singleLine(text: string): boolean {
  return !text.includes('\n') && !text.includes('\r');
}

function blit(r: Renderer, img: HTMLCanvasElement, x: number, y: number): void {
  const ctx = r.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y);
}

const outlined = new ImageCache();
const bigTexts = new ImageCache();

/** Bitmap text with a 1 px outline all round (readable over any backdrop). */
export function outlineText(r: Renderer, text: string, x: number, y: number, color: string, opts?: OutlineOpts): void {
  const align = opts?.align ?? 'left';
  const outline = opts?.outline ?? UI.outline;
  if (text && singleLine(text) && canBlit(r)) {
    // Laid out exactly as the renderer's drawText would (rounded, aligned per line).
    const w = measureText(text);
    const img = outlined.get(`${color}|${outline}|${text}`, w + 2, GLYPH_H + 2, (ctx) => {
      for (const [dx, dy] of OUTLINE_OFFSETS) drawTextAligned(ctx, text, 1 + dx, 1 + dy, outline, 'left');
      drawTextAligned(ctx, text, 1, 1, color, 'left');
    });
    if (img) {
      const left = Math.round(x) - (align === 'center' ? Math.floor(w / 2) : align === 'right' ? w : 0);
      blit(r, img, left - 1, Math.round(y) - 1);
      return;
    }
  }
  TEXT.align = align;
  TEXT.color = outline;
  for (const [dx, dy] of OUTLINE_OFFSETS) r.drawText(text, x + dx, y + dy, TEXT);
  TEXT.color = color;
  r.drawText(text, x, y, TEXT);
}

/** One horizontal colour band of scaled text: glyph rows [from, to) of the 8-row font cell. */
export interface TextBand {
  from: number;
  to: number;
  color: string;
}

export interface BigTextOpts {
  /** Integer scale (2 or 3 for titles). */
  scale: number;
  /** Colour bands top to bottom (a vertical "gradient" in a few flat colours). */
  bands: readonly TextBand[];
  outline?: string;
  /** Outline thickness in screen px (default 1; 0 = no outline). */
  outlineWidth?: number;
  /** Drop shadow colour under the outline (offset 1 px right and down per scale step). */
  shadow?: string;
  align?: 'left' | 'center';
}

/**
 * Bitmap text scaled up crisply (the renderer honours ctx transforms), coloured
 * in horizontal bands, with an outline (outlineWidth screen px) and an optional shadow.
 * (x, y) is the top-left (or top-centre) in screen px.
 */
export function bigText(r: Renderer, text: string, x: number, y: number, opts: BigTextOpts): void {
  const s = opts.scale;
  const w = r.measureText(text) * s;
  const left = Math.round(opts.align === 'center' ? x - w / 2 : x);
  const top = Math.round(y);
  const ow = opts.outlineWidth ?? 1;
  const outline = opts.outline ?? UI.outline;
  // Every pass lands within `pad` px of the text box (outline ring + shadow offset).
  const pad = ow + (opts.shadow ? s : 0) + 1;
  if (text && singleLine(text) && canBlit(r)) {
    const key = `${s}|${ow}|${outline}|${opts.shadow ?? ''}|${opts.bands.map((b) => `${b.from}-${b.to}-${b.color}`).join(',')}|${text}`;
    const img = bigTexts.get(key, w + 2 * pad, 8 * s + 2 * pad, (ctx) => {
      bigTextPasses(ctx, (c, color) => drawTextAligned(c, text, 0, 0, color, 'left'), w, pad, pad, s, ow, outline, opts);
    });
    if (img) {
      blit(r, img, left - pad, top - pad);
      return;
    }
  }
  bigTextPasses(r.ctx, (_c, color) => r.drawText(text, 0, 0, { color, shadow: false }), w, left, top, s, ow, outline, opts);
}

/** bigText's passes onto `ctx` with the text box's top-left at (left, top); `draw` writes the text at the origin. */
function bigTextPasses(
  ctx: CanvasRenderingContext2D, draw: (ctx: CanvasRenderingContext2D, color: string) => void,
  w: number, left: number, top: number, s: number, ow: number, outline: string, opts: BigTextOpts,
): void {
  const pass = (dx: number, dy: number, color: string, clip?: TextBand): void => {
    ctx.save();
    ctx.translate(left + dx, top + dy);
    ctx.scale(s, s);
    if (clip) {
      ctx.beginPath();
      ctx.rect(-1, clip.from, w / s + 2, clip.to - clip.from);
      ctx.clip();
    }
    draw(ctx, color);
    ctx.restore();
  };
  if (opts.shadow) {
    for (const [dx, dy] of OUTLINE_OFFSETS) pass(dx * ow + s, dy * ow + s, opts.shadow);
  }
  if (ow > 0) {
    for (const [dx, dy] of OUTLINE_OFFSETS) pass(dx * ow, dy * ow, outline);
  }
  for (const band of opts.bands) pass(0, 0, band.color, band);
}

/** Gold title bands (light top, deep bottom) for bigText. */
export const GOLD_BANDS: readonly TextBand[] = [
  { from: 0, to: 2, color: '#f8f0b0' },
  { from: 2, to: 4, color: UI.gold },
  { from: 4, to: 6, color: '#e89820' },
  { from: 6, to: 8, color: '#b85810' },
];

/** Widest a hint line along the bottom of a menu may be (px). */
export const HINT_MAX_W = 236;

/**
 * The first of `candidates` (fullest wording first) that fits in `maxWidth` px,
 * else the last: button names differ in width between devices (ENTER, OPTIONS, +).
 */
export function fitText(candidates: readonly string[], maxWidth: number = HINT_MAX_W): string {
  for (const c of candidates) if (measureText(c) <= maxWidth) return c;
  return candidates[candidates.length - 1] ?? '';
}

/** Told to gamepad players while browser audio waits for a gesture (a pad press is not one). */
export const SOUND_HINT = 'CLICK OR PRESS A KEY FOR SOUND';

/** Whether SOUND_HINT applies: the audio is still locked (or suspended) and the player is on a gamepad. */
export function needsSoundHint(audio: AudioApi): boolean {
  const s = audio.status;
  return (s === 'locked' || s === 'suspended') && currentControls().device === 'gamepad';
}

/** Play time as H:MM:SS (or M:SS under an hour). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Plain bitmap text without the renderer's default drop shadow. */
export function flatText(r: Renderer, text: string, x: number, y: number, color: string, align: Align = 'left'): void {
  TEXT.color = color;
  TEXT.align = align;
  r.drawText(text, x, y, TEXT);
}

/** Zero-padded whole number (negative values clamp to 0). */
export function padNumber(n: number, digits: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(digits, '0');
}

/**
 * SNES window: rounded dark outline, a light ring, a mid ring and the fill.
 * Minimum useful size is 8x8.
 */
export function drawFrame(r: Renderer, x: number, y: number, w: number, h: number, fill: string = UI.fill, alpha = 1): void {
  if (w < 8 || h < 8) return;
  const o = SCREEN;
  // Outline with clipped corners.
  r.fillRect(x + 2, y, w - 4, 1, UI.outline, o);
  r.fillRect(x + 2, y + h - 1, w - 4, 1, UI.outline, o);
  r.fillRect(x, y + 2, 1, h - 4, UI.outline, o);
  r.fillRect(x + w - 1, y + 2, 1, h - 4, UI.outline, o);
  r.fillRect(x + 1, y + 1, 1, 1, UI.outline, o);
  r.fillRect(x + w - 2, y + 1, 1, 1, UI.outline, o);
  r.fillRect(x + 1, y + h - 2, 1, 1, UI.outline, o);
  r.fillRect(x + w - 2, y + h - 2, 1, 1, UI.outline, o);
  // Light ring.
  r.fillRect(x + 2, y + 1, w - 4, 1, UI.light, o);
  r.fillRect(x + 2, y + h - 2, w - 4, 1, UI.light, o);
  r.fillRect(x + 1, y + 2, 1, h - 4, UI.light, o);
  r.fillRect(x + w - 2, y + 2, 1, h - 4, UI.light, o);
  // Mid ring (top/left) and shade ring (bottom/right) give a slight bevel.
  r.fillRect(x + 2, y + 2, w - 4, 1, UI.mid, o);
  r.fillRect(x + 2, y + 3, 1, h - 5, UI.mid, o);
  r.fillRect(x + 3, y + h - 3, w - 5, 1, UI.shade, o);
  r.fillRect(x + w - 3, y + 3, 1, h - 6, UI.shade, o);
  if (alpha >= 1) r.fillRect(x + 3, y + 3, w - 6, h - 6, fill, o);
  else r.fillRect(x + 3, y + 3, w - 6, h - 6, fill, { screen: true, alpha });
}

/** Width (px) of the key cap drawKeyCap draws for `label`. */
export function keyCapWidth(label: string): number {
  return Math.max(11, measureText(label) + 6);
}

/**
 * A button name on a small key cap (dark outline with clipped corners, lit top
 * edge), its left edge at x and the label's text row at y (the cap spans y-2 to
 * y+8). Returns the cap's width.
 */
export function drawKeyCap(r: Renderer, label: string, x: number, y: number, color: string = UI.text): number {
  const w = keyCapWidth(label);
  const o = SCREEN;
  r.fillRect(x + 1, y - 2, w - 2, 11, UI.outline, o);
  r.fillRect(x, y - 1, w, 9, UI.outline, o);
  r.fillRect(x + 1, y - 1, w - 2, 9, UI.fillLight, o);
  r.fillRect(x + 2, y - 1, w - 4, 1, UI.mid, o);
  r.fillRect(x + 2, y + 7, w - 4, 1, UI.shade, o);
  flatText(r, label, x + Math.floor((w - measureText(label)) / 2), y, color);
  return w;
}

/** A small title plate straddling the top edge of a frame. */
export function drawTitlePlate(r: Renderer, label: string, x: number, y: number): void {
  const w = r.measureText(label) + 12;
  drawFrame(r, x, y - 6, w, 13, UI.fillLight);
  outlineText(r, label, x + 6, y - 3, UI.gold);
}

/** Solid pointer triangle (7 px tall) with a dark outline. `dir` is where it points. */
export function drawPointer(r: Renderer, x: number, y: number, color: string = UI.gold, dir: 'right' | 'down' = 'right'): void {
  if (dir === 'right') {
    triangle(r, x - 1, y, UI.outline, 1, dir);
    r.fillRect(x + 4, y + 2, 1, 3, UI.outline, SCREEN);
  } else {
    triangle(r, x, y - 1, UI.outline, 1, dir);
    r.fillRect(x + 2, y + 4, 3, 1, UI.outline, SCREEN);
  }
  triangle(r, x, y, color, 0, dir);
}

/** The pointer's 4-step triangle (`grow` widens it by 1 px each side, for the outline). */
function triangle(r: Renderer, ox: number, oy: number, c: string, grow: number, dir: 'right' | 'down'): void {
  for (let i = 0; i < 4; i++) {
    const len = 7 - i * 2 + grow * 2;
    if (dir === 'right') r.fillRect(ox + i, oy + i - grow, 1, len, c, SCREEN);
    else r.fillRect(ox + i - grow, oy + i, len, 1, c, SCREEN);
  }
}

/** 'hud' heart anim for the i-th heart given hp in half-hearts. */
export function heartAnim(hp: number, index: number): 'heart_full' | 'heart_half' | 'heart_empty' {
  const v = hp - index * 2;
  return v >= 2 ? 'heart_full' : v === 1 ? 'heart_half' : 'heart_empty';
}

const NO_HEART_OPTS = {} as const;
const FLASH = { screen: true, flash: true } as const;

/** Hearts from 'hud' icons, `perRow` per row (8 px pitch). `flashFilled` draws filled hearts as white silhouettes. */
export function drawHearts(
  r: Renderer, x: number, y: number, hp: number, maxHp: number, opts: { perRow?: number; flashFilled?: boolean } = NO_HEART_OPTS,
): void {
  const perRow = opts.perRow ?? 10;
  const hearts = Math.ceil(Math.max(0, maxHp) / 2);
  for (let i = 0; i < hearts; i++) {
    const anim = heartAnim(hp, i);
    const flash = opts.flashFilled === true && anim !== 'heart_empty';
    r.drawSpriteAnim('hud', anim, 0, x + (i % perRow) * 8, y + Math.floor(i / perRow) * 8, flash ? FLASH : SCREEN);
  }
}

/** Icon anim of an item at the level the save owns (level-2 art when available). */
export function itemIcon(save: SaveData, item: ItemId): string {
  const info = ITEM_INFO[item];
  return info.icon2 && (save.items[item] ?? 0) >= 2 ? info.icon2 : info.icon;
}

/** Draw a 16x16 item icon centred on (cx, cy). */
export function drawItem(r: Renderer, save: SaveData, item: ItemId, cx: number, cy: number, alpha?: number): void {
  r.drawSpriteAnim('item', itemIcon(save, item), 0, cx, cy, alpha === undefined ? SCREEN : { screen: true, alpha });
}

/** 15x13 heart split into quarters (TL, TR, BL, BR) for the piece-of-heart counter. */
const PIECE_HEART: readonly string[] = [
  '...ooo...ooo...',
  '..oaaao.obbbo..',
  '.oaaaaaobbbbbo.',
  'oaaaaaaobbbbbbo',
  'oaaaaaaobbbbbbo',
  'oaaaaaaobbbbbbo',
  'ooooooooooooooo',
  '.occcccodddddo.',
  '..occccoddddo..',
  '...occcodddo...',
  '....occoddo....',
  '.....ocodo.....',
  '......ooo......',
];
const QUARTERS = 'abcd';

/** Pre-rendered heart-piece icons by filled quarters (0-4); null where they cannot be. */
const pieceIcons = new Map<number, HTMLCanvasElement | null>();

/** Piece-of-heart icon at (x, y) (top-left) with `pieces` quarters (0-4) filled. */
export function drawHeartPieces(r: Renderer, x: number, y: number, pieces: number): void {
  if (canBlit(r)) {
    let icon = pieceIcons.get(pieces);
    if (icon === undefined) {
      icon = offscreen(PIECE_HEART[0]!.length, PIECE_HEART.length, (ctx) => paintHeartPieces((px, py, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(px, py, 1, 1);
      }, pieces));
      pieceIcons.set(pieces, icon);
    }
    if (icon) {
      blit(r, icon, x, y);
      return;
    }
  }
  paintHeartPieces((px, py, color) => r.fillRect(x + px, y + py, 1, 1, color, SCREEN), pieces);
}

function paintHeartPieces(dot: (px: number, py: number, color: string) => void, pieces: number): void {
  PIECE_HEART.forEach((row, py) => {
    for (let px = 0; px < row.length; px++) {
      const ch = row[px]!;
      if (ch === '.') continue;
      if (ch === 'o') {
        dot(px, py, UI.outline);
        continue;
      }
      const filled = QUARTERS.indexOf(ch) < pieces;
      const shine = filled && (py === 1 || py === 2) && (px === 2 || px === 3 || px === 9 || px === 10);
      dot(px, py, filled ? (shine ? '#f8b0b0' : UI.red) : '#384060');
    }
  });
}
