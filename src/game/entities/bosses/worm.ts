// Giant Worm (boss.worm): an armoured head, `segments` body segments and a
// glowing tail. The head crawls in straight lines at any angle, bounces off
// walls, and now and then turns (sometimes toward the hero) or puts on a burst
// of speed; every other part trails it along the exact path the head covered
// (WormPath). Touching any part hurts (2) and knocks the hero back. Only the
// tail takes damage — blades and arrows; everything else tinks — and each hit
// flashes it, gives it i-frames and makes the worm faster (its cruise stays
// below the hero's walking speed: cutting it off is the skill, not outrunning
// it). At 0 HP the parts burst from tail to head, then the heart container drops.
// In a dark room every piece glows faintly and the tail brightest; in a tight
// pocket quick repeat bounces slide the head out along the wall instead of
// rattling it in place.
// The head is this entity; body segments and the tail are WormPart entities it
// spawns (so weapons and contact damage find them) and positions every tick.
// Every piece's ground shadow is a WormShadow on the 'ground' draw layer, so
// all shadows sit under every piece and the hero.
// OWNER: bosses agent.
import type { EntityInstance } from '../../../core/types';
import type { DrawOpts, GameServices, Hit, Renderer } from '../../api';
import { Entity } from '../../entity';
import { approach, clamp, lerp, normalize, type Vec } from '../../../core/math';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { Boss, BOOMS_PER_SFX, intProp, type Burst } from './boss';
import { wormVerdict, type Verdict, type WormPartKind } from './logic';
import { WormPath, wormOffsets } from './wormPath';

/** Default health (catalog default wins when set). */
const WORM_HP = 12;
/** Crawl speed at full health and at its last hit point (px/s); the hero walks at 88. */
const SPEED_CALM = 46;
const SPEED_RAGE = 78;
/** Speed multiplier while dashing, at full health and at the last hit point. */
const DASH_CALM = 1.6;
const DASH_RAGE = 1.25;
/** How long a dash / the flinch after a hit lasts (s). */
const DASH_TIME = 0.9;
const FLINCH_TIME = 0.8;
/** How fast the speed changes (px/s per second). */
const ACCEL = 150;
/** Max turn rate (radians/s). */
const TURN_RATE = 3.6;
/** Seconds between steering decisions at full health (shortened by up to RAGE_HASTE when hurt). */
const DECIDE_MIN = 0.9;
const DECIDE_MAX = 2;
const RAGE_HASTE = 0.45;
/** Decision odds: dash, hunt (turn toward the hero); otherwise a random turn. */
const DASH_CHANCE = 0.2;
const HUNT_CHANCE = 0.3;
/** Random turn size (radians) and the aim error when hunting. */
const TURN_MIN = 0.5;
const TURN_MAX = 2;
const HUNT_ERROR = 0.35;
/** Random spread (radians) added to wall bounces so it never settles into one line. */
const BOUNCE_JITTER = 0.3;
/** A bounce must leave the wall at least this steeply (component of the unit heading). */
const BOUNCE_MIN = 0.3;
/** A bounce this soon (s) after the previous one is a repeat (a tight pocket): no jitter, slide out. */
const BOUNCE_SETTLE = 0.25;
/** Below this, a heading component counts as zero (the heading runs straight at the wall). */
const STRAIGHT_AT = 1e-6;
/** Part hitboxes (px) and the tail's i-frames (s). */
const BODY_SIZE = 16;
const TAIL_SIZE = 12;
const TAIL_IFRAMES = 0.5;
/** Light radius (px) in dark rooms: the glowing tail brightest, the eyes and each segment a faint glow. */
const TAIL_LIGHT = 20;
const HEAD_LIGHT = 14;
const BODY_LIGHT = 10;
/** Extra trail kept beyond the tail (px). */
const PATH_SLACK = 8;
/** Candidate headings tried when laying out the starting trail. */
const START_HEADINGS = 16;
/** Crawl undulation: amplitude (px), phase per px crawled, phase lag per part. */
const BOB = 1.5;
const BOB_PER_PX = 0.12;
const BOB_LAG = 0.9;
/** Depth-sort nudge (px) so the glowing tail is drawn over the body segment beside it. */
const TAIL_SORT = 2;
/** Spread (px) of the extra death bursts around the head. */
const HEAD_SPREAD = 12;
/** The head faces the camera; heading this far upward (sine of the angle) draws it flipped. */
const FLIP_UP = -0.5;

/** Ground shadow of each piece: width and offset below the piece's centre (px). */
const SHADOWS: Readonly<Record<WormPartKind, { w: number; dy: number }>> = {
  head: { w: 24, dy: 10 },
  body: { w: 18, dy: 8 },
  tail: { w: 12, dy: 6 },
};

