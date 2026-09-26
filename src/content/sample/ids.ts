// Stable ids shared across the sample adventure's builders: worlds, rooms,
// door links and designer flags. Warps, triggers and tests refer to these.

/** World ids. */
export const W = {
  overworld: 'ellendor',
  interiors: 'ellendor_homes',
  keep: 'hollow_keep',
} as const;

/** Overworld rooms (3x3 screens; the village is 2x1). */
export const OW = {
  cliffs: 'ow_cliffs',
  keepGate: 'ow_keep_gate',
  deepwood: 'ow_deepwood',
  meadow: 'ow_meadow',
  crossroads: 'ow_crossroads',
  whisperwood: 'ow_whisperwood',
  village: 'ow_village',
  lake: 'ow_lake',
} as const;

/** Interior rooms (houses, shop, cave). */
export const IN = {
  heroHouse: 'in_hero_house',
  elderHouse: 'in_elder_house',
  cottage: 'in_cottage',
  shop: 'in_shop',
  cave: 'in_cave',
} as const;

/** Hollow Keep rooms: floor 0 (1F) and floor 1 (2F). */
export const KP = {
  entrance: 'kp_entrance',
  guardHall: 'kp_guard_hall',
  pits: 'kp_beetle_pits',
  westWing: 'kp_west_wing',
  blockRoom: 'kp_block_room',
  bladeHall: 'kp_blade_hall',
  darkHall: 'kp_dark_hall',
  torchRoom: 'kp_torch_room',
  eyeGallery: 'kp_eye_gallery',
  bigChest: 'kp_big_chest',
  pegRoom: 'kp_peg_room',
  boss: 'kp_boss',
  pedestal: 'kp_pedestal',
} as const;

/** The cracked rock wall in Stonecrag Cliffs that hides the cave (tile in OW.cliffs). */
export const CAVE_MOUTH = { tx: 5, ty: 2 } as const;

/** The Hollow Keep's entrance arch in the Keep Gate screen (left tile of the 2-tile doorway). */
export const KEEP_DOOR = { tx: 7, ty: 3 } as const;

/** Designer flags (listed in Project.flags). */
export const FLAG = {
  gotSword: 'gotSword',
  questDone: 'questDone',
} as const;

/** Flag set by the engine when the Hollow Keep's crystal is collected. */
export const CRYSTAL_FLAG = `crystal:${W.keep}`;
