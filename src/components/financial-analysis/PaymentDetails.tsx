'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, Money } from '@/components/PresentationFoundation';
import { formatDateOnly, formatTime } from '@/lib/formatters';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';

export interface PaymentDetailsProps {
  row: ExpenseRow | undefined;
  labelFor: (category: string) => string;
  locale: string;
  currency: string;
}

/** One expense payment as entered: amount, day and time, category, the money that paid it, method, who added it (when known), comment. */
export function PaymentDetails({ row, labelFor, locale, currency }: PaymentDetailsProps) {
  const t = useTranslations('financialAnalysis');
  const tr = useTranslations('reports');
  const td = useTranslations('dashboard');
  if (!row) return <EmptyState compact title={t('noExpenses')} />;

  const method = row.payment_method;
  const rows: Array<[string, ReactNode]> = [
    [tr('dateAndTime'), `${formatDateOnly(row.date, locale)} · ${formatTime(row.created_at, locale)}`],
    [tr('category'), labelFor(row.category)],
    [t('drawerPaidFrom'), row.payment_source === 'bar' ? t('paidFromBar') : t('paidFromGameClub')],
    ...(method === 'cash' || method === 'terminal' || method === 'card' ? [[tr('paymentMethod'), td(method)] as [string, ReactNode]] : []),
    // Only where the ledger was read with its authors' names.
    ...(row.creator_name !== undefined ? [[tr('addedBy'), row.creator_name || tr('unknownCreator')] as [string, ReactNode]] : []),
    [tr('descriptionLabel'), row.comment?.trim() || t('drawerNoComment')],
  ];
  return (
    <div className="space-y-4">
      <p className="text-2xl font-bold tracking-tight text-gray-900">
        <Money amount={Number(row.amount ?? 0)} currency={currency} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
      </p>
      <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
            <dt className="text-gray-500">{label}</dt>
            <dd className="break-words text-right font-semibold text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
