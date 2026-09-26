// =============================================================================
// Entity base class — every runtime actor (player, enemies, objects, pickups,
// projectiles, effects) extends this. Engine per-tick contract (game.ts):
//   for each live entity:  e.tickCommon(dt);  if (e.stun <= 0 || e.ignoresStun) e.update(dt);
//   then contact damage (team 'enemy' with contactDamage > 0 overlapping the player),
//   onPlayerTouch() for entities that define it and overlap the player,
//   then entities with dead === true are removed (onRemove() called).
// Drawing: 'ground' layer entities first, then 'normal' sorted by (y + sortBias),
// then the room 'over' tile layer, then 'above' entities.
// NOTE: tsconfig uses useDefineForClassFields:false — subclasses may redeclare
// fields with initialisers safely; never redeclare a field WITHOUT an initialiser
// expecting it to keep the base value (use `declare` for type narrowing).
// =============================================================================
import type { Dir, EntityInstance, Project, PropValue, SpriteDef } from '../core/types';
import type { DropKind } from '../content/ids';
import type { GameServices, Hit, MoverKind, Renderer } from './api';
import { entityInfo, propOf } from '../core/catalog';
import { type Rect, rectsOverlap, vecToDir, normalize } from '../core/math';

export type Team = 'player' | 'enemy' | 'neutral';
export type DrawLayer = 'ground' | 'normal' | 'above';

/** What a lifted entity looks like while carried/thrown, and what it leaves when it breaks. */
export interface CarryInfo {
  sprite?: string;
  anim?: string;
  palette?: string;
  /** Draw a tile graphic instead of a sprite (lifted bushes/rocks/pots from tiles). */
  tile?: number;
  drop?: DropKind;
  /** Effect sprite played on shatter (default 'fx.shatter'). */
  shatterFx?: string;
  /** Thrown damage to enemies (default 1; rocks 2). */
  damage?: number;
}

let uidCounter = 1;
let runtimeIdCounter = 1;

const spriteCache = new WeakMap<Project, Map<string, SpriteDef>>();
export function findSprite(project: Project, id: string): SpriteDef | undefined {
  let m = spriteCache.get(project);
  if (!m || m.size !== project.sprites.length) {
    m = new Map(project.sprites.map((s) => [s.id, s]));
    spriteCache.set(project, m);
  }
  return m.get(id);
}

/** Duration in seconds of one pass of an anim (0 if unknown). */
export function animLength(project: Project, spriteId: string, anim: string): number {
  const def = findSprite(project, spriteId)?.anims[anim];
  if (!def || def.fps <= 0) return 0;
  return def.frames.length / def.fps;
}

export abstract class Entity {
  readonly uid: number = uidCounter++;
  /** Instance id from the project, or a generated "rt-N" for runtime spawns. */
  id: string;
  type: string;
  inst: EntityInstance | null;
  game: GameServices;

  /** Centre of the hitbox footprint, room-local px. */
  x = 0;
  y = 0;
  /** Height above ground (px, up is positive). */
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Gravity (px/s^2) applied while airborne (z > 0 or vz != 0). 0 = no gravity. */
  gravity = 0;
  /** Hitbox size. */
  w = 12;
  h = 12;
  facing: Dir = 'down';
  team: Team = 'neutral';
  mover: MoverKind = 'walker';
  /** Blocks other movers (blocks, chests, raised pegs, NPCs, closed doors). */
  solid = false;
  hp = 1;
  maxHp = 1;
  /** Seconds of invulnerability remaining. */
  invuln = 0;
  /** Seconds of i-frames granted after taking a hit. */
  invulnOnHit = 0.3;
  /** Seconds stunned (AI frozen). */
  stun = 0;
  ignoresStun = false;
  /** Seconds of white flash remaining (set on hit). */
  hitFlash = 0;
  kbx = 0;
  kby = 0;
  kbTime = 0;
  /** Contact damage to the player in half-hearts (enemies). */
  contactDamage = 0;
  dead = false;
  visible = true;
  sprite = '';
  anim = '';
  animT = 0;
  palette: string | undefined = undefined;
  drawLayer: DrawLayer = 'normal';
  sortBias = 0;
  /** Draw a ground shadow while airborne. */
  shadow = true;
  /** Light radius in dark rooms (0 = none). */
  light = 0;
  /** Counts toward the 'enemiesCleared' condition. */
  countsForClear = false;
  /** Shield can block this (small projectiles). */
  blockable = false;
  /** Player can lift this entity (weight like TileDef.lift), null = not liftable. */
  liftWeight: 0 | 1 | 2 | null = null;
  /** The hookshot latches onto this entity and pulls the player to it (chests, blocks, torches, raised pegs, signs). */
  hookable = false;

