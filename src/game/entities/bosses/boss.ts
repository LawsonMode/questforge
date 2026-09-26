// Shared boss base on top of the enemy toolkit (Enemy): the room-entry intro,
// hit judging (damage / shield block / tink), damage feedback, room-bounds
// clamping, keeping out of doorways, never getting trapped by a solid that
// closes on it, and the scripted death — timed explosion bursts, a heart
// container, then the default Entity.die() (persistDefeat flag + 'defeated'
// event). The gamepad taps on a weak-point hit and rumbles hard at the finale.
// OWNER: bosses agent.
import type { EntityInstance } from '../../../core/types';
import type { GameServices, Hit } from '../../api';
import type { Entity } from '../../entity';
import { Enemy, SPAWN_DELAY } from '../enemies/common';
import { createEntity } from '../../registry';
import { findFreeSpot } from '../../spot';
import { entityInfo } from '../../../core/catalog';
import { clamp, type Rect, type Vec } from '../../../core/math';
import { attackVector, bossTinks, overlapArea, type Verdict } from './logic';
import { rumble } from '../../../input/devices';

/** Seconds a boss holds still after the room is entered. */
export const INTRO_TIME = 1;
/** Contact damage of every boss body part (half-hearts). */
export const BOSS_CONTACT = 2;
/** White flash on a damaging hit (s). */
const HIT_FLASH = 0.15;
/** Minimum seconds between two tinks (a sweeping blade may report a part every frame). */
const TINK_COOLDOWN = 0.2;
/** Seconds between death bursts — the spacing of the booms in the bossDie sound. */
const BURST_EVERY = 0.22;
/** bossDie plays six booms; it is replayed every six bursts. */
export const BOOMS_PER_SFX = 6;
/** Pause after the last burst before the heart container appears (s) — lands on bossDie's final boom. */
const FINALE_DELAY = 0.2;
/** Blink rate (toggles per second) of a dying boss. */
const DEATH_BLINK_HZ = 16;
/** Footprint (px) that must be free floor where the heart container lands. */
const HEART_SIZE = 12;
/** Overlap growth (px^2) below which a step does not count as sinking into a solid. */
const SINK_EPS = 1e-6;
/** Doorways block bosses even when open. */
const DOOR = 'obj.door';

/** One death explosion (room px). */
export interface Burst {
  x: number;
  y: number;
}

