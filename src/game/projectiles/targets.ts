// How the hero's attacks (sword, arrows, boomerang, hookshot, bombs, thrown
// objects, lantern flame) treat the entities they touch. One rule set for all:
//   the hero, its own projectiles, dead things -> 'ignore'
//   enemies (team 'enemy')                     -> 'enemy'    hurt(); stops projectiles either way
//   pickups (collect hook)                     -> 'collect'  fetched by boomerang/hookshot, taken by the sword
//   objects that override hurt()               -> 'reactive' hurt() (crystal switches, bombable doors...);
//                                                 a refusal from a solid one acts like a wall
//   other solid entities                       -> 'solid'    walls: the sword tinks, projectiles stop
//   everything else (effects, markers)         -> 'ignore'
// Non-enemies that keep the base Entity.hurt are never hurt by the hero: the
// default would subtract hp and remove signs, NPCs or chests.
// Attacks test an entity's BODY: its footprint extended up over the part of its
// sprite drawn above it (a soldier's torso and helmet), so a blade that visibly
// stabs into a sprite also hits it, whichever way the hero faces.
import type { Project } from '../../core/types';
import type { Rect } from '../../core/math';
import { clamp, normalize, rectsOverlap } from '../../core/math';
import type { GameServices, Hit } from '../api';
import { Entity, findSprite } from '../entity';

export type StrikeRole = 'enemy' | 'collect' | 'reactive' | 'solid' | 'ignore';
/** What a strike did: landed, refused by an enemy (invulnerable / i-frames), stopped like a wall, or nothing. */
export type StrikeResult = 'hit' | 'deflected' | 'solid' | 'pass';

/** Transparent rows assumed at the top of a sprite frame (px): they are not body. */
const HEADROOM = 3;
/** Most a body reaches above its footprint (px, before height off the ground). */
const MAX_RISE = 16;

/** Whether the entity's class replaces Entity.hurt (it wants to react to attacks). */
function hurtOverridden(e: Entity): boolean {
  return e.hurt !== Entity.prototype.hurt;
}

/** What a hero attack does to `e` (see file header). */
export function strikeRole(e: Entity): StrikeRole {
  if (e.dead || e.team === 'player') return 'ignore';
  if (e.team === 'enemy') return 'enemy';
  if (e.collect) return 'collect';
  if (hurtOverridden(e)) return 'reactive';
  return e.solid ? 'solid' : 'ignore';
}

/** Apply a hero hit to `e` following the role rules. Pickups and ignored entities pass. */
export function strike(e: Entity, hit: Hit): StrikeResult {
  switch (strikeRole(e)) {
    case 'enemy':
      return e.hurt(hit) ? 'hit' : 'deflected';
    case 'reactive':
      if (e.hurt(hit)) return 'hit';
      return e.solid ? 'solid' : 'pass';
    case 'solid':
      return 'solid';
    default:
      return 'pass';
  }
}

/**
 * How far (px) `e`'s drawn body rises above its footprint's top edge: up to its
 * sprite's top (less HEADROOM, at most MAX_RISE), plus its height off the ground.
 */
export function bodyRise(project: Project, e: Entity): number {
  const def = e.sprite ? findSprite(project, e.sprite) : undefined;
  const art = def ? clamp(def.oy - e.h / 2 - HEADROOM, 0, MAX_RISE) : 0;
  return art + Math.max(0, e.z);
}

/** Where the hero's attacks can hit `e` (into `out`): its footprint extended up by bodyRise. */
export function bodyRect(project: Project, e: Entity, out: Rect): Rect {
  const rise = bodyRise(project, e);
  out.x = e.x - e.w / 2;
  out.y = e.y - e.h / 2 - rise;
  out.w = e.w;
  out.h = e.h + rise;
  return out;
}

const touchBuf: Entity[] = [];
const bodyBuf: Rect = { x: 0, y: 0, w: 0, h: 0 };
let nearX = 0;
let nearY = 0;

function nearerFirst(a: Entity, b: Entity): number {
  return (a.x - nearX) ** 2 + (a.y - nearY) ** 2 - ((b.x - nearX) ** 2 + (b.y - nearY) ** 2);
}

/**
 * Live entities other than `self` whose body (bodyRect) overlaps `rect`, nearest
 * to (fromX, fromY) first. The list is shared: read it before calling again.
 */
export function touching(game: GameServices, rect: Rect, fromX: number, fromY: number, self?: Entity): readonly Entity[] {
  touchBuf.length = 0;
  for (const e of game.entities) {
    if (e !== self && !e.dead && rectsOverlap(bodyRect(game.project, e, bodyBuf), rect)) touchBuf.push(e);
  }
  if (touchBuf.length > 1) {
    nearX = fromX;
    nearY = fromY;
    touchBuf.sort(nearerFirst);
  }
  return touchBuf;
}

/** A hit on `e` from a hero attack at (fromX, fromY), knocking it away from there (or along `dir` when on top of it). */
export function hitFrom(
  e: Entity, fromX: number, fromY: number, base: Omit<Hit, 'dx' | 'dy'>, dir: { x: number; y: number },
): Hit {
  const away = normalize(e.x - fromX, e.y - fromY);
  const v = away.x !== 0 || away.y !== 0 ? away : normalize(dir.x, dir.y);
  return { ...base, dx: v.x, dy: v.y };
}

/** Whether a circle touches a rect (bomb blasts). */
export function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 <= r * r;
}
