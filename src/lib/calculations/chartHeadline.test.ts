import { describe, expect, it } from 'vitest';
import { changePercent, periodChange, seriesChange, seriesEnds } from './chartHeadline';

describe('periodChange', () => {
  it('is the last value minus the first', () => {
    expect(periodChange(100, 150)).toBe(50);
    expect(periodChange(150, 100)).toBe(-50);
    expect(periodChange(0, 0)).toBe(0);
  });

  it('is null when either end is missing', () => {
    expect(periodChange(null, 10)).toBeNull();
    expect(periodChange(10, undefined)).toBeNull();
    expect(periodChange(Number.NaN, 10)).toBeNull();
  });
});

describe('changePercent', () => {
  it('is the change as a share of the opening value', () => {
    expect(changePercent(150, 50)).toBeCloseTo(0.5);
    expect(changePercent(75, -25)).toBeCloseTo(-0.25);
  });

  it('is null without a change or a positive opening value', () => {
    expect(changePercent(100, null)).toBeNull();
    // Opened at zero: any rise would be an infinite percentage.
    expect(changePercent(100, 100)).toBeNull();
    // Opened below zero: the sign of a percentage would mislead.
    expect(changePercent(50, 150)).toBeNull();
    expect(changePercent(Number.NaN, 10)).toBeNull();
  });
});

describe('seriesEnds and seriesChange', () => {
  it('skips days without an entry at either end', () => {
    expect(seriesEnds([null, 200, undefined, 300, null])).toEqual({ first: 200, last: 300 });
    expect(seriesEnds([null, undefined])).toBeNull();
  });

  it('measures the move from the first to the last value', () => {
    expect(seriesChange([null, 200, 250, 300])).toEqual({ amount: 100, percent: 0.5 });
    expect(seriesChange([400, 100])).toEqual({ amount: -300, percent: -0.75 });
    expect(seriesChange([0, 100])).toEqual({ amount: 100, percent: null });
  });

  it('has no change for fewer than two values', () => {
    expect(seriesChange([])).toBeNull();
    expect(seriesChange([null, 5])).toBeNull();
  });
});
