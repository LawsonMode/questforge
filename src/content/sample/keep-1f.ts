// Hollow Keep, ground floor (floor 0). Route: Entrance Hall -> Guard Hall
// (clear the soldiers, the north shutter opens) -> Beetle Pits (Lantern) ->
// West Wing (Map; beat everything and a small key chest appears) -> back to the
// Guard Hall's locked east door -> Block Room (push the plug onto the switch)
// -> Blade Hall (spikes, blade traps, Compass) -> stairs up.
//
//   gx:        0              1                2
//   gy 0   West Wing      Beetle Pits      Blade Hall (stairs)
//   gy 1                  Guard Hall       Block Room
//   gy 2                  Entrance Hall
import type { Room, Terrain } from '../../core/types';
import {
  block, centred, chest, door, enemy, floorSwitch, pot, px, sign, torch, trigger, warp,
} from './entities';
import { D } from './dialogues';
import { KEEP_EXIT, LINK, STAIRS, STAIRS_LANDING, keepRoom } from './keep-kit';
import { KP } from './ids';

const ENTRANCE = [
  '#######DD#######',
  '#U....,cc,....U#',
  '#.....,cc,.....#',
  '#...I.,cc,.I...#',
  '#.....,cc,.....#',
  '#.....,cc,.....#',
  '#.....,cc,.....#',
  '#.....,cc,.....#',
  '#.....,cc,.....#',
  '#...I.,cc,.I...#',
  '#.....,cc,.....#',
  '#PP...,cc,...PP#',
  '#P....,cc,....P#',
  '#######DD#######',
];

const GUARD_HALL = [
  '#######DD#######',
  '#..............#',
  '#.UU........UU.#',
  '#..,,,,,,,,,,..#',
  '#..,.I....I.,..#',
  '#..,........,..#',
  '#..,...::...,..D',
  '#..,...::...,..D',
  '#..,.I....I.,..#',
  '#..,........,..#',
  '#..,,,,,,,,,,..#',
  '#.PP........PP.#',
  '#..............#',
  '#######DD#######',
];

const BEETLE_PITS = [
  '################',
  '#..............#',
  '#.OOOO.::.OOOO.#',
  '#.OOOO....OOOO.#',
  '#.OOOO....OOOO.#',
  '#..............#',
  'D..............#',
  'D..............#',
  '#..............#',
  '#.OOOO....OOOO.#',
  '#.OOOO....OOOO.#',
  '#.OOOO....OOOO.#',
  '#..............#',
  '#######DD#######',
];

const WEST_WING = [
  '################',
  '#....#....#....#',
  '#.U..#.::.#..U.#',
  '#......,,......#',
  '#..x...,,......#',
  '#....I,,,,I....#',
  '#.....,,,,,,,,,D',
  '#.....,,,,,,,,,D',
  '#....I,,,,I..x.#',
  '#......,,......#',
  '#.x....,,......#',
  '#.P..#....#..P.#',
  '#....#....#....#',
  '################',
];

const BLOCK_ROOM = [
  '#######DD#######',
  '#......,,......#',
  '#......,,......#',
  '#......,,..B...#',
  '#......,,.B:B..#',
  '#......,,.B.B..#',
  'D,,,,,,,,.B.B..#',
  'D,,,,,,,,......#',
  '#..x...........#',
  '#..............#',
  '#.........x....#',
  '#..............#',
  '#P............P#',
  '################',
];

const BLADE_HALL = [
  '################',
  '################',
  '################',
  '#UuU.#.::.#..PP#',
  '#....#....#....#',
  '#..............#',
  '#.^^^^^..^^^^^.#',
  '#.^^^^^..^^^^^.#',
  '#..............#',
  '#..............#',
  '#.^^^^^..^^^^^.#',
  '#..............#',
  '#..............#',
  '#######DD#######',
];

function entranceHall(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.entrance, 'Entrance Hall', 1, 2, 0, ENTRANCE);
  room.entities.push(
    door('kp_e1_door_n', 'up', 'open', { link: LINK.entranceGuard }),
    door('kp_e1_door_s', 'down', 'open'),
    // The way out: the dungeon-complete flow also looks for this warp.
    warp('kp_e1_exit', 8 * 16, px(13), KEEP_EXIT, { w: 2, sound: 'stairs' }),
    torch('kp_e1_torch_1', 5, 2, true),
    torch('kp_e1_torch_2', 10, 2, true),
    sign('kp_e1_sign', 5, 11, D.keepWelcome),
  );
  return room;
}

