'use client';

import { useTranslations } from 'next-intl';
import { Badge, DatePicker, DetailHero, DetailList, InlineAlert, Modal, Money, Select, type BadgeVariant } from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { MoneyReportActivity } from '@/lib/calculations/moneyReport';
import type { ExchangeMethod } from '@/lib/calculations/moneyExchanges';
import { formatDateOnly, formatDollars, formatTime, formatUnitCurrency } from '@/lib/formatters';

/** What an owner may correct on an ordinary expense from its sheet. */
export type ExpenseCorrection = { paymentMethod: string } | { date: string } | { category: string };

export function activityKindVariant(kind: MoneyReportActivity['kind']): BadgeVariant {
  if (kind === 'income') return 'success';
  if (kind === 'debt_payment' || kind === 'exchange') return 'info';
  return 'danger';
}

/**
 * The details sheet of one closeout entry. Its facts are read-only, except
 * that an owner corrects an ordinary expense's date, category or payment
 * method in place (the page saves the change and reloads the report).
 */
export function EntryDetailsSheet({
  entry,
  onClose,
  error,
  closedBy,
  canCorrectExpense,
  canCorrectPaymentMethod,
  saving,
  businessToday,
  categoryOptions,
  paymentMethodOptions,
  activityTypeLabel,
  categoryLabel,
  expenseCategoryLabel,
  paymentLabel,
  exchangeAmountLabel,
  onCorrect,
}: {
  /** The entry and the business date it is listed under; null closes the sheet. */
  entry: { activity: MoneyReportActivity; date: string } | null;
  onClose: () => void;
  /** Translated result of a failed correction or delete. */
  error: string;
  /** Who collected the entry's day, when it is closed; null while the day is open. */
  closedBy: string | null;
  /** The date and category can be changed. */
  canCorrectExpense: boolean;
  canCorrectPaymentMethod: boolean;
  saving: boolean;
  businessToday: string;
  categoryOptions: readonly string[];
  paymentMethodOptions: readonly string[];
  activityTypeLabel: (activity: MoneyReportActivity) => string;
  categoryLabel: (activity: MoneyReportActivity) => string;
  expenseCategoryLabel: (category: string) => string;
  paymentLabel: (method: string | null) => string;
  exchangeAmountLabel: (method: ExchangeMethod, amount: number) => string;
  onCorrect: (change: ExpenseCorrection) => void;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const activity = entry?.activity;

  return (
    <Modal open={Boolean(entry)} onClose={onClose} title={t('entryDetails')} size="lg">
      {entry && activity && (
        <div className="space-y-5">
          {error && <InlineAlert variant="danger">{error}</InlineAlert>}
          {closedBy !== null && (
            <InlineAlert variant="danger" title={t('dayClosed')}>
              {t('dayClosedDetails', { name: closedBy })}
            </InlineAlert>
          )}
          <DetailHero
            badge={<Badge variant={activityKindVariant(activity.kind)}>{activityTypeLabel(activity)}</Badge>}
            title={categoryLabel(activity)}
            tone={activity.exchange ? 'neutral' : activity.amount < 0 ? 'danger' : 'success'}
            amount={activity.exchange ? (
              <>
                {exchangeAmountLabel(activity.exchange.from, activity.exchange.fromAmount)}
                {' → '}
                {exchangeAmountLabel(activity.exchange.to, activity.exchange.toAmount)}
              </>
            ) : (
              <Money amount={activity.amount} showPlus currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
            )}
          />

          <DetailList
            stack
            items={[
              {
                label: t('dateAndTime'),
                value: canCorrectExpense ? (
                  <span className="flex flex-col gap-1 sm:items-end">
                    <DatePicker
                      ariaLabel={t('date')}
                      value={entry.date}
                      max={businessToday}
                      disabled={saving}
                      className="w-56 max-w-full"
                      onChange={(date) => onCorrect({ date })}
                    />
                    <span className="text-xs font-normal text-gray-500">{t('addedAt', { time: formatTime(activity.createdAt, locale) })}</span>
                  </span>
                ) : (
                  <>{formatDateOnly(entry.date, locale)} · {formatTime(activity.createdAt, locale)}</>
                ),
              },
              {
                label: t('category'),
                value: canCorrectExpense && !activity.exchange ? (
                  <Select
                    value={activity.category ?? ''}
                    onChange={(event) => onCorrect({ category: event.target.value })}
                    disabled={saving}
                    aria-label={t('category')}
                    className="w-48 max-w-full"
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>{expenseCategoryLabel(category)}</option>
                    ))}
                  </Select>
                ) : (
                  categoryLabel(activity)
                ),
              },
              { label: t('addedBy'), value: activity.createdByName || t('unknownCreator') },
              activity.exchange?.rate != null && {
                label: t('exchangeRate'),
                value: <>{formatDollars(1)} = {formatUnitCurrency(activity.exchange.rate)} {tc('currency')}</>,
              },
              !activity.exchange && {
                label: t('paymentMethod'),
                value: activity.paymentBreakdown ? (
                  <span className="flex flex-wrap gap-2 sm:justify-end">
                    {Object.entries(activity.paymentBreakdown)
                      .filter(([, amount]) => amount !== 0)
                      .map(([method, amount]) => (
                        <Badge key={method} variant="outline">
                          {paymentLabel(method)} · <Money amount={amount} />
                        </Badge>
                      ))}
                  </span>
                ) : activity.dollars ? (
                  // Dollars were converted at their own rate, so the method stays.
                  <span>
                    {paymentLabel('usd')} · {formatDollars(activity.dollars.amount)}
                    <span className="block text-xs font-normal text-gray-500">
                      {t('exchangeRate')}: {formatUnitCurrency(activity.dollars.rate)} {tc('currency')}
                    </span>
                  </span>
                ) : canCorrectPaymentMethod ? (
                  <Select
                    value={activity.paymentMethod ?? ''}
                    onChange={(event) => onCorrect({ paymentMethod: event.target.value })}
                    disabled={saving}
                    aria-label={t('paymentMethod')}
                    className="w-40 max-w-full"
                  >
                    {paymentMethodOptions.map((method) => (
                      <option key={method} value={method}>{paymentLabel(method)}</option>
                    ))}
                  </Select>
                ) : (
                  paymentLabel(activity.paymentMethod)
                ),
              },
              { label: t('descriptionLabel'), value: activity.comment || t('noDescription') },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}
