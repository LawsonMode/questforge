// obj.block — push block. The hero pushes into it for ~0.3 s, the player calls
// onPush(dir): it slides exactly one tile (16 px over 0.25 s) if the spot is free
// (walker tile rules, no solid entity, no enemy), honouring its 'dir' limit;
// heavy blocks need the Stone Gauntlet (item id glove); 'once' blocks lock after one push. Like in the
// classic games a block never enters a doorway, a warp or stairs, so it cannot
// seal a room's exit. Emits blockPushed when it comes to rest. Solid and
// hookable; floor switches see it. OWNER: objects agent.
import type { Dir, EntityInstance } from '../../../core/types';
import type { GameServices, RoomRuntime } from '../../api';
import type { Entity } from '../../entity';
import { DIR_VEC, lerp, type Rect, type Vec } from '../../../core/math';
import { TILE } from '../../../core/constants';
import { registerEntity } from '../../registry';
import { ObjectEntity, overlapsBox } from './base';

/** Seconds one push takes (one tile). */
export const PUSH_TIME = 0.25;
/** Sample spacing (px) of the stairs check: the engine's collision cell. */
const CELL = TILE / 2;

/** Things a block may not be pushed onto: enemies, doorways (open or shut) and warps. */
function blocksBlock(e: Entity): boolean {
  return e.team === 'enemy' || e.type === 'obj.door' || e.type === 'marker.warp';
}

/** Whether any collision cell under `r` is stairs. */
function coversStairs(room: RoomRuntime, r: Rect): boolean {
  for (let y = r.y + CELL / 2; y < r.y + r.h; y += CELL) {
    for (let x = r.x + CELL / 2; x < r.x + r.w; x += CELL) {
      if (room.collisionAt(x, y) === 'stairs') return true;
    }
  }
  return false;
}

export class Block extends ObjectEntity {
  readonly heavy: boolean;
  readonly once: boolean;
  /** The only direction it may be pushed, or 'any'. */
  readonly allowed: Dir | 'any';
  private moves = 0;
  private slideT = 0;
  private from: Vec = { x: 0, y: 0 };
  private to: Vec = { x: 0, y: 0 };

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.heavy = this.prop<boolean>('heavy', false) === true;
    this.once = this.prop<string>('pushes', 'once') !== 'free';
    const dir = this.prop<string>('dir', 'any');
    this.allowed = dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right' ? dir : 'any';
    this.sprite = 'obj.block';
    this.anim = this.heavy ? 'heavy' : 'idle';
    this.solid = true;
    this.hookable = true;
  }

  /** Has been pushed at least once (and come to rest). */
  get pushed(): boolean {
    return this.moves > 0;
  }

  get moving(): boolean {
    return this.slideT > 0;
  }

  override onPush(dir: Dir): boolean {
    if (this.moving || (this.once && this.pushed)) return false;
    if (this.allowed !== 'any' && this.allowed !== dir) return false;
    if (this.heavy && !this.game.hasItem('glove', 1)) return false;
    const v = DIR_VEC[dir];
    const to = { x: this.x + v.x * TILE, y: this.y + v.y * TILE };
    if (!this.freeAt(to.x, to.y)) return false;
    this.from = { x: this.x, y: this.y };
    this.to = to;
    this.slideT = PUSH_TIME;
    this.game.audio.sfx('push');
    return true;
  }

  override update(dt: number): void {
    if (this.slideT <= 0) return;
    this.slideT = Math.max(0, this.slideT - dt);
    const p = 1 - this.slideT / PUSH_TIME;
    this.x = lerp(this.from.x, this.to.x, p);
    this.y = lerp(this.from.y, this.to.y, p);
    if (this.slideT > 0) return;
    this.moves++;
    this.game.emit({ type: 'blockPushed', id: this.id });
  }

  /** Whether the block could rest at (x, y). */
  private freeAt(x: number, y: number): boolean {
    const r = this.rectAt(x, y);
    const game = this.game;
    if (game.room.blocked(r, 'walker') || coversStairs(game.room, r) || game.solidEntityAt(r, this)) return false;
    return !game.entities.some((e) => !e.dead && blocksBlock(e) && overlapsBox(e, r.x, r.y, r.w, r.h));
  }
}

registerEntity('obj.block', (game, inst) => new Block(game, inst));