/** Smallest signed angle (radians, -PI..PI) turning `from` onto `to`. */
export function angleDelta(from: number, to: number): number {
  const d = (to - from) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
}

/**
 * Heading (radians) after bouncing off a wall: the blocked components are
 * reflected, a random `jitter` is added unless it would aim back into the wall
 * or leave it too shallowly. A `repeat` bounce (right after another one, in a
 * tight pocket) gets no jitter; off a single wall it leaves at the shallowest
 * allowed angle, so the worm slides out along it instead of rattling in place.
 */
export function bounceHeading(heading: number, hitX: boolean, hitY: boolean, jitter: number, repeat = false): number {
  const vx = hitX ? -Math.cos(heading) : Math.cos(heading);
  const vy = hitY ? -Math.sin(heading) : Math.sin(heading);
  if (repeat && hitX !== hitY) return slideOff(vx, vy, hitX, jitter);
  const reflected = Math.atan2(vy, vx);
  if (repeat) return reflected;
  const a = reflected + jitter;
  const leavesX = !hitX || Math.cos(a) * Math.sign(vx) >= BOUNCE_MIN;
  const leavesY = !hitY || Math.sin(a) * Math.sign(vy) >= BOUNCE_MIN;
  return leavesX && leavesY ? a : reflected;
}

/**
 * Leave the wall blocking one axis (x when `hitX`) at BOUNCE_MIN, keeping the
 * way (vx, vy) runs along it (the sign of `tieBreak` when it runs straight at it).
 */
function slideOff(vx: number, vy: number, hitX: boolean, tieBreak: number): number {
  const along = Math.sqrt(1 - BOUNCE_MIN * BOUNCE_MIN);
  const side = (v: number): number => (Math.abs(v) > STRAIGHT_AT ? Math.sign(v) : tieBreak < 0 ? -1 : 1);
  return hitX
    ? Math.atan2(side(vy) * along, Math.sign(vx) * BOUNCE_MIN)
    : Math.atan2(Math.sign(vy) * BOUNCE_MIN, side(vx) * along);
}

/** Reused draw options (one piece is drawn at a time). */
const PIECE_OPTS: DrawOpts = { flipY: false, flash: false };

/**
 * Draw one worm piece (the anim is named after the part) raised by `lift` px,
 * with i-frame flicker and hit flash. Its shadow is a separate WormShadow.
 */
function drawPiece(r: Renderer, e: Entity, kind: WormPartKind, lift: number, flipY: boolean): void {
  if (!e.visible) return;
  if (e.invuln > 0 && e.hitFlash <= 0 && Math.floor(e.invuln * 30) % 2 === 0) return;
  PIECE_OPTS.flipY = flipY;
  PIECE_OPTS.flash = e.hitFlash > 0;
  r.drawSpriteAnim('boss.worm', kind, e.animT, Math.round(e.x), Math.round(e.y) - lift, PIECE_OPTS);
}

/** The ground shadow under one worm piece; hidden with the piece, positioned by the worm. */
export class WormShadow extends Entity {
  private readonly piece: Entity;
  private readonly size: { w: number; dy: number };

  constructor(piece: Entity, kind: WormPartKind) {
    super(piece.game, null, 'boss.worm.shadow');
    this.piece = piece;
    this.size = SHADOWS[kind];
    this.drawLayer = 'ground';
    this.mover = 'ghost';
    this.w = this.h = 0;
    this.follow();
  }

  /** Move to the piece (culling and drawing use this entity's position). */
  follow(): void {
    this.x = this.piece.x;
    this.y = this.piece.y;
  }

  override draw(r: Renderer): void {
    if (this.piece.visible) r.drawShadow(Math.round(this.x), Math.round(this.y) + this.size.dy, this.size.w);
  }
}

/** A body segment or the tail: follows the head's path; hits and kills are routed to the worm. */
export class WormPart extends Entity {
  readonly kind: 'body' | 'tail';
  /** Position in the chain (0 = right behind the head). */
  readonly index: number;
  private readonly worm: Worm;

  constructor(worm: Worm, kind: 'body' | 'tail', index: number) {
    super(worm.game, null, `boss.worm.${kind}`);
    this.worm = worm;
    this.kind = kind;
    this.index = index;
    this.team = 'enemy';
    this.mover = 'ghost';
    this.sprite = 'boss.worm';
    this.anim = kind;
    this.w = this.h = kind === 'tail' ? TAIL_SIZE : BODY_SIZE;
    this.invulnOnHit = TAIL_IFRAMES;
    this.sortBias = kind === 'tail' ? TAIL_SORT : 0;
    this.light = kind === 'tail' ? TAIL_LIGHT : BODY_LIGHT;
  }