  // ---- optional hooks (implement in subclasses as needed) ----
  /** Player pressed the action button while facing/touching this. Return true if handled. */
  onInteract?(): boolean;
  /** Called each tick while the player's hitbox overlaps this entity. */
  onPlayerTouch?(): void;
  /** Called once when removed from the room. */
  onRemove?(): void;
  /** Landed after being airborne. */
  onLand?(): void;
  /** Doors & similar: trigger actions openDoor/closeDoor call this. */
  setOpen?(open: boolean, instant?: boolean): void;
  /** Player lifted this entity (only if liftWeight != null). The player removes it from the room. */
  onLift?(): CarryInfo;
  /** The player has pushed into it continuously for ~0.3 s; return true if it started moving. */
  onPush?(dir: Dir): boolean;
  /** Remotely fetched by the boomerang/hookshot: same effect as the player touching it (pickups). */
  collect?(): void;
  /** Fire touched it (lantern flame, fireball). Return true if it reacted (torches light). */
  ignite?(): boolean;

  constructor(game: GameServices, inst: EntityInstance | null, type?: string) {
    this.game = game;
    this.inst = inst;
    this.type = inst?.type ?? type ?? 'runtime';
    this.id = inst?.id ?? `rt-${runtimeIdCounter++}`;
    if (inst) {
      this.x = inst.x;
      this.y = inst.y;
    }
    const info = entityInfo(this.type);
    if (info) {
      this.w = info.size.w;
      this.h = info.size.h;
      this.countsForClear = info.countsForClear ?? (info.category === 'enemy' || info.category === 'boss');
      if (info.category === 'enemy' || info.category === 'boss') this.team = 'enemy';
    }
    const facing = inst?.props['facing'];
    if (facing === 'up' || facing === 'down' || facing === 'left' || facing === 'right') this.facing = facing;
  }

  /** Read a placed-instance prop with catalog default fallback. */
  prop<T extends PropValue>(key: string, fallback: T): T {
    return propOf(this.inst, key, fallback);
  }

  // ---------------------------------------------------------------- geometry
  get left(): number { return this.x - this.w / 2; }
  get top(): number { return this.y - this.h / 2; }
  get right(): number { return this.x + this.w / 2; }
  get bottom(): number { return this.y + this.h / 2; }

