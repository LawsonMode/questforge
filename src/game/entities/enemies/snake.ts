// Snake (enemy.snake): slithers about at random; when the hero shares its row
// or column within 5 tiles with nothing in between, it dashes at full speed in
// a straight line until it hits a wall.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { DIR_VEC } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy, lineOfSight, rowColumnDir } from './common';

const CONTACT_DAMAGE = 1;
const SLITHER_SPEED = 36;
const DASH_SPEED = 170;
const SIGHT = 5 * TILE;
const ALIGN_TOL = 6;
/** Longest dash (s): a safety net for wide open rooms. */
const DASH_MAX = 2;
const REST_TIME = 0.6;
/** Seconds from the end of a dash to the next (counted through the rest, so it slithers a moment first). */
const DASH_COOLDOWN = 1;
/** The walk cycle runs this many times faster while dashing. */
const DASH_ANIM = 2.5;

type SnakeState = 'slither' | 'pause' | 'dash' | 'rest';

/** The snake. */
export class Snake extends Enemy {
  private st: SnakeState = 'slither';
  private stT = 0;
  private stDur = rng.range(0.4, 1.2);
  private cooldown = 0;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.snake');
    this.sprite = 'enemy.snake';
    this.hp = 1;
    this.maxHp = 1;
    this.touchDamage = CONTACT_DAMAGE;
    this.playDir('walk');
  }

  /** Current behaviour phase (tests & debugging). */
  get phase(): SnakeState {
    return this.st;
  }

  protected think(dt: number): void {
    this.stT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.st === 'slither' || this.st === 'pause') this.tryDash();
    switch (this.st) {
      case 'slither':
        this.wander(dt, SLITHER_SPEED, 0.4, 1.2);
        if (this.stT >= this.stDur) this.enter('pause', rng.range(0.15, 0.5));
        break;
      case 'pause':
        if (this.stT >= this.stDur) this.enter('slither', rng.range(0.4, 1.2));
        break;
      case 'dash':
        this.dash(dt);
        break;
      case 'rest':
        if (this.stT >= this.stDur) this.enter('slither', rng.range(0.4, 1.2));
        break;
    }
    this.playDir('walk');
  }

  private tryDash(): void {
    if (this.cooldown > 0 || !this.heroTargetable()) return;
    const p = this.hero;
    const line = rowColumnDir(this, p, 'both', SIGHT, ALIGN_TOL);
    if (!line || !lineOfSight(this.game.room, this.x, this.y, p.x, p.y)) return;
    this.facing = line;
    this.enter('dash', DASH_MAX);
  }

  /** Straight line, no corner sliding: it stops dead at the first wall. */
  private dash(dt: number): void {
    this.animT += dt * (DASH_ANIM - 1);
    if (this.kbTime > 0) return;
    const v = DIR_VEC[this.facing];
    const hit = this.move(v.x * DASH_SPEED * dt, v.y * DASH_SPEED * dt);
    if (!hit.hitX && !hit.hitY && this.stT < this.stDur) return;
    this.cooldown = DASH_COOLDOWN;
    this.enter('rest', REST_TIME);
  }

  private enter(st: SnakeState, dur: number): void {
    this.st = st;
    this.stT = 0;
    this.stDur = dur;
  }
}

registerEntity('enemy.snake', (game, inst) => new Snake(game, inst));
