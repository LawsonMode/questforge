// Townsfolk (16x24, feet on row 22): six distinct NPCs with friendly faces —
// a villager in a headscarf, a hunched elder with a cane, a small child, a town
// guard with a spear, a merchant with apron and pack, and a robed sage. Each
// has idle frames for 4 directions (left mirrored) and 2-frame walks.
import { actorPalette, FrameBank, RAMP_A, RAMP_B, RAMP_C, RAMP_D, type ActorColors, type ArtSet } from './actors-kit';
import { addIdle, addWalk, overlay, type Facing, type Figure } from './actors-humanoid';
import type { PixelGrid } from './pixelgrid';

type Bodies = Record<Facing, PixelGrid>;

const SKIN: readonly [string, string, string] = ['#b86840', '#e8a070', '#f8d0a8'];

// ---------------------------------------------------------------- villager

const VILLAGER: ActorColors = {
  outline: '#281820',
  a: ['#284888', '#4070c0', '#78a8e8'],
  b: ['#882028', '#c83838', '#f07058'],
  c: ['#503018', '#805028', '#b07838'],
  d: SKIN,
  white: '#f8f8f0',
  glow: '#f89088',
};

const VILLAGER_BODY: Bodies = {
  down: overlay([
    '......bB|Bb......',
    '.....bBB|Bbb.....',
    '....bBBB|bbby....',
    '....bBcc|ccby....',
    '...ybcSS|SSsby...',
    '...ybS#S|S#sby...',
    '...ybrSS|SSrby...',
    '....ybSk|kSby....',
    '.....ySS|ssy.....',
    '....aAAw|waax....',
    '...aAAAA|aaaax...',
    '..Aa#AAA|aaa#ax..',
    '..Aa#aAA|aax#ax..',
    '..aa#ccc|ccc#ax..',
    '..Ss#aAA|aax#sk..',
    '....aAAA|aaax....',
    '...aAAAa|aaaax...',
    '...aAAaa|aaaax...',
    '...xaxaa|xaxax...',
  ], 2),
  up: overlay([
    '......bB|Bb......',
    '.....bBB|Bbb.....',
    '....bBBB|bbby....',
    '....bBBB|bbby....',
    '...ybBBb|bbbby...',
    '...ybBBb|bbbby...',
    '...ybBbb|bbbby...',
    '....ybbb|bbby....',
    '.....yyB|byy.....',
    '....aAAb|yaax....',
    '...aAAAA|aaaax...',
    '..Aa#AAA|aaa#ax..',
    '..Aa#aAA|aax#ax..',
    '..aa#ccc|ccc#ax..',
    '..Ss#aAA|aax#sk..',
    '....aAAA|aaax....',
    '...aAAAa|aaaax...',
    '...aAAaa|aaaax...',
    '...xaxaa|xaxax...',
  ], 2),
  right: overlay([
    '.....bBB|b.......',
    '....bBBB|bb......',
    '...bBBBB|bby.....',
    '...bBBBb|ccby....',
    '..ybBBbb|cSSs....',
    '..ybBBby|S#Ss....',
    '..ybBbby|SrSSS...',
    '...ybbby|SSks....',
    '....yyyy|ss......',
    '.....aAA|aa......',
    '....aAAA|aax.....',
    '....aaAA|aax.....',
    '....aaAA|aax.....',
    '....ccAA|acc.....',
    '....aaSs|aax.....',
    '....aAAA|aax.....',
    '...aAAAa|aaax....',
    '...aAAaa|aaax....',
    '...xaxaa|xaxx....',
  ], 2),
};

// ---------------------------------------------------------------- elder

const ELDER: ActorColors = {
  outline: '#20180c',
  a: ['#4c4020', '#7c6c38', '#b0a060'],
  b: ['#704018', '#b07030', '#e8a850'],
  c: ['#9090a0', '#c8c8d8', '#f8f8f8'],
  d: ['#b07050', '#e0a888', '#f8d8c0'],
  white: '#ffffff',
  glow: '#f08070',
};

