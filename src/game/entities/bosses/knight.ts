// Iron Knight (boss.knight): a heavy armoured knight with a kite shield.
//   walk    - plods toward the hero, turning to keep its shield on them; it is
//             heavy, so it only turns once the hero has stayed on another side
//             for TURN_LAG (a quick hero can reach its flank).
//   windup  - keeps turning to the hero the same way while it braces (the pose
//             always shows the side its shield covers), flashing, rattling and
//             pawing dust, then locks its aim.
//   charge  - runs in a straight line; hitting the hero hurts (2). Crashing
//             head-on into a wall stuns it; a wall it only grazes deflects the
//             charge along it; a charge that runs out of steam recovers.
//   stun    - dazed for STUN_TIME: harmless and open to hits from any side.
//   crouch  - (below half health) raises its flail, flashing and rattling, then
//   hop       hops at the hero and lands with a shockwave slam: rings of dust
//             that hurt a hero standing in them.
// While not stunned its shield blocks hits from the front (tink, the hero is
// pushed back); hits from behind or the sides land. Below half health it
// charges faster and more often. Its footprint hitbox covers the legs and torso
// only, so a KnightHelm part above it takes the hits on the helm and shoulders.
// OWNER: bosses agent.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices, Hit, Renderer } from '../../api';
import { Entity } from '../../entity';
import { DIR_VEC, normalize, vecToDir, type Vec } from '../../../core/math';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Boss, BOSS_CONTACT, type Burst } from './boss';
import { facingToward, knightVerdict, type Verdict } from './logic';

type KnightState = 'walk' | 'windup' | 'charge' | 'stun' | 'crouch' | 'hop' | 'recover';

/** Default health (catalog default wins when set). */
const KNIGHT_HP = 16;
/** At or below this fraction of its health the knight is enraged. */
const ENRAGE_AT = 0.5;
/** Seconds the hero must stay off to another side before the heavy knight turns to face them. */
const TURN_LAG = 0.3;

/** Per-phase tuning (CALM above half health, ENRAGED at or below). */
interface Tuning {
  walkSpeed: number;
  /** Walk time before the next attack (s). */
  walkMin: number;
  walkMax: number;
  windup: number;
  chargeSpeed: number;
  /** Chance that an attack is a hop-slam instead of a charge (0 = never). */
  slamChance: number;
}

const CALM: Tuning = { walkSpeed: 32, walkMin: 1.6, walkMax: 2.6, windup: 0.8, chargeSpeed: 150, slamChance: 0 };
const ENRAGED: Tuning = { walkSpeed: 42, walkMin: 0.7, walkMax: 1.4, windup: 0.5, chargeSpeed: 205, slamChance: 0.4 };

/** Once slams are unlocked, never more than this many charges in a row. */
const MAX_CHARGES_IN_ROW = 2;
/** A charge that has not hit a wall after this many px winds down. */
const CHARGE_MAX = 320;
/**
 * A charge blocked on an axis that carries at least this share of its direction
 * hit the obstacle head-on (a crash); a smaller share only grazes it, and the
 * charge carries on along the obstacle.
 */
