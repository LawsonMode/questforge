// Interiors world: the hero's house (where the game starts), the Elder's house,
// Tom's cottage, Juno's shop and the hidden Stonecrag cave. Houses share one
// frame (walls on columns 3-12, rows 2-11, exit mat at columns 7-8).
import type { EntityInstance, Room, Terrain, WarpTarget, World } from '../../core/types';
import { createWorld } from '../../core/project';
import { CAVE, INTERIOR } from './legends';
import { mapRoom } from './paint';
import { centred, chest, enemy, npc, pot, px, shopItem, sign, spot, warp } from './entities';
import { D } from './dialogues';
import { villageDoorstep } from './village';
import { CAVE_MOUTH, IN, OW, W } from './ids';

/** Where a new game begins: beside the hero's bed. */
export const START: WarpTarget = { world: W.interiors, room: IN.heroHouse, x: px(5), y: px(4), dir: 'down' };

const HERO_HOUSE = [
  '                ',
  '                ',
  '   ##w####w##   ',
  '   #b..f..ss#   ',
  '   #d..:::..#   ',
  '   #........#   ',
  '   #..oTo...#   ',
  '   #........#   ',
  '   #..rrrr..#   ',
  '   #..rrrr.a#   ',
  '   #........#   ',
  '   ####ee####   ',
  '                ',
  '                ',
];

const ELDER_HOUSE = [
  '                ',
  '                ',
  '   ##w####w##   ',
  '   #ss.f..ss#   ',
  '   #...:::..#   ',
  '   #.......b#   ',
  '   #.oTTo..d#   ',
  '   #........#   ',
  '   #..rrrr..#   ',
  '   #..rrrr..#   ',
  '   #p.......#   ',
  '   ####ee####   ',
  '                ',
  '                ',
];

const COTTAGE = [
  '                ',
  '                ',
  '   ##w####w##   ',
  '   #ssa..xxa#   ',
  '   #........#   ',
  '   #.oT...b.#   ',
  '   #..o...d.#   ',
  '   #........#   ',
  '   #.......x#   ',
  '   #pp....xx#   ',
  '   #........#   ',
  '   ####ee####   ',
  '                ',
  '                ',
];

const SHOP = [
  '                ',
  '                ',
  '   ##w####w##   ',
  '   #ssaxxass#   ',
  '   #........#   ',
  '   #T......T#   ',
  '   #........#   ',
  '   #........#   ',
  '   #........#   ',
  '   #.rrrrrr.#   ',
  '   #p......p#   ',
  '   ####ee####   ',
  '                ',
  '                ',
];

const CAVE_MAP = [
  '################',
  '################',
  '####.....#######',
  '###..k.....#####',
  '##....:::..k.###',
  '##...:::::....##',
  '###...:::.....##',
  '####.......k.###',
  '####k.........##',
  '#####.........##',
  '######...k...###',
  '#######....#####',
  '#######....#####',
  '#######XX#######',
];

/** Exit mat warp of a house back to its village doorstep. */
function houseExit(id: string, interior: Parameters<typeof villageDoorstep>[0]): EntityInstance {
  return warp(id, 8 * 16, px(11), villageDoorstep(interior), { w: 2, sound: 'door' });
}

function house(terrains: readonly Terrain[], id: string, name: string, gx: number, lines: readonly string[]): Room {
  const { room } = mapRoom(terrains, { id, name, gx, gy: 0 }, lines, INTERIOR, { ground: 'WOOD_FLOOR', walls: 'interior' });
  return room;
}

function heroHouse(terrains: readonly Terrain[]): Room {
  const room = house(terrains, IN.heroHouse, 'Hero\'s House', 0, HERO_HOUSE);
  room.entities.push(
    houseExit('hh_exit', IN.heroHouse),
    chest('hh_chest', 11, 4, 'rupees', 20),
    pot('hh_pot_1', 4, 9, 'rupee'),
    pot('hh_pot_2', 4, 10, 'heart'),
  );
  return room;
}

function elderHouse(terrains: readonly Terrain[]): Room {
  const room = house(terrains, IN.elderHouse, 'Elder\'s House', 2, ELDER_HOUSE);
  room.entities.push(
    houseExit('eh_exit', IN.elderHouse),
    npc('eh_ilsa', 6, 5, { sprite: 'npc.villager', name: 'Ilsa', dialogue: D.ilsa, behavior: 'wander' }),
    pot('eh_pot', 11, 10, 'heart'),
  );
  return room;
}

function cottage(terrains: readonly Terrain[]): Room {
  const room = house(terrains, IN.cottage, 'Tom\'s Cottage', 4, COTTAGE);
  room.entities.push(
    houseExit('ct_exit', IN.cottage),
    npc('ct_tom', 9, 8, { sprite: 'npc.sage', name: 'Old Tom', dialogue: D.tom, facing: 'left' }),
  );
  return room;
}

function shop(terrains: readonly Terrain[]): Room {
  const room = house(terrains, IN.shop, 'Juno\'s Shop', 6, SHOP);
  room.entities.push(
    houseExit('sh_exit', IN.shop),
    centred(npc('sh_juno', 7, 4, { sprite: 'npc.merchant', name: 'Merchant Juno', dialogue: D.merchant })),
    shopItem('sh_bombs', 5, 7, 'bombs', 5, 20),
    centred(shopItem('sh_arrows', 7, 7, 'arrows', 10, 15)),
    shopItem('sh_heart', 10, 7, 'heart', 1, 10),
  );
  return room;
}

function cave(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: IN.cave, name: 'Stonecrag Cave', gx: 8, gy: 0 }, CAVE_MAP, CAVE, { ground: 'CAVE_FLOOR' });
  room.music = 'cave';
  const mouth = spot(W.overworld, OW.cliffs, CAVE_MOUTH.tx, CAVE_MOUTH.ty + 1, 'down');
  room.entities.push(
    warp('cv_exit', 8 * 16, px(13), mouth, { w: 2, sound: 'stairs' }),
    chest('cv_heart_piece', 7, 4, 'heartPiece', 1),
    sign('cv_sign', 9, 6, D.signCave),
    enemy('cv_bat_1', 'enemy.bat', 4, 5, { sleeping: true }),
    enemy('cv_bat_2', 'enemy.bat', 12, 8, { sleeping: true }),
  );
  return room;
}

/** The interiors world (rooms spaced apart on the grid so none are neighbours). */
export function buildInteriors(terrains: readonly Terrain[]): World {
  const world = createWorld({ id: W.interiors, name: 'Ellendor Homes', kind: 'interior', music: 'house' });
  world.rooms.push(heroHouse(terrains), elderHouse(terrains), cottage(terrains), shop(terrains), cave(terrains));
  return world;
}
