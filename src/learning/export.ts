// The learning export: one JSON file a student turns in (or Quark imports):
// the activity manifest and skill catalog it was recorded under, the proposed
// levels with their evidence, and every event. Schema `questforge.learning/1`.
import { version as APP_VERSION } from '../../package.json';
import { ACTIVITIES } from './activities';
import { proposeLevels, type SkillLevel } from './levels';
import type { LearningEvent } from './log';
import { SKILLS, STANDARDS_VERSION, type Skill } from './standards';

export interface LearningExport {
  schema: 'questforge.learning/1';
  app: { id: 'questforge'; version: string };
  standardsVersion: string;
  exportedAt: string;
  /** Quark student id once signed in; null for a local export. */
  actor: string | null;
  skills: readonly Pick<Skill, 'id' | 'name' | 'iCan' | 'codes' | 'levels' | 'maxLevel'>[];
  manifest: typeof ACTIVITIES;
  /** Proposed by the app; the teacher confirms. */
  proposed: SkillLevel[];
  events: LearningEvent[];
}

export function buildLearningExport(events: readonly LearningEvent[], now = new Date()): LearningExport {
  return {
    schema: 'questforge.learning/1',
    app: { id: 'questforge', version: APP_VERSION },
    standardsVersion: STANDARDS_VERSION,
    exportedAt: now.toISOString(),
    actor: null,
    skills: SKILLS.map(({ id, name, iCan, codes, levels, maxLevel }) => ({ id, name, iCan, codes, levels, maxLevel })),
    manifest: ACTIVITIES,
    proposed: proposeLevels(events),
    events: [...events],
  };
}

/** Download the export as `questforge-learning-<date>.json`. */
export function downloadLearningExport(events: readonly LearningEvent[]): void {
  const data = buildLearningExport(events);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `questforge-learning-${data.exportedAt.slice(0, 10)}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
