// In-game HUD overlay, ALttP style (no background box, dark-outlined): magic
// meter, equipped-item box with ammo, gem / bomb / arrow / small-key counters
// and the - HEARTS - meter (10 per row, 2 rows). Counters roll toward their real
// values like a classic money count; hearts refill gradually and pulse at low
// health. OWNER: triggers+UI agent.
import type { SaveData } from '../../core/types';
import type { GameServices, Renderer } from '../api';
import { MAX_RUPEES } from '../../core/constants';
import { CENTER, RIGHT, SCREEN, UI, drawHearts, drawItem, outlineText, padNumber } from './theme';

/** Low health (half-hearts): hearts pulse, matching the engine's warning beep. */
export const LOW_HEALTH = 2;
/** Longest frame gap (s) the counters advance by (tab switches, hitches). */
const MAX_FRAME_DT = 0.1;

const RUPEE_RATE = 40;
const AMMO_RATE = 20;
const MAGIC_RATE = 32;
const HEART_FILL_RATE = 10;

/**
 * Move a displayed value toward `target`: at least `minRate` units/s, faster for
 * big gaps (the gap closes in well under a second), never overshooting.
 */
export function rollToward(shown: number, target: number, dt: number, minRate: number): number {
  const gap = target - shown;
  if (gap === 0 || !(dt > 0)) return gap === 0 ? target : shown;
  const step = Math.max(minRate, Math.abs(gap) * 2.5) * dt;
  return Math.abs(gap) <= step ? target : shown + Math.sign(gap) * step;
}

/** Displayed (rolling) values of one save's counters. */
export class HudCounters {
  rupees: number;
  bombs: number;
  arrows: number;
  magic: number;
  hp: number;
  private last: number | null = null;

  constructor(save: SaveData) {
    this.rupees = save.rupees;
    this.bombs = save.bombs;
    this.arrows = save.arrows;
    this.magic = save.magic;
    this.hp = save.hp;
  }

  /** Advance toward the save's values; `now` is a clock in seconds (the renderer's). */
  update(save: SaveData, now: number): void {
    const dt = this.last === null || !Number.isFinite(now) ? 0 : Math.min(MAX_FRAME_DT, Math.max(0, now - this.last));
    this.last = Number.isFinite(now) ? now : this.last;
    this.rupees = rollToward(this.rupees, save.rupees, dt, RUPEE_RATE);
    this.bombs = rollToward(this.bombs, save.bombs, dt, AMMO_RATE);
    this.arrows = rollToward(this.arrows, save.arrows, dt, AMMO_RATE);
    this.magic = rollToward(this.magic, save.magic, dt, MAGIC_RATE);
    // Damage shows at once; healing fills heart by heart.
    this.hp = save.hp < this.hp ? save.hp : rollToward(this.hp, save.hp, dt, HEART_FILL_RATE);
  }
}

const counters = new WeakMap<SaveData, HudCounters>();

/** The rolling counters for a save (created on first use, starting at the real values). */
export function hudCounters(save: SaveData): HudCounters {
  let c = counters.get(save);
  if (!c) {
    c = new HudCounters(save);
    counters.set(save, c);
  }
  return c;
}

/** Screen layout (px). */
const MAGIC = { x: 10, y: 9, w: 10, h: 34 } as const;
const ITEM_BOX = { x: 24, y: 11, size: 24 } as const;
const COUNTER_X = 56;
const COUNTER_ICON_Y = 11;
const COUNTER_DIGIT_Y = 21;
const LIFE = { cx: 204, labelY: 9, x: 164, y: 20 } as const;
const ITEM_FILL = { screen: true, alpha: 0.75 } as const;
const PULSE = { flashFilled: true } as const;
const STEADY = { flashFilled: false } as const;

/** Draw the HUD for the current save (screen space); advances the rolling counters by the renderer clock. */
export function drawHud(r: Renderer, g: GameServices): void {
  const save = g.save;
  const shown = hudCounters(save);
  shown.update(save, r.time);
  drawMagic(r, Math.round(shown.magic), save.maxMagic);
  drawItemBox(r, save);
  drawCounters(r, g, shown);
  drawLife(r, Math.round(shown.hp), save.maxHp);
}

