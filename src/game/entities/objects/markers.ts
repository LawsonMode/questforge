// Invisible markers (their hitboxes show in the debug overlay):
//   marker.warp    fires when the hero's centre enters its rect — but only after the
//                  hero has been outside it at least once since arriving (arriving on
//                  a warp never bounces straight back); plays its sound, optionally
//                  sets the respawn point, then game.warp(target, transition)
//   marker.region  named rect for trigger 'inRegion' conditions
// Both rects are w x h tiles centred on the placement. OWNER: objects agent.
import type { EntityInstance, PropValue, SfxId, WarpTarget } from '../../../core/types';
import type { GameServices } from '../../api';
import { registerEntity } from '../../registry';
import { ObjectEntity } from './base';

type Transition = 'fade' | 'iris' | 'none';

/** A usable warp destination, or null (unset / malformed prop). */
export function warpTarget(v: unknown): WarpTarget | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Partial<WarpTarget>;
  const ok = typeof t.world === 'string' && typeof t.room === 'string' && Number.isFinite(t.x) && Number.isFinite(t.y);
  return ok ? (t as WarpTarget) : null;
}

/** Invisible rect marker. */
abstract class Marker extends ObjectEntity {
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.visible = false;
    this.drawLayer = 'ground';
  }

  /** Whether a point lies inside the marker's rect (same edges as rectContains). */
  contains(x: number, y: number): boolean {
    return x >= this.left && x < this.right && y >= this.top && y < this.bottom;
  }
}

export class Warp extends Marker {
  readonly target: WarpTarget | null;
  readonly transition: Transition;
  readonly sound: SfxId | null;
  readonly setsRespawn: boolean;
  /** The hero has stood outside the rect since this room was entered. */
  private armed = false;
  private fired = false;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.target = warpTarget(this.prop<PropValue>('target', null));
    const tr = this.prop<string>('transition', 'fade');
    this.transition = tr === 'iris' || tr === 'none' ? tr : 'fade';
    const sound = this.prop<string>('sound', 'stairs');
    this.sound = sound === 'stairs' || sound === 'door' ? sound : null;
    this.setsRespawn = this.prop<boolean>('setRespawn', true) === true;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  override update(_dt: number): void {
    const p = this.game.player;
    if (this.fired || p.state === 'dead') return;
    if (!this.contains(p.x, p.y)) {
      this.armed = true;
      return;
    }
    if (this.armed && this.target) this.fire(this.target);
  }

  private fire(target: WarpTarget): void {
    this.fired = true;
    const game = this.game;
    if (this.sound) game.audio.sfx(this.sound);
    if (this.setsRespawn) game.save.respawn = { ...target };
    game.warp({ ...target }, this.transition);
  }
}

export class Region extends Marker {
  get name(): string {
    return String(this.prop<string>('name', 'region'));
  }
}

registerEntity('marker.warp', (game, inst) => new Warp(game, inst));
registerEntity('marker.region', (game, inst) => new Region(game, inst));
