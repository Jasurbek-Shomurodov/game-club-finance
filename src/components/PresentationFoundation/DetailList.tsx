import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tone';

export interface DetailListItem {
  /** Needed only when `label` is not a string or two rows share a label. */
  key?: string;
  label: ReactNode;
  value: ReactNode;
}

export interface DetailListProps {
  /** Falsy entries are skipped, so a row can be listed conditionally. */
  items: ReadonlyArray<DetailListItem | null | false | undefined>;
  /** Below `sm`, put each value under its label (long notes, addresses). */
  stack?: boolean;
  className?: string;
}

/**
 * The facts of one record in a details sheet: a `<dl>` of rows with the label
 * on the left in muted text and the value on the right.
 */
export function DetailList({ items, stack = false, className }: DetailListProps) {
  const rows = items.filter((item): item is DetailListItem => Boolean(item));
  if (rows.length === 0) return null;
  return (
    <dl className={cn('divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm', className)}>
      {rows.map((item, index) => (
        <div
          key={item.key ?? (typeof item.label === 'string' ? item.label : index)}
          className={cn('flex items-start justify-between gap-4 px-4 py-2.5', stack && 'max-sm:flex-col max-sm:gap-0.5')}
        >
          <dt className={cn('max-w-[50%] shrink-0 break-words text-gray-500', stack && 'max-sm:max-w-none')}>{item.label}</dt>
          <dd className={cn('min-w-0 break-words text-right font-medium tabular-nums text-gray-900', stack && 'max-sm:text-left')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DetailHeroProps {
  /** What the record is: a product, a person, a category. */
  title: ReactNode;
  /** Muted line under the title (a date, who recorded it). */
  subtitle?: ReactNode;
  /** The record's main figure, already formatted (a `Money`, or a quantity). */
  amount?: ReactNode;
  /** Small caption under the amount naming what it measures. */
  amountLabel?: ReactNode;
  /** What the amount means; `neutral` leaves it in the text colour. */
  tone?: Tone;
  /** A `Badge` above the title (the record's kind or status). */
  badge?: ReactNode;
  className?: string;
}

/** The head of a details sheet: the record's name over its one big figure. */
export function DetailHero({ title, subtitle, amount, amountLabel, tone = 'neutral', badge, className }: DetailHeroProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {badge && <div className="mb-3 flex flex-wrap gap-2">{badge}</div>}
      <p className="break-words text-lg font-semibold text-gray-950">{title}</p>
      {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      {amount != null && amount !== false && (
        <p className={cn('mt-1 break-words text-2xl font-bold tracking-tight tabular-nums', toneClasses[tone].text)}>{amount}</p>
      )}
      {amountLabel && <p className="text-xs text-gray-500">{amountLabel}</p>}
    </div>
  );
}