const ELDER_BODY: Bodies = {
  down: overlay([
    '......SS|Ss......',
    '.....SSS|Sss.....',
    '....cCCS|SCCc....',
    '....cS#S|S#sc....',
    '....cSSr|rSsc....',
    '....CCCC|Cccz....',
    '....aCCC|ccza....',
    '...aAACC|czaax...',
    '...aAACC|czaaax..',
    '....#AAc|zaa#ax..',
    '....#AAA|aaa#ax..',
    '....aAAA|aaa#sk..',
    '....aAAA|aaax....',
    '...aAAAa|aaaax...',
    '...aAAaa|aaaax...',
    '...xaxaa|xaxax...',
  ], 4),
  up: overlay([
    '......SS|Ss......',
    '.....SSS|Sss.....',
    '....cSSS|Sssc....',
    '....cCSS|sscc....',
    '....cCCC|cccc....',
    '.....cCC|ccz.....',
    '....aAAA|aaaa....',
    '...aAAAA|aaaax...',
    '..aAAAAa|aaaax...',
    '..sk#AAa|aaa#....',
    '....#AAa|aaa#....',
    '....aAAa|aax#....',
    '....aAAa|aaax....',
    '...aAAAa|aaaax...',
    '...aAAaa|aaaax...',
    '...xaxaa|xaxax...',
  ], 4),
  right: overlay([
    '........|SSs.....',
    '.......S|SSss....',
    '......cS|SSSss...',
    '......cS|S#Sss...',
    '.....aac|SSSrS...',
    '....aAAc|CCCCc...',
    '...aAAAa|cCCcz...',
    '..aAAAAa|acCz....',
    '..aAAAaa|aacz....',
    '..aAAAa#|AAa.....',
    '..aAAAa#|Aa......',
    '...aAAAa|aax.....',
    '....aAAA|aax.....',
    '...aAAAa|aaax....',
    '...aAAaa|aaax....',
    '...xaxaa|xaxx....',
  ], 5),
};

/** Walking cane with the gripping hand, per facing. */
const ELDER_CANE: Record<Facing, PixelGrid> = {
  down: overlay([
    '.bBb....|........',
    '.bSs....|........',
    ...Array<string>(8).fill('..b.....|........'),
    '..y.....|........',
  ], 12),
  up: overlay([
    '........|....bBb.',
    '........|....sSb.',
    ...Array<string>(8).fill('........|.....b..'),
    '........|.....y..',
  ], 12),
  right: overlay([
    '........|..bBb...',
    '........|.Ssb.b..',
    ...Array<string>(8).fill('........|....b...'),
    '........|....y...',
  ], 13),
};

// ---------------------------------------------------------------- child

const CHILD: ActorColors = {
  outline: '#281810',
  a: ['#b88018', '#e8b830', '#f8e878'],
  b: ['#284078', '#4068b0', '#6890d8'],
  c: ['#983010', '#d86020', '#f8a048'],
  d: SKIN,
  white: '#ffffff',
  glow: '#f88880',
};

const CHILD_BODY: Bodies = {
  down: overlay([
    '......cC|.c......',
    '.....cCC|Ccc.....',
    '....cCCC|Cccz....',
    '...cCCCC|ccccz...',
    '...cCSSS|Ssscz...',
    '...cS#SS|SS#sz...',
    '...zSwSS|SSwsz...',
    '...zrSSk|kSSrz...',
    '.....sSS|sss.....',
    '....aAAA|aaax....',
    '...sbbbb|bbbbs...',
    '...SAAAA|aaaak...',
    '...Sbbbb|bbbbk...',
    '....yyyy|yyyy....',
  ], 6),
  up: overlay([
    '......cC|.c......',
    '.....cCC|Ccc.....',
    '....cCCC|Cccz....',
    '...cCCCC|ccccz...',
    '...cCCCC|ccccz...',
    '...cCCCc|ccccz...',
    '...zcCcc|ccczz...',
    '...zzccc|cczzz...',
    '.....sss|sss.....',
    '....aAAA|aaax....',
    '...sbbbb|bbbbs...',
    '...SAAAA|aaaak...',
    '...Sbbbb|bbbbk...',
    '....yyyy|yyyy....',
  ], 6),
  right: overlay([
    '.....cC.|c.......',
    '....cCCC|cc......',
    '...cCCCC|Ccc.....',
    '..cCCCCC|ccSz....',
    '..cCCCcc|SSSs....',
    '..zCCcS#|SS#s....',
    '..zcccSw|SSwSS...',
    '...zzcSS|rSks....',
    '.....sSS|ss......',
    '.....aAA|aa......',
    '....bbSb|bb......',
    '....AASA|aa......',
    '....bbbb|bb......',
    '.....yyy|yy......',
  ], 6),
};

