// Northern overworld screens: Stonecrag Cliffs (a terrace reached from the
// Keep Gate, one-way ledges down to the cracked wall and the meadow, a Piece of
// Heart up on the plateau), the Keep Gate (the Hollow Keep's facade and entrance
// stairs) and the dense Deepwood with its hidden clearing. Tougher enemies live
// up here.
import type { Room, Terrain, WarpTarget } from '../../core/types';
import { OVERWORLD } from './legends';
import { mapRoom } from './paint';
import { chest, enemy, pickup, px, sign, spot, warp } from './entities';
import { D } from './dialogues';
import { CAVE_MOUTH, IN, KEEP_DOOR, KP, OW, W } from './ids';

const CLIFFS = [
  'mmmmmmmmmmmmmmmm',
  'mmmmmmmmmmmmmmmm',
  'mmmmmxmmmmmmmmmm',
  'm..MMMMJ.,.*..k.',
  'm...MMMJ..".b*..',
  'm..b...J.,""..,.',
  'm.*.,..JLLLLLLLt',
  'm......*.,.*.,.t',
  'm.k...*.,ppppppt',
  'm..b.."..ppppppt',
  'm.*..""".ppppppt',
  'mmmLLLLLLppYpppt',
  'mmm.==..,.*..k.t',
  '()t.==.()()()()t',
];

const KEEP_GATE = [
  'mmmwwwwwwwwwwmmm',
  'mmmwwwwwwwwwwmmm',
  'mmmwwwwwwwwwwmmm',
  '...wwWWccWWwwmmm',
  '.,.WW*ussu*WW[]t',
  '..b...kss....{}t',
  't*.,...ss..,.[]t',
  'tt..b..ss.b..{}t',
  't.,..*.ss..*..,.',
  't.."..==========',
  't.""".==========',
  't.r"..====..b.*.',
  't.,.*.====.*.,tt',
  '()()()====()()()',
];

const DEEPWOOD = [
  '{}{}{}{}[][][][]',
  '[][][][]{}{}{}{}',
  '{}{}{}{}..*.,.()',
  '[][][]t.,...*.{}',
  '{}{}{}t.*..,..()',
  '[][][]t...,*..{}',
  '{}{}{}t.,....,()',
  'tt[][][]t...tt{}',
  '..{}{}{}.,..,.()',
  '=============={}',
  '==============.t',
  '..[][][][][]==.t',
  't.{}{}{}{}{}==.t',
  '()()()()()t.==.t',
];

/** Stonecrag Cliffs (grid 0,0): terrace, ledges, cracked wall, plateau chest (a Heart Shard). */
export function buildCliffs(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.cliffs, name: 'Stonecrag Cliffs', gx: 0, gy: 0 }, CLIFFS, OVERWORLD,
    { ground: 'GRASS' });
  const caveArrival: WarpTarget = { world: W.interiors, room: IN.cave, x: 8 * 16, y: px(11), dir: 'up' };
  room.entities.push(
    // Sits on the cracked wall: unreachable until a bomb opens the cave mouth.
    warp('sc_cave', px(CAVE_MOUTH.tx), px(CAVE_MOUTH.ty), caveArrival, { sound: 'stairs' }),
    chest('sc_plateau_chest', 12, 9, 'heartPiece', 1),
    // On the terrace, by the way in from the Keep Gate (clear of every ledge landing).
    sign('sc_sign', 14, 4, D.signCliffs),
    enemy('sc_spitter', 'enemy.spitter', 11, 5, { variant: 'blue' }),
    enemy('sc_snake', 'enemy.snake', 3, 7),
    enemy('sc_snake_2', 'enemy.snake', 4, 6),
  );
  return room;
}

/** Keep Gate (grid 1,0): the Hollow Keep facade and its entrance arch. */
export function buildKeepGate(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.keepGate, name: 'Keep Gate', gx: 1, gy: 0 }, KEEP_GATE, OVERWORLD,
    { ground: 'GRASS' });
  const hall = { ...spot(W.keep, KP.entrance, 7, 11, 'up'), x: 8 * 16 };
  room.entities.push(
    warp('kg_keep_door', (KEEP_DOOR.tx + 1) * 16, px(KEEP_DOOR.ty), hall, { w: 2, sound: 'stairs' }),
    sign('kg_sign', 9, 5, D.signKeep),
    // The approach is held: a guard on the road itself and an archer covering it from the side.
    enemy('kg_soldier', 'enemy.soldier', 3, 5, { variant: 'blue', behavior: 'patrol' }),
    enemy('kg_soldier_2', 'enemy.soldier', 8, 8, { variant: 'blue', behavior: 'guard', facing: 'down' }),
    enemy('kg_archer', 'enemy.archer', 12, 5, { variant: 'green', facing: 'left' }),
  );
  return room;
}

/** Deepwood (grid 2,0): dense forest around a sunny clearing with a Heart Shard chest and a fairy. */
export function buildDeepwood(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.deepwood, name: 'Deepwood', gx: 2, gy: 0 }, DEEPWOOD, OVERWORLD,
    { ground: 'GRASS_DARK' });
  room.music = 'forest';
  room.entities.push(
    sign('dw_sign', 1, 8, D.signWoods),
    chest('dw_chest', 10, 3, 'heartPiece', 1),
    pickup('dw_fairy', 12, 5, 'fairy', 1),
    enemy('dw_snake', 'enemy.snake', 5, 9),
    enemy('dw_snake_2', 'enemy.snake', 13, 11),
    enemy('dw_bat', 'enemy.bat', 8, 5),
    enemy('dw_archer', 'enemy.archer', 10, 10, { variant: 'blue' }),
  );
  return room;
}
