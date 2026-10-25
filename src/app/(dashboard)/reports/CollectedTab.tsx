'use client';

import { useMemo, type ReactNode } from 'react';
import { CalendarCheck, CircleCheck, Hourglass, WalletCards } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  Money,
  SectionHeading,
  TableSkeleton,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { summarizeCollectedMoney, type CollectedDay, type CollectionMark } from '@/lib/calculations/collectedMoney';
import type { MoneyReportDay } from '@/lib/calculations/moneyReport';
import { formatDateOnly, formatDateTime, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type Method = 'cash' | 'terminal' | 'card' | 'playstation';

/** Reports' Collected tab: the money collectors took on each ticked date of the period. */
export default function CollectedTab({
  days,
  collections,
  enabledPaymentMethods,
  loading,
}: {
  days: MoneyReportDay[];
  collections: CollectionMark[];
  enabledPaymentMethods: readonly string[];
  loading: boolean;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const summary = useMemo(() => summarizeCollectedMoney(days, collections), [collections, days]);

  // A method the club turned off still shows while it carries collected money.
  const methods = (['cash', 'terminal', 'card', 'playstation'] as const).filter((method) => method === 'playstation'
    || enabledPaymentMethods.includes(method)
    || summary.taken[method] !== 0);

  function methodLabel(method: Method): string {
    return method === 'playstation' ? t('playstation') : tc(`paymentMethods.${method}`);
  }

  function amountCell(amount: number, strong = false) {
    return (
      <span className={cn('tabular-nums', strong ? 'font-semibold' : 'text-gray-700', amount < 0 && 'text-danger-600')}>
        <Money amount={amount} currency={null} />
      </span>
    );
  }

  const columns: DataTableColumn<CollectedDay>[] = [
    {
      key: 'date',
      header: t('date'),
      className: 'w-44 whitespace-nowrap',
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
          <span className="block text-gray-900">{row.collectorName || t('unknownCreator')}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{formatDateTime(row.collectedAt, locale)}</span>
        </span>
      ),
    },
    ...methods.map((method): DataTableColumn<CollectedDay> => ({
      key: method,
      header: methodLabel(method),
      align: 'right',
      className: 'w-36 whitespace-nowrap',
      render: (row) => amountCell(row[method]),
    })),
    {
      key: 'total',
      header: t('collectedTotal'),
      align: 'right',
      className: 'w-40 whitespace-nowrap',
      render: (row) => amountCell(row.total, true),
    },
  ];

  const footer: Partial<Record<string, ReactNode>> = {
    date: <span className="font-semibold text-gray-900">{t('collectedFooterTotal')}</span>,
    total: amountCell(summary.taken.total, true),
  };
  for (const method of methods) footer[method] = amountCell(summary.taken[method], true);

  return (
    <>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          loading={loading}
          label={t('collectedTakenTotal')}
          value={<Money amount={summary.taken.total} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
          tone="success"
          icon={WalletCards}
        />
        <MetricCard
          loading={loading}
          label={t('collectedDays')}
          value={formatNumber(summary.days.length)}
          icon={CalendarCheck}
        />
        <MetricCard
          loading={loading}
          label={t('notCollectedYet')}
          value={<Money amount={summary.pendingTotal} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
          helper={t('notCollectedDays', { count: summary.pendingDays })}
          tone={summary.pendingTotal > 0 ? 'warning' : 'default'}
          icon={Hourglass}
        />
      </section>

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader>
          <SectionHeading title={t('collectedTitle')} description={t('collectedDescription')} />
        </CardHeader>
        {loading ? (
          <TableSkeleton rows={6} columns={methods.length + 3} className="rounded-none border-0 shadow-none" />
        ) : (
          <DataTable
            bare
            label={t('collectedTitle')}
            minWidth={720}
            columns={columns}
            data={summary.days}
            keyExtractor={(row) => row.date}
            footer={summary.days.length > 0 ? footer : undefined}
            emptyState={<EmptyState compact title={t('collectedEmpty')} />}
          />
        )}
      </Card>
    </>
  );
}
