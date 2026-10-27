'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SectionHeading } from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { SalaryCalendarDay, SalaryEntryKind } from '@/lib/calculations/salaryCalendar';
import { formatCurrency, formatDateOnly, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Chip colours match the entry badges below the calendar (payment info, bonus success, fine danger). */
const KINDS: { kind: SalaryEntryKind; sign: string; chip: string; dot: string }[] = [
  { kind: 'payment', sign: '−', chip: 'bg-primary-50 text-primary-700', dot: 'bg-primary-500' },
  { kind: 'bonus', sign: '+', chip: 'bg-success-50 text-success-700', dot: 'bg-success-500' },
  { kind: 'fine', sign: '−', chip: 'bg-danger-50 text-danger-700', dot: 'bg-danger-500' },
];

export interface SalaryCalendarProps {
  month: string;
  days: SalaryCalendarDay[];
  selectedDate: string;
  onMonthChange: (delta: number) => void;
  onSelectDate: (date: string) => void;
}

/** A month of payments, bonuses and fines; selecting a day narrows the list below it. */
export function SalaryCalendar({ month, days, selectedDate, onMonthChange, onSelectDate }: SalaryCalendarProps) {
  const t = useTranslations('salaries');
  const tc = useTranslations('calendar');
  const { locale } = useAppLocale();
  const monthLabel = formatYearMonth(month, locale);

  return (
    <div>
      <SectionHeading size="sm" title={t('calendarTitle')} description={t('calendarHelp')} className="mb-3" />
      <div className="mb-3 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2">
        <MonthButton label={tc('previousMonth')} onClick={() => onMonthChange(-1)}><ChevronLeft size={18} /></MonthButton>
        <p className="text-center text-sm font-extrabold capitalize text-gray-950">{monthLabel}</p>
        <MonthButton label={tc('nextMonth')} onClick={() => onMonthChange(1)}><ChevronRight size={18} /></MonthButton>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[640px] grid-cols-7 gap-1.5" role="group" aria-label={`${t('calendarTitle')}: ${monthLabel}`}>
          {WEEKDAYS.map((key) => (
            <div key={key} aria-hidden="true" className="pb-1 text-center text-[11px] font-bold uppercase text-gray-400">{tc(`weekdays.${key}`)}</div>
          ))}
          {days.map((day) => {
            const selected = day.date === selectedDate;
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={selected}
                aria-current={day.isToday ? 'date' : undefined}
                aria-label={`${formatDateOnly(day.date, locale)} · ${t('calendarRecords', { count: day.count })}`}
                onClick={() => onSelectDate(selected ? '' : day.date)}
                className={cn(
                  'flex min-h-[96px] min-w-0 flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                  selected
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                    : day.isToday
                      ? 'border-primary-300 bg-surface'
                      : day.inMonth
                        ? 'border-transparent bg-gray-50 hover:border-primary-200'
                        : 'border-transparent bg-transparent',
                )}
              >
                <span className={cn('text-sm font-bold', day.inMonth ? 'text-gray-900' : 'text-gray-300', day.isToday && 'text-primary-700')}>{day.day}</span>
                {KINDS.map(({ kind, sign, chip }) => day.totals[kind] !== undefined && (
                  <span key={kind} className={cn('block rounded-md px-1.5 py-1 text-[11px] leading-tight', chip, !day.inMonth && 'opacity-60')}>
                    <span className="block font-medium">{t(kind)}</span>
                    <span className="block break-words font-bold tabular-nums">{sign}{formatCurrency(day.totals[kind]!)}</span>
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {KINDS.map(({ kind, dot }) => (
          <span key={kind} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className={cn('h-2 w-2 rounded-full', dot)} />{t(kind)}
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-surface text-gray-500 transition hover:border-primary-200 hover:text-primary-700"
    >
      {children}
    </button>
  );
}
