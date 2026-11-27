'use client';

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chartColors } from '@/components/dashboard/ChartCard';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { SankeyNode } from '@/lib/calculations/financialAnalysis';
import type { SankeyFlowTone } from '@/lib/calculations/sankeyDrill';
import { layoutSankey, sankeyLinkPath as linkPath } from '@/lib/sankeyLayout';
import { formatCompactMoney, formatShare } from './analysisFormat';

/**
 * A flow's colour says which way the money moves, as in the finance app:
 * money in and profit kept green (kept the stronger), spending amber, a loss
 * red. Nodes keep their own colours.
 */
const FLOW_TONES: Record<SankeyFlowTone, { color: string; opacity: number }> = {
  income: { color: chartColors.success, opacity: 0.28 },
  kept: { color: chartColors.success, opacity: 0.42 },
  expense: { color: chartColors.warning, opacity: 0.36 },
  loss: { color: chartColors.danger, opacity: 0.34 },
};
/** A flow without a tone takes its node's colour at this strength. */
const NODE_FLOW_OPACITY = 0.3;
/** The flow under the pointer, the flow under a finger, and the others while one of them is lit. */
const HOVERED_OPACITY = 0.6;
const PRESSED_OPACITY = 0.75;
const DIMMED_OPACITY = 0.1;

const LAYOUT = { nodeWidth: 10, nodePadding: 14, perNode: 30, minHeight: 300, padY: 8, labelGap: 8, perColumn: 100, hubLabelSpace: 22 };

let measureCanvas: HTMLCanvasElement | undefined;
function measureLabel(text: string): number {
  if (typeof document === 'undefined') return text.length * 7;
  const context = (measureCanvas ??= document.createElement('canvas')).getContext('2d');
  if (!context) return text.length * 7;
  context.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text).width;
}

function useElementWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

/** Labels are measured with the page font; draw again once web fonts finish loading. */
function useFontsLoaded() {
  const [, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, []);
}

export interface SankeyFlowChartProps {
  /** Left and right columns around a hub of `income`; `total` is the hub's drawn height. */
  sankey: { sources: SankeyNode[]; targets: SankeyNode[]; total: number; income: number };
  hubLabel: string;
  sourceLabel: (key: string) => string;
  targetLabel: (key: string) => string;
  sourceColor: (key: string) => string;
  targetColor: (key: string) => string;
  locale: string;
  currency: string;
  /** Opens a right-hand node; nodes it returns false for stay static. */
  onTargetClick?: (key: string) => void;
  isTargetClickable?: (key: string) => boolean;
  /** Opens a left-hand node; nodes it returns false for stay static. */
  onSourceClick?: (key: string) => void;
  isSourceClickable?: (key: string) => boolean;
  /** Accessible name of a node that opens, e.g. "Open Bar sales". */
  openLabel?: (name: string) => string;
  /** Draw at least this many node rows tall, so side-by-side charts share one height. */
  minRows?: number;
  /**
   * Which way the money on a flow moves (`drillFlowTone`): the flow into the
   * hub from a source, or out of it to a target. Without it a flow takes its
   * node's colour.
   */
  flowTone?: (column: 'source' | 'target', key: string) => SankeyFlowTone;
}

/**
 * Three-column flow: income sources → total income → where it went (costs,
 * categories, profit). A tap on a flow opens the node it leads to: a flow out
 * of the hub opens its target, and a flow into the hub (which does not open)
 * its source. A finger on a flow or a node lights it, since touch has no hover.
 */
