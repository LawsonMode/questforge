// npc.person — a townsperson. Behaviours: still; wander (short random walks
// within 2 tiles of home); pace (back and forth 3 tiles along its starting
// facing). Solid; never walks into the hero or off its area. Talking (action
// button) turns it to face the hero, stops it, shows its dialogue (its name as
// speaker for literal text), then emits 'talk' for talk triggers.
// OWNER: objects agent.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import { DIRS, DIR_VEC, type Rect, type Vec, vecToDir } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { NPC_SPRITES } from '../../../content/ids';
import { rng } from '../../../core/rng';
import { registerEntity } from '../../registry';
import { ObjectEntity, overlapsBox } from '../objects/base';

export type NpcBehavior = 'still' | 'wander' | 'pace';

/** Walking speed (px/s). */
export const NPC_SPEED = 30;
/** Wanderers stay within this many px of home on each axis. */
export const WANDER_RADIUS = 2 * TILE;
/** Pacers walk this far (px) from home and back. */
export const PACE_DIST = 3 * TILE;
const WANDER_STEP = TILE;
const IDLE_MIN = 1;
const IDLE_MAX = 2.5;
const PACE_PAUSE = 0.8;
/** After a talk the NPC keeps facing the hero this long before moving on (s). */
const LINGER = 1.5;
/** Gap (px) an NPC keeps from the hero's hitbox. */
const HERO_GAP = 1;
const EPS = 0.5;

type Step = 'arrived' | 'walking' | 'blocked';

export class Person extends ObjectEntity {
  readonly behavior: NpcBehavior;
  readonly name: string;
  readonly home: Vec;
  /** Area the NPC may occupy (hitbox centre), inclusive. */
  readonly area: Rect;
  private readonly paceEnd: Vec;
  private target: Vec | null = null;
  private waitT = 0;
  private outbound = true;
  private chatting = false;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    const look = this.prop<string>('sprite', 'npc.villager');
    this.sprite = (NPC_SPRITES as readonly string[]).includes(look) ? look : 'npc.villager';
    const b = this.prop<string>('behavior', 'still');
    this.behavior = b === 'wander' || b === 'pace' ? b : 'still';
    this.name = String(this.prop<string>('name', '')).trim();
    this.mover = 'walker';
    this.solid = true;
    this.home = { x: this.x, y: this.y };
    const v = DIR_VEC[this.facing];
    this.paceEnd = { x: this.x + v.x * PACE_DIST, y: this.y + v.y * PACE_DIST };
    this.area = this.behavior === 'wander'
      ? { x: this.x - WANDER_RADIUS, y: this.y - WANDER_RADIUS, w: 2 * WANDER_RADIUS, h: 2 * WANDER_RADIUS }
      : spanRect(this.home, this.behavior === 'pace' ? this.paceEnd : this.home);
    this.waitT = this.behavior === 'wander' ? rng.range(IDLE_MIN, IDLE_MAX) : PACE_PAUSE;
    this.playDir('idle');
  }

  /** In a conversation right now (stands still). */
  get talking(): boolean {
    return this.chatting;
  }

  override onInteract(): boolean {
    if (this.chatting) return true;
    this.facing = this.dirTo(this.game.player);
    this.playDir('idle');
    void this.talk();
    return true;
  }

  override update(dt: number): void {
    if (this.chatting) return;
    if (this.behavior === 'wander') this.updateWander(dt);
    else if (this.behavior === 'pace') this.updatePace(dt);
    else this.playDir('idle');
  }

  /** Walls, solid entities, the hero (never walked into) and the edge of its area all block it. */
  override isBlockedAt(x: number, y: number): boolean {
    if (x < this.area.x - EPS || x > this.area.x + this.area.w + EPS) return true;
    if (y < this.area.y - EPS || y > this.area.y + this.area.h + EPS) return true;
    if (super.isBlockedAt(x, y)) return true;
    const gapW = this.w / 2 + HERO_GAP;
    const gapH = this.h / 2 + HERO_GAP;
    return overlapsBox(this.game.player, x - gapW, y - gapH, 2 * gapW, 2 * gapH);
  }

  private async talk(): Promise<void> {
    this.chatting = true;
    const dialogue = String(this.prop<string>('dialogue', '')).trim();
    try {
      if (dialogue) await this.game.dialogue(dialogue, this.name ? { speaker: this.name } : undefined);
    } finally {
      // Drop any step it was taking, so it lingers facing the hero before walking on.
      this.chatting = false;
      this.target = null;
      this.waitT = Math.max(this.waitT, LINGER);
    }
    if (!this.dead) this.game.emit({ type: 'talk', id: this.id });
  }

  private updateWander(dt: number): void {
    if (this.target) {
      if (this.walkTo(this.target, dt) === 'walking') return;
      this.target = null;
      this.waitT = rng.range(IDLE_MIN, IDLE_MAX);
    }
    this.playDir('idle');
    this.waitT -= dt;
    if (this.waitT > 0) return;
    this.target = this.wanderTarget();
  }

  /** One tile in a random direction, or back toward home when that would leave the area. */
  private wanderTarget(): Vec {
    let dir: Dir = rng.pick(DIRS);
    const at = (d: Dir): Vec => ({ x: this.x + DIR_VEC[d].x * WANDER_STEP, y: this.y + DIR_VEC[d].y * WANDER_STEP });
    if (!this.inArea(at(dir))) dir = vecToDir(this.home.x - this.x, this.home.y - this.y, dir);
    return at(dir);
  }

  private updatePace(dt: number): void {
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.playDir('idle');
      return;
    }
    const step = this.walkTo(this.outbound ? this.paceEnd : this.home, dt);
    if (step === 'walking') return;
    this.outbound = !this.outbound;
    this.waitT = PACE_PAUSE;
    this.playDir('idle');
  }

  /** Walk toward `t` at NPC_SPEED (axis-aligned targets), facing the way it goes. */
  private walkTo(t: Vec, dt: number): Step {
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < EPS) {
      this.x = t.x;
      this.y = t.y;
      return 'arrived';
    }
    const step = Math.min(d, NPC_SPEED * dt);
    this.facing = vecToDir(dx, dy, this.facing);
    this.playDir('walk');
    const hit = this.move((dx / d) * step, (dy / d) * step);
    return hit.hitX || hit.hitY ? 'blocked' : 'walking';
  }

  private inArea(p: Vec): boolean {
    const a = this.area;
    return p.x >= a.x - EPS && p.x <= a.x + a.w + EPS && p.y >= a.y - EPS && p.y <= a.y + a.h + EPS;
  }
}

/** Axis-aligned rect spanning two points (zero-size when they coincide). */
function spanRect(a: Vec, b: Vec): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

registerEntity('npc.person', (game, inst) => new Person(game, inst));
