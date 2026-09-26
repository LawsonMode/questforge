// Hero, effects, projectiles, pickups, item icons, objects, HUD & editor icons.
// OWNER: core-sprite-art agent.
// Contract: one SpriteDef per SPRITE_SPECS entry where isCoreSprite(spec)
// (built with spriteDefFromSpec), palettes prefixed "pal.c." plus the swap
// palettes the specs require (pal.sword.2, pal.boomerang.2).
//
// Art lives in core-*.ts: palettes, the part-based hero, weapons/projectiles,
// fx, items, objects, doors and UI icons (core-draw.ts has the shared helpers).
import type { Palette, SpriteDef } from '../../core/types';
import { SPRITE_SPECS } from '../ids';
import { isCoreSprite } from './build';
import { corePalettes } from './core-palettes';
import { buildHero } from './core-hero';
import {
  buildArrow, buildBeam, buildBone, buildBoomerang, buildFireball, buildHookshot, buildRock, buildSpear, buildSwordBlade,
} from './core-weapons';
import {
  buildDust, buildExplosion, buildFlame, buildHit, buildLeaves, buildPoof, buildShatter, buildSparkle, buildSplash,
} from './core-fx';
import { buildBomb, buildItemIcons, buildPickups } from './core-items';
import {
  buildBigChest, buildBlock, buildChest, buildCrystalSwitch, buildPeg, buildPot, buildSign, buildSwitch, buildTorch,
} from './core-objects';
import { buildDoorEW, buildDoorNS } from './core-doors';
import { buildEditorIcons, buildHud } from './core-ui';

export { HERO_SWORD_POSES, type SwordPose } from './core-hero';

/** Sprite id -> builder, one per core sprite spec. */
const BUILDERS: Readonly<Record<string, () => SpriteDef>> = {
  hero: buildHero,
  'fx.sword': buildSwordBlade,
  'fx.poof': buildPoof,
  'fx.hit': buildHit,
  'fx.splash': buildSplash,
  'fx.leaves': buildLeaves,
  'fx.shatter': buildShatter,
  'fx.explosion': buildExplosion,
  'fx.sparkle': buildSparkle,
  'fx.dust': buildDust,
  'fx.flame': buildFlame,
  'proj.arrow': buildArrow,
  'proj.rock': buildRock,
  'proj.spear': buildSpear,
  'proj.boomerang': buildBoomerang,
  'proj.hookshot': buildHookshot,
  'proj.fireball': buildFireball,
  'proj.beam': buildBeam,
  'proj.bone': buildBone,
  'obj.bomb': buildBomb,
  pickup: buildPickups,
  item: buildItemIcons,
  'obj.chest': buildChest,
  'obj.bigChest': buildBigChest,
  'obj.block': buildBlock,
  'obj.switch': buildSwitch,
  'obj.crystalSwitch': buildCrystalSwitch,
  'obj.peg': buildPeg,
  'obj.torch': buildTorch,
  'obj.pot': buildPot,
  'obj.sign': buildSign,
  'obj.doorNS': buildDoorNS,
  'obj.doorEW': buildDoorEW,
  hud: buildHud,
  'editor.icons': buildEditorIcons,
};

export function buildCoreSpriteArt(): { palettes: Palette[]; sprites: SpriteDef[] } {
  const sprites = SPRITE_SPECS.filter(isCoreSprite).map((spec) => {
    const build = BUILDERS[spec.id];
    if (!build) throw new Error(`core sprite art: no builder for "${spec.id}"`);
    return build();
  });
  return { palettes: corePalettes(), sprites };
}
