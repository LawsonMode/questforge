// Menu input shared by the in-game screens: auto-repeat for a held direction
// (the d-pad, the stick and the arrow keys all repeat like a keyboard's key
// repeat, which Input itself ignores) and telling a gamepad's Start apart from
// the Enter and Escape keys that press Start too. OWNER: triggers+UI agent.
import type { Button, InputState } from '../api';
import { FPS } from '../../core/constants';
import { currentControls } from '../../input/devices';

/** A held direction first repeats after this long (s), then every REPEAT_EVERY seconds. */
export const REPEAT_DELAY = 0.3;
export const REPEAT_EVERY = 0.1;
const DELAY_TICKS = Math.round(REPEAT_DELAY * FPS);
const EVERY_TICKS = Math.round(REPEAT_EVERY * FPS);

/** Pressed this tick, or held long enough that it repeats on this tick. */
export function repeated(input: InputState, b: Button): boolean {
  if (input.pressed(b)) return true;
  if (!input.held(b)) return false;
  const ticks = Math.round(input.heldTime(b) * FPS) - DELAY_TICKS;
  return ticks >= 0 && ticks % EVERY_TICKS === 0;
}

/**
 * Start pressed on a gamepad: the Enter and Escape keys press Start too, and
 * report themselves through typed() ('\n' / '\u001b'); a pad's Start types nothing.
 */
export function padStart(input: InputState): boolean {
  if (!input.pressed('start') || currentControls().device !== 'gamepad') return false;
  const typed = input.typed();
  return !typed.includes('\n') && !typed.includes('\u001b');
}