// ---------------------------------------------------------------- guard

const GUARD: ActorColors = {
  outline: '#1c0c18',
  a: ['#4c1430', '#842848', '#c04c70'],
  b: ['#806010', '#c89820', '#f8d850'],
  c: ['#50586c', '#9098b0', '#e0e8f0'],
  d: SKIN,
  white: '#ffffff',
  glow: '#f09080',
};

const GUARD_BODY: Bodies = {
  down: overlay([
    '......zc|cz......',
    '.....zCC|ccz.....',
    '....zCCC|cccz....',
    '.zcCCCCC|ccccczz.',
    '....kkkk|kkkk....',
    '....SS#S|S#Ss....',
    '....SSSS|SSSs....',
    '....SkkS|kkSs....',
    '.....sSS|ss......',
    '..cCAAAb|Aaaacz..',
    '.cCcAAbB|baaaczz.',
    '.cc#AAbB|Bba#cz..',
    '.cc#AAAb|aaa#cz..',
    '.SS#yyyB|byyy#sk.',
    '.Ss.aAAA|aaax.sk.',
    '....aAAa|aaax....',
  ], 2),
  up: overlay([
    '......zc|cz......',
    '.....zCC|ccz.....',
    '....zCCC|cccz....',
    '.zcCCCCC|ccccczz.',
    '....cCCC|cccz....',
    '....cCCc|cczz....',
    '....zccc|cczz....',
    '....zzcc|czzz....',
    '.....kkk|kk......',
    '..cCAAAA|Aaaacz..',
    '.cCcAAAA|aaaaczz.',
    '.cc#AAAA|aaa#cz..',
    '.cc#AAAa|aaa#cz..',
    '.SS#yyyy|yyyy#sk.',
    '.Ss.aAAA|aaax.sk.',
    '....aAAa|aaax....',
  ], 2),
  right: overlay([
    '.....zcc|z.......',
    '....zCCC|cz......',
    '...zCCCC|ccz.....',
    '.zcCCCCC|Ccccczz.',
    '....zkkk|kkkk....',
    '....zkkS|S#SS....',
    '....zkSS|SSSSS...',
    '....zkkS|Skks....',
    '.....sss|s.......',
    '....cAAA|bbaz....',
    '...cCAAA|bBaz....',
    '...cc#Sc|Aaz.....',
    '...cc#SS|aax.....',
    '...yy#SS|yyy.....',
    '....aAAA|aax.....',
    '....aAAa|aax.....',
  ], 2),
};

/** Tall spear held upright per facing. */
const GUARD_SPEAR: Record<Facing, PixelGrid> = {
  down: overlay([
    '........|......C.',
    '........|.....CCc',
    '........|.....Ccz',
    '........|......z.',
    '........|.....bBy',
    ...Array<string>(16).fill('........|......c.'),
    '........|......z.',
  ], 0),
  up: overlay([
    '.C......|........',
    'CCc.....|........',
    'Ccz.....|........',
    '.z......|........',
    'bBy.....|........',
    ...Array<string>(16).fill('.c......|........'),
    '.z......|........',
  ], 0),
  right: overlay([
    '........|......C.',
    '........|.....CCc',
    '........|.....Ccz',
    '........|......z.',
    '........|.....bBy',
    ...Array<string>(9).fill('........|......c.'),
    '........|..cCSsc.',
    ...Array<string>(6).fill('........|......c.'),
    '........|......z.',
  ], 0),
};

// ---------------------------------------------------------------- merchant

