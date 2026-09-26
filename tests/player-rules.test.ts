// Pure hero rules: dash transitions, shield direction, throw arc, reach probes.
import { describe, expect, it } from 'vitest';
import type { Dir, TileDef } from '../src/core/types';
import type { Hit } from '../src/game/api';
import { DASH_WINDUP, dashNext, turnedAway } from '../src/game/player/dash';
import { hitSide, shieldBlocks, shieldReady } from '../src/game/player/shield';
import {
  HOLD_Z, THROW_DIST, THROW_SPEED, THROW_VZ, carryPose, throwGravity, throwHeight,
} from '../src/game/projectiles/carried';
import type { Project, SpriteDef } from '../src/core/types';
import type { RoomRuntime } from '../src/game/api';
import { bodyRise, circleHitsRect } from '../src/game/projectiles/targets';
import { cellsIn, cellsInCircle, clipToRoom, outsideRoom } from '../src/game/projectiles/tiles';
import { pullDestination } from '../src/game/projectiles/hookshot';
import { objectPixels } from '../src/game/projectiles/tileSprite';
import { ACTION_REACH, canLiftEntity, edgeStrip, frontCell, reachRect } from '../src/game/player/reach';
import type { Entity } from '../src/game/entity';

describe('dash', () => {
  it('winds up while the button is held, then runs', () => {
    expect(dashNext('windup', 0.1, true, false)).toBe('windup');
    expect(dashNext('windup', DASH_WINDUP, true, false)).toBe('run');
    expect(dashNext('run', 2, true, false)).toBe('run');
  });

  it('stops on release (wind-up or run) and when steering away mid-run', () => {
    expect(dashNext('windup', 0.1, false, false)).toBe('stop');
    expect(dashNext('run', 1, false, false)).toBe('stop');
    expect(dashNext('run', 1, true, true)).toBe('stop');
    // Steering during the wind-up does not cancel it (the facing already turned).
    expect(dashNext('windup', 0.1, true, true)).toBe('windup');
  });

  it('turning = holding any direction other than the facing', () => {
    expect(turnedAway('right', { x: 1, y: 0 })).toBe(false);
    expect(turnedAway('right', { x: 0, y: 0 })).toBe(false);
    expect(turnedAway('right', { x: 1, y: -1 })).toBe(true);
    expect(turnedAway('right', { x: -1, y: 0 })).toBe(true);
    expect(turnedAway('up', { x: 0, y: -1 })).toBe(false);
    expect(turnedAway('up', { x: 0, y: 1 })).toBe(true);
  });
});

describe('shield', () => {
  const rock = { blockable: true, x: 0, y: 0 } as Entity;
  const hit = (dx: number, dy: number, source: Entity | null = rock): Hit => ({ damage: 1, kind: 'projectile', source, dx, dy });

  it('blocks blockable shots flying at the facing side', () => {
    // A rock flying down (dy = 1) comes from above: blocked when facing up.
    expect(shieldBlocks(hit(0, 1), 50, 50, 'up')).toBe(true);
    expect(shieldBlocks(hit(0, 1), 50, 50, 'down')).toBe(false);
    expect(shieldBlocks(hit(-1, 0), 50, 50, 'right')).toBe(true);
    expect(shieldBlocks(hit(-1, 0), 50, 50, 'left')).toBe(false);
  });

  it('never blocks unblockable sources (enemies, bombs, hazards)', () => {
    const soldier = { blockable: false, x: 50, y: 30 } as Entity;
    expect(shieldBlocks(hit(0, 1, soldier), 50, 50, 'up')).toBe(false);
    expect(shieldBlocks(hit(0, 1, null), 50, 50, 'up')).toBe(false);
  });

  it('falls back to the source position when the hit has no direction', () => {
    const src = { blockable: true, x: 20, y: 50 } as Entity;
    expect(hitSide(hit(0, 0, src), 50, 50)).toBe<Dir>('left');
    expect(shieldBlocks(hit(0, 0, src), 50, 50, 'left')).toBe(true);
    expect(hitSide(hit(0, 0, null), 50, 50)).toBeNull();
  });

  it('is only up while the arms are free', () => {
    expect(shieldReady('normal')).toBe(true);
    expect(shieldReady('charge')).toBe(true);
    for (const s of ['attack', 'spin', 'lift', 'carry', 'dash', 'swim', 'hookshot'] as const) expect(shieldReady(s)).toBe(false);
  });
});

