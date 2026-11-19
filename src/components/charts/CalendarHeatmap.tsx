'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
import { buildMonthCalendar } from '@/lib/calculations/insights';
import { colorWithAlpha } from '@/components/dashboard/ChartCard';
import { weekdayShortNames } from './chartFormat';

const LEVEL_ALPHA = [0, 0.22, 0.42, 0.66, 1] as const;

/**
 * The month as a calendar, each day shaded by its amount relative to the
 * month's best day (one hue, light to dark). Days still ahead are outlined
 * only. Every day carries its exact amount in its name and tooltip.
 */
export function CalendarHeatmap({ yearMonth, values, through, today, color, currency, locale, onSelectDay, selectableThrough, legendLow, legendHigh }: {
  yearMonth: string;
  values: ReadonlyMap<string, number>;
  /** Last day with data; later days are drawn as not yet happened. */
  through: string | null;
  today: string;
  color: string;
  currency: string;
  locale: string;
  onSelectDay?: (date: string) => void;
  /**
   * Days after `through` up to this date can still be opened (the business
   * today before it has an entry). Without it only days with data open.
   */
  selectableThrough?: string;
  legendLow: string;
  legendHigh: string;
}) {
  const weeks = useMemo(() => buildMonthCalendar(yearMonth, values, through), [yearMonth, values, through]);
  const weekdays = useMemo(() => weekdayShortNames(locale), [locale]);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {weekdays.map((name) => <span key={name} className="truncate">{name}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map((cell, index) => {
          if (!cell) return <span key={`empty-${index}`} aria-hidden="true" />;
          const label = `${formatDateOnly(cell.date, locale)}: ${cell.value === null ? '—' : `${formatCurrency(cell.value)} ${currency}`}`;
          const strong = cell.level >= 3;
          const selectable = Boolean(onSelectDay) && (cell.value !== null || (selectableThrough !== undefined && cell.date <= selectableThrough));
          const className = cn(
            'relative flex h-8 items-center justify-center rounded-md text-[11px] font-medium tabular-nums transition-transform',
            cell.value === null ? 'border border-dashed border-gray-200 text-gray-300' : 'text-gray-700',
            strong && 'text-white',
            cell.date === today && 'ring-2 ring-gray-950/70 ring-offset-1 ring-offset-surface',
            selectable && 'hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          );
          const style = cell.value === null
            ? undefined
            : { backgroundColor: cell.level === 0 ? 'rgb(var(--c-gray-100))' : colorWithAlpha(color, LEVEL_ALPHA[cell.level]) };
          return onSelectDay && selectable ? (
            <button key={cell.date} type="button" title={label} aria-label={label} className={className} style={style} onClick={() => onSelectDay(cell.date)}>
              {cell.day}
            </button>
          ) : (
            <span key={cell.date} title={label} aria-label={label} role="img" className={className} style={style}>
              {cell.day}
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-gray-400" aria-hidden="true">
        <span>{legendLow}</span>
        {LEVEL_ALPHA.map((alpha, level) => (
          <span
            key={level}
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: level === 0 ? 'rgb(var(--c-gray-100))' : colorWithAlpha(color, alpha) }}
          />
        ))}
        <span>{legendHigh}</span>
      </div>
    </div>
  );
}
