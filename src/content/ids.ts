// =============================================================================
// Default content catalog — THE contract between art agents, the sample
// project, and gameplay code. Tile ids/semantics and sprite ids/animation names
// are fixed here; art modules supply palettes + pixel frames that satisfy them.
// =============================================================================
import type { Collision, Dir, ItemId } from '../core/types';

// ----------------------------------------------------------------------------
// Tiles
// ----------------------------------------------------------------------------

export interface TileSpec {
  id: number;
  key: string;
  name: string;
  collision: Collision;
  tags: string[];
  solidMask?: number;
  ledgeDir?: Dir;
  /** Behaviours reference other tiles by KEY (resolved to ids when building TileDefs). */
  cut?: { to: string; drops?: boolean };
  lift?: { to: string; weight: 0 | 1 | 2; drops?: boolean };
  bomb?: { to: string };
  dash?: { to: string };
  /** Art hint: this tile should be animated (2-4 frames). */
  animated?: boolean;
  /** Art hint for the artist. */
  art?: string;
}

const specs: TileSpec[] = [];
function t(
  id: number, key: string, name: string, collision: Collision, tags: string[],
  extra: Partial<TileSpec> = {},
): void {
  specs.push({ id, key, name, collision, tags, ...extra });
}

/** Order of the 13 autotile members; ids are consecutive from the base id. */
export const TERRAIN_PARTS = ['', '_N', '_S', '_E', '_W', '_NE', '_NW', '_SE', '_SW', '_INE', '_INW', '_ISE', '_ISW'] as const;
const PART_NAMES = ['', ' edge N', ' edge S', ' edge E', ' edge W', ' corner NE', ' corner NW', ' corner SE', ' corner SW',
  ' inner NE', ' inner NW', ' inner SE', ' inner SW'];

function terrain(
  base: number, key: string, name: string, center: Collision, edge: Collision, tags: string[],
  extra: Partial<TileSpec> = {}, art = '',
): void {
  TERRAIN_PARTS.forEach((suffix, i) => {
    t(base + i, key + suffix, name + PART_NAMES[i], i === 0 ? center : edge, tags, {
      ...extra,
      art: i === 0 ? art : `${art} Autotile piece "${suffix.slice(1)}": ${terrainArtHint(suffix)}`,
    });
  });
}

function terrainArtHint(suffix: string): string {
  switch (suffix) {
    case '_N': return 'the terrain border runs along the TOP edge (neighbour above is outside terrain).';
    case '_S': return 'border along the BOTTOM edge.';
    case '_E': return 'border along the RIGHT edge.';
    case '_W': return 'border along the LEFT edge.';
    case '_NE': return 'convex corner: borders on TOP and RIGHT.';
    case '_NW': return 'convex corner: borders on TOP and LEFT.';
    case '_SE': return 'convex corner: borders on BOTTOM and RIGHT.';
    case '_SW': return 'convex corner: borders on BOTTOM and LEFT.';
    case '_INE': return 'concave corner: only a small notch of outside terrain in the TOP-RIGHT corner.';
    case '_INW': return 'concave corner: notch in the TOP-LEFT corner.';
    case '_ISE': return 'concave corner: notch in the BOTTOM-RIGHT corner.';
    case '_ISW': return 'concave corner: notch in the BOTTOM-LEFT corner.';
    default: return '';
  }
}

