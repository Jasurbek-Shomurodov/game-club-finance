import { colorWithAlpha } from '@/components/dashboard/ChartCard';
import { labelGap, spreadLabels } from '@/lib/chartScale';

/** One line's end label: where it sits on the value axis (from `spreadLabels`), its text and its line's colour. */
export interface EndLabel {
  at: number;
  text: string;
  color: string;
}

const CHAR_WIDTH = 7.4;
const PILL_PADDING = 22;

/** Room the end-label axis needs for its longest label; zero without labels. */
export function endLabelWidth(labels: readonly EndLabel[]): number {
  return labels.length ? Math.ceil(Math.max(...labels.map((label) => label.text.length)) * CHAR_WIDTH + PILL_PADDING) : 0;
}

/**
 * The tick of the end-label axis (`chartEndAxis`): each line's latest figure
 * as a pill in the line's colour, at the position `spreadLabels` gave it.
 */
export function EndLabelTick({ x, y, payload, labels }: { x?: number; y?: number; payload?: { value: number }; labels: readonly EndLabel[] }) {
  const label = labels.find((item) => item.at === payload?.value);
  if (!label || x === undefined || y === undefined) return null;
  const width = endLabelWidth([label]) - 8;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={-11} width={width} height={22} rx={11} fill={colorWithAlpha(label.color, 0.14)} stroke={colorWithAlpha(label.color, 0.4)} />
      <text x={width / 2} y={0} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={600} fill={label.color} className="tabular-nums">
        {label.text}
      </text>
    </g>
  );
}

/** The fade under a lead area, top to bottom. Plain SVG, so it sits inside any Recharts chart. */
export function ChartGradient({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.28} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/**
 * End labels for a chart: each line's latest value, formatted, at a position
 * on `domain` spread so labels stay about 24px apart on a plot `plotHeight`
 * pixels tall. Lines without a finite latest value get no label.
 */
export function endLabelsFor(
  lines: ReadonlyArray<{ value: number | null | undefined; color: string }>,
  domain: [number, number],
  plotHeight: number,
  format: (value: number) => string,
): EndLabel[] {
  const drawn = lines.flatMap((line) => (typeof line.value === 'number' && Number.isFinite(line.value) ? [{ value: line.value, color: line.color }] : []));
  return spreadLabels(drawn, domain, labelGap(domain, plotHeight)).map((item) => ({ at: item.at, color: item.color, text: format(item.value) }));
}
