// Audio engine in node: silent degradation, SFX coverage, envelope and wave-table math.
import { describe, expect, it, vi } from 'vitest';
import { MUSIC_IDS, SFX_IDS, type MusicId, type SfxId } from '../src/core/types';
import { ChipAudio, getAudio, renderOffline } from '../src/audio/audio';
import { ENVELOPES, envelopePoints, resolveEnv } from '../src/audio/envelope';
import { partsLength } from '../src/audio/parts';
import { SFX_BUILDERS, getSfx, type SfxDef } from '../src/audio/sfx';
import { DRUMS } from '../src/audio/drums';
import { lfsrNoise, pulseCoefficients, steppedTriangleCoefficients } from '../src/audio/voices';
import { midiToHz } from '../src/audio/pitch';
import { getSong } from '../src/audio/songs';

describe('ChipAudio without Web Audio', () => {
  it('imports and every method is a silent no-op', () => {
    const a = new ChipAudio();
    expect(a.status).toBe('unavailable');
    expect(() => {
      a.unlock();
      a.unlock();
      for (const id of SFX_IDS) a.sfx(id, { volume: 0.5, pitch: 1.2 });
      a.duck(1);
      a.setVolumes({ master: 0.5, music: 2, sfx: -1 });
      a.setMuted(true);
      a.setMuted(false);
    }).not.toThrow();
  });

  it('still tracks the requested music', () => {
    const a = new ChipAudio();
    expect(a.currentMusic).toBe('none');
    for (const id of MUSIC_IDS) {
      a.music(id);
      expect(a.currentMusic).toBe(id);
    }
    a.music('none');
    expect(a.currentMusic).toBe('none');
  });

  it('ignores unknown music ids instead of adopting them', () => {
    const a = new ChipAudio();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    a.music('dungeon');
    a.music('bogus' as MusicId);
    expect(a.currentMusic).toBe('dungeon');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('getAudio() is a shared singleton', () => {
    expect(getAudio()).toBe(getAudio());
  });

  it('renderOffline rejects outside the browser', async () => {
    await expect(renderOffline('title', 1)).rejects.toThrow(/browser/);
  });
});

/** Every effect's definition (the builders must never throw). */
const SFX = Object.fromEntries(SFX_IDS.map((id) => [id, getSfx(id)])) as Record<SfxId, SfxDef>;

describe('sound effect definitions', () => {
  it('cover every SfxId with short, sane parts', () => {
    expect(Object.keys(SFX_BUILDERS).sort()).toEqual([...SFX_IDS].sort());
    for (const id of SFX_IDS) {
      const def = SFX[id];
      expect(def, id).not.toBeNull();
      expect(def.parts.length, id).toBeGreaterThan(0);
      const len = partsLength(def.parts);
      expect(len, id).toBeGreaterThan(0.01);
      expect(len, id).toBeLessThan(2.6);
      for (const p of def.parts) {
        expect(p.f, id).toBeGreaterThan(0);
        expect(p.vol ?? 0.5, id).toBeLessThanOrEqual(1);
        if (p.wave === 'noise' || p.wave === 'metal') expect(p.f, `${id} rate`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps UI blips tiny and jingles short', () => {
    expect(partsLength(SFX.text.parts)).toBeLessThan(0.06);
    expect(partsLength(SFX.menuMove.parts)).toBeLessThan(0.08);
    expect(partsLength(SFX.fanfare.parts)).toBeLessThan(1.6);
    expect(partsLength(SFX.secret.parts)).toBeLessThan(1.2);
    // Low-health beep must fit comfortably inside its ~0.8 s repeat period.
    expect(partsLength(SFX.lowHealth.parts)).toBeLessThan(0.4);
    expect(SFX.fanfare.duck && SFX.secret.duck).toBe(true);
  });

  it('are built once and cached; unknown ids give null', () => {
    expect(getSfx('sword')).toBe(getSfx('sword'));
    expect(getSfx('bogus' as SfxId)).toBeNull();
  });

  it('pitch the low-health warning above every looping melody, so the music cannot mask it', () => {
    const melodies = MUSIC_IDS.map(getSong).filter((s) => s.loop).flatMap((s) => s.tracks.filter((t) => t.voice === 'pulse1'));
    const top = midiToHz(Math.max(...melodies.flatMap((t) => t.events.map((e) => e.midi))));
    for (const p of SFX.lowHealth.parts) expect(p.f).toBeGreaterThan(top);
  });

  it('secret jingle climbs (every lead note higher than the last)', () => {
    const lead = SFX.secret.parts.filter((p) => p.wave === 'p25').sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    for (let i = 1; i < lead.length; i++) expect(lead[i].f).toBeGreaterThan(lead[i - 1].f);
  });

  it('defines every drum', () => {
    for (const d of Object.values(DRUMS)) expect(partsLength(d)).toBeGreaterThan(0);
  });
});

describe('envelopes', () => {
  it('start and end at zero and never exceed the peak', () => {
    for (const env of [...ENVELOPES, resolveEnv('bell', 0.3), resolveEnv('hold', 0.2), resolveEnv(undefined, 0.1)]) {
      for (const gate of [0.0005, 0.01, 0.1, 0.5, 2]) {
        const pts = envelopePoints(env, 0.8, gate);
        expect(pts[0]).toEqual([0, 0]);
        expect(pts[pts.length - 1][1]).toBe(0);
        for (let i = 1; i < pts.length; i++) {
          expect(pts[i][0]).toBeGreaterThanOrEqual(pts[i - 1][0]);
          expect(pts[i][1]).toBeLessThanOrEqual(0.8 + 1e-9);
          expect(pts[i][1]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('releases right after the gate', () => {
    const env = { a: 0.01, d: 0.1, s: 0.5, r: 0.2 };
    const pts = envelopePoints(env, 1, 0.5);
    expect(pts).toEqual([[0, 0], [0.01, 1], [0.11, 0.5], [0.5, 0.5], [0.7, 0]]);
    const short = envelopePoints(env, 1, 0.06);
    expect(short[2][0]).toBeCloseTo(0.06, 9);
    expect(short[2][1]).toBeCloseTo(0.75, 9);
  });
});

describe('wave tables', () => {
  it('a 50% pulse has only odd harmonics (square wave)', () => {
    const { real } = pulseCoefficients(0.5, 8);
    expect(real[1]).toBeCloseTo(4 / Math.PI, 6);
    expect(real[2]).toBeCloseTo(0, 6);
    expect(real[3]).toBeCloseTo(-4 / (3 * Math.PI), 6);
    expect(real[4]).toBeCloseTo(0, 6);
  });

  it('thinner duties have less fundamental', () => {
    const f = (d: number) => Math.abs(pulseCoefficients(d, 1).real[1]);
    expect(f(0.125)).toBeLessThan(f(0.25));
    expect(f(0.25)).toBeLessThan(f(0.5));
  });

  it('the stepped triangle is dominated by its fundamental', () => {
    const { real, imag } = steppedTriangleCoefficients(9);
    const mag = (n: number) => Math.hypot(real[n], imag[n]);
    expect(mag(1)).toBeCloseTo(8 / Math.PI ** 2, 1);
    expect(mag(3)).toBeCloseTo(mag(1) / 9, 1);
    expect(mag(2)).toBeLessThan(0.02);
  });

  it('LFSR noise is balanced and the short mode repeats every 93 steps', () => {
    const long = lfsrNoise(32767, false);
    const mean = long.reduce((s, v) => s + v, 0) / long.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    const short = lfsrNoise(93 * 3, true);
    for (let i = 0; i < 93 * 2; i++) expect(short[i + 93]).toBe(short[i]);
  });
});
