// Animated pixel banner for the main menu: the title in the game's own font
// over a dusk sky, hills, a tree line and grass drawn from the default tiles,
// with the hero (and a fairy) walking across. Integer-scaled to the width.
import type { Project } from '../core/types';
import { AssetCache } from '../gfx/imageCache';
import { GLYPH_H, drawText, measureText } from '../gfx/font';
import { createDefaultAssets } from '../content/art';
import { PROJECT_FORMAT, PROJECT_VERSION, TILE } from '../core/constants';
import { T } from '../content/ids';

/** Native (unscaled) banner height in px. */
const H = 136;
const GROUND_Y = 96;
/** The hero walks along the first grass row, clear of the buttons overlapping the banner's bottom edge. */
const HERO_Y = 111;
const HERO_SPEED = 34;
const TITLE = 'QUESTFORGE';
const SUBTITLE = 'BUILD AND PLAY 16-BIT ADVENTURES';
const SKY = ['#140c2c', '#1c1238', '#261846', '#321c52', '#44225a', '#5c2a5e', '#7a345e', '#9c4458', '#c05a50', '#e07a48'];

/** The menu banner canvas and its teardown. */
export interface Banner {
  readonly element: HTMLCanvasElement;
  destroy(): void;
}

/** Deterministic 0..1 noise so the scenery is the same on every visit. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A project holding only the default assets (the banner's AssetCache source). */
function assetsProject(): Project {
  const a = createDefaultAssets();
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, id: 'banner', name: 'banner', author: '', description: '', created: 0, modified: 0,
    settings: { title: '', subtitle: '', startHearts: 3, startItems: {}, titleMusic: 'title' },
    palettes: a.palettes, tiles: a.tiles, terrains: a.terrains, sprites: a.sprites, worlds: [], dialogues: [], flags: [],
    start: { world: '', room: '', x: 0, y: 0 },
  };
}

function drawSky(g: CanvasRenderingContext2D, w: number): void {
  const band = Math.ceil(GROUND_Y / SKY.length);
  SKY.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(0, i * band, w, band);
  });
  // Setting sun, half hidden by the hills.
  const cx = Math.round(w * 0.74);
  for (let r = 22; r > 0; r -= 2) {
    g.fillStyle = r > 16 ? '#f0985a' : r > 10 ? '#f8b868' : '#ffe08a';
    for (let dy = -r; dy <= 0; dy++) {
      const half = Math.round(Math.sqrt(r * r - dy * dy));
      g.fillRect(cx - half, 78 + dy, half * 2, 1);
    }
  }
}

/** A stepped hill silhouette: height(x) from a few sines, quantised to 2 px. */
function drawHills(g: CanvasRenderingContext2D, w: number, color: string, base: number, amp: number, seed: number): void {
  g.fillStyle = color;
  for (let x = 0; x < w; x += 2) {
    const h = amp * (0.55 * Math.sin(x / 37 + seed) + 0.3 * Math.sin(x / 13 + seed * 2) + 0.15 * Math.sin(x / 7 + seed * 3));
    const top = Math.round((base - h) / 2) * 2;
    g.fillRect(x, top, 2, GROUND_Y - top);
  }
}

function drawGround(g: CanvasRenderingContext2D, assets: AssetCache, w: number): void {
  for (let y = GROUND_Y; y < H; y += TILE) {
    for (let x = 0, i = 0; x < w; x += TILE, i++) {
      const alt = hash(i * 7 + y) < 0.3;
      assets.drawTileTo(g, alt ? T.GRASS_ALT : T.GRASS, x, y);
    }
  }
  // Tree line and a few bushes standing on the first grass row.
  for (let x = -8, i = 0; x < w; i++) {
    const tx = Math.round(x);
    assets.drawTileTo(g, T.TREE_TL, tx, GROUND_Y - 32);
    assets.drawTileTo(g, T.TREE_TR, tx + TILE, GROUND_Y - 32);
    assets.drawTileTo(g, T.TREE_BL, tx, GROUND_Y - 16);
    assets.drawTileTo(g, T.TREE_BR, tx + TILE, GROUND_Y - 16);
    if (hash(i + 3) < 0.35) assets.drawTileTo(g, T.BUSH, tx + 36, GROUND_Y - 16);
    x += 44 + Math.round(hash(i) * 40);
  }
}

/** Extra px between title letters so their outlines stay apart. */
const TITLE_GAP = 1;

/** Draw `text` letter by letter with TITLE_GAP extra spacing; returns the drawn width. */
function drawSpaced(t: CanvasRenderingContext2D | null, text: string, x: number, y: number, color: string): number {
  let cx = x;
  for (const ch of text) {
    if (t) drawText(t, ch, cx, y, color);
    cx += measureText(ch) + 1 + TITLE_GAP;
  }
  return cx - x - 1 - TITLE_GAP;
}

interface Rect { x: number; y: number; w: number; h: number }

/** The title with a two-tone fill, a 1px outline and a drop shadow, drawn at `scale` with its top centre at (cx, y); returns where it went. */
function drawTitle(g: CanvasRenderingContext2D, cx: number, y: number, scale: number): Rect | null {
  const c = document.createElement('canvas');
  c.width = drawSpaced(null, TITLE, 0, 0, '') + 4;
  c.height = GLYPH_H + 4;
  const t = c.getContext('2d');
  if (!t) return null;
  for (let dy = 0; dy <= 2; dy++) {
    for (let dx = 0; dx <= 2; dx++) drawSpaced(t, TITLE, 1 + dx, 1 + dy, '#0c0618');
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (dx || dy) drawSpaced(t, TITLE, 1 + dx, 1 + dy, '#3a1a08');
  }
  drawSpaced(t, TITLE, 1, 1, '#ffe070');
  t.save();
  t.beginPath();
  t.rect(0, 5, c.width, 4);
  t.clip();
  drawSpaced(t, TITLE, 1, 1, '#e8902c');
  t.restore();
  const rect = { x: Math.round(cx - (c.width * scale) / 2), y, w: c.width * scale, h: c.height * scale };
  g.imageSmoothingEnabled = false;
  g.drawImage(c, rect.x, rect.y, rect.w, rect.h);
  return rect;
}

