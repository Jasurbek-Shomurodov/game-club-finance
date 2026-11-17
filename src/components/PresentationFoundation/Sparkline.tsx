import { cn } from '@/lib/utils';

/**
 * The line and the area under it for `values`, as SVG path data in a
 * `width` x `height` box. The lowest value sits on the bottom edge and the
 * highest on the top (inset by `pad` so the stroke is not clipped); a flat
 * series runs through the middle. Null with fewer than two values.
 */
export function sparklinePaths(
  values: readonly number[],
  width: number,
  height: number,
  pad = 1.5,
): { line: string; area: string } | null {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = (width - pad * 2) / (points.length - 1);
  const round = (value: number) => Math.round(value * 100) / 100;
  const coordinates = points.map((value, index) => [
    round(pad + index * step),
    round(span === 0 ? height / 2 : pad + (1 - (value - min) / span) * (height - pad * 2)),
  ]);
  const line = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const [firstX] = coordinates[0];
  const [lastX] = coordinates[coordinates.length - 1];
  return { line, area: `${line} L${lastX} ${height} L${firstX} ${height} Z` };
}

export interface SparklineProps {
  values: readonly number[];
  /** What the line shows, for screen readers; omit when the card already says it. */
  label?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * A tiny trend line for a KPI card: shape only, no axes or numbers. It takes
 * the text colour of its container (`currentColor`), so tone classes colour it.
 */
export function Sparkline({ values, label, width = 96, height = 32, className }: SparklineProps) {
  const paths = sparklinePaths(values, width, height);
  if (!paths) return null;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('shrink-0 overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="none"
    >
      <path d={paths.area} fill="currentColor" opacity={0.12} />
      <path d={paths.line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