const MERCHANT: ActorColors = {
  outline: '#1c1810',
  a: ['#1c5850', '#2c8878', '#58b8a0'],
  b: ['#5c3418', '#945c28', '#c89048'],
  c: ['#a89878', '#d8d0b0', '#f8f4e0'],
  d: SKIN,
  white: '#ffffff',
  glow: '#e84838',
};

const MERCHANT_BODY: Bodies = {
  down: overlay([
    '.......r|r.......',
    '......aA|Aa......',
    '.....aAA|Aaa.....',
    '....aAAA|aaax....',
    '....SSSS|SSss....',
    '...sS#SS|S#ssk...',
    '...sSSSr|rSssk...',
    '..yyyyyS|Syyyyy..',
    '....SSkk|kkSs....',
    '.....sss|ss......',
    '..aAbAAA|aaabax..',
    '.aAAbCCC|cccbaax.',
    '.AAabCCC|cccbaax.',
    '.aA#CCCC|cccc#ax.',
    '.SS#CCCC|cccc#sk.',
    '.Ss#CCCc|cccc#sk.',
    '...#CCcc|cccz#...',
    '....zccc|cccz....',
  ], 0),
  up: overlay([
    '.......r|r.......',
    '......aA|Aa......',
    '.....aAA|Aaa.....',
    '....aAAA|aaax....',
    '...bBBBB|bbbby...',
    '..bBBBBB|bbbbby..',
    '..bBByyy|yyyBby..',
    '..bBbCCC|cccbby..',
    '..bBbCCc|cczbby..',
    '..bBbccc|cczbby..',
    '.abBbbbb|bbbbbyx.',
    '.AybBBbb|bbbbyax.',
    '.aAybbbb|bbbyaax.',
    '.SSyyyyy|yyyyysk.',
    '.Ss#aAAA|aaaa#sk.',
    '...#aAAa|aaax#...',
    '....xaxa|axax....',
  ], 1),
  right: overlay([
    '......r.|........',
    '.....aAA|a.......',
    '....aAAA|aa......',
    '..bbaAAA|aax.....',
    '.bBBbSSS|SSs.....',
    '.bBBbSS#|SSs.....',
    '.bBBbSSS|SrSS....',
    '.bBBbkkk|kks.....',
    '.bBBbSSk|ks......',
    '.bBBbbss|s.......',
    '.bBBbaAC|Cca.....',
    '.bBBbAaC|CCcc....',
    '.ybbbaSS|CCcc....',
    '..yyyaSS|CCcc....',
    '....aaaC|Cccc....',
    '....aaaC|cccz....',
    '....xaaz|cccz....',
  ], 1),
};

// ---------------------------------------------------------------- sage

const SAGE: ActorColors = {
  outline: '#140c24',
  a: ['#382060', '#5c3898', '#9068c8'],
  b: ['#806018', '#c89830', '#f8e070'],
  c: ['#1c1030', '#2c1c48', '#4c3070'],
  d: SKIN,
  white: '#ffffff',
  glow: '#58e8f8',
};

