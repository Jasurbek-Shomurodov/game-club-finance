'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CHART_Y_AXIS_WIDTH,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  useSeriesVisibility,
} from '@/components/dashboard/ChartCard';
import { formatCurrency } from '@/lib/formatters';

export interface DailyInOutRow {
  date: string;
  /** Already formatted for the axis. */
  label: string;
  income: number;
  expenses: number;
}

const KEYS = ['income', 'expenses'] as const;

/**
 * Money in and money out per day as paired slim bars on one axis, with a
 * legend that shows or hides each series. One business per chart.
 */
export function DailyInOutChart({ data, incomeLabel, expensesLabel, legendLabel, currency, locale, incomeColor = chartColors.success, expensesColor = chartColors.danger, height = 220 }: {
  data: readonly DailyInOutRow[];
  incomeLabel: string;
  expensesLabel: string;
  legendLabel: string;
  currency: string;
  locale: string;
  incomeColor?: string;
  /** Second series colour; red (money out) unless the pair is not in/out. */
  expensesColor?: string;
  height?: number;
}) {
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const income = data.reduce((sum, row) => sum + row.income, 0);
  const expenses = data.reduce((sum, row) => sum + row.expenses, 0);
  const series = [
    { key: 'income', label: incomeLabel, color: incomeColor },
    { key: 'expenses', label: expensesLabel, color: expensesColor },
  ];
  return (
    <div className="space-y-3">
      <ChartLegendToggle
        label={legendLabel}
        hidden={hidden}
        onToggle={(key) => toggle(key, KEYS)}
        onFocus={setFocused}
        items={[
          { key: 'income', label: incomeLabel, color: incomeColor, swatch: 'square', total: formatAxis(income, locale) },
          { key: 'expenses', label: expensesLabel, color: expensesColor, swatch: 'square', total: formatAxis(expenses, locale) },
        ]}
      />
      <div style={{ height }} role="img" aria-label={`${legendLabel}: ${incomeLabel} ${formatCurrency(income)} ${currency}, ${expensesLabel} ${formatCurrency(expenses)} ${currency}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data as DailyInOutRow[]} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="3 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartColors.axis, fontSize: 11 }} minTickGap={16} />
            <YAxis width={CHART_Y_AXIS_WIDTH} tickLine={false} axisLine={false} tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={label} payload={payload} series={series.filter((row) => !hidden.has(row.key))} currency={currency} />
              )}
            />
            {!hidden.has('income') && (
              <Bar dataKey="income" fill={incomeColor} radius={[4, 4, 0, 0]} maxBarSize={18} fillOpacity={seriesOpacity('income', focused)} isAnimationActive={false} />
            )}
            {!hidden.has('expenses') && (
              <Bar dataKey="expenses" fill={expensesColor} radius={[4, 4, 0, 0]} maxBarSize={18} fillOpacity={seriesOpacity('expenses', focused)} isAnimationActive={false} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
