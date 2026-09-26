// Wave B integration: engine rules that tie the gameplay areas together, run on
// the real sample adventure with every entity behaviour registered - a boss's
// uncollected heart container coming back, dialogue speaker/position/choice
// flags, no pausing mid trigger sequence, pushes that keep trying, and enemy
// shots that never stop on their own (solid) shooter.
import { describe, expect, it } from 'vitest';
import type { AudioApi, Button, DebugFlags, InputState } from '../src/game/api';
import type { Dialogue, MusicId, Project, SfxId, WarpTarget } from '../src/core/types';
import type { DialogueBoxPage } from '../src/game/ui/dialogueLayout';
import type { Vec } from '../src/core/math';
import { STEP } from '../src/core/constants';
import { findRoom } from '../src/core/project';
import { createSampleProject } from '../src/content/sample/sampleProject';
import { newSave } from '../src/game/state';
import { Session } from '../src/game/session';
import { EnemyProjectile } from '../src/game/entities/enemies/common';
import '../src/game/entities/index';

class FakeInput implements InputState {
  vec: Vec = { x: 0, y: 0 };
  /** Buttons reported as pressed (and held) on the next tick only. */
  readonly taps = new Set<Button>();
  held(b: Button): boolean {
    return this.taps.has(b) || (b === 'left' && this.vec.x < 0) || (b === 'right' && this.vec.x > 0)
      || (b === 'up' && this.vec.y < 0) || (b === 'down' && this.vec.y > 0);
  }
  pressed(b: Button): boolean { return this.taps.has(b); }
  released(): boolean { return false; }
  heldTime(): number { return 0; }
  dir(): Vec { return this.vec; }
  anyPressed(): boolean { return this.taps.size > 0; }
  typed(): string { return ''; }
}

class FakeAudio implements AudioApi {
  currentMusic: MusicId | 'none' = 'none';
  sfx(_id: SfxId): void {}
  music(id: MusicId | 'none'): void { this.currentMusic = id; }
  duck(): void {}
  setVolumes(): void {}
  unlock(): void {}
  setMuted(): void {}
}

interface Rig { s: Session; input: FakeInput; project: Project }

const KEEP = 'hollow_keep';

function rig(start: WarpTarget, edit?: (p: Project) => void): Rig {
  const project = createSampleProject();
  edit?.(project);
  const input = new FakeInput();
  const debug: DebugFlags = { hitboxes: false, invincible: true, noclip: false, fps: false };
  const save = newSave(project, 0, 'TEST');
  save.respawn = { ...start };
  const host = { mode: 'playtest' as const, persist: async () => {}, exit: () => {} };
  return { s: new Session(host, project, input, new FakeAudio(), save, debug, start), input, project };
}

function run(r: Rig, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.s.tick(STEP);
    if (until?.()) return;
  }
}

function tap(r: Rig, b: Button): void {
  r.input.taps.add(b);
  r.s.tick(STEP);
  r.input.taps.clear();
}

/** The dialogue box's current request (private UI state, read-only here). */
function shownBox(s: Session): { position: string; box: DialogueBoxPage } | null {
  const db = (s as unknown as { dialogueBox: { current: { position: string; boxes: DialogueBoxPage[] } | null; boxIndex: number } })
    .dialogueBox;
  return db.current ? { position: db.current.position, box: db.current.boxes[db.boxIndex]! } : null;
}

const ids = (s: Session): string[] => s.entities.filter((e) => !e.dead).map((e) => e.id);
const lair: WarpTarget = { world: KEEP, room: 'kp_boss', x: 128, y: 72, dir: 'down' };

describe('a defeated boss leaves its heart container behind until it is taken', () => {
  it('brings back an uncollected heart container instead of the boss', () => {
    const r = rig(lair);
    expect(ids(r.s)).toContain('kp_boss_worm');
    r.s.setFlag('defeated:kp_boss_worm');
    r.s.warpNow(lair);
    expect(ids(r.s)).not.toContain('kp_boss_worm');
    const heart = r.s.findEntity('kp_boss_worm-heart');
    expect(heart?.type).toBe('obj.pickup');
    expect(r.s.room.blocked({ x: heart!.x - 6, y: heart!.y - 6, w: 12, h: 12 }, 'walker')).toBe(false);
    expect(r.s.enemiesCleared()).toBe(true);
  });

  it('stays gone once collected, and never appears for a boss that drops none', () => {
    const r = rig(lair);
    r.s.setFlag('defeated:kp_boss_worm');
    r.s.setFlag('pickup:kp_boss_worm-heart');
    r.s.warpNow(lair);
    expect(ids(r.s)).not.toContain('kp_boss_worm-heart');

    const none = rig(lair, (p) => {
      findRoom(p, KEEP, 'kp_boss')!.entities.find((e) => e.id === 'kp_boss_worm')!.props.dropHeart = false;
    });
    none.s.setFlag('defeated:kp_boss_worm');
    none.s.warpNow(lair);
    expect(ids(none.s)).not.toContain('kp_boss_worm-heart');
  });
});

