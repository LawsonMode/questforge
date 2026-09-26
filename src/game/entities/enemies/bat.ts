// Bat (enemy.bat): erratic flier. Sleeping bats rest until the hero comes within
// 3 tiles. In flight it swoops about with a wandering heading loosely steered at
// the hero, speeding up and slowing down, bouncing off walls; it flies over pits
// and water ('flyer') and settles for a brief rest on solid ground now and then.
// Frail: the boomerang knocks it out of the air instead of just stunning it.
import type { EntityInstance } from '../../../core/types';
import type { GameServices, Hit } from '../../api';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

type State = 'sleep' | 'fly' | 'rest';

const WAKE_RANGE = 3 * TILE;
/** Cruise speed and the swoop swing around it (px/s), swoop frequency (rad/s). */
const CRUISE = 64;
const SWOOP = 34;
const SWOOP_RATE = 5;
/** Random turn rate range (rad/s) and how often it changes (s). */
const MAX_TURN = 5;
const TURN_MIN = 0.25;
const TURN_MAX = 0.6;
/** Pull toward the hero (rad/s). */
const STEER = 1.8;
/** Flight height (px), bob amplitude and how fast it takes off / lands (px/s). */
const FLY_Z = 4;
const BOB = 1.5;
const CLIMB = 24;
const FLIGHT_MIN = 2.5;
const FLIGHT_MAX = 4.5;
const REST_MIN = 0.8;
const REST_MAX = 1.6;

/** Signed smallest angle from a to b (radians, -PI..PI). */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class Bat extends Enemy {
  private st: State;
  private timer = 0;
  private heading = rng.range(0, Math.PI * 2);
  private turn = 0;
  private turnT = 0;
  private phase = rng.range(0, Math.PI * 2);

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.bat');
    this.sprite = 'enemy.bat';
    this.mover = 'flyer';
    this.avoidHazards = false;
    this.hp = this.maxHp = 1;
    this.st = this.prop<boolean>('sleeping', false) ? 'sleep' : 'fly';
    this.timer = rng.range(FLIGHT_MIN, FLIGHT_MAX);
    this.play(this.st === 'sleep' ? 'rest' : 'fly');
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  /** A boomerang hit (0 damage elsewhere) deals at least 1 damage to a bat. */
  override hurt(hit: Hit): boolean {
    return super.hurt(hit.kind === 'boomerang' ? { ...hit, damage: Math.max(1, hit.damage) } : hit);
  }

  protected think(dt: number): void {
    this.timer -= dt;
    switch (this.st) {
      case 'sleep': this.sleep(); break;
      case 'rest': this.rest(dt); break;
      case 'fly': this.fly(dt); break;
    }
  }

  private sleep(): void {
    this.play('rest');
    if (this.heroTargetable() && this.distTo(this.hero) <= WAKE_RANGE) this.takeOff();
  }

  private rest(dt: number): void {
    this.z = Math.max(0, this.z - CLIMB * dt);
    this.play(this.z > 0 ? 'fly' : 'rest');
    if (this.timer <= 0) this.takeOff();
  }

  private fly(dt: number): void {
    this.play('fly');
    this.phase += dt * SWOOP_RATE;
    this.z = Math.min(FLY_Z + Math.sin(this.phase * 0.7) * BOB, this.z + CLIMB * dt);
    this.steer(dt);
    const speed = CRUISE + Math.sin(this.phase) * SWOOP;
    this.flyStep(Math.cos(this.heading) * speed * dt, Math.sin(this.heading) * speed * dt);
    if (this.timer <= 0 && this.game.room.collisionAt(this.x, this.y) === 'floor') {
      this.st = 'rest';
      this.timer = rng.range(REST_MIN, REST_MAX);
    }
  }

  private takeOff(): void {
    this.st = 'fly';
    this.timer = rng.range(FLIGHT_MIN, FLIGHT_MAX);
    if (this.heroTargetable()) this.heading = Math.atan2(this.hero.y - this.y, this.hero.x - this.x);
  }

  /** Wandering turn rate plus a pull toward the hero. */
  private steer(dt: number): void {
    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.turn = rng.range(-MAX_TURN, MAX_TURN);
      this.turnT = rng.range(TURN_MIN, TURN_MAX);
    }
    this.heading += this.turn * dt;
    if (!this.heroTargetable()) return;
    const want = Math.atan2(this.hero.y - this.y, this.hero.x - this.x);
    const d = angleDelta(this.heading, want);
    this.heading += Math.sign(d) * Math.min(Math.abs(d), STEER * dt);
  }

  /** Move (not while knocked back), bouncing the heading off whatever blocks it. */
  private flyStep(dx: number, dy: number): void {
    if (this.kbTime > 0) return;
    const hit = this.move(dx, dy);
    if (hit.hitX) this.heading = Math.PI - this.heading;
    if (hit.hitY) this.heading = -this.heading;
  }
}

registerEntity('enemy.bat', (game, inst) => new Bat(game, inst));