describe('carry and throw arc', () => {
  it('lifts from the pick-up spot to overhead', () => {
    const carrier = { x: 100, y: 100, z: 0 };
    expect(carryPose({ x: 100, y: 84 }, carrier, 0)).toEqual({ x: 100, y: 84, z: 0 });
    const top = carryPose({ x: 100, y: 84 }, carrier, 1);
    expect(top.x).toBe(100);
    expect(top.y).toBe(100);
    expect(top.z).toBeCloseTo(HOLD_Z);
    expect(carryPose({ x: 100, y: 84 }, carrier, 0.5).z).toBeGreaterThan(HOLD_Z / 2);
  });

  it('a throw lands about four tiles away', () => {
    const g = throwGravity(HOLD_Z, THROW_VZ, THROW_DIST, THROW_SPEED);
    const t = THROW_DIST / THROW_SPEED;
    expect(throwHeight(HOLD_Z, THROW_VZ, g, t)).toBeCloseTo(0);
    expect(throwHeight(HOLD_Z, THROW_VZ, g, t / 2)).toBeGreaterThan(0);
    expect(THROW_DIST).toBeGreaterThanOrEqual(56);
    expect(THROW_DIST).toBeLessThanOrEqual(72);
    // Simulated at 60 Hz the arc lands within one tick of the target distance.
    let z = HOLD_Z;
    let vz = THROW_VZ;
    let x = 0;
    while (z > 0) {
      vz -= g / 60;
      z += vz / 60;
      x += THROW_SPEED / 60;
    }
    expect(Math.abs(x - THROW_DIST)).toBeLessThanOrEqual(THROW_SPEED / 60 + 1e-9);
  });
});

describe('blast and tile geometry', () => {
  it('circle vs rect', () => {
    expect(circleHitsRect(0, 0, 20, { x: 15, y: -5, w: 10, h: 10 })).toBe(true);
    expect(circleHitsRect(0, 0, 20, { x: 15, y: 15, w: 10, h: 10 })).toBe(false);
  });

  it('cells under rects and circles', () => {
    expect(cellsIn({ x: 16, y: 0, w: 16, h: 16 })).toEqual([{ tx: 1, ty: 0 }]);
    expect(cellsIn({ x: 15, y: 0, w: 2, h: 1 })).toEqual([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }]);
    const around = cellsInCircle(24, 24, 20);
    expect(around).toContainEqual({ tx: 1, ty: 0 });
    expect(around).toContainEqual({ tx: 0, ty: 1 });
    expect(around).not.toContainEqual({ tx: 3, ty: 3 });
  });
});

describe('attack targets', () => {
  const project = { sprites: [{ id: 'tall', oy: 18 }, { id: 'flat', oy: 8 }] as SpriteDef[] } as Project;
  const thing = (sprite: string, h: number, z = 0) => ({ sprite, h, z }) as Entity;

  it('a body rises over the sprite drawn above the footprint, and with height off the ground', () => {
    // 24 px tall art drawn from 18 px above the origin over a 12 px footprint: 12 px above it, less headroom.
    expect(bodyRise(project, thing('tall', 12))).toBe(9);
    // Objects whose art sits on their footprint (chests, pots, blocks) do not rise.
    expect(bodyRise(project, thing('flat', 16))).toBe(0);
    expect(bodyRise(project, thing('flat', 16, 5))).toBe(5);
    expect(bodyRise(project, thing('', 12))).toBe(0);
  });
});

