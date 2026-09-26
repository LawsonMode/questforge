// The hero. Wave A (engine agent): locomotion, collision, facing, ledge hops,
// pits, deep water / swimming, hazards, hurt/death, item-get pose. Wave B
// (player agent): sword swing / charge / spin, shield, the action button
// (talk / open -> lift -> dash), carrying & throwing, pushing, items.
// Structure: a state machine — `st` + one update method per state, dispatched
// from update(). Pure rules live in sword.ts, dash.ts, shield.ts and reach.ts,
// blade contact in blade.ts, item buttons in items/, and everything the hero
// fires, throws or places in ../projectiles/. The gamepad rumbles (input/devices.ts)
// when the hero is hurt, starts falling into a pit or bonks a wall mid-dash.
// OWNER: engine agent (wave A) then player agent (wave B).
import type { Dir, EntityInstance } from '../../core/types';
import type { GameServices, Hit, PlayerApi, PlayerState, Renderer } from '../api';
import { DIR_VEC, lerp, normalize, type Rect, type Vec } from '../../core/math';
import { STEP, TILE } from '../../core/constants';
import { neighborRoom } from '../../core/project';
import { VARIANT_PALETTES } from '../../content/ids';
import { type CarryInfo, Entity, animLength, findSprite } from '../entity';
import { healSave } from '../state';
import { rumble } from '../../input/devices';
import { WALK_SPEED, heldDirs, nextFacing, walkVelocity } from './facing';
import { hopLanding } from './hop';
import {
  CHARGE_TIME, RESWING_AFTER, SPIN_RING, SPIN_TIME, SWING_TIME, type SwingFrame, type SwordPose,
  bladeRect, bladeTip, heldPose, spinStep, swingFrame, swingPose,
} from './sword';
import { DASH_DUST_EVERY, DASH_SPEED, type DashPhase, dashNext, turnedAway } from './dash';
import { shieldBlocks, shieldReady } from './shield';
import { type BladeBlow, type BladeContact, bladeContact } from './blade';
import { type LiftableTile, edgeStrip, interactTarget, liftableEntity, liftableTile } from './reach';
import { useItem } from './items/index';
import { Carried } from '../projectiles/carried';
import { ThrownObject } from '../projectiles/thrown';
import { HOOK_SPEED, type Hookshot } from '../projectiles/hookshot';
import { cellCentre, cellsIn, dashBreakAt, wallIn } from '../projectiles/tiles';

/** Corner-slide assist (px) when walking into the edge of an obstacle. */
const SLIDE = 7;
const STAIRS_SPEED = 0.6;
const SHALLOW_SPEED = 0.85;
const SWIM_SPEED = 0.75;
/** Walk speed factor while holding a charging sword. */
const CHARGE_SPEED = 0.5;
/** Ledge hop: duration (s) and arc peak (px). */
const HOP_TIME = 0.35;
const HOP_PEAK = 10;
/** Damage feedback. */
const IFRAMES = 1.0;
const KNOCKBACK = 16;
const KNOCKBACK_TIME = 0.15;
/** Spikes push the hero back this far (px). */
const SPIKE_KNOCKBACK = 8;
const HURT_FLASH = 0.1;
const ITEM_GET_TIME = 1.2;
/** Pose time kept after the item message closes (s). */
const ITEM_GET_TAIL = 0.25;
/** Pause after the fall / death anim before the engine takes over (s). */
const FALL_LINGER = 0.2;
const DEATH_LINGER = 1.0;
/** Seconds between splash puffs while wading. */
const SPLASH_EVERY = 0.4;
/** Pixels above the hitbox centre where held-up item icons are centred. */
const ITEM_ICON_Y = 26;
/** Pushing into something this long (s) starts the push pose and calls its onPush. */
const PUSH_TIME = 0.3;
/** Lift pose (s) before the object is overhead. */
const LIFT_TIME = 0.2;
/** Item-use and throw poses (s). */
const USE_TIME = 0.2;
const THROW_TIME = 0.15;
/** Sword tink: recoil (px over s) and the wall probe size (px) around the blade tip. */
const RECOIL = 3;
const RECOIL_TIME = 0.1;
const TIP_PROBE = 4;
/** A charged blade pushed into something hard pokes it again this often (s). */
const POKE_EVERY = 0.25;
/** Dash bonk: recoil (px) and camera shake (s). */
const BONK_KNOCKBACK = 16;
const BONK_SHAKE = 0.3;
/**
 * Shaved off a knockback's tick-aligned duration: Entity.tickCommon counts kbTime
 * down in floats, and without this the float residue adds one extra knockback tick.
 */
const KB_EPSILON = 1e-9;
/** Colour pegs: the hero walks across the tops of raised ones that came up under him (see isBlockedAt). */
const PEG = 'obj.peg';
/** Slack (px) when testing whether the hero's leading edge has reached the room's edge. */
const EDGE_EPS = 0.001;
/** Palette of the level-2 blade. */
const SWORD2_PALETTE = VARIANT_PALETTES['fx.sword']?.['2'] ?? undefined;
/** States a hit (or an item-get, fall, room change) breaks off. */
const INTERRUPTIBLE: ReadonlySet<PlayerState> = new Set([
  'attack', 'charge', 'spin', 'dash', 'lift', 'carry', 'use', 'hookshot', 'push',
]);

/** room.blocked options, shared so collision probes don't allocate. */
const WITH_FLIPPERS = { flippers: true } as const;
const NO_FLIPPERS = { flippers: false } as const;
const NO_INPUT: Vec = { x: 0, y: 0 };
const NO_CONTACT: Readonly<BladeContact> = { hits: 0, solid: false, cut: 0 };

