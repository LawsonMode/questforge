// Asset gallery page (#/gallery): every tile & sprite animation rendered large on
// a checkerboard, labelled, for art review and screenshots. OWNER: gfx agent.
//
// Query (in the hash): ?section=palettes|tiles|terrains|sprites shows one
// section; &filter=<text> keeps items whose id/key/name/tags contain the text.
// One requestAnimationFrame loop redraws animated canvases when their frame changes.
// Broken art (bad frames, missing palettes or frame indices) gets a red badge,
// a tooltip reason and a line in its section's issue list; missing anim frames
// draw magenta.
import './gallery.css';
import type { Palette, Project, SpriteAnim, SpriteDef, Terrain, TileDef } from '../core/types';
import { TILE } from '../core/constants';
import { spriteSpec } from '../content/ids';
import {
  TERRAIN_PIECES, animProblems, paletteProblems, spriteProblems, terrainProblems, tileProblems,
  type TerrainPiece,
} from './artCheck';
import { AssetCache, DEFAULT_TILE_FRAME_TIME } from './imageCache';
import { originOffsetX } from './layout';

type Section = 'palettes' | 'tiles' | 'terrains' | 'sprites';
const SECTIONS: readonly Section[] = ['palettes', 'tiles', 'terrains', 'sprites'];
const SECTION_TITLES: Readonly<Record<Section, string>> = {
  palettes: 'Palettes', tiles: 'Tiles', terrains: 'Terrains', sprites: 'Sprites',
};

/** Preview scale for tiles and sprite anims; frame strips and terrain demos use STRIP_SCALE. */
const SCALE = 3;
const STRIP_SCALE = 2;
/** Non-looping anims replay after holding their last frame this long (s). */
const REPLAY_PAUSE = 0.6;
/** Fill for anim frames that reference a missing sprite frame. */
const MISSING_FILL = '#ff00ff';

/**
 * Terrain demo mask: a ring with a 2x2 hole exercises all 13 autotile pieces
 * (outer corners, edges, inner corners around the hole, centre).
 */
const TERRAIN_DEMO = [
  '..........',
  '.########.',
  '.########.',
  '.###..###.',
  '.###..###.',
  '.########.',
  '.########.',
  '..........',
];

interface Query { section: Section | null; filter: string }

/** Horizontal layout of a sprite's anim preview canvases (unscaled px). */
interface Span { anchor: number; width: number }

/** Called every animation frame with the gallery time (s); should do nothing when its frame hasn't changed. */
type Animator = (t: number) => void;

/** Shared state of one mounted gallery. */
interface Gallery {
  project: Project;
  cache: AssetCache;
  filter: string;
  animators: Animator[];
  /** "id: problem; problem" lines for the section being built. */
  issues: string[];
}

// ---------------------------------------------------------------- DOM helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Canvas on a checkerboard backdrop (so transparency is visible), smoothing off. */
function canvas(width: number, height: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const c = h('canvas', 'qf-gal-checker');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  return { el: c, ctx };
}

function label(main: string, extra?: string): HTMLElement {
  const l = h('div', 'qf-gal-label', main);
  if (extra) l.append(' ', h('small', undefined, extra));
  return l;
}

function matches(filter: string, ...fields: (string | number)[]): boolean {
  return !filter || fields.some((f) => String(f).toLowerCase().includes(filter));
}

/** Flag an element as broken: red badge, reasons in its tooltip and in the section's issue list. */
function markInvalid(c: Gallery, el: HTMLElement, id: string, problems: readonly string[]): void {
  if (!problems.length) return;
  el.classList.add('is-invalid');
  el.title = `${el.title ? `${el.title}\n` : ''}INVALID: ${problems.join('; ')}`;
  el.append(h('span', 'qf-gal-badge', '!'));
  c.issues.push(`${id}: ${problems.join('; ')}`);
}

function readQuery(): Query {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const s = params.get('section');
  return {
    section: SECTIONS.includes(s as Section) ? (s as Section) : null,
    filter: (params.get('filter') ?? '').trim().toLowerCase(),
  };
}

function galleryHash(section: Section | null, filter: string): string {
  const params = new URLSearchParams();
  if (section) params.set('section', section);
  if (filter) params.set('filter', filter);
  const q = params.toString();
  return q ? `#/gallery?${q}` : '#/gallery';
}

