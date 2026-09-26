// Title screen: an original, procedurally drawn night landscape with parallax
// layers (twinkling stars and a moon, far mountains, drifting clouds, near hills
// and a pine treeline) under the project title in large gold bitmap letters,
// the subtitle, a blinking "PRESS ENTER" and a line naming the main controls (a
// shared #/play link is often the first thing a player sees). On a touch-only
// device (coarse pointer, no gamepad connected) the prompt says a keyboard or
// gamepad is needed instead, as there is no touch control. Fades in slowly; any
// confirm button during the fade shows everything at once. The static sky and
// moon are drawn once into offscreen canvases and blitted each frame; the moving
// layers draw as merged runs of columns/rows. OWNER: triggers+UI agent.
import type { Project } from '../../core/types';
import type { AudioApi, InputState, Renderer } from '../api';
import { wrapText } from '../../gfx/font';
import { GOLD_BANDS, SCREEN, UI, bigText, keyLabel, outlineText } from './theme';

const FADE_IN = 1.6;
const START_BUTTONS = ['start', 'a', 'b'] as const;
/** Widest the title may be (px) before it shrinks or wraps. */
const TITLE_MAX_W = 236;
const TITLE_TOP = 40;
const HORIZON = 150;
/** Screen y of the start prompt and of the controls line under it. */
const PROMPT_Y = 170;
const CONTROLS_Y = 184;
/** The main controls, with the game's own key names. */
const CONTROLS_LINE = `${keyLabel('b')} SWORD   ${keyLabel('a')} ACTION   ${keyLabel('y')} ITEM   ${keyLabel('start')} MENU`;
const NEEDS_KEYS = 'KEYBOARD OR GAMEPAD REQUIRED';

/** A touch screen is the only pointer (phones, tablets): the game has no touch controls. */
function coarsePointerOnly(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

function gamepadConnected(): boolean {
  try {
    return typeof navigator !== 'undefined' && Array.from(navigator.getGamepads?.() ?? []).some((p) => p !== null);
  } catch {
    return false;
  }
}

/** Sky bands top to bottom: [start y, colour]; boundaries are dithered. */
const SKY: readonly (readonly [number, string])[] = [
  [0, '#080820'], [34, '#0c1030'], [66, '#141840'], [94, '#201c50'], [116, '#30225c'], [132, '#482a68'], [144, '#603470'],
];

interface Layer {
  speed: number;
  base: number;
  color: string;
  top?: string;
  height(x: number): number;
}

const FAR_MOUNTAINS: Layer = {
  speed: 3, base: HORIZON + 6, color: '#2a2a60', top: '#4a4a88',
  height: (x) => 34 + 13 * Math.sin(x * 0.021 + 1) + 8 * Math.sin(x * 0.057 + 2) + 4 * Math.abs(Math.sin(x * 0.13)),
};
const NEAR_HILLS: Layer = {
  speed: 11, base: 192, color: '#161838', top: '#24285a',
  height: (x) => 26 + 9 * Math.sin(x * 0.017 + 4) + 5 * Math.sin(x * 0.043),
};

/** Deterministic pseudo-random in [0, 1) from an integer. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: Math.floor(hash(i) * 256),
  y: Math.floor(hash(i + 100) * 128),
  phase: hash(i + 200) * Math.PI * 2,
  bright: hash(i + 300) > 0.8,
}));

/** Moon centre, disc radius and glow radius (px). */
const MOON = { cx: 230, cy: 20, radius: 10, glow: 13 } as const;
const MOON_GLOW_ALPHA = 0.12;
const CLOUD_BODY = { screen: true, alpha: 0.55 } as const;
const CLOUD_TOP = { screen: true, alpha: 0.5 } as const;
const CLOUD_LIGHT = { screen: true, alpha: 0.35 } as const;

/** Fills a rect (optionally translucent): the renderer, or a raw canvas while caching. */
type Fill = (x: number, y: number, w: number, h: number, color: string, alpha?: number) => void;

/** A canvas of w x h painted once by `paint`, or null without a DOM. */
function paintOffscreen(w: number, h: number, paint: (fill: Fill) => void): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint((x, y, fw, fh, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, fh);
  });
  return canvas;
}

