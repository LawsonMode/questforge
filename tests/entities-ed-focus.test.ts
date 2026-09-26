import { describe, expect, it } from 'vitest';
import { hasTriggerFocus, requestEntityFocus, requestTriggerFocus, takeEntityFocus, takeTriggerFocus } from '../src/editor/entities/focus';

describe('jump-to requests', () => {
  it('hands an entity request to its room once, and drops it for another room', () => {
    requestEntityFocus('r1', 'e1');
    expect(takeEntityFocus('r1')).toBe('e1');
    expect(takeEntityFocus('r1')).toBeNull();
    requestEntityFocus('r1', 'e2');
    expect(takeEntityFocus('r2')).toBeNull();
    expect(takeEntityFocus('r1')).toBeNull();
  });

  it('keeps a trigger request until its room takes it', () => {
    requestTriggerFocus('r1', 't1');
    expect(hasTriggerFocus('r2')).toBe(false);
    expect(takeTriggerFocus('r2')).toBeNull();
    expect(hasTriggerFocus('r1')).toBe(true);
    expect(takeTriggerFocus('r1')).toBe('t1');
    expect(hasTriggerFocus('r1')).toBe(false);
  });
});
