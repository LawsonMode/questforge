// Pure boss combat helpers (unit-tested): where a hit came from, whether a
// facing shield covers it, how each boss part treats a hit, steady facing
// toward a moving target, and how much two boxes overlap. OWNER: bosses agent.
import type { Dir } from '../../../core/types';
import type { DamageKind, Hit } from '../../api';
import { DIR_VEC, normalize, vecToDir, type Rect, type Vec } from '../../../core/math';

/** How a boss part reacts to a hit: hurt, a shield block (tink + recoil), a tink, or nothing. */
export type Verdict = 'damage' | 'blocked' | 'tink' | 'ignore';

/** The giant worm's parts. */
export type WormPartKind = 'head' | 'body' | 'tail';

/**
 * Cosine of the shield's half-angle of cover (about 57 degrees either side of
 * the facing). Wider than the 53 degrees facingToward() can lag behind a target,
 * so a knight that keeps turning toward the hero always covers them.
 */
export const FRONT_COS = 0.55;

/**
 * Hits judged by where their source is (the swinging hero, a blast, a flame, a
 * thrown pot): their dx/dy only says how the struck part is pushed. Arrows,
 * the boomerang and the hookshot are judged by their flight.
 */
const BY_SOURCE: ReadonlySet<DamageKind> = new Set(['sword', 'spin', 'bomb', 'fire', 'thrown']);

/** Weapons that spark and clink by themselves when an enemy refuses them. */
const SELF_CLINKING: ReadonlySet<DamageKind> = new Set(['arrow', 'boomerang', 'hookshot']);

/**
 * Whether the boss must give the immune-hit feedback (spark + tink) itself:
 * for every weapon except the arrow, boomerang and hookshot, which clink on
 * their own. Blades, bomb blasts, thrown objects and fire would otherwise
 * glance off a shield or armour without a sign.
 */
export function bossTinks(kind: DamageKind): boolean {
  return !SELF_CLINKING.has(kind);
}

/** Damage that never comes from the hero's weapons (enemy shots and beams, hazards): bosses ignore it without feedback. */
const NOT_A_WEAPON: ReadonlySet<DamageKind> = new Set(['contact', 'projectile', 'beam', 'spikes', 'fall']);

/** The only weapons that hurt the worm's tail (everything else tinks). */
const TAIL_WEAPONS: ReadonlySet<DamageKind> = new Set(['sword', 'spin', 'arrow']);

/** Weapons that can hurt the knight; the rest glance off its armour. */
const KNIGHT_WEAPONS: ReadonlySet<DamageKind> = new Set(['sword', 'spin', 'arrow', 'bomb', 'thrown']);

/**
 * Unit vector from the target at (tx, ty) toward where `hit` came from. Blades,
 * blasts, flames and thrown objects use their source's position (so every part
 * of a boss judges one blow alike); projectiles the reverse of their flight
 * (hit.dx/dy points the way the target is pushed). Zero if unknown.
 */
export function attackVector(hit: Hit, tx: number, ty: number): Vec {
  const src = hit.source;
  if (src && BY_SOURCE.has(hit.kind)) {
    const v = normalize(src.x - tx, src.y - ty);
    if (v.x !== 0 || v.y !== 0) return v;
  }
  if (hit.dx !== 0 || hit.dy !== 0) return normalize(-hit.dx, -hit.dy);
  return src ? normalize(src.x - tx, src.y - ty) : { x: 0, y: 0 };
}

/** Whether an attack arriving from direction `from` (unit vector, target -> attacker) hits the `facing` side. */
export function isFrontal(facing: Dir, from: Vec): boolean {
  const f = DIR_VEC[facing];
  return f.x * from.x + f.y * from.y > FRONT_COS;
}

/** Worm: only the tail takes damage, and only from blades and arrows; every other weapon tinks. */
export function wormVerdict(part: WormPartKind, hit: Hit): Verdict {
  if (NOT_A_WEAPON.has(hit.kind)) return 'ignore';
  return part === 'tail' && hit.damage > 0 && TAIL_WEAPONS.has(hit.kind) ? 'damage' : 'tink';
}

/**
 * Knight at (x, y) facing `facing`: a stunned knight takes damage from any side;
 * otherwise its shield blocks hits from the front and the rest land. Weapons
 * that can't hurt it (boomerang, hookshot, fire...) tink.
 */
export function knightVerdict(facing: Dir, stunned: boolean, hit: Hit, x: number, y: number): Verdict {
  if (NOT_A_WEAPON.has(hit.kind)) return 'ignore';
  if (hit.damage <= 0 || !KNIGHT_WEAPONS.has(hit.kind)) return 'tink';
  if (stunned) return 'damage';
  return isFrontal(facing, attackVector(hit, x, y)) ? 'blocked' : 'damage';
}

/**
 * Facing toward (dx, dy) with hysteresis: the current facing is kept while the
 * offset along it is at least `keep` times the dominant component, so a target
 * near a diagonal does not make the facing flicker.
 */
export function facingToward(current: Dir, dx: number, dy: number, keep = 0.75): Dir {
  if (dx === 0 && dy === 0) return current;
  const f = DIR_VEC[current];
  const along = f.x * dx + f.y * dy;
  const dominant = Math.max(Math.abs(dx), Math.abs(dy));
  return along >= dominant * keep ? current : vecToDir(dx, dy, current);
}

/** Area (px^2) shared by two rects (0 when they do not overlap). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
