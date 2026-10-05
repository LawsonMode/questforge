// Standards catalog: the skills Questforge gathers evidence for, each mapped to
// standards codes, with a student-facing "I can ..." line and what each mastery
// level (1-4) looks like in this app. Data, not logic: levels.ts holds the rules
// that propose a level from the learning log.
//
// Skill ids follow the Shared Learning Layer "Skill Atlas" draft (Questforge x
// Programmon): dotted, permanent, never renumbered or reused (a retired skill
// would be marked, not removed). Quark maps the same ids to its own catalog.
//
// Code sources:
//   idaho  Idaho Digital Literacy / CS course guidance (essential = E, supporting = S),
//          only where the owner's Idaho Standards Crosswalk / the Atlas draft place it.
//   dl     Idaho draft Digital Literacy standards 9-12.DL.* (June 2026 draft; may change).
//   csta   CSTA K-12 CS Standards (2017). Proposed alignments: verify before reporting.
//   iste   ISTE Standards for Students (2016). Proposed alignments: verify before reporting.

/** Bump when a skill, code or level descriptor changes (stored with every export). */
export const STANDARDS_VERSION = '1.0.0';

export type SkillId =
  | 'prog.io' | 'prog.selection' | 'prog.sequence' | 'prog.trace' | 'prog.debug' | 'data.images';

/** Mastery levels: 0 = nothing yet, 4 = did it again in a different context. */
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  0: 'Not yet',
  1: 'Beginning',
  2: 'Developing',
  3: 'Proficient',
  4: 'Advanced',
};

export interface StandardCode {
  code: string;
  /** Short topic of the standard. */
  label: string;
  /** Idaho course guidance only: essential or supporting. */
  weight?: 'essential' | 'supporting';
  /** True for alignments that still need checking against the official text. */
  verify?: boolean;
}

export interface Skill {
  id: SkillId;
  name: string;
  /** Student-facing goal. */
  iCan: string;
  codes: { idaho: StandardCode[]; dl: StandardCode[]; csta: StandardCode[]; iste: StandardCode[] };
  /** What levels 1-4 look like in Questforge (index 0 = level 1). */
  levels: readonly [string, string, string, string];
  /** The highest level this app can propose on its own (higher needs a teacher-scored artifact). */
  maxLevel: Level;
  /** Shown when maxLevel < 4: how a student reaches the rest. */
  beyond?: string;
}

const IDAHO_CS_5_2: StandardCode = { code: '9-12.CS.5.2', label: 'Algorithms with control structures', weight: 'essential' };
const DL_1: StandardCode = { code: '9-12.DL.1', label: 'Computational thinking (draft)' };