/** Draws straight through the renderer (screen space). */
function rendererFill(r: Renderer): Fill {
  return (x, y, w, h, color, alpha) => r.fillRect(x, y, w, h, color, alpha === undefined ? SCREEN : { screen: true, alpha });
}

/** Offscreen copies of the static backdrop (undefined until first drawn; null = draw directly). */
let skyImage: HTMLCanvasElement | null | undefined;
let moonImage: HTMLCanvasElement | null | undefined;

const CLOUDS = Array.from({ length: 5 }, (_, i) => ({
  x: hash(i + 400) * 320,
  y: 86 + Math.floor(hash(i + 500) * 40),
  w: 36 + Math.floor(hash(i + 600) * 40),
  speed: 5 + hash(i + 700) * 6,
}));

export class TitleScreen {
  private readonly project: Project;
  private readonly audio: AudioApi;
  private readonly touchOnly = coarsePointerOnly();
  private t = 0;

  constructor(project: Project, audio: AudioApi) {
    this.project = project;
    this.audio = audio;
    audio.music(project.settings.titleMusic);
  }

  update(dt: number, input: InputState): 'none' | 'start' {
    this.t += dt;
    if (!START_BUTTONS.some((b) => input.pressed(b))) return 'none';
    if (this.t < FADE_IN) {
      this.t = FADE_IN;
      return 'none';
    }
    this.audio.sfx('menuSelect');
    return 'start';
  }

  draw(r: Renderer): void {
    const t = this.t;
    drawSky(r);
    drawStars(r, t);
    drawMoon(r);
    drawLayer(r, FAR_MOUNTAINS, t);
    drawClouds(r, t);
    drawLayer(r, NEAR_HILLS, t);
    drawTrees(r, t);
    const bottom = this.drawTitle(r);
    this.drawTexts(r, bottom);
    if (t < FADE_IN) r.overlay('#000000', 1 - t / FADE_IN);
  }

  /** Draws the title; returns the y just below it. */
  private drawTitle(r: Renderer): number {
    const title = this.project.settings.title.trim() || this.project.name || 'Untitled';
    const { lines, scale } = fitTitle(r, title);
    let y = TITLE_TOP - (lines.length - 1) * 10;
    let widest = 0;
    for (const line of lines) {
      widest = Math.max(widest, r.measureText(line) * scale);
      bigText(r, line, r.width / 2, y, {
        scale, bands: GOLD_BANDS, outline: '#301008', outlineWidth: scale >= 2 ? 2 : 1, shadow: '#000010', align: 'center',
      });
      this.drawShine(r, line, y, scale);
      y += 8 * scale + 6;
    }
    drawRule(r, y + 1, widest);
    return y + 8;
  }

  /** A highlight that sweeps across the title letters every few seconds. */
  private drawShine(r: Renderer, line: string, y: number, scale: number): void {
    const period = 4;
    const phase = (this.t % period) / 0.9;
    if (phase > 1) return;
    const w = r.measureText(line) * scale;
    const left = r.width / 2 - w / 2;
    const x = Math.round(left - 12 + phase * (w + 24));
    const ctx = r.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 5, 8 * scale);
    ctx.rect(x + 7, y, 2, 8 * scale);
    ctx.clip();
    bigText(r, line, r.width / 2, y, { scale, bands: [{ from: 0, to: 8, color: '#fffff0' }], outlineWidth: 0, align: 'center' });
    ctx.restore();
  }

  private drawTexts(r: Renderer, y: number): void {
    const cx = r.width / 2;
    const subtitle = this.project.settings.subtitle.trim();
    if (subtitle) {
      wrapText(subtitle, 232).slice(0, 2).forEach((line, i) => {
        outlineText(r, line, cx, y + 4 + i * 10, '#d0d8f8', { align: 'center' });
      });
    }
    const shown = this.t >= FADE_IN * 0.6;
    if (shown && this.touchOnly && !gamepadConnected()) {
      outlineText(r, NEEDS_KEYS, cx, PROMPT_Y, UI.gold, { align: 'center', outline: '#000020' });
    } else if (shown) {
      if (this.t % 1.1 < 0.75) outlineText(r, `PRESS ${keyLabel('start')}`, cx, PROMPT_Y, UI.text, { align: 'center', outline: '#000020' });
      outlineText(r, CONTROLS_LINE, cx, CONTROLS_Y, UI.mid, { align: 'center', outline: '#000020' });
    }
    const author = this.project.author.trim();
    if (author) outlineText(r, `by ${author}`, cx, 210, UI.dim, { align: 'center', outline: '#000010' });
  }
}

