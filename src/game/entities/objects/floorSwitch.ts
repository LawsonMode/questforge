// obj.switch — floor switch, pressed while the hero (on the ground) or a push
// block / pot overlaps its centre 8x8. Modes: once (stays on), hold (on while
// pressed), toggle (each new press flips it). Emits { type: 'switch', id, on }
// whenever its state changes. Drawn on the ground layer. OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { GameServices } from '../../api';
import type { Entity } from '../../entity';
import { registerEntity } from '../../registry';
import { ObjectEntity, overlapsBox } from './base';

export type SwitchMode = 'once' | 'hold' | 'toggle';

/** Side (px) of the centre square that must be covered to press it. */
const CORE = 8;
/** Things higher than this (px) float over the switch. */
const MAX_Z = 2;

/** New on-state of a switch whose pressure just changed to `pressed`. */
export function nextSwitchState(mode: SwitchMode, on: boolean, pressed: boolean): boolean {
  switch (mode) {
    case 'once': return on || pressed;
    case 'hold': return pressed;
    case 'toggle': return pressed ? !on : on;
  }
}

/** Whether `e` weighs a switch down: the hero or a block / pot, on the ground. */
export function pressesSwitch(e: Entity, hero: Entity): boolean {
  if (e.dead || e.z >= MAX_Z) return false;
  return e === hero || e.type === 'obj.block' || e.type === 'obj.pot';
}

export class FloorSwitch extends ObjectEntity {
  readonly mode: SwitchMode;
  private state = false;
  private pressed = false;

  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    const mode = this.prop<string>('mode', 'once');
    this.mode = mode === 'hold' || mode === 'toggle' ? mode : 'once';
    this.sprite = 'obj.switch';
    this.anim = 'up';
    this.drawLayer = 'ground';
  }

  /** Current switch state (what 'switch' trigger conditions test). */
  get on(): boolean {
    return this.state;
  }

  /** Something is standing on it right now. */
  get isPressed(): boolean {
    return this.pressed;
  }

  override update(_dt: number): void {
    const now = this.weighedDown();
    if (now === this.pressed) return;
    this.pressed = now;
    const next = nextSwitchState(this.mode, this.state, now);
    if (next !== this.state) {
      this.state = next;
      this.game.audio.sfx('switch');
      this.game.emit({ type: 'switch', id: this.id, on: next });
    }
    this.play(this.state || this.pressed ? 'down' : 'up');
  }

  /** Something that presses switches covers the centre square. */
  private weighedDown(): boolean {
    const hero = this.game.player;
    const x = this.x - CORE / 2;
    const y = this.y - CORE / 2;
    for (const e of this.game.entities) {
      if (overlapsBox(e, x, y, CORE, CORE) && pressesSwitch(e, hero)) return true;
    }
    return false;
  }
}

registerEntity('obj.switch', (game, inst) => new FloorSwitch(game, inst));