/** The subtitle with a drop shadow, centred on cx; returns where it went. */
function drawSubtitle(g: CanvasRenderingContext2D, cx: number, y: number): Rect {
  const w = measureText(SUBTITLE);
  const x = Math.round(cx - w / 2);
  drawText(g, SUBTITLE, x + 1, y + 1, '#0c0618');
  drawText(g, SUBTITLE, x, y, '#efe4ff');
  return { x, y, w: w + 1, h: GLYPH_H + 1 };
}

/** Whether (x, y) lies within `pad` px of `r`. */
function near(r: Rect, x: number, y: number, pad: number): boolean {
  return x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;
}

interface Star { x: number; y: number; phase: number }

/** Create the banner canvas; it sizes itself to its parent's width once mounted. */
export function createBanner(): Banner {
  const canvas = document.createElement('canvas');
  canvas.className = 'qf-canvas qf-menu-banner__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Questforge — build and play 16-bit adventures. The hero walks across a grassy field at dusk.');
  const g = canvas.getContext('2d');
  const assets = new AssetCache(assetsProject());
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scenery = document.createElement('canvas');
  let stars: Star[] = [];
  let flowers: { x: number; y: number }[] = [];
  let width = 0;
  let raf = 0;
  let observer: ResizeObserver | null = null;
  let start = 0;
  let destroyed = false;

  const layout = (cssWidth: number): void => {
    const scale = cssWidth >= 900 ? 3 : cssWidth >= 360 ? 2 : 1;
    const w = Math.max(160, Math.ceil(cssWidth / scale));
    canvas.style.width = `${w * scale}px`;
    canvas.style.height = `${H * scale}px`;
    if (w === width) return;
    width = w;
    canvas.width = w;
    canvas.height = H;
    scenery.width = w;
    scenery.height = H;
    const s = scenery.getContext('2d');
    if (!s) return;
    s.imageSmoothingEnabled = false;
    drawSky(s, w);
    drawHills(s, w, '#3a2458', 62, 18, 1.3);
    drawHills(s, w, '#1f2c3c', 80, 10, 4.1);
    drawGround(s, assets, w);
    // Stars twinkle over the scenery, so none may sit on the lettering.
    const text = [drawTitle(s, w / 2, 8, w >= 240 ? 3 : 2), drawSubtitle(s, w / 2, w >= 240 ? 44 : 34)].filter((r): r is Rect => r !== null);
    stars = Array.from({ length: Math.round(w / 9) }, (_, i) => ({ x: Math.floor(hash(i * 3.1) * w), y: Math.floor(hash(i * 5.7) * 40), phase: hash(i) * 6.28 }))
      .filter((st) => !text.some((r) => near(r, st.x, st.y, 2)));
    flowers = Array.from({ length: Math.round(w / 40) }, (_, i) => ({
      x: Math.floor((hash(i * 9.3) * w) / TILE) * TILE, y: GROUND_Y + TILE * (hash(i * 2.2) < 0.5 ? 0 : 1),
    }));
    draw(start);
  };

  const draw = (now: number): void => {
    if (!g || width === 0) return;
    const t = (now - start) / 1000;
    g.imageSmoothingEnabled = false;
    g.drawImage(scenery, 0, 0);
    for (const f of flowers) assets.drawTileTo(g, T.FLOWERS, f.x, f.y, 1, t);
    for (const s of stars) {
      g.globalAlpha = reduced ? 0.7 : 0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + s.phase));
      g.fillStyle = '#fff4d8';
      g.fillRect(s.x, s.y, 1, 1);
    }
    g.globalAlpha = 1;
    const span = width + 64;
    const hx = reduced ? Math.round(width * 0.3) : Math.round(((t * HERO_SPEED) % span) - 32);
    const anim = reduced ? 'idle_down' : 'walk_right';
    assets.drawSpriteAt(g, 'hero', Math.max(0, assets.animFrame('hero', anim, t)), hx, HERO_Y);
    const fy = HERO_Y - 26 + Math.round(Math.sin(t * 3) * 3);
    assets.drawSpriteAt(g, 'pickup', Math.max(0, assets.animFrame('pickup', 'fairy', t)), hx - 18, fy);
  };

  const frame = (now: number): void => {
    if (!canvas.isConnected) {
      destroy();
      return;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  const destroy = (): void => {
    destroyed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    observer?.disconnect();
    observer = null;
  };

  // Size once attached (the parent's width is unknown until then).
  requestAnimationFrame((now) => {
    const parent = canvas.parentElement;
    if (destroyed || !canvas.isConnected || !parent) return;
    start = now;
    let measured = parent.clientWidth;
    layout(measured);
    // Only width matters; re-layout on the next frame (resizing inside the
    // observer callback would change the parent's height and loop).
    observer = new ResizeObserver(() => {
      if (parent.clientWidth === measured) return;
      measured = parent.clientWidth;
      requestAnimationFrame(() => {
        if (!destroyed) layout(measured);
      });
    });
    observer.observe(parent);
    if (!reduced) raf = requestAnimationFrame(frame);
  });

  return { element: canvas, destroy };
}
