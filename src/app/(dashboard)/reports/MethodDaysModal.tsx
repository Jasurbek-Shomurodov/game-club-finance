'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { Button, EmptyState, Modal, Money } from '@/components/PresentationFoundation';
import type { MoneyReportDay, MoneyReportPaymentBreakdown } from '@/lib/calculations/moneyReport';
import { formatDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export type PaymentMethodFigure = 'cash' | 'terminal' | 'card' | 'playstation';

interface MethodDaysModalProps {
  /** The method card the owner tapped; null closes the dialog. */
  method: PaymentMethodFigure | null;
  label: string;
  days: readonly MoneyReportDay[];
  data: MoneyReportPaymentBreakdown | null;
  onSelectDay: (date: string) => void;
  onClose: () => void;
}

/**
 * The days that moved one payment method, newest first. Tapping a day opens its
 * entries narrowed to that method, so the card's figures can be traced back.
 */
export function MethodDaysModal({ method, label, days, data, onSelectDay, onClose }: MethodDaysModalProps) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  if (!method) return null;

  const movedDays = days
    .filter((day) => day[method] !== 0)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const daysTotal = movedDays.reduce((sum, day) => sum + day[method], 0);
  // Opening balance and reserve moves are per period, not per day.
  const periodOnly = data ? data.left - daysTotal : 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('methodDaysTitle', { method: label })}
      description={t('methodDaysDescription')}
      footer={<Button variant="primary" onClick={onClose}>{tc('close')}</Button>}
    >
      {movedDays.length === 0 ? (
        <EmptyState title={t('methodDaysEmpty')} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200" data-testid="method-days">
          {movedDays.map((day) => (
            <li key={day.date}>
              <button
                type="button"
                onClick={() => onSelectDay(day.date)}
                className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              >
                <span className="text-gray-700">{formatDateOnly(day.date, locale)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Money
                    amount={day[method]}
                    showPlus
                    currency={null}
                    className={cn('font-semibold tabular-nums', day[method] < 0 ? 'text-danger-600' : 'text-success-600')}
                  />
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && (
        <dl className="mt-4 space-y-1.5 rounded-xl bg-gray-50 px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-600">{t('methodDaysSum')}</dt>
            <dd className="font-semibold tabular-nums text-gray-900"><Money amount={daysTotal} currency={null} /></dd>
          </div>
          {periodOnly !== 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-600">{t('methodPeriodMoves')}</dt>
              <dd className="font-semibold tabular-nums text-gray-900"><Money amount={periodOnly} currency={null} /></dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-1.5">
            <dt className="font-semibold text-gray-900">{t('left')}</dt>
            <dd className="font-bold tabular-nums text-gray-900"><Money amount={data.left} currency={null} /></dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}