export const SKILLS: readonly Skill[] = [
  {
    id: 'prog.io',
    name: 'Events, inputs and outputs',
    iCan: 'I can make my world react: an event or input (a switch, a door, talking) causes outputs (doors open, items appear, music plays).',
    codes: {
      idaho: [{ code: '9-12.CS.1.4', label: 'Program inputs and outputs', weight: 'essential' }],
      dl: [{ code: '9-12.DL.2', label: 'Inputs and outputs (draft)' }],
      csta: [{ code: '3A-AP-16', label: 'Event-driven programs', verify: true }],
      iste: [{ code: '1.5d', label: 'Computational thinker: automation', verify: true }],
    },
    levels: [
      'Built one working trigger.',
      'Built working triggers that respond to two different kinds of event or input.',
      'Uses at least two kinds of event, three kinds of input and three kinds of output in triggers they wrote, and playtested them.',
      'Chained triggers together through state (one trigger sets a flag another one reads), in two or more rooms, and playtested it.',
    ],
    maxLevel: 4,
  },
  {
    id: 'prog.selection',
    name: 'Making decisions (conditions)',
    iCan: 'I can make my program choose: something only happens when the right conditions are true.',
    codes: {
      idaho: [IDAHO_CS_5_2],
      dl: [DL_1],
      csta: [{ code: '3A-AP-15', label: 'Control structures', verify: true }, { code: '2-AP-12', label: 'Nested and compound conditionals', verify: true }],
      iste: [{ code: '1.5d', label: 'Computational thinker: automation', verify: true }],
    },
    levels: [
      'Built a working trigger with a condition.',
      'Built working triggers using two or more different kinds of condition.',
      'Wrote a compound condition (two or more joined with "and") or a "not" test, and playtested it.',
      'Built a flag "state machine": one trigger sets a flag that another trigger tests, with a "not" test somewhere, and playtested it.',
    ],
    maxLevel: 4,
  },
  {
    id: 'prog.sequence',
    name: 'Sequencing steps',
    iCan: 'I can put steps in the right order so they happen one after another.',
    codes: {
      idaho: [IDAHO_CS_5_2],
      dl: [DL_1],
      csta: [{ code: '2-AP-10', label: 'Algorithms as flowcharts / pseudocode', verify: true }],
      iste: [{ code: '1.5d', label: 'Computational thinker: automation', verify: true }],
    },
    levels: [
      'Built a working trigger with two or more actions in order.',
      'Built a sequence of three or more actions of two or more kinds.',
      'Wrote a sequence with a timed or blocking step (wait or dialogue) followed by more actions, and playtested it.',
      'Wrote three or more such multi-step sequences across two or more rooms, and playtested them.',
    ],
    maxLevel: 4,
  },
  {
    id: 'prog.trace',
    name: 'Reading code',
    iCan: 'I can read a program and say what it will do.',
    codes: {
      idaho: [{ code: '9-12.CS.5.1', label: 'Execution diagrams and tracing', weight: 'supporting' }],
      dl: [DL_1],
      csta: [{ code: '2-AP-10', label: 'Algorithms as flowcharts / pseudocode', verify: true }],
      iste: [{ code: '1.5c', label: 'Computational thinker: decomposition and models', verify: true }],
    },
    levels: [
      'Opened the code view of a trigger.',
      'Read the code of three or more different triggers, including one they wrote.',
      'Predicts what a program will do before running it (needs a prediction task or a teacher-scored explanation).',
      'Traces and explains someone else\'s program in a new context (teacher-scored).',
    ],
    maxLevel: 2,
    beyond: 'Levels 3-4 need a prediction or an explanation your teacher scores (for example, annotate a trigger\'s code and say what will happen).',
  },
  {
    id: 'prog.debug',
    name: 'Testing and debugging',
    iCan: 'I can test my work, find what is broken and fix it.',
    codes: {
      idaho: [{ ...IDAHO_CS_5_2, weight: undefined, label: 'Supports: algorithms with control structures' }],
      dl: [DL_1],
      csta: [{ code: '3A-AP-21', label: 'Evaluate and refine through testing', verify: true }, { code: '2-AP-17', label: 'Systematic testing and debugging', verify: true }],
      iste: [{ code: '1.4d', label: 'Innovative designer: work with open-ended problems', verify: true }],
    },
    levels: [
      'Ran a playtest.',
      'Fixed a trigger the editor flagged as broken.',
      'Fixed two or more broken triggers and playtested afterwards.',
      'Fixed four or more problems across two or more rooms, each followed by a playtest.',
    ],
    maxLevel: 4,
  },
  {
    id: 'data.images',
    name: 'Images as data',
    iCan: 'I can explain how a picture is stored as numbers and bits.',
    codes: {
      idaho: [],
      dl: [],
      csta: [{ code: '3A-DA-09', label: 'Bit representations of data', verify: true }],
      iste: [{ code: '1.5b', label: 'Computational thinker: represent data', verify: true }],
    },
    levels: [
      'Opened "Under the hood" to see the bits behind an image.',
      'Drew pixel art (each pixel stores a 4-bit palette index).',
      'Drew pixel art, changed palette colours (the 5-bit channels) and inspected the bits.',
      'Did all of that for both a tile and a sprite, or made an animation of two or more frames.',
    ],
    maxLevel: 4,
  },
];

export function skillById(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** Every code of a skill in one list, prefixed by its set ("Idaho 9-12.CS.1.4 (E)"). */
export function codeList(s: Skill): string[] {
  const tag = (c: StandardCode): string => c.weight ? ` (${c.weight === 'essential' ? 'E' : 'S'})` : '';
  return [
    ...s.codes.idaho.map((c) => `Idaho ${c.code}${tag(c)}`),
    ...s.codes.dl.map((c) => `DL ${c.code}`),
    ...s.codes.csta.map((c) => `CSTA ${c.code}`),
    ...s.codes.iste.map((c) => `ISTE ${c.code}`),
  ];
}
