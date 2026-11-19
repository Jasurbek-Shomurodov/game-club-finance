'use client';

import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { CalendarCheck, CalendarX2 } from 'lucide-react';
import { Card, ChartSkeleton, LoadErrorAlert, SectionHeading, Skeleton } from '@/components/PresentationFoundation';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { WeekdayBars } from '@/components/charts/WeekdayBars';
import { ChangeHint, GlanceStat } from '@/components/charts/GlanceStat';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { chartColors } from '@/components/dashboard/ChartCard';
import { averageByWeekday } from '@/lib/calculations/insights';
import {
  changeRatio,
  dailyCashMonthGlance,
  lastDueCashDay,
  monthToDateTotal,
  previousYearMonth,
  type DailyCashGlanceEntry,
  type DailyCashMethod,
} from '@/lib/calculations/pageGlance';
import { createClient } from '@/lib/supabase/client';
import { useClubQuery } from '@/lib/useClubQuery';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency, formatDateShort, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const COLUMNS = 'date,cash_income,terminal_income,card_income,playstation_income';
const MISSING_SHOWN = 10;

interface MonthRows {
  current: DailyCashGlanceEntry[];
  previous: DailyCashGlanceEntry[];
}

const EMPTY: MonthRows = { current: [], previous: [] };