  hitbox(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  rectAt(x: number, y: number): Rect {
    return { x: x - this.w / 2, y: y - this.h / 2, w: this.w, h: this.h };
  }

  overlaps(o: Entity | Rect): boolean {
    return rectsOverlap(this.hitbox(), o instanceof Entity ? o.hitbox() : o);
  }

  distTo(o: { x: number; y: number }): number {
    return Math.hypot(o.x - this.x, o.y - this.y);
  }

  dirTo(o: { x: number; y: number }): Dir {
    return vecToDir(o.x - this.x, o.y - this.y, this.facing);
  }

  /** Unit vector toward a point. */
  vecTo(o: { x: number; y: number }): { x: number; y: number } {
    return normalize(o.x - this.x, o.y - this.y);
  }

  /** Roughly lined up with `o` on either axis (within tol px). */
  alignedWith(o: { x: number; y: number }, tol = 8): 'h' | 'v' | null {
    if (Math.abs(o.y - this.y) <= tol) return 'h';
    if (Math.abs(o.x - this.x) <= tol) return 'v';
    return null;
  }

  // ---------------------------------------------------------------- animation
  /** Switch animation; restarts only if the name changes (or restart=true). */
  play(anim: string, restart = false): void {
    if (this.anim !== anim || restart) {
      this.anim = anim;
      this.animT = 0;
    }
  }

  /** Play "<base>_<facing>". */
  playDir(base: string, restart = false): void {
    this.play(`${base}_${this.facing}`, restart);
  }

  /** True once a non-looping anim has played through. */
  animDone(): boolean {
    const len = animLength(this.game.project, this.sprite, this.anim);
    return len <= 0 || this.animT >= len;
  }

  // ---------------------------------------------------------------- movement
  /** Whether this entity's hitbox would collide at (x, y). Override for special rules (player: flippers, ledges, noclip). */
  isBlockedAt(x: number, y: number): boolean {
    if (this.mover === 'ghost') return false;
    const r = this.rectAt(x, y);
    if (this.game.room.blocked(r, this.mover)) return true;
    return this.game.solidEntityAt(r, this) !== null;
  }

  /**
   * Move by (dx, dy) px with tile + solid-entity collision, in <=1px sub-steps.
   * `slide` (px) enables corner sliding: when blocked on a single-axis move, the
   * entity is nudged perpendicular if an opening lies within `slide` px.
   */
  move(dx: number, dy: number, slide = 0): { hitX: boolean; hitY: boolean } {
    let hitX = false;
    let hitY = false;
    if (dx !== 0) {
      hitX = !this.stepAxis(dx, 0);
      if (hitX && dy === 0 && slide > 0) this.slideAround('x', Math.sign(dx), slide, Math.abs(dx));
    }
    if (dy !== 0) {
      hitY = !this.stepAxis(0, dy);
      if (hitY && dx === 0 && slide > 0) this.slideAround('y', Math.sign(dy), slide, Math.abs(dy));
    }
    return { hitX, hitY };
  }

  /** Move along one axis in <=1px steps. Returns false if blocked before completing. */
  protected stepAxis(dx: number, dy: number): boolean {
    let remaining = Math.abs(dx || dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    while (remaining > 0) {
      const step = Math.min(1, remaining);
      const nx = this.x + sx * step;
      const ny = this.y + sy * step;
      if (this.isBlockedAt(nx, ny)) {
        // Close any fractional gap up to the next whole pixel so we end flush with the obstacle.
        if (sx !== 0) {
          const tx = sx > 0 ? Math.ceil(this.x) : Math.floor(this.x);
          if (tx !== this.x && !this.isBlockedAt(tx, this.y)) this.x = tx;
        }
        if (sy !== 0) {
          const ty = sy > 0 ? Math.ceil(this.y) : Math.floor(this.y);
          if (ty !== this.y && !this.isBlockedAt(this.x, ty)) this.y = ty;
        }
        return false;
      }
      this.x = nx;
      this.y = ny;
      remaining -= step;
    }
    return true;
  }

  private slideAround(axis: 'x' | 'y', dir: number, maxOff: number, amount: number): void {
    for (let o = 1; o <= maxOff; o++) {
      for (const s of [-1, 1]) {
        const p = s * o;
        const free = axis === 'x'
          ? !this.isBlockedAt(this.x + dir, this.y + p) && !this.isBlockedAt(this.x, this.y + p)
          : !this.isBlockedAt(this.x + p, this.y + dir) && !this.isBlockedAt(this.x + p, this.y);
        if (free) {
          const n = Math.min(amount, o);
          if (axis === 'x') this.stepAxis(0, s * n);
          else this.stepAxis(s * n, 0);
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- per-tick
  /** Engine calls this every tick before update(): timers, knockback, gravity, anim clock. */
  tickCommon(dt: number): void {
    this.animT += dt;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);
    if (this.kbTime > 1e-9) {
      // Clamp the last step so knock(dist, time) travels exactly `dist` px.
      const step = Math.min(dt, this.kbTime);
      this.move(this.kbx * step, this.kby * step);
      this.kbTime = this.kbTime - step < 1e-9 ? 0 : this.kbTime - step;
    }
    if (this.gravity > 0 && (this.z > 0 || this.vz !== 0)) {
      this.vz -= this.gravity * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
        this.onLand?.();
      }
    }
  }

  /** AI / behaviour. Not called while stunned unless ignoresStun. */
  update(_dt: number): void {}

  // ---------------------------------------------------------------- combat
  /** Apply knockback of `dist` px along (dx, dy) over `time` seconds. */
  knock(dx: number, dy: number, dist = 16, time = 0.15): void {
    const n = normalize(dx, dy);
    this.kbx = (n.x * dist) / time;
    this.kby = (n.y * dist) / time;
    this.kbTime = time;
  }

  /**
   * Receive a hit. Default: ignore if dead/invulnerable, subtract hp, knockback,
   * stun, i-frames, flash, sound; die() at 0 hp. Return true if it landed.
   * Override for invulnerable enemies, weak points, shields, etc.
   */
  hurt(hit: Hit): boolean {
    if (this.dead || this.invuln > 0) return false;
    this.hp -= hit.damage;
    if (hit.knockback !== 0) this.knock(hit.dx, hit.dy, hit.knockback ?? 16);
    if (hit.stun) this.stun = Math.max(this.stun, hit.stun);
    if (hit.damage > 0) {
      this.invuln = this.invulnOnHit;
      this.hitFlash = 0.12;
      if (this.team === 'enemy') this.game.audio.sfx(this.hp <= 0 ? 'enemyDie' : 'enemyHit');
    }
    if (this.hp <= 0) this.die();
    return true;
  }

  /** Default death: poof, loot (enemies), 'defeated' event, persistDefeat flag, removal. */
  die(): void {
    if (this.dead) return;
    this.dead = true;
    const info = entityInfo(this.type);
    if (this.team === 'enemy') {
      this.game.effect('fx.poof', 'play', this.x, this.y - this.z);
      const drop = this.prop('drop', 'random') as DropKind;
      if (drop !== 'none') this.game.dropLoot(this.x, this.y, drop);
    }
    if (info?.persistDefeat) this.game.setFlag(`defeated:${this.id}`, true);
    this.game.emit({ type: 'defeated', id: this.id, entityType: this.type });
  }

  // ---------------------------------------------------------------- drawing
  /** Default draw: shadow when airborne, sprite anim at (x, y - z), i-frame flicker, hit flash. */
  draw(r: Renderer): void {
    if (!this.visible || !this.sprite) return;
    if (this.invuln > 0 && this.hitFlash <= 0 && Math.floor(this.invuln * 30) % 2 === 0) return;
    if (this.shadow && this.z > 0) r.drawShadow(this.x, this.y + this.h / 2 - 1, Math.max(8, this.w));
    r.drawSpriteAnim(this.sprite, this.anim, this.animT, Math.round(this.x), Math.round(this.y - this.z), {
      palette: this.palette,
      flash: this.hitFlash > 0,
    });
  }
}
