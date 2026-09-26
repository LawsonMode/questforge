// obj.pickup — an item lying on the ground, collected on touch (near the ground)
// or when fetched by the boomerang/hookshot (collect()). Quiet refills (rupees,
// hearts, ammo, magic, fairies, small keys) just sound; everything else gets the
// item-get fanfare. Placed pickups set flag pickup:<id> and never come back;
// transient ones (loot drops, props.transient) pop in with a small bounce, blink
// after 7 s, vanish at 10 s and set no flag — except keys and heart/crystal
// prizes, which never time out. Placed pickups revealed mid-room drop in from
// above with a sparkle. The hero's body (drawn taller than its hitbox) reaches
// things just above its feet, so walking up to a pickup takes it as the sprite
// meets it. Fairies drift about, crystals float and glitter; taking a crystal
// freezes the hero for a short sparkle burst before the item get (the
// dungeon-complete flow reacts to the itemGet event). OWNER: objects agent.
import type { EntityInstance, ItemId } from '../../../core/types';
import type { GameServices, PlayerState, Renderer } from '../../api';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { ObjectEntity, announceReveal, isItemId, itemIcon, numProp, overlapsBox, wantsFanfare } from './base';

/** Transient drops start blinking, then disappear (seconds after spawning). */
export const BLINK_AT = 7;
export const VANISH_AT = 10;
/** Pickups higher than this (px) cannot be touched. */
const TOUCH_MAX_Z = 8;
const SIZE = 10;
/** How far (px) above the hero's hitbox its body reaches for pickups. */
export const BODY_REACH = 8;
/** Hero states in which the body reach applies (not while lifting/carrying, falling, posing...). */
const REACHING: ReadonlySet<PlayerState> = new Set(['normal', 'attack', 'spin', 'charge', 'push', 'dash', 'use', 'swim', 'hurt']);
/** Transient drops of these never blink away (a key an enemy drops must not be lost). */
const KEEPS: ReadonlySet<ItemId> = new Set(['smallKey', 'bigKey', 'heartContainer', 'heartPiece', 'crystal']);
/** Pop-in bounce of loot drops (px/s, px/s^2); the second hop keeps this share of the first. */
const POP_VZ = 70;
const GRAVITY = 420;
const SECOND_HOP = 0.4;
/** Height (px) revealed pickups fall from. */
const REVEAL_Z = 32;
/** Crystal claim: hero frozen this long (s) while the crystal rises and sparkles. */
export const CLAIM_TIME = 0.8;
const CLAIM_RISE = 14;
const CLAIM_SPARKLE_EVERY = 0.05;
/** Sparkles in the ring burst when a crystal is touched, and its radius (px). */
const CLAIM_BURST = 8;
const CLAIM_BURST_R = 14;
/** White screen flash at the start of the claim (s, peak alpha). */
const CLAIM_FLASH = 0.3;
const CLAIM_FLASH_ALPHA = 0.55;
const CRYSTAL_SPARKLE_EVERY = 0.9;

const PICKUP_ANIMS: ReadonlySet<ItemId> = new Set([
  'heart', 'smallKey', 'bigKey', 'bombs', 'arrows', 'heartContainer', 'heartPiece', 'fairy', 'crystal',
]);

/** Sprite + anim for an item on the ground: the 'pickup' sheet when it has one, else the item icon. */
export function pickupLook(item: ItemId, amount: number): { sprite: string; anim: string } {
  if (item === 'rupees') return { sprite: 'pickup', anim: amount >= 20 ? 'rupee_red' : amount >= 5 ? 'rupee_blue' : 'rupee_green' };
  if (item === 'magic') return { sprite: 'pickup', anim: amount >= 16 ? 'magic_large' : 'magic_small' };
  if (PICKUP_ANIMS.has(item)) return { sprite: 'pickup', anim: item };
  return { sprite: 'item', anim: itemIcon(item, amount) };
}

/** Whether a transient drop is in the "off" phase of its blink at `age` seconds. */
export function blinkHidden(age: number): boolean {
  return age >= BLINK_AT && Math.floor(age * 16) % 2 === 1;
}

export interface PickupOptions {
  /** Appear where it is, without the mid-room reveal drop and jingle (a key found under a lifted pot). */
  inPlace?: boolean;
}

export class Pickup extends ObjectEntity {
  readonly item: ItemId | null;
  readonly amount: number;
  readonly transient: boolean;
  /** A transient drop that blinks and vanishes (not a key or prize). */
  readonly expires: boolean;
  private age = 0;
  private hops = 0;
  /** Seconds into the crystal claim (-1 = not claiming). */
  private claimT = -1;
  private sparkleT = 0;
  /** Current drift offset of fairies, applied as a delta so boomerang pulls stick. */
  private driftX = 0;
  private driftY = 0;

  constructor(game: GameServices, inst: EntityInstance, opts: PickupOptions = {}) {
    super(game, inst);
    this.w = SIZE;
    this.h = SIZE;
    const item = this.prop<string>('item', 'smallKey');
    this.item = isItemId(item) ? item : null;
    this.amount = numProp(this, 'amount', 1);
    this.transient = this.prop<boolean>('transient', false) === true;
    this.expires = this.transient && !(this.item && KEEPS.has(this.item));
    const look = pickupLook(this.item ?? 'rupees', this.amount);
    this.sprite = look.sprite;
    this.anim = look.anim;
    if (this.collected) {
      this.dead = true;
      this.visible = false;
      return;
    }
    const revealed = this.midRoom && !this.transient && !opts.inPlace;
    if (this.floats) this.z = this.baseZ();
    else if (this.transient) this.hop(POP_VZ);
    else if (revealed) this.hop(0, REVEAL_Z);
    if (revealed) announceReveal(this);
  }

