// Archer (enemy.archer): a bow soldier that keeps its distance. Wanders until it
// spots the hero, then holds ~4-6 tiles away, sidesteps onto the hero's row or
// column, draws (shoot pose) and fires a shield-blockable arrow; a hit while it
// draws makes it flinch and lose the shot. Backs off fast when the hero closes
// in. Blue archers are tougher and shoot faster & harder.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { DIR_VEC } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

type State = 'idle' | 'engage' | 'flee' | 'aim' | 'recover';

const STATS = {
  green: { hp: 2, cooldown: 1.6, arrowSpeed: 150, arrowDamage: 1 },
  blue: { hp: 3, cooldown: 1.1, arrowSpeed: 180, arrowDamage: 2 },
} as const;
const WALK_SPEED = 34;
const ENGAGE_SPEED = 44;
const FLEE_SPEED = 64;
const NOTICE_RANGE = 7 * TILE;
/** Preferred band around the hero (px). */
const MIN_RANGE = 4 * TILE;
const MAX_RANGE = 6 * TILE;
/** Closer than this, it turns and runs for FLEE_TIME. */
const FLEE_RANGE = 2.5 * TILE;
const FLEE_TIME = 0.6;
/** Loses interest after this long (s) without seeing the hero. */
const FORGET_TIME = 5;
const ALIGN_TOL = 4;
/** Draw (pose before release) and follow-through (s). */
const AIM_TIME = 0.35;
const RECOVER_TIME = 0.3;
/** Arrow spawn offset in front of the archer (px). */
const MUZZLE = 8;
const ARROW_HEIGHT = 6;

export class Archer extends Enemy {
  private readonly stats: (typeof STATS)[keyof typeof STATS];
  private st: State = 'idle';
  private timer = 0;
  private cooldown = 0;
  private unseenT = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.archer');
    this.sprite = 'enemy.archer';
    this.stats = String(this.prop('variant', 'green')) === 'blue' ? STATS.blue : STATS.green;
    this.palette = this.paletteForVariant();
    this.hp = this.maxHp = this.stats.hp;
    this.cooldown = this.stats.cooldown * 0.5;
    this.holdFrame(`walk_${this.facing}`);
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  protected think(dt: number): void {
    this.timer -= dt;
    this.cooldown -= dt;
    switch (this.st) {
      case 'idle': this.idle(dt); break;
      case 'engage': this.engage(dt); break;
      case 'flee': this.fleeHero(dt); break;
      case 'aim': this.aim(); break;
      case 'recover': this.recover(); break;
    }
  }

  /** A hit wakes an idle archer; one during the draw spoils the shot (the arrow never leaves). */
  protected override onHurt(): void {
    if (this.st === 'aim') this.cooldown = this.stats.cooldown;
    if (this.st === 'idle' || this.st === 'aim') this.enter('engage');
  }

  // ------------------------------------------------------------------ states

  private idle(dt: number): void {
    if (this.seesHero(NOTICE_RANGE)) {
      this.enter('engage');
      return;
    }
    this.wander(dt, WALK_SPEED, 1, 2.5);
    this.playDir('walk');
  }

  private engage(dt: number): void {
    const hero = this.hero;
    if (!this.heroTargetable()) {
      this.enter('idle');
      return;
    }
    this.unseenT = this.seesHero(NOTICE_RANGE * 1.5) ? 0 : this.unseenT + dt;
    if (this.unseenT >= FORGET_TIME) {
      this.enter('idle');
      return;
    }
    if (this.distTo(hero) < FLEE_RANGE) {
      this.enter('flee');
      return;
    }
    const band = this.keepDistance(hero, MIN_RANGE, MAX_RANGE, ENGAGE_SPEED, dt);
    if (band !== 'hold') {
      this.playDir('walk');
      return;
    }
    this.faceToward(hero);
    const aligned = this.lineUp(hero, ENGAGE_SPEED, dt, ALIGN_TOL);
    if (aligned && this.cooldown <= 0 && this.seesHero(MAX_RANGE + TILE)) {
      this.enter('aim');
      return;
    }
    if (aligned) this.holdFrame(`walk_${this.facing}`);
    else this.playDir('walk');
  }

  private fleeHero(dt: number): void {
    this.flee(this.hero, FLEE_SPEED, dt);
    this.playDir('walk');
    if (this.timer <= 0) this.enter('engage');
  }

  private aim(): void {
    this.playDir('shoot');
    if (this.timer > 0) return;
    this.fire();
    this.enter('recover');
  }

  private recover(): void {
    this.playDir('shoot');
    if (this.timer <= 0) this.enter('engage');
  }

  // ------------------------------------------------------------------ helpers

  private enter(st: State): void {
    this.st = st;
    this.unseenT = 0;
    if (st === 'flee') this.timer = FLEE_TIME;
    else if (st === 'aim') this.timer = AIM_TIME;
    else if (st === 'recover') this.timer = RECOVER_TIME;
    else this.timer = 0;
    // Draw the bow on the same frame the aim starts.
    if (st === 'aim') this.playDir('shoot');
  }

  private fire(): void {
    const v = DIR_VEC[this.facing];
    const at = this.ahead(MUZZLE);
    this.shoot({
      sprite: 'proj.arrow', x: at.x, y: at.y, vx: v.x * this.stats.arrowSpeed, vy: v.y * this.stats.arrowSpeed,
      damage: this.stats.arrowDamage, height: ARROW_HEIGHT,
    });
    this.game.audio.sfx('arrow');
    this.cooldown = this.stats.cooldown;
  }
}

registerEntity('enemy.archer', (game, inst) => new Archer(game, inst));
