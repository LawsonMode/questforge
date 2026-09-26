// Sword blade contact: what a swing, spin, charged poke or dash thrust does to
// the entities and tiles under the blade hitbox. Enemies and reactive objects
// are struck (knocked away from the hero), pickups are taken, solid things are
// reported so the caller can tink, cuttable tiles are cut.
import type { Rect } from '../../core/math';
import type { DamageKind, GameServices } from '../api';
import type { Entity } from '../entity';
import { DIR_VEC } from '../../core/math';
import { hitFrom, strike, strikeRole, touching } from '../projectiles/targets';
import { cutTilesIn } from '../projectiles/tiles';

/** Knockback (px) of a sword hit. */
export const SWORD_KNOCKBACK = 16;

export interface BladeBlow {
  kind: DamageKind;
  damage: number;
  /** Cut cuttable tiles under the blade. */
  cut: boolean;
  /**
   * How `struck` is kept: 'swing' = each entity once for the whole move (the set is
   * cleared when the move starts); 'contact' = once per touch (entities that left the
   * blade are forgotten, so a held blade strikes again when they come back).
   */
  memory: 'swing' | 'contact';
}

export interface BladeContact {
  /** Strikes that landed. */
  hits: number;
  /** Touched something solid that shrugged the blade off (tink). */
  solid: boolean;
  /** Tiles cut. */
  cut: number;
}

const contact: BladeContact = { hits: 0, solid: false, cut: 0 };

/** Whether `uid` is one of `list`'s entities. */
function listed(list: readonly Entity[], uid: number): boolean {
  for (const e of list) if (e.uid === uid) return true;
  return false;
}

/**
 * An enemy still blinking from an earlier hit refuses the blade only for now:
 * it is not remembered, so the same move lands once its i-frames run out.
 * Lasting refusals (immune, guarding) stay remembered and are refused once.
 */
function refusedForNow(e: Entity): boolean {
  return e.invuln > 0 && Number.isFinite(e.invuln);
}

/**
 * Apply the blade hitbox `rect` of `hero` to the room (see file header). The
 * result is shared: read it before the next call.
 */
export function bladeContact(
  game: GameServices, hero: Entity, rect: Rect, blow: BladeBlow, struck: Set<number>,
): BladeContact {
  contact.hits = 0;
  contact.solid = false;
  contact.cut = 0;
  const touched = touching(game, rect, hero.x, hero.y, hero);
  if (blow.memory === 'contact') for (const uid of struck) if (!listed(touched, uid)) struck.delete(uid);
  for (const e of touched) {
    if (struck.has(e.uid)) continue;
    const role = strikeRole(e);
    if (role === 'ignore') continue;
    struck.add(e.uid);
    if (role === 'collect') {
      e.collect?.();
      continue;
    }
    const base = { damage: blow.damage, kind: blow.kind, source: hero, knockback: SWORD_KNOCKBACK };
    const res = strike(e, hitFrom(e, hero.x, hero.y, base, DIR_VEC[hero.facing]));
    if (res === 'hit') contact.hits++;
    else if (res === 'solid') contact.solid = true;
    else if (res === 'deflected' && refusedForNow(e)) struck.delete(e.uid);
  }
  if (blow.cut) contact.cut = cutTilesIn(game, rect);
  return contact;
}
