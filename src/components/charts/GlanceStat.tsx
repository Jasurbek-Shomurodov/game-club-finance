import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TappableSurface } from '@/components/PresentationFoundation';
import { formatPercentShare } from './chartFormat';

const toneClass = {
  default: 'text-gray-950',
  success: 'text-success-600',
  danger: 'text-danger-600',
  warning: 'text-warning-600',
} as const;

/**
 * One figure in a glance strip: a muted label, the number loud, and an
 * optional hint line (a comparison, a share, a count) underneath.
 */
export function GlanceStat({ label, value, unit, hint, tone = 'default', className, href }: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: keyof typeof toneClass;
  className?: string;
  /** The records behind the figure (`@/lib/detailLinks`); the stat becomes one tap target. */
  href?: string;
}) {
  return (
    <TappableSurface href={href} className={cn('min-w-0', href && '-m-2 !w-auto rounded-xl p-2 pr-7 hover:bg-gray-100', className)}>
      <p className="truncate text-xs font-medium text-gray-500">{label}</p>
      <p className={cn('mt-1 break-words text-xl font-bold leading-tight tracking-tight tabular-nums', toneClass[tone])}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium tracking-normal text-gray-500">{unit}</span>}
      </p>
      {hint && <div className="mt-1 text-xs leading-5 text-gray-500">{hint}</div>}
    </TappableSurface>
  );
}

/**
 * "+12% vs last month" with an arrow; green when up, red when down. `goodWhenUp`
 * flips the colours for figures where less is better (expenses, debts).
 */
export function ChangeHint({ ratio, label, locale, goodWhenUp = true }: {
  ratio: number | null;
  /** e.g. "vs October". */
  label: string;
  locale: string;
  goodWhenUp?: boolean;
}) {
  if (ratio === null) return <span>{label}: —</span>;
  const up = ratio >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', ratio === 0 ? 'text-gray-600' : good ? 'text-success-600' : 'text-danger-600')}>
        <Icon size={12} aria-hidden="true" />
        {up ? '+' : '−'}{formatPercentShare(Math.abs(ratio), locale)}
      </span>
      <span>{label}</span>
    </span>
  );
}
