// Rock spitter (enemy.spitter): wanders in the four directions, stops, puffs up
// (a little hop) and spits a shield-blockable rock the way it faces. When it can
// see the hero it often wanders the way that lines it up, stops as soon as the
// hero is on its row or column, turns and spits at them. Red: 1 HP, single rocks.
// Blue: 2 HP, 3-rock bursts.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { DIR_VEC } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

type State = 'walk' | 'stop' | 'puff' | 'spit';

const WALK_SPEED = 32;
const WALK_MIN = 0.8;
const WALK_MAX = 1.8;
/** Stop before deciding, puff (anticipation) and rest after spitting (s). */
const STOP_TIME = 0.3;
const PUFF_TIME = 0.35;
const PUFF_HOP = 3;
const REST_TIME = 0.45;
/** Chance to spit forward at a stop when the hero isn't lined up. */
const SPIT_CHANCE = 0.4;
/** Chance that a new walk heads the way that lines up with a visible hero. */
const LINE_UP_CHANCE = 0.5;
/**
 * Hero within this range and ALIGN_TOL of a row/column gets targeted. A 6 px rock
 * meets the 12 px hero within 9 px of centre, so an aimed rock always connects.
 */
const TARGET_RANGE = 8 * TILE;
const ALIGN_TOL = 8;
/** After a volley, no early lined-up stop for this long (s). */
const SHOT_COOLDOWN = 1.2;
const ROCK_SPEED = 110;
const BURST_GAP = 0.18;
const MUZZLE = 7;
const ROCK_HEIGHT = 4;

export class Spitter extends Enemy {
  private readonly burst: number;
  private st: State = 'walk';
  private timer = 0;
  private shotCd = 0;
  /** Rocks left in the current burst. */
  private rocks = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.spitter');
    this.sprite = 'enemy.spitter';
    const blue = String(this.prop('variant', 'red')) === 'blue';
    this.palette = this.paletteForVariant();
    this.hp = this.maxHp = blue ? 2 : 1;
    this.burst = blue ? 3 : 1;
    this.timer = rng.range(WALK_MIN, WALK_MAX);
    this.playDir('walk');
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  protected think(dt: number): void {
    this.timer -= dt;
    this.shotCd -= dt;
    switch (this.st) {
      case 'walk': this.walk(dt); break;
      case 'stop': this.stop(); break;
      case 'puff': this.puff(); break;
      case 'spit': this.spit(); break;
    }
  }

  private walk(dt: number): void {
    this.wander(dt, WALK_SPEED, WALK_MIN, WALK_MAX);
    this.playDir('walk');
    if (this.timer <= 0 || (this.shotCd <= 0 && this.heroLinedUp())) this.enter('stop', STOP_TIME);
  }

  private stop(): void {
    this.holdFrame(`walk_${this.facing}`);
    if (this.timer > 0) return;
    if (this.heroLinedUp()) {
      this.faceToward(this.hero);
      this.startPuff();
    } else if (rng.chance(SPIT_CHANCE)) {
      this.startPuff();
    } else {
      this.walkOn();
    }
  }

  private puff(): void {
    this.holdFrame(`walk_${this.facing}`, 1);
    if (this.timer > 0) return;
    this.rocks = this.burst;
    this.enter('spit', 0);
  }

  private spit(): void {
    this.holdFrame(`walk_${this.facing}`, 1);
    if (this.timer > 0) return;
    if (this.rocks > 0) {
      this.spitRock();
      this.rocks--;
      this.timer = this.rocks > 0 ? BURST_GAP : REST_TIME;
      return;
    }
    this.shotCd = SHOT_COOLDOWN;
    this.walkOn();
  }

  /** The hero is visible in range and on (roughly) the same row or column. */
  private heroLinedUp(): boolean {
    return this.seesHero(TARGET_RANGE) && this.alignedWith(this.hero, ALIGN_TOL) !== null;
  }

  /** Set off on a new walk, often the way that lines up with (or, lined up, closes on) a visible hero. */
  private walkOn(): void {
    const lineUp = this.seesHero(TARGET_RANGE) && rng.chance(LINE_UP_CHANCE);
    this.turnWander(WALK_MIN, WALK_MAX, lineUp ? this.lineUpDir(this.hero, ALIGN_TOL) : undefined);
    this.enter('walk', rng.range(WALK_MIN, WALK_MAX));
  }

  private startPuff(): void {
    this.hop(0, 0, PUFF_HOP, PUFF_TIME * 0.8);
    this.holdFrame(`walk_${this.facing}`, 1);
    this.enter('puff', PUFF_TIME);
  }

  private enter(st: State, time: number): void {
    this.st = st;
    this.timer = time;
  }

  private spitRock(): void {
    const v = DIR_VEC[this.facing];
    const at = this.ahead(MUZZLE);
    this.shoot({ sprite: 'proj.rock', x: at.x, y: at.y, vx: v.x * ROCK_SPEED, vy: v.y * ROCK_SPEED, height: ROCK_HEIGHT });
    this.game.audio.sfx('throw', { pitch: 1.5, volume: 0.7 });
  }
}

registerEntity('enemy.spitter', (game, inst) => new Spitter(game, inst));