function monthBounds(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, '0')}` };
}

/**
 * The selected date's month beside the cash form: how much came in so far and
 * against last month at the same point, the days still without an entry, a
 * calendar to jump to any day, and how the money came in.
 */
export function DailyCashMonthGlance({ clubId, date, today, enabledPaymentMethods, version, onSelectDate }: {
  clubId: string | null;
  /** The date open in the form; its month is shown. */
  date: string;
  /** The club's business today: later days are not expected yet. */
  today: string;
  enabledPaymentMethods: readonly string[];
  /** Bumped after a save or delete so the month reloads. */
  version: number;
  onSelectDate: (date: string) => void;
}) {
  const t = useTranslations('glance');
  const td = useTranslations('dailyCash');
  const tc = useTranslations('common');
  const yearMonth = date.slice(0, 7);
  const previousMonth = previousYearMonth(yearMonth);
  const currency = tc('currency');
  const { locale } = useAppLocale();

  const load = useCallback(async (): Promise<MonthRows> => {
    void version;
    if (!clubId) return EMPTY;
    const supabase = createClient();
    // Two months are at most 62 rows: well inside one response.
    const { data, error } = await supabase
      .from('daily_cash_entries')
      .select(COLUMNS)
      .eq('club_id', clubId)
      .gte('date', monthBounds(previousMonth).from)
      .lte('date', monthBounds(yearMonth).to)
      .order('date', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as DailyCashGlanceEntry[];
    return {
      current: rows.filter((row) => row.date.startsWith(yearMonth)),
      previous: rows.filter((row) => row.date.startsWith(previousMonth)),
    };
  }, [clubId, previousMonth, yearMonth, version]);
  const query = useClubQuery<MonthRows>(clubId ? load : null, EMPTY);

  const { current: currentRows, previous: previousRows } = query.data;
  // Today is still being worked: it is expected only once it has an entry.
  const dueThrough = useMemo(() => lastDueCashDay(today, new Set(currentRows.map((row) => row.date))), [currentRows, today]);
  const glance = useMemo(() => dailyCashMonthGlance(currentRows, yearMonth, dueThrough), [currentRows, yearMonth, dueThrough]);
  const previous = useMemo(() => dailyCashMonthGlance(previousRows, previousMonth, dueThrough), [previousRows, previousMonth, dueThrough]);
  const comparedDays = Math.max(1, glance.expectedDays);
  const previousToDate = monthToDateTotal(previous.values, previousMonth, comparedDays);
  const change = glance.expectedDays ? changeRatio(glance.total, previousToDate) : null;
  const throughDay = glance.expectedDays ? `${yearMonth}-${String(glance.expectedDays).padStart(2, '0')}` : null;
  const weekdays = useMemo(
    () => averageByWeekday(glance.values, { from: `${yearMonth}-01`, through: throughDay ?? `${yearMonth}-01` }),
    [glance.values, throughDay, yearMonth],
  );

  const slices = useMemo(() => toDonutSlices(
    (['cash', 'terminal', 'card', 'playstation'] as const)
      .filter((method) => method === 'playstation' || enabledPaymentMethods.includes(method) || glance.byMethod[method] > 0)
      .map((method: DailyCashMethod) => ({ key: method, label: td(method), value: glance.byMethod[method] })),
    { key: 'other', label: t('other') },
  ), [glance.byMethod, enabledPaymentMethods, t, td]);

  const lastEntered = [...glance.values.keys()].sort().at(-1) ?? null;
  const missing = glance.missingDates;

  return (
    <Card as="section" aria-labelledby="daily-cash-month-glance">
      <SectionHeading
        title={<span id="daily-cash-month-glance">{capitalize(t('dailyCash.title', { month: formatYearMonth(yearMonth, locale) }))}</span>}
        description={t('dailyCash.description')}
      />

      {query.error ? (
        <LoadErrorAlert className="mt-4" retrying={query.loading} onRetry={() => void query.reload()}>{t('loadError')}</LoadErrorAlert>
      ) : query.loading ? (
        <div className="mt-4 space-y-4" role="status" aria-label={tc('loading')}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 rounded-xl bg-gray-50 p-4 lg:grid-cols-4">
            <GlanceStat
              label={t('dailyCash.monthToDate')}
              value={formatCurrency(glance.total)}
              unit={currency}
              tone="success"
              hint={<ChangeHint ratio={change} label={t('vsSameDays', { month: formatYearMonth(previousMonth, locale) })} locale={locale} />}
            />
            <GlanceStat
              label={t('dailyCash.average')}
              value={formatCurrency(Math.round(glance.averagePerEnteredDay))}
              unit={currency}
              hint={t('dailyCash.averageHint', { count: glance.enteredDays })}
            />
            <GlanceStat
              label={t('dailyCash.projected')}
              value={glance.projectedTotal === null ? '—' : formatCurrency(glance.projectedTotal)}
              unit={glance.projectedTotal === null ? undefined : currency}
              hint={previous.total > 0 ? t('dailyCash.lastMonthTotal', { amount: `${formatCurrency(previous.total)} ${currency}` }) : undefined}
            />
            <GlanceStat
              label={t('dailyCash.daysEntered')}
              value={`${glance.enteredDays}/${glance.expectedDays}`}
              tone={missing.length ? 'warning' : 'default'}
              hint={lastEntered ? t('dailyCash.lastEntry', { date: formatDateShort(lastEntered, locale) }) : t('dailyCash.noEntries')}
            />
          </div>

          {missing.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 inline-flex items-center gap-1.5 font-medium text-warning-700">
                <CalendarX2 size={14} aria-hidden="true" />
                {t('dailyCash.missing', { count: missing.length })}
              </span>
              {missing.slice(0, MISSING_SHOWN).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDate(day)}
                  className={cn(
                    'rounded-full border border-warning-200 bg-warning-50 px-2.5 py-1 font-medium tabular-nums text-warning-700 transition-colors',
                    'hover:bg-warning-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    day === date && 'ring-2 ring-warning-500',
                  )}
                >
                  {formatDateShort(day, locale)}
                </button>
              ))}
              {missing.length > MISSING_SHOWN && <span className="text-gray-500">{t('more', { count: missing.length - MISSING_SHOWN })}</span>}
            </div>
          ) : glance.expectedDays > 0 && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-success-700">
              <CalendarCheck size={14} aria-hidden="true" />
              {t('dailyCash.allEntered')}
            </p>
          )}

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('dailyCash.calendar')}</h3>
              <CalendarHeatmap
                yearMonth={yearMonth}
                values={glance.values}
                through={throughDay}
                today={date}
                color={chartColors.primary}
                currency={currency}
                locale={locale}
                onSelectDay={onSelectDate}
                legendLow={t('less')}
                legendHigh={t('moreLabel')}
              />
            </div>
            <div className="min-w-0 space-y-5">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('dailyCash.byMethod')}</h3>
                {slices.length ? (
                  <DonutBreakdown size="sm" slices={slices} total={glance.total} totalLabel={t('dailyCash.monthToDate')} currency={currency} locale={locale} />
                ) : (
                  <p className="text-sm text-gray-500">{t('dailyCash.noEntries')}</p>
                )}
              </div>
              {glance.enteredDays > 1 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('weekdayTitle')}</h3>
                  <WeekdayBars data={weekdays} color={chartColors.primary} currency={currency} locale={locale} averageLabel={t('weekdayAverage')} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}
