import type { SankeyNode } from './calculations/financialAnalysis';

/**
 * Vertical layout of the three-column money-flow chart (sources → income hub →
 * where it went). Shared by the financial analysis page and the Telegram report
 * image so both draw the same proportions.
 */
export interface SankeyLayoutOptions {
  height: number;
  nodePadding: number;
  padY: number;
  /** Room above the hub for its label. */
  hubLabelSpace: number;
}

export type PlacedSankeyNode<T extends SankeyNode = SankeyNode> = T & {
  /** Top of the node bar, at least 2 px tall. */
  y: number;
  h: number;
  /** Thickness of the node's flow at the hub. */
  band: number;
  /** Where the node's flow joins the hub. */
  hubY: number;
};

export interface SankeyLayout<S extends SankeyNode, T extends SankeyNode> {
  hubTop: number;
  hubHeight: number;
  sources: PlacedSankeyNode<S>[];
  targets: PlacedSankeyNode<T>[];
}

export function layoutSankey<S extends SankeyNode, T extends SankeyNode>(
  sankey: { sources: S[]; targets: T[]; total: number },
  { height, nodePadding, padY, hubLabelSpace }: SankeyLayoutOptions,
): SankeyLayout<S, T> {
  // One scale for every column, taken from the column with the least room once its gaps are removed.
  const roomFor = (count: number) => height - padY * 2 - nodePadding * Math.max(0, count - 1) - 2 * count;
  const room = Math.min(roomFor(sankey.sources.length), roomFor(sankey.targets.length), roomFor(1) - hubLabelSpace);
  const scale = sankey.total > 0 ? Math.max(0, room / sankey.total) : 0;
  const hubHeight = sankey.total * scale;
  const hubTop = (height - hubHeight + hubLabelSpace) / 2;

  function place<N extends SankeyNode>(nodes: N[]): PlacedSankeyNode<N>[] {
    const heights = nodes.map((node) => Math.max(2, node.amount * scale));
    const used = heights.reduce((sum, h) => sum + h, 0) + nodePadding * Math.max(0, nodes.length - 1);
    let y = (height - used) / 2;
    let hubY = hubTop;
    return nodes.map((node, index) => {
      const band = node.amount * scale;
      const placed = { ...node, y, h: heights[index], band, hubY };
      y += heights[index] + nodePadding;
      hubY += band;
      return placed;
    });
  }

  return { hubTop, hubHeight, sources: place(sankey.sources), targets: place(sankey.targets) };
}

/** Centre line of a flow between two columns, as a horizontal S-curve. */
export function sankeyLinkPath(x0: number, y0: number, x1: number, y1: number): string {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
}