// ---- Overworld ground & nature (1-39) ----
t(1, 'GRASS', 'Grass', 'floor', ['overworld', 'ground'], { art: 'Mid green with sparse darker blades; must tile seamlessly.' });
t(2, 'GRASS_ALT', 'Grass (tufts)', 'floor', ['overworld', 'ground'], { art: 'GRASS with a few lighter tufts; tiles with GRASS.' });
t(3, 'GRASS_DARK', 'Grass (shade)', 'floor', ['overworld', 'ground'], { art: 'Darker forest grass.' });
t(4, 'FLOWERS', 'Flowers', 'floor', ['overworld', 'decor'], { animated: true, art: 'GRASS with small white/red flowers that sway (2-3 frames).' });
t(5, 'TALL_GRASS', 'Tall grass', 'tallgrass', ['overworld'], { cut: { to: 'GRASS', drops: true }, art: 'Dense tall grass blades.' });
t(6, 'BUSH', 'Bush', 'solid', ['overworld'], { cut: { to: 'GRASS', drops: true }, lift: { to: 'GRASS', weight: 0, drops: true }, art: 'Round leafy bush on grass, light top-left highlight.' });
t(7, 'ROCK', 'Rock', 'solid', ['overworld'], { lift: { to: 'GRASS', weight: 1 }, art: 'Grey boulder on grass (liftable with glove).' });
t(8, 'HEAVY_ROCK', 'Heavy rock', 'solid', ['overworld'], { lift: { to: 'GRASS', weight: 2 }, art: 'Darker, larger-looking boulder.' });
t(9, 'DIRT', 'Dirt', 'floor', ['overworld', 'ground'], { art: 'Brown earth with specks.' });
t(10, 'SAND', 'Sand', 'floor', ['overworld', 'ground'], { art: 'Pale sand with dots.' });
t(11, 'STUMP', 'Stump', 'solid', ['overworld', 'decor'], { art: 'Cut tree stump on grass.' });
t(12, 'FENCE_H', 'Fence (horizontal)', 'solid', ['overworld', 'decor'], { art: 'Wooden rail fence running left-right, grass behind.' });
t(13, 'FENCE_V', 'Fence (vertical)', 'solid', ['overworld', 'decor'], { art: 'Wooden fence running up-down.' });
t(14, 'FENCE_POST', 'Fence post', 'solid', ['overworld', 'decor'], { art: 'Single wooden post.' });
t(15, 'STONE_PATH', 'Stone path', 'floor', ['overworld', 'ground'], { art: 'Flagstone paving.' });
t(16, 'BRIDGE_H', 'Bridge (horizontal)', 'floor', ['overworld', 'water'], { art: 'Wooden planks running left-right with rails top & bottom; opaque (placed on fg over water).' });
t(17, 'BRIDGE_V', 'Bridge (vertical)', 'floor', ['overworld', 'water'], { art: 'Planks running up-down with side rails.' });
t(18, 'HOLE', 'Hole', 'pit', ['overworld'], { art: 'Black hole with earthy rim on grass.' });
t(19, 'STAIRS_DOWN', 'Stairs down', 'stairs', ['overworld'], { art: 'Stone steps descending into darkness.' });
t(20, 'CAVE_ENTRANCE', 'Cave entrance', 'floor', ['overworld'], { art: 'Dark arched opening in rock (walkable; a warp sits on it).' });
t(21, 'GRAVESTONE', 'Gravestone', 'solid', ['overworld', 'decor'], { art: 'Rounded grey headstone on grass.' });
t(22, 'STATUE', 'Statue', 'solid', ['overworld', 'decor'], { art: 'Small stone bird/guardian statue.' });
t(23, 'CRACKED_ROCKWALL', 'Cracked rock wall', 'solid', ['overworld', 'secret'], { bomb: { to: 'CAVE_ENTRANCE' }, art: 'MOUNTAIN_ROCK with a subtle crack (bombable).' });
t(24, 'MOUNTAIN_ROCK', 'Mountain rock', 'solid', ['overworld', 'cliff'], { art: 'Craggy brown/grey rock wall.' });
t(25, 'MOUNTAIN_GROUND', 'Mountain ground', 'floor', ['overworld', 'ground'], { art: 'Dusty brown-grey ground.' });
t(26, 'LEDGE_S', 'Ledge (hop down)', 'ledge', ['overworld', 'cliff'], { ledgeDir: 'down', art: 'Grass lip with a short earthy drop on the bottom edge.' });
t(27, 'LEDGE_N', 'Ledge (hop up-screen)', 'ledge', ['overworld', 'cliff'], { ledgeDir: 'up', art: 'Drop on the top edge.' });
t(28, 'LEDGE_E', 'Ledge (hop right)', 'ledge', ['overworld', 'cliff'], { ledgeDir: 'right', art: 'Drop on the right edge.' });
t(29, 'LEDGE_W', 'Ledge (hop left)', 'ledge', ['overworld', 'cliff'], { ledgeDir: 'left', art: 'Drop on the left edge.' });
t(30, 'TREE_TL', 'Tree canopy (top-left)', 'floor', ['overworld', 'tree'], { art: 'Top-left quarter of a 2x2 round tree canopy. Transparent outside the canopy. Placed on the OVER layer.' });
t(31, 'TREE_TR', 'Tree canopy (top-right)', 'floor', ['overworld', 'tree'], { art: 'Top-right quarter of the canopy (OVER layer).' });
t(32, 'TREE_BL', 'Tree (bottom-left)', 'solid', ['overworld', 'tree'], { art: 'Bottom-left: lower canopy + left half of trunk. Transparent background (placed on FG over grass).' });
t(33, 'TREE_BR', 'Tree (bottom-right)', 'solid', ['overworld', 'tree'], { art: 'Bottom-right: lower canopy + right half of trunk (FG).' });
t(34, 'TREE_SMALL', 'Small tree', 'solid', ['overworld', 'tree'], { art: 'One-tile round shrub-tree, transparent background (FG).' });
t(35, 'CLIFF_STAIRS', 'Cliff stairs', 'stairs', ['overworld', 'cliff'], { art: 'Steps cut into rock going up.' });
t(36, 'PEBBLES', 'Pebbles', 'floor', ['overworld', 'decor'], { art: 'GRASS with a few small stones.' });