// ---------------------------------------------------------------- header & sections

function buildHeader(project: Project, query: Query): HTMLElement {
  const head = h('header', 'qf-gal-head');
  head.append(h('h1', undefined, 'Asset gallery'));
  head.append(h('span', 'qf-gal-counts',
    `${project.palettes.length} palettes · ${project.tiles.length} tiles · `
    + `${project.terrains.length} terrains · ${project.sprites.length} sprites`));
  const nav = h('nav', 'qf-gal-nav');
  for (const s of [null, ...SECTIONS]) {
    const a = h('a', s === query.section ? 'is-active' : undefined, s ? SECTION_TITLES[s] : 'All');
    a.href = galleryHash(s, query.filter);
    nav.append(a);
  }
  head.append(nav);
  const input = h('input', 'qf-gal-filter');
  input.type = 'search';
  input.placeholder = 'filter (id, key, name, tag)';
  input.value = query.filter;
  input.addEventListener('change', () => {
    location.hash = galleryHash(query.section, input.value.trim().toLowerCase());
  });
  head.append(input);
  return head;
}

function sectionShell(section: Section): HTMLElement {
  const el = h('section', 'qf-gal-section');
  el.dataset.section = section;
  el.append(h('h2', undefined, SECTION_TITLES[section]));
  return el;
}

/** Issue list shown under a section heading (nothing when the section is clean). */
function issueList(issues: readonly string[]): HTMLElement | null {
  if (!issues.length) return null;
  const box = h('div', 'qf-gal-issues');
  box.append(h('strong', undefined, `${issues.length} problem${issues.length === 1 ? '' : 's'}`));
  const list = h('ul');
  for (const line of issues) list.append(h('li', undefined, line));
  box.append(list);
  return box;
}

// ---------------------------------------------------------------- palettes

function buildPalettes(c: Gallery): HTMLElement {
  const sec = sectionShell('palettes');
  const grid = h('div', 'qf-gal-grid');
  for (const p of c.project.palettes) {
    if (matches(c.filter, p.id, p.name)) grid.append(paletteCard(c, p));
  }
  sec.append(grid.childElementCount ? grid : h('p', 'qf-gal-empty', 'No palettes match.'));
  return sec;
}

function paletteCard(c: Gallery, p: Palette): HTMLElement {
  const card = h('div', 'qf-gal-item qf-gal-palette');
  card.dataset.id = p.id;
  card.append(label(p.id, p.name));
  const sw = h('div', 'qf-gal-swatches');
  p.colors.forEach((color, i) => {
    const s = h('div', i === 0 ? 'qf-gal-swatch is-clear' : 'qf-gal-swatch');
    if (i !== 0) s.style.background = color;
    s.title = `${i}: ${color}${i === 0 ? ' (transparent)' : ''}`;
    sw.append(s);
  });
  card.append(sw);
  markInvalid(c, card, p.id, paletteProblems(p));
  return card;
}

// ---------------------------------------------------------------- tiles

function buildTiles(c: Gallery): HTMLElement {
  const sec = sectionShell('tiles');
  const groups = new Map<string, TileDef[]>();
  const tiles = [...c.project.tiles].sort((a, b) => a.id - b.id);
  for (const t of tiles) {
    if (!matches(c.filter, t.id, t.key, t.name, ...t.tags)) continue;
    const g = t.tags[0] ?? 'untagged';
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push(t);
  }
  for (const [group, list] of groups) {
    sec.append(h('h3', undefined, `${group} (${list.length})`));
    const grid = h('div', 'qf-gal-grid');
    for (const t of list) grid.append(tileCell(c, t));
    sec.append(grid);
  }
  if (!groups.size) sec.append(h('p', 'qf-gal-empty', 'No tiles match.'));
  return sec;
}

function tileTooltip(t: TileDef): string {
  const parts = [`${t.name} — ${t.collision}`];
  if (t.solidMask !== undefined && t.solidMask !== 15) parts.push(`mask ${t.solidMask}`);
  if (t.ledgeDir) parts.push(`hop ${t.ledgeDir}`);
  if (t.frames.length > 1) parts.push(`${t.frames.length} frames @ ${t.frameTime ?? DEFAULT_TILE_FRAME_TIME}s`);
  parts.push(`palette ${t.palette}`, `tags ${t.tags.join(', ')}`);
  return parts.join(' · ');
}

