// Ghost (enemy.ghost): drifts through walls toward the hero with a sine
// wobble, cycling visible (2.5 s) -> fading out -> nearly invisible (1.5 s,
// untouchable and harmless) -> fading in. It can only be hurt while solid
// enough to see; while faded, weapons and shots pass straight through it.
import type { EntityInstance } from '../../../core/types';
import type { GameServices, Hit, Renderer } from '../../api';
import { clamp, lerp, normalize, type Vec } from '../../../core/math';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

const HP = 2;
const CONTACT_DAMAGE = 1;
const DRIFT_SPEED = 22;
/** Sideways wobble: peak speed (px/s) and angular frequency (rad/s). */
const WOBBLE_SPEED = 24;
const WOBBLE_FREQ = 3;
/** Hover bob: base height, amplitude (px) and angular frequency (rad/s). */
const BOB_BASE = 3;
const BOB_AMP = 1.5;
const BOB_FREQ = 4;
const FADED_ALPHA = 0.15;
/** Below this alpha the ghost can neither hurt nor be hurt. */
const TANGIBLE_ALPHA = 0.5;
/** Farthest (px) loot is moved out of a wall the ghost died over. */
const LOOT_REACH = 48;

/** Visibility cycle phases in order, with their lengths (s). */
const PHASES = [
  { name: 'visible', time: 2.5 },
  { name: 'fadeOut', time: 0.5 },
  { name: 'invisible', time: 1.5 },
  { name: 'fadeIn', time: 0.5 },
] as const;
const CYCLE = PHASES.reduce((s, p) => s + p.time, 0);

export type GhostPhase = (typeof PHASES)[number]['name'];

/** Time into the current visibility cycle (s). */
function cycleTime(t: number): number {
  return ((t % CYCLE) + CYCLE) % CYCLE;
}

/** Visibility phase at time `t` (s) into the cycle. */
export function ghostPhaseAt(t: number): GhostPhase {
  let rest = cycleTime(t);
  for (const p of PHASES) {
    if (rest < p.time) return p.name;
    rest -= p.time;
  }
  return 'visible';
}

/** Draw alpha at time `t` (s) into the cycle. */
export function ghostAlphaAt(t: number): number {
  let rest = cycleTime(t);
  for (const p of PHASES) {
    if (rest < p.time) return phaseAlpha(p.name, rest / p.time);
    rest -= p.time;
  }
  return 1;
}

function phaseAlpha(phase: GhostPhase, k: number): number {
  switch (phase) {
    case 'visible': return 1;
    case 'fadeOut': return lerp(1, FADED_ALPHA, k);
    case 'invisible': return FADED_ALPHA;
    case 'fadeIn': return lerp(FADED_ALPHA, 1, k);
  }
}

/** The ghost. */
export class Ghost extends Enemy {
  private cycleT = rng.range(0, 1);
  private wobbleT = rng.range(0, Math.PI * 2);
  private alpha = 1;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.ghost');
    this.sprite = 'enemy.ghost';
    this.anim = 'float';
    this.mover = 'ghost';
    this.drawLayer = 'above';
    this.shadow = false;
    this.avoidHazards = false;
    this.hp = HP;
    this.maxHp = HP;
    this.touchDamage = CONTACT_DAMAGE;
    this.z = BOB_BASE;
  }

  /** Solid enough to touch (and to be hit). */
  get tangible(): boolean {
    return this.alpha >= TANGIBLE_ALPHA;
  }

  /** Current visibility phase (tests & debugging). */
  get phase(): GhostPhase {
    return ghostPhaseAt(this.cycleT);
  }

  /**
   * The fade cycle runs before the base mirrors touchDamage (so contact matches the look this
   * tick). While faded it leaves the enemy team, so hero attacks treat it as thin air (they pass
   * instead of glancing off). Knockbacks pass through walls, so it is kept inside the room.
   */
  override tickCommon(dt: number): void {
    this.cycleT += dt;
    this.alpha = ghostAlphaAt(this.cycleT);
    const tangible = this.tangible;
    this.team = tangible ? 'enemy' : 'neutral';
    this.touchDamage = tangible ? CONTACT_DAMAGE : 0;
    super.tickCommon(dt);
    this.keepInRoom();
  }

  protected think(dt: number): void {
    this.wobbleT += dt;
    this.z = BOB_BASE + Math.sin(this.wobbleT * BOB_FREQ) * BOB_AMP;
    if (this.heroTargetable()) this.drift(dt);
    this.keepInRoom();
  }

  override hurt(hit: Hit): boolean {
    return this.tangible && super.hurt(hit);
  }

  /** Loot lands on walkable ground, never inside a wall; none if no floor is close. */
  protected override lootAt(): Vec | null {
    return this.floorSpotNear(LOOT_REACH);
  }

  override draw(r: Renderer): void {
    if (!this.visible) return;
    if (this.invuln > 0 && this.hitFlash <= 0 && Math.floor(this.invuln * 30) % 2 === 0) return;
    const shake = this.stun > 0 ? (Math.floor(this.game.time * 30) % 2 === 0 ? 1 : -1) : 0;
    r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x) + shake, Math.round(this.y - this.z), {
      alpha: this.alpha,
      flash: this.hitFlash > 0,
    });
  }

  private drift(dt: number): void {
    const to = normalize(this.hero.x - this.x, this.hero.y - this.y);
    const side = Math.sin(this.wobbleT * WOBBLE_FREQ) * WOBBLE_SPEED;
    this.stepBy((to.x * DRIFT_SPEED - to.y * side) * dt, (to.y * DRIFT_SPEED + to.x * side) * dt);
  }

  private keepInRoom(): void {
    const room = this.game.room;
    this.x = clamp(this.x, this.w / 2, room.width - this.w / 2);
    this.y = clamp(this.y, this.h / 2, room.height - this.h / 2);
  }
}

registerEntity('enemy.ghost', (game, inst) => new Ghost(game, inst));
