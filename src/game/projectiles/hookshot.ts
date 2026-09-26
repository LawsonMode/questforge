// The hookshot: the claw shoots up to 7 tiles straight ahead at HOOK_SPEED,
// trailing a chain back to the hero's hand. It latches onto hookable entities
// (chests, blocks, torches, raised pegs, signs) — the hero is then pulled to
// them (Player drives the pull) — stuns enemies, strikes crystal switches,
// fetches a pickup, and retracts from walls (clink), at full length or at the
// room's edge (silently).
import type { Dir } from '../../core/types';
import type { Entity } from '../entity';
import type { GameServices, Hit, Renderer } from '../api';
import type { Vec } from '../../core/math';
import { DIR_VEC } from '../../core/math';
import { PlayerProjectile } from './projectile';
import { strike, strikeRole, touching } from './targets';

/** Chain length (px) and claw speed out / back (px/s). */
export const HOOK_RANGE = 112;
export const HOOK_SPEED = 320;
/** Seconds enemies stay stunned. */
export const HOOK_STUN = 2;
/** Chain links are drawn every LINK_GAP px; the claw and chain ride HOOK_Z px up (hand height). */
const LINK_GAP = 6;
const HOOK_Z = 5;
/** Hand offset (px, from the hero's origin) the chain starts at, per facing. */
const HAND: Readonly<Record<Dir, Vec>> = {
  up: { x: 3, y: -6 }, down: { x: -3, y: 4 }, left: { x: -7, y: -1 }, right: { x: 7, y: -1 },
};

export type HookPhase = 'out' | 'back' | 'pull';

/** Where a hero of size w x h, pulled along `dir` onto `target`, stops: touching its near side. */
export function pullDestination(target: Entity, dir: Dir, from: Vec, w: number, h: number): Vec {
  switch (dir) {
    case 'up': return { x: from.x, y: target.bottom + h / 2 };
    case 'down': return { x: from.x, y: target.top - h / 2 };
    case 'left': return { x: target.right + w / 2, y: from.y };
    case 'right': return { x: target.left - w / 2, y: from.y };
  }
}

export class Hookshot extends PlayerProjectile {
  private readonly owner: Entity;
  private readonly dir: Dir;
  private hookPhase: HookPhase = 'out';
  private extended = 0;
  private anchor: Entity | null = null;
  private cargo: Entity | null = null;
  private readonly hit: Hit;

  constructor(game: GameServices, owner: Entity, dir: Dir) {
    const hand = HAND[dir];
    super(game, 'hookshot', owner.x + hand.x, owner.y + hand.y);
    this.owner = owner;
    this.dir = dir;
    this.facing = dir;
    this.w = 8;
    this.h = 8;
    this.z = HOOK_Z;
    this.sprite = 'proj.hookshot';
    this.anim = `head_${dir}`;
    const v = DIR_VEC[dir];
    this.hit = { damage: 0, kind: 'hookshot', source: this, dx: v.x, dy: v.y, knockback: 0, stun: HOOK_STUN };
  }

  get phase(): HookPhase {
    return this.hookPhase;
  }

  /** Stop extending and reel the claw back in. */
  retract(): void {
    if (this.hookPhase === 'out') this.hookPhase = 'back';
  }

  /** The pull is over (the hero arrived). */
  finish(): void {
    this.dead = true;
  }

  /** Where the hero's origin is pulled to. */
  pullTarget(): Vec | null {
    if (!this.anchor) return null;
    return pullDestination(this.anchor, this.dir, this.owner, this.owner.w, this.owner.h);
  }

  override update(dt: number): void {
    if (this.hookPhase === 'out') this.extend(dt);
    else if (this.hookPhase === 'back') this.reel(dt);
    else if (!this.anchor || this.anchor.dead) this.dead = true;
    if (this.cargo && !this.cargo.dead) {
      this.cargo.x = this.x;
      this.cargo.y = this.y;
    }
  }

  override draw(r: Renderer): void {
    const hand = this.handPos();
    const dx = this.x - hand.x;
    const dy = this.y - hand.y;
    const links = Math.floor(Math.hypot(dx, dy) / LINK_GAP);
    for (let i = 1; i <= links; i++) {
      const t = (i * LINK_GAP) / Math.max(1, Math.hypot(dx, dy));
      r.drawSpriteAnim(this.sprite, 'chain', 0, Math.round(hand.x + dx * t), Math.round(hand.y + dy * t - this.z));
    }
    r.drawSpriteAnim(this.sprite, this.anim, 0, Math.round(this.x), Math.round(this.y - this.z));
  }

  private handPos(): Vec {
    const hand = HAND[this.dir];
    return { x: this.owner.x + hand.x, y: this.owner.y + hand.y };
  }

  private extend(dt: number): void {
    const v = DIR_VEC[this.dir];
    const moved = this.move(v.x * HOOK_SPEED * dt, v.y * HOOK_SPEED * dt);
    this.extended += HOOK_SPEED * dt;
    if (this.catchSomething()) return;
    if (moved.hitX || moved.hitY) this.clink();
    else if (this.extended >= HOOK_RANGE || this.roomExit() !== 'none') this.hookPhase = 'back';
  }

  /** Reel back to the hand (through anything); gone once home, delivering what it fetched. */
  private reel(dt: number): void {
    const hand = this.handPos();
    const dx = hand.x - this.x;
    const dy = hand.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = HOOK_SPEED * dt;
    if (d <= step) {
      this.dead = true;
      if (this.cargo && !this.cargo.dead) this.cargo.collect?.();
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  /** React to the first thing the claw touches; true if it stopped extending. */
  private catchSomething(): boolean {
    for (const e of touching(this.game, this.hitbox(), this.owner.x, this.owner.y, this)) {
      if (e === this.owner) continue;
      if (e.hookable) {
        this.latch(e);
        return true;
      }
      const role = strikeRole(e);
      if (role === 'collect') {
        this.cargo = e;
        this.hookPhase = 'back';
        return true;
      }
      const res = strike(e, this.hit);
      if (res === 'pass') continue;
      if (res === 'hit') this.hookPhase = 'back';
      else this.clink();
      return true;
    }
    return false;
  }

  private latch(e: Entity): void {
    this.anchor = e;
    this.hookPhase = 'pull';
    this.game.audio.sfx('swordTink');
  }

  private clink(): void {
    this.hookPhase = 'back';
    this.game.effect('fx.hit', 'play', this.x, this.y - this.z);
    this.game.audio.sfx('swordTink');
  }
}
