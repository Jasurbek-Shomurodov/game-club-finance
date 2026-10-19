import { describe, expect, it } from 'vitest';
import { layoutSankey, sankeyLinkPath } from './sankeyLayout';

const options = { height: 300, nodePadding: 14, padY: 8, hubLabelSpace: 22 };

describe('sankey layout', () => {
  it('scales every column to the same hub and stacks flows along it', () => {
    const layout = layoutSankey({
      sources: [{ key: 'a', amount: 300 }, { key: 'b', amount: 100 }],
      targets: [{ key: 'x', amount: 150 }, { key: 'y', amount: 50 }, { key: 'z', amount: 200 }],
      total: 400,
    }, options);

    // The three-node column has the least room: 300 - 16 - 28 - 6 = 250 px for 400.
    expect(layout.hubHeight).toBeCloseTo(250);
    expect(layout.hubTop).toBeCloseTo((300 - 250 + 22) / 2);
    expect(layout.sources.map((node) => node.band)).toEqual([187.5, 62.5]);
    expect(layout.targets[1].hubY).toBeCloseTo(layout.hubTop + 93.75);
    expect(layout.targets[2].y).toBeCloseTo(layout.targets[1].y + layout.targets[1].h + 14);
    // Flows into the hub add up to it.
    const last = layout.targets[2];
    expect(last.hubY + last.band).toBeCloseTo(layout.hubTop + layout.hubHeight);
  });

  it('keeps tiny nodes visible and an empty chart flat', () => {
    const tiny = layoutSankey({ sources: [{ key: 'a', amount: 1_000_000 }], targets: [{ key: 'x', amount: 1 }, { key: 'y', amount: 999_999 }], total: 1_000_000 }, options);
    expect(tiny.targets[0].h).toBe(2);

    const empty = layoutSankey({ sources: [], targets: [], total: 0 }, options);
    expect(empty.hubHeight).toBe(0);
    expect(empty.sources).toEqual([]);
  });

  it('draws a horizontal S-curve between columns', () => {
    expect(sankeyLinkPath(0, 10, 100, 50)).toBe('M0,10 C50,10 50,50 100,50');
  });
});
