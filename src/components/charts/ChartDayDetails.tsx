'use client';

import type { ReactNode } from 'react';
import { CalendarDays, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Modal } from '@/components/PresentationFoundation';
import { colorWithAlpha } from '@/components/dashboard/ChartCard';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';

/** One series on the tapped day. */
export interface DayDetailRow {
  key: string;
  label: string;
  color: string;
  icon?: LucideIcon;
  /** Drawn as a dashed swatch (an average, a plan) when there is no icon. */
  dashed?: boolean;
  /** The day's value; null when the series has no entry that day. */
  value: number | null;
  /** Prints the value itself (a percentage, a count) instead of as money with the currency. */
  format?: (value: number) => string;
}

/**
 * The tapped day's series, one row each with its icon and value. Each side is
 * its own row: the game club and the bar are never added together here.
 */
export function DayDetailsList({ rows, currency }: { rows: readonly DayDetailRow[]; currency: string }) {
  const t = useTranslations('charts');
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <li key={row.key} className="flex min-h-11 items-center gap-3 py-2">
            {Icon ? (
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: colorWithAlpha(row.color, 0.16), color: row.color }}>
                <Icon size={15} strokeWidth={2.4} />
              </span>
            ) : (
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center">
                {row.dashed
                  ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: row.color }} />
                  : <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: row.color }} />}
              </span>
            )}
            <span className="min-w-0 flex-1 text-sm text-gray-600">{row.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-950">
              {row.value === null
                ? <span className="font-medium text-gray-500">{t('noEntry')}</span>
                : row.format
                  ? row.format(row.value)
                  : <>{formatCurrency(row.value)} <span className="font-medium text-gray-500">{currency}</span></>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The details window a tap on a phone chart opens (a bottom sheet there):
 * the day's value of every series shown, and "Open day report" when the chart
 * can open the day. On desktop the tooltip shows the same, and a click opens
 * the day directly.
 */
export function ChartDayDetails({ open, onClose, date, dateLabel, rows, currency, description, onOpenDay, children }: {
  open: boolean;
  onClose: () => void;
  /** The tapped day (ISO). */
  date: string | null;
  /** How the tapped point is named when it is more than a day (a week's range, a month); the day's date otherwise. */
  dateLabel?: string;
  rows: readonly DayDetailRow[];
  currency: string;
  /** Usually the chart's title, so the sheet says which chart the day is from. */
  description?: string;
  /** Opens the day's report; without it there is no button. */
  onOpenDay?: (date: string) => void;
  /** Anything else about the day, under the rows. */
  children?: ReactNode;
}) {
  const t = useTranslations('charts');
  const locale = useLocale();
  return (
    <Modal
      open={open && !!date}
      onClose={onClose}
      size="sm"
      title={date ? t('dayDetailsTitle', { date: dateLabel ?? formatDateOnly(date, locale) }) : undefined}
      description={description}
      footer={date && onOpenDay ? (
        <Button
          fullWidth
          icon={<CalendarDays size={16} aria-hidden="true" />}
          onClick={() => {
            onClose();
            onOpenDay(date);
          }}
        >
          {t('openDayReport')}
        </Button>
      ) : undefined}
    >
      <DayDetailsList rows={rows} currency={currency} />
      {children}
    </Modal>
  );
}
