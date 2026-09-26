// Eye Statue (enemy.eye): an invulnerable stone sentry. Its eye sweeps
// clockwise through the eight directions; when the hero stands inside the
// current view cone with a clear line of sight it locks on and flashes
// briefly, then fires a fast unblockable beam where the hero stood (a quick
// sidestep dodges it) and rests for `cooldown` seconds (still sweeping).
// It starts looking along its 'facing' prop when set, else in a direction
// seeded from its id (statues in one room don't sweep in lockstep), and waits
// a moment after waking before its first lock-on.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices, Hit, Renderer } from '../../api';
import { normalize, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { Enemy, lineOfSight } from './common';

/** Eye directions in clockwise order; each is also the sprite anim name. */
export const EYE_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type EyeDir = (typeof EYE_DIRS)[number];

/** Seconds the eye rests on each of the eight directions. */
const SWEEP_STEP = 0.45;
/** Half-width of the view cone (a little over 22.5 degrees so neighbouring cones overlap). */
const CONE_HALF = (26 * Math.PI) / 180;
const SIGHT_RANGE = 10 * TILE;
/** Charge flash before the beam leaves (s) and its blink period (s). */
const CHARGE_TIME = 0.4;
const BLINK = 0.08;
const BEAM_SPEED = 220;
const BEAM_DAMAGE = 2;
/** Beam hitbox edge (px). */
const BEAM_SIZE = 6;
/** Gap (px) between the statue and a freshly fired beam. */
const MUZZLE_GAP = 0.5;
/** No lock-on for this long (s) after waking, so a hero entering the room has a moment. */
const FIRST_LOOK = 0.3;
/** Eye direction for each 'facing' prop value. */
const FACING_EYE: ReadonlyMap<unknown, EyeDir> = new Map<Dir, EyeDir>([['up', 'n'], ['right', 'e'], ['down', 's'], ['left', 'w']]);

/** Unit vectors (y down) of the eight eye directions, north first, clockwise. */
const EYE_VECS: readonly Readonly<Vec>[] = EYE_DIRS.map((_, i) => {
  const a = i * (Math.PI / 4);
  return { x: Math.sin(a), y: -Math.cos(a) };
});

/** Unit vector (y down) of eye direction `i` (0 = north, clockwise in 45 degree steps). */
export function eyeVec(i: number): Readonly<Vec> {
  return EYE_VECS[((i % 8) + 8) % 8]!;
}

/**
 * Whether `target` lies inside the view cone of eye direction `dirIndex`:
 * within `range` px of `from` and at most `halfAngle` radians off the eye axis.
 */
export function inViewCone(from: Vec, dirIndex: number, target: Vec, halfAngle: number, range: number): boolean {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (d === 0) return true;
  const v = eyeVec(dirIndex);
  return (dx * v.x + dy * v.y) / d >= Math.cos(halfAngle) - 1e-9;
}

/**
 * How far along unit vector `aim` a shot of edge `size` must start from the centre of a
 * w x h body to sit `gap` px clear of it (so it never collides with its own shooter).
 */
export function muzzleDistance(aim: Vec, w: number, h: number, size: number, gap: number): number {
  const ax = Math.abs(aim.x);
  const ay = Math.abs(aim.y);
  const alongX = ax > 0 ? (w / 2 + size / 2 + gap) / ax : Infinity;
  const alongY = ay > 0 ? (h / 2 + size / 2 + gap) / ay : Infinity;
  return Math.min(alongX, alongY);
}

/** 32-bit FNV-1a hash of `s` (a stable per-instance seed). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Where a statue's sweep starts: the eye index for a 'facing' prop (up/right/down/left),
 * else one derived from `seed`, plus how far (s) into that sweep step it already is.
 */
export function eyeStart(facing: unknown, seed: number): { dirIndex: number; sweepT: number } {
  const eye = FACING_EYE.get(facing);
  if (eye) return { dirIndex: EYE_DIRS.indexOf(eye), sweepT: 0 };
  return { dirIndex: seed % EYE_DIRS.length, sweepT: ((seed >>> 3) % 64) / 64 * SWEEP_STEP };
}

/** The eye statue sentry. */
export class EyeStatue extends Enemy {
  private charging = false;
  private chargeT = 0;
  private dirIndex: number;
  private sweepT: number;
  private cooldown = FIRST_LOOK;
  private readonly cooldownTime: number;
  /** Unit aim locked when the charge starts. */
  private readonly aim: Vec = { x: 0, y: 1 };

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.eye');
    this.sprite = 'enemy.eye';
    this.solid = true;
    // A statue: it stays exactly where it was placed (walls included).
    this.unstickOnSpawn = false;
    this.shadow = false;
    this.touchDamage = 0;
    this.cooldownTime = Math.max(0.5, this.prop('cooldown', 2));
    const start = eyeStart(inst?.props['facing'], hashString(this.id));
    this.dirIndex = start.dirIndex;
    this.sweepT = start.sweepT;
    this.play(this.eyeDir);
  }

  /** Current eye direction (sprite anim name). */
  get eyeDir(): EyeDir {
    return EYE_DIRS[this.dirIndex]!;
  }

  /** True while flashing before a shot. */
  get isCharging(): boolean {
    return this.charging;
  }

  protected think(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.charging) this.charge(dt);
    else this.sweep(dt);
    this.play(this.eyeDir);
  }

  /** Stone: every hit glances off. */
  override hurt(hit: Hit): boolean {
    if (hit.kind === 'sword' || hit.kind === 'spin') this.game.audio.sfx('swordTink');
    return false;
  }

  override draw(r: Renderer): void {
    if (!this.visible) return;
    const flash = this.charging && Math.floor(this.chargeT / BLINK) % 2 === 0;
    r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x), Math.round(this.y), { flash });
  }

  private sweep(dt: number): void {
    if (this.cooldown <= 0 && this.seesHeroInCone()) {
      this.lockOn();
      return;
    }
    this.sweepT += dt;
    if (this.sweepT < SWEEP_STEP) return;
    this.sweepT -= SWEEP_STEP;
    this.dirIndex = (this.dirIndex + 1) % EYE_DIRS.length;
  }

  /** Start the charge, aiming where the hero stands now (inside the cone, so close to the gaze). */
  private lockOn(): void {
    const v = normalize(this.hero.x - this.x, this.hero.y - this.y);
    const aim = v.x === 0 && v.y === 0 ? eyeVec(this.dirIndex) : v;
    this.aim.x = aim.x;
    this.aim.y = aim.y;
    this.charging = true;
    this.chargeT = 0;
  }

  private charge(dt: number): void {
    this.chargeT += dt;
    if (this.chargeT < CHARGE_TIME) return;
    this.fire();
    this.charging = false;
    this.cooldown = this.cooldownTime;
  }

  private seesHeroInCone(): boolean {
    if (!this.heroTargetable()) return false;
    const p = this.hero;
    return inViewCone(this, this.dirIndex, p, CONE_HALF, SIGHT_RANGE)
      && lineOfSight(this.game.room, this.x, this.y, p.x, p.y);
  }

  private fire(): void {
    const aim = this.aim;
    const d = muzzleDistance(aim, this.w, this.h, BEAM_SIZE, MUZZLE_GAP);
    this.shoot({
      sprite: 'proj.beam', x: this.x + aim.x * d, y: this.y + aim.y * d, size: BEAM_SIZE,
      vx: aim.x * BEAM_SPEED, vy: aim.y * BEAM_SPEED, damage: BEAM_DAMAGE, blockable: false, kind: 'beam',
    });
    this.game.audio.sfx('magic');
  }
}

registerEntity('enemy.eye', (game, inst) => new EyeStatue(game, inst));
