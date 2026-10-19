'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { AnalysisSankey, SankeyNode } from '@/lib/calculations/financialAnalysis';
import { layoutSankey, sankeyLinkPath as linkPath } from '@/lib/sankeyLayout';
import { formatCompactMoney, formatShare } from './analysisFormat';

const LAYOUT = { nodeWidth: 10, nodePadding: 14, perNode: 30, minHeight: 300, padY: 8, labelGap: 8, perColumn: 120, hubLabelSpace: 22 };

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

export interface SankeyFlowChartProps {
  sankey: AnalysisSankey;
  hubLabel: string;
  sourceLabel: (key: string) => string;
  targetLabel: (key: string) => string;
  sourceColor: (key: string) => string;
  targetColor: (key: string) => string;
  locale: string;
  currency: string;
  /** Opens the details of a right-hand node; nodes it returns false for stay static. */
  onTargetClick?: (key: string) => void;
  isTargetClickable?: (key: string) => boolean;
}

/** Three-column flow: income sources → total income → where it went (costs, categories, profit). */
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
}: SankeyFlowChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [wrapRef, measuredWidth] = useElementWidth();
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
  const height = Math.max(minHeight, (Math.max(sankey.sources.length, sankey.targets.length) + 2) * perNode);

  const { hubTop, hubHeight, sources, targets } = layoutSankey(sankey, { height, nodePadding, padY, hubLabelSpace });
  const leftX = marginLeft;
  const rightX = width - marginRight - nodeWidth;
  const hubX = Math.round((leftX + rightX) / 2);

  const linkOpacity = (key: string) => (hovered === key ? 0.55 : hovered ? 0.12 : 0.3);
  const hover = (key: string) => ({ onMouseEnter: () => setHovered(key), onMouseLeave: () => setHovered(null) });
  const clickable = (key: string) => Boolean(onTargetClick) && isTargetClickable(key);
  const targetClick = (key: string) => (clickable(key) ? { onClick: () => onTargetClick?.(key) } : {});
  const money = (amount: number) => `${formatCurrency(amount)} ${currency}`;
  const share = (amount: number) => formatShare((amount / total) * 100, locale);

  return (
    // Labels are measured with a canvas, so the chart is drawn only on the client
    // once its width is known; the server renders a same-height placeholder.
    <div ref={wrapRef} className="-mx-1 overflow-x-auto px-1" style={measuredWidth ? undefined : { height }}>
      {measuredWidth > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label={hubLabel}>
          {sources.map((node) => (
            <path
              key={`ls-${node.key}`}
              d={linkPath(leftX + nodeWidth, node.y + node.h / 2, hubX, node.hubY + node.band / 2)}
              fill="none"
              stroke={sourceColor(node.key)}
              strokeWidth={Math.max(1, node.band)}
              strokeOpacity={linkOpacity(`s-${node.key}`)}
              className="transition-[stroke-opacity]"
              {...hover(`s-${node.key}`)}
            >
              <title>{`${sourceLabel(node.key)} → ${hubLabel}: ${money(node.amount)} (${share(node.amount)})`}</title>
            </path>
          ))}
          {targets.map((node) => (
            <path
              key={`lt-${node.key}`}
              d={linkPath(hubX + nodeWidth, node.hubY + node.band / 2, rightX, node.y + node.h / 2)}
              fill="none"
              stroke={targetColor(node.key)}
              strokeWidth={Math.max(1, node.band)}
              strokeOpacity={linkOpacity(`t-${node.key}`)}
              className={cn('transition-[stroke-opacity]', clickable(node.key) && 'cursor-pointer')}
              {...hover(`t-${node.key}`)}
              {...targetClick(node.key)}
            >
              <title>{`${hubLabel} → ${targetLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
            </path>
          ))}

          {sources.map((node) => (
            <g key={`s-${node.key}`} {...hover(`s-${node.key}`)}>
              <title>{`${sourceLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
              <rect x={leftX} y={node.y} width={nodeWidth} height={node.h} rx={3} fill={sourceColor(node.key)} />
              <text
                x={leftX - labelGap}
                y={node.y + node.h / 2}
                dy="0.35em"
                textAnchor="end"
                className={cn('fill-current text-[12px] font-semibold text-gray-800', hovered && hovered !== `s-${node.key}` && 'opacity-50')}
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
              className={clickable(node.key) ? 'cursor-pointer' : undefined}
              {...hover(`t-${node.key}`)}
              {...targetClick(node.key)}
            >
              <title>{`${targetLabel(node.key)}: ${money(node.amount)} (${share(node.amount)})`}</title>
              <rect x={rightX} y={node.y} width={nodeWidth} height={node.h} rx={3} fill={targetColor(node.key)} />
              <text
                x={rightX + nodeWidth + labelGap}
                y={node.y + node.h / 2}
                dy="0.35em"
                className={cn('fill-current text-[12px] font-semibold text-gray-800', hovered && hovered !== `t-${node.key}` && 'opacity-50')}
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
