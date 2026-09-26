// Base class for everything the hero fires, throws or places: team 'player',
// mover 'projectile' (flies over pits and water), blocked by walls inside the
// room only — past the room's edge is open air (it may be the next screen), and
// each projectile decides what leaving the room means (roomExit). Entities are
// handled by each projectile's own overlap checks (targets.ts). Leaving the room
// through a scroll or warp ends it.
import type { GameServices } from '../api';
import { Entity } from '../entity';
import { outsideRoom, wallIn } from './tiles';

export abstract class PlayerProjectile extends Entity {
  constructor(game: GameServices, type: string, x: number, y: number) {
    super(game, null, type);
    this.team = 'player';
    this.mover = 'projectile';
    this.shadow = false;
    this.x = x;
    this.y = y;
  }

  /** Walls inside the room only (solid entities are targets or obstacles decided by the subclass). */
  override isBlockedAt(x: number, y: number): boolean {
    return wallIn(this.game, this.rectAt(x, y));
  }

  /** Projectiles ignore generic damage. */
  override hurt(): boolean {
    return false;
  }

  /** Removed with its room: gone for good (frees "one at a time" item slots). */
  override onRemove(): void {
    this.dead = true;
  }

  /** How much of the hitbox is past the room's edge. */
  protected roomExit(): 'none' | 'part' | 'all' {
    return outsideRoom(this.game.room, this.hitbox());
  }
}

/** Live instances of a projectile class in the room (for "at most N at a time" rules). */
export function countLive(game: GameServices, cls: abstract new (...args: never[]) => PlayerProjectile): number {
  let n = 0;
  for (const e of game.entities) if (e instanceof cls && !e.dead) n++;
  return n;
}
