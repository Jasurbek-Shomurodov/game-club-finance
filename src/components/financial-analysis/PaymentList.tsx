'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/PresentationFoundation';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';

export interface PaymentListProps {
  rows: ExpenseRow[];
  /** Prefix each payment with its category, for lists that mix categories. */
  showCategory?: boolean;
  labelFor: (category: string) => string;
  locale: string;
  currency: string;
  /** Makes each payment a button that opens its details. */
  onOpen?: (row: ExpenseRow) => void;
}

/** Expense payments as entered: comment, date, money source and method, amount. */
export function PaymentList({ rows, showCategory = false, labelFor, locale, currency, onOpen }: PaymentListProps) {
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const methodLabel = (method: string | null | undefined) => (
    method === 'cash' || method === 'terminal' || method === 'card' ? td(method) : null
  );

  if (rows.length === 0) return <EmptyState compact title={t('noExpenses')} />;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((row) => {
        const method = methodLabel(row.payment_method);
        const content = (
          <>
            <div className="min-w-0">
              <p className="break-words text-sm text-gray-900">
                {showCategory && <span className="font-medium">{labelFor(row.category)} · </span>}
                {row.comment || <span className="text-gray-400">{t('drawerNoComment')}</span>}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {formatDateShort(row.date, locale)}
                {' · '}
                {row.payment_source === 'bar' ? t('paidFromBar') : t('paidFromGameClub')}
                {method && ` · ${method}`}
              </p>
            </div>
            <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-950">
              {formatCurrency(Number(row.amount ?? 0))} <span className="text-xs font-medium text-gray-500">{currency}</span>
            </p>
          </>
        );
        return (
          <li key={row.id}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-start justify-between gap-3 py-2.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
