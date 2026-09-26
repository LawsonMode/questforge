// Controller support in the game: the bitmap font's PlayStation shapes, menu
// auto-repeat and telling a pad's Start from Enter, hints that follow the device
// in use, {btn:x} dialogue tokens (laid out again when the player switches
// device), the name-entry grid on a pad, the pause menu's CONTROLS page
// (vibration, swapped face buttons), the pause when the pad in use is unplugged
// and rumble on hurt / pit falls / bombs / item fanfares.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioApi, Button, DebugFlags, InputState, Renderer } from '../src/game/api';
import type { MusicId, Project, SfxId } from '../src/core/types';
import type { Vec } from '../src/core/math';
import { STEP } from '../src/core/constants';
import { measureText, wrapText } from '../src/gfx/font';
import {
  PS_GLYPHS, controllerPrefs, currentControls, noteKeyboard, notePad, setControllerPrefs,
} from '../src/input/devices';
import { type ArenaOptions, buildArenaProject } from '../src/dev/arena';
import { DEFAULT_HERO_NAME, newSave } from '../src/game/state';
import { Session, type SessionHost } from '../src/game/session';
import { labelsVersion, liveText } from '../src/game/keys';
import { REPEAT_DELAY, REPEAT_EVERY, padStart, repeated } from '../src/game/ui/menuInput';
import { hasButtonTokens, layoutDialogue } from '../src/game/ui/dialogueLayout';
import { DialogueBox } from '../src/game/ui/dialogueBox';
import { FileSelect } from '../src/game/ui/fileSelect';
import { TitleScreen } from '../src/game/ui/titleScreen';
import { Bomb } from '../src/game/projectiles/bomb';
import '../src/game/entities/index';

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const PLAYSTATION = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

/** Buttons held between ticks; heldTime counts whole ticks like Input does. */
class Pad implements InputState {
  private readonly down = new Set<Button>();
  private prev = new Set<Button>();
  private now = new Set<Button>();
  private readonly ticks = new Map<Button, number>();
  typedNext = '';
  private typedNow = '';
  hold(...bs: Button[]): void { for (const b of bs) this.down.add(b); }
  release(...bs: Button[]): void { for (const b of bs) this.down.delete(b); }
  step(): void {
    this.prev = this.now;
    this.now = new Set(this.down);
    for (const b of this.now) this.ticks.set(b, (this.ticks.get(b) ?? 0) + 1);
    for (const b of [...this.ticks.keys()]) if (!this.now.has(b)) this.ticks.delete(b);
    this.typedNow = this.typedNext;
    this.typedNext = '';
  }
  held(b: Button): boolean { return this.now.has(b); }
  pressed(b: Button): boolean { return this.now.has(b) && !this.prev.has(b); }
  released(b: Button): boolean { return !this.now.has(b) && this.prev.has(b); }
  heldTime(b: Button): number { return (this.ticks.get(b) ?? 0) / 60; }
  dir(): Vec {
    return {
      x: (this.now.has('right') ? 1 : 0) - (this.now.has('left') ? 1 : 0),
      y: (this.now.has('down') ? 1 : 0) - (this.now.has('up') ? 1 : 0),
    };
  }
  anyPressed(): boolean { return [...this.now].some((b) => !this.prev.has(b)); }
  typed(): string { return this.typedNow; }
}

class FakeAudio implements AudioApi {
  readonly log: SfxId[] = [];
  currentMusic: MusicId | 'none' = 'none';
  status: 'unavailable' | 'locked' | 'suspended' | 'running' = 'running';
  sfx(id: SfxId): void { this.log.push(id); }
  music(id: MusicId | 'none'): void { this.currentMusic = id; }
  duck(): void {}
  setVolumes(): void {}
  unlock(): void {}
  setMuted(): void {}
}

/** Rumble effects played on a stubbed pad 0 (navigator.getGamepads). */
let effects: { strongMagnitude: number; weakMagnitude: number; duration: number }[] = [];

