// HUD icons (8x8, origin top-left) and editor-only marker glyphs (16x16).
import type { SpriteDef } from '../../core/types';
import { PixelGrid } from './pixelgrid';
import { centred, pix, SpriteBuilder, type Legend } from './core-draw';
import { PAL } from './core-palettes';

/** pal.c.hud layout. */
const HD = { o: 1, W: 2, R: 3, r: 4, p: 5, E: 6, G: 7, g: 8, B: 9, b: 10, Y: 11, y: 12, n: 13, s: 14, S: 15 } as const satisfies Legend;
/** pal.c.editor layout. */
const ED = { o: 1, W: 2, M: 3, m: 4, C: 5, c: 6, Y: 7, y: 8, R: 9, G: 10, n: 11, s: 12, P: 13 } as const satisfies Legend;

// ============================================================================
// HUD
// ============================================================================

const HEART_FULL = pix([
  '.oo.oo..',
  'oWrorRo.',
  'orrrrRo.',
  'orrrrRo.',
  '.orrRo..',
  '..oRo...',
  '...o....',
  '........',
], HD);

const HEART_HALF = pix([
  '.oo.oo..',
  'oWrosSo.',
  'orrrESo.',
  'orrrESo.',
  '.orrSo..',
  '..oRo...',
  '...o....',
  '........',
], HD);

/** Empty slot: a pale grey rim inside the dark outline keeps it countable on light and dark bars alike. */
const HEART_EMPTY = pix([
  '.oo.oo..',
  'ossosSo.',
  'osEEESo.',
  'osEEESo.',
  '.oSESo..',
  '..oSo...',
  '...o....',
  '........',
], HD);

const RUPEE = pix([
  '...oo...',
  '..ogGo..',
  '.oggGGo.',
  '.oWgGGo.',
  '.oggGGo.',
  '.oggGGo.',
  '..ogGo..',
  '...oo...',
], HD);

const BOMB = pix([
  '.....oyo',
  '....ono.',
  '..oosoo.',
  '.obbbBBo',
  'obWbbbBo',
  'obbbbBBo',
  '.obBBBo.',
  '..oooo..',
], HD);

const ARROW = new PixelGrid(8, 8).blit(pix([
  '....sWW',
  '.....Ws',
  '....n.s',
  '...n...',
  '.rn....',
  '.rr....',
], HD), 0, 1).outline(HD.o);

const KEY = pix([
  '.ooo....',
  'oyyYo...',
  'oyoYooo.',
  'oyYYyyYo',
  '.oooyoYo',
  '....o.oo',
  '........',
  '........',
], HD);

export function buildHud(): SpriteDef {
  return new SpriteBuilder('hud', PAL.hud)
    .anim('heart_full', [HEART_FULL]).anim('heart_half', [HEART_HALF]).anim('heart_empty', [HEART_EMPTY])
    .anim('rupee', [RUPEE]).anim('bomb', [BOMB]).anim('arrow', [ARROW]).anim('key', [KEY])
    .build();
}

// ============================================================================
// Editor markers
// ============================================================================

/** Warp: a two-tone spiral on a dark disc. */
function warpIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.circle(7.5, 7.5, 7, ED.m);
  for (let t = 0; t < 4.2 * Math.PI; t += 0.05) {
    const r = 0.6 + t * 0.5;
    const x = 7.5 + Math.cos(t) * r;
    const y = 7.5 + Math.sin(t) * r;
    if (r < 6.6) g.set(Math.floor(x), Math.floor(y), t < 2 * Math.PI ? ED.W : ED.C);
  }
  return g.outline(ED.o);
}

/** Region: a bold dashed square. */
function regionIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  for (let i = 1; i < 15; i++) {
    const on = ((i - 1) >> 1) % 2 === 0;
    if (!on) continue;
    g.set(i, 1, ED.Y).set(i, 2, ED.y).set(i, 13, ED.Y).set(i, 14, ED.y);
    g.set(1, i, ED.Y).set(2, i, ED.y).set(13, i, ED.Y).set(14, i, ED.y);
  }
  return g.outline(ED.o);
}

const FLAG = pix([
  'sGGGGGG...',
  'sGWGGGGGG.',
  'sGGGGGGGGG',
  'sGGGGGGGG.',
  'sGGGGGG...',
  's.........',
  's.........',
  's.........',
  's.........',
  's.........',
  'snn.......',
  'nnnn......',
], ED);

const QUESTION = pix([
  '.WWWW.',
  'WWsWWW',
  'WW..WW',
  '...WWW',
  '..WWW.',
  '..WW..',
  '......',
  '..WW..',
  '..WW..',
], ED);

function unknownIcon(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.circle(7.5, 7.5, 7, ED.M);
  g.blit(new PixelGrid(6, 9).blit(QUESTION, 0, 0).outline(ED.m), 5, 3);
  g.blit(QUESTION, 5, 3);
  return g.outline(ED.o);
}

export function buildEditorIcons(): SpriteDef {
  return new SpriteBuilder('editor.icons', PAL.editor)
    .anim('warp', [warpIcon()])
    .anim('region', [regionIcon()])
    .anim('start', [centred(FLAG, 16, 16, 1, 0).outline(ED.o)])
    .anim('unknown', [unknownIcon()])
    .build();
}