function guardHall(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.guardHall, 'Guard Hall', 1, 1, 0, GUARD_HALL);
  room.entities.push(
    door('kp_g1_door_s', 'down', 'open', { link: LINK.entranceGuard }),
    door('kp_g1_door_n', 'up', 'shutter', { link: LINK.guardPits, opensWhen: 'enemiesCleared' }),
    door('kp_g1_door_e', 'right', 'locked', { link: LINK.keyA }),
    enemy('kp_g1_soldier_1', 'enemy.soldier', 4, 6, { variant: 'green', behavior: 'patrol' }),
    enemy('kp_g1_soldier_2', 'enemy.soldier', 11, 9, { variant: 'green', behavior: 'patrol' }),
    enemy('kp_g1_soldier_3', 'enemy.soldier', 8, 3, { variant: 'green', behavior: 'guard' }),
  );
  return room;
}

function beetlePits(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.pits, 'Beetle Pits', 1, 0, 0, BEETLE_PITS);
  room.entities.push(
    door('kp_p1_door_s', 'down', 'open', { link: LINK.guardPits }),
    door('kp_p1_door_w', 'left', 'open', { link: LINK.pitsWest }),
    centred(chest('kp_p1_lantern', 7, 2, 'lantern', 1)),
    enemy('kp_p1_beetle_1', 'enemy.beetle', 7, 5),
    enemy('kp_p1_beetle_2', 'enemy.beetle', 8, 9),
    enemy('kp_p1_bat', 'enemy.bat', 12, 6),
  );
  return room;
}

function westWing(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.westWing, 'West Wing', 0, 0, 0, WEST_WING);
  room.entities.push(
    door('kp_w1_door_e', 'right', 'open', { link: LINK.pitsWest }),
    chest('kp_w1_map', 2, 4, 'map', 1),
    centred(chest('kp_w1_key', 7, 2, 'smallKey', 1, true)),
    enemy('kp_w1_skeleton_1', 'enemy.skeleton', 3, 9),
    enemy('kp_w1_skeleton_2', 'enemy.skeleton', 12, 9),
    enemy('kp_w1_slime', 'enemy.slime', 8, 5, { variant: 'green', size: 'big', split: true }),
  );
  room.triggers.push(trigger('t_kp_w1_key', 'Key chest appears', 'auto', [{ kind: 'enemiesCleared' }], [
    { kind: 'showEntity', target: 'kp_w1_key' },
    { kind: 'secret' },
  ], { once: true }));
  return room;
}

function blockRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.blockRoom, 'Block Room', 2, 1, 0, BLOCK_ROOM);
  room.entities.push(
    door('kp_r4_door_w', 'left', 'locked', { link: LINK.keyA }),
    door('kp_r4_door_n', 'up', 'shutter', { link: LINK.blockBlade, opensWhen: 'trigger' }),
    floorSwitch('kp_r4_switch', 11, 4, 'hold'),
    // The plug fills the chute's mouth; the loose block below it slides aside (left, once)
    // first, so it can never be shoved into the chute behind the plug.
    block('kp_r4_plug', 11, 6, 'free', 'up'),
    block('kp_r4_block', 11, 7, 'once', 'left'),
    sign('kp_r4_sign', 5, 2, D.keepBlocks),
    enemy('kp_r4_bat', 'enemy.bat', 4, 9),
  );
  room.triggers.push(trigger('t_kp_r4_switch', 'Block on switch opens north shutter', 'auto',
    [{ kind: 'switch', target: 'kp_r4_switch', on: true }],
    [{ kind: 'openDoor', target: 'kp_r4_door_n' }, { kind: 'secret' }], { once: true }));
  return room;
}

function bladeHall(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.bladeHall, 'Blade Hall', 2, 0, 0, BLADE_HALL);
  room.entities.push(
    door('kp_r5_door_s', 'down', 'open', { link: LINK.blockBlade }),
    warp('kp_r5_stairs', px(STAIRS.tx), px(STAIRS.ty), STAIRS_LANDING.up, { sound: 'stairs' }),
    centred(chest('kp_r5_compass', 7, 3, 'compass', 1)),
    sign('kp_r5_sign', 4, 3, D.keepDark),
    enemy('kp_r5_blade_1', 'enemy.bladeTrap', 1, 9, { axis: 'horizontal', range: 13 }),
    enemy('kp_r5_blade_2', 'enemy.bladeTrap', 14, 8, { axis: 'horizontal', range: 13 }),
    enemy('kp_r5_blade_3', 'enemy.bladeTrap', 14, 5, { axis: 'horizontal', range: 13 }),
    pot('kp_r5_pot', 12, 3, 'magic'),
  );
  return room;
}

/** Floor 0 rooms of the keep. */
export function keepGroundFloor(terrains: readonly Terrain[]): Room[] {
  return [
    entranceHall(terrains), guardHall(terrains), beetlePits(terrains),
    westWing(terrains), blockRoom(terrains), bladeHall(terrains),
  ];
}
