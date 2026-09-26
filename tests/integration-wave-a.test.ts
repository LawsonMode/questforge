// Wave A cross-area checks: the art modules, the gfx art checker, the data layer
// (validation, (de)serialisation, autotile) and the engine test project agree.
import { describe, expect, it } from 'vitest';
import type { Project } from '../src/core/types';
import { createDefaultAssets } from '../src/content/art';
import { buildTileArt } from '../src/content/art/tiles';
import { buildCoreSpriteArt, HERO_SWORD_POSES } from '../src/content/art/sprites-core';
import { buildActorSpriteArt } from '../src/content/art/sprites-actors';
import { T } from '../src/content/ids';
import { createTestProject } from '../src/content/testProject';
import { animProblems, paletteProblems, spriteProblems, terrainProblems, tileProblems } from '../src/gfx/artCheck';
import { createBlankProject, findRoom, parseProject, roomCols, serializeProject } from '../src/core/project';
import { validateProject } from '../src/core/validate';
import { resolveRoomTerrain } from '../src/core/autotile';

const errors = (p: Project): string[] => validateProject(p).filter((x) => x.level === 'error').map((x) => x.message);

describe('default assets through the gfx art checker', () => {
  const a = createDefaultAssets();
  const palettes = new Set(a.palettes.map((p) => p.id));
  const tiles = new Set(a.tiles.map((t) => t.id));
  const hasPalette = (id: string): boolean => palettes.has(id);

  it('has no palette, tile or terrain problems', () => {
    const problems = [
      ...a.palettes.flatMap((p) => paletteProblems(p).map((m) => `${p.id}: ${m}`)),
      ...a.tiles.flatMap((t) => tileProblems(t, hasPalette).map((m) => `tile ${t.id}: ${m}`)),
      ...a.terrains.flatMap((tr) => terrainProblems(tr, (id) => tiles.has(id)).map((m) => `${tr.id}: ${m}`)),
    ];
    expect(problems).toEqual([]);
  });

  it('has no sprite or anim problems', () => {
    const problems = a.sprites.flatMap((s) => [
      ...spriteProblems(s, hasPalette).map((m) => `${s.id}: ${m}`),
      ...Object.entries(s.anims).flatMap(([name, anim]) => animProblems(s, anim).map((m) => `${s.id}.${name}: ${m}`)),
    ]);
    expect(problems).toEqual([]);
  });

  it('is deterministic (projects embed the art, so rebuilding must not change it)', () => {
    expect(buildTileArt()).toEqual(buildTileArt());
    expect(buildCoreSpriteArt()).toEqual(buildCoreSpriteArt());
    expect(buildActorSpriteArt()).toEqual(buildActorSpriteArt());
  });
});

describe('hero sword poses match the hero sprite', () => {
  it('has one pose per attack frame and a blade anim for every pose', () => {
    const a = createDefaultAssets();
    const hero = a.sprites.find((s) => s.id === 'hero')!;
    const sword = a.sprites.find((s) => s.id === 'fx.sword')!;
    for (const dir of ['down', 'up', 'right', 'left'] as const) {
      const poses = HERO_SWORD_POSES[dir];
      expect(poses.length).toBe(hero.anims[`attack_${dir}`]!.frames.length);
      for (const pose of poses) expect(sword.anims[pose.blade], `${dir} blade ${pose.blade}`).toBeDefined();
    }
  });
});

describe('projects through the data layer', () => {
  it('a blank project validates without errors', () => {
    expect(errors(createBlankProject('Blank'))).toEqual([]);
  });

  it('the engine test project survives a save/load round trip unchanged and valid', () => {
    const p = createTestProject();
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
    expect(errors(back)).toEqual([]);
  });

  it('every path in the test project is already autotiled the way the editor brush would paint it', () => {
    const p = createTestProject();
    const path = p.terrains.find((t) => t.id === 'path')!;
    for (const world of p.worlds) {
      for (const room of world.rooms) expect(resolveRoomTerrain(room, path), room.id).toEqual([]);
    }
  });

  it('the crossroads junction has inner corners', () => {
    const room = findRoom(createTestProject(), 'ow', 'ow_cross')!;
    const at = (tx: number, ty: number): number => room.layers.bg[ty * roomCols(room) + tx]!;
    expect(at(6, 3)).toBe(T.PATH_INW);
    expect(at(6, 5)).toBe(T.PATH_ISW);
    expect(at(6, 4)).toBe(T.PATH);
  });
});
