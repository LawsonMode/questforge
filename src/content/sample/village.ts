// Ellendor Village (overworld 2x1, bottom-left of the 3x3 grid): the hero's
// house, the Elder's house, Juno's shop and Tom's cottage around a dirt road,
// the Sun statue plaza, a garden and the river. The north gate is guarded
// until the Elder hands over his sword.
import type { Room, Terrain, WarpTarget } from '../../core/types';
import { OVERWORLD } from './legends';
import { mapRoom, type Painter } from './paint';
import { centred, npc, px, sign, spot, trigger, warp } from './entities';
import { D } from './dialogues';
import { CRYSTAL_FLAG, FLAG, IN, OW, W } from './ids';

const MAP = [
  '{}{}{}{}{}{}{}{}{}{}{}===={}~~~t',
  '()HHHHH.bHHHHHH.HHHHHt====.,~~~t',
  '{}HHHHH*,HHHHHH.HHHHHt====.*~~~t',
  '()HHHHH,*HHHHHH*HHHHH-+==+-+~~~t',
  '{}HHHHH..HHHHHH,HHHHH.====..~~~t',
  '(),.s.*.,..s..*.,.s...====*.~~~t',
  '{}========================*.~~~t',
  '()========================..~~~t',
  '{}.*.,.b.*.,s.*.b.,.*..*,..,~~~t',
  '()HHHHH.*.sssss.*+-.-+.b....~~~~',
  '{}HHHHH..*ssuss*.|"""|..*...~~~~',
  '()HHHHH.*.sssss.,|"""|.b....~~~~',
  '{}*.s.,.*.*.*.*..+---+..b.[][]tt',
  '()()()()()()()()()()()()(){}{}tt',
];

/** Doorways (door tile) of the village buildings, keyed by interior room. */
const VILLAGE_DOORS = {
  [IN.heroHouse]: { tx: 4, ty: 4 },
  [IN.elderHouse]: { tx: 11, ty: 4 },
  [IN.shop]: { tx: 18, ty: 4 },
  [IN.cottage]: { tx: 4, ty: 11 },
} as const;

/** Where the hero stands after leaving a building (one tile below its door, facing down). */
export function villageDoorstep(interior: keyof typeof VILLAGE_DOORS): WarpTarget {
  const d = VILLAGE_DOORS[interior];
  return spot(W.overworld, OW.village, d.tx, d.ty + 1, 'down');
}

/** Where the hero appears inside a building (just above its exit mat). */
function interiorArrival(interior: string): WarpTarget {
  return { world: W.interiors, room: interior, x: 8 * 16, y: px(10), dir: 'up' };
}

function houses(p: Painter): void {
  p.house(2, 1, 5, 4, [3, 5], 3);
  p.house(9, 1, 6, 11, [10, 13], 3);
  p.house(16, 1, 5, 18, [17, 19], 3);
  p.house(2, 9, 5, 4, [3, 5], 2);
}

function doorWarps(room: Room): void {
  for (const [interior, d] of Object.entries(VILLAGE_DOORS)) {
    room.entities.push(warp(`vil_door_${interior}`, px(d.tx), px(d.ty), interiorArrival(interior), { sound: 'door' }));
  }
}

function villagers(room: Room): void {
  room.entities.push(
    npc('vil_elder', 13, 10, { sprite: 'npc.elder', name: 'Elder Rowan', facing: 'down' }),
    // The gate guard stands on the seam between the two gap tiles so nobody squeezes past.
    centred(npc('vil_guard', 23, 3, { sprite: 'npc.guard', name: 'Guard Bram', dialogue: D.guardBlock, facing: 'down' })),
    // These three speak through talk triggers (see chatter): new lines once the quest is done.
    npc('vil_guard_aside', 26, 4, { sprite: 'npc.guard', name: 'Guard Bram', facing: 'left', hidden: true }),
    npc('vil_marta', 7, 7, { sprite: 'npc.villager', name: 'Marta', behavior: 'wander' }),
    npc('vil_pip', 23, 10, { sprite: 'npc.child', name: 'Pip', behavior: 'wander' }),
    sign('vil_sign_village', 21, 4, D.signVillage),
    sign('vil_sign_shop', 17, 5, D.signShop),
    // Shown by the Elder once the crystal is back.
    sign('vil_sign_celebrate', 11, 8, D.signCelebrate, true),
  );
}