// ---- Buildings (40-59) ----
t(40, 'ROOF_TL', 'Roof (top-left)', 'solid', ['overworld', 'building'], { art: '9-slice roof. Red/brown shingles; this is the top-left corner (ridge + eave).' });
t(41, 'ROOF_T', 'Roof (top)', 'solid', ['overworld', 'building']);
t(42, 'ROOF_TR', 'Roof (top-right)', 'solid', ['overworld', 'building']);
t(43, 'ROOF_L', 'Roof (left)', 'solid', ['overworld', 'building']);
t(44, 'ROOF_M', 'Roof (middle)', 'solid', ['overworld', 'building']);
t(45, 'ROOF_R', 'Roof (right)', 'solid', ['overworld', 'building']);
t(46, 'ROOF_BL', 'Roof (bottom-left)', 'solid', ['overworld', 'building']);
t(47, 'ROOF_B', 'Roof (bottom)', 'solid', ['overworld', 'building'], { art: 'Eave edge with a shadow line.' });
t(48, 'ROOF_BR', 'Roof (bottom-right)', 'solid', ['overworld', 'building']);
t(49, 'HOUSE_WALL', 'House wall', 'solid', ['overworld', 'building'], { art: 'Plaster/timber house front wall.' });
t(50, 'HOUSE_WINDOW', 'House window', 'solid', ['overworld', 'building'], { art: 'Wall with a lit window.' });
t(51, 'HOUSE_DOOR', 'House door', 'floor', ['overworld', 'building'], { art: 'Dark open doorway in the wall (walkable; a warp sits on it).' });
t(52, 'STONE_WALL', 'Stone wall', 'solid', ['overworld', 'building'], { art: 'Castle/town block wall face.' });
t(53, 'STONE_WALL_TOP', 'Stone wall (top)', 'solid', ['overworld', 'building'], { art: 'Top of the stone wall (battlement walkway look).' });

// ---- Autotile terrains (100-199) ----
terrain(100, 'WATER', 'Deep water', 'deep', 'deep', ['overworld', 'water'], { animated: true },
  'Deep blue water with moving highlight ripples. Edges show a grass shore on the outside border.');
t(113, 'SHALLOW_WATER', 'Shallow water', 'shallow', ['overworld', 'water', 'dungeon'], { animated: true, art: 'Light, translucent-looking shallow water; ground visible.' });
terrain(120, 'PATH', 'Dirt path', 'floor', 'floor', ['overworld', 'ground'], {},
  'Worn light-brown dirt path. Edges blend into GRASS on the outside border.');
terrain(140, 'PIT', 'Pit', 'pit', 'pit', ['dungeon'], {},
  'Bottomless black pit. Edges show a stone floor lip (DFLOOR style) on the outside border.');
terrain(160, 'PLATEAU', 'Plateau', 'floor', 'solid', ['overworld', 'cliff'], {},
  'Raised grassy plateau top (center, walkable). Edge pieces are cliff: rock faces/rims facing outward, the S edge shows a tall rock face.');

// ---- Dungeon (200-259) ----
t(200, 'DFLOOR', 'Dungeon floor', 'floor', ['dungeon', 'ground'], { art: 'Blue-grey stone floor tiles.' });
t(201, 'DFLOOR_TILE', 'Dungeon floor (checker)', 'floor', ['dungeon', 'ground']);
t(202, 'DFLOOR_ORNATE', 'Dungeon floor (ornate)', 'floor', ['dungeon', 'ground']);
t(203, 'CARPET', 'Carpet', 'floor', ['dungeon', 'ground'], { art: 'Red carpet with gold trim.' });
t(204, 'DWALL_TOP', 'Wall (room top)', 'solid', ['dungeon', 'wall'], { art: 'Top wall of a room: brick face pointing DOWN into the room.' });
t(205, 'DWALL_BOTTOM', 'Wall (room bottom)', 'solid', ['dungeon', 'wall'], { art: 'Bottom wall: face pointing UP.' });
t(206, 'DWALL_LEFT', 'Wall (room left)', 'solid', ['dungeon', 'wall'], { art: 'Left wall: face pointing RIGHT.' });
t(207, 'DWALL_RIGHT', 'Wall (room right)', 'solid', ['dungeon', 'wall'], { art: 'Right wall: face pointing LEFT.' });
t(208, 'DWALL_TL', 'Wall corner (top-left)', 'solid', ['dungeon', 'wall'], { art: "Room's top-left corner." });
t(209, 'DWALL_TR', 'Wall corner (top-right)', 'solid', ['dungeon', 'wall']);
t(210, 'DWALL_BL', 'Wall corner (bottom-left)', 'solid', ['dungeon', 'wall']);
t(211, 'DWALL_BR', 'Wall corner (bottom-right)', 'solid', ['dungeon', 'wall']);
t(212, 'DWALL_OTL', 'Wall outer corner (top-left)', 'solid', ['dungeon', 'wall'], { art: 'Convex corner where a wall juts into the room (L-shaped rooms).' });
t(213, 'DWALL_OTR', 'Wall outer corner (top-right)', 'solid', ['dungeon', 'wall']);
t(214, 'DWALL_OBL', 'Wall outer corner (bottom-left)', 'solid', ['dungeon', 'wall']);
t(215, 'DWALL_OBR', 'Wall outer corner (bottom-right)', 'solid', ['dungeon', 'wall']);
t(216, 'DWALL_FILL', 'Wall (solid)', 'solid', ['dungeon', 'wall'], { art: 'Solid wall mass / wall top seen from above.' });
t(217, 'PILLAR', 'Pillar', 'solid', ['dungeon', 'decor']);
t(218, 'DSTATUE', 'Statue', 'solid', ['dungeon', 'decor'], { art: 'Gargoyle/knight statue.' });
t(219, 'SPIKES', 'Spikes', 'hurt', ['dungeon'], { art: 'Metal floor spikes.' });
t(220, 'DSTAIRS_UP', 'Stairs up', 'stairs', ['dungeon'], { art: 'Steps rising (lighter at top).' });
t(221, 'DSTAIRS_DOWN', 'Stairs down', 'stairs', ['dungeon'], { art: 'Steps descending into dark.' });
t(222, 'CRACKED_WALL', 'Cracked wall', 'solid', ['dungeon', 'wall', 'secret'], { bomb: { to: 'DFLOOR' }, art: 'DWALL_FILL with a crack (bombable).' });
t(223, 'DPOT', 'Pot', 'solid', ['dungeon'], { lift: { to: 'DFLOOR', weight: 0, drops: true }, art: 'Clay pot on dungeon floor.' });
t(224, 'DBLOCK', 'Stone block', 'solid', ['dungeon'], { art: 'Immovable carved stone block.' });
t(225, 'DFLOOR_CRACKED', 'Dungeon floor (cracked)', 'floor', ['dungeon', 'ground', 'decor']);

