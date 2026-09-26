// The player's sound preferences: music and sound-effect volume levels (0 = off
// .. SOUND_LEVELS = full) and a mute switch, kept per browser as the 'sound'
// setting (core/storage: localStorage 'questforge:sound') and applied to the
// shared audio whenever a Game starts. The pause menu's SOUND panel sets the
// levels; the sound toggles of the menu hub and the editor's playtest bar set
// the mute switch. All of them read and write this one setting, so they agree.
// Builds before 1.0 kept the levels in localStorage 'qf.sound': read as a
// fallback until the first save. Storage can be missing or throw (private
// windows, blocked site data): the defaults (full volume, not muted) apply then.
import type { AudioApi } from './api';
import { DEFAULT_VOLUMES } from '../audio/mixer';
import { getSetting, setSetting } from '../core/storage';

/** Highest level; levels run 0..SOUND_LEVELS. */
export const SOUND_LEVELS = 4;

export interface SoundPrefs {
  music: number;
  sfx: number;
  /** Everything silenced (the levels are kept for when it is switched back on). */
  muted: boolean;
}

/** The storage setting holding the preferences. */
export const SOUND_SETTING = 'sound';
const LEGACY_KEY = 'qf.sound';

/** A whole level in 0..SOUND_LEVELS (full volume for anything unreadable). */
function level(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(SOUND_LEVELS, Math.max(0, n)) : SOUND_LEVELS;
}

/** Well-formed preferences from anything read back from storage. */
function clean(raw: unknown): SoundPrefs {
  const o = raw !== null && typeof raw === 'object' ? (raw as Partial<Record<keyof SoundPrefs, unknown>>) : {};
  return { music: level(o.music), sfx: level(o.sfx), muted: o.muted === true };
}

function legacy(): unknown {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadSoundPrefs(): SoundPrefs {
  return clean(getSetting<unknown>(SOUND_SETTING, null) ?? legacy());
}

export function saveSoundPrefs(prefs: SoundPrefs): void {
  // setSetting never throws: without storage the choice still holds for this session.
  setSetting(SOUND_SETTING, clean(prefs));
}

/** Set the audio's music and effect volumes for `prefs` (full level = the mixer's default volume) and its mute switch. */
export function applySoundPrefs(audio: AudioApi, prefs: SoundPrefs): void {
  audio.setVolumes({
    music: (DEFAULT_VOLUMES.music * level(prefs.music)) / SOUND_LEVELS,
    sfx: (DEFAULT_VOLUMES.sfx * level(prefs.sfx)) / SOUND_LEVELS,
  });
  audio.setMuted(prefs.muted === true);
}
