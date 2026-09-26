// Overworld screens around the village: Windy Meadow (pond, source of the
// river), the Crossroads (river + two bridges), Whisperwood (forest glade) and
// Mirror Lake (beach, pier, the sage). Enemies here are the gentle ones.
import type { Room, Terrain } from '../../core/types';
import { OVERWORLD } from './legends';
import { mapRoom } from './paint';
import { enemy, npc, pickup, sign } from './entities';
import { D } from './dialogues';
import { OW } from './ids';

const MEADOW = [
  '{}t.==.{}{}{}{}t',
  '()..==...~~~~..t',
  '{}.*==.,~~~~~~.t',
  '()..==.~~~~~~~~~',
  '{},"==.~~~~~~~~~',
  '()""==..~~~~~~~~',
  '{}""==..,.b.*...',
  '()."============',
  '{}.,============',
  '()*..b.."".r*...',
  '{}.b.."""".*..bt',
  '().r.."""".,*.,t',
  '{}.*..b..,.*..tt',
  '()()()()()()()()',
];

const CROSSROADS = [
  '{}{}{}===={}{}{}',
  't.b*,.====,.*b.t',
  't*..k.====..,.*t',
  '~~~~~~~BB~~~~~~t',
  '~~~~~~~BB~~~~~~t',
  '~~~~~~~BB~~~~~~t',
  '.*.b.,====.*~~~.',
  '============ZZZ=',
  '============ZZZ=',
  '.,.*..====..~~~.',
  't.b.*.====,.~~~t',
  't*,..b====.*~~~t',
  't.,*..====.,~~~t',
  '()()()====()~~~t',
];

const WHISPERWOOD = [
  '{}{}{}{}{}t.==.t',
  '[][][][][]t.==.t',
  '{}{}{}{}{}t.==*t',
  '[][]t[][],,.==.t',
  '{}{}t{}{}b..==.t',
  'tt[][][]t.*.==()',
  '..{}{}{}.,..=={}',
  '==============.t',
  '==============.t',
  '.*..,.b..*..==.t',
  'tt[]..*.[]..==.t',
  'tt{}.~~~{}.,==.t',
  'tt.*.~~~..t.==.t',
  'ttttttttttt.==.t',
];

const LAKE = [
  'ttttttttttt.==.t',
  't[][][][][].==*t',
  't{}{}{}{}{},==.t',
  't[][][]t.*..==.t',
  't{}{}{}t..b.==.t',
  'tt.*..,..*..==.t',
  'tt.zzzzzzzzz==zt',
  't.zzzzzzzzzzzzzt',
  't~~~~~~~~zzzzzzt',
  '~~~~~~~~~~zzzzzt',
  '~~~~~~ZZZZzzzzzt',
  '~~~~~~~~~~zzzzzt',
  't~~~~~~~~~~zzz.t',
  't~~~~~~~~~~~tttt',
];

/** Windy Meadow (grid 0,1): the pond, tall grass and the road to the cliffs. */
export function buildMeadow(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.meadow, name: 'Windy Meadow', gx: 0, gy: 1 }, MEADOW, OVERWORLD, { ground: 'GRASS' });
  room.entities.push(
    sign('wm_sign', 6, 6, D.signMeadow),
    enemy('wm_spitter', 'enemy.spitter', 3, 2, { variant: 'red' }),
    enemy('wm_spitter_2', 'enemy.spitter', 10, 10, { variant: 'red' }),
    enemy('wm_slime', 'enemy.slime', 13, 9, { variant: 'green', size: 'big', split: true }),
  );
  return room;
}

/** Crossroads (grid 1,1): the river, two bridges and the signpost. */
export function buildCrossroads(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.crossroads, name: 'Crossroads', gx: 1, gy: 1 }, CROSSROADS, OVERWORLD,
    { ground: 'GRASS' });
  room.entities.push(
    sign('cr_sign', 10, 9, D.signCrossroads),
    enemy('cr_soldier', 'enemy.soldier', 3, 11, { variant: 'green', behavior: 'patrol' }),
    enemy('cr_slime', 'enemy.slime', 11, 11, { variant: 'green', size: 'big', split: true }),
    enemy('cr_spitter', 'enemy.spitter', 11, 2, { variant: 'red' }),
  );
  return room;
}

/** Whisperwood (grid 2,1): forest glade with a little pond and a Heart Shard tucked behind a tree. */
export function buildWhisperwood(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.whisperwood, name: 'Whisperwood', gx: 2, gy: 1 }, WHISPERWOOD, OVERWORLD,
    { ground: 'GRASS_DARK' });
  room.music = 'forest';
  room.entities.push(
    pickup('ww_heart_piece', 2, 12, 'heartPiece', 1),
    enemy('ww_snake', 'enemy.snake', 3, 9),
    enemy('ww_snake_2', 'enemy.snake', 11, 11),
    enemy('ww_bat', 'enemy.bat', 10, 3),
    enemy('ww_soldier', 'enemy.soldier', 9, 6, { variant: 'blue', behavior: 'patrol' }),
  );
  return room;
}

/** Mirror Lake (grid 2,2): beach, pier and Sage Orla. */
export function buildLake(terrains: readonly Terrain[]): Room {
  const { room } = mapRoom(terrains, { id: OW.lake, name: 'Mirror Lake', gx: 2, gy: 2 }, LAKE, OVERWORLD, { ground: 'GRASS' });
  room.entities.push(
    sign('ml_sign', 11, 5, D.signLake),
    npc('ml_sage', 6, 10, { sprite: 'npc.sage', name: 'Sage Orla', dialogue: D.sage, facing: 'right' }),
    enemy('ml_slime', 'enemy.slime', 5, 7, { variant: 'red', size: 'small', split: false }),
    enemy('ml_slime_2', 'enemy.slime', 12, 9, { variant: 'red', size: 'small', split: false }),
  );
  return room;
}