  override hurt(hit: Hit): boolean {
    return this.worm.strike(this, hit);
  }

  /** Generic kills of a part kill the whole worm (never a lone segment with loot). */
  override die(): void {
    this.worm.die();
  }

  /** Remove the part from play but keep drawing it (the outgoing room of a scroll still shows it). */
  retire(): void {
    this.dead = true;
    this.contactDamage = 0;
  }

  /** Burst: gone from play and from view. */
  vanish(): void {
    this.retire();
    this.visible = false;
  }

  override draw(r: Renderer): void {
    drawPiece(r, this, this.kind, this.worm.bobAt(this.index + 1), false);
  }
}

/** The worm's head: owns the recorded path, the steering and the trailing parts. */
export class Worm extends Boss {
  /** Body segments followed by the tail (last). */
  readonly parts: WormPart[] = [];
  /** Current crawl speed (px/s). */
  speed = 0;
  /** Heading of the head (radians; 0 = right, PI/2 = down). */
  heading = 0;
  private readonly shadows: WormShadow[] = [];
  private targetHeading = 0;
  private readonly offsets: number[];
  private readonly path: WormPath;
  private dashT = 0;
  private decideT = rng.range(DECIDE_MIN, DECIDE_MAX);
  /** Index of the death burst that finishes the head. */
  private headBurst = -1;
  /** Distance crawled (px); drives the undulation. */
  private crawled = 0;
  /** Seconds since the head last bounced. */
  private sinceBounce = Infinity;

