'use client';

import { useState, type ReactNode } from 'react';
import { CircleCheck, PiggyBank, ReceiptText, Trash2, WalletCards } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardHeader,
  CurrencyInput,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  MetricCard,
  Modal,
  Money,
  SectionHeading,
  Select,
  TableSkeleton,
  type DataTableColumn,
  metricGridClassName,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  COLLECTED_METHODS,
  type CollectedMethod,
  type CollectedMoneySummary,
  type CollectionGroup,
} from '@/lib/calculations/collectedMoney';
import { formatCurrency, formatCurrencyInput, formatDateOnly, formatDateTime, parseCurrencyInput } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * Reports' Collected tab (migration 169): money collectors took out of the
 * admin's kassa, what it paid for, what went into the reserve, and what the
 * collector still holds.
 */
export default function CollectedTab({
  summary,
  collectorNames,
  enabledPaymentMethods,
  loading,
  isOwner,
  businessToday,
  onUndo,
  onMoveToReserve,
}: {
  summary: CollectedMoneySummary;
  collectorNames: ReadonlyMap<string, string | null>;
  enabledPaymentMethods: readonly string[];
  loading: boolean;
  isOwner: boolean;
  businessToday: string;
  onUndo: (group: CollectionGroup) => void;
  /** Resolves to an error message, or null when saved. */
  onMoveToReserve: (input: { method: CollectedMethod; amount: number; date: string }) => Promise<string | null>;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const [moveOpen, setMoveOpen] = useState(false);

  // A method the club turned off still shows while it carries collected money.
  const methods = COLLECTED_METHODS.filter((method) => (method !== 'playstation' && enabledPaymentMethods.includes(method))
    || summary.collected[method] !== 0 || summary.held[method] !== 0);

  function methodLabel(method: CollectedMethod): string {
    return method === 'playstation' ? t('playstation') : tc(`paymentMethods.${method}`);
  }

  function amountCell(amount: number, strong = false) {
    return (
      <span className={cn('tabular-nums', strong ? 'font-semibold' : 'text-gray-700', amount < 0 && 'text-danger-600')}>
        <Money amount={amount} currency={null} />
      </span>
    );
  }

  function byMethodHelper(values: Record<CollectedMethod, number>) {
    const shown = methods.filter((method) => values[method] !== 0);
    if (shown.length === 0) return undefined;
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
        {shown.map((method) => (
          <span key={method} className="whitespace-nowrap">
            {methodLabel(method)}{' '}
            <Money amount={values[method]} currency={null} className="font-medium text-gray-700" />
          </span>
        ))}
      </span>
    );
  }

  const columns: DataTableColumn<CollectionGroup>[] = [
    {
      key: 'date',
      header: t('date'),
      className: 'w-40 whitespace-nowrap',
      render: (row) => (
        <span className="flex items-center gap-2 font-semibold text-gray-900">
          <CircleCheck size={16} className="shrink-0 text-success-600" aria-hidden="true" />
          {formatDateOnly(row.date, locale)}
        </span>
      ),
    },
    {
      key: 'collector',
      header: t('collectedByColumn'),
      className: 'min-w-[200px]',
      render: (row) => (
        <span className="block">
          <span className="block text-gray-900">{(row.createdBy && collectorNames.get(row.createdBy)) || t('unknownCreator')}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{row.createdAt ? formatDateTime(row.createdAt, locale) : ''}</span>
          {row.comment && <span className="mt-0.5 block text-xs text-gray-600">{row.comment}</span>}
        </span>
      ),
    },
    ...methods.map((method): DataTableColumn<CollectionGroup> => ({
      key: method,
      header: methodLabel(method),
      align: 'right',
      className: 'w-32 whitespace-nowrap',
      render: (row) => amountCell(row[method]),
    })),
    {
      key: 'total',
      header: t('collectedTotal'),
      align: 'right',
      className: 'w-36 whitespace-nowrap',
      render: (row) => amountCell(row.total, true),
    },
    ...(isOwner ? [{
      key: 'actions',
      header: <span className="sr-only">{tc('actions')}</span>,
      align: 'right' as const,
      className: 'w-14',
      render: (row: CollectionGroup) => (
        <IconButton
          size="sm"
          variant="ghost"
          label={`${t('collectMoney.undo')}: ${formatDateOnly(row.date, locale)}`}
          icon={<Trash2 size={16} aria-hidden="true" />}
          onClick={(event) => {
            event.stopPropagation();
            onUndo(row);
          }}
        />
      ),
    }] : []),
  ];

  const footer: Partial<Record<string, ReactNode>> = {
    date: <span className="font-semibold text-gray-900">{t('collectedFooterTotal')}</span>,
    total: amountCell(summary.collected.total, true),
  };
  for (const method of methods) footer[method] = amountCell(summary.collected[method], true);

  return (
    <>
      <section className={cn(metricGridClassName, 'sm:grid-cols-3')}>
        <MetricCard
          loading={loading}
          label={t('collectedTakenTotal')}
          value={<Money amount={summary.collected.total} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
          helper={byMethodHelper(summary.collected)}
          tone="success"
          icon={WalletCards}
        />
        <MetricCard
          loading={loading}
          label={t('collectMoney.paidFromCollected')}
          value={<Money amount={summary.spent.total} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
          helper={byMethodHelper(summary.spent)}
          icon={ReceiptText}
        />
        <MetricCard
          loading={loading}
          label={t('collectMoney.movedToReserve')}
          value={<Money amount={summary.toReserve.total} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
          helper={byMethodHelper(summary.toReserve)}
          icon={PiggyBank}
        />
      </section>

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading title={t('collectedTitle')} description={t('collectedDescription')} />
            {isOwner && (
              <Button
                variant="secondary"
                icon={<PiggyBank size={16} aria-hidden="true" />}
                disabled={summary.held.total <= 0}
                onClick={() => setMoveOpen(true)}
              >
                {t('collectMoney.toReserveButton')}
              </Button>
            )}
          </div>
        </CardHeader>
        {loading ? (
          <TableSkeleton rows={6} columns={methods.length + 3} className="rounded-none border-0 shadow-none" />
        ) : (
          <DataTable
            mobileCards
            bare
            label={t('collectedTitle')}
            minWidth={720}
            columns={columns}
            data={summary.collections}
            keyExtractor={(row) => row.id}
            footer={summary.collections.length > 0 ? footer : undefined}
            emptyState={<EmptyState compact title={t('collectedEmpty')} />}
          />
        )}
      </Card>

      {moveOpen && (
        <MoveToReserveModal
          held={summary.held}
          methods={methods}
          methodLabel={methodLabel}
          businessToday={businessToday}
          onClose={() => setMoveOpen(false)}
          onSubmit={async (input) => {
            const error = await onMoveToReserve(input);
            if (!error) setMoveOpen(false);
            return error;
          }}
        />
      )}
    </>
  );
}

function MoveToReserveModal({
  held,
  methods,
  methodLabel,
  businessToday,
  onClose,
  onSubmit,
}: {
  held: Record<CollectedMethod, number>;
  methods: readonly CollectedMethod[];
  methodLabel: (method: CollectedMethod) => string;
  businessToday: string;
  onClose: () => void;
  onSubmit: (input: { method: CollectedMethod; amount: number; date: string }) => Promise<string | null>;
}) {
  const tm = useTranslations('reports.collectMoney');
  const tc = useTranslations('common');
  const withMoney = methods.filter((method) => held[method] > 0);
  const [method, setMethod] = useState<CollectedMethod>(withMoney[0] ?? 'cash');
  const [amount, setAmount] = useState(() => formatCurrencyInput(Math.max(0, held[withMoney[0] ?? 'cash'])));
  const [date, setDate] = useState(businessToday);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const limit = Math.max(0, held[method]);
  const value = parseCurrencyInput(amount);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (value <= 0 || value > limit) {
      setError(tm('toReserveTooMuch', { amount: `${formatCurrency(limit)} ${tc('currency')}` }));
      return;
    }
    setSaving(true);
    setError('');
    const failure = await onSubmit({ method, amount: value, date });
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <Modal open onClose={onClose} locked={saving} title={tm('toReserveTitle')} description={tm('toReserveDescription')}>
      <form onSubmit={submit} className="space-y-5">
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        <Field label={tm('method')} htmlFor="to-reserve-method">
          <Select
            id="to-reserve-method"
            value={method}
            onChange={(event) => {
              const next = event.target.value as CollectedMethod;
              setMethod(next);
              setAmount(formatCurrencyInput(Math.max(0, held[next])));
            }}
          >
            {withMoney.map((option) => (
              <option key={option} value={option}>{methodLabel(option)}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={tm('amount')}
          htmlFor="to-reserve-amount"
          required
          hint={tm('available', { amount: `${formatCurrency(limit)} ${tc('currency')}` })}
        >
          <CurrencyInput
            id="to-reserve-amount"
            controlSize="lg"
            required
            value={amount}
            onValueChange={(next) => setAmount(parseCurrencyInput(next) > limit ? formatCurrencyInput(limit) : next)}
            trailingAddon={tc('currency')}
          />
        </Field>
        <Field label={tm('date')}>
          <DatePicker ariaLabel={tm('date')} value={date} max={businessToday} onChange={setDate} />
        </Field>
        <Button type="submit" size="lg" fullWidth loading={saving} loadingLabel={tc('saving')} disabled={limit <= 0}
          icon={<PiggyBank size={18} aria-hidden="true" />}>
          {tm('toReserveSubmit')}
        </Button>
      </form>
    </Modal>
  );
}