export function SankeyFlowChart({
  sankey,
  hubLabel,
  sourceLabel,
  targetLabel,
  sourceColor,
  targetColor,
  locale,
  currency,
  onTargetClick,
  isTargetClickable = () => true,
  onSourceClick,
  isSourceClickable = () => true,
  openLabel = (name) => name,
  minRows = 0,
  flowTone,
}: SankeyFlowChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  // What is lit: the flow or node under a finger, else the one under the pointer.
  const lit = pressed ?? hovered;
  const [wrapRef, measuredWidth] = useElementWidth();
  useFontsLoaded();
  const { nodeWidth, nodePadding, perNode, minHeight, padY, labelGap, perColumn, hubLabelSpace } = LAYOUT;
  const total = sankey.total;

  const label = (name: string, amount: number) => `${name} · ${formatCompactMoney(amount, locale)}`;
  const sourceText = (node: SankeyNode) => label(sourceLabel(node.key), node.amount);
  const targetText = (node: SankeyNode) => label(targetLabel(node.key), node.amount);
  const hubText = label(hubLabel, sankey.income);

  const longest = (texts: string[]) => Math.ceil(Math.max(0, ...texts.map(measureLabel))) + labelGap + 6;
  const marginLeft = longest(sankey.sources.map(sourceText));
  const marginRight = longest(sankey.targets.map(targetText));
  const middle = longest([hubText]);
  // The hub label is centred above the hub, so each half of the middle needs half of it.
  const width = Math.max(marginLeft + marginRight + 2 * Math.max(perColumn, middle / 2 + 16), measuredWidth);
  const height = Math.max(minHeight, (Math.max(sankey.sources.length, sankey.targets.length, minRows) + 2) * perNode);

  const { hubTop, hubHeight, sources, targets } = layoutSankey(sankey, { height, nodePadding, padY, hubLabelSpace });
  const leftX = marginLeft;
  const rightX = width - marginRight - nodeWidth;
  const hubX = Math.round((leftX + rightX) / 2);

  const flowLook = (column: 'source' | 'target', key: string, nodeColor: string) => {
    const tone = flowTone ? FLOW_TONES[flowTone(column, key)] : null;
    const id = `${column === 'source' ? 's' : 't'}-${key}`;
    const base = tone?.opacity ?? NODE_FLOW_OPACITY;
    return {
      stroke: tone?.color ?? nodeColor,
      strokeOpacity: pressed === id ? PRESSED_OPACITY : lit === id ? HOVERED_OPACITY : lit ? DIMMED_OPACITY : base,
    };
  };
  const release = () => setPressed(null);
  // Hover for a mouse only (the mouse events a browser emulates after a tap would leave a flow lit); for a finger or
  // a pen, the pressed state while it is down (a scroll cancels it).
  const hover = (key: string) => ({
    onPointerEnter: (event: PointerEvent<SVGElement>) => {
      if (event.pointerType === 'mouse') setHovered(key);
    },
    onPointerLeave: (event: PointerEvent<SVGElement>) => {
      if (event.pointerType === 'mouse') setHovered(null);
      else release();
    },
    onPointerDown: (event: PointerEvent<SVGElement>) => {
      if (event.pointerType !== 'mouse') setPressed(key);
    },
    onPointerUp: release,
    onPointerCancel: release,
  });
  const sourceOpens = (key: string) => Boolean(onSourceClick) && isSourceClickable(key);
  const targetOpens = (key: string) => Boolean(onTargetClick) && isTargetClickable(key);
  const flowClick = (opens: boolean, open: () => void) => ({
    className: cn('transition-[stroke-opacity] motion-reduce:transition-none', opens && 'cursor-pointer'),
    onClick: opens ? open : undefined,
  });
  // A node that opens is a button: a click, Enter or Space opens it.
  const nodeButton = (opens: boolean, open: () => void, name: string) => (opens ? {
    role: 'button',
    tabIndex: 0,
    'aria-label': openLabel(name),
    className: 'cursor-pointer outline-none [&:focus-visible>rect]:stroke-current [&:focus-visible>rect]:stroke-2 [&:focus-visible>rect]:text-gray-950',
    onClick: open,
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    },
  } : {});
  const money = (amount: number) => `${formatCurrency(amount)} ${currency}`;
  const share = (amount: number) => formatShare((amount / total) * 100, locale);

  // Buttons inside an image would be hidden from screen readers, so a chart that opens is a group.
  return (
    // Labels are measured with a canvas, so the chart is drawn only on the client
    // once its width is known; the server renders a same-height placeholder.
    <div ref={wrapRef} className="-mx-1 overflow-x-auto px-1" style={measuredWidth ? undefined : { height }}>
      {measuredWidth > 0 && (
        // Proportional digits, as the canvas measures them; the body's tabular digits are wider and clip labels.
        <svg width={width} height={height} className="block [font-variant-numeric:normal]" role={onSourceClick || onTargetClick ? 'group' : 'img'} aria-label={hubLabel}>
          {sources.map((node) => (
            <path
              key={`ls-${node.key}`}
              d={linkPath(leftX + nodeWidth, node.y + node.h / 2, hubX, node.hubY + node.band / 2)}
              fill="none"
              {...flowLook('source', node.key, sourceColor(node.key))}
              strokeWidth={Math.max(1, node.band)}
              {...hover(`s-${node.key}`)}
              {...flowClick(sourceOpens(node.key), () => onSourceClick?.(node.key))}
            >
              <title>{`${sourceLabel(node.key)} → ${hubLabel}: ${money(node.amount)} (${share(node.amount)})`}</title>
            </path>
          ))}
          {targets.map((node) => (
            <path
              key={`lt-${node.key}`}
              d={linkPath(hubX + nodeWidth, node.hubY + node.band / 2, rightX, node.y + node.h / 2)}
              fill="none"
              {...flowLook('target', node.key, targetColor(node.key))}
              strokeWidth={Math.max(1, node.band)}
              {...hover(`t-${node.key}`)}
              {...flowClick(targetOpens(node.key), () => onTargetClick?.(node.key))}
            >
              <title>{`${hubLabel} → ${targetLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
            </path>
          ))}

          {sources.map((node) => (
            <g
              key={`s-${node.key}`}
              {...hover(`s-${node.key}`)}
              {...nodeButton(sourceOpens(node.key), () => onSourceClick?.(node.key), sourceLabel(node.key))}
            >
              <title>{`${sourceLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
              <rect x={leftX} y={node.y} width={nodeWidth} height={node.h} rx={3} fill={sourceColor(node.key)} />
              <text
                x={leftX - labelGap}
                y={node.y + node.h / 2}
                dy="0.35em"
                textAnchor="end"
                className={cn('fill-current text-[12px] font-semibold text-gray-800', lit && lit !== `s-${node.key}` && 'opacity-50')}
              >
                {sourceText(node)}
              </text>
            </g>
          ))}

          <rect x={hubX} y={hubTop} width={nodeWidth} height={hubHeight} rx={3} className="fill-current text-gray-800" />
          <text
            x={hubX + nodeWidth / 2}
            y={hubTop - labelGap}
            textAnchor="middle"
            className="fill-current text-[12px] font-bold text-gray-950"
          >
            {hubText}
          </text>

          {targets.map((node) => (
            <g
              key={`t-${node.key}`}
              {...hover(`t-${node.key}`)}
              {...nodeButton(targetOpens(node.key), () => onTargetClick?.(node.key), targetLabel(node.key))}
            >
              <title>{`${targetLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
              <rect x={rightX} y={node.y} width={nodeWidth} height={node.h} rx={3} fill={targetColor(node.key)} />
              <text
                x={rightX + nodeWidth + labelGap}
                y={node.y + node.h / 2}
                dy="0.35em"
                className={cn('fill-current text-[12px] font-semibold text-gray-800', lit && lit !== `t-${node.key}` && 'opacity-50')}
              >
                {targetText(node)}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
