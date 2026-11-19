'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, ChartSkeleton, SectionHeading } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { ShareBar } from '@/components/charts/ShareBar';
import { ChangeHint, GlanceStat } from '@/components/charts/GlanceStat';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { combineSalaryMonths, salaryBalance, type SalaryEmployee, type SalaryMonth } from '@/lib/calculations/salaries';
import { changeRatio, monthlyPairs, previousYearMonth, recentYearMonths } from '@/lib/calculations/pageGlance';
import { formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <ChartSkeleton />,
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
  ), [activeIds, balances, employees, tg]);
  const owedTotal = owed.reduce((sum, slice) => sum + slice.value, 0);

  const current = byMonth.get(thisMonth);
  const before = byMonth.get(previousYearMonth(thisMonth));
  const hasHistory = series.some((row) => row.income > 0 || row.expenses > 0);
  if (!hasHistory && owedTotal === 0) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ChartCard title={t('chartTitle')} description={t('chartDescription', { count: MONTHS_SHOWN })}>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <GlanceStat
            label={t('earnedThisMonth', { month: formatYearMonth(thisMonth, locale) })}
            value={formatCurrency(current?.earned ?? 0)}
            unit={currency}
            hint={<ChangeHint ratio={changeRatio(current?.earned ?? 0, before?.earned ?? 0)} label={tg('vsLastMonth')} locale={locale} goodWhenUp={false} />}
          />
          <GlanceStat label={t('paidThisMonth')} value={formatCurrency(current?.paid ?? 0)} unit={currency} tone="success" />
          <GlanceStat
            className="col-span-2 sm:col-span-1"
            label={t('kpiShare')}
            value={current && current.earned > 0 ? `${Math.round((current.kpi / current.earned) * 100)}%` : '—'}
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