/** Numeric prop, rounded and clamped (catalog default, then `fallback`, when missing or invalid). */
export function intProp(e: Entity, key: string, fallback: number, lo: number, hi: number): number {
  const v = Math.round(Number(e.prop(key, fallback)));
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/**
 * Base class of every boss. Subclasses implement fight() (AI after the intro),
 * judge() (how a hit on one of its parts is treated) and deathBursts(); bosses
 * built from several entities route their parts' hurt() through strike().
 */
export abstract class Boss extends Enemy {
  /** Intro seconds left once awake (the Enemy spawn grace covers the first SPAWN_DELAY). */
  protected intro = Math.max(0, INTRO_TIME - SPAWN_DELAY);
  private bursts: Burst[] | null = null;
  private burstT = 0;
  private burstN = 0;
  private deathT = 0;
  private tinkT = 0;
  /** The part the last damaging hit landed on: its i-frames cover the whole boss. */
  private wounded: Entity | null = null;

  constructor(game: GameServices, inst: EntityInstance | null, defaultHp: number) {
    super(game, inst);
    this.hp = this.maxHp = intProp(this, 'hp', defaultHp, 1, 99);
    this.touchDamage = BOSS_CONTACT;
    // Bosses are immune to stun (boomerang / hookshot): the AI and the death sequence always run.
    this.ignoresStun = true;
  }

  /** True from 0 HP until the finale removes the boss. */
  get dying(): boolean {
    return this.bursts !== null;
  }

  /**
   * Still in the i-frames of the last damaging hit: every blow passes without
   * effect or feedback, so one blow reaching two parts (or landing, then
   * meeting a shield that just turned) counts once.
   */
  get reeling(): boolean {
    return this.wounded !== null && this.wounded.invuln > 0;
  }

  /** Remaining health as a fraction of the maximum (0..1). */
  get healthFraction(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** Boss AI once the intro is over. */
  protected abstract fight(dt: number): void;

  /** How a hit on `part` (this boss or one of its part entities) is treated. */
  protected abstract judge(part: Entity, hit: Hit): Verdict;

  /** Where the death explosions go off, in order (asked once, when the boss reaches 0 HP). */
  protected abstract deathBursts(): Burst[];

  /** Behaviour while the intro holds the boss still (default: nothing). */
  protected idle(_dt: number): void {}

  /** A damaging hit landed and the boss survived it. */
  protected onWound(_hit: Hit): void {}

  /** A shield blocked `hit` (after the tink). */
  protected onBlocked(_hit: Hit): void {}

  /** Burst `i` of deathBursts() just went off (e.g. remove the part it was on). */
  protected onBurst(_i: number): void {}

  /** Each tick of the death sequence: `on` = the blink phase (default: flash white). */
  protected blink(on: boolean): void {
    this.hitFlash = on ? HIT_FLASH : 0;
  }

  protected think(dt: number): void {
    this.tinkT = Math.max(0, this.tinkT - dt);
    if (this.bursts) {
      this.tickDeath(dt);
    } else if (this.intro > 0) {
      this.intro -= dt;
      this.idle(dt);
    } else {
      this.fight(dt);
    }
    this.keepInRoom();
  }

  override hurt(hit: Hit): boolean {
    return this.strike(this, hit);
  }

  /**
   * Tiles, solid entities and doorways (open ones too: a boss keeps to the
   * arena, out of the notch a shutter would shut on and the hero walks in by)
   * block as usual, except one the boss already overlaps (a shutter closed on
   * it, a peg rising under it, a block pushed into it): that one only stops it
   * sinking deeper, so it can always walk out.
   */
  override isBlockedAt(x: number, y: number): boolean {
    if (this.mover === 'ghost') return false;
    const r = this.rectAt(x, y);
    if (this.game.room.blocked(r, this.mover)) return true;
    const now = this.hitbox();
    for (const e of this.game.entities) {
      if (e === this || e.dead || !(e.solid || e.type === DOOR)) continue;
      if (sinksInto(e.hitbox(), now, r)) return true;
    }
    return false;
  }

  /**
   * Leaving the room (a scroll, a warp, a game over) mid-death still counts as
   * the defeat. Only the persistDefeat flag is set: the room is being torn
   * down, so there is no event and no heart container (bringing back an
   * uncollected heart container is the engine's room-entry rule).
   */
  override onRemove(): void {
    if (this.dying && !this.dead && entityInfo(this.type)?.persistDefeat) this.game.setFlag(`defeated:${this.id}`, true);
  }

  /**
   * Resolve a hit on `part` (this boss or one of its part entities): damage, a
   * shield block or a tink — or nothing while reeling. Returns true only when
   * damage landed.
   */
  strike(part: Entity, hit: Hit): boolean {
    if (this.dead || this.dying || this.reeling) return false;
    const verdict = this.judge(part, hit);
    if (verdict === 'ignore') return false;
    if (verdict === 'damage') {
      this.wound(hit.damage, part);
      if (!this.dying) this.onWound(hit);
      return true;
    }
    if (bossTinks(hit.kind)) this.tink(part, hit);
    if (verdict === 'blocked') this.onBlocked(hit);
    return false;
  }

  /** Generic kills (code calling die() directly) run the death sequence too. */
  override die(): void {
    if (!this.dead && !this.bursts) this.startDeath();
  }

  /** Take `amount` damage: flash + i-frames on `part` (the weak point), bossHit, death at 0 HP. */
  private wound(amount: number, part: Entity): void {
    this.hp = Math.max(0, this.hp - amount);
    part.hitFlash = HIT_FLASH;
    part.invuln = part.invulnOnHit;
    this.wounded = part;
    this.game.audio.sfx('bossHit');
    rumble('tap');
    if (this.hp <= 0) this.startDeath();
  }

  /** Immune-hit feedback on the side of `part` facing the attack: a spark and a tink (at most one per TINK_COOLDOWN). */
  private tink(part: Entity, hit: Hit): void {
    if (this.tinkT > 0) return;
    this.tinkT = TINK_COOLDOWN;
    const from = attackVector(hit, part.x, part.y);
    const reach = Math.min(part.w, part.h) / 2;
    this.game.audio.sfx('swordTink');
    this.game.effect('fx.hit', 'play', part.x + from.x * reach, part.y + from.y * reach - part.z, { above: true });
  }

  /** Clamp the hitbox inside the room (walls normally do this already). */
  private keepInRoom(): void {
    const room = this.game.room;
    this.x = clamp(this.x, this.w / 2, room.width - this.w / 2);
    this.y = clamp(this.y, this.h / 2, room.height - this.h / 2);
  }

  private startDeath(): void {
    this.hp = 0;
    this.touchDamage = 0;
    this.contactDamage = 0;
    this.kbTime = 0;
    this.bursts = this.deathBursts();
    this.burstT = 0;
    this.burstN = 0;
    this.deathT = 0;
    this.game.camera.shake(0.3, 2);
  }

  private tickDeath(dt: number): void {
    const bursts = this.bursts!;
    this.deathT += dt;
    this.blink(Math.floor(this.deathT * DEATH_BLINK_HZ) % 2 === 0);
    this.burstT -= dt;
    if (this.burstT > 0) return;
    if (this.burstN >= bursts.length) {
      this.finish();
      return;
    }
    const b = bursts[this.burstN]!;
    if (this.burstN % BOOMS_PER_SFX === 0) this.game.audio.sfx('bossDie');
    this.game.effect('fx.explosion', 'play', b.x, b.y, { above: true });
    this.game.camera.shake(0.2, 2);
    this.onBurst(this.burstN);
    this.burstN++;
    this.burstT = this.burstN < bursts.length ? BURST_EVERY : FINALE_DELAY;
  }

  private finish(): void {
    this.blink(false);
    if (this.prop<boolean>('dropHeart', true)) this.dropHeartContainer();
    this.game.camera.shake(0.5, 3);
    rumble('heavy');
    // No poof or random loot (the finale replaces both); Entity.die still sets the
    // persistDefeat flag and emits 'defeated'.
    this.team = 'neutral';
    super.die();
  }

  /** The heart container: a non-transient pickup whose id derives from this boss (collected once). */
  private dropHeartContainer(): void {
    const at = this.heartSpot();
    const inst: EntityInstance = {
      id: `${this.id}-heart`,
      type: 'obj.pickup',
      x: at.x,
      y: at.y,
      props: { item: 'heartContainer', amount: 1, hidden: false },
    };
    const e = createEntity(this.game, inst);
    if (e) this.game.spawn(e);
  }

  /** Walkable floor nearest the boss, inside the room. */
  private heartSpot(): Vec {
    const room = this.game.room;
    const half = HEART_SIZE / 2;
    const free = (x: number, y: number): boolean =>
      x - half >= 0 && y - half >= 0 && x + half <= room.width && y + half <= room.height
      && !room.blocked({ x: x - half, y: y - half, w: HEART_SIZE, h: HEART_SIZE }, 'walker');
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    return findFreeSpot(free, x, y) ?? { x, y };
  }
}

/** Whether moving a box from `now` to `next` overlaps the solid `solid` more than before. */
function sinksInto(solid: Rect, now: Rect, next: Rect): boolean {
  return overlapArea(solid, next) > overlapArea(solid, now) + SINK_EPS;
}