function plugPad(id: string): void {
  const pad = {
    id, index: 0, connected: true, buttons: [], axes: [],
    vibrationActuator: {
      playEffect: (_type: string, params: { strongMagnitude: number; weakMagnitude: number; duration: number }) => {
        effects.push(params);
        return Promise.resolve('complete');
      },
    },
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad, null, null, null] });
  notePad(0, id);
}

beforeEach(() => {
  effects = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  noteKeyboard();
  setControllerPrefs({ vibration: true, swapFaceButtons: false });
});

interface Rig {
  s: Session;
  pad: Pad;
  audio: FakeAudio;
}

function rig(opts: ArenaOptions = { theme: 'grass' }, mode: 'play' | 'playtest' = 'playtest'): Rig {
  const project: Project = buildArenaProject(opts);
  const pad = new Pad();
  const audio = new FakeAudio();
  const debug: DebugFlags = { hitboxes: false, invincible: false, noclip: false, fps: false };
  const save = newSave(project, 0, DEFAULT_HERO_NAME);
  save.respawn = { ...project.start };
  const host: SessionHost = { mode, persist: async () => {}, exit: () => {} };
  return { s: new Session(host, project, pad, audio, save, debug, project.start), pad, audio };
}

function run(r: Rig, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.pad.step();
    r.s.tick(STEP);
  }
}

function tap(r: Rig, b: Button): void {
  r.pad.hold(b);
  run(r, STEP);
  r.pad.release(b);
  run(r, STEP);
}

type Menu = { page: string; disconnected: boolean; isOpen: boolean; controls: { row: number } };
const menuOf = (s: Session): Menu => (s as unknown as { pauseMenu: Menu }).pauseMenu;

/** A renderer recording every string drawn (outlined text falls back to drawText without a DOM). */
function textRenderer(): { r: Renderer; texts: string[] } {
  const texts: string[] = [];
  const noop = (): void => {};
  const ctx = new Proxy({}, { get: () => noop }) as unknown as CanvasRenderingContext2D;
  const target: Record<string | symbol, unknown> = {
    width: 256, height: 224, ctx, camX: 0, camY: 0, time: 0,
    drawText: (text: string) => { texts.push(text); },
    measureText: (text: string) => measureText(text),
  };
  const r = new Proxy(target, { get: (t, k) => (k in t ? t[k] : noop) }) as unknown as Renderer;
  return { r, texts };
}

describe('font: PlayStation button shapes', () => {
  it('draws the four PS_GLYPHS as 7px-wide glyphs, not as "?"', () => {
    for (const g of Object.values(PS_GLYPHS)) {
      expect(measureText(g)).toBe(7);
      expect(measureText(`${g}${g}`)).toBe(15);
    }
    expect(measureText('?')).not.toBe(7);
  });

  it('measures and wraps them like any other character', () => {
    const hint = `${PS_GLYPHS.circle}: PICK   ${PS_GLYPHS.cross}: DELETE`;
    expect(measureText(hint)).toBe(measureText('O: PICK   X: DELETE') + 2 * (7 - 5));
    const lines = wrapText(`Press ${PS_GLYPHS.circle} to talk and ${PS_GLYPHS.square} to use items.`, 60);
    expect(lines.join(' ')).toContain(PS_GLYPHS.square);
    for (const l of lines) expect(measureText(l)).toBeLessThanOrEqual(60);
  });
});

