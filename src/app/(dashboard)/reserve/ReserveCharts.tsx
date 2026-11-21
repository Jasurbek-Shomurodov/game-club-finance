'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslations } from 'next-intl';
import { ChartTooltipBody, chartColors, formatAxis } from '@/components/dashboard/ChartCard';
import { formatDateOnly, formatDateShort } from '@/lib/formatters';
import type { ReserveDayRow } from '@/lib/calculations/ownerReserve';

const axisTick = { fill: chartColors.axis, fontSize: 11 };

/**
 * What the reserve held at the end of every day, as one pot whatever side the
 * money came from. Money in and out by month is the shared `DailyInOutChart`.
 */
export function ReserveBalanceChart({ rows, locale, currency }: { rows: ReserveDayRow[]; locale: string; currency: string }) {
  const t = useTranslations('reservePage');
  const series = [{ key: 'held', label: t('totalHeld'), color: chartColors.primary }];
  return (
    <div className="mt-3 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="reserve-held" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chartColors.grid} vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={axisTick} minTickGap={24} tickFormatter={(date: string) => formatDateShort(date, locale)} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipBody active={active} label={formatDateOnly(String(label), locale)} payload={payload} series={series} currency={currency} />
            )}
          />
          <Area dataKey="held" type="stepAfter" stroke={chartColors.primary} strokeWidth={2} fill="url(#reserve-held)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
