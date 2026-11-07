'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/PresentationFoundation';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { NOTE_PREFIX, type PaymentGroup } from '@/lib/calculations/sankeyDrill';

export interface PaymentGroupListProps {
  groups: PaymentGroup[];
  locale: string;
  currency: string;
  /** Opens the group: one payment its details, several their history. */
  onOpen: (group: PaymentGroup) => void;
}

/** A category's payments grouped by what they were for: name, how many and when, their total. */
export function PaymentGroupList({ groups, locale, currency, onOpen }: PaymentGroupListProps) {
  const t = useTranslations('financialAnalysis');
  if (groups.length === 0) return <EmptyState compact title={t('noExpenses')} />;
  return (
    <ul className="divide-y divide-gray-100">
      {groups.map((group) => {
        // Payments come newest first; the span reads oldest to newest.
        const first = group.payments.at(-1)?.date;
        const last = group.payments[0]?.date;
        const span = first && last && first !== last
          ? `${formatDateShort(first, locale)} – ${formatDateShort(last, locale)}`
          : formatDateShort(last, locale);
        return (
          <li key={group.key}>
            <button
              type="button"
              onClick={() => onOpen(group)}
              className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-gray-900">
                  {group.key.startsWith(NOTE_PREFIX) ? group.key.slice(NOTE_PREFIX.length) : <span className="font-normal text-gray-400">{t('drawerNoComment')}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t('paymentCount', { count: group.payments.length })}
                  {' · '}
                  {span}
                </p>
              </div>
              <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-950">
                {formatCurrency(group.amount)} <span className="text-xs font-medium text-gray-500">{currency}</span>
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
