// Project renames: the game title follows the project name until the designer
// gives it a title of its own (a fresh project's title is its name).
import type { Project } from '../../core/types';

/** Longest project name (and title-screen title, which starts as the name and follows renames). */
export const NAME_MAX_LENGTH = 60;

/** The project's name and title-screen title, stored together by a rename. */
export interface ProjectNaming {
  name: string;
  title: string;
}

/** The project's current name and title. */
export function namingOf(p: Project): ProjectNaming {
  return { name: p.name, title: p.settings.title };
}

/** What renaming `p` to `name` stores: a title still equal to the old name follows along. */
export function renamed(p: Project, name: string): ProjectNaming {
  return { name, title: p.settings.title === p.name ? name : p.settings.title };
}

/** Store a name + title pair (renames and their undo). */
export function applyNaming(p: Project, v: ProjectNaming): void {
  p.name = v.name;
  p.settings.title = v.title;
}