describe('room edges', () => {
  const room = { width: 256, height: 224 } as RoomRuntime;

  it('clips rects to the room; wholly outside is null', () => {
    const out = { x: 0, y: 0, w: 0, h: 0 };
    expect(clipToRoom(room, { x: 250, y: 10, w: 12, h: 4 }, out)).toEqual({ x: 250, y: 10, w: 6, h: 4 });
    expect(clipToRoom(room, { x: -4, y: -4, w: 8, h: 8 }, out)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(clipToRoom(room, { x: 256, y: 10, w: 8, h: 8 }, out)).toBeNull();
  });

  it('tells how much of a rect lies past the edge', () => {
    expect(outsideRoom(room, { x: 10, y: 10, w: 8, h: 8 })).toBe('none');
    expect(outsideRoom(room, { x: 252, y: 10, w: 8, h: 8 })).toBe('part');
    expect(outsideRoom(room, { x: 10, y: -8, w: 8, h: 8 })).toBe('all');
    expect(outsideRoom(room, { x: 256, y: 10, w: 8, h: 8 })).toBe('all');
  });
});

describe('hookshot pull', () => {
  it('stops the hero touching the near side of what it latched onto', () => {
    const chest = { top: 32, bottom: 48, left: 96, right: 112 } as Entity;
    expect(pullDestination(chest, 'up', { x: 104, y: 140 }, 12, 12)).toEqual({ x: 104, y: 54 });
    expect(pullDestination(chest, 'down', { x: 104, y: 0 }, 12, 12)).toEqual({ x: 104, y: 26 });
    expect(pullDestination(chest, 'right', { x: 10, y: 40 }, 12, 12)).toEqual({ x: 90, y: 40 });
    expect(pullDestination(chest, 'left', { x: 200, y: 40 }, 12, 12)).toEqual({ x: 118, y: 40 });
  });
});

describe('action reach', () => {
  const hero = (facing: Dir) => ({ x: 100, y: 100, w: 12, h: 12, left: 94, right: 106, top: 94, bottom: 106, facing }) as Entity;

  it('reaches from the hero centre to ACTION_REACH px past its facing edge', () => {
    expect(reachRect(hero('up'), ACTION_REACH)).toEqual({ x: 96, y: 88, w: 8, h: 12 });
    expect(reachRect(hero('down'), ACTION_REACH)).toEqual({ x: 96, y: 100, w: 8, h: 12 });
    expect(reachRect(hero('left'), ACTION_REACH)).toEqual({ x: 88, y: 96, w: 12, h: 8 });
    expect(reachRect(hero('right'), ACTION_REACH)).toEqual({ x: 100, y: 96, w: 12, h: 8 });
  });

  it('edge strips sit just outside the hitbox', () => {
    expect(edgeStrip(hero('up'), 2)).toEqual({ x: 95, y: 92, w: 10, h: 2 });
    expect(edgeStrip(hero('right'), 4)).toEqual({ x: 106, y: 95, w: 4, h: 10 });
  });

  it('the front cell is the tile just past the facing edge', () => {
    expect(frontCell(hero('up'))).toEqual({ tx: 6, ty: 5 });
    expect(frontCell(hero('down'))).toEqual({ tx: 6, ty: 6 });
    expect(frontCell(hero('left'))).toEqual({ tx: 5, ty: 6 });
    expect(frontCell(hero('right'))).toEqual({ tx: 6, ty: 6 });
  });

  it('only bombs resting on the ground and light enough things can be lifted', () => {
    const jar = { liftWeight: 0, z: 0 } as Entity;
    const rock = { liftWeight: 1, z: 0 } as Entity;
    const wall = { liftWeight: null, z: 0 } as Entity;
    expect(canLiftEntity(jar, 0)).toBe(true);
    expect(canLiftEntity(rock, 0)).toBe(false);
    expect(canLiftEntity(rock, 1)).toBe(true);
    expect(canLiftEntity(wall, 2)).toBe(false);
  });
});

describe('lifted tile image', () => {
  const pal = { id: 'p', name: 'p', colors: ['#000000', '#111111', '#222222', ...Array<string>(13).fill('#ffffff')] };
  const tile = (id: number, frame: string): TileDef => ({ id, key: `T${id}`, name: '', palette: 'p', frames: [frame], collision: 'floor', tags: [] });

  it('keeps only the pixels that differ from the ground left behind', () => {
    const ground = tile(1, '1'.repeat(256));
    const bush = tile(2, '2'.repeat(8) + '1'.repeat(248));
    const px = objectPixels({ palettes: [pal] }, bush, ground);
    expect(px.slice(0, 8)).toEqual(Array(8).fill('#222222'));
    expect(px.slice(8).every((c) => c === '')).toBe(true);
  });

  it('keeps the whole tile when there is no ground to remove (transparent stays empty)', () => {
    const px = objectPixels({ palettes: [pal] }, tile(3, '0'.repeat(128) + '1'.repeat(128)), undefined);
    expect(px[0]).toBe('');
    expect(px[255]).toBe('#111111');
  });
});
