import { describe, expect, it } from 'vitest';
import { mergeUntouchedFields } from './formMerge';

describe('mergeUntouchedFields', () => {
  it('takes fresh values for fields the user left alone', () => {
    const baseline = { active: true, amount: '100' };
    expect(mergeUntouchedFields(baseline, baseline, { active: false, amount: '100' })).toEqual({ active: false, amount: '100' });
  });

  it('keeps what the user typed in other fields', () => {
    expect(mergeUntouchedFields(
      { active: true, name: 'Ali Valiev' },
      { active: true, name: 'Ali' },
      { active: false, name: 'Ali' },
    )).toEqual({ active: false, name: 'Ali Valiev' });
  });

  it('does not change its inputs', () => {
    const current = { active: true };
    mergeUntouchedFields(current, current, { active: false });
    expect(current).toEqual({ active: true });
  });
});
