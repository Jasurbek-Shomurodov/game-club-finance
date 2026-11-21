'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
import { buildMonthCalendar } from '@/lib/calculations/insights';
import { colorWithAlpha } from '@/components/dashboard/ChartCard';
import { weekdayShortNames } from './chartFormat';

const LEVEL_ALPHA = [0, 0.22, 0.42, 0.66, 1] as const;

type Ink = 'dark' | 'light';
const INK_CLASS: Record<Ink, string> = { dark: 'text-panel', light: 'text-on-panel' };
const DARK_INK_LUMINANCE = 0.006;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: number[]): number {
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function parseRgb(value: string): number[] | null {
  const parts = value.match(/[\d.]+/g)?.map(Number);
  return parts && parts.length >= 3 ? parts.slice(0, 3) : null;
}

/** Dark or light ink for a day number, whichever reads better on a fill of this luminance. */
export function inkForLuminance(fill: number): Ink {
  const withLight = 1.05 / (fill + 0.05);
  const withDark = (fill + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return withDark >= withLight ? 'dark' : 'light';
}

/**
 * The ink for each shade level. The fill is a theme token at some alpha over
 * the card, so the readable ink depends on the hue and the theme (white on the
 * blue in light mode, dark on the orange, dark on both in dark mode); it is
 * measured from the resolved colours instead of guessed per colour.
 */
function useLevelInks(color: string): readonly (Ink | null)[] {
  const [inks, setInks] = useState<readonly (Ink | null)[]>(() => LEVEL_ALPHA.map(() => null));
  useEffect(() => {
    const measure = () => {
      const probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const resolve = (value: string) => {
        probe.style.color = value;
        return parseRgb(getComputedStyle(probe).color);
      };
      const surface = resolve('rgb(var(--c-surface))');
      const fill = resolve(color);
      probe.remove();
      if (!surface || !fill) return;
      setInks(LEVEL_ALPHA.map((alpha, level) => (
        level === 0 ? null : inkForLuminance(luminance(fill.map((part, index) => part * alpha + surface[index] * (1 - alpha))))
      )));
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, [color]);
  return inks;
}

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
  const inks = useLevelInks(color);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
        {weekdays.map((name) => <span key={name} className="truncate">{name}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map((cell, index) => {
          if (!cell) return <span key={`empty-${index}`} aria-hidden="true" />;
          const label = `${formatDateOnly(cell.date, locale)}: ${cell.value === null ? '—' : `${formatCurrency(cell.value)} ${currency}`}`;
          const selectable = Boolean(onSelectDay) && (cell.value !== null || (selectableThrough !== undefined && cell.date <= selectableThrough));
          const className = cn(
            'relative flex h-8 items-center justify-center rounded-md text-xs font-medium tabular-nums transition-transform',
            cell.value === null ? 'border border-dashed border-gray-200 text-gray-300' : 'text-gray-700',
            cell.value !== null && inks[cell.level] && INK_CLASS[inks[cell.level]!],
            cell.date === today && 'ring-2 ring-gray-950/70 ring-offset-1 ring-offset-surface',
            selectable && 'hover:scale-110 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
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
      <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-gray-500" aria-hidden="true">
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
