// The built-in sample adventure, "The Hollow Crown": the valley of Ellendor
// (village + 3x3 overworld), the village interiors and a hidden cave, and the
// two-floor Hollow Keep dungeon with keys, puzzles, the big chest and a boss.
import type { Project } from '../../core/types';
import { PROJECT_FORMAT, PROJECT_VERSION, SAMPLE_PROJECT_ID } from '../../core/constants';
import { createDefaultAssets } from '../art';
import { sampleDialogues, D } from './dialogues';
import { buildInteriors, START } from './interiors';
import { buildOverworld } from './overworld';
import { buildKeep } from './keep';
import { FLAG } from './ids';

/** A fresh copy of the built-in sample adventure (id 'sample'). */
export function createSampleProject(): Project {
  const assets = createDefaultAssets();
  const now = Date.now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: SAMPLE_PROJECT_ID,
    name: 'The Hollow Crown',
    author: 'Questforge',
    description: 'The Sun Crystal of Ellendor has gone dark. Take up the Elder\'s sword, explore the valley and brave the Hollow Keep.',
    created: now,
    modified: now,
    settings: {
      title: 'The Hollow Crown',
      subtitle: 'A Questforge Adventure',
      startHearts: 3,
      startItems: { shield: 1 },
      introDialogue: D.intro,
      titleMusic: 'title',
    },
    palettes: assets.palettes,
    tiles: assets.tiles,
    terrains: assets.terrains,
    sprites: assets.sprites,
    worlds: [buildOverworld(assets.terrains), buildInteriors(assets.terrains), buildKeep(assets.terrains)],
    dialogues: sampleDialogues(),
    flags: [
      { name: FLAG.gotSword, description: 'The Elder gave the hero his sword (opens the village gate).' },
      { name: FLAG.questDone, description: 'The Sun Crystal was returned to the Elder.' },
    ],
    start: { ...START },
  };
}