function drawMagic(r: Renderer, magic: number, maxMagic: number): void {
  const { x, y, w, h } = MAGIC;
  const o = SCREEN;
  r.fillRect(x, y, w, h, UI.outline, o);
  r.strokeRect(x + 1, y + 1, w - 2, h - 2, UI.light, o);
  r.fillRect(x + 2, y + 2, w - 4, h - 4, '#101010', o);
  const inner = h - 4;
  const fill = maxMagic > 0 ? Math.round((inner * Math.min(magic, maxMagic)) / maxMagic) : 0;
  if (fill <= 0) return;
  const top = y + 2 + inner - fill;
  r.fillRect(x + 2, top, w - 4, fill, UI.green, o);
  r.fillRect(x + 2, top, 2, fill, '#b0f8a8', o);
  r.fillRect(x + w - 3, top, 1, fill, UI.greenDark, o);
  r.fillRect(x + 2, top, w - 4, 1, '#d8f8d0', o);
}

function drawItemBox(r: Renderer, save: SaveData): void {
  const { x, y, size } = ITEM_BOX;
  const o = SCREEN;
  r.fillRect(x + 1, y, size - 2, size, UI.outline, o);
  r.fillRect(x, y + 1, size, size - 2, UI.outline, o);
  r.strokeRect(x + 1, y + 1, size - 2, size - 2, UI.light, o);
  r.strokeRect(x + 2, y + 2, size - 4, size - 4, UI.mid, o);
  r.fillRect(x + 3, y + 3, size - 6, size - 6, UI.fillDeep, ITEM_FILL);
  const item = save.equipped;
  if (!item) return;
  drawItem(r, save, item, x + size / 2, y + size / 2);
  const ammo = item === 'bow' ? save.arrows : item === 'bombs' ? save.bombs : null;
  if (ammo !== null) outlineText(r, String(ammo), x + size + 1, y + size - 7, ammo > 0 ? UI.text : UI.red, RIGHT);
}

/** Gems, then bombs and arrows once owned, then small keys in dungeons (left to right). */
function drawCounters(r: Renderer, g: GameServices, shown: HudCounters): void {
  const save = g.save;
  let x = drawCounter(r, COUNTER_X, 'rupee', shown.rupees, 3, MAX_RUPEES);
  if ((save.items.bombs ?? 0) > 0 || save.bombs > 0) x = drawCounter(r, x, 'bomb', shown.bombs, 2, save.maxBombs);
  if ((save.items.bow ?? 0) > 0 || save.arrows > 0) x = drawCounter(r, x, 'arrow', shown.arrows, 2, save.maxArrows);
  const dungeon = g.dungeon;
  if (dungeon) drawCounter(r, x, 'key', dungeon.keys, 1, Infinity);
}

/**
 * One counter at x: hud icon over the zero-padded (displayed) value, green once
 * the displayed value has reached `max`. Returns the x of the next counter.
 */
function drawCounter(r: Renderer, x: number, icon: string, value: number, digits: number, max: number): number {
  const n = Math.round(value);
  const text = padNumber(n, digits);
  const w = r.measureText(text);
  r.drawSpriteAnim('hud', icon, 0, x + Math.floor((w - 8) / 2), COUNTER_ICON_Y, SCREEN);
  outlineText(r, text, x, COUNTER_DIGIT_Y, n >= max ? UI.green : UI.text);
  return x + w + 8;
}

function drawLife(r: Renderer, hp: number, maxHp: number): void {
  outlineText(r, '- HEARTS -', LIFE.cx, LIFE.labelY, UI.text, CENTER);
  const low = hp > 0 && hp <= LOW_HEALTH;
  const pulse = low && Math.floor(r.time * 4) % 2 === 0;
  drawHearts(r, LIFE.x, LIFE.y, hp, maxHp, pulse ? PULSE : STEADY);
}
