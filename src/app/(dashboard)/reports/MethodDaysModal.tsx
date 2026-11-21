'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button, DetailList, EmptyState, Modal, Money, TappableSurface } from '@/components/PresentationFoundation';
import { ShareBar } from '@/components/charts/ShareBar';
import { chartColors } from '@/components/dashboard/ChartCard';
import { moneyStillHeld } from '@/lib/calculations/collectedMoney';
import type { MoneyReportDay, MoneyReportPaymentBreakdown } from '@/lib/calculations/moneyReport';
import { formatDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export type PaymentMethodFigure = 'cash' | 'terminal' | 'card' | 'playstation';

interface MethodDaysModalProps {
  /** The method tile the owner tapped; null closes the dialog. */
  method: PaymentMethodFigure | null;
  label: string;
  days: readonly MoneyReportDay[];
  data: MoneyReportPaymentBreakdown | null;
  /** What collected money (169) still holds of this method, over the same span as `data.left`. */
  taken: number;
  onSelectDay: (date: string) => void;
  onClose: () => void;
}

/**
 * Everything behind one payment method's "money left": what it started with,
 * took in, paid, exchanged and put into the reserve, what the collector holds
 * of it, then the days that moved it, newest first. Tapping a day opens its
 * entries narrowed to that method, so the figures can be traced back.
 */
export function MethodDaysModal({ method, label, days, data, taken, onSelectDay, onClose }: MethodDaysModalProps) {
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
  const amount = (value: number, className?: string) => <Money amount={value} currency={null} className={className} />;
  const signedClassName = (value: number) => (value < 0 ? 'text-danger-600' : 'text-success-600');

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('methodDaysTitle', { method: label })}
      description={t('methodDaysDescription')}
      footer={<Button variant="primary" onClick={onClose}>{tc('close')}</Button>}
    >
      {data && (
        <div className="mb-4 space-y-3" data-testid="method-breakdown">
          {/* What the method's money did over the period: spent, exchanged out, into the reserve, still left. */}
          <ShareBar
            size="sm"
            legend={false}
            label={label}
            locale={locale}
            parts={[
              { key: 'expenses', label: t('expenses'), value: data.expenses, color: chartColors.danger },
              { key: 'out', label: t('exchangedOut'), value: data.exchangedOut, color: chartColors.gray },
              { key: 'reserve', label: t('intoReserve'), value: data.reserved ?? 0, color: chartColors.purple },
              { key: 'left', label: t('left'), value: data.left, color: chartColors.success },
            ]}
          />
          <DetailList
            items={[
              data.opening !== 0 && { label: t('openingBalance'), value: amount(data.opening, data.opening < 0 ? 'text-danger-600' : undefined) },
              { label: t('collected'), value: amount(data.collected) },
              { label: t('expenses'), value: amount(data.expenses, 'text-danger-600') },
              data.exchangedIn !== 0 && { label: t('exchangedIn'), value: amount(data.exchangedIn) },
              data.exchangedOut !== 0 && { label: t('exchangedOut'), value: amount(data.exchangedOut) },
              // The reserve is the owner's own money (156): what went into it is no longer this method's.
              (data.reserved ?? 0) !== 0 && { label: t('intoReserve'), value: amount(data.reserved ?? 0) },
              { key: 'left', label: t('left'), value: amount(data.left, cn('font-bold', signedClassName(data.left))) },
              // Money left is what the method earned; part of it is already with the collector (169).
              { label: t('takenByCollection'), value: amount(taken) },
              { label: t('stillInKassa'), value: amount(moneyStillHeld(data.left, taken), cn('font-bold', signedClassName(moneyStillHeld(data.left, taken)))) },
            ]}
          />
        </div>
      )}
      {movedDays.length === 0 ? (
        <EmptyState compact title={t('methodDaysEmpty')} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100" data-testid="method-days">
          {movedDays.map((day) => (
            <li key={day.date}>
              {/* The surface is a block; the row layout sits inside it. */}
              <TappableSurface onClick={() => onSelectDay(day.date)} className="rounded-xl px-3 py-2.5 pr-9 text-sm">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-gray-700">{formatDateOnly(day.date, locale)}</span>
                  <Money amount={day[method]} showPlus currency={null} className={cn('shrink-0 font-semibold', signedClassName(day[method]))} />
                </span>
              </TappableSurface>
            </li>
          ))}
        </ul>
      )}
      {data && (
        <DetailList
          className="mt-4"
          items={[
            { label: t('methodDaysSum'), value: amount(daysTotal) },
            periodOnly !== 0 && { label: t('methodPeriodMoves'), value: amount(periodOnly) },
            { key: 'total', label: t('left'), value: amount(data.left, 'font-bold') },
          ]}
        />
      )}
    </Modal>
  );
}