// ---- Interior (300-329) ----
t(300, 'WOOD_FLOOR', 'Wood floor', 'floor', ['interior', 'ground']);
t(301, 'IWALL_TOP', 'House wall (top)', 'solid', ['interior', 'wall']);
t(302, 'IWALL_BOTTOM', 'House wall (bottom)', 'solid', ['interior', 'wall']);
t(303, 'IWALL_LEFT', 'House wall (left)', 'solid', ['interior', 'wall']);
t(304, 'IWALL_RIGHT', 'House wall (right)', 'solid', ['interior', 'wall']);
t(305, 'IWALL_TL', 'House wall corner (top-left)', 'solid', ['interior', 'wall']);
t(306, 'IWALL_TR', 'House wall corner (top-right)', 'solid', ['interior', 'wall']);
t(307, 'IWALL_BL', 'House wall corner (bottom-left)', 'solid', ['interior', 'wall']);
t(308, 'IWALL_BR', 'House wall corner (bottom-right)', 'solid', ['interior', 'wall']);
t(309, 'IWALL_WINDOW', 'House wall (window)', 'solid', ['interior', 'wall']);
t(310, 'TABLE', 'Table', 'solid', ['interior', 'furniture']);
t(311, 'STOOL', 'Stool', 'solid', ['interior', 'furniture']);
t(312, 'BED_TOP', 'Bed (head)', 'solid', ['interior', 'furniture']);
t(313, 'BED_BOTTOM', 'Bed (foot)', 'solid', ['interior', 'furniture']);
t(314, 'SHELF', 'Bookshelf', 'solid', ['interior', 'furniture']);
t(315, 'RUG', 'Rug', 'floor', ['interior', 'decor']);
t(316, 'FIREPLACE', 'Fireplace', 'solid', ['interior', 'furniture'], { animated: true });
t(317, 'IPOT', 'Pot', 'solid', ['interior'], { lift: { to: 'WOOD_FLOOR', weight: 0, drops: true } });
t(318, 'BARREL', 'Barrel', 'solid', ['interior', 'furniture']);
t(319, 'CRATE', 'Crate', 'solid', ['interior', 'furniture']);
t(320, 'EXIT_MAT', 'Exit mat', 'floor', ['interior'], { art: 'Doormat / doorway gap at the bottom wall (a warp sits on it).' });
t(321, 'STONE_FLOOR', 'Stone floor', 'floor', ['interior', 'cave', 'ground']);

// ---- Cave (340-349) ----
t(340, 'CAVE_FLOOR', 'Cave floor', 'floor', ['cave', 'ground']);
t(341, 'CAVE_WALL', 'Cave wall', 'solid', ['cave', 'wall']);
t(342, 'CAVE_ROCKS', 'Cave rocks', 'solid', ['cave', 'decor']);
t(343, 'CAVE_EXIT', 'Cave exit', 'floor', ['cave'], { art: 'Bright opening / light spill (a warp sits on it).' });

export const TILE_SPECS: readonly TileSpec[] = specs;

/** Tile key -> id. Use T.GRASS etc. in code; typed loosely so new keys don't break compile. */
export const T: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.key, s.id])),
);

/** Terrain ids shipped with the default assets: water, path, pit, plateau. */
export const DEFAULT_TERRAINS = [
  { id: 'water', name: 'Water', base: 'WATER', layer: 'bg' },
  { id: 'path', name: 'Dirt path', base: 'PATH', layer: 'bg' },
  { id: 'pit', name: 'Pit', base: 'PIT', layer: 'bg' },
  { id: 'plateau', name: 'Plateau / cliff', base: 'PLATEAU', layer: 'bg' },
] as const;

