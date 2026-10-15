// Tests for how a selected period follows the club's business period.

import { describe, expect, it } from 'vitest';
import { followBusinessPeriod } from './businessPeriod';

describe('followBusinessPeriod', () => {
  it('rolls an untouched selection forward to the new period', () => {
    expect(followBusinessPeriod('2026-10-14', '2026-10-14', '2026-10-15', false)).toBe('2026-10-15');
  });

  it('keeps a period the user picked on rollover', () => {
    expect(followBusinessPeriod('2026-10-01', '2026-10-14', '2026-10-15', false)).toBe('2026-10-01');
  });

  it('opens the current period on a club switch', () => {
    expect(followBusinessPeriod('2026-09', '2026-10', '2026-10', true)).toBe('2026-10');
  });

  it('compares ranges by value and keeps the same object when nothing moves', () => {
    const same = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from === b.from && a.to === b.to;
    const selected = { from: '2026-10-01', to: '2026-10-15' };
    expect(followBusinessPeriod(selected, { from: '2026-10-01', to: '2026-10-15' }, { from: '2026-10-01', to: '2026-10-15' }, true, same)).toBe(selected);
    expect(followBusinessPeriod(selected, { from: '2026-10-01', to: '2026-10-15' }, { from: '2026-10-01', to: '2026-10-16' }, false, same))
      .toEqual({ from: '2026-10-01', to: '2026-10-16' });
  });
});
