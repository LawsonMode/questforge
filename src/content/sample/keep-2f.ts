// Hollow Keep, upper floor (floor 1). Route: Dark Hall (pit maze lit by a few
// braziers; falling drops you back to the Blade Hall) -> Torch Room (light both
// torches: a small key appears) -> Eye Gallery (Big Key) -> Big Chest Room
// (Bow) -> Peg Room (shoot the crystal switch on its island to lower the red
// pegs) -> boss door -> the Giant Worm -> the Sun Crystal on its pedestal.
//
//   gx:        0              1                2
//   gy 0   Peg Room       Big Chest Room   Dark Hall (stairs)
//   gy 1   Boss           Eye Gallery      Torch Room
//   gy 2   Pedestal
import type { Room, Terrain } from '../../core/types';
import {
  bigChest, centred, chest, door, ent, enemy, peg, pot, px, sign, torch, trigger, warp,
} from './entities';
import { D } from './dialogues';
import { LINK, PIT_LANDING, STAIRS, STAIRS_LANDING, keepRoom } from './keep-kit';
import { KP } from './ids';

// Pits come in 2x2 blocks (the pit border art needs every pit at least two tiles thick).
const DARK_HALL = [
  '################',
  '################',
  '################',
  '#UnU.OOOOOO..OO#',
  '#....OOOOOO..OO#',
  '#OO..OO..OOOOOO#',
  '#OO..OO..OOOOOO#',
  '#OO..........OO#',
  '#OO..........OO#',
  '#OOOOOOOOOO..OO#',
  '#OOOOOOOOOO..OO#',
  '#OO..OO......OO#',
  '#OO..OO......OO#',
  '#######DD#######',
];

const TORCH_ROOM = [
  '#######DD#######',
  '#..............#',
  '#.U..........U.#',
  '#..,,,,,,,,,,..#',
  '#..,:.......,..#',
  '#..,........,..#',
  'D..,........,..#',
  'D..,........,..#',
  '#..,........,..#',
  '#..,.......:,..#',
  '#..,,,,,,,,,,..#',
  '#.P..........P.#',
  '#..............#',
  '################',
];

const EYE_GALLERY = [
  '#######DD#######',
  '#......,,......#',
  '#..I..I,,I..I..#',
  '#......,,......#',
  '#......,,......#',
  '#::....,,......#',
  '#::,,,,,,,,,,,,D',
  '#::,,,,,,,,,,,,D',
  '#::............#',
  '#.......x......#',
  '#...x..........#',
  '#..I..I..I..I..#',
  '#..........x...#',
  '################',
];

const BIG_CHEST_ROOM = [
  '################',
  '#U............U#',
  '#..::::::::::..#',
  '#..:........:..#',
  '#..:........:..#',
  '#..:........:..#',
  'D..:...cc...:..#',
  'D..:...cc...:..#',
  '#..:...cc...:..#',
  '#..::::cc::::..#',
  '#......cc......#',
  '#......cc......#',
  '#PP....cc....PP#',
  '#######DD#######',
];

const PEG_ROOM = [
  '################',
  '#..............#',
  '#..OOOOOOOOOO..#',
  '#..OOOOOOOOOO..#',
  '#..OOOOOOOOOO..#',
  '#..OOOO..OOOO..#',
  '#..OOOO..OOOO..D',
  '#..OOOOOOOOOO..D',
  '#..OOOOOOOOOO..#',
  '#..OOOOOOOOOO..#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#######DD#######',
];

const BOSS_ROOM = [
  '#######DD#######',
  '#I............I#',
  '#..............#',
  '#..::::::::::..#',
  '#..:....x...:..#',
  '#..:.x......:..#',
  '#..:.....x..:..#',
  '#..:..x.....:..#',
  '#..:......x.:..#',
  '#..:..x.....:..#',
  '#..::::::::::..#',
  '#..............#',
  '#I............I#',
  '#######DD#######',
];

const PEDESTAL = [
  '#######DD#######',
  '#..............#',
  '#.U..........U.#',
  '#..............#',
  '#....::::::....#',
  '#....:....:....#',
  '#....:.cc.:....#',
  '#....:.cc.:....#',
  '#....:....:....#',
  '#....::::::....#',
  '#..............#',
  '#.U..........U.#',
  '#..............#',
  '################',
];

function darkHall(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.darkHall, 'Dark Hall', 2, 0, 1, DARK_HALL);
  room.dark = true;
  // Falling in drops the hero into the Blade Hall below, beside the stairs.
  room.pitTarget = { ...PIT_LANDING };
  room.entities.push(
    warp('kp_r7_stairs', px(STAIRS.tx), px(STAIRS.ty), STAIRS_LANDING.down, { sound: 'stairs' }),
    door('kp_r7_door_s', 'down', 'open', { link: LINK.darkTorch }),
    // Braziers centred on 2x2 floor: two islands out in the pits, one on a nub of the walkway.
    centred(torch('kp_r7_brazier_1', 11, 3, true), true),
    centred(torch('kp_r7_brazier_2', 3, 11, true), true),
    centred(torch('kp_r7_brazier_3', 7, 5, true), true),
  );
  return room;
}

function torchRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.torchRoom, 'Torch Room', 2, 1, 1, TORCH_ROOM);
  room.entities.push(
    door('kp_r8_door_n', 'up', 'open', { link: LINK.darkTorch }),
    door('kp_r8_door_w', 'left', 'locked', { link: LINK.keyB }),
    torch('kp_r8_torch_1', 4, 4),
    torch('kp_r8_torch_2', 11, 9),
    chest('kp_r8_key', 8, 6, 'smallKey', 1, true),
    sign('kp_r8_sign', 6, 2, D.keepTorches),
    enemy('kp_r8_skeleton', 'enemy.skeleton', 6, 10),
    enemy('kp_r8_ghost', 'enemy.ghost', 11, 3),
  );
  room.triggers.push(trigger('t_kp_r8_torches', 'Torches lit: key chest appears', 'auto', [{ kind: 'torchesLit' }], [
    { kind: 'showEntity', target: 'kp_r8_key' },
    { kind: 'secret' },
  ], { once: true }));
  return room;
}

function eyeGallery(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.eyeGallery, 'Eye Gallery', 1, 1, 1, EYE_GALLERY);
  room.entities.push(
    door('kp_r9_door_e', 'right', 'locked', { link: LINK.keyB }),
    door('kp_r9_door_n', 'up', 'open', { link: LINK.eyeChest }),
    chest('kp_r9_big_key', 1, 6, 'bigKey', 1),
    enemy('kp_r9_eye_1', 'enemy.eye', 5, 5, { cooldown: 2.5 }),
    enemy('kp_r9_eye_2', 'enemy.eye', 10, 8, { cooldown: 2.5 }),
    enemy('kp_r9_skeleton', 'enemy.skeleton', 8, 11),
    sign('kp_r9_sign', 13, 9, D.keepEyes),
  );
  return room;
}

function bigChestRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.bigChest, 'Big Chest Room', 1, 0, 1, BIG_CHEST_ROOM);
  room.entities.push(
    door('kp_r10_door_s', 'down', 'open', { link: LINK.eyeChest }),
    door('kp_r10_door_w', 'left', 'open', { link: LINK.chestPegs }),
    bigChest('kp_r10_bow', 7, 5, 'bow', 1),
    // Pots respawn on every visit, so arrows can never run out for good.
    pot('kp_r10_pot_1', 3, 11, 'arrows'),
    pot('kp_r10_pot_2', 12, 11, 'arrows'),
    enemy('kp_r10_goblin', 'enemy.goblin', 5, 7, { facing: 'right' }),
  );
  return room;
}

function pegRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.pegRoom, 'Peg Room', 0, 0, 1, PEG_ROOM);
  room.entities.push(
    door('kp_r11_door_e', 'right', 'open', { link: LINK.chestPegs }),
    door('kp_r11_door_s', 'down', 'bigKey', { link: LINK.bossDoor }),
    // Out of sword reach on its island: an arrow (or a well-aimed pot) toggles it.
    ent('kp_r11_crystal', 'obj.crystalSwitch', 8 * 16, 6 * 16),
    ...[6, 7, 8, 9].map((tx) => peg(`kp_r11_red_${tx}`, tx, 12, 'red')),
    // Blue pegs close one point of the ring-shaped walkway: never a trap.
    peg('kp_r11_blue_1', 1, 5, 'blue'),
    peg('kp_r11_blue_2', 2, 5, 'blue'),
    chest('kp_r11_chest', 1, 3, 'rupees', 20),
    pot('kp_r11_pot', 14, 12, 'arrows'),
    // Pots refill on every visit: a full heart meter for the worm is never far away.
    pot('kp_r11_heart_pot', 1, 12, 'heart'),
    pot('kp_r11_heart_pot_2', 3, 12, 'heart'),
    pot('kp_r11_heart_pot_3', 12, 12, 'heart'),
    sign('kp_r11_sign', 13, 4, D.keepPegs),
    sign('kp_r11_boss_sign', 11, 11, D.keepBoss),
  );
  return room;
}

function bossRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.boss, 'Worm\'s Lair', 0, 1, 1, BOSS_ROOM);
  room.music = 'boss';
  room.entities.push(
    door('kp_boss_door_n', 'up', 'shutter', { opensWhen: 'enemiesCleared', closeOnEnter: true }),
    door('kp_boss_door_s', 'down', 'shutter', { link: LINK.bossOut, opensWhen: 'enemiesCleared' }),
    // Starts at the far end so it never ambushes the hero in the doorway.
    ent('kp_boss_worm', 'boss.worm', 8 * 16, px(10), { hp: 10, segments: 4, dropHeart: true, hidden: false }),
    // A heart apiece for a first-time hero caught by the worm (they refill on every visit).
    pot('kp_boss_pot_1', 1, 3, 'heart'),
    pot('kp_boss_pot_2', 14, 3, 'heart'),
  );
  return room;
}

function pedestalRoom(terrains: readonly Terrain[]): Room {
  const room = keepRoom(terrains, KP.pedestal, 'Crystal Sanctum', 0, 2, 1, PEDESTAL);
  room.entities.push(
    door('kp_ped_door_n', 'up', 'open', { link: LINK.bossOut }),
    // Centred on the carpet's 2x2 pedestal.
    ent('kp_ped_crystal', 'obj.pickup', 8 * 16, 7 * 16, { item: 'crystal', amount: 1 }),
    // The inscription above the pedestal names the prize.
    centred(sign('kp_ped_sign', 7, 4, D.keepCrystal)),
    torch('kp_ped_torch_1', 4, 4, true),
    torch('kp_ped_torch_2', 11, 4, true),
    torch('kp_ped_torch_3', 4, 9, true),
    torch('kp_ped_torch_4', 11, 9, true),
  );
  return room;
}

/** Floor 1 rooms of the keep. */
export function keepUpperFloor(terrains: readonly Terrain[]): Room[] {
  return [
    darkHall(terrains), torchRoom(terrains), eyeGallery(terrains), bigChestRoom(terrains),
    pegRoom(terrains), bossRoom(terrains), pedestalRoom(terrains),
  ];
}