/** Largest scale (3, then 2) at which the title fits on one line, else 2 lines at scale 2, else scale 1. */
function fitTitle(r: Renderer, title: string): { lines: string[]; scale: number } {
  for (const scale of [3, 2]) {
    if (r.measureText(title) * scale <= TITLE_MAX_W) return { lines: [title], scale };
  }
  const two = wrapText(title, Math.floor(TITLE_MAX_W / 2));
  if (two.length <= 2) return { lines: two, scale: 2 };
  return { lines: wrapText(title, TITLE_MAX_W).slice(0, 3), scale: 1 };
}

function drawSky(r: Renderer): void {
  if (skyImage === undefined) skyImage = paintOffscreen(r.width, r.height, (fill) => paintSky(fill, r.width, r.height));
  if (skyImage) r.ctx.drawImage(skyImage, 0, 0);
  else paintSky(rendererFill(r), r.width, r.height);
}

/** Sky bands with two dithered rows blending each band into the next. */
function paintSky(fill: Fill, width: number, height: number): void {
  SKY.forEach(([y0, color], i) => {
    const next = SKY[i + 1];
    const y1 = next?.[0] ?? height;
    fill(0, y0, width, y1 - y0, color);
    if (!next) return;
    for (let x = 0; x < width; x += 2) {
      fill(x, y1 - 2, 1, 1, next[1]);
      fill(x + 1, y1 - 1, 1, 1, next[1]);
    }
  });
}

function drawStars(r: Renderer, t: number): void {
  for (const s of STARS) {
    const x = Math.floor((s.x - t * 0.5 + 512) % 256);
    const tw = Math.sin(t * 2.2 + s.phase);
    if (tw < -0.75) continue;
    const color = s.bright ? '#f8f8f8' : tw > 0.3 ? '#c0c8f8' : '#7078b8';
    r.fillRect(x, s.y, 1, 1, color, SCREEN);
    if (s.bright && tw > 0.6) {
      r.fillRect(x - 1, s.y, 3, 1, '#9098d8', SCREEN);
      r.fillRect(x, s.y - 1, 1, 3, '#9098d8', SCREEN);
      r.fillRect(x, s.y, 1, 1, '#ffffff', SCREEN);
    }
  }
}

function drawMoon(r: Renderer): void {
  const size = MOON.glow * 2 + 1;
  if (moonImage === undefined) moonImage = paintOffscreen(size, size, (fill) => paintMoon(fill, MOON.glow, MOON.glow));
  if (moonImage) r.ctx.drawImage(moonImage, MOON.cx - MOON.glow, MOON.cy - MOON.glow);
  else paintMoon(rendererFill(r), MOON.cx, MOON.cy);
}

/** The moon disc centred on (cx, cy): lit from the upper left, with craters and a faint glow. */
function paintMoon(fill: Fill, cx: number, cy: number): void {
  const { radius, glow } = MOON;
  for (let dy = -glow; dy <= glow; dy++) {
    for (let dx = -glow; dx <= glow; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > glow) continue;
      if (d > radius) fill(cx + dx, cy + dy, 1, 1, '#f8f0c8', MOON_GLOW_ALPHA);
      else fill(cx + dx, cy + dy, 1, 1, (dx + dy) / radius > 0.9 ? '#c8b888' : '#f0e8b8');
    }
  }
  for (const [x, y, w] of [[-4, -3, 3], [2, 1, 3], [-2, 4, 2], [3, -5, 2]] as const) {
    fill(cx + x, cy + y, w, w - 1, '#d0c498');
  }
}