  /**
   * Lays out the starting trail and spawns the parts and shadows right away,
   * so the whole worm is already there while a scroll transition slides the room in.
   */
  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, WORM_HP);
    this.sprite = 'boss.worm';
    this.anim = 'head';
    this.light = HEAD_LIGHT;
    const bodies = intProp(this, 'segments', 4, 2, 8);
    this.offsets = wormOffsets(bodies);
    this.path = new WormPath(this.offsets[this.offsets.length - 1]! + PATH_SLACK);
    this.heading = this.targetHeading = this.startHeading();
    this.path.reset(this.x, this.y, -Math.cos(this.heading), -Math.sin(this.heading), (p) => this.clampToRoom(p));
    for (let i = 0; i <= bodies; i++) {
      this.parts.push(game.spawn(new WormPart(this, i < bodies ? 'body' : 'tail', i)));
    }
    this.placeParts();
    this.shadows.push(game.spawn(new WormShadow(this, 'head')));
    for (const p of this.parts) this.shadows.push(game.spawn(new WormShadow(p, p.kind)));
  }

  /** The glowing weak point. */
  get tail(): WormPart {
    return this.parts[this.parts.length - 1]!;
  }

  /** Arc-length distance of each part behind the head (tests). */
  get partOffsets(): readonly number[] {
    return this.offsets;
  }

  /** Undulation lift (px) of chain position `i` (0 = the head). */
  bobAt(i: number): number {
    return Math.round(BOB * (1 + Math.sin(this.crawled * BOB_PER_PX - i * BOB_LAG)));
  }

  override update(dt: number): void {
    super.update(dt);
    this.placeParts();
  }

  /** Leaving the room (or removed by a trigger): parts and shadows go too, still drawn by a scroll-out. */
  override onRemove(): void {
    super.onRemove();
    for (const p of this.parts) p.retire();
    for (const s of this.shadows) s.dead = true;
  }

  override draw(r: Renderer): void {
    drawPiece(r, this, 'head', this.bobAt(0), Math.sin(this.heading) < FLIP_UP);
  }

  protected fight(dt: number): void {
    this.decideT -= dt;
    if (this.decideT <= 0) this.decide();
    this.dashT = Math.max(0, this.dashT - dt);
    const turn = angleDelta(this.heading, this.targetHeading);
    this.heading += clamp(turn, -TURN_RATE * dt, TURN_RATE * dt);
    const rage = this.rage();
    const boost = this.dashT > 0 ? lerp(DASH_CALM, DASH_RAGE, rage) : 1;
    this.speed = approach(this.speed, lerp(SPEED_CALM, SPEED_RAGE, rage) * boost, ACCEL * dt);
    this.crawl(dt);
  }

  protected judge(part: Entity, hit: Hit): Verdict {
    return wormVerdict(part === this ? 'head' : (part as WormPart).kind, hit);
  }

  /** Flinch: a burst of speed (the lasting speed-up comes from rage()). */
  protected override onWound(): void {
    this.dashT = FLINCH_TIME;
  }

  protected override blink(on: boolean): void {
    super.blink(on);
    for (const p of this.parts) p.hitFlash = this.hitFlash;
  }

  /**
   * Tail to head, one burst per part; extra bursts around the head pad the
   * sequence to whole bossDie sounds, and the head goes last.
   */
  protected deathBursts(): Burst[] {
    const chain: Burst[] = [...this.parts].reverse().map((p) => ({ x: p.x, y: p.y }));
    const total = Math.ceil((chain.length + 1) / BOOMS_PER_SFX) * BOOMS_PER_SFX;
    while (chain.length < total - 1) {
      chain.push({ x: this.x + rng.range(-HEAD_SPREAD, HEAD_SPREAD), y: this.y + rng.range(-HEAD_SPREAD, HEAD_SPREAD) });
    }
    chain.push({ x: this.x, y: this.y });
    this.headBurst = chain.length - 1;
    return chain;
  }

  protected override onBurst(i: number): void {
    const n = this.parts.length;
    if (i < n) this.parts[n - 1 - i]!.vanish();
    else if (i === this.headBurst) this.visible = false;
  }

  /** 0 at full health, rising to 1 at the last hit point. */
  private rage(): number {
    return this.maxHp > 1 ? clamp((this.maxHp - this.hp) / (this.maxHp - 1), 0, 1) : 0;
  }

  private decide(): void {
    this.decideT = rng.range(DECIDE_MIN, DECIDE_MAX) * (1 - RAGE_HASTE * this.rage());
    const roll = rng.next();
    if (roll < DASH_CHANCE) {
      this.dashT = DASH_TIME;
    } else if (roll < DASH_CHANCE + HUNT_CHANCE && this.heroTargetable()) {
      this.targetHeading = Math.atan2(this.hero.y - this.y, this.hero.x - this.x) + rng.range(-HUNT_ERROR, HUNT_ERROR);
    } else {
      this.targetHeading = this.heading + rng.range(TURN_MIN, TURN_MAX) * (rng.chance(0.5) ? 1 : -1);
    }
  }

  /** Advance the head along its heading; walls (and pits / water / solid entities) bounce it. */
  private crawl(dt: number): void {
    const step = this.speed * dt;
    const x0 = this.x;
    const y0 = this.y;
    const { hitX, hitY } = this.move(Math.cos(this.heading) * step, Math.sin(this.heading) * step);
    this.sinceBounce += dt;
    if (hitX || hitY) {
      const repeat = this.sinceBounce < BOUNCE_SETTLE;
      this.sinceBounce = 0;
      this.heading = this.targetHeading = bounceHeading(this.heading, hitX, hitY, rng.range(-BOUNCE_JITTER, BOUNCE_JITTER), repeat);
    }
    this.crawled += Math.hypot(this.x - x0, this.y - y0);
    this.path.push(this.x, this.y);
  }

  /** Put every live part on the trail, share the head's contact damage, and move the shadows along. */
  private placeParts(): void {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      if (p.dead) continue;
      this.path.sampleInto(this.offsets[i]!, p);
      p.contactDamage = this.contactDamage;
    }
    for (const s of this.shadows) s.follow();
  }

  /**
   * Starting heading: the one whose trail (laid out behind the head) stays on
   * walkable floor the longest; ties go to heading toward the room centre.
   */
  private startHeading(): number {
    const room = this.game.room;
    const len = this.offsets[this.offsets.length - 1]!;
    const toCentre = normalize(room.width / 2 - this.x, room.height / 2 - this.y);
    let best = Math.PI / 2;
    let bestScore = -Infinity;
    // Offset by half a step: never straight along an axis, so the first bounces fan out.
    for (let k = 0; k < START_HEADINGS; k++) {
      const a = ((k + 0.5) / START_HEADINGS) * 2 * Math.PI;
      // Free length comes in 4 px steps, so the centre bias (-1..1) only breaks ties.
      const score = this.freeTrail(-Math.cos(a), -Math.sin(a), len) + Math.cos(a) * toCentre.x + Math.sin(a) * toCentre.y;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** How far (px, up to `len`) a body-sized box can slide from the head along (bx, by) on walkable floor. */
  private freeTrail(bx: number, by: number, len: number): number {
    const room = this.game.room;
    const half = BODY_SIZE / 2;
    for (let d = 4; d <= len; d += 4) {
      const x = this.x + bx * d;
      const y = this.y + by * d;
      const out = x - half < 0 || y - half < 0 || x + half > room.width || y + half > room.height;
      if (out || room.blocked({ x: x - half, y: y - half, w: BODY_SIZE, h: BODY_SIZE }, 'walker')) return d - 4;
    }
    return len;
  }

  private clampToRoom(p: Vec): Vec {
    const room = this.game.room;
    const half = BODY_SIZE / 2;
    return { x: clamp(p.x, half, room.width - half), y: clamp(p.y, half, room.height - half) };
  }
}

registerEntity('boss.worm', (game, inst) => new Worm(game, inst));
