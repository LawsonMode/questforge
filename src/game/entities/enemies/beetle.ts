// Shell Beetle (enemy.beetle): invulnerable. It creeps toward the hero and
// shoves them on contact; weapons only knock it far back (with a tink) along
// the hit's main axis, sliding over pits and water (walls, objects and ledges
// stop it). The moment its centre is over a pit (or deep water) it drops in:
// it shrinks away, poofs and counts as defeated. In a room with neither,
// nothing can beat it, so there it does not count toward clearing the room
// (no shutter soft-locks).
import type { Collision, EntityInstance } from '../../../core/types';
import type { GameServices, Hit, Renderer, RoomRuntime } from '../../api';
import { DIR_VEC, approach, vecToDir, type Rect, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { Enemy } from './common';

const CONTACT_DAMAGE = 1;
const CREEP_SPEED = 18;
/** Knockback from any weapon hit: distance (px) and duration (s). */
const KNOCK_DIST = 48;
const KNOCK_TIME = 0.3;
/** Pause (s) after a knockback before creeping again. */
const RECOVER_TIME = 0.5;
/** Seconds to shrink away after dropping into a pit, and the pull (px/s) toward the middle of its tile. */
const FALL_TIME = 0.5;
const FALL_PULL = 32;
/** Farthest (px) loot is moved to reach walkable ground beside the pit. */
const LOOT_REACH = 48;
/** Collision is resolved per 8x8 quarter tile. */
const CELL = TILE / 2;
/** Float slack for cell ranges (same as the engine's RoomRuntime.blocked). */
const EPS = 1e-6;

/** Ground the beetle drops into when its centre is over it. */
function swallows(c: Collision): boolean {
  return c === 'pit' || c === 'deep';
}

/** Whether any 8x8 cell under the half-open rect `r` is a ledge. */
function touchesLedge(room: RoomRuntime, r: Rect): boolean {
  const c1 = Math.ceil((r.x + r.w) / CELL - EPS) - 1;
  const r1 = Math.ceil((r.y + r.h) / CELL - EPS) - 1;
  for (let cy = Math.floor(r.y / CELL + EPS); cy <= r1; cy++) {
    for (let cx = Math.floor(r.x / CELL + EPS); cx <= c1; cx++) {
      if (room.collisionAt(cx * CELL, cy * CELL) === 'ledge') return true;
    }
  }
  return false;
}

/** Whether any 8x8 cell of the room is pit or deep water (somewhere a beetle can be beaten). */
export function roomHasDrop(room: RoomRuntime): boolean {
  for (let y = CELL / 2; y < room.height; y += CELL) {
    for (let x = CELL / 2; x < room.width; x += CELL) {
      if (swallows(room.collisionAt(x, y))) return true;
    }
  }
  return false;
}

/** Fill `out` with the w x h rect centred on (cx, cy) (scratch rects keep collision checks allocation-free). */
function centredRect(out: Rect, cx: number, cy: number, w: number, h: number): Rect {
  out.x = cx - w / 2;
  out.y = cy - h / 2;
  out.w = w;
  out.h = h;
  return out;
}

/** The shell beetle. */
export class Beetle extends Enemy {
  private recover = 0;
  private fallT = -1;
  /** Middle of the pit tile it dropped into. */
  private readonly fallTo: Vec = { x: 0, y: 0 };
  private readonly probe: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly body: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly point: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(game: GameServices, inst: EntityInstance | null) {
    super(game, inst, 'enemy.beetle');
    this.sprite = 'enemy.beetle';
    this.anim = 'walk';
    this.touchDamage = CONTACT_DAMAGE;
    if (!roomHasDrop(game.room)) this.countsForClear = false;
  }

  /** True once it has dropped into a pit (shrinking away). */
  get falling(): boolean {
    return this.fallT >= 0;
  }

  /**
   * The ground under its centre is checked every tick, right after the knockback step
   * (mid-shove, stunned or not yet awake), so no 48 px slide can carry it across a pit.
   */
  override tickCommon(dt: number): void {
    super.tickCommon(dt);
    if (this.falling) {
      this.sink(dt);
      return;
    }
    const ground = this.game.room.collisionAt(this.x, this.y);
    if (swallows(ground)) this.startFall(ground);
  }

  protected think(dt: number): void {
    if (this.falling || this.kbTime > 0) return;
    this.recover = Math.max(0, this.recover - dt);
    if (this.recover > 0 || !this.heroTargetable()) return;
    this.chase(this.hero, CREEP_SPEED, dt);
  }

  /**
   * Shoves slide over pits and water; solid tiles, objects and ledges stop them (so a
   * shove never hops it down a ledge or leaves it resting on one). Otherwise walker
   * rules, relaxed while it overlaps ground it cannot walk on (a shove left it on a
   * pit rim, or it was placed on a ledge): it may then shuffle anywhere that keeps its
   * centre off a pit or deep water and, if its centre is on walkable ground, keeps it
   * there, so it can always walk clear but never walks itself in.
   */
  override isBlockedAt(x: number, y: number): boolean {
    const room = this.game.room;
    const to = centredRect(this.probe, x, y, this.w, this.h);
    if (room.blocked(to, 'flyer') || this.game.solidEntityAt(to, this)) return true;
    const here = centredRect(this.body, this.x, this.y, this.w, this.h);
    if (this.kbTime > 0) return touchesLedge(room, to) && !touchesLedge(room, here);
    if (!room.blocked(to, 'walker')) return false;
    if (!room.blocked(here, 'walker') || swallows(room.collisionAt(x, y))) return true;
    const centreFirm = !room.blocked(centredRect(this.point, this.x, this.y, 1, 1), 'walker');
    return centreFirm && room.blocked(centredRect(this.point, x, y, 1, 1), 'walker');
  }

  /** Weapons can't hurt the shell: they send it sliding instead. */
  override hurt(hit: Hit): boolean {
    if (this.dead || this.falling || hit.kind === 'contact') return false;
    const dir = this.shoveDir(hit);
    if (!dir) return false;
    this.knock(dir.x, dir.y, KNOCK_DIST, KNOCK_TIME);
    if (hit.stun) this.stun = Math.max(this.stun, hit.stun);
    this.recover = RECOVER_TIME;
    this.hitFlash = 0.06;
    this.game.audio.sfx('swordTink');
    return true;
  }

  /** Loot lands on walkable ground beside the pit it fell into (not down it). */
  protected override lootAt(): Vec | null {
    return this.floorSpotNear(LOOT_REACH);
  }

  /** Shrinks toward its centre while falling. */
  override draw(r: Renderer): void {
    if (!this.falling) {
      super.draw(r);
      return;
    }
    const s = 1 - this.fallT / FALL_TIME;
    if (s <= 0 || !this.visible) return;
    const ctx = r.ctx;
    const cx = Math.round(this.x) - Math.round(r.camX);
    const cy = Math.round(this.y) - Math.round(r.camY);
    ctx.save();
    try {
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x), Math.round(this.y));
    } finally {
      ctx.restore();
    }
  }

  /** Unit shove direction for a hit, snapped to its main axis so pit puzzles line up; null if it has none. */
  private shoveDir(hit: Hit): Vec | null {
    let dx = hit.dx;
    let dy = hit.dy;
    if (dx === 0 && dy === 0 && hit.source) {
      dx = this.x - hit.source.x;
      dy = this.y - hit.source.y;
    }
    return dx === 0 && dy === 0 ? null : DIR_VEC[vecToDir(dx, dy)];
  }

  /** Shrinking away down the pit, drawn toward the middle of its tile. */
  private sink(dt: number): void {
    this.fallT += dt;
    this.x = approach(this.x, this.fallTo.x, FALL_PULL * dt);
    this.y = approach(this.y, this.fallTo.y, FALL_PULL * dt);
    if (this.fallT >= FALL_TIME) this.die();
  }

  private startFall(ground: Collision): void {
    this.fallT = 0;
    this.fallTo.x = Math.floor(this.x / TILE) * TILE + TILE / 2;
    this.fallTo.y = Math.floor(this.y / TILE) * TILE + TILE / 2;
    this.kbTime = 0;
    this.kbx = 0;
    this.kby = 0;
    this.touchDamage = 0;
    this.contactDamage = 0;
    if (ground === 'deep') {
      this.game.audio.sfx('splash');
      this.game.effect('fx.splash', 'play', this.x, this.y);
    } else {
      this.game.audio.sfx('fall');
    }
  }
}

registerEntity('enemy.beetle', (game, inst) => new Beetle(game, inst));
