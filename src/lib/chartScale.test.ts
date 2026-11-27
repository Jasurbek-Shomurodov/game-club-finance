import { describe, expect, it } from 'vitest';
import { distinctTickFormat, evenTimeTicks, flooredAxis, labelGap, niceAxis, spreadLabels, stackedValues } from './chartScale';

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe('niceAxis', () => {
  it('uses round ticks and never goes below zero for non-negative money', () => {
    expect(niceAxis([49_645, 3_105_952])).toEqual({ domain: [0, 4_000_000], ticks: [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000] });
    expect(niceAxis([148_480, 901_509]).ticks).toEqual([0, 250_000, 500_000, 750_000, 1_000_000]);
    for (const values of [[1000], [], [0, 0], [12.5, 13.2], [900_000, 901_000]]) {
      const { domain, ticks } = niceAxis(values);
      expect(ticks[0]).toBeGreaterThanOrEqual(0);
      expect(domain[1]).toBeGreaterThan(domain[0]);
      for (const value of values) expect(value >= domain[0] && value <= domain[1]).toBe(true);
    }
  });

  it('keeps a zero line and the whole range for negative values', () => {
    const { domain, ticks } = niceAxis([-500, 1200]);
    expect(ticks).toContain(0);
    expect(domain[0]).toBeLessThanOrEqual(-500);
    expect(domain[1]).toBeGreaterThanOrEqual(1200);
  });

  it('gives a short usable axis for values that differ only by floating-point noise', () => {
    for (const values of [[3.3, 3.3, 3.3000000000000003], [1000, 999.9999999999999], [1e15, 1e15 + 1], [0.1 + 0.2, 0.3]]) {
      const { domain, ticks } = niceAxis(values);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(8);
      expect(domain[1]).toBeGreaterThan(domain[0]);
    }
  });

  it('never steps by fractions of a sum', () => {
    expect(niceAxis([0, 0]).ticks).toEqual([0, 1]);
    for (const values of [[], [0], [0.4, 0.7], [12.5, 13.2]]) expect(niceAxis(values).ticks.every(Number.isInteger)).toBe(true);
  });
});

describe('flooredAxis', () => {
  it('starts exactly at the floor, with round ticks above it none of which crowds it', () => {
    const { domain, ticks } = flooredAxis([311_000, 321_000, 345_000, 328_000], 311_000);
    expect(domain[0]).toBe(311_000);
    expect(ticks[0]).toBe(311_000);
    expect(domain[1]).toBeGreaterThanOrEqual(345_000);
    expect(ticks.slice(1).every((tick) => tick % 5000 === 0 && tick > 311_000)).toBe(true);
    expect(ticks[1] - 311_000).toBeGreaterThanOrEqual((ticks[2] - ticks[1]) / 2);
  });

  it('lowers the axis to a value under the floor, and falls back without a usable floor', () => {
    expect(flooredAxis([311_000, 345_000, 253_000], 311_000).domain[0]).toBe(253_000);
    expect(flooredAxis([100, 90], 100).domain[0]).toBe(90);
    const flat = flooredAxis([100, 100], 100);
    expect(flat.domain[0]).toBe(100);
    expect(flat.domain[1]).toBeGreaterThan(100);
    expect(flooredAxis([0, 10], Number.NaN)).toEqual(niceAxis([0, 10]));
  });
});