describe('menu input', () => {
  it('repeats a held direction after REPEAT_DELAY, then every REPEAT_EVERY', () => {
    const pad = new Pad();
    pad.hold('right');
    const hits: number[] = [];
    for (let tick = 1; tick <= 40; tick++) {
      pad.step();
      if (repeated(pad, 'right')) hits.push(tick);
    }
    const delay = Math.round(REPEAT_DELAY * 60);
    const every = Math.round(REPEAT_EVERY * 60);
    expect(hits).toEqual([1, delay, delay + every, delay + 2 * every, delay + 3 * every].filter((t) => t <= 40));
  });

  it("tells a gamepad's Start from the Enter and Escape keys", () => {
    const pad = new Pad();
    pad.hold('start');
    pad.step();
    expect(padStart(pad)).toBe(false); // keyboard in use
    plugPad(XBOX);
    expect(padStart(pad)).toBe(true);
    pad.release('start');
    pad.step();
    pad.hold('start');
    pad.typedNext = '\n';
    pad.step();
    expect(padStart(pad)).toBe(false); // the Enter key
  });
});

describe('hints follow the device in use', () => {
  it('liveText rebuilds only after the labels change', () => {
    let builds = 0;
    const hint = liveText(() => `${++builds}`);
    expect(hint()).toBe('1');
    expect(hint()).toBe('1');
    const v = labelsVersion();
    plugPad(XBOX);
    expect(labelsVersion()).toBeGreaterThan(v);
    expect(hint()).toBe('2');
  });

  it('the title names Enter on the keyboard and the pad buttons on a gamepad, with the sound hint while audio is locked', () => {
    const audio = new FakeAudio();
    audio.status = 'locked';
    const project = buildArenaProject({ theme: 'grass' });
    const title = new TitleScreen(project, audio);
    title.update(2.3, new Pad()); // faded in, with the prompt in its visible blink phase
    const draw = (): string[] => {
      const { r, texts } = textRenderer();
      title.draw(r);
      return texts;
    };
    let texts = draw();
    expect(texts).toContain('PRESS ENTER');
    expect(texts).toContain('Z SWORD   X ACTION   C ITEM   ENTER MENU');
    expect(texts).not.toContain('CLICK OR PRESS A KEY FOR SOUND');
    plugPad(PLAYSTATION);
    texts = draw();
    expect(texts).toContain('PRESS OPTIONS');
    expect(texts).toContain(`${PS_GLYPHS.cross} SWORD   ${PS_GLYPHS.circle} ACTION   ${PS_GLYPHS.square} ITEM   OPTIONS MENU`);
    expect(texts).toContain('CLICK OR PRESS A KEY FOR SOUND');
    plugPad(XBOX);
    // The Xbox Start button is called MENU: it is not named twice.
    expect(draw()).toContain('A SWORD   B ACTION   X ITEM   MENU');
    audio.status = 'running';
    expect(draw()).not.toContain('CLICK OR PRESS A KEY FOR SOUND');
  });
});

describe('dialogue button tokens', () => {
  it('lays out {btn:x} with the labels of the device in use', () => {
    const pages = [{ text: 'Press {btn:a} to talk, {btn:start} for the menu. Walk with the {btn:move}.' }];
    expect(hasButtonTokens(pages)).toBe(true);
    expect(hasButtonTokens([{ text: 'Hello {name}.' }])).toBe(false);
    expect(layoutDialogue(pages, 'Ann')[0]!.lines.join(' ')).toBe('Press X to talk, Enter for the menu. Walk with the arrow keys.');
    plugPad(XBOX);
    expect(layoutDialogue(pages, 'Ann')[0]!.lines.join(' ')).toBe('Press B to talk, Menu for the menu. Walk with the D-pad.');
  });

  it('keeps a hero name that looks like a token as typed', () => {
    expect(layoutDialogue([{ text: 'Hi {name}!' }], '{btn:a}')[0]!.lines.join(' ')).toBe('Hi {btn:a}!');
  });

  it('re-lays out an open dialogue when the player switches device, keeping what is shown', () => {
    const box = new DialogueBox(buildArenaProject({ theme: 'grass' }), new FakeAudio());
    void box.open([{ text: 'Press {btn:a} to open chests.' }]);
    const pad = new Pad();
    for (let i = 0; i < 120; i++) {
      pad.step();
      box.update(STEP, pad);
    }
    const shown = (): { lines: string[]; reveal: number } => {
      const b = box as unknown as { current: { boxes: { lines: string[] }[] }; boxIndex: number; reveal: number };
      return { lines: b.current.boxes[b.boxIndex]!.lines, reveal: b.reveal };
    };
    expect(shown().lines.join(' ')).toBe('Press X to open chests.');
    plugPad(PLAYSTATION);
    pad.step();
    box.update(STEP, pad);
    const after = shown();
    expect(after.lines.join(' ')).toBe(`Press ${PS_GLYPHS.circle} to open chests.`);
    expect(after.reveal).toBe(after.lines.join('').length);
  });
});

