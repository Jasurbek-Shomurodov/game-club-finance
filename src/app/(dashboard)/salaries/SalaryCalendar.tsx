'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, CircleCheck, Percent } from 'lucide-react';
import { SectionHeading } from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { SalaryCalendarDay, SalaryEntryKind } from '@/lib/calculations/salaryCalendar';
import { formatCurrency, formatDateOnly, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Chip colours match the entry badges below the calendar (payment warning, bonus info, fine danger). */
const KINDS: { kind: SalaryEntryKind; sign: string; chip: string; dot: string }[] = [
  { kind: 'payment', sign: '', chip: 'border-warning-100 bg-warning-50 text-warning-700', dot: 'bg-warning-500' },
  { kind: 'bonus', sign: '+', chip: 'border-primary-100 bg-primary-50 text-primary-700', dot: 'bg-primary-500' },
  { kind: 'fine', sign: '−', chip: 'border-danger-100 bg-danger-50 text-danger-700', dot: 'bg-danger-500' },
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
                aria-label={`${formatDateOnly(day.date, locale)} · ${day.earned !== undefined ? `${t('calendarEarned')} ${formatCurrency(day.earned)} · ` : ''}${day.kpi !== undefined ? `${t('kpi')} ${formatCurrency(day.kpi)} · ` : ''}${t('calendarRecords', { count: day.count })}`}
                onClick={() => onSelectDate(selected ? '' : day.date)}
                className={cn(
                  'relative flex min-h-[112px] min-w-0 flex-col items-stretch gap-1 rounded-xl border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                  !day.inMonth
                    ? 'border-transparent bg-transparent'
                    : day.totals.fine !== undefined
                      ? 'border-danger-100 bg-danger-50/60 hover:border-danger-400'
                      : 'border-gray-200 bg-surface hover:border-primary-300',
                  day.isToday && day.inMonth && 'border-warning-500 bg-warning-50/50',
                  selected && 'border-primary-500 ring-1 ring-primary-500',
                )}
              >
                <span className="flex items-start justify-between gap-1">
                  <span className={cn('text-sm font-bold', day.inMonth ? 'text-gray-900' : 'text-gray-300', day.totals.fine !== undefined && day.inMonth && 'text-danger-700', day.isToday && 'text-warning-700')}>{day.day}</span>
                  {day.count > 1 && <span aria-hidden="true" className="rounded-full bg-gray-100 px-1.5 text-[10px] font-bold leading-4 text-gray-500">{day.count}</span>}
                </span>
                {day.earned !== undefined && (
                  <span className={cn('flex items-center gap-1 text-[11px] font-semibold leading-tight text-success-700', !day.inMonth && 'opacity-60')}>
                    <CircleCheck size={12} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 break-words tabular-nums">+{formatCurrency(day.earned)}</span>
                  </span>
                )}
                {day.kpi !== undefined && (
                  <span className={cn('flex items-center gap-1 text-[11px] font-semibold leading-tight text-success-600', !day.inMonth && 'opacity-60')}>
                    <Percent size={12} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 break-words tabular-nums">+{formatCurrency(day.kpi)}</span>
                  </span>
                )}
                {KINDS.map(({ kind, sign, chip }) => day.totals[kind] !== undefined && (
                  <span key={kind} className={cn('block rounded-lg border px-1.5 py-1 text-[11px] leading-tight', chip, !day.inMonth && 'opacity-60')}>
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
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <CircleCheck size={12} aria-hidden="true" className="text-success-600" />{t('calendarEarned')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <Percent size={12} aria-hidden="true" className="text-success-600" />{t('kpi')}
        </span>
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
