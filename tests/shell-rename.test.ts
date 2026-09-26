import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../src/core/project';
import { applyNaming, namingOf, renamed } from '../src/editor/shell/rename';

describe('project renames', () => {
  it('keeps an untouched title in step with the name', () => {
    const p = createBlankProject('My Adventure');
    const before = namingOf(p);
    applyNaming(p, renamed(p, 'Emberfall Quest'));
    expect(namingOf(p)).toEqual({ name: 'Emberfall Quest', title: 'Emberfall Quest' });
    applyNaming(p, before);
    expect(namingOf(p)).toEqual({ name: 'My Adventure', title: 'My Adventure' });
  });

  it('leaves a title of its own alone', () => {
    const p = createBlankProject('Draft');
    p.settings.title = 'The Hollow Road';
    expect(renamed(p, 'Final')).toEqual({ name: 'Final', title: 'The Hollow Road' });
  });
});
