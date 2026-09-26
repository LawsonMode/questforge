// Blade Trap (enemy.bladeTrap): an invulnerable spiked block. When the hero
// lines up with it on an allowed axis within `range` tiles it slides out fast
// until it meets a wall, another trap or its range, then creeps back home.
// It glides over pits and water (only solid tiles, solid objects and other
// traps stop it, both ways): a pot or block moved into its lane while it is out
// holds it where it meets it until the way home clears.
import type { EntityInstance } from '../../../core/types';
import type { GameServices, Hit } from '../../api';
import { DIR_VEC, type Rect, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { Enemy, type LineAxis, lineOfSight, rowColumnDir } from './common';

const TYPE = 'enemy.bladeTrap';
const CONTACT_DAMAGE = 2;
const SLIDE_SPEED = 200;
const RETRACT_SPEED = 40;
/** Cross-axis tolerance (px) for "lined up": the hero's body must overlap the trap's lane. */
const ALIGN_TOL = 10;
/** Rest at the far end (s) before retracting, and at home before re-arming (s). */
const HOLD_TIME = 0.25;
const REARM_TIME = 0.3;
/** Within this (px) of home the retract snaps onto it (absorbs float error). */
const HOME_SNAP = 1e-6;

type TrapState = 'idle' | 'slide' | 'hold' | 'retract';

/** The blade trap. */
export class BladeTrap extends Enemy {
  private st: TrapState = 'idle';
  private stT = 0;
  private readonly home: Vec;
  private readonly axis: LineAxis;
  private readonly rangePx: number;
  private rearm = 0;
  private readonly probe: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, TYPE);
    this.sprite = TYPE;
    this.anim = 'idle';
    this.mover = 'flyer';
    this.shadow = false;
    this.avoidHazards = false;
    this.touchDamage = CONTACT_DAMAGE;
    this.home = { x: this.x, y: this.y };
    const axis = this.prop<string>('axis', 'both');
    this.axis = axis === 'horizontal' || axis === 'vertical' ? axis : 'both';
    this.rangePx = Math.max(1, this.prop('range', 6)) * TILE;
  }

  /** Current phase (tests & debugging). */
  get phase(): TrapState {
    return this.st;
  }

  protected think(dt: number): void {
    this.stT += dt;
    switch (this.st) {
      case 'idle':
        this.rearm = Math.max(0, this.rearm - dt);
        if (this.rearm <= 0) this.watch();
        break;
      case 'slide':
        this.slideOut(dt);
        break;
      case 'hold':
        if (this.stT >= HOLD_TIME) this.enter('retract');
        break;
      case 'retract':
        this.retract(dt);
        break;
    }
  }

  /** Solid metal: weapons clang off. */
  override hurt(hit: Hit): boolean {
    if (hit.kind === 'sword' || hit.kind === 'spin') this.game.audio.sfx('swordTink');
    return false;
  }

  /** Solid tiles, solid objects and other blade traps stop it; pits and water don't. */
  override isBlockedAt(x: number, y: number): boolean {
    const r = this.probe;
    r.x = x - this.w / 2;
    r.y = y - this.h / 2;
    r.w = this.w;
    r.h = this.h;
    if (this.game.room.blocked(r, 'flyer') || this.game.solidEntityAt(r, this)) return true;
    return this.trapAt(r);
  }

  /** Another live blade trap overlaps `r` (plain loop: this runs for every pixel of a slide). */
  private trapAt(r: Rect): boolean {
    for (const e of this.game.entities) {
      if (e === this || e.dead || e.type !== TYPE) continue;
      if (e.left < r.x + r.w && e.right > r.x && e.top < r.y + r.h && e.bottom > r.y) return true;
    }
    return false;
  }

  private watch(): void {
    if (!this.heroTargetable()) return;
    const p = this.hero;
    const dir = rowColumnDir(this, p, this.axis, this.rangePx, ALIGN_TOL);
    if (!dir || !lineOfSight(this.game.room, this.x, this.y, p.x, p.y)) return;
    // Hemmed in (a chest, block or closed door right in front): stay put rather than clank on the spot.
    const v = DIR_VEC[dir];
    if (this.isBlockedAt(this.x + v.x, this.y + v.y)) return;
    this.facing = dir;
    this.enter('slide');
  }

  private slideOut(dt: number): void {
    const v = DIR_VEC[this.facing];
    const left = this.rangePx - Math.hypot(this.x - this.home.x, this.y - this.home.y);
    const step = Math.min(SLIDE_SPEED * dt, Math.max(0, left));
    const hit = this.move(v.x * step, v.y * step);
    const blocked = hit.hitX || hit.hitY;
    if (blocked) this.game.audio.sfx('swordTink', { pitch: 0.6, volume: 0.6 });
    if (blocked || step >= left) this.enter('hold');
  }

  /** Creep back along the lane; anything solid in the way just holds it there for now. */
  private retract(dt: number): void {
    const dx = this.home.x - this.x;
    const dy = this.home.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.min(RETRACT_SPEED * dt, dist);
    if (step > 0) this.move((dx / dist) * step, (dy / dist) * step);
    if (Math.abs(this.home.x - this.x) > HOME_SNAP || Math.abs(this.home.y - this.y) > HOME_SNAP) return;
    this.x = this.home.x;
    this.y = this.home.y;
    this.rearm = REARM_TIME;
    this.enter('idle');
  }

  private enter(st: TrapState): void {
    this.st = st;
    this.stT = 0;
  }
}

registerEntity(TYPE, (game, inst) => new BladeTrap(game, inst));
