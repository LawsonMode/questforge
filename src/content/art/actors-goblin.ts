// Spear goblin (16x24): a hunched, pig-snouted brute with tusks, beady red
// eyes and an iron-shod spear. Legend: A = orange hide, B = purple leather
// vest, C = spear iron, D = pink snout, w = tusks, r = eyes.
import { actorPalette, FrameBank, RAMP_A, RAMP_B, type ActorColors, type ArtSet } from './actors-kit';
import { addWalk, figureFrame, overlay, type Facing, type Figure } from './actors-humanoid';
import type { PixelGrid } from './pixelgrid';

const GOBLIN: ActorColors = {
  outline: '#2c1008',
  a: ['#8c4418', '#c87430', '#f0ac5c'],
  b: ['#382848', '#5c4478', '#8c70a8'],
  c: ['#505068', '#9898b0', '#e8e8f8'],
  d: ['#a04040', '#e07878', '#f8b8a8'],
  white: '#fff8e0',
  glow: '#ff2818',
};

const BODY: Record<Facing, PixelGrid> = {
  down: overlay([
    '.......y|y.......',
    '.....aAy|yaa.....',
    '....aAAA|Aaax....',
    '.Aa.axxA|axxa.ax.',
    '..aaarAA|aAraaa..',
    '...xakSS|SSkax...',
    '...xaS#S|S#sax...',
    '...xwkss|sskwx...',
    '....xwxx|xxwx....',
    '.aAAAAbb|bbaaaax.',
    '.AAAa#bB|bb#aaax.',
    '.aAa#bBb|bbb#aax.',
    '.aa#ybbb|bbby#ax.',
    '.AA#yyyy|yyyy#ax.',
    '.aa.xbbB|bbbx.ax.',
    '....ybbb|bbby....',
  ], 3),
  up: overlay([
    '.......y|y.......',
    '.....aAy|yaa.....',
    '....aAAy|yaax....',
    '.Aa.aAAA|aaaa.ax.',
    '..aaaAAA|aaaaaa..',
    '...xaAAa|aaaax...',
    '...xaAaa|aaaax...',
    '...xxaaa|aaaxx...',
    '....xxaa|aaxx....',
    '.aAAAAaa|aaaaaax.',
    '.AAAa#bB|bb#aaax.',
    '.aAa#bBb|bbb#aax.',
    '.aa#ybbb|bbby#ax.',
    '.AA#yyyy|yyyy#ax.',
    '.aa.xbbb|bbbx.ax.',
    '....ybbb|bbby....',
  ], 3),
  right: overlay([
    '.....y..|........',
    '....yyAa|a.......',
    '...aAAAA|Aaa.....',
    '..AaAAAA|xxAa....',
    '.Aa.aAAA|ArAAa...',
    '....aAAA|AAAkSSs.',
    '....xaAa|AAAS#S#.',
    '....xaaa|awkssk..',
    '.....xaa|xwxxx...',
    '...aAAAA|Aaax....',
    '..aAAAbB|baaax...',
    '..aAa#bB|bb#ax...',
    '..aax#bb|by#ax...',
    '..xxxyyy|AAyyx...',
    '...xbbbx|Aabx....',
    '....ybbb|bbby....',
  ], 3),
};

/** Spear carried upright per facing (drawn over the carrying hand). */
const SPEAR: Record<Facing, PixelGrid> = {
  down: overlay([
    '........|....C...',
    '........|...CCc..',
    '........|...Ccz..',
    '........|....z...',
    ...Array<string>(15).fill('........|....c...'),
    '........|....z...',
  ], 0),
  up: overlay([
    '...C....|........',
    '..CCc...|........',
    '..Ccz...|........',
    '...z....|........',
    ...Array<string>(15).fill('...c....|........'),
    '...z....|........',
  ], 0),
  right: overlay([
    '........|..C.....',
    '........|.CCc....',
    '........|.Ccz....',
    '........|..z.....',
    ...Array<string>(15).fill('........|..c.....'),
    '........|..z.....',
  ], 0),
};

