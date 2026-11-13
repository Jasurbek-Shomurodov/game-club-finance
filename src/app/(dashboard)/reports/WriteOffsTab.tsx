'use client';

import { cn } from '@/lib/utils';
import { useCallback, useMemo } from 'react';
import { CalendarX, PackageMinus, PackageX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  LoadErrorAlert,
  MetricCard,
  Money,
  SectionHeading,
  TableSkeleton,
  type DataTableColumn,
  metricGridClassName,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatDateOnly, formatNumber } from '@/lib/formatters';
import {
  summarizeStockWriteOffs,
  type StockWriteOffCountRow,
  type StockWriteOffEntry,
  type StockWriteOffReportKind,
} from '@/lib/stockWriteOffs';

const EMPTY: StockWriteOffCountRow[] = [];

/** Reports' Write-offs tab: bar stock that went missing or expired in the period, at cost. */
export default function WriteOffsTab({ clubId, from, to }: { clubId: string | null; from: string; to: string }) {
  const t = useTranslations('reports');
  const tcs = useTranslations('closingStock');
  const { locale } = useAppLocale();

  const load = useCallback(async () => {
    if (!clubId) return EMPTY;
    const { data, error } = await fetchAllRows<StockWriteOffCountRow>(() => createClient()
      .from('daily_stock_counts')
      .select('date,product_id,adjustment_quantity,adjustment_reason,cost_price,products(name)')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .lt('adjustment_quantity', 0)
      .order('date', { ascending: false })
      .order('product_id', { ascending: true }));
    if (error) throw error;
    return data ?? EMPTY;
  }, [clubId, from, to]);
  const query = useClubQuery(clubId ? load : null, EMPTY);
  const summary = useMemo(() => summarizeStockWriteOffs(query.data), [query.data]);

  const kindLabel = (kind: StockWriteOffReportKind) => tcs(`writeOffKinds.${kind}`);
  const loss = (amount: number) => (
    <Money amount={amount} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
  );

  const columns: DataTableColumn<StockWriteOffEntry>[] = [
    {
      key: 'date',
      header: t('date'),
      className: 'w-36 whitespace-nowrap',
      render: (row) => <span className="font-medium text-gray-900">{formatDateOnly(row.date, locale)}</span>,
    },
    {
      key: 'product',
      header: t('writeOffsProduct'),
      className: 'min-w-[160px]',
      render: (row) => <span className="font-semibold text-gray-900">{row.productName || tcs('unknownProduct')}</span>,
    },
    {
      key: 'kind',
      header: t('writeOffsReason'),
      className: 'w-36',
      render: (row) => (
        <Badge variant={row.kind === 'expired' ? 'warning' : row.kind === 'shortage' ? 'danger' : 'neutral'} size="sm">
          {kindLabel(row.kind)}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: t('writeOffsQuantity'),
      align: 'right',
      className: 'w-28 whitespace-nowrap',
      render: (row) => <span className="tabular-nums">{t('writeOffsUnits', { count: formatNumber(row.quantity) })}</span>,
    },
    {
      key: 'cost',
      header: t('writeOffsCost'),
      align: 'right',
      className: 'w-40 whitespace-nowrap',
      render: (row) => <span className="font-semibold tabular-nums text-danger-600"><Money amount={row.cost} currency={null} /></span>,
    },
    {
      key: 'note',
      header: t('writeOffsNote'),
      className: 'min-w-[160px]',
      render: (row) => <span className="text-gray-500">{row.note || '—'}</span>,
    },
  ];

  if (query.error) {
    return (
      <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>
        {t('writeOffsLoadError')}
      </LoadErrorAlert>
    );
  }

  return (
    <>
      <section className={cn(metricGridClassName, 'sm:grid-cols-3')}>
        <MetricCard
          loading={query.loading}
          label={t('writeOffsTotal')}
          value={loss(summary.total.cost)}
          helper={t('writeOffsUnits', { count: formatNumber(summary.total.quantity) })}
          tone={summary.total.cost > 0 ? 'danger' : 'default'}
          icon={PackageMinus}
        />
        <MetricCard
          loading={query.loading}
          label={kindLabel('shortage')}
          value={loss(summary.byKind.shortage.cost)}
          helper={t('writeOffsUnits', { count: formatNumber(summary.byKind.shortage.quantity) })}
          icon={PackageX}
        />
        <MetricCard
          loading={query.loading}
          label={kindLabel('expired')}
          value={loss(summary.byKind.expired.cost)}
          helper={t('writeOffsUnits', { count: formatNumber(summary.byKind.expired.quantity) })}
          icon={CalendarX}
        />
      </section>

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader>
          <SectionHeading title={t('writeOffsTitle')} description={t('writeOffsDescription')} />
        </CardHeader>
        {query.loading ? (
          <TableSkeleton rows={5} columns={6} className="rounded-none border-0 shadow-none" />
        ) : (
          <DataTable
            mobileCards
            bare
            label={t('writeOffsTitle')}
            minWidth={720}
            columns={columns}
            data={summary.entries}
            keyExtractor={(row) => `${row.date}:${row.productId}`}
            emptyState={<EmptyState compact icon={PackageMinus} title={t('writeOffsEmpty')} />}
          />
        )}
      </Card>
    </>
  );
}
