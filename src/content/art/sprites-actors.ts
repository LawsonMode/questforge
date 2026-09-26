// Enemies, bosses and NPCs: original SNES-style actor sprites. OWNER: actor-sprite-art agent.
// Contract: one SpriteDef per SPRITE_SPECS entry where !isCoreSprite(spec)
// (built with spriteDefFromSpec), palettes prefixed "pal.a." plus the swap
// palettes the specs require (pal.soldier.blue, pal.soldier.red, pal.archer.blue,
// pal.spitter.blue, pal.slime.red, pal.slime.blue).
// Each creature family lives in its own actors-*.ts module; actors-kit.ts holds
// the shared palette layout, ASCII legend and shaders, actors-humanoid.ts the
// 16x24 body-part helpers.
import type { Palette, SpriteDef } from '../../core/types';
import type { ArtSet } from './actors-kit';
import { buildSoldierArt } from './actors-soldiers';
import { buildGoblinArt } from './actors-goblin';
import { buildCritterArt } from './actors-critters';
import { buildDungeonArt } from './actors-dungeon';
import { buildWormArt } from './actors-worm';
import { buildKnightArt } from './actors-knight';
import { buildNpcArt } from './actors-npcs';

/** Every enemy, boss and NPC sprite with its base palette and the required colour swaps. */
export function buildActorSpriteArt(): { palettes: Palette[]; sprites: SpriteDef[] } {
  const sets: ArtSet[] = [
    buildSoldierArt(), buildGoblinArt(), buildCritterArt(), buildDungeonArt(), buildWormArt(), buildKnightArt(), buildNpcArt(),
  ];
  return { palettes: sets.flatMap((s) => s.palettes), sprites: sets.flatMap((s) => s.sprites) };
}
