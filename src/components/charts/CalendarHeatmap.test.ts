import { describe, expect, it } from 'vitest';
import { inkForLuminance } from './CalendarHeatmap';

describe('inkForLuminance', () => {
  it('uses light ink on a dark fill', () => {
    expect(inkForLuminance(0.11)).toBe('light');
  });

  it('uses dark ink on a light or mid fill', () => {
    expect(inkForLuminance(0.31)).toBe('dark');
    expect(inkForLuminance(0.9)).toBe('dark');
  });
});