const HEAD_ON = 0.5;
/** A head-on block only stuns after this many px of charging (earlier, the charge just glances off). */
const CRASH_MIN_RUN = 16;
/** Walk-cycle speed-up while charging (extra anim seconds per second). */
const CHARGE_ANIM_BOOST = 1.5;
/** Dust puffs kicked up while charging / pawing in the wind-up (s between puffs). */
const CHARGE_DUST_EVERY = 0.09;
const PAW_DUST_EVERY = 0.2;
/** Walk-cycle speed-up while pawing the ground in the wind-up. */
const PAW_ANIM_BOOST = 1;
/** Stun after crashing into a wall (s), and the recoil off the wall (px over s). */
const STUN_TIME = 2.5;
const CRASH_RECOIL = 6;
const CRASH_RECOIL_TIME = 0.15;
/** Pause after a spent charge or a slam (s). */
const RECOVER_TIME = 0.5;
/** Telegraph flash (s per blink) / flash and rattle rates (toggles per second) of the wind-up and crouch. */
const TELEGRAPH_FLASH = 0.05;
const TELEGRAPH_FLASH_HZ = 10;
const TELEGRAPH_SHAKE_HZ = 30;
/** Hop-slam: crouch telegraph (s), peak height (px), airtime (s) and max reach toward the hero (px). */
const CROUCH_TIME = 0.4;
const HOP_HEIGHT = 14;
const HOP_TIME = 0.55;
const HOP_REACH = 48;
/** Shockwave rings: radius of each ring (px), spacing in time (s), puffs per ring, damage. */
const SHOCK_RINGS = [12, 22, 32] as const;
const SHOCK_EVERY = 0.08;
const SHOCK_PUFFS = 8;
const SHOCK_DAMAGE = 2;
/** The hero is caught by a ring within this many px beyond its radius, if lower than SHOCK_MAX_Z. */
const SHOCK_REACH = 5;
const SHOCK_MAX_Z = 2;
/** The shield pushes a blocked hero back this far (px over s). */
const SHIELD_RECOIL = 14;
const SHIELD_RECOIL_TIME = 0.12;
/** Death: number of bursts (two bossDie sounds) and their spread around the upper body. */
const DEATH_BURSTS = 12;
const DEATH_SPREAD = 14;
/** Angle step (radians) between consecutive bursts, so they scatter evenly around the knight. */
const GOLDEN_ANGLE = 2.4;
/** The sprite's visual centre sits this far above the hitbox centre (px). */
const BODY_DY = 8;
/** Hurt box over the helm and shoulders (px); its centre sits HELM_DY above the hitbox centre, bottom on its top edge. */
const HELM_W = 20;
const HELM_H = 12;
const HELM_DY = 16;

/**
 * The knight's helm and shoulders, which stand above its 20 px footprint: not
 * solid and harmless to touch, but a blow that lands on it is judged as a blow
 * on the knight (same shield rule, same i-frames).
 */
export class KnightHelm extends Entity {
  private readonly knight: Knight;

  constructor(knight: Knight) {
    super(knight.game, null, 'boss.knight.helm');
    this.knight = knight;
    this.team = 'enemy';
    this.mover = 'ghost';
    this.w = HELM_W;
    this.h = HELM_H;
    this.follow();
  }

  /** Sit on top of the knight's hitbox. */
  follow(): void {
    this.x = this.knight.x;
    this.y = this.knight.y - HELM_DY;
  }

  override hurt(hit: Hit): boolean {
    return this.knight.strike(this.knight, hit);
  }

  /** Generic kills of the helm kill the knight. */
  override die(): void {
    this.knight.die();
  }
}

