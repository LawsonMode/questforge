// Soldier (enemy.soldier): helmeted sword soldier.
//   patrol - walks, turns at walls / at random, stops now and then to look around.
//   guard  - stands at its post facing one way, glancing sideways; returns to the post.
//   chase  - hunts the hero from the start and never gives up.
// Patrols and guards notice the hero within ~5 tiles in view (or right next to
// them, or when hit) -> a short alert beat ("!" + hop) -> chase at 1.4x speed.
// A sword swing that meets its thrusting blade head-on (chasing in the thrust
// pose, facing the hero) clashes: no damage, a clink and a spark, it is pushed
// back and the hero recoils a little (never into a pit or onto spikes). Its guard
// then drops for a moment (walk pose), so a quick second swing lands. Every other
// hit is a plain hit.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices, Hit, Renderer } from '../../api';
import { normalize, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy, safeShove } from './common';

type Variant = 'green' | 'blue' | 'red';
type Behavior = 'patrol' | 'guard' | 'chase';
type State = 'patrol' | 'look' | 'guard' | 'return' | 'alert' | 'chase';

const STATS: Readonly<Record<Variant, { hp: number; speed: number; damage: number }>> = {
  green: { hp: 2, speed: 36, damage: 1 },
  blue: { hp: 4, speed: 36, damage: 1 },
  red: { hp: 6, speed: 46, damage: 2 },
};
const CHASE_FACTOR = 1.4;
/** Chasing plays the walk cycle this much faster. */
const CHASE_ANIM_BOOST = 0.5;
const NOTICE_RANGE = 5 * TILE;
/** Always notices a hero this close, whichever way it faces. */
const HEAR_RANGE = 1.5 * TILE;
const ALERT_TIME = 0.45;
const ALERT_HOP = 5;
/** Gives up after this long (s) without sight of a hero farther than LOSE_RANGE. */
const LOSE_TIME = 4;
const LOSE_RANGE = 8 * TILE;
/** Shows the sword-thrust pose when the hero is this close in front. */
const THRUST_RANGE = 24;
/** Patrol legs (s) between look-around stops, and the stop length. */
const PATROL_LEG_MIN = 2;
const PATROL_LEG_MAX = 4.5;
const LOOK_TIME = 0.7;
/** Guard glances: wait between, and how long a glance lasts (s). */
const GLANCE_WAIT_MIN = 1.5;
const GLANCE_WAIT_MAX = 3.5;
const GLANCE_TIME = 0.8;
/** Close enough (px) to the post to resume guarding. */
const POST_TOL = 3;
/** Blades meeting: soldier knockback (px), hero recoil (px, s), guard-down time (s), spark height (px). */
const CLASH_KNOCKBACK = 16;
const CLASH_RECOIL = 8;
const CLASH_RECOIL_TIME = 0.1;
const CLASH_COOLDOWN = 1.2;
const SPARK_Z = 8;
const ALERT_COLOR = '#ffe23a';

/** The two directions perpendicular to `d`. */
function sideways(d: Dir): [Dir, Dir] {
  return d === 'up' || d === 'down' ? ['left', 'right'] : ['up', 'down'];
}

export class Soldier extends Enemy {
  private readonly speed: number;
  private readonly behavior: Behavior;
  private readonly home: Vec;
  private readonly post: Dir;
  private st: State;
  /** Countdown for the current state's next beat (s). */
  private timer = 0;
  private lostT = 0;
  /** Guard-down time left after a clash (s): no thrust pose, no clash. */
  private clashCd = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.soldier');
    this.sprite = 'enemy.soldier';
    const v = String(this.prop('variant', 'green'));
    const stats = STATS[v === 'blue' || v === 'red' ? v : 'green'];
    this.palette = this.paletteForVariant();
    this.hp = this.maxHp = stats.hp;
    this.speed = stats.speed;
    this.touchDamage = stats.damage;
    const b = String(this.prop('behavior', 'patrol'));
    this.behavior = b === 'guard' || b === 'chase' ? b : 'patrol';
    this.home = { x: this.x, y: this.y };
    this.post = this.facing;
    this.st = this.behavior;
    this.timer = this.behavior === 'guard' ? rng.range(GLANCE_WAIT_MIN, GLANCE_WAIT_MAX) : rng.range(PATROL_LEG_MIN, PATROL_LEG_MAX);
    this.holdFrame(`walk_${this.facing}`);
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  protected think(dt: number): void {
    this.timer -= dt;
    this.clashCd -= dt;
    switch (this.st) {
      case 'patrol': this.patrol(dt); break;
      case 'look': this.look(); break;
      case 'guard': this.guard(); break;
      case 'return': this.returnToPost(dt); break;
      case 'alert': this.alertBeat(); break;
      case 'chase': this.chaseHero(dt); break;
    }
  }

  /** A sword swing meeting its thrusting blade clashes (no damage, returns false); anything else is a plain hit. */
  override hurt(hit: Hit): boolean {
    if (hit.kind !== 'sword' || !this.bladeUp()) return super.hurt(hit);
    this.clash();
    return false;
  }

  protected override onHurt(): void {
    if (this.st === 'chase') return;
    this.faceToward(this.hero);
    this.enter('chase');
  }