describe('name entry with a gamepad', () => {
  it('moves with auto-repeat, picks with A, deletes with B and finishes with Start', () => {
    plugPad(XBOX);
    const fs = new FileSelect(buildArenaProject({ theme: 'grass' }), new FakeAudio(), [null, null, null]);
    const pad = new Pad();
    const step = (): ReturnType<FileSelect['update']> => {
      pad.step();
      return fs.update(STEP, pad);
    };
    const tapFs = (b: Button): ReturnType<FileSelect['update']> => {
      pad.hold(b);
      const res = step();
      pad.release(b);
      step();
      return res;
    };
    tapFs('a');
    const state = fs as unknown as { mode: string; gx: number; name: string };
    expect(state.mode).toBe('name');
    // Hold right for half a second: one press, then repeats at 0.3 s and every 0.1 s.
    pad.hold('right');
    for (let i = 0; i < 30; i++) step();
    pad.release('right');
    step();
    expect(state.gx).toBe(4);
    tapFs('a');
    tapFs('a');
    tapFs('b');
    expect(state.name).toBe('E');
    const res = tapFs('start');
    expect(res).toEqual({ kind: 'create', slot: 0, name: 'E' });
  });

  it("a gamepad's Start opens the file under the cursor, never an erase", () => {
    plugPad(XBOX);
    const fs = new FileSelect(buildArenaProject({ theme: 'grass' }), new FakeAudio(), [null, null, null]);
    const pad = new Pad();
    pad.hold('start');
    pad.step();
    fs.update(STEP, pad);
    expect((fs as unknown as { mode: string }).mode).toBe('name');
  });
});

describe('pause menu CONTROLS page', () => {
  it('is a page away with L, flips vibration and the swap, and B still closes after a swap', () => {
    const r = rig();
    run(r, 0.1);
    tap(r, 'start');
    tap(r, 'l');
    const menu = menuOf(r.s);
    expect(menu.page).toBe('controls');
    tap(r, 'a');
    expect(controllerPrefs().vibration).toBe(false);
    tap(r, 'right');
    expect(controllerPrefs().vibration).toBe(true);
    tap(r, 'down');
    expect(menu.controls.row).toBe(1);
    tap(r, 'a');
    expect(controllerPrefs().swapFaceButtons).toBe(true);
    expect(r.s.mode).toBe('paused');
    tap(r, 'r');
    expect(menu.page).toBe('items');
    tap(r, 'r');
    expect(menu.page).toBe('map');
    tap(r, 'b');
    expect(r.s.mode).toBe('playing');
  });

  it('waits for the button that turned the swap on to be let go', () => {
    const r = rig();
    run(r, 0.1);
    tap(r, 'start');
    tap(r, 'l');
    tap(r, 'down');
    r.pad.hold('a');
    run(r, STEP);
    expect(controllerPrefs().swapFaceButtons).toBe(true);
    // The pad now reports the same (still held) button as B: it must not close the menu.
    r.pad.release('a');
    r.pad.hold('b');
    run(r, 0.2);
    expect(r.s.mode).toBe('paused');
    r.pad.release('b');
    run(r, STEP);
    tap(r, 'b');
    expect(r.s.mode).toBe('playing');
  });

  it('in a playtest, Start + Select held together (the exit chord) neither pauses, closes nor flips the menu', () => {
    const r = rig();
    run(r, 0.1);
    r.pad.hold('start', 'select');
    run(r, 0.3);
    expect(r.s.mode).toBe('playing');
    r.pad.release('start', 'select');
    run(r, STEP);
    r.pad.hold('start');
    run(r, STEP);
    expect(r.s.mode).toBe('paused');
    r.pad.hold('select');
    run(r, 0.3);
    expect(r.s.mode).toBe('paused');
    expect(menuOf(r.s).page).toBe('items');
  });

  it('in play mode Select still flips the menu while Start is held', () => {
    const r = rig({ theme: 'grass' }, 'play');
    run(r, 0.1);
    r.pad.hold('start');
    run(r, STEP);
    r.pad.hold('select');
    run(r, STEP);
    expect(menuOf(r.s).page).toBe('map');
  });
});