/** Villagers who say one thing while the crystal is dark and another once it shines again. */
function chatter(room: Room): void {
  const lines: [npc: string, name: string, before: string, after: string][] = [
    ['vil_guard_aside', 'Bram', D.guardAside, D.guardAfter],
    ['vil_marta', 'Marta', D.marta, D.martaAfter],
    ['vil_pip', 'Pip', D.pip, D.pipAfter],
  ];
  for (const [id, name, before, after] of lines) {
    room.triggers.push(
      trigger(`t_${id}_talk`, `${name} talks`, 'talk', [{ kind: 'flag', flag: FLAG.questDone, value: false }],
        [{ kind: 'dialogue', dialogue: before }], { source: id }),
      trigger(`t_${id}_after`, `${name} after the quest`, 'talk', [{ kind: 'flag', flag: FLAG.questDone, value: true }],
        [{ kind: 'dialogue', dialogue: after }], { source: id }),
    );
  }
}

/** Elder conversation branches (mutually exclusive by flags) and the gate guard stepping aside. */
function questTriggers(room: Room): void {
  const elder = 'vil_elder';
  room.triggers.push(
    trigger('t_elder_sword', 'Elder gives the sword', 'talk', [
      { kind: 'flag', flag: FLAG.gotSword, value: false },
      { kind: 'flag', flag: CRYSTAL_FLAG, value: false },
    ], [
      { kind: 'dialogue', dialogue: D.elderQuest },
      { kind: 'giveItem', item: 'sword', amount: 1 },
      { kind: 'setFlag', flag: FLAG.gotSword, value: true },
      { kind: 'dialogue', dialogue: D.elderGo },
    ], { once: true, source: elder }),
    trigger('t_elder_hint', 'Elder hint', 'talk', [
      { kind: 'flag', flag: FLAG.gotSword, value: true },
      { kind: 'flag', flag: CRYSTAL_FLAG, value: false },
    ], [{ kind: 'dialogue', dialogue: D.elderHint }], { source: elder }),
    trigger('t_elder_thanks', 'Crystal returned', 'talk', [
      { kind: 'flag', flag: CRYSTAL_FLAG, value: true },
      { kind: 'flag', flag: FLAG.questDone, value: false },
    ], [
      // The heart container's item fanfare is the celebration (the victory jingle
      // already played when the crystal was taken): the village tune plays on.
      { kind: 'dialogue', dialogue: D.elderThanks },
      { kind: 'giveItem', item: 'heartContainer', amount: 1 },
      { kind: 'setFlag', flag: FLAG.questDone, value: true },
      { kind: 'showEntity', target: 'vil_sign_celebrate' },
    ], { once: true, source: elder }),
    trigger('t_elder_done', 'Elder after the quest', 'talk', [{ kind: 'flag', flag: FLAG.questDone, value: true }],
      [{ kind: 'dialogue', dialogue: D.elderDone }], { source: elder }),
    trigger('t_guard_aside', 'Guard steps aside', 'auto', [{ kind: 'flag', flag: FLAG.gotSword, value: true }], [
      { kind: 'hideEntity', target: 'vil_guard' },
      { kind: 'showEntity', target: 'vil_guard_aside' },
    ], { once: true }),
  );
}

/** The village room (grid 0..1, 2). */
export function buildVillage(terrains: readonly Terrain[]): Room {
  const { room, paint } = mapRoom(terrains, { id: OW.village, name: 'Ellendor Village', gx: 0, gy: 2, gw: 2 }, MAP, OVERWORLD,
    { ground: 'GRASS' });
  houses(paint);
  room.music = 'village';
  doorWarps(room);
  villagers(room);
  questTriggers(room);
  chatter(room);
  return room;
}