  override draw(r: Renderer): void {
    super.draw(r);
    if (this.st === 'alert') {
      r.drawText('!', Math.round(this.x), Math.round(this.y - this.z) - 30, { align: 'center', color: ALERT_COLOR, screen: false });
    }
  }

  // ------------------------------------------------------------------ states

  private patrol(dt: number): void {
    if (this.noticeHero()) return;
    this.wander(dt, this.speed, 1.5, 3.5);
    this.playDir('walk');
    if (this.timer > 0) return;
    this.enter('look');
    this.facing = rng.pick(sideways(this.facing));
  }

  /** Patrol stop: glance to one side, then set off in a fresh direction. */
  private look(): void {
    this.holdFrame(`walk_${this.facing}`);
    if (this.noticeHero() || this.timer > 0) return;
    this.turnWander(1.5, 3.5);
    this.enter('patrol');
  }

  private guard(): void {
    this.holdFrame(`walk_${this.facing}`);
    if (this.noticeHero() || this.timer > 0) return;
    if (this.facing === this.post) {
      this.facing = rng.pick(sideways(this.post));
      this.timer = GLANCE_TIME;
    } else {
      this.facing = this.post;
      this.timer = rng.range(GLANCE_WAIT_MIN, GLANCE_WAIT_MAX);
    }
  }

  private returnToPost(dt: number): void {
    if (this.noticeHero()) return;
    if (this.distTo(this.home) <= POST_TOL || this.timer <= 0) {
      this.facing = this.post;
      this.enter('guard');
      return;
    }
    this.chase(this.home, this.speed, dt);
    this.playDir('walk');
  }

  private alertBeat(): void {
    this.faceToward(this.hero);
    this.holdFrame(`walk_${this.facing}`);
    if (this.timer <= 0) this.enter('chase');
  }

  private chaseHero(dt: number): void {
    if (!this.heroTargetable()) {
      this.giveUp();
      return;
    }
    this.lostT = this.seesHero(LOSE_RANGE) ? 0 : this.lostT + dt;
    if (this.behavior !== 'chase' && this.lostT >= LOSE_TIME) {
      this.giveUp();
      return;
    }
    this.chase(this.hero, this.speed * CHASE_FACTOR, dt);
    if (this.clashCd <= 0 && this.distTo(this.hero) <= THRUST_RANGE && this.inFront(this.hero, 0.5)) {
      this.playDir('attack');
    } else {
      this.playDir('walk');
      this.animT += dt * CHASE_ANIM_BOOST;
    }
  }

  // ------------------------------------------------------------------ helpers

  private enter(st: State): void {
    this.st = st;
    this.lostT = 0;
    switch (st) {
      case 'patrol': this.timer = rng.range(PATROL_LEG_MIN, PATROL_LEG_MAX); break;
      case 'look': this.timer = LOOK_TIME; break;
      case 'guard': this.timer = rng.range(GLANCE_WAIT_MIN, GLANCE_WAIT_MAX); break;
      case 'return': this.timer = LOSE_TIME * 2; break;
      case 'alert': this.timer = ALERT_TIME; break;
      case 'chase': this.timer = 0; break;
    }
  }

  /** Spots the hero in view (or right next to it): starts the alert beat. */
  private noticeHero(): boolean {
    const near = this.heroTargetable() && this.distTo(this.hero) <= HEAR_RANGE;
    if (!near && !this.seesHero(NOTICE_RANGE, true)) return false;
    this.faceToward(this.hero);
    this.holdFrame(`walk_${this.facing}`);
    this.hop(0, 0, ALERT_HOP, ALERT_TIME * 0.6);
    this.enter('alert');
    return true;
  }

  private giveUp(): void {
    if (this.behavior === 'guard') this.enter('return');
    else {
      this.turnWander(1.5, 3.5);
      this.enter('patrol');
    }
  }

  /** Thrusting at the hero with its guard up: chasing in the thrust pose, facing the hero, not reeling. */
  private bladeUp(): boolean {
    if (this.dead || this.invuln > 0 || this.stun > 0 || this.kbTime > 0 || this.clashCd > 0) return false;
    return this.st === 'chase' && this.anim.startsWith('attack_') && this.dirTo(this.hero) === this.facing;
  }

  /** Blades meet: clink and spark, both pushed apart (the hero never into a hole), guard down for a moment. */
  private clash(): void {
    const hero = this.hero;
    this.clashCd = CLASH_COOLDOWN;
    this.game.audio.sfx('swordTink');
    this.game.effect('fx.hit', 'play', (this.x + hero.x) / 2, (this.y + hero.y) / 2 - SPARK_Z);
    const away = normalize(hero.x - this.x, hero.y - this.y);
    this.knock(-away.x, -away.y, CLASH_KNOCKBACK);
    this.playDir('walk');
    const recoil = safeShove(this.game.room, hero.x, hero.y, away.x, away.y, CLASH_RECOIL);
    if (recoil >= 1) hero.knock(away.x, away.y, recoil, CLASH_RECOIL_TIME);
  }
}

registerEntity('enemy.soldier', (game, inst) => new Soldier(game, inst));
