// Audio + input in a real browser:
//  - renderOffline every music track (~3 s) and every SFX: non-silent, finite, not clipping;
//    key cues (low-health warning, text blip, menu move) loud enough to hear over the music
//  - live ChipAudio: unlock, sfx, music switching / one-shot end, duck, volumes, mute
//  - the real autoplay policy (separate browser without the harness's autoplay override):
//    locked until a trusted gesture, then running; re-armed after a suspension
//  - Input: real KeyboardEvents on window, form-field filtering, blur reset, typed text
// Writes waveform sheets (screenshots) and WAV files to audition in e2e-out/io-audio/.
// Runs on index.html with src/main.ts stubbed, so it does not depend on the app shell.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The Vite client, stubbed so edits elsewhere in the repo can't trigger an HMR reload mid-scenario. */
const VITE_CLIENT_STUB = 'const hot = { accept() {}, dispose() {}, prune() {}, invalidate() {}, on() {}, off() {}, send() {}, data: {} };'
  + ' export const createHotContext = () => hot; export const updateStyle = () => {};'
  + ' export const removeStyle = () => {}; export const injectQuery = (u) => u;';

/**
 * App entry for the autoplay-policy page: installs the engine at load (no page.evaluate, which
 * would count as a user gesture), requests music + an SFX, and logs every status change.
 */
const STRICT_MAIN = `
  import { ChipAudio } from '/src/audio/audio.ts';
  const raw = new AudioContext();
  const a = new ChipAudio();
  a.music('title');
  a.sfx('menuSelect');
  const log = [a.status];
  setInterval(() => { const s = a.status; if (s !== log[log.length - 1]) log.push(s); }, 5);
  window.__strict = { a, log, rawAtLoad: raw.state };
  console.log('[strict] ready');
`;

const js = (body) => (r) => r.fulfill({ contentType: 'application/javascript', body });