/** The Iron Knight boss (see file header for its states). */
export class Knight extends Boss {
  private st: KnightState = 'walk';
  /** Seconds spent in the current state. */
  private stT = 0;
  /** Length of the current timed state (walk / windup / crouch / stun / recover). */
  private stLen = 0;
  /** Unit direction of the current charge. */
  private aim: Vec = { x: 0, y: 1 };
  private charged = 0;
  private dustT = 0;
  /** Seconds since the current slam landed (null = no shockwave running). */
  private shockT: number | null = null;
  private shockRing = 0;
  private shockHit = false;
  private shockAt: Vec = { x: 0, y: 0 };
  private raged = false;
  /** Charges since the last hop-slam. */
  private chargesInRow = 0;
  /** How long the hero has been off to another side (s). */
  private turnT = 0;
  /** Hurt box over the helm and shoulders. */
  readonly helm: KnightHelm;

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, KNIGHT_HP);
    this.sprite = 'boss.knight';
    this.invulnOnHit = 0.5;
    this.stLen = this.walkTime();
    this.holdFrame(`walk_${this.facing}`);
    this.helm = game.spawn(new KnightHelm(this));
  }

  /** Current behaviour state (tests / debugging). */
  get aiState(): KnightState {
    return this.st;
  }

  /** At or below half health: faster, more frequent charges and hop-slams. */
  get enraged(): boolean {
    return this.healthFraction <= ENRAGE_AT;
  }

  override onLand(): void {
    if (this.st !== 'hop' || this.dying) return;
    this.slam();
  }

  override update(dt: number): void {
    super.update(dt);
    this.helm.follow();
  }

  /** The helm goes with the knight (death, leaving the room, a trigger). */
  override onRemove(): void {
    super.onRemove();
    this.helm.dead = true;
  }

  /** Rattles in place while telegraphing an attack. */
  override draw(r: Renderer): void {
    if ((this.st !== 'windup' && this.st !== 'crouch') || this.dying) {
      super.draw(r);
      return;
    }
    const x = this.x;
    this.x = x + (Math.floor(this.stT * TELEGRAPH_SHAKE_HZ) % 2 === 0 ? 1 : -1);
    try {
      super.draw(r);
    } finally {
      this.x = x;
    }
  }

  protected override idle(dt: number): void {
    this.faceHero(dt);
    this.holdFrame(`walk_${this.facing}`);
  }

  protected fight(dt: number): void {
    this.stT += dt;
    this.tickShock(dt);
    switch (this.st) {
      case 'walk': this.walk(dt); break;
      case 'windup': this.windup(dt); break;
      case 'charge': this.charge(dt); break;
      case 'stun': this.stunned(); break;
      case 'crouch': this.crouch(dt); break;
      case 'hop': break;
      case 'recover': this.recover(); break;
    }
  }

  protected judge(_part: Entity, hit: Hit): Verdict {
    return knightVerdict(this.facing, this.st === 'stun', hit, this.x, this.y);
  }

  /** Shakes the room when it first drops to half health; hit while walking, it turns to face the hero. */
  protected override onWound(): void {
    if (!this.raged && this.enraged) {
      this.raged = true;
      this.game.camera.shake(0.3, 2);
    }
    if (this.st === 'walk') this.turnTo(this.dirTo(this.hero));
  }

  /** The shield shoves a sword-swinging hero back. */
  protected override onBlocked(hit: Hit): void {
    if (hit.source !== this.hero || (hit.kind !== 'sword' && hit.kind !== 'spin')) return;
    const away = normalize(this.hero.x - this.x, this.hero.y - this.y);
    this.hero.knock(away.x, away.y, SHIELD_RECOIL, SHIELD_RECOIL_TIME);
  }

  /** A dozen explosions spiralling over the armour. */
  protected deathBursts(): Burst[] {
    const out: Burst[] = [];
    for (let i = 0; i < DEATH_BURSTS; i++) {
      const a = i * GOLDEN_ANGLE;
      const r = DEATH_SPREAD * rng.range(0.3, 1);
      out.push({ x: this.x + Math.cos(a) * r, y: this.y - BODY_DY + Math.sin(a) * r * 0.8 });
    }
    return out;
  }

  protected override onBurst(i: number): void {
    if (i === DEATH_BURSTS - 1) this.visible = false;
  }

  // ------------------------------------------------------------------ states

  private get tune(): Tuning {
    return this.enraged ? ENRAGED : CALM;
  }

  private enter(st: KnightState, len = 0): void {
    this.st = st;
    this.stT = 0;
    this.stLen = len;
    this.dustT = 0;
    this.turnT = 0;
  }

  private walkTime(): number {
    return rng.range(this.tune.walkMin, this.tune.walkMax);
  }

  /**
   * Turn toward the hero once they have stayed TURN_LAG s on another side; near
   * a diagonal the current facing is kept (its shield covers that bearing).
   */
  private faceHero(dt: number): void {
    const want = facingToward(this.facing, this.hero.x - this.x, this.hero.y - this.y);
    if (want === this.facing) {
      this.turnT = 0;
      return;
    }
    this.turnT += dt;
    if (this.turnT >= TURN_LAG) this.turnTo(want);
  }

  private turnTo(dir: Dir): void {
    this.facing = dir;
    this.turnT = 0;
  }

  private walk(dt: number): void {
    if (!this.heroTargetable()) {
      this.holdFrame(`walk_${this.facing}`);
      return;
    }
    const facing = this.facing;
    this.chase(this.hero, this.tune.walkSpeed, dt);
    this.facing = facing;
    this.faceHero(dt);
    this.playDir('walk');
    if (this.stT < this.stLen) return;
    const slams = this.tune.slamChance > 0 && (this.chargesInRow >= MAX_CHARGES_IN_ROW || rng.chance(this.tune.slamChance));
    if (slams) {
      this.chargesInRow = 0;
      this.startHop();
    } else {
      this.chargesInRow++;
      this.enter('windup', this.tune.windup);
    }
  }

  /** Braced toward the hero: the front-facing charge pose when facing down, else pawing the ground. */
  private windup(dt: number): void {
    this.faceHero(dt);
    if (this.facing === 'down') {
      this.play('charge');
    } else {
      this.playDir('walk');
      this.animT += dt * PAW_ANIM_BOOST;
    }
    this.kickDust(dt, PAW_DUST_EVERY, DIR_VEC[this.facing]);
    this.telegraph();
    if (this.stT < this.stLen) return;
    this.hitFlash = 0;
    const v = normalize(this.hero.x - this.x, this.hero.y - this.y);
    this.aim = v.x === 0 && v.y === 0 ? DIR_VEC[this.facing] : v;
    this.facing = vecToDir(this.aim.x, this.aim.y, this.facing);
    this.charged = 0;
    this.enter('charge');
    this.game.audio.sfx('dash');
  }

  private charge(dt: number): void {
    this.playDir('walk');
    this.animT += dt * CHARGE_ANIM_BOOST;
    const step = this.tune.chargeSpeed * dt;
    const x0 = this.x;
    const y0 = this.y;
    const { hitX, hitY } = this.move(this.aim.x * step, this.aim.y * step);
    this.charged += Math.hypot(this.x - x0, this.y - y0);
    this.kickDust(dt, CHARGE_DUST_EVERY, this.aim);
    if (hitX || hitY) this.blocked(hitX, hitY);
    else if (this.charged >= CHARGE_MAX) this.enter('recover', RECOVER_TIME);
  }

  /**
   * The charge ran into something: head-on after a real run-up it is a crash;
   * otherwise the blocked part of the aim is dropped and the charge carries on
   * along the obstacle (it winds down when nothing is left).
   */
  private blocked(hitX: boolean, hitY: boolean): void {
    const headOn = (hitX && Math.abs(this.aim.x) >= HEAD_ON) || (hitY && Math.abs(this.aim.y) >= HEAD_ON);
    if (headOn && this.charged >= CRASH_MIN_RUN) {
      this.crash();
      return;
    }
    const along = normalize(hitX ? 0 : this.aim.x, hitY ? 0 : this.aim.y);
    if (along.x === 0 && along.y === 0) {
      this.enter('recover', RECOVER_TIME);
      return;
    }
    this.aim = along;
    this.facing = vecToDir(along.x, along.y, this.facing);
  }

  /** Slammed into a wall: recoil, shake, dust, and a long daze. */
  private crash(): void {
    this.knock(-this.aim.x, -this.aim.y, CRASH_RECOIL, CRASH_RECOIL_TIME);
    this.game.camera.shake(0.4, 3);
    this.game.audio.sfx('explode', { pitch: 0.6 });
    const front = { x: this.x + this.aim.x * this.w / 2, y: this.y + this.aim.y * this.h / 2 };
    for (const s of [-1, 1]) this.game.effect('fx.dust', 'play', front.x + this.aim.y * s * 8, front.y - this.aim.x * s * 8);
    this.touchDamage = this.contactDamage = 0;
    this.enter('stun', STUN_TIME);
    this.play('stun', true);
  }

  private stunned(): void {
    this.play('stun');
    if (this.stT < this.stLen) return;
    this.touchDamage = BOSS_CONTACT;
    this.enter('walk', this.walkTime());
  }

  private recover(): void {
    this.holdFrame(`walk_${this.facing}`);
    if (this.stT >= this.stLen) this.enter('walk', this.walkTime());
  }

  /** Begin a hop-slam: the crouch telegraph (flail raised, flashing, rattling), then the leap. */
  private startHop(): void {
    this.enter('crouch', CROUCH_TIME);
    this.holdFrame(`attack_${this.facing}`);
    this.game.audio.sfx('push', { pitch: 0.7 });
  }

  private crouch(dt: number): void {
    this.faceHero(dt);
    this.holdFrame(`attack_${this.facing}`);
    this.telegraph();
    if (this.stT < this.stLen) return;
    this.hitFlash = 0;
    this.leap();
  }

  /** Hop at where the hero stands now (at most HOP_REACH px). */
  private leap(): void {
    const dx = this.hero.x - this.x;
    const dy = this.hero.y - this.y;
    const d = Math.hypot(dx, dy);
    const reach = d > HOP_REACH ? HOP_REACH / d : 1;
    this.facing = vecToDir(dx, dy, this.facing);
    this.enter('hop');
    this.holdFrame(`attack_${this.facing}`);
    this.hop(dx * reach, dy * reach, HOP_HEIGHT, HOP_TIME);
    this.game.audio.sfx('jump', { pitch: 0.7 });
  }

  private slam(): void {
    this.game.camera.shake(0.3, 3);
    this.game.audio.sfx('explode', { pitch: 0.9 });
    this.shockT = 0;
    this.shockRing = 0;
    this.shockHit = false;
    this.shockAt = { x: this.x, y: this.y + this.h / 2 - 2 };
    this.enter('recover', RECOVER_TIME);
  }

  /** The attack telegraph's white flash. */
  private telegraph(): void {
    this.hitFlash = Math.floor(this.stT * TELEGRAPH_FLASH_HZ) % 2 === 0 ? TELEGRAPH_FLASH : 0;
  }

  /** Emit the shockwave's dust rings on schedule; each ring hurts a grounded hero inside it (once per slam). */
  private tickShock(dt: number): void {
    if (this.shockT === null) return;
    this.shockT += dt;
    while (this.shockRing < SHOCK_RINGS.length && this.shockT >= this.shockRing * SHOCK_EVERY) {
      this.emitRing(SHOCK_RINGS[this.shockRing]!, this.shockRing);
      this.shockRing++;
    }
    if (this.shockRing >= SHOCK_RINGS.length) this.shockT = null;
  }

  private emitRing(radius: number, n: number): void {
    const at = this.shockAt;
    for (let i = 0; i < SHOCK_PUFFS; i++) {
      const a = ((i + (n % 2) * 0.5) / SHOCK_PUFFS) * 2 * Math.PI;
      this.game.effect('fx.dust', 'play', at.x + Math.cos(a) * radius, at.y + Math.sin(a) * radius * 0.75);
    }
    const hero = this.hero;
    if (this.shockHit || hero.z >= SHOCK_MAX_Z || Math.hypot(hero.x - at.x, hero.y - at.y) > radius + SHOCK_REACH) return;
    this.shockHit = true;
    const away = normalize(hero.x - at.x, hero.y - at.y);
    hero.hurtPlayer({ damage: SHOCK_DAMAGE, kind: 'contact', source: this, dx: away.x, dy: away.y });
  }

  /** A dust puff at the feet, behind the unit direction `ahead`, every `every` s. */
  private kickDust(dt: number, every: number, ahead: Vec): void {
    this.dustT -= dt;
    if (this.dustT > 0) return;
    this.dustT = every;
    this.game.effect('fx.dust', 'play', this.x - ahead.x * 8, this.y + this.h / 2 - 2);
  }
}

registerEntity('boss.knight', (game, inst) => new Knight(game, inst));