describe('dialogue', () => {
  const plaza: WarpTarget = { world: 'ellendor', room: 'ow_village', x: 13 * 16 + 8, y: 11 * 16 + 8, dir: 'up' };

  it('labels pages without a speaker of their own, and sits on top while the hero is low on screen', () => {
    const r = rig(plaza, (p) => {
      p.dialogues.push({ id: 'd_test', name: 'Test', pages: [{ text: 'One.' }, { speaker: 'Other', text: 'Two.' }] } as Dialogue);
    });
    void r.s.dialogue('d_test', { speaker: 'Rowan' });
    const shown = shownBox(r.s)!;
    expect(shown.position).toBe('top');
    expect(shown.box.speaker).toBe('Rowan');
    const pages = (r.s as unknown as { dialogueBox: { current: { boxes: DialogueBoxPage[] } } }).dialogueBox.current.boxes;
    expect(pages.map((b) => b.speaker)).toEqual(['Rowan', 'Other']);
  });

  it('stays at the bottom while the hero stands high on screen', () => {
    const r = rig({ ...plaza, y: 5 * 16 + 8 });
    void r.s.dialogue('Hello there.');
    expect(shownBox(r.s)!.position).toBe('bottom');
  });

  it('a flagged choice sets its flag as soon as it is picked, for any dialogue', () => {
    const r = rig(plaza, (p) => {
      p.dialogues.push({
        id: 'd_ask', name: 'Ask', pages: [{ text: 'Help?', choice: { options: ['Yes', 'No'], flag: 'agreed' } }],
      } as Dialogue);
    });
    let result = -2;
    void r.s.dialogue('d_ask').then((n) => { result = n; });
    for (let i = 0; i < 120 && r.s.mode === 'dialogue'; i++) {
      tap(r, 'a');
      run(r, 0.1);
    }
    expect(r.s.flag('agreed')).toBe(true);
    return Promise.resolve().then(() => expect(result).toBe(0));
  });
});

describe('pausing', () => {
  it('is refused while a trigger sequence runs (a save must not split it), allowed after', () => {
    const start: WarpTarget = { world: 'ellendor', room: 'ow_meadow', x: 6 * 16 + 8, y: 8 * 16 + 8, dir: 'down' };
    const r = rig(start, (p) => {
      findRoom(p, 'ellendor', 'ow_meadow')!.triggers.push({
        id: 't_wait', name: 'Wait', on: 'enter', conditions: [], actions: [{ kind: 'wait', seconds: 1 }], once: false,
      });
    });
    run(r, 0.1);
    tap(r, 'start');
    expect(r.s.mode).toBe('playing');
    run(r, 1.1);
    tap(r, 'start');
    expect(r.s.mode).toBe('paused');
  });
});

describe('pushing', () => {
  it('keeps trying while the hero pushes: a block whose way was briefly in use still moves', () => {
    const r = rig({ world: KEEP, room: 'kp_block_room', x: 12 * 16 + 8, y: 7 * 16 + 8, dir: 'left' });
    const block = r.s.findEntity('kp_r4_block')!;
    const bat = r.s.findEntity('kp_r4_bat')!;
    // The bat hangs over the loose block's destination (an enemy there refuses the push).
    const park = (): boolean => {
      bat.x = 10 * 16 + 8;
      bat.y = 7 * 16 + 8;
      bat.stun = 1;
      return false;
    };
    park();
    r.input.vec = { x: -1, y: 0 };
    run(r, 0.6, park);
    expect(block.x).toBe(11 * 16 + 8);
    bat.x = 3 * 16;
    run(r, 0.7, () => block.x === 10 * 16 + 8);
    r.input.vec = { x: 0, y: 0 };
    expect(block.x).toBe(10 * 16 + 8);
  });
});

describe('enemy shots', () => {
  it('fly out of their solid shooter, but burst on any other solid thing', () => {
    const r = rig({ world: KEEP, room: 'kp_eye_gallery', x: 13 * 16 + 8, y: 12 * 16 + 8, dir: 'up' });
    const eye = r.s.findEntity('kp_r9_eye_1')!;
    expect(eye.solid).toBe(true);
    const shot = (source: typeof eye | null): EnemyProjectile => r.s.spawn(new EnemyProjectile(r.s, {
      sprite: 'proj.beam', x: eye.x, y: eye.y, vx: 0, vy: 120, source,
    }));
    const own = shot(eye);
    const stray = shot(null);
    run(r, 0.2);
    expect(own.dead).toBe(false);
    expect(own.y).toBeGreaterThan(eye.y + 16);
    expect(stray.dead).toBe(true);
  });
});