const SAGE_BODY: Bodies = {
  down: overlay([
    '.......a|a.......',
    '......aA|aa......',
    '......aA|aa......',
    '.....aAA|aaa.....',
    '....aAAA|aaax....',
    '....aAcc|ccax....',
    '...aAcSS|SScax...',
    '...aAS#S|S#Sax...',
    '...aAsSS|SSsax...',
    '...aAcSk|kScax...',
    '..aAAacS|Scaaax..',
    '..aAAbBr|Bbaaax..',
    '..aAAaBB|baaaax..',
    '..aAaaaB|baaaax..',
    '..aAa#SS|ss#aax..',
    '..aAaaaB|baaaax..',
    '..aAAaaB|baaaax..',
    '..aAAaaB|baaaax..',
    '..aAaaaB|baaaax..',
    '..bBbbbB|bbbbby..',
  ], 0),
  up: overlay([
    '.......a|a.......',
    '......aA|aa......',
    '......aA|aa......',
    '.....aAA|aaa.....',
    '....aAAA|aaax....',
    '....aAAA|aaax....',
    '...aAAAA|aaaax...',
    '...aAAAa|aaaax...',
    '...aAAAa|aaaax...',
    '...xaAaa|aaaxx...',
    '..aAxxaa|aaxxax..',
    '..aAAAaa|aaaaax..',
    '..aAAAaa|aaaaax..',
    '..aAAaax|aaaaax..',
    '..aAaaax|aaaaax..',
    '..aAAaax|aaaaax..',
    '..aAAaax|aaaaax..',
    '..aAAaax|aaaaax..',
    '..aAaaax|aaaaax..',
    '..bBbbbb|bbbbby..',
  ], 0),
  right: overlay([
    '....aa..|........',
    '.....aA.|........',
    '.....aAa|........',
    '.....aAA|a.......',
    '....aAAA|aa......',
    '...aAAAa|czc.....',
    '...aAAAc|zSSs....',
    '..aAAAAc|S#SS....',
    '..aAAAac|SSSSs...',
    '..aAAaac|zSks....',
    '..aAAaaa|zzz.....',
    '..aAAaaa|Br......',
    '..aAAaa#|SSa.....',
    '..aAAaaa|Baa.....',
    '..aAAaaa|Baa.....',
    '..aAAaaa|Baa.....',
    '..aAAaaa|Baax....',
    '..aAAaaa|Baax....',
    '..aAAaaa|Baax....',
    '..bBbbbb|Bbby....',
  ], 1),
};

// ---------------------------------------------------------------- assembly

function npcBank(fig: Figure): FrameBank {
  const bank = new FrameBank();
  addIdle(bank, fig);
  addWalk(bank, fig);
  return bank;
}

const NPCS: readonly { id: string; name: string; colors: ActorColors; fig: Figure }[] = [
  {
    id: 'villager', name: 'Villager', colors: VILLAGER,
    fig: {
      body: VILLAGER_BODY, legs: { hip: 21, pants: RAMP_C, boots: RAMP_C, robe: 18 },
      arms: { down: [[2, 3, 13, 17], [12, 13, 13, 17]], up: [[2, 3, 13, 17], [12, 13, 13, 17]] },
    },
  },
  {
    id: 'elder', name: 'Elder', colors: ELDER,
    fig: {
      body: ELDER_BODY, legs: { hip: 21, pants: RAMP_B, boots: RAMP_B, robe: 18 }, over: ELDER_CANE,
      arms: { down: [[12, 13, 13, 16]], up: [[2, 3, 13, 14]] },
    },
  },
  {
    id: 'child', name: 'Child', colors: CHILD,
    fig: {
      body: CHILD_BODY, legs: { hip: 20, pants: RAMP_D, boots: RAMP_B },
      arms: { down: [[3, 3, 17, 19], [12, 12, 17, 19]], up: [[3, 3, 17, 19], [12, 12, 17, 19]] },
    },
  },
  {
    id: 'guard', name: 'Guard', colors: GUARD,
    fig: {
      body: GUARD_BODY, legs: { hip: 18, pants: RAMP_C, boots: RAMP_B }, over: GUARD_SPEAR,
      arms: { down: [[1, 2, 13, 17]], up: [[13, 14, 13, 17]] },
    },
  },
  {
    id: 'merchant', name: 'Merchant', colors: MERCHANT,
    fig: {
      body: MERCHANT_BODY, legs: { hip: 18, pants: RAMP_B, boots: RAMP_B },
      arms: { down: [[1, 2, 13, 16], [13, 14, 13, 16]], up: [[1, 2, 13, 16], [13, 14, 13, 16]] },
    },
  },
  {
    id: 'sage', name: 'Sage', colors: SAGE,
    fig: { body: SAGE_BODY, legs: { hip: 21, pants: RAMP_A, boots: RAMP_B, robe: 17 } },
  },
];

/** The six NPC sprites and their palettes. */
export function buildNpcArt(): ArtSet {
  return {
    palettes: NPCS.map((n) => actorPalette(`pal.a.${n.id}`, n.name, n.colors)),
    sprites: NPCS.map((n) => npcBank(n.fig).build(`npc.${n.id}`, `pal.a.${n.id}`)),
  };
}
