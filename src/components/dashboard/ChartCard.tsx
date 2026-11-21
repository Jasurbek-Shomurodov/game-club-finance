'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, EmptyState, HelpButton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { formatCurrency, intlLocaleFor } from '@/lib/formatters';

/**
 * Chart palette: the Tailwind tokens as CSS colours, so Recharts (which cannot
 * read Tailwind classes) stays on the design system and follows the theme.
 */
const token = (name: string, alpha?: number) => `rgb(var(--c-${name})${alpha === undefined ? '' : ` / ${alpha}`})`;

export const chartColors = {
  primary: token('primary-600'),
  success: token('success-500'),
  danger: token('danger-500'),
  warning: token('warning-500'),
  purple: token('purple-500'),
  orange: token('orange-500'),
  gray: token('gray-400'),
  axis: token('gray-500'),
  grid: token('gray-500', 0.25),
  cursor: token('gray-500', 0.12),
} as const;

/**
 * Categorical hues for charts that name several things (expense categories,
 * payment methods), in a fixed order checked for colour-blind separation in
 * both themes; none is the game club's teal, which stays its identity.
 * Assign in this order and never cycle past the end: fold the tail into
 * "other", drawn in `chartColors.gray`.
 */
export const categoricalColors = [1, 2, 3, 4, 5].map((slot) => token(`viz-${slot}`));

/** Y-axis gutter wide enough for compact labels like "4,5 млн" without clipping the first digit. */
export const CHART_Y_AXIS_WIDTH = 60;

/** Themed Recharts tooltip box; spread onto every `<Tooltip>` so it is not white in dark mode. */
export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: token('surface'),
    border: `1px solid ${token('gray-200')}`,
    borderRadius: 8,
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
    fontSize: 12,
  },
  labelStyle: { color: token('gray-950'), fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: '1px 0' },
} as const;

/** Card wrapper shared by every dashboard chart; the section is named by its heading. */
export function ChartCard({ title, description, help, action, className, children }: {
  title: string;
  description?: string;
  /** Explanation behind a "?" beside the title. */
  help?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card as="section" className={cn('flex flex-col', className)} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex items-center gap-1">
            <h2 id={headingId} className="min-w-0 break-words text-sm font-semibold text-gray-950">{title}</h2>
            {help && <HelpButton title={title} body={help} className="-my-2 shrink-0" />}
          </div>
          {description && <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function ChartEmpty({ title, className }: { title: string; className?: string }) {
  return <EmptyState compact bordered title={title} className={cn('min-h-56 border-gray-200', className)} />;
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** Compact axis tick label ("1.2M", "1,2 млн", ...) in the selected app language. */
export function formatAxis(value: number, locale: string): string {
  const tag = intlLocaleFor(locale);
  let formatter = compactFormatters.get(tag);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 });
    } catch {
      formatter = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
    }
    compactFormatters.set(tag, formatter);
  }
  return formatter.format(value);
}

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  /** How the series is drawn, so the legend swatch matches it. */
  swatch: 'line' | 'square' | 'dashed';
  icon?: LucideIcon;
  /** Range total shown beside the label, already formatted. */
  total?: string;
}

/**
 * Which series of a chart are shown, plus the one a legend pill is hovered on.
 * The last visible series cannot be hidden, so the chart is never empty.
 */
export function useSeriesVisibility() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const toggle = useCallback((key: string, allKeys: readonly string[]) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (allKeys.filter((k) => !next.has(k)).length > 1) next.add(key);
      return next;
    });
  }, []);
  // A hidden series is never the spotlight (its pill may still be under the pointer).
  return { hidden, focused: focused && !hidden.has(focused) ? focused : null, setFocused, toggle };
}

/** Opacity for a series while another legend pill is hovered. */
export function seriesOpacity(key: string, focused: string | null): number {
  return focused && focused !== key ? 0.15 : 1;
}

/** Legend whose pills show or hide each series; hovering a pill spotlights its series. */
export function ChartLegendToggle({ items, hidden, onToggle, onFocus, label }: {
  items: readonly ChartLegendItem[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onFocus: (key: string | null) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5" onMouseLeave={() => onFocus(null)}>
      {items.map((item) => {
        const off = hidden.has(item.key);
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(item.key)}
            onMouseEnter={() => !off && onFocus(item.key)}
            onFocus={() => !off && onFocus(item.key)}
            onBlur={() => onFocus(null)}
            className={cn(
              // 40px tall on phones, where the pill is the only way to show or hide a series.
              'group/pill inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none sm:min-h-9 sm:px-2.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              off
                ? 'border-dashed border-gray-300 text-gray-500 hover:text-gray-600'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100',
            )}
          >
            {Icon ? (
              <span
                aria-hidden="true"
                className="flex h-5 w-5 items-center justify-center rounded-full transition-colors motion-reduce:transition-none"
                style={{ backgroundColor: off ? 'transparent' : colorWithAlpha(item.color, 0.16), color: off ? undefined : item.color }}
              >
                <Icon size={12} strokeWidth={2.4} />
              </span>
            ) : null}
            <LegendSwatch swatch={item.swatch} color={off ? undefined : item.color} />
            <span className={cn(off && 'line-through decoration-gray-300')}>{item.label}</span>
            {item.total && !off ? <span className="tabular-nums font-semibold text-gray-950">{item.total}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function LegendSwatch({ swatch, color }: { swatch: ChartLegendItem['swatch']; color?: string }) {
  const tone = color ?? 'rgb(var(--c-gray-300))';
  if (swatch === 'square') return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: tone }} />;
  if (swatch === 'dashed') return <span aria-hidden="true" className="w-3 border-t-2 border-dashed" style={{ borderColor: tone }} />;
  return <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: tone }} />;
}

/** `rgb(var(--c-x))` → `rgb(var(--c-x) / a)`; other colour strings are returned unchanged. */
export function colorWithAlpha(color: string, alpha: number): string {
  return color.startsWith('rgb(var(') && !color.includes('/') ? color.replace(/\)$/, ` / ${alpha})`) : color;
}

interface TooltipRow {
  key: string;
  label: string;
  color: string;
  icon?: LucideIcon;
  dashed?: boolean;
}

/** Tooltip card for dashboard charts: the day, then one row per visible series with its icon. */
export function ChartTooltipBody({ active, label, payload, series, currency }: {
  active?: boolean;
  label?: ReactNode;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  series: readonly TooltipRow[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const values = new Map(payload.map((entry) => [String(entry.dataKey), entry.value]));
  const rows = series.filter((row) => typeof values.get(row.key) === 'number');
  if (!rows.length) return null;
  return (
    <div className="min-w-48 rounded-xl border border-gray-200 bg-surface/95 p-3 text-xs shadow-pop backdrop-blur">
      <p className="mb-2 font-semibold text-gray-950">{label}</p>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.key} className="flex items-center gap-2">
              {Icon ? (
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-md" style={{ backgroundColor: colorWithAlpha(row.color, 0.16), color: row.color }}>
                  <Icon size={11} strokeWidth={2.4} />
                </span>
              ) : (
                <LegendSwatch swatch={row.dashed ? 'dashed' : 'square'} color={row.color} />
              )}
              <span className="flex-1 text-gray-600">{row.label}</span>
              <span className="tabular-nums font-semibold text-gray-950">
                {formatCurrency(Number(values.get(row.key)))} <span className="font-medium text-gray-500">{currency}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Sum of a series over the range, skipping days without an entry. */
export function seriesTotal<T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
}
