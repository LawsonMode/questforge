// Slime (enemy.slime): a hopping blob. Rests (wobbling), squashes down in
// anticipation, then bounces toward the hero in bursts of 1-3 hops. Big slimes
// with 'split' burst into two small slimes when defeated; the halves carry the
// drop, and the big slime only counts as defeated (its 'defeated' event, which
// triggers wait for) once both halves are gone. Variants: green steady, red
// restless (short rests), blue long hops.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { entityInfo } from '../../../core/catalog';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

type State = 'rest' | 'squash' | 'hop';
type Size = 'big' | 'small';

/** Per-size stats; `lift` raises the art onto the hitbox (the small_* frames sit low in their 16x16 cell). */
const SIZES: Readonly<Record<Size, {
  hp: number; w: number; h: number; lift: number; hopLen: number; hopHeight: number; hopTime: number; idle: string; hop: string;
}>> = {
  big: { hp: 2, w: 12, h: 10, lift: 0, hopLen: 16, hopHeight: 7, hopTime: 0.32, idle: 'idle', hop: 'hop' },
  small: { hp: 1, w: 8, h: 8, lift: 3, hopLen: 12, hopHeight: 5, hopTime: 0.26, idle: 'small_idle', hop: 'small_hop' },
};
/** Per-variant rest length and hop length multipliers. */
const VARIANTS: Readonly<Record<string, { rest: number; hop: number }>> = {
  green: { rest: 1, hop: 1 },
  red: { rest: 0.5, hop: 1 },
  blue: { rest: 1.2, hop: 1.35 },
};
const REST_MIN = 0.6;
const REST_MAX = 1.2;
const SQUASH_TIME = 0.22;
/** Pause between the hops of one burst (s). */
const BURST_GAP = 0.08;
const MAX_BURST = 3;
/** Split halves: spawn offset (px), outward hop and their spawn grace + i-frames (s). */
const HALF_OFFSET = 5;
const HALF_HOP_LEN = 10;
const HALF_HOP_HEIGHT = 6;
const HALF_HOP_TIME = 0.3;
const HALF_WAKE = 0.35;

/** The big slime a pair of halves split from, and how many of them are still alive. */
interface SplitParent {
  readonly id: string;
  readonly type: string;
  left: number;
}

export class Slime extends Enemy {
  private readonly size: Size;
  private readonly mods: { rest: number; hop: number };
  private st: State = 'rest';
  private timer: number;
  private hopsLeft = 0;
  /** Set on split halves: the big slime they came from. */
  private parent: SplitParent | null = null;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.slime');
    this.sprite = 'enemy.slime';
    this.size = this.prop<string>('size', 'big') === 'small' ? 'small' : 'big';
    const s = SIZES[this.size];
    this.w = s.w;
    this.h = s.h;
    this.artLift = s.lift;
    this.hp = this.maxHp = s.hp;
    this.mods = VARIANTS[String(this.prop('variant', 'green'))] ?? VARIANTS['green']!;
    this.palette = this.paletteForVariant();
    this.timer = this.restTime();
    this.play(s.idle);
  }

  /** Current AI state (tests / debugging). */
  get aiState(): State {
    return this.st;
  }

  protected think(dt: number): void {
    const s = SIZES[this.size];
    this.timer -= dt;
    if (this.airborne) {
      this.play(s.hop);
      return;
    }
    switch (this.st) {
      case 'hop': this.landed(); break;
      case 'rest':
        this.play(s.idle);
        if (this.timer <= 0) this.squash(rng.int(1, MAX_BURST));
        break;
      case 'squash':
        this.holdFrame(s.idle, 0);
        if (this.timer <= 0) this.hopToward();
        break;
    }
  }

  override die(): void {
    if (this.dead) return;
    if (this.size === 'big' && this.prop<boolean>('split', true)) {
      this.split();
      return;
    }
    super.die();
    this.reportToParent();
  }

  private landed(): void {
    if (this.hopsLeft > 0) this.squash(this.hopsLeft, BURST_GAP);
    else {
      this.st = 'rest';
      this.timer = this.restTime();
    }
  }

  private squash(hops: number, time = SQUASH_TIME): void {
    this.st = 'squash';
    this.hopsLeft = hops;
    this.timer = time;
  }

  private hopToward(): void {
    const s = SIZES[this.size];
    const target = this.heroTargetable() ? this.hero : null;
    const angle = target ? Math.atan2(target.y - this.y, target.x - this.x) + rng.range(-0.3, 0.3) : rng.range(0, Math.PI * 2);
    const len = s.hopLen * this.mods.hop;
    this.hop(Math.cos(angle) * len, Math.sin(angle) * len, s.hopHeight, s.hopTime);
    this.hopsLeft--;
    this.st = 'hop';
    this.play(s.hop);
  }

  private restTime(): number {
    return rng.range(REST_MIN, REST_MAX) * this.mods.rest;
  }

  /** Burst into two small slimes; the halves carry the drop, so no loot from the big one. */
  private split(): void {
    this.dead = true;
    this.game.effect('fx.poof', 'play', this.x, this.y - this.z);
    const parent: SplitParent = { id: this.id, type: this.type, left: 2 };
    this.spawnHalf(-1, parent);
    this.spawnHalf(1, parent);
  }

  /** A split half died: the last one reports the big slime defeated (event + persistDefeat flag). */
  private reportToParent(): void {
    const parent = this.parent;
    if (!parent || --parent.left > 0) return;
    if (entityInfo(parent.type)?.persistDefeat) this.game.setFlag(`defeated:${parent.id}`, true);
    this.game.emit({ type: 'defeated', id: parent.id, entityType: parent.type });
  }

  /**
   * One small slime popping out sideways (`side` -1 = left, 1 = right). The left
   * half carries the big slime's drop; the right one only rolls random loot when
   * the drop was random, so a set drop (a small key!) is never duplicated.
   */
  private spawnHalf(side: -1 | 1, parent: SplitParent): void {
    const x = this.canStand(this.x + side * HALF_OFFSET, this.y) ? this.x + side * HALF_OFFSET : this.x;
    const drop = String(this.prop('drop', 'random'));
    const inst: EntityInstance = {
      id: `${this.id}/${side < 0 ? 'a' : 'b'}`,
      type: 'enemy.slime',
      x,
      y: this.y,
      props: {
        variant: this.prop('variant', 'green'), size: 'small', split: false,
        drop: side < 0 || drop === 'random' ? drop : 'none',
      },
    };
    const half = new Slime(this.game, inst);
    half.parent = parent;
    half.wakeT = HALF_WAKE;
    // The killing swing is usually still sweeping through the spot: don't let it cut the halves too.
    half.invuln = HALF_WAKE;
    half.hop(side * HALF_HOP_LEN, 0, HALF_HOP_HEIGHT, HALF_HOP_TIME);
    this.game.spawn(half);
  }
}

registerEntity('enemy.slime', (game, inst) => new Slime(game, inst));
