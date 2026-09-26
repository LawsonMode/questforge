// Skeleton (enemy.skeleton): hops toward the hero in short arcs. When the hero
// swings a sword nearby while it stands on the ground it usually leaps backward,
// and the blade can't touch it during that leap. The dodge has a cooldown, so a
// quick second swing (or one that catches it mid-hop) lands. With 'throws' it
// sometimes stops to hurl a spinning, shield-blockable bone from mid range.
import type { EntityInstance } from '../../../core/types';
import type { GameServices, Hit } from '../../api';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

type State = 'wait' | 'hop' | 'dodge' | 'throw';

/** Rest between hops (s). */
const WAIT_MIN = 0.25;
const WAIT_MAX = 0.6;
/** Hop toward the hero: length (px), height (px), duration (s), aim wobble (rad). */
const HOP_LEN = 22;
const HOP_HEIGHT = 8;
const HOP_TIME = 0.38;
const HOP_WOBBLE = 0.4;
/** Backward dodge leap. */
const DODGE_RANGE = 2.5 * TILE;
const DODGE_LEN = 32;
const DODGE_HEIGHT = 14;
const DODGE_TIME = 0.45;
const DODGE_CHANCE = 0.8;
const DODGE_COOLDOWN = 1.1;
/** A swing that starts mid-hop is still dodged if it lands within this long (s). */
const DODGE_WINDOW = 0.3;
/** Bone throws: range band (px), wind-up (s), first and later cooldown ranges (s), speed (px/s). */
const THROW_MIN_RANGE = 2.5 * TILE;
const THROW_MAX_RANGE = 8 * TILE;
const THROW_WINDUP = 0.3;
const FIRST_THROW_MIN = 0.8;
const FIRST_THROW_MAX = 2.5;
const THROW_COOLDOWN_MIN = 2.5;
const THROW_COOLDOWN_MAX = 4;
const BONE_SPEED = 90;
const BONE_SIZE = 8;
const BONE_HEIGHT = 6;

export class Skeleton extends Enemy {
  private readonly throws: boolean;
  private st: State = 'wait';
  private timer = rng.range(WAIT_MIN, WAIT_MAX);
  private dodgeCd = 0;
  private throwCd = rng.range(FIRST_THROW_MIN, FIRST_THROW_MAX);
  /** Whether the hero was swinging nearby last tick (a swing is "fresh" on its first tick). */
  private swingSeen = false;
  /** Time left (s) to answer the latest fresh swing with a dodge. */
  private dodgeWindow = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.skeleton');
    this.sprite = 'enemy.skeleton';
    this.hp = this.maxHp = 2;
    this.throws = this.prop<boolean>('throws', true);
    this.play('walk');
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  /** In the air on a dodge leap: sword and spin attacks pass beneath it. */
  get dodging(): boolean {
    return this.st === 'dodge' && this.airborne;
  }

  override hurt(hit: Hit): boolean {
    if (this.dodging && (hit.kind === 'sword' || hit.kind === 'spin')) return false;
    return super.hurt(hit);
  }

  /**
   * Caught by a hit (mid-hop, or a failed dodge roll): that swing gets no delayed
   * dodge, even when the blade landed before this skeleton noticed the swing.
   */
  protected override onHurt(): void {
    this.dodgeWindow = 0;
    this.swingSeen = this.heroSwinging(DODGE_RANGE);
  }

  protected think(dt: number): void {
    this.timer -= dt;
    this.dodgeCd -= dt;
    this.throwCd -= dt;
    this.noticeSwing(dt);
    if (this.airborne) {
      this.play('jump');
      return;
    }
    if (this.tryDodge()) return;
    switch (this.st) {
      case 'hop':
      case 'dodge': this.land(); break;
      case 'wait': this.wait(); break;
      case 'throw': this.windUp(); break;
    }
  }

  private land(): void {
    this.st = 'wait';
    this.timer = rng.range(WAIT_MIN, WAIT_MAX);
    this.play('walk');
  }

  private wait(): void {
    this.play('walk');
    if (this.timer > 0) return;
    if (this.wantsToThrow()) {
      this.st = 'throw';
      this.timer = THROW_WINDUP;
      return;
    }
    this.hopToward();
  }

  private windUp(): void {
    this.holdFrame('jump');
    if (this.timer > 0) return;
    const v = this.vecTo(this.hero);
    this.shoot({
      sprite: 'proj.bone', x: this.x, y: this.y, vx: v.x * BONE_SPEED, vy: v.y * BONE_SPEED,
      size: BONE_SIZE, height: BONE_HEIGHT,
    });
    this.game.audio.sfx('throw');
    this.throwCd = rng.range(THROW_COOLDOWN_MIN, THROW_COOLDOWN_MAX);
    this.land();
  }

  /** Opens the dodge window when a hero swing starts nearby (tracked even mid-hop). */
  private noticeSwing(dt: number): void {
    const swinging = this.heroSwinging(DODGE_RANGE);
    this.dodgeWindow = swinging && !this.swingSeen ? DODGE_WINDOW : Math.max(0, this.dodgeWindow - dt);
    this.swingSeen = swinging;
  }

  /** Answer a fresh hero swing (once, on the ground): maybe leap backward, away from the hero, out of the blade's way. */
  private tryDodge(): boolean {
    if (this.dodgeWindow <= 0 || this.dodgeCd > 0) return false;
    this.dodgeWindow = 0;
    if (!rng.chance(DODGE_CHANCE)) return false;
    const away = this.vecTo(this.hero);
    this.hop(-away.x * DODGE_LEN, -away.y * DODGE_LEN, DODGE_HEIGHT, DODGE_TIME);
    this.game.audio.sfx('jump');
    this.dodgeCd = DODGE_COOLDOWN;
    this.st = 'dodge';
    this.play('jump');
    return true;
  }

  private wantsToThrow(): boolean {
    if (!this.throws || this.throwCd > 0 || !this.seesHero(THROW_MAX_RANGE)) return false;
    return this.distTo(this.hero) >= THROW_MIN_RANGE;
  }

  private hopToward(): void {
    const target = this.heroTargetable() ? this.hero : null;
    const base = target ? Math.atan2(target.y - this.y, target.x - this.x) : rng.range(0, Math.PI * 2);
    const angle = base + rng.range(-HOP_WOBBLE, HOP_WOBBLE);
    const len = target ? Math.min(HOP_LEN, this.distTo(target)) : HOP_LEN;
    this.hop(Math.cos(angle) * len, Math.sin(angle) * len, HOP_HEIGHT, HOP_TIME);
    this.st = 'hop';
    this.play('jump');
  }
}

registerEntity('enemy.skeleton', (game, inst) => new Skeleton(game, inst));