// ----------------------------------------------------------------------------
// Sprites
// ----------------------------------------------------------------------------

export interface AnimSpec {
  /** Number of frame references this anim must have (ignored when flipOf is set). */
  frames: number;
  fps: number;
  loop: boolean;
  /** Reuse the named anim's frames mirrored (flipX: true). */
  flipOf?: string;
}

export interface SpriteSpec {
  id: string;
  name: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  tags: string[];
  anims: Record<string, AnimSpec>;
  /** Palette-swap palettes that must exist with the same index layout as the sprite's base palette. */
  swaps?: string[];
  art?: string;
}

const a = (frames: number, fps = 8, loop = true): AnimSpec => ({ frames, fps, loop });
const flip = (of: string): AnimSpec => ({ frames: 0, fps: 0, loop: true, flipOf: of });

/** Four-direction set: <name>_down/_up/_right + _left mirrored from _right. */
function dir4(name: string, frames: number, fps = 8, loop = true): Record<string, AnimSpec> {
  return {
    [`${name}_down`]: a(frames, fps, loop),
    [`${name}_up`]: a(frames, fps, loop),
    [`${name}_right`]: a(frames, fps, loop),
    [`${name}_left`]: flip(`${name}_right`),
  };
}

const ITEM_ICON_ANIMS = [
  'sword', 'sword2', 'shield', 'bow', 'boomerang', 'boomerang2', 'hookshot', 'bombs', 'lantern',
  'boots', 'glove', 'glove2', 'flippers', 'arrows', 'rupees', 'heart', 'heartContainer', 'heartPiece',
  'magic', 'fairy', 'smallKey', 'bigKey', 'map', 'compass', 'crystal',
] as const;

