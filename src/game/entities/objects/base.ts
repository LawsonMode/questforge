// Shared base class and helpers for placed objects, pickups, markers and NPCs:
// damage immunity, catalog footprints, "is the hero facing me" probes, item
// icons, the fanfare rule and the "revealed mid-room" sparkle. OWNER: objects agent.
import type { Dir, EntityInstance, ItemId } from '../../../core/types';
import type { GameServices } from '../../api';
import { ITEM_IDS } from '../../../core/types';
import { ITEM_INFO } from '../../../content/ids';
import { footprint } from '../../../core/catalog';
import { type Rect, rectsOverlap } from '../../../core/math';
import { Entity } from '../../entity';

/** Items collected quietly (no item-get pose): money, refills, ammo, keys. */
const NO_FANFARE: ReadonlySet<ItemId> = new Set(['rupees', 'heart', 'arrows', 'bombs', 'magic', 'fairy', 'smallKey']);

/**
 * Permanent invulnerability: Entity.hurt() bails out while invuln > 0. Objects use
 * this instead of overriding hurt(), because the hero's attacks (projectiles/targets.ts)
 * treat an overridden hurt() as "wants to be hit". The i-frame flicker in Entity.draw
 * never triggers for it (Infinity % 2 is NaN).
 */
export const IMMUNE = Number.POSITIVE_INFINITY;

/**
 * A placed, inanimate thing: its hitbox is the catalog footprint, it never moves
 * by itself (mover 'ghost', so tall grass is not drawn over it) and generic damage
 * (a bomb blast hurting everything in range) cannot hurt or remove it. Subclasses
 * that react to attacks (crystal switch, bombable door) override hurt() and stay
 * hittable.
 */
export abstract class ObjectEntity extends Entity {
  /** Created in a room that was already running (a trigger's showEntity, a drop), not by the room-entry spawn. */
  protected readonly midRoom: boolean;

  constructor(game: GameServices, inst: EntityInstance | null, type?: string) {
    super(game, inst, type);
    if (inst) {
      const size = footprint(inst);
      this.w = size.w;
      this.h = size.h;
    }
    this.mover = 'ghost';
    this.shadow = false;
    if (this.hurt === Entity.prototype.hurt) this.invuln = IMMUNE;
    this.midRoom = spawnedMidRoom(game);
  }
}

/**
 * A runtime helper tied to an owner object (a shop's price tag, a doorway's
 * jambs): never hurt, nothing blocks it, and it goes when its owner goes.
 */
export abstract class Companion<T extends Entity> extends Entity {
  readonly owner: T;

  constructor(owner: T, type: string) {
    super(owner.game, null, type);
    this.owner = owner;
    this.mover = 'ghost';
    this.shadow = false;
    this.invuln = IMMUNE;
  }

  override update(_dt: number): void {
    if (this.owner.dead) this.dead = true;
  }
}

/** Whether `e`'s hitbox overlaps the box (x, y, w, h) — the allocation-free form of rectsOverlap. */
export function overlapsBox(e: Entity, x: number, y: number, w: number, h: number): boolean {
  return e.left < x + w && e.right > x && e.top < y + h && e.bottom > y;
}

/** Rect `reach` px deep in front of `e`'s hitbox on its facing side, `inset` px narrower per side (negative = wider). */
export function frontProbe(e: Entity, reach: number, inset = 2): Rect {
  switch (e.facing) {
    case 'up': return { x: e.left + inset, y: e.top - reach, w: e.w - 2 * inset, h: reach };
    case 'down': return { x: e.left + inset, y: e.bottom, w: e.w - 2 * inset, h: reach };
    case 'left': return { x: e.left - reach, y: e.top + inset, w: reach, h: e.h - 2 * inset };
    case 'right': return { x: e.right, y: e.top + inset, w: reach, h: e.h - 2 * inset };
  }
}

export interface FacingOpts {
  /** Probe depth in px (default 6). */
  reach?: number;
  /** Probe inset per side in px (default 2; negative widens it). */
  inset?: number;
  /** The hero must face this way (e.g. 'up' = approaching from below). */
  dir?: Dir;
}

/** Whether the hero faces `target` from close by (its front probe overlaps the target's hitbox). */
export function heroFaces(game: GameServices, target: Entity, opts: FacingOpts = {}): boolean {
  const p = game.player;
  if (opts.dir && p.facing !== opts.dir) return false;
  return rectsOverlap(frontProbe(p, opts.reach ?? 6, opts.inset ?? 2), target.hitbox());
}

/** Gameplay time of the first object created in each room runtime (its entry spawn). */
const roomBorn = new WeakMap<object, number>();

/**
 * True when an object is created in a room that is already running (a trigger's
 * showEntity, a boss drop) rather than by the room-entry spawn. The session says
 * so outright: its `spawningRoom` is true exactly while it spawns a room's placed
 * entities (read through a narrow cast; GameServices is a frozen contract).
 * Other hosts (tests, previews) fall back to timing: every object notes its
 * room's first spawn time; entry spawns all happen at that instant, so gameplay
 * time having moved on since means mid-room, and for the first object of a room
 * the hero's anim clock tells (restarted when the hero is placed on entry).
 */
function spawnedMidRoom(game: GameServices): boolean {
  const spawning = (game as { spawningRoom?: unknown }).spawningRoom;
  if (typeof spawning === 'boolean') return !spawning;
  const born = roomBorn.get(game.room);
  if (born !== undefined) return game.time > born;
  roomBorn.set(game.room, game.time);
  return game.player.animT > 0;
}

/** Sparkle + 'secret' jingle for something that just appeared (revealed chest or pickup, at its height). */
export function announceReveal(e: Entity): void {
  const y = e.y - e.z;
  e.game.audio.sfx('secret');
  e.game.effect('fx.sparkle', 'play', e.x, y - 4, { above: true });
  e.game.effect('fx.sparkle', 'play', e.x - 6, y + 3, { above: true });
  e.game.effect('fx.sparkle', 'play', e.x + 6, y + 3, { above: true });
}

/** Whether a prop value is a real ItemId (guards hand-edited projects). */
export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v);
}

/** Item-get pose for everything except quiet refills (rupees, hearts, ammo, magic, fairies, small keys). */
export function wantsFanfare(item: ItemId): boolean {
  return !NO_FANFARE.has(item);
}

/** Anim of the 'item' sprite for an item; level items use their level-2 icon when amount >= 2. */
export function itemIcon(item: ItemId, amount = 1): string {
  const info = ITEM_INFO[item];
  return info.icon2 && amount >= 2 ? info.icon2 : info.icon;
}

/** A numeric prop, falling back when missing or not a finite number. */
export function numProp(e: Entity, key: string, fallback: number): number {
  const v = Number(e.prop<number>(key, fallback));
  return Number.isFinite(v) ? v : fallback;
}
