import type { ElementType, ReactNode } from 'react';
import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { Skeleton } from './Skeleton';

export type MetricTone = 'default' | 'success' | 'danger' | 'primary' | 'warning' | 'muted';

export const metricToneClassName: Record<MetricTone, string> = {
  default: 'text-gray-950',
  success: 'text-success-600',
  danger: 'text-danger-600',
  primary: 'text-primary-700',
  warning: 'text-warning-600',
  muted: 'text-gray-500',
};

/** Pick success/danger colouring from the sign of a number. */
export function toneForAmount(amount: number, positive: MetricTone = 'success'): MetricTone {
  return amount < 0 ? 'danger' : positive;
}

// Big numbers: tight tracking, one line where the width allows, and a
// smaller step on phones so "68 314 000 сум" never wraps mid-number.
const metricValueClassName = 'break-words text-[1.375rem] font-bold leading-none tracking-tight tabular-nums sm:text-2xl';

export interface MetricCardProps {
  label: ReactNode;
  /** Already formatted value (money, count, percentage). */
  value: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  tone?: MetricTone;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: ReactNode;
  helper?: ReactNode;
  loading?: boolean;
  className?: string;
}

/** Compact KPI card with a formatted value. */
export function MetricCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  tone = 'default',
  trend,
  trendLabel,
  helper,
  loading = false,
  className,
}: MetricCardProps) {
  const tc = useTranslations('common');
  return (
    <div className={cn('min-w-0 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5', className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className={cn('shrink-0 text-gray-400', iconClassName)} aria-hidden="true" />}
        <p className="min-w-0 break-words text-[13px] font-medium text-gray-500">{label}</p>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2" role="status" aria-label={tc('loading')}>
          <Skeleton className="h-6 w-36 max-w-full" />
          <Skeleton className="h-3 w-20 bg-gray-100" />
        </div>
      ) : (
        <p className={cn('mt-2.5', metricValueClassName, metricToneClassName[tone])}>{value}</p>
      )}
      {!loading && trendLabel && (
        <p
          className={cn('mt-2 flex items-center gap-1 text-xs font-medium', {
            'text-success-600': trend === 'up',
            'text-danger-600': trend === 'down',
            'text-gray-500': trend === 'neutral' || !trend,
          })}
        >
          {trend === 'up' && <ArrowUp size={12} aria-hidden="true" />}
          {trend === 'down' && <ArrowDown size={12} aria-hidden="true" />}
          {trendLabel}
        </p>
      )}
      {!loading && helper && <p className="mt-1.5 text-xs leading-5 text-gray-500">{helper}</p>}
    </div>
  );
}

export interface AmountCardProps {
  label: string;
  amount: number;
  icon: ElementType;
  /** Kept for call-site compatibility; the icon is now drawn inline in a muted tone. */
  iconBgClassName?: string;
  iconClassName?: string;
  currency?: string;
  comparison?: { value: number | null; label: string };
  /** Spending-style cards set 'down' so a rise is shown in red. */
  comparisonGoodWhen?: 'up' | 'down';
  subMetric?: { label: string; amount: number | null; unavailableLabel?: string };
  helper?: string;
  loading?: boolean;
  /** Colour of the amount; use success for money in, danger for money out. */
  tone?: MetricTone;
}

/** Dashboard-style money card with comparison and secondary metric. */
export function AmountCard({
  label,
  amount,
  icon: Icon,
  iconClassName,
  currency: currencyProp,
  comparison,
  comparisonGoodWhen = 'up',
  subMetric,
  helper,
  loading = false,
  tone = 'default',
}: AmountCardProps) {
  const tc = useTranslations('common');
  const currency = currencyProp ?? tc('currency');
  const isPositive = typeof comparison?.value === 'number' && comparison.value >= 0;
  const isGood = comparisonGoodWhen === 'up' ? isPositive : typeof comparison?.value === 'number' && comparison.value <= 0;

  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-surface p-4 text-left shadow-card sm:p-5">
      <div className="flex items-center gap-2">
        <Icon size={15} className={cn('shrink-0 text-gray-400', iconClassName)} aria-hidden="true" />
        <p className="min-w-0 break-words text-[13px] font-medium text-gray-500">{label}</p>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2" role="status" aria-label={tc('loading')}>
          <Skeleton className="h-6 w-32 max-w-full" />
          <Skeleton className="h-3 w-12 bg-gray-100" />
        </div>
      ) : (
        <p className={cn('mt-2.5', metricValueClassName, metricToneClassName[tone])}>
          {formatCurrency(amount)}
          <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{currency}</span>
        </p>
      )}
      {!loading && comparison ? (
        comparison.value === null ? (
          <p className="mt-2 text-xs font-medium text-gray-500">{comparison.label}</p>
        ) : (
          <p className={cn('mt-2 flex flex-wrap items-center gap-1 text-xs font-semibold', isGood ? 'text-success-600' : 'text-danger-600')}>
            {isPositive ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
            {Math.abs(comparison.value)}% <span className="font-medium text-gray-500">{comparison.label}</span>
          </p>
        )
      ) : null}
      {loading ? (
        <Skeleton className="mt-3 h-3 w-3/4 bg-gray-100" />
      ) : helper ? <p className="mt-2 text-xs leading-5 text-gray-500">{helper}</p> : null}
      {!loading && subMetric ? (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">{subMetric.label}</p>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-800">
            {subMetric.amount === null ? (
              subMetric.unavailableLabel ?? '—'
            ) : (
              <>
                {formatCurrency(subMetric.amount)} <span className="font-medium text-gray-500">{currency}</span>
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  tone?: MetricTone;
  icon?: LucideIcon;
  iconClassName?: string;
  /** flat: no border/shadow (inside another card). soft: tinted background. */
  variant?: 'card' | 'flat' | 'soft';
  size?: 'sm' | 'md';
  align?: 'left' | 'center';
  className?: string;
}

/** Small label/value tile for summaries inside cards and forms. */
export function StatTile({
  label,
  value,
  unit,
  tone = 'default',
  icon: Icon,
  iconClassName,
  variant = 'card',
  size = 'md',
  align = 'left',
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl',
        variant === 'card' && 'border border-gray-200 bg-surface px-4 py-3',
        variant === 'soft' && 'bg-gray-50 px-4 py-3',
        align === 'center' && 'text-center',
        className,
      )}
    >
      <div className={cn('flex items-center gap-1.5', align === 'center' && 'justify-center')}>
        {Icon && <Icon size={13} className={cn('shrink-0 text-gray-400', iconClassName)} aria-hidden="true" />}
        <p className="text-xs font-medium text-gray-500">{label}</p>
      </div>
      <p className={cn('mt-1 break-words font-bold leading-tight tracking-tight tabular-nums', size === 'sm' ? 'text-base' : 'text-lg', metricToneClassName[tone])}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium tracking-normal text-gray-500">{unit}</span>}
      </p>
    </div>
  );
}
