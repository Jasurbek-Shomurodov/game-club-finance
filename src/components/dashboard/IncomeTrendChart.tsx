'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { Sigma } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { SIDE_ICONS } from '@/components/sideIcons';
import {
  CHART_Y_AXIS_WIDTH,
  ChartCard,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
} from './ChartCard';

interface IncomeTrendChartProps {
  /** Each side's money in per day; the game club and the bar are never summed. */
  data: Array<{ date: string; gameClubIncome: number; barSales: number; gameClubAverage?: number | null; barAverage?: number | null }>;
  /** Optional header link, e.g. to the full financial analysis. */
  link?: ReactNode;
}

// Legend pills: each side hides its bars and its average line; "averages" hides both averages.
const TOGGLE_KEYS = ['gameClub', 'bar', 'averages'] as const;

export function IncomeTrendChart({ data, link }: IncomeTrendChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const seriesNames: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    barSales: t('barSales'),
    gameClubAverage: t('gameClubDailyAverage'),
    barAverage: t('barDailyAverage'),
  };
  const showGameClub = !hidden.has('gameClub');
  const showBar = !hidden.has('bar');
  const showAverages = !hidden.has('averages');
  // A hovered pill spotlights its group: a side's bars and average, or both averages.
  const opacity = (side: 'gameClub' | 'bar', average = false) =>
    focused === 'averages' ? (average ? 1 : 0.15) : seriesOpacity(side, focused);

  const tooltipSeries = [
    { key: 'gameClubIncome', label: seriesNames.gameClubIncome, color: chartColors.primary, icon: SIDE_ICONS.gameClub },
    { key: 'barSales', label: seriesNames.barSales, color: chartColors.orange, icon: SIDE_ICONS.bar },
    { key: 'gameClubAverage', label: seriesNames.gameClubAverage, color: chartColors.primary, dashed: true },
    { key: 'barAverage', label: seriesNames.barAverage, color: chartColors.orange, dashed: true },
  ];

  return (
    <ChartCard
      title={t('incomeTrend')}
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <ChartLegendToggle
            label={t('chartLegendLabel', { title: t('incomeTrend') })}
            hidden={hidden}
            onToggle={(key) => toggle(key, TOGGLE_KEYS)}
            onFocus={setFocused}
            items={[
              {
                key: 'gameClub',
                label: seriesNames.gameClubIncome,
                color: chartColors.primary,
                swatch: 'square',
                icon: SIDE_ICONS.gameClub,
                total: formatAxis(seriesTotal(data, (row) => row.gameClubIncome), locale),
              },
              {
                key: 'bar',
                label: seriesNames.barSales,
                color: chartColors.orange,
                swatch: 'square',
                icon: SIDE_ICONS.bar,
                total: formatAxis(seriesTotal(data, (row) => row.barSales), locale),
              },
              { key: 'averages', label: t('dailyAverages'), color: chartColors.gray, swatch: 'dashed', icon: Sigma },
            ]}
          />
          {link}
        </div>
      )}
    >
      <div className="mt-3 h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="25%"
          >
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: chartColors.axis }}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(value: number) => formatAxis(value, locale)}
              tick={{ fontSize: 11, fill: chartColors.axis }}
              tickLine={false}
              axisLine={false}
              width={CHART_Y_AXIS_WIDTH}
            />
            <Tooltip
              cursor={{ fill: chartColors.cursor, radius: 6 }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={label} payload={payload} series={tooltipSeries} currency={currency} />
              )}
            />
            <Bar dataKey="gameClubIncome" name="gameClubIncome" hide={!showGameClub} fill={chartColors.primary} fillOpacity={opacity('gameClub')} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
            <Bar dataKey="barSales" name="barSales" hide={!showBar} fill={chartColors.orange} fillOpacity={opacity('bar')} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
            {/* Running averages through each day; they stop after a side's latest entry. */}
            <Line dataKey="gameClubAverage" name="gameClubAverage" hide={!showGameClub || !showAverages} type="monotone" stroke={chartColors.primary} strokeOpacity={opacity('gameClub', true)} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            <Line dataKey="barAverage" name="barAverage" hide={!showBar || !showAverages} type="monotone" stroke={chartColors.orange} strokeOpacity={opacity('bar', true)} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
