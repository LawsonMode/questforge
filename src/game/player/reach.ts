// What is "in front of" the hero: probe rects and the entity / tile the action
// button would talk to, open or lift.
import type { LayerName, TileDef } from '../../core/types';
import type { Rect } from '../../core/math';
import type { GameServices } from '../api';
import type { Entity } from '../entity';
import { DIR_VEC } from '../../core/math';
import { TILE } from '../../core/constants';
import { Carried } from '../projectiles/carried';
import type { Cell } from '../projectiles/tiles';

/** How far (px) past the hero's edge the action button reaches. */
export const ACTION_REACH = 6;
/** Liftable entities higher than this (px) are out of reach. */
const MAX_LIFT_Z = 4;

/** Rect from the hero's centre to `reach` px past its facing edge, `inset` px narrower per side. */
export function reachRect(e: Entity, reach: number, inset = 2): Rect {
  switch (e.facing) {
    case 'up': return { x: e.left + inset, y: e.top - reach, w: e.w - 2 * inset, h: e.h / 2 + reach };
    case 'down': return { x: e.left + inset, y: e.y, w: e.w - 2 * inset, h: e.h / 2 + reach };
    case 'left': return { x: e.left - reach, y: e.top + inset, w: e.w / 2 + reach, h: e.h - 2 * inset };
    case 'right': return { x: e.x, y: e.top + inset, w: e.w / 2 + reach, h: e.h - 2 * inset };
  }
}

/** Strip `depth` px deep just past the hero's facing edge, `inset` px narrower per side. */
export function edgeStrip(e: Entity, depth: number, inset = 1): Rect {
  switch (e.facing) {
    case 'up': return { x: e.left + inset, y: e.top - depth, w: e.w - 2 * inset, h: depth };
    case 'down': return { x: e.left + inset, y: e.bottom, w: e.w - 2 * inset, h: depth };
    case 'left': return { x: e.left - depth, y: e.top + inset, w: depth, h: e.h - 2 * inset };
    case 'right': return { x: e.right, y: e.top + inset, w: depth, h: e.h - 2 * inset };
  }
}

/** The tile cell `dist` px past the hero's facing edge, on its centre line. */
export function frontCell(e: Entity, dist = 4): Cell {
  const f = DIR_VEC[e.facing];
  const px = e.x + f.x * (e.w / 2 + dist);
  const py = e.y + f.y * (e.h / 2 + dist);
  return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
}

/** Entities in reach of the action button, nearest first. */
function inReach(game: GameServices, hero: Entity, keep: (e: Entity) => boolean): Entity[] {
  const found = game.entitiesIn(reachRect(hero, ACTION_REACH), (e) => e !== hero && keep(e));
  return found.sort((a, b) => hero.distTo(a) - hero.distTo(b));
}

/** The entity in front that reacts to the action button (sign, NPC, chest, shop item...). */
export function interactTarget(game: GameServices, hero: Entity): Entity | null {
  return inReach(game, hero, (e) => typeof e.onInteract === 'function')[0] ?? null;
}

/** Whether `e` can be picked up with glove level `glove` (a bomb only while it rests on the ground). */
export function canLiftEntity(e: Entity, glove: number): boolean {
  if (e.liftWeight === null || e.liftWeight > glove || e.z > MAX_LIFT_Z) return false;
  return !(e instanceof Carried) || (!e.isHeld && !e.isFlying);
}

/** The liftable entity in front (pot, sign, bomb...), if the glove allows. */
export function liftableEntity(game: GameServices, hero: Entity, glove: number): Entity | null {
  return inReach(game, hero, (e) => canLiftEntity(e, glove))[0] ?? null;
}

export interface LiftableTile {
  cell: Cell;
  layer: LayerName;
  def: TileDef;
}

/** The liftable tile in front (bush, rock, tile pot), if the glove allows. */
export function liftableTile(game: GameServices, hero: Entity, glove: number): LiftableTile | null {
  const cell = frontCell(hero);
  const hit = game.room.interactiveTile(cell.tx, cell.ty);
  if (!hit?.def.lift || hit.def.lift.weight > glove) return null;
  return { cell, layer: hit.layer, def: hit.def };
}