function tileCell(c: Gallery, t: TileDef): HTMLElement {
  const cell = h('div', 'qf-gal-item');
  cell.dataset.id = String(t.id);
  cell.title = tileTooltip(t);
  const size = TILE * SCALE;
  const cv = canvas(size, size);
  cell.append(cv.el, label(`${t.id} ${t.key}`));
  markInvalid(c, cell, `${t.id} ${t.key}`, tileProblems(t, (id) => !!c.cache.paletteDef(id)));
  const ctx = cv.ctx;
  if (!ctx) return cell;
  c.cache.drawTileTo(ctx, t.id, 0, 0, SCALE, 0);
  if (t.frames.length > 1) {
    let shown = 0;
    c.animators.push((time) => {
      const f = c.cache.tileFrameAt(t.id, time);
      if (f === shown) return;
      shown = f;
      ctx.clearRect(0, 0, size, size);
      c.cache.drawTileTo(ctx, t.id, 0, 0, SCALE, time);
    });
  }
  return cell;
}

// ---------------------------------------------------------------- terrains

function buildTerrains(c: Gallery): HTMLElement {
  const sec = sectionShell('terrains');
  const grid = h('div', 'qf-gal-grid');
  for (const tr of c.project.terrains) {
    if (matches(c.filter, tr.id, tr.name)) grid.append(terrainCard(c, tr));
  }
  sec.append(grid.childElementCount ? grid : h('p', 'qf-gal-empty', 'No terrains match.'));
  return sec;
}

function inDemo(x: number, y: number): boolean {
  return TERRAIN_DEMO[y]?.[x] === '#';
}

/** Autotile piece for a painted cell, per the Terrain rule in core/types.ts. */
function demoPiece(x: number, y: number): TerrainPiece {
  const n = inDemo(x, y - 1);
  const s = inDemo(x, y + 1);
  const e = inDemo(x + 1, y);
  const w = inDemo(x - 1, y);
  if (!n && !w) return 'nw';
  if (!n && !e) return 'ne';
  if (!s && !w) return 'sw';
  if (!s && !e) return 'se';
  if (!n) return 'n';
  if (!s) return 's';
  if (!e) return 'e';
  if (!w) return 'w';
  if (!inDemo(x + 1, y - 1)) return 'ine';
  if (!inDemo(x - 1, y - 1)) return 'inw';
  if (!inDemo(x + 1, y + 1)) return 'ise';
  if (!inDemo(x - 1, y + 1)) return 'isw';
  return 'center';
}

/** Ground drawn around a terrain demo: dungeon floor for dungeon/cave terrains, grass otherwise. */
function demoGround(c: Gallery, tr: Terrain): number {
  const tags = c.cache.tileDef(tr.center)?.tags ?? [];
  const key = tags.includes('dungeon') || tags.includes('cave') ? 'DFLOOR' : 'GRASS';
  return c.project.tiles.find((t) => t.key === key)?.id ?? 0;
}