  /** Save flag of a placed (non-transient) pickup. */
  get flagName(): string {
    return `pickup:${this.id}`;
  }

  get claiming(): boolean {
    return this.claimT >= 0;
  }

  private get collected(): boolean {
    return !this.transient && this.game.flag(this.flagName);
  }

  private get floats(): boolean {
    return this.item === 'fairy' || this.item === 'crystal';
  }

  override onPlayerTouch(): void {
    if (this.z < TOUCH_MAX_Z) this.take();
  }

  override collect(): void {
    this.take();
  }

  override onLand(): void {
    if (this.hops++ === 0 && this.transient) this.hop(POP_VZ * SECOND_HOP);
  }

  override onRemove(): void {
    if (this.claiming) this.game.player.setLocked(false);
  }

  override update(dt: number): void {
    this.age += dt;
    if (this.claiming) {
      this.updateClaim(dt);
      return;
    }
    if (this.item === 'fairy') this.driftTo(Math.sin(this.age * 1.1) * 14, Math.sin(this.age * 0.7 + 1) * 8);
    if (this.floats) this.z = this.baseZ();
    if (this.item === 'crystal') this.glitter(dt);
    if (this.expires && this.age >= VANISH_AT) this.dead = true;
    else if (this.bodyReaches()) this.take();
  }

  override draw(r: Renderer): void {
    if (!this.visible || (this.expires && blinkHidden(this.age))) return;
    if (this.z > 0.5) r.drawShadow(this.x, this.bottom - 1, 8);
    r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x), Math.round(this.y - this.z));
    if (this.claiming && this.claimT < CLAIM_FLASH) r.overlay('#ffffff', CLAIM_FLASH_ALPHA * (1 - this.claimT / CLAIM_FLASH));
  }

  /** The walking hero's body (its hitbox stretched BODY_REACH px upward) overlaps this, near the ground. */
  private bodyReaches(): boolean {
    const p = this.game.player;
    if (this.z >= TOUCH_MAX_Z || p.z >= TOUCH_MAX_Z || !p.visible || !REACHING.has(p.state)) return false;
    return overlapsBox(this, p.left, p.top - BODY_REACH, p.w, p.h + BODY_REACH);
  }

  private take(): void {
    if (this.dead || this.claiming) return;
    if (this.item === 'crystal') this.startClaim();
    else this.finish();
  }

  private finish(): void {
    this.dead = true;
    if (!this.transient) this.game.setFlag(this.flagName, true);
    if (this.item) this.game.giveItem(this.item, this.amount, { fanfare: wantsFanfare(this.item) });
  }

  private startClaim(): void {
    this.claimT = 0;
    // The idle glitter's timer would otherwise delay the claim's own sparkles by up to CRYSTAL_SPARKLE_EVERY.
    this.sparkleT = 0;
    this.game.player.setLocked(true);
    this.game.audio.sfx('crystal');
    this.game.camera.shake(0.3, 1);
    for (let i = 0; i < CLAIM_BURST; i++) {
      const a = (i / CLAIM_BURST) * Math.PI * 2;
      this.sparkle(Math.cos(a) * CLAIM_BURST_R, Math.sin(a) * CLAIM_BURST_R);
    }
  }

  private updateClaim(dt: number): void {
    this.claimT += dt;
    const p = Math.min(1, this.claimT / CLAIM_TIME);
    this.z = this.baseZ() + CLAIM_RISE * p;
    this.sparkleT -= dt;
    if (this.sparkleT <= 0) {
      this.sparkleT = CLAIM_SPARKLE_EVERY;
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(6, 16 + 10 * p);
      this.sparkle(Math.cos(a) * d, Math.sin(a) * d);
    }
    if (this.claimT < CLAIM_TIME) return;
    this.game.player.setLocked(false);
    this.claimT = -1;
    this.finish();
  }

  /** A sparkle at an offset from the (raised) item, drawn above everything. */
  private sparkle(dx: number, dy: number): void {
    this.game.effect('fx.sparkle', 'play', this.x + dx, this.y - this.z + dy, { above: true });
  }

  private glitter(dt: number): void {
    this.sparkleT -= dt;
    if (this.sparkleT > 0) return;
    this.sparkleT = CRYSTAL_SPARKLE_EVERY;
    this.game.effect('fx.sparkle', 'play', this.x + rng.range(-7, 7), this.y - this.z + rng.range(-9, 3));
  }

  private driftTo(dx: number, dy: number): void {
    this.x += dx - this.driftX;
    this.y += dy - this.driftY;
    this.driftX = dx;
    this.driftY = dy;
  }

  private baseZ(): number {
    return this.item === 'fairy' ? 8 + Math.sin(this.age * 5) * 2 : 6 + Math.sin(this.age * 2) * 2;
  }

  /** Jump up at `vz` px/s from height `z`, falling under gravity. */
  private hop(vz: number, z = this.z): void {
    this.z = z;
    this.vz = vz;
    this.gravity = GRAVITY;
  }
}

registerEntity('obj.pickup', (game, inst) => new Pickup(game, inst));