/**
 * Throw poses, each a full body: the throwing arm is raised from the shoulder
 * to the fist and the spear's bright leaf head leads in the throw direction
 * (foreshortened toward the camera for down, away from it for up).
 */
const THROW_BODY: Record<Facing, PixelGrid> = {
  down: overlay([
    '........|.....c..',
    '........|....aAa.',
    '........|....xaa.',
    '.......y|y....z..',
    '.....aAy|yaa.CCc.',
    '....aAAA|AaaxCCc.',
    '.Aa.axxA|axxa.Cz.',
    '..aaarAA|aAra#wa.',
    '...xakSS|SSkaxAa.',
    '...xaS#S|S#saxAa.',
    '...xwkss|sskwxAa.',
    '....xwxx|xxwx.Aa.',
    '.aAAAAbb|bbaaaAx.',
    '.AAAa#bB|bb#aax..',
    '.aAa#bBb|bbby....',
    '.aa#ybbb|bbby....',
    '.AA#yyyy|yyyy....',
    '.aa.xbbB|bbbx....',
    '....ybbb|bbby....',
  ], 0),
  up: overlay([
    '..w.....|........',
    '.CCc....|........',
    '.CCz....|........',
    '..z....y|y.......',
    '.aAa.aAy|yaa.....',
    '.xaa#AAy|yaax....',
    '.Aa#aAAA|aaaa.ax.',
    '.Aa#aAAA|aaaaaa..',
    '.Aa#aAAa|aaaax...',
    '.Aa#aAaa|aaaax...',
    '.Aa#xaaa|aaaxx...',
    '.Aa.xxaa|aaxx....',
    '.xAAAAaa|aaaaaax.',
    '..xAa#bB|bb#aaax.',
    '....ybBb|bbb#aax.',
    '...yybbb|bbby#ax.',
    '...yyyyy|yyyy#ax.',
    '....xbbb|bbbx.ax.',
    '....ybbb|bbby....',
  ], 0),
  right: overlay([
    '........|........',
    '.aA.....|...zCc..',
    'caAccccc|cccCCCCw',
    '.xa..y..|...zcz..',
    '.Aa.yyAa|a.......',
    '.Aa#AAAA|Aaa.....',
    '.Aa#AAAA|xxAa....',
    '.Aa#aAAA|ArAAa...',
    '.aA#aAAA|AAAkSSs.',
    '..aAxaAa|AAAS#S#.',
    '..aAxaaa|awkssk..',
    '..xaAxaa|xwxxx...',
    '...aAAAA|Aaax....',
    '..aAAAbB|baaax...',
    '..aAa#bB|bb#ax...',
    '..aax#bb|by#ax...',
    '..xxxyyy|byyyx...',
    '...xbbbx|bbbx....',
    '....ybbb|bbby....',
  ], 0),
};

function goblinSprite(): FrameBank {
  const fig: Figure = {
    body: BODY,
    legs: { hip: 19, pants: RAMP_A, boots: RAMP_B },
    // In profile the spear is carried on the far side, behind the head.
    over: { down: SPEAR.down, up: SPEAR.up },
    under: { right: SPEAR.right },
    arms: { down: [[1, 2, 14, 18]], up: [[13, 14, 14, 18]] },
  };
  const bank = new FrameBank();
  addWalk(bank, fig);
  for (const f of ['down', 'up', 'right'] as const) {
    bank.add(`throw_${f}`, figureFrame(fig, f, 1, { body: THROW_BODY[f], over: null, under: null }));
  }
  return bank;
}

/** Goblin sprite and palette. */
export function buildGoblinArt(): ArtSet {
  return {
    palettes: [actorPalette('pal.a.goblin', 'Spear goblin', GOBLIN)],
    sprites: [goblinSprite().build('enemy.goblin', 'pal.a.goblin')],
  };
}