function terrainCard(c: Gallery, tr: Terrain): HTMLElement {
  const card = h('div', 'qf-gal-terrain');
  card.dataset.id = tr.id;
  card.append(label(tr.id, `${tr.name} · layer ${tr.layer}`));
  markInvalid(c, card, tr.id, terrainProblems(tr, (id) => !!c.cache.tileDef(id)));
  const cols = TERRAIN_DEMO[0]!.length;
  const rows = TERRAIN_DEMO.length;
  const cell = TILE * STRIP_SCALE;
  const cv = canvas(cols * cell, rows * cell);
  card.append(cv.el);
  const ground = demoGround(c, tr);
  const ctx = cv.ctx;
  const paint = (time: number): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.el.width, cv.el.height);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (ground) c.cache.drawTileTo(ctx, ground, x * cell, y * cell, STRIP_SCALE, time);
        if (inDemo(x, y)) c.cache.drawTileTo(ctx, tr[demoPiece(x, y)], x * cell, y * cell, STRIP_SCALE, time);
      }
    }
  };
  paint(0);
  const used = [ground, ...TERRAIN_PIECES.map((k) => tr[k])];
  if (used.some((id) => (c.cache.tileDef(id)?.frames.length ?? 0) > 1)) {
    const shown = used.map(() => 0);
    c.animators.push((time) => {
      let changed = false;
      used.forEach((id, i) => {
        const f = c.cache.tileFrameAt(id, time);
        if (f !== shown[i]) changed = true;
        shown[i] = f;
      });
      if (changed) paint(time);
    });
  }
  const pieces = h('div', 'qf-gal-pieces');
  for (const k of TERRAIN_PIECES) {
    const item = h('div', 'qf-gal-item');
    item.title = c.cache.tileDef(tr[k])?.key ?? `missing tile ${tr[k]}`;
    const pc = canvas(cell, cell);
    if (pc.ctx) c.cache.drawTileTo(pc.ctx, tr[k], 0, 0, STRIP_SCALE, 0);
    item.append(pc.el, label(k));
    pieces.append(item);
  }
  card.append(pieces);
  return card;
}

// ---------------------------------------------------------------- sprites

function buildSprites(c: Gallery): HTMLElement {
  const sec = sectionShell('sprites');
  let any = false;
  for (const s of c.project.sprites) {
    if (!matches(c.filter, s.id, s.name, ...s.tags)) continue;
    sec.append(spriteBlock(c, s));
    any = true;
  }
  if (!any) sec.append(h('p', 'qf-gal-empty', 'No sprites match.'));
  return sec;
}

function spriteBlock(c: Gallery, s: SpriteDef): HTMLElement {
  const block = h('div', 'qf-gal-sprite');
  block.dataset.id = s.id;
  const title = h('h3', undefined, s.id);
  title.append(h('small', undefined,
    `${s.name} · ${s.w}×${s.h} · origin ${s.ox},${s.oy} · ${s.palette} · ${s.frames.length} frames`));
  block.append(title);
  const problems = spriteProblems(s, (id) => !!c.cache.paletteDef(id));
  markInvalid(c, title, s.id, problems);
  if (!(s.w > 0 && s.h > 0)) return block;
  const grid = h('div', 'qf-gal-grid');
  const span = previewSpan(s);
  for (const [name, anim] of Object.entries(s.anims)) grid.append(animCell(c, s, span, name, anim));
  const swaps = swapCell(c, s);
  if (swaps) grid.append(swaps);
  block.append(grid);
  return block;
}

/** First frame drawn with the base palette and each catalog swap palette (checks index layouts line up). */
function swapCell(c: Gallery, s: SpriteDef): HTMLElement | null {
  const swaps = spriteSpec(s.id)?.swaps ?? [];
  if (!swaps.length || !s.frames.length) return null;
  const cell = h('div', 'qf-gal-item qf-gal-swaps');
  cell.title = `palette swaps: ${swaps.join(', ')}`;
  const row = h('div', 'qf-gal-anim-row');
  for (const pal of [s.palette, ...swaps]) {
    const cv = canvas(s.w * SCALE, s.h * SCALE);
    cv.el.title = c.cache.paletteDef(pal) ? pal : `${pal} (missing: drawn with ${s.palette})`;
    if (cv.ctx) c.cache.drawSpriteTo(cv.ctx, s.id, 0, 0, 0, SCALE, { palette: pal });
    row.append(cv.el);
  }
  cell.append(row, label('palette swaps', swaps.join(' ')));
  const missing = swaps.filter((pal) => !c.cache.paletteDef(pal));
  markInvalid(c, cell, `${s.id} swaps`, missing.map((pal) => `swap palette "${pal}" not found`));
  return cell;
}

/**
 * Anim previews place the sprite origin at one column (`anchor`) like the game
 * does, so plain and flipX anims (mirrored about the origin) line up; the
 * canvas is wide enough for every flip the sprite's anims use.
 */
function previewSpan(s: SpriteDef): Span {
  const flips = new Set(Object.values(s.anims).map((a) => !!a.flipX));
  let left = 0;
  let right = 0;
  for (const flip of flips.size ? flips : [false]) {
    const l = originOffsetX(s.w, s.ox, flip);
    left = Math.max(left, l);
    right = Math.max(right, s.w - l);
  }
  return { anchor: left, width: Math.ceil(left + right) };
}