export const SPRITE_SPECS: readonly SpriteSpec[] = [
  // ---------------------------------------------------------------- hero
  {
    id: 'hero', name: 'Hero', w: 16, h: 24, ox: 8, oy: 18, tags: ['hero'],
    anims: {
      ...dir4('idle', 1), ...dir4('walk', 4, 12), ...dir4('attack', 3, 20, false), ...dir4('push', 2, 6),
      ...dir4('lift', 1), ...dir4('carry', 2, 8), ...dir4('swim', 2, 4), ...dir4('use', 1), ...dir4('hurt', 1),
      item_get: a(1), fall: a(3, 8, false), die: a(2, 3, false),
    },
    art: 'Original elf-like adventurer: green cap & tunic, brown belt/boots, skin face, shield on left arm when facing down. Feet on the bottom row; the 12x12 hitbox covers the bottom 12 rows. attack_* frames show the arm swinging (the blade itself is fx.sword, drawn by code). lift/carry = arms raised overhead. fall = shrinking into a pit. die = collapsed.',
  },
  {
    id: 'fx.sword', name: 'Sword blade', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'],
    anims: { n: a(1), ne: a(1), e: a(1), se: a(1), s: a(1), sw: a(1), w: a(1), nw: a(1) },
    swaps: ['pal.sword.2'],
    art: 'Sword blade + hilt pointing in 8 compass directions, hilt near the frame centre, blade extending toward the named direction. Level-2 sword uses the pal.sword.2 swap (golden/blue glow).',
  },
  // ---------------------------------------------------------------- fx
  { id: 'fx.poof', name: 'Poof', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(4, 14, false) }, art: 'Enemy death smoke puff expanding & fading.' },
  { id: 'fx.hit', name: 'Hit spark', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(3, 20, false) } },
  { id: 'fx.splash', name: 'Splash', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(3, 12, false) } },
  { id: 'fx.leaves', name: 'Leaves', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(4, 12, false) }, art: 'Bush/grass clippings flying apart.' },
  { id: 'fx.shatter', name: 'Shatter', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(4, 12, false) }, art: 'Pot / rock breaking into shards.' },
  { id: 'fx.explosion', name: 'Explosion', w: 32, h: 32, ox: 16, oy: 16, tags: ['fx'], anims: { play: a(5, 14, false) } },
  { id: 'fx.sparkle', name: 'Sparkle', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(3, 12, false) }, art: 'Star twinkle (sword charge, item glint, secret).' },
  { id: 'fx.dust', name: 'Dust', w: 16, h: 16, ox: 8, oy: 8, tags: ['fx'], anims: { play: a(3, 12, false) } },
  { id: 'fx.flame', name: 'Flame', w: 16, h: 16, ox: 8, oy: 12, tags: ['fx'], anims: { play: a(3, 10, true) } },
  // ---------------------------------------------------------------- projectiles
  { id: 'proj.arrow', name: 'Arrow', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { up: a(1), down: a(1), right: a(1), left: flip('right') } },
  { id: 'proj.rock', name: 'Rock', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { fly: a(2, 12) }, art: 'Small 6x6 spat rock.' },
  { id: 'proj.spear', name: 'Spear', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { up: a(1), down: a(1), right: a(1), left: flip('right') } },
  { id: 'proj.boomerang', name: 'Boomerang', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { spin: a(4, 20) }, swaps: ['pal.boomerang.2'] },
  {
    id: 'proj.hookshot', name: 'Grapple Claw', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'],
    anims: { head_up: a(1), head_down: a(1), head_right: a(1), head_left: flip('head_right'), chain: a(1) },
    art: 'Claw head per direction; chain = a single small 4x4 link centred.',
  },
  { id: 'proj.fireball', name: 'Fireball', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { fly: a(2, 12) } },
  { id: 'proj.beam', name: 'Beam', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { fly: a(2, 20) }, art: 'Small glowing laser bolt (eye statue).' },
  { id: 'proj.bone', name: 'Bone', w: 16, h: 16, ox: 8, oy: 8, tags: ['projectile'], anims: { spin: a(4, 16) } },
  { id: 'obj.bomb', name: 'Bomb', w: 16, h: 16, ox: 8, oy: 10, tags: ['object'], anims: { idle: a(1), fuse: a(2, 10) }, art: 'Round blue bomb with a fuse; fuse frames flash.' },
  // ---------------------------------------------------------------- pickups & items
  {
    id: 'pickup', name: 'Pickups', w: 16, h: 16, ox: 8, oy: 8, tags: ['pickup'],
    anims: {
      rupee_green: a(3, 6), rupee_blue: a(3, 6), rupee_red: a(3, 6), heart: a(1), smallKey: a(1), bigKey: a(1),
      bombs: a(1), arrows: a(1), magic_small: a(1), magic_large: a(1), heartContainer: a(1), heartPiece: a(1),
      fairy: a(2, 8), crystal: a(4, 8),
    },
    art: 'Floor pickups, drawn centred. Gems (the currency) glint.',
  },
  {
    id: 'item', name: 'Item icons', w: 16, h: 16, ox: 8, oy: 8, tags: ['item'],
    anims: Object.fromEntries(ITEM_ICON_ANIMS.map((n) => [n, a(1)])),
    art: 'Inventory / item-get icons (held over the hero head on item get).',
  },
  // ---------------------------------------------------------------- objects
  { id: 'obj.chest', name: 'Chest', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { closed: a(1), open: a(1) } },
  { id: 'obj.bigChest', name: 'Big chest', w: 32, h: 24, ox: 16, oy: 14, tags: ['object'], anims: { closed: a(1), open: a(1) } },
  { id: 'obj.block', name: 'Push block', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { idle: a(1), heavy: a(1) } },
  { id: 'obj.switch', name: 'Floor switch', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { up: a(1), down: a(1) } },
  { id: 'obj.crystalSwitch', name: 'Crystal switch', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { red: a(2, 4), blue: a(2, 4) } },
  { id: 'obj.peg', name: 'Colour peg', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { red_up: a(1), red_down: a(1), blue_up: a(1), blue_down: a(1) } },
  { id: 'obj.torch', name: 'Torch', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { unlit: a(1), lit: a(3, 10) }, art: 'Stone brazier; lit frames have flickering flame.' },
  { id: 'obj.pot', name: 'Pot', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { idle: a(1) } },
  { id: 'obj.sign', name: 'Sign', w: 16, h: 16, ox: 8, oy: 8, tags: ['object'], anims: { idle: a(1) } },
  {
    id: 'obj.doorNS', name: 'Door (N/S wall)', w: 32, h: 16, ox: 16, oy: 8, tags: ['object'],
    anims: {
      open_up: a(1), open_down: a(1), locked_up: a(1), locked_down: a(1), bigKey_up: a(1), bigKey_down: a(1),
      shutter_up: a(1), shutter_down: a(1), cracked_up: a(1), cracked_down: a(1), bombed_up: a(1), bombed_down: a(1),
    },
    art: 'Doorway set into a room wall, 2 tiles wide. _up = on the TOP wall (opening faces down into the room). open = empty frame/arch; locked = keyhole door; bigKey = ornate big-key door; shutter = iron bars; cracked = wall with crack (bombable, looks like wall); bombed = rubble-edged opening.',
  },
  {
    id: 'obj.doorEW', name: 'Door (E/W wall)', w: 16, h: 32, ox: 8, oy: 16, tags: ['object'],
    anims: {
      open_left: a(1), open_right: a(1), locked_left: a(1), locked_right: a(1), bigKey_left: a(1), bigKey_right: a(1),
      shutter_left: a(1), shutter_right: a(1), cracked_left: a(1), cracked_right: a(1), bombed_left: a(1), bombed_right: a(1),
    },
    art: 'Same as obj.doorNS for side walls. _left = on the LEFT wall.',
  },
  // ---------------------------------------------------------------- enemies
  {
    id: 'enemy.soldier', name: 'Soldier', w: 16, h: 24, ox: 8, oy: 18, tags: ['enemy'],
    anims: { ...dir4('walk', 2, 6), ...dir4('attack', 1) }, swaps: ['pal.soldier.blue', 'pal.soldier.red'],
    art: 'Helmeted castle soldier with a sword; base palette green armour.',
  },
  {
    id: 'enemy.archer', name: 'Archer', w: 16, h: 24, ox: 8, oy: 18, tags: ['enemy'],
    anims: { ...dir4('walk', 2, 6), ...dir4('shoot', 1) }, swaps: ['pal.archer.blue'],
    art: 'Soldier variant with a bow.',
  },
  {
    id: 'enemy.spitter', name: 'Rock spitter', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'],
    anims: dir4('walk', 2, 6), swaps: ['pal.spitter.blue'],
    art: 'Round octopus-like creature with a snout; base palette red.',
  },
  { id: 'enemy.bat', name: 'Bat', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: { fly: a(2, 10), rest: a(1) } },
  { id: 'enemy.skeleton', name: 'Skeleton', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: { walk: a(2, 6), jump: a(1) } },
  {
    id: 'enemy.slime', name: 'Slime', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'],
    anims: { idle: a(2, 4), hop: a(1), small_idle: a(2, 6), small_hop: a(1) }, swaps: ['pal.slime.red', 'pal.slime.blue'],
    art: 'Gelatinous blob; small_* frames are a ~8px version centred low in the frame. Base palette green.',
  },
  { id: 'enemy.goblin', name: 'Spear goblin', w: 16, h: 24, ox: 8, oy: 18, tags: ['enemy'], anims: { ...dir4('walk', 2, 6), ...dir4('throw', 1) }, art: 'Pig-snouted brute with a spear.' },
  { id: 'enemy.beetle', name: 'Shell beetle', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: { walk: a(2, 8) }, art: 'Dome-shelled beetle (hard hat).' },
  {
    id: 'enemy.eye', name: 'Eye statue', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'],
    anims: { n: a(1), ne: a(1), e: a(1), se: a(1), s: a(1), sw: a(1), w: a(1), nw: a(1) },
    art: 'Stone pillar with a single glowing eye; anim name = where the eye looks.',
  },
  { id: 'enemy.snake', name: 'Snake', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: dir4('walk', 2, 8) },
  { id: 'enemy.bladeTrap', name: 'Blade trap', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: { idle: a(1) }, art: 'Spiked metal block.' },
  { id: 'enemy.ghost', name: 'Ghost', w: 16, h: 16, ox: 8, oy: 8, tags: ['enemy'], anims: { float: a(2, 4) } },
  // ---------------------------------------------------------------- bosses
  {
    id: 'boss.worm', name: 'Giant worm', w: 32, h: 32, ox: 16, oy: 16, tags: ['boss'],
    anims: { head: a(2, 8), body: a(1), tail: a(2, 10) },
    art: 'Segmented armoured worm. head = large (~28px) with mandibles; body = ~20px segment; tail = ~14px glowing weak-point segment (frames flash).',
  },
  {
    id: 'boss.knight', name: 'Iron knight', w: 32, h: 32, ox: 16, oy: 22, tags: ['boss'],
    anims: { ...dir4('walk', 2, 6), charge: a(2, 12), stun: a(2, 6), ...dir4('attack', 1) },
    art: 'Huge armoured knight with a shield and flail. stun = dazed, stars over head.',
  },
  // ---------------------------------------------------------------- npcs
  ...(['villager', 'elder', 'child', 'guard', 'merchant', 'sage'] as const).map((n): SpriteSpec => ({
    id: `npc.${n}`, name: n[0]!.toUpperCase() + n.slice(1), w: 16, h: 24, ox: 8, oy: 18, tags: ['npc'],
    anims: { ...dir4('idle', 1), ...dir4('walk', 2, 6) },
  })),
  // ---------------------------------------------------------------- hud / editor
  {
    id: 'hud', name: 'HUD icons', w: 8, h: 8, ox: 0, oy: 0, tags: ['hud'],
    anims: { heart_full: a(1), heart_half: a(1), heart_empty: a(1), rupee: a(1), bomb: a(1), arrow: a(1), key: a(1) },
  },
  {
    id: 'editor.icons', name: 'Editor marker icons', w: 16, h: 16, ox: 8, oy: 8, tags: ['editor'],
    anims: { warp: a(1), region: a(1), start: a(1), unknown: a(1) },
    art: 'Bold, readable editor-only glyphs: warp = swirl, region = dashed box, start = flag, unknown = "?".',
  },
];

