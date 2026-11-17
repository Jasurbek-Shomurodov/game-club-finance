import { describe, expect, it } from 'vitest';
import { sparklinePaths } from './Sparkline';

describe('sparklinePaths', () => {
  it('spreads the values across the box, highest at the top', () => {
    const paths = sparklinePaths([0, 10, 5], 100, 20, 0);
    expect(paths?.line).toBe('M0 20 L50 0 L100 10');
    expect(paths?.area).toBe('M0 20 L50 0 L100 10 L100 20 L0 20 Z');
  });

  it('insets by the padding so the stroke is not clipped', () => {
    expect(sparklinePaths([1, 3], 100, 20, 2)?.line).toBe('M2 18 L98 2');
  });

  it('draws a flat series through the middle', () => {
    expect(sparklinePaths([7, 7, 7], 90, 30, 0)?.line).toBe('M0 15 L45 15 L90 15');
  });

  it('draws nothing from fewer than two usable values', () => {
    expect(sparklinePaths([], 100, 20)).toBeNull();
    expect(sparklinePaths([5], 100, 20)).toBeNull();
    expect(sparklinePaths([5, Number.NaN], 100, 20)).toBeNull();
  });
});
