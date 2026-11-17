'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';

export interface MoneyProps {
  amount: number;
  /** Currency label; defaults to the translated currency (сум / so'm / UZS). Pass `null` to hide it. */
  currency?: string | null;
  /** Colour negatives red. */
  signed?: boolean;
  /** Prefix positive values with "+" (activity feeds). */
  showPlus?: boolean;
  className?: string;
  currencyClassName?: string;
}

/** Formatted whole-UZS amount with thousands separators and a unit suffix. */
export function Money({ amount, currency, signed = false, showPlus = false, className, currencyClassName }: MoneyProps) {
  const tc = useTranslations('common');
  const unit = currency === undefined ? tc('currency') : currency;
  return (
    <span className={cn('tabular-nums', signed && amount < 0 && 'text-danger-600', className)}>
      {/* The thousands separators are spaces: the number itself never breaks across lines. */}
      <span className="whitespace-nowrap">{showPlus && amount > 0 ? '+' : ''}{formatCurrency(amount)}</span>
      {unit ? <span className={cn('ml-1 font-medium', currencyClassName)}>{unit}</span> : null}
    </span>
  );
}
