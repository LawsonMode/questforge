// Sound preferences shared by the in-game SOUND panel and the sound toggles of
// the menu hub and the editor's playtest bar: one 'sound' setting, a mute switch
// applied through AudioApi.setMuted, the levels through setVolumes.
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioApi } from '../src/game/api';
import { SOUND_LEVELS, SOUND_SETTING, applySoundPrefs, loadSoundPrefs, saveSoundPrefs } from '../src/game/soundPrefs';
import { getSetting, setSetting } from '../src/core/storage';
import { toggleSoundMuted } from '../src/app/soundToggle';
import { DEFAULT_VOLUMES } from '../src/audio/mixer';

class Recorder implements AudioApi {
  currentMusic = 'none' as const;
  volumes: { music?: number; sfx?: number } = {};
  muted: boolean | null = null;
  sfx(): void {}
  music(): void {}
  duck(): void {}
  unlock(): void {}
  setVolumes(v: { music?: number; sfx?: number }): void { this.volumes = v; }
  setMuted(m: boolean): void { this.muted = m; }
}

afterEach(() => setSetting(SOUND_SETTING, null));

describe('sound preferences', () => {
  it('default to full volume, not muted, and clean anything unreadable', () => {
    expect(loadSoundPrefs()).toEqual({ music: SOUND_LEVELS, sfx: SOUND_LEVELS, muted: false });
    setSetting(SOUND_SETTING, { music: 'loud', sfx: -3, muted: 'yes' });
    expect(loadSoundPrefs()).toEqual({ music: SOUND_LEVELS, sfx: 0, muted: false });
    setSetting(SOUND_SETTING, 42);
    expect(loadSoundPrefs()).toEqual({ music: SOUND_LEVELS, sfx: SOUND_LEVELS, muted: false });
  });

  it('round-trip through the one storage setting', () => {
    saveSoundPrefs({ music: 3, sfx: 1, muted: true });
    expect(getSetting(SOUND_SETTING, null)).toEqual({ music: 3, sfx: 1, muted: true });
    expect(loadSoundPrefs()).toEqual({ music: 3, sfx: 1, muted: true });
  });

  it('apply the levels as volumes and the mute switch as setMuted', () => {
    const a = new Recorder();
    applySoundPrefs(a, { music: 2, sfx: SOUND_LEVELS, muted: true });
    expect(a.volumes).toEqual({ music: DEFAULT_VOLUMES.music / 2, sfx: DEFAULT_VOLUMES.sfx });
    expect(a.muted).toBe(true);
    applySoundPrefs(a, { music: 0, sfx: 0, muted: false });
    expect(a.muted).toBe(false);
  });

  it('the menu / playtest toggle flips only the mute switch, keeping the SOUND panel levels', () => {
    saveSoundPrefs({ music: 1, sfx: 2, muted: false });
    expect(toggleSoundMuted()).toBe(true);
    expect(loadSoundPrefs()).toEqual({ music: 1, sfx: 2, muted: true });
    expect(toggleSoundMuted()).toBe(false);
    expect(loadSoundPrefs()).toEqual({ music: 1, sfx: 2, muted: false });
  });
});