export function spriteSpec(id: string): SpriteSpec | undefined {
  return SPRITE_SPECS.find((s) => s.id === id);
}

/** Variant name -> palette id (null = the sprite's base palette). */
export const VARIANT_PALETTES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  'enemy.soldier': { green: null, blue: 'pal.soldier.blue', red: 'pal.soldier.red' },
  'enemy.archer': { green: null, blue: 'pal.archer.blue' },
  'enemy.spitter': { red: null, blue: 'pal.spitter.blue' },
  'enemy.slime': { green: null, red: 'pal.slime.red', blue: 'pal.slime.blue' },
  'fx.sword': { '1': null, '2': 'pal.sword.2' },
  'proj.boomerang': { '1': null, '2': 'pal.boomerang.2' },
};

// ----------------------------------------------------------------------------
// Items
// ----------------------------------------------------------------------------

export type ItemKind = 'weapon' | 'equip' | 'passive' | 'ammo' | 'currency' | 'health' | 'dungeon' | 'prize';

export interface ItemInfo {
  id: ItemId;
  name: string;
  kind: ItemKind;
  description: string;
  /** Anim name in the 'item' sprite. Level-2 variants use `icon2`. */
  icon: string;
  icon2?: string;
  maxLevel: number;
}

export const ITEM_INFO: Readonly<Record<ItemId, ItemInfo>> = {
  sword: { id: 'sword', name: 'Sword', kind: 'weapon', description: 'Swing with the sword button. Hold to charge a spin attack.', icon: 'sword', icon2: 'sword2', maxLevel: 2 },
  shield: { id: 'shield', name: 'Shield', kind: 'passive', description: 'Blocks small projectiles from the front.', icon: 'shield', maxLevel: 1 },
  bow: { id: 'bow', name: 'Bow', kind: 'equip', description: 'Fires arrows. Needs arrows.', icon: 'bow', maxLevel: 1 },
  boomerang: { id: 'boomerang', name: 'Boomerang', kind: 'equip', description: 'Stuns enemies and fetches items.', icon: 'boomerang', icon2: 'boomerang2', maxLevel: 2 },
  hookshot: { id: 'hookshot', name: 'Grapple Claw', kind: 'equip', description: 'Grapples to chests, blocks and posts; stuns enemies.', icon: 'hookshot', maxLevel: 1 },
  bombs: { id: 'bombs', name: 'Bombs', kind: 'equip', description: 'Blast cracked walls and enemies.', icon: 'bombs', maxLevel: 1 },
  lantern: { id: 'lantern', name: 'Lantern', kind: 'equip', description: 'Lights dark rooms and torches. Uses magic.', icon: 'lantern', maxLevel: 1 },
  boots: { id: 'boots', name: 'Dash Boots', kind: 'passive', description: 'Hold the action button to dash.', icon: 'boots', maxLevel: 1 },
  glove: { id: 'glove', name: 'Stone Gauntlet', kind: 'passive', description: 'Lift rocks (level 2: heavy rocks).', icon: 'glove', icon2: 'glove2', maxLevel: 2 },
  flippers: { id: 'flippers', name: 'Flippers', kind: 'passive', description: 'Swim in deep water.', icon: 'flippers', maxLevel: 1 },
  arrows: { id: 'arrows', name: 'Arrows', kind: 'ammo', description: 'Ammunition for the bow.', icon: 'arrows', maxLevel: 1 },
  rupees: { id: 'rupees', name: 'Gems', kind: 'currency', description: 'Money: spend gems in shops.', icon: 'rupees', maxLevel: 1 },
  heart: { id: 'heart', name: 'Heart', kind: 'health', description: 'Restores one heart.', icon: 'heart', maxLevel: 1 },
  heartContainer: { id: 'heartContainer', name: 'Heart Vessel', kind: 'health', description: 'Adds one heart to your life meter.', icon: 'heartContainer', maxLevel: 1 },
  heartPiece: { id: 'heartPiece', name: 'Heart Shard', kind: 'health', description: 'Collect four for a new heart.', icon: 'heartPiece', maxLevel: 1 },
  magic: { id: 'magic', name: 'Magic Jar', kind: 'health', description: 'Refills magic.', icon: 'magic', maxLevel: 1 },
  fairy: { id: 'fairy', name: 'Fairy', kind: 'health', description: 'Restores seven hearts.', icon: 'fairy', maxLevel: 1 },
  smallKey: { id: 'smallKey', name: 'Small Key', kind: 'dungeon', description: 'Opens one locked door in this dungeon.', icon: 'smallKey', maxLevel: 1 },
  bigKey: { id: 'bigKey', name: 'Big Key', kind: 'dungeon', description: 'Opens the big chest and the boss door.', icon: 'bigKey', maxLevel: 1 },
  map: { id: 'map', name: 'Dungeon Map', kind: 'dungeon', description: 'Shows this dungeon\'s rooms.', icon: 'map', maxLevel: 1 },
  compass: { id: 'compass', name: 'Compass', kind: 'dungeon', description: 'Shows chests and the boss on the map.', icon: 'compass', maxLevel: 1 },
  crystal: { id: 'crystal', name: 'Crystal', kind: 'prize', description: 'The dungeon\'s treasure.', icon: 'crystal', maxLevel: 1 },
};

/** Loot kinds used by enemy/pot `drop` props and dropLoot(). */
export const DROP_KINDS = ['random', 'none', 'smallKey', 'heart', 'rupee', 'rupee5', 'rupee20', 'bombs', 'arrows', 'magic'] as const;
export type DropKind = (typeof DROP_KINDS)[number];

/** Sprites NPCs may use. */
export const NPC_SPRITES = ['npc.villager', 'npc.elder', 'npc.child', 'npc.guard', 'npc.merchant', 'npc.sage'] as const;