/** Draw anim frame f with its origin at the span anchor; frames missing from the sprite fill magenta. */
function drawAnimFrame(
  c: Gallery, ctx: CanvasRenderingContext2D, s: SpriteDef, span: Span, f: number, scale: number, flipX: boolean,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!c.cache.sprite(s.id, f)) {
    ctx.fillStyle = MISSING_FILL;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }
  c.cache.drawSpriteAt(ctx, s.id, f, span.anchor * scale, s.oy * scale, scale, { flipX });
}

function animCell(c: Gallery, s: SpriteDef, span: Span, name: string, anim: SpriteAnim): HTMLElement {
  const cell = h('div', 'qf-gal-item');
  cell.dataset.anim = name;
  cell.title = `${anim.fps} fps · ${anim.loop ? 'loop' : 'once'}${anim.flipX ? ' · mirrored' : ''} · frames [${anim.frames.join(', ')}]`;
  const row = h('div', 'qf-gal-anim-row');
  const cv = canvas(span.width * SCALE, s.h * SCALE);
  row.append(cv.el);
  const n = anim.frames.length;
  if (n > 1) row.append(frameStrip(c, s, span, anim));
  cell.append(row, label(`${name} (${n} frame${n === 1 ? '' : 's'})`, anim.flipX ? 'flipX' : undefined));
  markInvalid(c, cell, `${s.id} ${name}`, animProblems(s, anim));
  const ctx = cv.ctx;
  if (!ctx || n === 0) return cell;
  const flipX = !!anim.flipX;
  let shown = -2;
  const draw: Animator = (time) => {
    const period = n / anim.fps + REPLAY_PAUSE;
    const t = anim.loop || !(anim.fps > 0) ? time : time % period;
    const f = c.cache.animFrame(s.id, name, t);
    if (f === shown) return;
    shown = f;
    drawAnimFrame(c, ctx, s, span, f, SCALE, flipX);
  };
  draw(0);
  if (n > 1) c.animators.push(draw);
  return cell;
}

/** Every frame of an anim side by side (static), so screenshots show the whole cycle. */
function frameStrip(c: Gallery, s: SpriteDef, span: Span, anim: SpriteAnim): HTMLElement {
  const strip = h('div', 'qf-gal-frames');
  for (const f of anim.frames) {
    const cv = canvas(span.width * STRIP_SCALE, s.h * STRIP_SCALE);
    cv.el.title = `frame ${f}`;
    if (cv.ctx) drawAnimFrame(c, cv.ctx, s, span, f, STRIP_SCALE, !!anim.flipX);
    strip.append(cv.el);
  }
  return strip;
}

// ---------------------------------------------------------------- mount

const BUILDERS: Readonly<Record<Section, (c: Gallery) => HTMLElement>> = {
  palettes: buildPalettes, tiles: buildTiles, terrains: buildTerrains, sprites: buildSprites,
};

/** Build one section with its issue list under the heading. */
function buildSection(c: Gallery, s: Section): HTMLElement {
  c.issues = [];
  const sec = BUILDERS[s](c);
  const issues = issueList(c.issues);
  if (issues) sec.firstElementChild?.after(issues);
  return sec;
}

/** Mount the gallery into root; returns an unmount function. Supports ?section=tiles|sprites|palettes|terrains and &filter= via the hash query. */
export function mountGallery(root: HTMLElement, project: Project): () => void {
  const query = readQuery();
  const c: Gallery = { project, cache: new AssetCache(project), filter: query.filter, animators: [], issues: [] };
  const page = h('div', 'qf-gal');
  page.append(buildHeader(project, query));
  for (const s of query.section ? [query.section] : SECTIONS) page.append(buildSection(c, s));
  root.append(page);

  const start = performance.now();
  let raf = 0;
  const tick = (now: number): void => {
    const t = (now - start) / 1000;
    for (const a of c.animators) a(t);
    raf = requestAnimationFrame(tick);
  };
  if (c.animators.length) raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    page.remove();
  };
}
