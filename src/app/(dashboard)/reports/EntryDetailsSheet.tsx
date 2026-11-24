'use client';

import { useTranslations } from 'next-intl';
import { PiggyBank } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DatePicker,
  DetailHero,
  DetailList,
  IconButton,
  IconChip,
  InlineAlert,
  Modal,
  Money,
  SectionHeading,
  Select,
  toneClasses,
  type BadgeVariant,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import {
  entryMethodReserveAmounts,
  entryMethodRows,
  entryReserveActions,
  isGameClubIncomeEntry,
  type EntryReserveActions,
} from '@/lib/calculations/entryReserve';
import type { MoneyReportActivity } from '@/lib/calculations/moneyReport';
import type { ExchangeMethod } from '@/lib/calculations/moneyExchanges';
import type { ReserveDepositAmounts } from '@/lib/calculations/ownerReserve';
import { reserveHistoryHref } from '@/lib/detailLinks';
import { formatDateOnly, formatDollars, formatTime, formatUnitCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** What an owner may correct on an ordinary expense from its sheet. */
export type ExpenseCorrection = { paymentMethod: string } | { date: string } | { category: string };

export function activityKindVariant(kind: MoneyReportActivity['kind']): BadgeVariant {
  if (kind === 'income') return 'success';
  if (kind === 'debt_payment' || kind === 'exchange') return 'info';
  return 'danger';
}

export interface EntryDetailsProps {
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
  /** An owner: an income entry's money can go into the reserve from here. */
  canMoveToReserve: boolean;
  /** Game Club money that went into the reserve on the entry's day; shown to an owner when above zero. */
  reservedThatDay: number;
  /** Opens the reserve deposit form for the entry's day, starting from these amounts. */
  onMoveToReserve: (amounts: ReserveDepositAmounts) => void;
}

/** The reserve actions the sheet offers on an entry, whether or not its day is closed. */
function reserveActionsOf(entry: EntryDetailsProps['entry'], canMoveToReserve: boolean): EntryReserveActions {
  if (!entry) return { kind: 'none' };
  return entryReserveActions({ canMoveToReserve, activity: entry.activity });
}

/**
 * The details sheet of one closeout entry. Its facts are read-only, except
 * that an owner corrects an ordinary expense's date, category or payment
 * method in place (the page saves the change and reloads the report), and
 * moves an income entry's money into the reserve through the page's deposit form.
 */
export function EntryDetailsSheet(props: EntryDetailsProps) {
  const t = useTranslations('reports');
  const { entry, onClose, canMoveToReserve, onMoveToReserve } = props;
  const actions = reserveActionsOf(entry, canMoveToReserve);

  return (
    <Modal
      open={Boolean(entry)}
      onClose={onClose}
      title={t('entryDetails')}
      size="lg"
      footer={actions.kind === 'open' ? <EntryDetailsFooter actions={actions} onMoveToReserve={onMoveToReserve} /> : undefined}
    >
      {entry && <EntryDetailsBody {...props} entry={entry} />}
    </Modal>
  );
}

/** The sheet's footer for an owner on an income entry: everything the entry brought in, to the reserve. */
export function EntryDetailsFooter({ actions, onMoveToReserve }: {
  actions: Extract<EntryReserveActions, { kind: 'open' }>;
  onMoveToReserve: (amounts: ReserveDepositAmounts) => void;
}) {
  const t = useTranslations('reports');
  return (
    <Button variant="primary" fullWidth icon={<PiggyBank size={18} aria-hidden="true" />} onClick={() => onMoveToReserve(actions.all)}>
      {t('entryReserve.moveAll')}
    </Button>
  );
}

/** The sheet's content for one entry. */
export function EntryDetailsBody({
  entry,
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
  canMoveToReserve,
  reservedThatDay,
  onMoveToReserve,
}: Omit<EntryDetailsProps, 'entry' | 'onClose'> & { entry: NonNullable<EntryDetailsProps['entry']> }) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { activity } = entry;
  const actions = reserveActionsOf(entry, canMoveToReserve);
  const methodRows = entryMethodRows(activity.paymentBreakdown);
  const showReserved = canMoveToReserve && isGameClubIncomeEntry(activity) && reservedThatDay > 0;

  return (
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

      {activity.paymentBreakdown && methodRows.length > 0 && (
        <section>
          <SectionHeading as="h3" size="sm" title={t('entryReserve.methodsTitle')} />
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
            {methodRows.map((row) => {
              const Icon = PAYMENT_METHOD_ICONS[row.method];
              const amounts = entryMethodReserveAmounts(actions, row.method);
              const label = paymentLabel(row.method);
              return (
                <li key={row.method} className="flex items-center gap-3 px-4 py-2.5">
                  <IconChip icon={Icon} tone="primary" size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-gray-700">{label}</span>
                      <Money
                        amount={row.amount}
                        className={cn('font-semibold', row.amount < 0 ? toneClasses.danger.text : 'text-gray-900')}
                        currencyClassName="text-xs text-gray-500"
                      />
                    </div>
                    {row.share > 0 && (
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                        <span className={cn('grow-x block h-full rounded-full', toneClasses.primary.solid)} style={{ width: `${row.share * 100}%` }} />
                      </div>
                    )}
                  </div>
                  {amounts && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={t('entryReserve.moveMethod', { method: label })}
                      icon={<PiggyBank size={16} className={toneClasses.reserve.text} aria-hidden="true" />}
                      onClick={() => onMoveToReserve(amounts)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {showReserved && (
        <Card href={reserveHistoryHref()} padding="sm">
          <span className="flex items-center gap-3">
            <IconChip icon={PiggyBank} tone="reserve" size="sm" />
            <span className="min-w-0 flex-1 text-sm text-gray-700">{t('entryReserve.reservedThatDay')}</span>
            <Money amount={reservedThatDay} className={cn('text-sm font-semibold', toneClasses.reserve.text)} />
          </span>
        </Card>
      )}

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
          // A split entry lists its methods above; an entry with no money moved by any method says so here.
          !activity.exchange && !(activity.paymentBreakdown && methodRows.length > 0) && {
            label: t('paymentMethod'),
            value: activity.paymentBreakdown ? (
              t('noDescription')
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
        ]}
      />

      <Card tone="muted" padding="sm">
        <p className="text-xs font-medium text-gray-500">{t('descriptionLabel')}</p>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-900">{activity.comment || t('noDescription')}</p>
      </Card>
    </div>
  );
}
