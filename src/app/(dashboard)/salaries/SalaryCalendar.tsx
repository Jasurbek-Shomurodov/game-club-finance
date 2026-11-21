'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, CircleCheck, Percent } from 'lucide-react';
import { IconButton, SectionHeading, TappableSurface } from '@/components/PresentationFoundation';
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
  { kind: 'absence', sign: '', chip: 'border-gray-200 bg-gray-50 text-gray-600', dot: 'bg-gray-400' },
];

export interface SalaryCalendarProps {
  month: string;
  days: SalaryCalendarDay[];
  selectedDate: string;
  /** The last month the calendar may show (the club's business month). */
  maxMonth?: string;
  onMonthChange: (delta: number) => void;
  onSelectDate: (date: string) => void;
}

/** A month of payments, bonuses and fines; selecting a day narrows the list below it. */
export function SalaryCalendar({ month, days, selectedDate, maxMonth, onMonthChange, onSelectDate }: SalaryCalendarProps) {
  const t = useTranslations('salaries');
  const tc = useTranslations('calendar');
  const { locale } = useAppLocale();
  const monthLabel = formatYearMonth(month, locale);
  const selectedDay = days.find((day) => day.date === selectedDate);

  return (
    <div>
      <SectionHeading size="sm" title={t('calendarTitle')} description={t('calendarHelp')} className="mb-3" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <IconButton label={tc('previousMonth')} title={tc('previousMonth')} icon={<ChevronLeft size={18} aria-hidden="true" />} onClick={() => onMonthChange(-1)} />
        <p className="min-w-0 text-center text-sm font-extrabold capitalize text-gray-950">{monthLabel}</p>
        <IconButton
          label={tc('nextMonth')}
          title={tc('nextMonth')}
          icon={<ChevronRight size={18} aria-hidden="true" />}
          disabled={maxMonth !== undefined && month >= maxMonth}
          onClick={() => onMonthChange(1)}
        />
      </div>
      {/* Amounts show from `md` up, where the page always leaves the seven columns room; phones get marks. */}
      <div>
        <div className="grid grid-cols-7 gap-1 md:gap-1.5" role="group" aria-label={`${t('calendarTitle')}: ${monthLabel}`}>
          {WEEKDAYS.map((key) => (
            <div key={key} aria-hidden="true" className="truncate pb-1 text-center text-xs font-semibold text-gray-500">{tc(`weekdays.${key}`)}</div>
          ))}
          {days.map((day) => {
            const selected = day.date === selectedDate;
            return (
              <TappableSurface
                key={day.date}
                chevron={false}
                selected={selected}
                label={`${formatDateOnly(day.date, locale)} · ${day.earned !== undefined ? `${t('calendarEarned')} ${formatCurrency(day.earned)} · ` : ''}${day.kpi !== undefined ? `${t('kpi')} ${formatCurrency(day.kpi)} · ` : ''}${t('calendarRecords', { count: day.count })}`}
                onClick={() => onSelectDate(selected ? '' : day.date)}
                className={cn(
                  'min-w-0 rounded-lg border p-1.5 md:rounded-xl md:p-2',
                  !day.inMonth
                    ? 'border-transparent bg-transparent'
                    : day.totals.fine !== undefined
                      ? 'border-danger-100 bg-danger-50/60'
                      : 'border-gray-200 bg-surface',
                  day.isToday && day.inMonth && 'border-warning-500 bg-warning-50/50',
                )}
              >
              <span className="flex min-h-10 flex-col items-stretch gap-1 md:min-h-24">
                <span className="flex items-start justify-between gap-1">
                  <span className={cn('text-sm font-bold', day.inMonth ? 'text-gray-900' : 'text-gray-300', day.totals.fine !== undefined && day.inMonth && 'text-danger-700', day.isToday && 'text-warning-700')}>{day.day}</span>
                  {day.count > 1 && <span aria-hidden="true" className="hidden rounded-full bg-gray-100 px-1.5 text-xs font-bold leading-4 text-gray-500 md:inline">{day.count}</span>}
                </span>
                {day.earned !== undefined && (
                  <span className={cn('hidden items-center gap-1 text-xs font-semibold leading-tight text-success-700 md:flex', !day.inMonth && 'opacity-60')}>
                    <CircleCheck size={12} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 break-words tabular-nums">+{formatCurrency(day.earned)}</span>
                  </span>
                )}
                {day.kpi !== undefined && (
                  <span className={cn('hidden items-center gap-1 text-xs font-semibold leading-tight text-success-600 md:flex', !day.inMonth && 'opacity-60')}>
                    <Percent size={12} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 break-words tabular-nums">+{formatCurrency(day.kpi)}</span>
                  </span>
                )}
                {KINDS.map(({ kind, sign, chip }) => day.totals[kind] !== undefined && (
                  <span key={kind} className={cn('hidden rounded-lg border px-1.5 py-1 text-xs leading-tight md:block', chip, !day.inMonth && 'opacity-60')}>
                    <span className="block font-medium">{t(kind)}</span>
                    {kind !== 'absence' && <span className="block break-words font-bold tabular-nums">{sign}{formatCurrency(day.totals[kind]!)}</span>}
                  </span>
                ))}
                {/* Phones: seven columns leave no room for amounts, so a day shows the legend's marks
                    and its amounts are in the list below once it is selected. */}
                <span aria-hidden="true" className={cn('mt-auto flex flex-wrap items-center gap-1 md:hidden', !day.inMonth && 'opacity-60')}>
                  {day.earned !== undefined && <CircleCheck size={10} className="text-success-600" />}
                  {day.kpi !== undefined && <Percent size={10} className="text-success-600" />}
                  {KINDS.map(({ kind, dot }) => day.totals[kind] !== undefined && <span key={kind} className={cn('h-1.5 w-1.5 rounded-full', dot)} />)}
                </span>
              </span>
              </TappableSurface>
            );
          })}
        </div>
      </div>
      {selectedDay && (
        // Phones only: the amounts the compact day cell has no room for.
        <dl className="mt-2 rounded-xl border border-primary-100 bg-primary-50/60 px-3 py-2.5 text-sm md:hidden">
          <dt className="font-semibold text-gray-900">{formatDateOnly(selectedDay.date, locale)}</dt>
          <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            {selectedDay.earned !== undefined && <span>{t('calendarEarned')}: <strong className="tabular-nums text-success-700">+{formatCurrency(selectedDay.earned)}</strong></span>}
            {selectedDay.kpi !== undefined && <span>{t('kpi')}: <strong className="tabular-nums text-success-700">+{formatCurrency(selectedDay.kpi)}</strong></span>}
            {KINDS.map(({ kind, sign }) => selectedDay.totals[kind] !== undefined && (
              <span key={kind}>{kind === 'absence' ? <strong className="text-gray-900">{t(kind)}</strong> : <>{t(kind)}: <strong className="tabular-nums text-gray-900">{sign}{formatCurrency(selectedDay.totals[kind]!)}</strong></>}</span>
            ))}
            {selectedDay.earned === undefined && selectedDay.kpi === undefined && selectedDay.count === 0 && <span>{t('calendarRecords', { count: 0 })}</span>}
          </dd>
        </dl>
      )}
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
