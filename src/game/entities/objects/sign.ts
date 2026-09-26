// obj.sign — readable sign. Read with the action button from the front only
// (hero below it, facing up; the probe is generous so near-misses still read);
// from the sides or back the action lifts it like a pot. Solid and hookable.
// OWNER: objects agent.
import type { EntityInstance } from '../../../core/types';
import type { CarryInfo } from '../../entity';
import type { GameServices } from '../../api';
import { registerEntity } from '../../registry';
import { ObjectEntity, heroFaces } from './base';

/** Front-reading probe: 10 px deep and 3 px wider than the hero on each side. */
const READ_REACH = 10;
const READ_INSET = -3;

export class Sign extends ObjectEntity {
  constructor(game: GameServices, inst: EntityInstance) {
    super(game, inst);
    this.sprite = 'obj.sign';
    this.anim = 'idle';
    this.solid = true;
    this.hookable = true;
    this.liftWeight = 0;
  }

  /** The dialogue id, or the literal text when no dialogue is set. */
  get message(): string {
    const dialogue = String(this.prop<string>('dialogue', '')).trim();
    return dialogue || String(this.prop<string>('text', ''));
  }

  override onInteract(): boolean {
    const p = this.game.player;
    if (p.y <= this.y || !heroFaces(this.game, this, { dir: 'up', reach: READ_REACH, inset: READ_INSET })) return false;
    const msg = this.message;
    if (msg.trim()) void this.game.dialogue(msg);
    return true;
  }

  override onLift(): CarryInfo {
    return { sprite: 'obj.sign', anim: 'idle', drop: 'none' };
  }
}

registerEntity('obj.sign', (game, inst) => new Sign(game, inst));