describe('evenTimeTicks', () => {
  it('labels whole days spread evenly from the first to the last', () => {
    const year = evenTimeTicks(at('2026-01-01'), at('2026-11-23'), 5);
    expect(year).toHaveLength(5);
    expect(year[0]).toBe(at('2026-01-01'));
    expect(year[year.length - 1]).toBe(at('2026-11-23'));
    expect(year.every((tick) => tick % DAY === 0)).toBe(true);
    const gaps = year.slice(1).map((tick, index) => tick - year[index]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual((year[year.length - 1] - year[0]) / 5);
  });

  it('gives a short range one label per day at most, never a date twice', () => {
    expect(evenTimeTicks(at('2026-11-21'), at('2026-11-23'), 5)).toEqual([at('2026-11-21'), at('2026-11-22'), at('2026-11-23')]);
    expect(evenTimeTicks(at('2026-11-22'), at('2026-11-23'), 5)).toEqual([at('2026-11-22'), at('2026-11-23')]);
    expect(evenTimeTicks(at('2026-11-23'), at('2026-11-23'), 5)).toEqual([at('2026-11-23')]);
    expect(evenTimeTicks(Number.NaN, 1, 5)).toEqual([]);
    expect(evenTimeTicks(at('2026-01-01'), at('2026-11-23'), 3)).toHaveLength(3);
  });

  it('keeps a zoomed view\'s labels on whole days inside it, never on its raw edges', () => {
    // A view from 06:00 on the 10th to 18:00 on the 20th: labels from the 11th through the 20th.
    const ticks = evenTimeTicks(at('2026-11-10') + 0.25 * DAY, at('2026-11-20') + 0.75 * DAY, 4);
    expect(ticks[0]).toBe(at('2026-11-11'));
    expect(ticks[ticks.length - 1]).toBe(at('2026-11-20'));
    expect(ticks).toHaveLength(4);
    expect(ticks.every((tick) => tick % DAY === 0)).toBe(true);
    // A stretch with no midnight inside has nothing to label.
    expect(evenTimeTicks(at('2026-11-10') + 0.2 * DAY, at('2026-11-10') + 0.8 * DAY, 4)).toEqual([]);
    expect(evenTimeTicks(at('2026-11-10') + 0.2 * DAY, at('2026-11-11') + 0.1 * DAY, 4)).toEqual([at('2026-11-11')]);
  });
});

describe('spreadLabels', () => {
  const positions = (items: Array<{ key: string; value: number }>) => spreadLabels(items, [400, 440], 5).map((item) => [item.key, item.at]);

  it('places labels at their values, pushed apart in value order and kept inside the axis', () => {
    expect(positions([{ key: 'a', value: 410 }, { key: 'b', value: 430 }])).toEqual([['b', 430], ['a', 410]]);
    expect(positions([{ key: 'a', value: 427 }, { key: 'b', value: 428 }, { key: 'c', value: 426 }])).toEqual([['b', 428], ['a', 423], ['c', 418]]);
    expect(positions([{ key: 'a', value: 401 }, { key: 'b', value: 402 }, { key: 'c', value: 399 }])).toEqual([['b', 410], ['a', 405], ['c', 400]]);
    expect(positions([{ key: 'a', value: 999 }])).toEqual([['a', 440]]);
    expect(spreadLabels([], [0, 1], 1)).toEqual([]);
  });

  it('turns a pixel gap into a value gap for the plot height', () => {
    expect(labelGap([0, 1000], 240)).toBe(100);
    expect(labelGap([0, 1000], 0)).toBe(24_000);
  });
});

describe('distinctTickFormat', () => {
  it('picks the first format that tells every tick apart, else the last', () => {
    const rough = (value: number) => `${Math.round(value / 100_000) / 10}M`;
    const exact = (value: number) => String(value);
    expect(distinctTickFormat([1_000_000, 2_000_000], [rough, exact])).toBe(rough);
    expect(distinctTickFormat([1_400_000, 1_420_000], [rough, exact])).toBe(exact);
    expect(distinctTickFormat([1, 1], [rough, exact])).toBe(exact);
  });
});

describe('stackedValues', () => {
  it('reaches the top of each stack and the bottom of its negative part, a lone key as its own stack', () => {
    const rows = [
      { a: 100, b: 50, c: -20, d: null as number | null },
      { a: 10, b: -30, c: 5, d: 7 },
    ];
    expect(stackedValues(rows, [['a', 'b'], ['c']])).toEqual([150, 0, 0, -20, 10, -30, 5, 0]);
    expect(stackedValues(rows, [['d']])).toEqual([0, 0, 7, 0]);
    expect(stackedValues([], [['a']])).toEqual([]);
  });
});
