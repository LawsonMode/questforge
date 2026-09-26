// Sound on / off toggle for the menu hub and the editor's playtest bar. It
// flips the mute switch of the shared 'sound' setting (game/soundPrefs: the
// same record the in-game SOUND panel keeps its levels in, so all three agree)
// and applies it to the shared audio (getAudio().setMuted / setVolumes). The
// audio module loads on the first click only: the menu never needs it otherwise.
import { applySoundPrefs, loadSoundPrefs, saveSoundPrefs } from '../game/soundPrefs';
import { el } from '../editor/ui/dom';
import { icon } from '../editor/shell/icons';

export interface SoundToggle {
  readonly element: HTMLButtonElement;
  /** Re-read the setting (another view or the pause menu may have changed it). */
  refresh(): void;
}

/** Flip the stored mute switch and apply the result to the shared audio; returns the new state. */
export function toggleSoundMuted(): boolean {
  const prefs = loadSoundPrefs();
  prefs.muted = !prefs.muted;
  saveSoundPrefs(prefs);
  void import('../audio/audio')
    .then(({ getAudio }) => applySoundPrefs(getAudio(), prefs))
    .catch(() => undefined); // no audio module / Web Audio: the stored choice applies when a game starts
  return prefs.muted;
}

/** A small button showing a speaker (sound on) or a crossed speaker (muted). */
export function createSoundToggle(className = ''): SoundToggle {
  const button = el('button', { class: `qf-btn qf-btn--small qf-sound-toggle ${className}`.trim(), type: 'button' });
  const refresh = (): void => {
    const muted = loadSoundPrefs().muted;
    button.replaceChildren(icon(muted ? 'mute' : 'sound', 14), el('span', { class: 'qf-sound-toggle__label' }, muted ? 'Sound off' : 'Sound on'));
    button.title = muted ? 'Sound is off — click to turn it on' : 'Sound is on — click to mute';
    button.classList.toggle('is-muted', muted);
  };
  button.addEventListener('click', () => {
    toggleSoundMuted();
    refresh();
  });
  refresh();
  return { element: button, refresh };
}
