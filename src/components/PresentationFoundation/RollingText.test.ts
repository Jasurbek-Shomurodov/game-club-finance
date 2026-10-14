import { describe, expect, it } from 'vitest';
import { rollingColumns } from './RollingText';

describe('rollingColumns', () => {
  it('keys characters from the right so a digit keeps its column as the figure grows', () => {
    expect(rollingColumns('9').map((item) => item.key)).toEqual([1]);
    expect(rollingColumns('10').map((item) => [item.key, item.digit])).toEqual([[2, 1], [1, 0]]);
  });

  it('leaves separators and signs as static characters', () => {
    expect(rollingColumns('-1 000').map((item) => item.digit)).toEqual([null, 1, null, 0, 0, 0]);
  });
});
