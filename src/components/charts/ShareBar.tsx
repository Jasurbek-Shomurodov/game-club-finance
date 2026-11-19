import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { formatPercentShare } from './chartFormat';

export interface ShareBarPart {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, e.g. `chartColors.success`. */
  color: string;
}

/**
 * One whole split into parts as a single bar, with a legend naming each part's
 * share (and amount, when `currency` is given). Parts at or below zero are
 * left out; nothing renders when no part is positive.
 */
export function ShareBar({ parts, label, locale, currency, className, size = 'md' }: {
  parts: readonly ShareBarPart[];
  /** Accessible name of the whole bar. */
  label: string;
  locale: string;
  /** When set, the legend prints each part's amount too. */
  currency?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const shown = parts.filter((part) => part.value > 0);
  const whole = shown.reduce((sum, part) => sum + part.value, 0);
  if (!whole) return null;
  const description = shown.map((part) => `${part.label} ${formatPercentShare(part.value / whole, locale)}`).join(', ');
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="img"
        aria-label={`${label}: ${description}`}
        className={cn('flex gap-0.5 overflow-hidden rounded-full bg-gray-100', size === 'sm' ? 'h-1.5' : 'h-2.5')}
      >
        {shown.map((part) => (
          <span
            key={part.key}
            className="h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
            style={{ width: `${(part.value / whole) * 100}%`, backgroundColor: part.color }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500" aria-hidden="true">
        {shown.map((part) => (
          <li key={part.key} className="flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: part.color }} />
            <span className="truncate">{part.label}</span>
            <span className="font-medium tabular-nums text-gray-700">{formatPercentShare(part.value / whole, locale)}</span>
            {currency && <span className="tabular-nums text-gray-400">{formatCurrency(part.value)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
