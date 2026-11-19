'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { employeeSalaryHref } from '@/lib/detailLinks';
import { Card, SectionHeading, Skeleton } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { ShareBar } from '@/components/charts/ShareBar';
import { GlanceStat } from '@/components/charts/GlanceStat';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { DonutCardSkeleton, DonutSkeleton, GlanceStatSkeleton, HeadingSkeleton, InOutChartSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { combineSalaryMonths, salaryBalance, type SalaryEmployee, type SalaryMonth } from '@/lib/calculations/salaries';
import { monthlyPairs, recentYearMonths } from '@/lib/calculations/pageGlance';
import { formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <InOutChartSkeleton height={200} />,
});
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <DonutSkeleton />,
});

const MONTHS_SHOWN = 6;

/**
 * Payroll at a glance on the Employees tab: six months of salary earned
 * against paid, who is owed how much now, and what this month's pay is made of.
 */
export function PayrollGlance({ employees, activeIds, balances, today }: {
  employees: readonly SalaryEmployee[];
  /** Employees whose balance counts toward the club's total due. */
  activeIds: ReadonlySet<string>;
  balances: Record<string, SalaryMonth[]>;
  today: string;
}) {
  const router = useRouter();
  const t = useTranslations('glance.payroll');
  const tg = useTranslations('glance');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const thisMonth = today.slice(0, 7);

  const combined = useMemo(
    () => combineSalaryMonths(Object.fromEntries(employees.map((employee) => [employee.id, balances[employee.id] ?? []]))),
    [balances, employees],
  );
  const byMonth = useMemo(() => new Map(combined.map((month) => [month.month, month])), [combined]);
  const series = useMemo(
    () => monthlyPairs(recentYearMonths(thisMonth, MONTHS_SHOWN), byMonth, (month) => ({ first: month.earned, second: month.paid }))
      .map((row) => ({ date: row.month, label: formatMonthShort(row.month, locale), income: row.first, expenses: row.second })),
    [byMonth, locale, thisMonth],
  );
  const owed = useMemo(() => toDonutSlices(
    employees
      .filter((employee) => activeIds.has(employee.id))
      .map((employee) => ({ key: employee.id, label: employee.name, value: Math.max(0, salaryBalance(balances[employee.id] ?? [])) })),
    { key: 'other', label: tg('other') },
    (employeeId) => router.push(employeeSalaryHref(employeeId)),
  ), [activeIds, balances, employees, router, tg]);
  const owedTotal = owed.reduce((sum, slice) => sum + slice.value, 0);

  const current = byMonth.get(thisMonth);
  const hasHistory = series.some((row) => row.income > 0 || row.expenses > 0);
  if (!hasHistory && owedTotal === 0) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ChartCard title={t('chartTitle')} description={t('chartDescription', { count: MONTHS_SHOWN })}>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {/* This month is still running, so it is not compared with last month's full total. */}
          <GlanceStat
            label={t('earnedThisMonth', { month: formatYearMonth(thisMonth, locale) })}
            value={formatCurrency(current?.earned ?? 0)}
            unit={currency}
          />
          <GlanceStat label={t('paidThisMonth')} value={formatCurrency(current?.paid ?? 0)} unit={currency} tone="success" />
          <GlanceStat
            className="col-span-2 sm:col-span-1"
            label={t('kpiShare')}
            value={current && current.earned > 0 ? formatPercentShare(current.kpi / current.earned, locale) : '—'}
            hint={t('kpiShareHint')}
          />
        </div>
        {current && (
          <ShareBar
            className="mt-4"
            size="sm"
            label={t('composition')}
            locale={locale}
            parts={[
              { key: 'base', label: t('base'), value: current.base, color: chartColors.primary },
              { key: 'kpi', label: t('kpi'), value: current.kpi, color: chartColors.success },
              { key: 'bonus', label: t('bonus'), value: current.bonus, color: chartColors.purple },
            ]}
          />
        )}
        <div className="mt-4">
          <DailyInOutChart
            data={series}
            incomeLabel={t('earned')}
            expensesLabel={t('paid')}
            legendLabel={t('chartTitle')}
            incomeColor={chartColors.primary}
            expensesColor={chartColors.success}
            currency={currency}
            locale={locale}
            height={200}
          />
        </div>
      </ChartCard>

      <Card as="section">
        <SectionHeading size="sm" title={t('owedTitle')} description={t('owedDescription')} />
        <div className="mt-4">
          {owed.length ? (
            <DonutBreakdown size="sm" slices={owed} total={owedTotal} totalLabel={t('owedTotal')} currency={currency} locale={locale} />
          ) : (
            <p className="rounded-xl bg-success-50 px-4 py-3 text-sm font-medium text-success-700">{t('allSettled')}</p>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Payroll at a glance while salaries load: three figures, the pay split and the six-month chart, beside who is owed. */
export function PayrollGlanceSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden="true">
      <SkeletonCard>
        <HeadingSkeleton />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <GlanceStatSkeleton />
          <GlanceStatSkeleton />
          <GlanceStatSkeleton className="col-span-2 sm:col-span-1" />
        </div>
        <Skeleton className="mt-4 h-2 w-full rounded-full bg-gray-100" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full bg-gray-100" />
        <InOutChartSkeleton className="mt-4" height={200} bars={MONTHS_SHOWN} />
      </SkeletonCard>
      <DonutCardSkeleton />
    </div>
  );
}
