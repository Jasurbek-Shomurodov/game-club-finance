import { describe, expect, it } from 'vitest';
import { clampMonths, MAX_RANGE_DAYS, resolveRange, trendWindow } from './ranges';

describe('resolveRange', () => {
  it('defaults to the current business month through today', () => {
    expect(resolveRange(undefined, undefined, '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });

  it('never ends after the business date', () => {
    expect(resolveRange('2026-10-01', '2026-12-31', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });

  it('rejects impossible or reversed dates', () => {
    expect(resolveRange('2026-02-30', undefined, '2026-10-15')).toHaveProperty('error');
    expect(resolveRange('15.10.2026', undefined, '2026-10-15')).toHaveProperty('error');
    expect(resolveRange('2026-10-20', undefined, '2026-10-15')).toHaveProperty('error');
  });

  it(`rejects periods longer than ${MAX_RANGE_DAYS} days`, () => {
    expect(resolveRange('2025-01-01', '2026-01-02', '2026-10-15')).toHaveProperty('error');
    expect(resolveRange('2025-01-01', '2025-12-31', '2026-10-15')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('trendWindow', () => {
  it('starts on the first day of the earliest month, across years', () => {
    expect(trendWindow('2026-02-10', 3)).toEqual({ from: '2025-12-01', to: '2026-02-10' });
    expect(trendWindow('2026-10-15', 1)).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });
});

describe('clampMonths', () => {
  it('defaults to a year and stays within 1–24', () => {
    expect(clampMonths(undefined)).toBe(12);
    expect(clampMonths(0)).toBe(1);
    expect(clampMonths(99)).toBe(24);
  });
});