/** A scrolling ridge, drawn as runs of equal columns. */
function drawLayer(r: Renderer, layer: Layer, t: number): void {
  const off = t * layer.speed;
  let prev = Math.round(layer.height(off - 1));
  let runX = 0;
  let runTop = NaN;
  let runRim = 0;
  for (let x = 0; x < r.width; x++) {
    const h = Math.round(layer.height(x + off));
    const top = layer.base - h;
    // Moonlit rim: thicker on slopes that face the moon (up and to the right).
    const rim = prev > h ? 2 : 1;
    prev = h;
    if (top === runTop && rim === runRim) continue;
    if (x > 0) fillColumns(r, layer, runX, x - runX, runTop, runRim);
    runX = x;
    runTop = top;
    runRim = rim;
  }
  fillColumns(r, layer, runX, r.width - runX, runTop, runRim);
}

function fillColumns(r: Renderer, layer: Layer, x: number, w: number, top: number, rim: number): void {
  r.fillRect(x, top, w, r.height - top, layer.color, SCREEN);
  if (layer.top) r.fillRect(x, top, w, rim, layer.top, SCREEN);
}

function drawClouds(r: Renderer, t: number): void {
  for (const c of CLOUDS) {
    const span = r.width + c.w + 40;
    const x = Math.round(((c.x - t * c.speed) % span + span) % span) - c.w - 20;
    puff(r, x, c.y + 4, c.w, 6, '#5a4c8c', CLOUD_BODY);
    puff(r, x + Math.floor(c.w * 0.2), c.y, Math.floor(c.w * 0.45), 6, '#6a5c9c', CLOUD_TOP);
    puff(r, x + Math.floor(c.w * 0.1), c.y + 7, Math.floor(c.w * 0.8), 2, '#8878b0', CLOUD_LIGHT);
  }
}

/** One translucent cloud puff with rounded ends. */
function puff(r: Renderer, x: number, y: number, w: number, h: number, color: string, opts: { screen: true; alpha: number }): void {
  r.fillRect(x + 2, y, w - 4, h, color, opts);
  r.fillRect(x, y + 1, w, h - 2, color, opts);
}

/** Pine silhouettes scrolling in front, each drawn as runs of equal-width rows. */
function drawTrees(r: Renderer, t: number): void {
  const off = t * 22;
  const pitch = 14;
  const first = Math.floor(off / pitch) - 1;
  for (let i = first; i < first + Math.ceil(r.width / pitch) + 3; i++) {
    const h = 18 + Math.floor(hash(i) * 16);
    const x = Math.round(i * pitch - off + hash(i + 50) * 6);
    const top = 214 - Math.floor(hash(i + 90) * 4) - h;
    let runRow = 0;
    let runHalf = treeHalf(0, h);
    for (let row = 1; row <= h; row++) {
      const half = row < h ? treeHalf(row, h) : -1;
      if (half === runHalf) continue;
      r.fillRect(x - runHalf, top + runRow, runHalf * 2 + 1, row - runRow, '#080818', SCREEN);
      runRow = row;
      runHalf = half;
    }
  }
  r.fillRect(0, 210, r.width, r.height - 210, '#080818', SCREEN);
}

/** Half-width of a pine's row: widening downwards, with a notch every 5 rows. */
function treeHalf(row: number, h: number): number {
  return Math.floor((row / h) * 6) + (row % 5 === 4 ? 0 : 1);
}

/** Thin gold rule with diamond ends under the title. */
function drawRule(r: Renderer, y: number, width: number): void {
  const o = SCREEN;
  const w = Math.max(60, Math.round(width * 0.8));
  const x = Math.round(r.width / 2 - w / 2);
  r.fillRect(x, y, w, 1, UI.goldDark, o);
  r.fillRect(x + 2, y - 1, w - 4, 1, UI.gold, o);
  for (const cx of [x - 3, x + w + 2, Math.round(r.width / 2)]) {
    r.fillRect(cx - 1, y - 2, 3, 3, UI.outline, o);
    r.fillRect(cx, y - 3, 1, 5, UI.gold, o);
    r.fillRect(cx - 2, y - 1, 5, 1, UI.gold, o);
  }
}
