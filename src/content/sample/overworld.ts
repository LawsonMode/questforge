// The valley of Ellendor: a 3x3-screen overworld (the village is the 2x1 room
// along the bottom-left). Screens connect through matching edge openings.
import type { Terrain, World } from '../../core/types';
import { createWorld } from '../../core/project';
import { buildVillage } from './village';
import { buildCrossroads, buildLake, buildMeadow, buildWhisperwood } from './wilds-south';
import { buildCliffs, buildDeepwood, buildKeepGate } from './wilds-north';
import { W } from './ids';

/** The Ellendor overworld: the village and the seven screens around it. */
export function buildOverworld(terrains: readonly Terrain[]): World {
  const world = createWorld({ id: W.overworld, name: 'Ellendor', kind: 'overworld', music: 'overworld' });
  world.rooms.push(
    buildCliffs(terrains), buildKeepGate(terrains), buildDeepwood(terrains),
    buildMeadow(terrains), buildCrossroads(terrains), buildWhisperwood(terrains),
    buildVillage(terrains), buildLake(terrains),
  );
  return world;
}