/** Mono 16-bit WAV from base64 little-endian PCM. */
function wav(base64, sampleRate) {
  const pcm = Buffer.from(base64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * A second headless browser with Chrome's default autoplay policy (document user activation
 * required), which the harness overrides. Passing '--autoplay-policy=user-gesture-required'
 * would NOT do: that legacy mode lets an AudioContext start without a gesture.
 */
async function launchStrictBrowser(t) {
  const type = t.page.context().browser().browserType();
  const args = ['--mute-audio'];
  const candidates = process.env.QF_BROWSER
    ? [{ executablePath: process.env.QF_BROWSER }]
    : [{ channel: 'chrome' }, { channel: 'msedge' }];
  for (const opts of candidates) {
    try {
      return await type.launch({ ...opts, headless: true, args });
    } catch {
      // Not installed: try the next browser.
    }
  }
  return null;
}

async function offlineRenders(t) {
  const stats = await t.eval(async () => {
    const audio = await import('/src/audio/audio.ts');
    const { MUSIC_IDS, SFX_IDS } = await import('/src/core/types.ts');
    const { getSfx } = await import('/src/audio/sfx.ts');
    const { partsLength } = await import('/src/audio/parts.ts');
    const measure = (data) => {
      let sum = 0; let peak = 0; let bad = 0;
      for (const v of data) {
        if (!Number.isFinite(v)) { bad++; continue; }
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      return { rms: Math.sqrt(sum / data.length), peak, bad };
    };
    const music = {};
    const waves = {};
    for (const id of MUSIC_IDS) {
      const data = await audio.renderOffline(id, 3);
      music[id] = measure(data);
      waves[id] = data;
    }
    const sfx = {};
    for (const id of SFX_IDS) {
      const data = await audio.renderOffline(id, partsLength(getSfx(id).parts) + 0.1);
      sfx[id] = measure(data);
      waves[id] = data;
    }
    window.__waves = waves;
    return { music, sfx };
  });

  for (const [id, s] of Object.entries(stats.music)) {
    t.assert(s.bad === 0, `music ${id}: ${s.bad} non-finite samples`);
    t.assert(s.rms > 0.02, `music ${id}: too quiet (rms ${s.rms.toFixed(4)})`);
    t.assert(s.peak < 1, `music ${id}: clipping (peak ${s.peak.toFixed(3)})`);
  }
  for (const [id, s] of Object.entries(stats.sfx)) {
    t.assert(s.bad === 0, `sfx ${id}: ${s.bad} non-finite samples`);
    t.assert(s.peak > 0.05, `sfx ${id}: too quiet (peak ${s.peak.toFixed(4)})`);
    t.assert(s.peak < 1, `sfx ${id}: clipping (peak ${s.peak.toFixed(3)})`);
  }
  // Gameplay-critical cues must stand out against music peaking around 0.35-0.5.
  t.assert(stats.sfx.lowHealth.peak >= 0.14, `lowHealth peak ${stats.sfx.lowHealth.peak.toFixed(3)} (want >= 0.14)`);
  for (const id of ['text', 'menuMove']) {
    t.assert(stats.sfx[id].peak >= 0.06, `${id} peak ${stats.sfx[id].peak.toFixed(3)} (want >= 0.06)`);
  }
  const fmt = (o) => Object.entries(o).map(([k, s]) => `${k} rms=${s.rms.toFixed(3)} peak=${s.peak.toFixed(2)}`).join(' | ');
  t.log(`music: ${fmt(stats.music)}`);
  t.log(`sfx: ${fmt(stats.sfx)}`);
  return stats;
}

async function loopSeams(t) {
  // Seamless loops: no dropout in the second around the wrap point (renders past one full loop).
  const loops = await t.eval(async () => {
    const audio = await import('/src/audio/audio.ts');
    const { getSong } = await import('/src/audio/songs/index.ts');
    const { ticksToSeconds } = await import('/src/audio/mml.ts');
    const out = {};
    for (const id of ['boss', 'overworld']) {
      const song = getSong(id);
      const wrap = ticksToSeconds(song.length, song.bpm);
      const rate = 22050;
      const data = await audio.renderOffline(id, wrap + 1, rate);
      let minRms = Infinity;
      for (let t0 = wrap - 0.5; t0 < wrap + 0.5; t0 += 0.1) {
        let sum = 0;
        const a = Math.floor(t0 * rate);
        const n = Math.floor(0.1 * rate);
        for (let k = a; k < a + n; k++) sum += data[k] * data[k];
        minRms = Math.min(minRms, Math.sqrt(sum / n));
      }
      out[id] = { wrap, minRms };
    }
    return out;
  });
  for (const [id, l] of Object.entries(loops)) {
    t.assert(l.minRms > 0.01, `${id}: dropout around the loop point at ${l.wrap.toFixed(2)} s (min rms ${l.minRms.toFixed(4)})`);
  }
  t.log('loop wrap', loops);
}

async function waveformSheets(t, stats) {
  // Min/max envelope per render, to eyeball dynamics and silence.
  const drawSheet = (ids, cols, secs) => t.eval(({ ids, cols, secs }) => {
    document.body.textContent = '';
    const cw = Math.floor(1000 / cols);
    const ch = 70;
    const c = document.createElement('canvas');
    c.width = cw * cols;
    c.height = ch * Math.ceil(ids.length / cols);
    document.body.appendChild(c);
    const g = c.getContext('2d');
    g.fillStyle = '#101018';
    g.fillRect(0, 0, c.width, c.height);
    ids.forEach((id, i) => {
      const x0 = (i % cols) * cw;
      const y0 = Math.floor(i / cols) * ch;
      const data = window.__waves[id];
      const n = secs ? Math.min(data.length, secs * 44100) : data.length;
      const mid = y0 + ch / 2 + 6;
      g.strokeStyle = '#2a2a3a';
      g.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
      g.fillStyle = '#6fd3ff';
      for (let px = 0; px < cw - 4; px++) {
        let lo = 0; let hi = 0;
        const a = Math.floor((px / (cw - 4)) * n);
        const b = Math.floor(((px + 1) / (cw - 4)) * n);
        for (let k = a; k < b; k++) { lo = Math.min(lo, data[k]); hi = Math.max(hi, data[k]); }
        g.fillRect(x0 + 2 + px, mid - hi * 26, 1, Math.max(1, (hi - lo) * 26));
      }
      g.fillStyle = '#f0c040';
      g.font = '11px monospace';
      g.fillText(id, x0 + 4, y0 + 12);
    });
  }, { ids, cols, secs });
  await drawSheet(Object.keys(stats.music), 2, 3);
  await t.shot('music-waveforms');
  await drawSheet(Object.keys(stats.sfx), 5, 0);
  await t.shot('sfx-waveforms');
}

async function auditionFiles(t) {
  // 16 s of each track, a reel of every SFX, and the low-health warning over the overworld theme.
  const clips = await t.eval(async () => {
    const audio = await import('/src/audio/audio.ts');
    const { MUSIC_IDS, SFX_IDS } = await import('/src/core/types.ts');
    const { getSfx } = await import('/src/audio/sfx.ts');
    const { partsLength } = await import('/src/audio/parts.ts');
    const RATE = 22050;
    const toBase64 = (data) => {
      const pcm = new Int16Array(data.length);
      for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-1, Math.min(1, data[i])) * 32767;
      const bytes = new Uint8Array(pcm.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const out = {};
    const music = {};
    for (const id of MUSIC_IDS) {
      music[id] = await audio.renderOffline(id, 16, RATE);
      out[id] = toBase64(music[id]);
    }
    const reel = [];
    for (const id of SFX_IDS) {
      reel.push(...(await audio.renderOffline(id, partsLength(getSfx(id).parts) + 0.1, RATE)));
      reel.push(...new Float32Array(Math.floor(RATE * 0.35)));
    }
    out['sfx-reel'] = toBase64(Float32Array.from(reel));
    const beep = await audio.renderOffline('lowHealth', 0.5, RATE);
    const mix = Float32Array.from(music.overworld.subarray(0, RATE * 8));
    for (let at = RATE; at + beep.length < mix.length; at += Math.round(RATE * 0.8)) {
      for (let k = 0; k < beep.length; k++) mix[at + k] += beep[k];
    }
    out['lowhealth-over-overworld'] = toBase64(mix);
    return { rate: RATE, out };
  });
  for (const [name, b64] of Object.entries(clips.out)) writeFileSync(join(t.outDir, `${name}.wav`), wav(b64, clips.rate));
  t.log(`wrote ${Object.keys(clips.out).length} WAV files to ${t.outDir}`);
}

async function liveEngine(t) {
  const live = await t.eval(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__audioWarnings = [];
    const warn = console.warn;
    console.warn = (...args) => { window.__audioWarnings.push(args.map(String).join(' ')); warn(...args); };
    let sources = 0;
    const proto = BaseAudioContext.prototype;
    const osc = proto.createOscillator;
    const buf = proto.createBufferSource;
    proto.createOscillator = function (...a) { sources++; return osc.apply(this, a); };
    proto.createBufferSource = function (...a) { sources++; return buf.apply(this, a); };
    const { ChipAudio } = await import('/src/audio/audio.ts');
    const a = new ChipAudio();
    const r = { before: a.status };
    a.unlock();
    a.unlock();
    for (let i = 0; i < 100 && a.status !== 'running'; i++) await sleep(20);
    r.status = a.status;
    const s0 = sources;
    for (const id of ['sword', 'rupee', 'enemyHit', 'secret', 'explode', 'text', 'menuMove', 'lowHealth']) {
      a.sfx(id, { pitch: 1.1 });
      await sleep(50);
    }
    a.sfx('hurt', { volume: Number.NaN, pitch: Number.NaN });
    r.sfxSources = sources - s0;
    const s1 = sources;
    a.music('overworld');
    await sleep(1500);
    r.overworldSources = sources - s1;
    r.m1 = a.currentMusic;
    a.music('overworld');
    a.music('dungeon');
    r.m2 = a.currentMusic;
    await sleep(500);
    a.duck(0.4);
    a.setVolumes({ music: 0.5, sfx: 0.8 });
    a.setMuted(true);
    a.sfx('sword');
    a.setMuted(false);
    a.music('victory');
    await sleep(9000);
    r.afterVictory = a.currentMusic;
    a.music('boss');
    await sleep(300);
    a.music('none');
    r.m3 = a.currentMusic;
    await sleep(500);
    r.warnings = window.__audioWarnings;
    return r;
  });
  t.log('live audio', live);
  t.assert(live.status === 'running', `AudioContext should run after unlock (got ${live.status})`);
  t.assert(live.before === 'locked', `context is created lazily (status before unlock: ${live.before})`);
  t.assert(live.sfxSources >= 9, `sfx scheduled voices (${live.sfxSources})`);
  t.assert(live.overworldSources > 15, `overworld scheduled notes (${live.overworldSources})`);
  t.assert(live.m1 === 'overworld' && live.m2 === 'dungeon' && live.m3 === 'none', 'currentMusic follows music()');
  t.assert(live.afterVictory === 'none', `one-shot victory ends as 'none' (got ${live.afterVictory})`);
  t.assert(live.warnings.length === 0, `audio engine warnings: ${live.warnings.join(' / ')}`);
}

async function autoplayPolicy(t) {
  const strict = await launchStrictBrowser(t);
  t.assert(strict !== null, 'could not launch a second browser for the autoplay-policy check');
  if (!strict) return;
  try {
    const page = await strict.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/src/main.ts', js(STRICT_MAIN));
    await page.route('**/@vite/client', js(VITE_CLIENT_STUB));
    const ready = page.waitForEvent('console', { predicate: (m) => m.text() === '[strict] ready', timeout: 20000 });
    await page.goto(`${t.base}/`);
    await ready;
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(400);
    const afterKey = await page.evaluate(() => ({
      log: [...window.__strict.log],
      rawAtLoad: window.__strict.rawAtLoad,
      music: window.__strict.a.currentMusic,
      playing: window.__strict.a.player?.id ?? null,
    }));
    await page.evaluate(() => window.__strict.a.ctx.suspend());
    await page.waitForTimeout(150);
    const suspended = await page.evaluate(() => window.__strict.a.status);
    await page.mouse.click(8, 8);
    await page.waitForTimeout(400);
    const afterClick = await page.evaluate(() => window.__strict.a.status);
    const result = { ...afterKey, suspended, afterClick, errors };
    t.log('autoplay policy', result);
    t.assert(result.rawAtLoad === 'suspended', `policy enforced: a context made without a gesture stays suspended (${result.rawAtLoad})`);
    t.assert(result.log[0] === 'locked', `engine waits for a gesture (first status ${result.log[0]})`);
    t.assert(result.log[result.log.length - 1] === 'running', `a trusted keypress unlocks audio (${result.log.join(' -> ')})`);
    t.assert(result.music === 'title' && result.playing === 'title', `music requested before the gesture starts after it (${result.playing})`);
    t.assert(result.suspended === 'suspended' && result.afterClick === 'running', `gesture hooks re-arm after a suspension (${suspended} -> ${afterClick})`);
    t.assert(errors.length === 0, `page errors: ${errors.join(' / ')}`);
  } finally {
    await strict.close();
  }
}

async function input(t) {
  const inp = await t.eval(async () => {
    const { Input } = await import('/src/input/input.ts');
    const input = new Input();
    input.attach(window);
    window.__inp = input;
    const key = (type, code, key, target = window) => {
      const e = new KeyboardEvent(type, { code, key, cancelable: true, bubbles: true });
      target.dispatchEvent(e);
      return e;
    };
    const r = {};
    const down = key('keydown', 'KeyZ', 'z');
    input.update();
    r.pressed = input.pressed('b');
    r.prevented = down.defaultPrevented;
    key('keydown', 'KeyZ', 'z');
    input.update();
    r.heldNoRepress = input.held('b') && !input.pressed('b');
    key('keyup', 'KeyZ', 'z');
    input.update();
    r.released = input.released('b');
    key('keydown', 'KeyX', 'x');
    key('keyup', 'KeyX', 'x');
    input.update();
    r.latched = input.pressed('a');
    input.update();
    r.latchReleased = input.released('a');
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    const typed = key('keydown', 'KeyC', 'c', field);
    input.update();
    r.fieldIgnored = !input.held('y') && !typed.defaultPrevented;
    key('keyup', 'KeyC', 'c', field);
    field.blur();
    field.remove();
    key('keydown', 'ArrowLeft', 'ArrowLeft');
    input.update();
    r.leftHeld = input.held('left');
    window.dispatchEvent(new Event('blur'));
    input.update();
    r.blurReset = !input.held('left');
    // Element target: a key released after focus moved away must not stick.
    const host = document.createElement('div');
    host.tabIndex = 0;
    document.body.appendChild(host);
    const onHost = new Input();
    onHost.attach(host);
    host.focus();
    key('keydown', 'ArrowRight', 'ArrowRight', host);
    onHost.update();
    const heldOnHost = onHost.held('right');
    host.blur();
    key('keyup', 'ArrowRight', 'ArrowRight', document.body);
    onHost.update();
    r.elementNoStuckKey = heldOnHost && onHost.released('right');
    key('keydown', 'KeyZ', 'z', document.body);
    onHost.update();
    r.elementIgnoresOutside = !onHost.held('b');
    key('keyup', 'KeyZ', 'z', document.body);
    onHost.detach();
    host.remove();
    // Canvas host inside an iframe: that frame's blur must reset keys.
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const inner = frame.contentDocument.createElement('div');
    frame.contentDocument.body.appendChild(inner);
    const inFrame = new Input();
    inFrame.attach(inner);
    inner.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
    inFrame.update();
    const heldInFrame = inFrame.held('b');
    frame.contentWindow.dispatchEvent(new Event('blur'));
    inFrame.update();
    r.iframeBlurReset = heldInFrame && !inFrame.held('b');
    inFrame.detach();
    frame.remove();
    return r;
  });
  t.log('input (dispatched events)', inp);
  for (const [k, v] of Object.entries(inp)) t.assert(v === true, `input check ${k}`);

  // Real keyboard through Playwright (focused body -> window listener).
  await t.page.keyboard.down('ArrowUp');
  await t.page.keyboard.down('ArrowRight');
  const dir = await t.eval(() => { window.__inp.update(); return window.__inp.dir(); });
  await t.page.keyboard.up('ArrowUp');
  await t.page.keyboard.up('ArrowRight');
  t.assert(dir.x === 1 && dir.y === -1, `diagonal from real keys (${JSON.stringify(dir)})`);
  await t.eval(() => window.__inp.update());
  await t.page.keyboard.type('Hero');
  await t.page.keyboard.press('Backspace');
  const text = await t.eval(() => { window.__inp.update(); const s = window.__inp.typed(); window.__inp.detach(); return s; });
  t.assert(text === 'Hero\b', `typed text (${JSON.stringify(text)})`);
}

export default async function (t) {
  // index.html (inline icon, no favicon request) with the app entry and Vite client stubbed out.
  await t.page.route('**/src/main.ts', js(''));
  await t.page.route('**/@vite/client', js(VITE_CLIENT_STUB));
  await t.page.goto(`${t.base}/`);
  await t.eval(() => { document.body.style.cssText = 'margin:0;background:#101018'; });

  const stats = await offlineRenders(t);
  await loopSeams(t);
  await waveformSheets(t, stats);
  await auditionFiles(t);
  await liveEngine(t);
  await autoplayPolicy(t);
  await input(t);
}
