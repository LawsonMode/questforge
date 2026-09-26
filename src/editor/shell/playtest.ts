// Playtest overlay: a full-window layer above the editor running a Game in
// 'playtest' mode on a private copy of the project; its bar names the room the
// hero is in and has a sound on/off toggle (shared with the menu hub and the
// in-game SOUND panel).
import '../../game/entities/index';
import type { Project, WarpTarget } from '../../core/types';
import { Game } from '../../game/game';
import { findRoom, findWorld } from '../../core/project';
import { el } from '../ui/dom';
import { icon } from './icons';
import { createSoundToggle } from '../../app/soundToggle';

/** Callbacks of the playtest overlay. */
export interface PlaytestOptions {
  /** Called when the player leaves (Escape, the bar's button, or the game's own exit). */
  onClose: () => void;
  onError: (message: string) => void;
}

/** A running playtest overlay. */
export interface PlaytestHandle {
  readonly game: Game;
  /** Stop the game and remove the overlay (idempotent). */
  destroy(): void;
}

/** How often (ms) the bar re-reads the room the hero is in. */
const PLACE_POLL_MS = 250;

/** Human label of a spawn point, e.g. "Overworld › Start". */
function placeLabel(project: Project, at: WarpTarget): string {
  const world = findWorld(project, at.world);
  const room = findRoom(project, at.world, at.room);
  return `${world?.name ?? '?'} › ${room?.name ?? '?'}`;
}

/** Keep `label` naming the room the hero is in (warps and edge scrolls change it); returns the stopper. */
function followRoom(game: Game, label: HTMLElement): () => void {
  let shown = '';
  const timer = setInterval(() => {
    const room = game.services?.room;
    if (!room) return;
    const key = `${room.world.id}/${room.def.id}`;
    if (key === shown) return;
    shown = key;
    label.textContent = `${room.world.name} › ${room.def.name}`;
  }, PLACE_POLL_MS);
  return () => clearInterval(timer);
}

/** Open the overlay; `project` is cloned so the game never touches editor data. */
export function openPlaytest(project: Project, start: WarpTarget, opts: PlaytestOptions): PlaytestHandle {
  const copy = structuredClone(project);
  const canvas = el('canvas', { class: 'qf-game-canvas', tabIndex: 0, 'aria-label': 'Playtest game screen' });
  const place = el('span', { class: 'qf-playtest__place', title: 'The room the hero is in' }, placeLabel(copy, start));
  const sound = createSoundToggle('qf-btn--ghost qf-playtest__sound');
  // Back to the game: keys must keep reaching it, not the button.
  sound.element.addEventListener('click', () => canvas.focus());
  const bar = el('div', { class: 'qf-playtest__bar' },
    el('span', { class: 'qf-playtest__badge' }, icon('play', 12), 'Playtest'),
    place,
    el('span', { class: 'qf-playtest__hints' },
      el('span', null, el('kbd', { class: 'qf-kbd' }, 'Esc'), ' to return'),
      el('span', null, el('kbd', { class: 'qf-kbd' }, 'F1'), ' hitboxes'),
      el('span', null, el('kbd', { class: 'qf-kbd' }, 'F2'), ' invincible'),
      el('span', null, el('kbd', { class: 'qf-kbd' }, 'F3'), ' noclip')),
    sound.element,
    el('button', { class: 'qf-btn qf-btn--small qf-playtest__close', type: 'button', title: 'Return to the editor (Esc)', on: { click: () => opts.onClose() } },
      icon('close', 12), 'Return to editor'));
  const layer = el('div', { class: 'qf-playtest', role: 'dialog', 'aria-label': 'Playtest' },
    bar, el('div', { class: 'qf-playtest__stage' }, canvas));
  document.body.appendChild(layer);

  // Fallback Escape: the running game swallows Escape itself (and exits), so
  // this only fires after the game stopped on an error.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    opts.onClose();
  };
  document.addEventListener('keydown', onKey);

  let game: Game | null = null;
  try {
    game = new Game(canvas, copy, { mode: 'playtest', start, onExit: () => opts.onClose(), onError: opts.onError });
    game.start();
  } catch (err) {
    // Nothing may stay behind to cover the editor: the half-started game, the key listener, the layer.
    try {
      game?.destroy();
    } catch {
      // Already failing: the original error is the one to report.
    }
    document.removeEventListener('keydown', onKey);
    layer.remove();
    throw err;
  }
  canvas.focus();
  const stopFollowing = followRoom(game, place);

  let destroyed = false;
  return {
    game,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFollowing();
      document.removeEventListener('keydown', onKey);
      game.destroy();
      layer.remove();
    },
  };
}
