// Activity manifest: every learning moment Questforge records, with the skills
// it is evidence for. Standards are mapped HERE, not inside each event (Quark's
// rule: an app declares activity → standards once, the teacher approves the
// mapping, and an event can never claim a standard by itself).
//
// Ids are permanent like tile ids: add new ones, never rename or reuse.
import type { SkillId } from './standards';

/** Quark's fixed verb set (xAPI-lite). */
export type Verb =
  | 'attempted' | 'completed' | 'failed'
  | 'submitted' | 'explained' | 'created' | 'compared' | 'evaluated';

export type ActivityId =
  | 'qf.trigger.built'
  | 'qf.trigger.fixed'
  | 'qf.code.viewed'
  | 'qf.playtest.run'
  | 'qf.pixels.inspected'
  | 'qf.pixels.drawn'
  | 'qf.palette.edited'
  | 'qf.project.exported';

export interface ActivityInfo {
  id: ActivityId;
  verb: Verb;
  label: string;
  /** What the student did, for the teacher. */
  description: string;
  skills: readonly SkillId[];
  /** True when events carry the student's work itself (code, pixels) in result.response. */
  workSample: boolean;
}

export const ACTIVITIES: readonly ActivityInfo[] = [
  {
    id: 'qf.trigger.built', verb: 'created', label: 'Built a trigger',
    description: 'A trigger that works (no editor warnings, at least one action). The event holds its code and what it uses.',
    skills: ['prog.io', 'prog.selection', 'prog.sequence'], workSample: true,
  },
  {
    id: 'qf.trigger.fixed', verb: 'completed', label: 'Fixed a broken trigger',
    description: 'A trigger the editor flagged as broken now works. The event holds the fixed code.',
    skills: ['prog.debug'], workSample: true,
  },
  {
    id: 'qf.code.viewed', verb: 'completed', label: 'Read a trigger as code',
    description: 'Opened the code view of a trigger.',
    skills: ['prog.trace'], workSample: false,
  },
  {
    id: 'qf.playtest.run', verb: 'attempted', label: 'Playtested',
    description: 'Ran the game from the editor to test their work.',
    skills: ['prog.debug', 'prog.io', 'prog.selection', 'prog.sequence'], workSample: false,
  },
  {
    id: 'qf.pixels.inspected', verb: 'completed', label: 'Looked under the hood of an image',
    description: 'Opened the bits-and-bytes view of a tile or sprite.',
    skills: ['data.images'], workSample: false,
  },
  {
    id: 'qf.pixels.drawn', verb: 'created', label: 'Drew pixel art',
    description: 'Changed the pixels of a tile or sprite. The event holds the first frame as hex digits.',
    skills: ['data.images'], workSample: true,
  },
  {
    id: 'qf.palette.edited', verb: 'created', label: 'Changed palette colours',
    description: 'Changed a colour of a palette (5 bits per red, green and blue channel).',
    skills: ['data.images'], workSample: true,
  },
  {
    id: 'qf.project.exported', verb: 'submitted', label: 'Exported a project',
    description: 'Saved the project as a .questforge.json file to share or turn in.',
    skills: [], workSample: false,
  },
];

export function activityInfo(id: string): ActivityInfo | undefined {
  return ACTIVITIES.find((a) => a.id === id);
}