/** `v` when it is a finite number, else `fallback` (hit amounts from props / hand-edited data). */
function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class Player extends Entity implements PlayerApi {
  private st: PlayerState = 'normal';
  /** Seconds spent in the current state. */
  private stT = 0;
  private locked = false;
  /** Flippers owned (refreshed every tick; collision probes read it many times per tick). */
  private hasFlippers = false;
  private hopFrom: Vec = { x: 0, y: 0 };
  private hopTo: Vec = { x: 0, y: 0 };
  private fallAt: Vec = { x: 0, y: 0 };
  private fallFinished = false;
  private deathFinished = false;
  private itemIcon = '';
  private itemTime = 0;
  private splashT = 0;
  /** Last walking input (d-pad vector); spikes push the hero back against it. */
  private readonly lastMove: Vec = { x: 0, y: 0 };
  private readonly pressedDirs: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
  /** Blade shown this tick (null = sheathed); drives drawing and swordRect(). */
  private blade: SwordPose | null = null;
  /** The attack frame the blade was posed for (drawn with it, whatever else sets `anim`). */
  private bladeAnim = '';
  private bladeAnimT = 0;
  /** The spin's previous ring step, so the spin hitbox covers the arc between steps. */
  private spinTrail: SwordPose | null = null;
  private spinFrom: Dir = 'down';
  /** Entities already struck by the current sword move (see BladeBlow.memory). */
  private readonly struck = new Set<number>();
  private tinked = false;
  /** Seconds until a charged blade pushed into a wall pokes it again. */
  private pokeWait = 0;
  private charged = false;
  private carried: Carried | null = null;
  private pushT = 0;
  private dashPhase: DashPhase = 'windup';
  private dustT = 0;
  private hook: Hookshot | null = null;
  private useTime = USE_TIME;
  /** Scratch objects reused every tick (walking and blade probes run 60 times a second). */
  private readonly stepOut = { moving: false, stuck: false };
  private readonly velocity: Vec = { x: 0, y: 0 };
  private readonly heldBuf: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
  private readonly bladeBuf: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly trailBuf: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly tipBuf: Rect = { x: 0, y: 0, w: TIP_PROBE, h: TIP_PROBE };

  constructor(game: GameServices, inst: EntityInstance | null = null) {
    super(game, inst, 'player');
    this.team = 'player';
    this.mover = 'player';
    this.sprite = 'hero';
    this.anim = 'idle_down';
    this.syncHealth();
  }

  // ------------------------------------------------------------------ PlayerApi

  get state(): PlayerState {
    return this.locked && (this.st === 'normal' || this.st === 'swim') ? 'locked' : this.st;
  }

  get carrying(): Entity | null {
    return this.carried;
  }

  /** True once the pit-fall anim has played out; the engine then warps / respawns and calls place(). */
  get pitFallDone(): boolean {
    return this.fallFinished;
  }

  /** True once the death anim has played out (the engine shows the game-over screen). */
  get deathDone(): boolean {
    return this.deathFinished;
  }

  swordRect(): Rect | null {
    const r = this.bladeBox();
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  }

  hurtPlayer(hit: Hit): 'hit' | 'blocked' | 'ignored' {
    if (this.blocksWithShield(hit)) {
      this.game.audio.sfx('shield');
      return 'blocked';
    }
    return this.applyHit(hit) ? 'hit' : 'ignored';
  }

  /** Generic entity damage (e.g. code that hurts any target) goes through the hero's rules (no shield). */
  override hurt(hit: Hit): boolean {
    return this.applyHit(hit);
  }

  /**
   * Instant kill (traps, generic kill-all code): hp 0 and the death sequence.
   * The hero is never flagged `dead` — the engine keeps ticking it until game over.
   */
  override die(): void {
    if (this.st === 'dead') return;
    this.game.save.hp = 0;
    this.syncHealth();
    this.enterDead();
  }

  heal(halfHearts: number): void {
    if (!Number.isFinite(halfHearts)) return;
    healSave(this.game.save, halfHearts);
    this.syncHealth();
  }

  place(x: number, y: number, facing?: Dir): void {
    const keepMove = this.movesOnThrough(facing);
    this.x = x;
    this.y = y;
    if (facing) this.facing = facing;
    this.z = 0;
    this.vz = 0;
    this.kbTime = 0;
    this.visible = true;
    this.fallFinished = false;
    this.hasFlippers = this.game.hasItem('flippers');
    this.hook = null;
    this.keepCarriedAcrossRooms();
    if (keepMove) {
      this.showHeldBlade();
      return;
    }
    this.blade = null;
    this.charged = false;
    if (this.st !== 'dead') this.enter(this.restState());
    this.playDir(this.restAnim(), true);
  }

  showItemGet(icon: string, seconds = ITEM_GET_TIME): void {
    if (this.st === 'dead') return;
    this.interrupt();
    this.itemIcon = icon;
    this.itemTime = seconds;
    this.kbTime = 0;
    this.z = 0;
    this.enter('itemGet');
    this.play('item_get', true);
  }

  /** End the item-get pose shortly (called when its message closes). */
  finishItemGet(): void {
    if (this.st === 'itemGet') this.itemTime = Math.min(this.itemTime, this.stT + ITEM_GET_TAIL);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  fallIntoPit(): void {
    if (this.st === 'fall' || this.st === 'dead') return;
    this.interrupt();
    this.fallAt = {
      x: Math.floor(this.x / TILE) * TILE + TILE / 2,
      y: Math.floor(this.y / TILE) * TILE + TILE / 2,
    };
    this.kbTime = 0;
    this.z = 0;
    this.fallFinished = false;
    this.enter('fall');
    this.play('fall', true);
    this.game.audio.sfx('fall');
    rumble('hit');
  }

  /** Bring the hero back after a game over (hp is set by the engine). */
  revive(): void {
    this.deathFinished = false;
    this.fallFinished = false;
    this.invuln = 0;
    this.carried = null;
    this.st = 'normal';
    this.stT = 0;
    this.syncHealth();
  }

  // ------------------------------------------------------------------ per tick

  override tickCommon(dt: number): void {
    this.hasFlippers = this.game.hasItem('flippers');
    super.tickCommon(dt);
  }

  override update(dt: number): void {
    this.syncHealth();
    this.stT += dt;
    this.blade = null;
    switch (this.st) {
      case 'normal':
      case 'push':
      case 'swim':
        this.updateWalk(dt);
        break;
      case 'carry':
        this.updateCarry(dt);
        break;
      case 'attack':
        this.updateAttack();
        break;
      case 'charge':
        this.updateCharge(dt);
        break;
      case 'spin':
        this.updateSpin();
        break;
      case 'lift':
        this.updateLift();
        break;
      case 'dash':
        this.updateDash(dt);
        break;
      case 'use':
        this.updateUse();
        break;
      case 'hookshot':
        this.updateHookshot(dt);
        break;
      case 'hop':
        this.updateHop();
        break;
      case 'hurt':
        this.updateHurt(dt);
        break;
      case 'fall':
        this.updateFall(dt);
        break;
      case 'itemGet':
        if (this.stT >= this.itemTime) this.enter(this.restState());
        break;
      case 'dead':
        this.updateDead();
        break;
      case 'locked':
        // Never stored: `state` reports 'locked' for a locked normal / swim hero.
        break;
    }
  }

  private updateWalk(dt: number): void {
    const d = this.locked ? NO_INPUT : this.game.input.dir();
    this.updateFacing(d);
    if (this.st !== 'swim' && !this.locked && this.handleButtons()) return;
    const step = this.walkStep(d, dt, WALK_SPEED);
    if (this.st === 'hop') return;
    this.updatePush(this.st !== 'swim' && step.stuck && this.holdsFacing(d), dt);
    if (this.st === 'swim') this.playDir('swim');
    else if (this.st === 'push') this.playDir('push');
    else this.playDir(step.moving ? 'walk' : 'idle');
    this.checkTerrain(dt, step.moving);
  }

  private updateHop(): void {
    const p = Math.min(1, this.stT / HOP_TIME);
    this.x = lerp(this.hopFrom.x, this.hopTo.x, p);
    this.y = lerp(this.hopFrom.y, this.hopTo.y, p);
    this.z = 4 * HOP_PEAK * p * (1 - p);
    if (p < 1) return;
    this.z = 0;
    this.game.audio.sfx('land');
    this.enter(this.restState());
    this.checkTerrain(0, false);
  }

  private updateHurt(dt: number): void {
    this.playDir('hurt');
    // Knocked over a hole: drop in right away rather than sliding across it.
    if (!this.game.debug.noclip && this.game.room.collisionAt(this.x, this.y) === 'pit') {
      this.fallIntoPit();
      return;
    }
    if (this.kbTime > 0) return;
    this.enter(this.restState());
    this.checkTerrain(dt, false);
  }

  private updateFall(dt: number): void {
    const k = Math.min(1, dt * 12);
    this.x += (this.fallAt.x - this.x) * k;
    this.y += (this.fallAt.y - this.y) * k;
    if (!this.fallFinished && this.animDone() && this.stT >= this.animLen() + FALL_LINGER) {
      this.fallFinished = true;
      this.visible = false;
    }
  }

  private updateDead(): void {
    if (!this.deathFinished && this.animDone() && this.stT >= this.animLen() + DEATH_LINGER) this.deathFinished = true;
  }

  // ------------------------------------------------------------------ buttons

  /** Sword, action and item buttons while walking. True if one started something (skip walking this tick). */
  private handleButtons(): boolean {
    const input = this.game.input;
    if (input.pressed('b') && this.swordLevel() > 0) {
      this.startAttack();
      return true;
    }
    if (input.pressed('a') && this.action()) return true;
    return input.pressed('y') && this.useEquipped();
  }

  /** Action button, in priority order: talk / read / open -> lift -> dash. */
  private action(): boolean {
    if (interactTarget(this.game, this)?.onInteract?.()) return true;
    if (this.tryLift()) return true;
    if (!this.game.hasItem('boots')) return false;
    this.startDash();
    return true;
  }

  // ------------------------------------------------------------------ sword

  private startAttack(): void {
    this.enter('attack');
    this.struck.clear();
    this.tinked = false;
    this.charged = false;
    this.game.audio.sfx('sword');
    this.updateAttack();
  }

  private updateAttack(): void {
    const input = this.game.input;
    if (this.stT >= RESWING_AFTER && input.pressed('b')) {
      this.startAttack();
      return;
    }
    if (this.stT >= SWING_TIME) {
      if (input.held('b')) this.startCharge();
      else this.finishSwordMove();
      return;
    }
    const frame = swingFrame(this.stT);
    this.showSword(this.facing, frame, swingPose(this.facing, frame));
    const hit = this.bladeStrike({ kind: 'sword', damage: this.swordLevel(), cut: true, memory: 'swing' });
    if (!this.tinked && (hit.solid || (frame === 2 && hit.cut === 0 && this.bladeTipInWall()))) this.tink();
  }

  private startCharge(): void {
    this.enter('charge');
    this.struck.clear();
    this.updateCharge(0);
  }

  /** Sword held out: walk slowly facing ahead; poke what the blade touches; release to spin once charged. */
  private updateCharge(dt: number): void {
    const input = this.game.input;
    if (!input.held('b')) {
      if (this.charged) this.startSpin();
      else this.finishSwordMove();
      return;
    }
    if (!this.charged && input.heldTime('b') >= CHARGE_TIME) {
      this.charged = true;
      this.game.audio.sfx('swordCharge');
    }
    // A poke's recoil (tink) takes over from walking for its moment.
    const d = this.locked || this.kbTime > 0 ? NO_INPUT : input.dir();
    const step = this.walkStep(d, dt, WALK_SPEED * CHARGE_SPEED);
    if (this.st === 'hop') return;
    this.showSword(this.facing, 2, heldPose(this.facing));
    const hit = this.bladeStrike({ kind: 'sword', damage: this.swordLevel(), cut: false, memory: 'contact' });
    this.pokeWith(hit.solid || this.bladeTipInWall(), step.moving && this.holdsFacing(d), dt);
    this.checkTerrain(dt, step.moving);
  }

  /**
   * The held blade against something hard: a poke (tink and recoil) on
   * contact, then again every POKE_EVERY while the hero keeps pushing into it.
   */
  private pokeWith(hard: boolean, pushing: boolean, dt: number): void {
    this.pokeWait -= dt;
    if (!hard) this.tinked = false;
    else if (!this.tinked || (pushing && this.pokeWait <= 0)) this.tink();
  }

  private startSpin(): void {
    this.spinFrom = this.facing;
    this.enter('spin');
    this.struck.clear();
    this.charged = false;
    this.game.audio.sfx('swordSpin');
    this.updateSpin();
  }

  private updateSpin(): void {
    if (this.stT >= SPIN_TIME) {
      this.finishSwordMove();
      return;
    }
    const s = spinStep(this.stT, this.spinFrom);
    this.spinTrail = spinStep(Math.max(0, this.stT - SPIN_TIME / SPIN_RING.length), this.spinFrom).pose;
    this.showSword(s.facing, s.frame, s.pose);
    this.bladeStrike({ kind: 'spin', damage: 2 * this.swordLevel(), cut: true, memory: 'swing' });
  }

  private finishSwordMove(): void {
    this.charged = false;
    this.enter(this.restState());
    this.playDir(this.restAnim());
  }

  /** Show attack frame `frame` facing `facing` with the blade at `pose`. */
  private showSword(facing: Dir, frame: SwingFrame, pose: SwordPose): void {
    this.blade = pose;
    this.showFrame(`attack_${facing}`, frame);
    this.bladeAnim = this.anim;
    this.bladeAnimT = this.animT;
  }

  /** The blade of a charge, or of a dash run, held straight out (none while winding up a dash or without a sword). */
  private showHeldBlade(): void {
    const held = this.st === 'charge' || (this.st === 'dash' && this.dashPhase === 'run' && this.swordLevel() > 0);
    if (held) this.showSword(this.facing, 2, heldPose(this.facing));
    else this.blade = null;
  }

  /** The blade hitbox this tick, in a scratch rect (a spin's covers the arc since its previous step). */
  private bladeBox(): Rect | null {
    if (!this.blade) return null;
    const r = bladeRect(this.x, this.y, this.blade, this.bladeBuf);
    if (this.st !== 'spin' || !this.spinTrail) return r;
    const t = bladeRect(this.x, this.y, this.spinTrail, this.trailBuf);
    const x1 = Math.max(r.x + r.w, t.x + t.w);
    const y1 = Math.max(r.y + r.h, t.y + t.h);
    r.x = Math.min(r.x, t.x);
    r.y = Math.min(r.y, t.y);
    r.w = x1 - r.x;
    r.h = y1 - r.y;
    return r;
  }

  private bladeStrike(blow: BladeBlow): BladeContact {
    const rect = this.bladeBox();
    return rect ? bladeContact(this.game, this, rect, blow, this.struck) : NO_CONTACT;
  }

  private bladeTipInWall(): boolean {
    if (!this.blade) return false;
    const tip = bladeTip(this.x, this.y, this.blade);
    const probe = this.tipBuf;
    probe.x = tip.x - TIP_PROBE / 2;
    probe.y = tip.y - TIP_PROBE / 2;
    return wallIn(this.game, probe);
  }

  /** The blade glanced off something hard: spark, clink, small recoil (once per swing). */
  private tink(): void {
    this.tinked = true;
    this.pokeWait = POKE_EVERY;
    if (this.blade) {
      const tip = bladeTip(this.x, this.y, this.blade);
      this.game.effect('fx.hit', 'play', tip.x, tip.y - this.z);
    }
    this.game.audio.sfx('swordTink');
    const f = DIR_VEC[this.facing];
    this.knockExact(-f.x, -f.y, RECOIL, RECOIL_TIME);
  }

  // ------------------------------------------------------------------ lift / carry / throw

  private tryLift(): boolean {
    const glove = this.gloveLevel();
    const e = liftableEntity(this.game, this, glove);
    if (e) {
      this.startLift(e instanceof Carried ? e : this.liftEntity(e));
      return true;
    }
    const tile = liftableTile(this.game, this, glove);
    if (!tile) return false;
    this.startLift(this.liftTile(tile));
    return true;
  }

  /** Replace a liftable entity by a carried copy of how it looks (its onLift says). */
  private liftEntity(e: Entity): Carried {
    const info: CarryInfo = e.onLift?.() ?? { sprite: e.sprite, anim: e.anim, palette: e.palette };
    e.dead = true;
    return this.game.spawn(new ThrownObject(this.game, info, e.x, e.y));
  }

  /** Pull a liftable tile out of the ground (it grows back on re-entry). */
  private liftTile(t: LiftableTile): Carried {
    const lift = t.def.lift!;
    this.game.room.setTile(t.layer, t.cell.tx, t.cell.ty, lift.to);
    const info: CarryInfo = {
      tile: t.def.id,
      drop: lift.drops ? 'random' : 'none',
      damage: lift.weight >= 1 ? 2 : 1,
      shatterFx: t.def.cut ? 'fx.leaves' : 'fx.shatter',
    };
    const c = cellCentre(t.cell);
    return this.game.spawn(new ThrownObject(this.game, info, c.x, c.y));
  }

  private startLift(obj: Carried): void {
    this.carried = obj;
    obj.carry(this, 0);
    this.enter('lift');
    this.playDir('lift');
    this.game.audio.sfx('lift');
  }

  private updateLift(): void {
    const obj = this.liveCarried();
    if (!obj) return;
    const p = Math.min(1, this.stT / LIFT_TIME);
    obj.carry(this, p);
    this.playDir('lift');
    if (p >= 1) this.enter('carry');
  }

  /** Walking with something overhead; A or B throws it. */
  private updateCarry(dt: number): void {
    if (!this.liveCarried()) return;
    const input = this.game.input;
    const d = this.locked ? NO_INPUT : input.dir();
    this.updateFacing(d);
    if (!this.locked && (input.pressed('a') || input.pressed('b'))) {
      this.throwCarried();
      return;
    }
    const step = this.walkStep(d, dt, WALK_SPEED);
    if (this.st === 'hop') return;
    this.playDir('carry');
    if (!step.moving) this.animT = 0;
    this.checkTerrain(dt, step.moving);
  }

  /** The carried object, or null (back to walking) if it is gone (a bomb went off in the hero's hands). */
  private liveCarried(): Carried | null {
    if (this.carried && !this.carried.dead) return this.carried;
    this.carried = null;
    this.enter(this.restState());
    return null;
  }

  private throwCarried(): void {
    const obj = this.carried;
    this.carried = null;
    obj?.launch(this.facing);
    this.usePose(THROW_TIME);
  }

  /** Let go of the carried object where it is (hurt, fall, item get, swimming). */
  private dropCarried(): void {
    const obj = this.carried;
    this.carried = null;
    if (obj && !obj.dead) obj.release();
  }

  /**
   * A held object follows the hero into the next room (the engine only moves the
   * hero): back into the room's entities, overhead at the hero's new spot.
   */
  private keepCarriedAcrossRooms(): void {
    const obj = this.carried;
    if (!obj) return;
    if (obj.dead || !obj.isHeld) {
      this.carried = null;
      return;
    }
    if (!this.game.entities.includes(obj)) this.game.spawn(obj);
    obj.carry(this, 1);
  }

  /** A charge or dash carries on through a room change that keeps the hero's facing (edge scrolls). */
  private movesOnThrough(facing: Dir | undefined): boolean {
    return (this.st === 'charge' || this.st === 'dash') && (facing === undefined || facing === this.facing);
  }

  // ------------------------------------------------------------------ push

  /**
   * Pushing (blocked while holding the facing direction): the push pose after
   * PUSH_TIME, then onPush on what is there - tried again every PUSH_TIME while
   * the hero keeps pushing, so a block whose way was only briefly in use (a bat
   * fluttering over it) still moves without letting go first.
   */
  private updatePush(pushing: boolean, dt: number): void {
    if (!pushing) {
      if (this.st === 'push') this.enter('normal');
      else this.pushT = 0;
      return;
    }
    this.pushT += dt;
    if (this.pushT < PUSH_TIME) return;
    if (this.st !== 'push') this.enter('push');
    this.pushT = 0;
    const target = this.game.entitiesIn(edgeStrip(this, 2), (e) => e !== this && e.solid && e.onPush !== undefined)[0];
    target?.onPush?.(this.facing);
  }

  private holdsFacing(d: Vec): boolean {
    const f = DIR_VEC[this.facing];
    return f.x !== 0 ? Math.sign(d.x) === f.x : Math.sign(d.y) === f.y;
  }

  // ------------------------------------------------------------------ dash

  private startDash(): void {
    this.enter('dash');
    this.dashPhase = 'windup';
    this.dustT = 0;
    this.struck.clear();
  }

  private updateDash(dt: number): void {
    const input = this.game.input;
    const d = this.locked ? NO_INPUT : input.dir();
    // Running in place, the hero may still turn to aim the dash.
    if (this.dashPhase === 'windup') this.updateFacing(d);
    const next = dashNext(this.dashPhase, this.stT, !this.locked && input.held('a'), turnedAway(this.facing, d));
    if (next === 'stop') {
      this.enter(this.restState());
      this.playDir(this.restAnim());
      return;
    }
    if (next !== this.dashPhase) {
      this.dashPhase = next;
      this.game.audio.sfx('dash');
    }
    this.puffDust(dt);
    if (this.dashPhase === 'windup') this.runInPlace(dt);
    else this.dashRun(dt);
  }

  /** Legs at double speed, going nowhere. */
  private runInPlace(dt: number): void {
    this.playDir('walk');
    this.animT += dt;
  }

  private dashRun(dt: number): void {
    const f = DIR_VEC[this.facing];
    const moved = this.move(f.x * DASH_SPEED * dt, f.y * DASH_SPEED * dt);
    const blocked = (f.x !== 0 ? moved.hitX : moved.hitY) || this.atClosedEdge();
    let cleared = false;
    if (this.swordLevel() > 0) {
      this.showSword(this.facing, 2, heldPose(this.facing));
      cleared = this.bladeStrike({ kind: 'sword', damage: this.swordLevel(), cut: true, memory: 'contact' }).cut > 0;
    } else {
      this.runInPlace(dt);
    }
    if (blocked && !cleared && !this.breakDashTiles()) {
      this.tryHop(this.facing);
      if (this.st !== 'hop') this.bonk();
      return;
    }
    this.checkTerrain(dt, true);
  }

  /**
   * The hero's leading edge has reached a room edge with no neighbour beyond it:
   * such an edge is a wall (the engine only clamps the hero there), so a dash
   * into it bonks like one.
   */
  private atClosedEdge(): boolean {
    const room = this.game.room;
    const reached = this.facing === 'right' ? this.right >= room.width - EDGE_EPS
      : this.facing === 'left' ? this.left <= EDGE_EPS
        : this.facing === 'down' ? this.bottom >= room.height - EDGE_EPS
          : this.top <= EDGE_EPS;
    if (!reached) return false;
    const along = this.facing === 'up' || this.facing === 'down' ? this.x : this.y;
    return neighborRoom(room.world, room.def, this.facing, along) === undefined;
  }

  private puffDust(dt: number): void {
    this.dustT -= dt;
    if (this.dustT > 0) return;
    this.dustT = DASH_DUST_EVERY;
    const f = DIR_VEC[this.facing];
    this.game.effect('fx.dust', 'play', this.x - f.x * 6, this.y + this.h / 2 - 2);
  }

  /** Break dash-breakable tiles just ahead (persistently). True if any broke. */
  private breakDashTiles(): boolean {
    let broke = false;
    for (const c of cellsIn(edgeStrip(this, 4))) if (dashBreakAt(this.game, c.tx, c.ty)) broke = true;
    return broke;
  }

  /** Ran into something: thud, shake, knocked back. */
  private bonk(): void {
    const f = DIR_VEC[this.facing];
    this.blade = null;
    this.game.audio.sfx('hit');
    rumble('hit');
    this.game.camera.shake(BONK_SHAKE, 2);
    this.game.effect('fx.hit', 'play', this.x + f.x * (this.w / 2 + 2), this.y + f.y * (this.h / 2 + 2) - 4);
    this.knockExact(-f.x, -f.y, BONK_KNOCKBACK, KNOCKBACK_TIME);
    this.enter('hurt');
  }

  // ------------------------------------------------------------------ items

  /** Item button: use the equipped item. True if the hero started a pose. */
  private useEquipped(): boolean {
    const item = this.game.save.equipped;
    if (!item) return false;
    const out = useItem(this, item);
    if (out === 'busy') return false;
    if (out === 'fail') {
      this.game.audio.sfx('error');
      return false;
    }
    if (out === 'pose') {
      this.usePose(USE_TIME);
      return true;
    }
    this.hook = out;
    this.enter('hookshot');
    this.playDir('use');
    return true;
  }

  private usePose(seconds: number): void {
    this.useTime = seconds;
    this.enter('use');
    this.playDir('use');
  }

  private updateUse(): void {
    this.playDir('use');
    if (this.stT >= this.useTime) this.enter(this.restState());
  }

  /** Waiting on the hookshot; once it latches, fly to it (over pits and water). */
  private updateHookshot(dt: number): void {
    this.playDir('use');
    const hook = this.hook;
    if (!hook || hook.dead) {
      this.hook = null;
      this.enter(this.restState());
      return;
    }
    const to = hook.phase === 'pull' ? hook.pullTarget() : null;
    if (!to || this.pullToward(to, HOOK_SPEED * dt)) return;
    hook.finish();
    this.hook = null;
    this.enter(this.restState());
  }

  /**
   * One tick of the hookshot pull toward `to`: over pits, water and ledges, but
   * walls and solid things stop the hero's whole box (sliding round corners the
   * narrower claw slipped past). False once the pull is over: arrived, or stuck.
   */
  private pullToward(to: Vec, step: number): boolean {
    const dx = to.x - this.x;
    const dy = to.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      this.move(dx, dy);
      return false;
    }
    const ox = this.x;
    const oy = this.y;
    this.move((dx / d) * step, (dy / d) * step, SLIDE);
    return this.x !== ox || this.y !== oy;
  }

  /** Being reeled in by the hookshot. */
  private pulled(): boolean {
    return this.st === 'hookshot' && this.hook?.phase === 'pull';
  }

  // ------------------------------------------------------------------ helpers

  /** One tick of walking along `d` at `speed` (terrain-scaled), trying ledge hops when blocked. The result is reused. */
  private walkStep(d: Vec, dt: number, speed: number): { readonly moving: boolean; readonly stuck: boolean } {
    const out = this.stepOut;
    out.moving = d.x !== 0 || d.y !== 0;
    out.stuck = false;
    if (!out.moving) return out;
    this.lastMove.x = d.x;
    this.lastMove.y = d.y;
    const ox = this.x;
    const oy = this.y;
    const v = walkVelocity(d, speed * this.terrainSpeed(), this.velocity);
    const hit = this.move(v.x * dt, v.y * dt, SLIDE);
    if (hit.hitY && d.y !== 0) this.tryHop(d.y > 0 ? 'down' : 'up');
    else if (hit.hitX && d.x !== 0) this.tryHop(d.x > 0 ? 'right' : 'left');
    out.stuck = this.x === ox && this.y === oy;
    return out;
  }

  private blocksWithShield(hit: Hit): boolean {
    return this.game.hasItem('shield') && shieldReady(this.state) && shieldBlocks(hit, this.x, this.y, this.facing);
  }

  /** Whether a hit can land now (i-frames, cheats, poses that can't be hurt). */
  private canBeHit(falling: boolean): boolean {
    if (this.st === 'dead' || this.st === 'itemGet' || (this.st === 'fall' && !falling)) return false;
    if (this.game.debug.invincible) return false;
    if (this.invuln > 0 && !falling) return false;
    return this.hook?.phase !== 'pull';
  }

  /** Shared damage rules; returns true if the hit landed. */
  private applyHit(hit: Hit): boolean {
    const falling = hit.kind === 'fall';
    if (!this.canBeHit(falling)) return false;
    // Non-finite amounts (a broken prop or formula) are ignored: they must not kill, freeze or fling the hero to NaN.
    const damage = finiteOr(hit.damage, 0);
    const stun = finiteOr(hit.stun, 0);
    if (damage > 0) {
      this.interrupt();
      const save = this.game.save;
      save.hp = Math.max(0, save.hp - damage);
      this.syncHealth();
      this.game.audio.sfx('hurt');
      // A pit fall already rumbled when the hero started falling.
      if (!falling) rumble('hit');
      this.invuln = IFRAMES;
      this.hitFlash = HURT_FLASH;
      if (save.hp <= 0) {
        this.enterDead();
        return true;
      }
    }
    if (stun > 0) {
      // Frozen: update() is skipped while stunned, so nothing may be left mid-move.
      this.interrupt();
      this.stun = Math.max(this.stun, stun);
    }
    const dist = finiteOr(hit.knockback, KNOCKBACK);
    if (dist <= 0 || this.st === 'hop' || falling) return true;
    this.interrupt();
    const away = this.knockDir(hit);
    this.knockExact(away.x, away.y, dist, KNOCKBACK_TIME);
    this.enter('hurt');
    return true;
  }

  /** Break off what the hero was doing: drop what is carried, sheathe, reel the hookshot in. */
  private interrupt(): void {
    this.dropCarried();
    this.charged = false;
    this.blade = null;
    this.hook?.retract();
    this.hook = null;
    if (INTERRUPTIBLE.has(this.st)) this.enter('normal');
  }

  /** knock() over a whole number of ticks, so the hero travels exactly `dist` px. */
  private knockExact(dx: number, dy: number, dist: number, time: number): void {
    const ticks = Math.max(1, Math.round(time / STEP));
    this.knock(dx, dy, dist, ticks * STEP);
    this.kbTime -= KB_EPSILON;
  }

  private enter(st: PlayerState): void {
    this.st = st;
    this.stT = 0;
    if (st === 'push') return;
    this.pushT = 0;
  }

  /** Where the hero settles after a move: carrying, swimming or walking. */
  private restState(): PlayerState {
    if (this.carried && !this.carried.dead) return 'carry';
    return this.inSwimmableWater() ? 'swim' : 'normal';
  }

  private restAnim(): string {
    if (this.st === 'swim') return 'swim';
    return this.st === 'carry' ? 'carry' : 'idle';
  }

  private enterDead(): void {
    this.interrupt();
    this.kbTime = 0;
    this.z = 0;
    this.invuln = 0;
    this.deathFinished = false;
    this.enter('dead');
    this.play('die', true);
  }

  private syncHealth(): void {
    this.hp = this.game.save.hp;
    this.maxHp = this.game.save.maxHp;
  }

  private swordLevel(): number {
    if (this.game.hasItem('sword', 2)) return 2;
    return this.game.hasItem('sword') ? 1 : 0;
  }

  private gloveLevel(): number {
    if (this.game.hasItem('glove', 2)) return 2;
    return this.game.hasItem('glove') ? 1 : 0;
  }

  private animLen(): number {
    return animLength(this.game.project, this.sprite, this.anim);
  }

  /** Show frame `frame` of `anim` (held still: the state machine picks frames itself). */
  private showFrame(anim: string, frame: number): void {
    this.anim = anim;
    const a = findSprite(this.game.project, this.sprite)?.anims[anim];
    this.animT = a && a.fps > 0 ? (Math.min(frame, a.frames.length - 1) + 0.5) / a.fps : 0;
  }

  private updateFacing(d: Vec): void {
    const input = this.game.input;
    const pressed = this.pressedDirs;
    pressed.up = input.pressed('up');
    pressed.down = input.pressed('down');
    pressed.left = input.pressed('left');
    pressed.right = input.pressed('right');
    this.facing = nextFacing(this.facing, heldDirs(d, this.heldBuf), pressed);
  }

  private inSwimmableWater(): boolean {
    return !this.game.debug.noclip && this.hasFlippers && this.game.room.collisionAt(this.x, this.y) === 'deep';
  }

  private terrainSpeed(): number {
    if (this.st === 'swim') return SWIM_SPEED;
    switch (this.game.room.collisionAt(this.x, this.y)) {
      case 'stairs': return STAIRS_SPEED;
      case 'shallow': return SHALLOW_SPEED;
      default: return 1;
    }
  }

  /** Away from the source when known, else the hit's own direction, else backwards. */
  private knockDir(hit: Hit): Vec {
    if (hit.dx !== 0 || hit.dy !== 0) return normalize(hit.dx, hit.dy);
    if (hit.source) {
      const v = normalize(this.x - hit.source.x, this.y - hit.source.y);
      if (v.x !== 0 || v.y !== 0) return v;
    }
    const f = DIR_VEC[this.facing];
    return { x: -f.x, y: -f.y };
  }

  /** Terrain under the hitbox centre: pits, deep water (swim), spikes, wading splashes. */
  private checkTerrain(dt: number, moving: boolean): void {
    if (this.game.debug.noclip) return;
    const c = this.game.room.collisionAt(this.x, this.y);
    if (c === 'pit') {
      this.fallIntoPit();
      return;
    }
    if (c === 'deep' && this.hasFlippers) {
      if (this.st !== 'swim') this.startSwimming();
    } else if (this.st === 'swim') {
      this.enter('normal');
    }
    if (c === 'hurt') this.hurtBySpikes(moving);
    this.updateSplash(c === 'shallow' && moving, dt);
  }

  /** Half a heart, pushed back against the way the hero was walking (or facing when standing). */
  private hurtBySpikes(moving: boolean): void {
    const back = moving ? this.lastMove : DIR_VEC[this.facing];
    this.hurtPlayer({ damage: 1, kind: 'spikes', source: null, dx: -back.x, dy: -back.y, knockback: SPIKE_KNOCKBACK });
  }

  private startSwimming(): void {
    this.interrupt();
    this.enter('swim');
    this.game.audio.sfx('splash');
    this.game.effect('fx.splash', 'play', this.x, this.y);
  }

  private updateSplash(wading: boolean, dt: number): void {
    if (!wading) {
      this.splashT = 0;
      return;
    }
    this.splashT -= dt;
    if (this.splashT > 0) return;
    this.splashT = SPLASH_EVERY;
    this.game.effect('fx.splash', 'play', this.x, this.y + this.h / 2 - 2);
    this.game.audio.sfx('splash', { volume: 0.3 });
  }

  // ------------------------------------------------------------------ collision

  /**
   * Tiles for the hero (flippers, ledges; walls only while the hookshot pulls)
   * and solid entities - except that while the hero already stands on a raised
   * colour peg (pegs rose under him: a crystal switch hit by a late arrow, a bomb
   * or a returning boomerang), raised pegs do not block, ALttP-style: he walks
   * across their tops until he is off every one, and then they block again.
   */
  override isBlockedAt(x: number, y: number): boolean {
    if (this.game.debug.noclip) return false;
    const r = this.rectAt(x, y);
    const room = this.game.room;
    // The hookshot pull flies over pits, water and ledges: only walls stop it.
    const walls = this.pulled()
      ? room.blocked(r, 'flyer')
      : room.blocked(r, 'player', this.hasFlippers ? WITH_FLIPPERS : NO_FLIPPERS);
    if (walls) return true;
    const solid = this.game.solidEntityAt(r, this);
    if (solid === null) return false;
    if (solid.type !== PEG || !this.onRaisedPeg()) return true;
    for (const e of this.game.entities) {
      if (e.solid && e !== this && !e.dead && e.type !== PEG && overlapsBox(e, r.x, r.y, r.w, r.h)) return true;
    }
    return false;
  }

  /** The hero's hitbox (where he stands now) overlaps a raised colour peg. */
  onRaisedPeg(): boolean {
    for (const e of this.game.entities) {
      if (e.type === PEG && e.solid && !e.dead && overlapsBox(e, this.left, this.top, this.w, this.h)) return true;
    }
    return false;
  }

  /** Walking into a ledge along its ledgeDir: hop over it onto free ground past it (see hopLanding). */
  private tryHop(dir: Dir): void {
    if (this.game.debug.noclip) return;
    const room = this.game.room;
    const land = hopLanding({
      room, x: this.x, y: this.y, w: this.w, h: this.h, dir, flippers: this.hasFlippers,
      isFree: (x, y) => !this.isBlockedAt(x, y),
      canLeaveRoom: () => neighborRoom(room.world, room.def, dir, dir === 'up' || dir === 'down' ? this.x : this.y) !== undefined,
    });
    if (!land) return;
    // A hop keeps what is carried but ends sword and dash moves.
    this.charged = false;
    this.blade = null;
    this.facing = dir;
    this.hopFrom = { x: this.x, y: this.y };
    this.hopTo = land;
    this.enter('hop');
    this.playDir(this.carried ? 'carry' : 'walk');
    this.game.audio.sfx('jump');
  }

  // ------------------------------------------------------------------ drawing

  /** The hero with its blade, and what it carries (drawn here so it moves, sorts and scrolls with the hero). */
  override draw(r: Renderer): void {
    if (!this.visible || !this.sprite) return;
    const held = this.carried;
    held?.drawHeld(r, true);
    if (!this.flickeredOut()) this.drawHero(r);
    held?.drawHeld(r, false);
  }

  /** Hidden this frame by the i-frame flicker. */
  private flickeredOut(): boolean {
    return this.invuln > 0 && this.hitFlash <= 0 && Math.floor(this.invuln * 30) % 2 === 0;
  }

  private drawHero(r: Renderer): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y - this.z);
    if (this.shadow && this.z > 0) r.drawShadow(this.x, this.y + this.h / 2 - 1, Math.max(8, this.w));
    const blade = this.blade;
    const flash = this.hitFlash > 0;
    const opts = { palette: this.palette, flash };
    if (blade?.behind) this.drawBlade(r, blade, x, y, flash);
    // A blade is only on the hand in the attack frame it was posed for.
    if (blade) r.drawSpriteAnim(this.sprite, this.bladeAnim, this.bladeAnimT, x, y, opts);
    else r.drawSpriteAnim(this.sprite, this.anim, this.animT, x, y, opts);
    if (blade && !blade.behind) this.drawBlade(r, blade, x, y, flash);
    if (blade && this.charged) this.drawSparkle(r, blade, x, y);
    if (this.st === 'itemGet' && this.itemIcon) r.drawSpriteAnim('item', this.itemIcon, 0, x, y - ITEM_ICON_Y);
  }

  private drawBlade(r: Renderer, pose: SwordPose, x: number, y: number, flash: boolean): void {
    const palette = this.swordLevel() >= 2 ? SWORD2_PALETTE : undefined;
    r.drawSpriteAnim('fx.sword', pose.blade, 0, x + pose.dx, y + pose.dy, { palette, flash });
  }

  /** Twinkle at the tip of a charged blade. */
  private drawSparkle(r: Renderer, pose: SwordPose, x: number, y: number): void {
    const tip = bladeTip(x, y, pose);
    const cycle = r.animDuration('fx.sparkle', 'play') || 0.25;
    r.drawSpriteAnim('fx.sparkle', 'play', this.stT % (cycle * 1.5), Math.round(tip.x), Math.round(tip.y));
  }
}

/** Whether `e`'s hitbox overlaps the box (x, y, w, h), without allocating. */
function overlapsBox(e: Entity, x: number, y: number, w: number, h: number): boolean {
  return e.left < x + w && e.right > x && e.top < y + h && e.bottom > y;
}