describe('unplugging the gamepad in use', () => {
  it('pauses with the notice until a press, which only dismisses it', () => {
    const r = rig();
    run(r, 0.2);
    r.s.controllerLost();
    run(r, STEP);
    expect(r.s.mode).toBe('paused');
    expect(menuOf(r.s).disconnected).toBe(true);
    run(r, 0.5);
    expect(menuOf(r.s).disconnected).toBe(true);
    tap(r, 'start');
    expect(menuOf(r.s).disconnected).toBe(false);
    expect(r.s.mode).toBe('paused');
    tap(r, 'start');
    expect(r.s.mode).toBe('playing');
  });

  it('waits for a dialogue to end, and a press meanwhile (the keyboard) cancels it', () => {
    const r = rig();
    run(r, 0.2);
    void r.s.dialogue('Hello there.');
    run(r, 1);
    r.s.controllerLost();
    run(r, 0.2);
    expect(r.s.mode).toBe('dialogue');
    tap(r, 'a');
    run(r, 0.2);
    expect(r.s.mode).toBe('playing');
  });
});

describe('rumble', () => {
  it('rumbles once when the hero is hurt, and not with vibration off or on the keyboard', () => {
    const r = rig();
    run(r, 0.2);
    plugPad(XBOX);
    r.s.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: 1 });
    run(r, 0.1);
    expect(effects.map((e) => e.strongMagnitude)).toEqual([0.55]);
    run(r, 1.2);
    setControllerPrefs({ vibration: false });
    r.s.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: 1 });
    expect(effects).toHaveLength(1);
    setControllerPrefs({ vibration: true });
    run(r, 1.2);
    noteKeyboard();
    r.s.player.hurtPlayer({ damage: 1, kind: 'contact', source: null, dx: 0, dy: 1 });
    expect(effects).toHaveLength(1);
  });

  it('a pit fall rumbles when the hero falls, not again for its damage', () => {
    const r = rig();
    run(r, 0.2);
    plugPad(XBOX);
    r.s.player.fallIntoPit();
    run(r, 2);
    expect(r.s.save.hp).toBeLessThan(r.s.save.maxHp);
    expect(effects).toHaveLength(1);
  });

  it('a bomb rumbles hard close to the hero and lightly farther away', () => {
    const r = rig({ theme: 'grass', player: { x: 128, y: 112, dir: 'down' } });
    run(r, 0.2);
    plugPad(XBOX);
    r.s.spawn(new Bomb(r.s, 128 + 36, 112));
    run(r, 2);
    expect(effects.map((e) => e.strongMagnitude)).toEqual([1]);
    r.s.spawn(new Bomb(r.s, 128 - 100, 112));
    run(r, 2);
    expect(effects.map((e) => e.strongMagnitude)).toEqual([1, 0]);
  });

  it('an item fanfare taps', () => {
    const r = rig();
    run(r, 0.2);
    plugPad(PLAYSTATION);
    r.s.giveItem('bow', 1, { fanfare: true });
    expect(effects.map((e) => e.weakMagnitude)).toEqual([0.45]);
    expect(currentControls().family).toBe('playstation');
  });
});
