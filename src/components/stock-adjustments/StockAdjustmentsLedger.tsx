'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CalendarX, PackageMinus, PackagePlus, PackageX, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  LoadErrorAlert,
  MetricCard,
  Money,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  TableSkeleton,
  metricGridClassName,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty, chartColors } from '@/components/dashboard/ChartCard';
import { DailyInOutChart } from '@/components/charts/DailyInOutChart';
import { InOutChartSkeleton } from '@/components/charts/ChartSkeletons';
import { WriteOffDetailsModal } from '@/components/WriteOffDetailsModal';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { useClubQuery } from '@/lib/useClubQuery';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateOnly, formatDateShort, formatNumber } from '@/lib/formatters';
import {
  STOCK_ADJUSTMENT_GROUPS,
  summarizeStockAdjustments,
  writeOffEntryKey,
  writeOffKindVariant,
  type StockAdjustmentEntry,
  type StockAdjustmentGroup,
  type StockWriteOffCountRow,
} from '@/lib/stockWriteOffs';

const EMPTY: StockWriteOffCountRow[] = [];
type GroupFilter = StockAdjustmentGroup | 'all';
const TOP_PRODUCTS = 6;

/** An adjustment's units in a table cell: added stock reads green with a plus, removed stock plain with a minus. */
export function AdjustmentQuantity({ sign, children }: { sign: 1 | -1; children: ReactNode }) {
  return (
    <span className={cn('font-semibold tabular-nums', sign === 1 ? 'text-success-600' : 'text-gray-900')}>
      {sign === 1 ? '+' : '−'}{children}
    </span>
  );
}

/** An adjustment's value at cost in a table cell: a loss in the danger tone, stock added back in success. */
export function AdjustmentCost({ sign, amount }: { sign: 1 | -1; amount: number }) {
  return (
    <span className={cn('font-semibold tabular-nums', sign === 1 ? 'text-success-600' : 'text-danger-600')}>
      {sign === 1 ? '+' : '−'}<Money amount={amount} currency={null} />
    </span>
  );
}

/** Stable key of a ledger row: a product can carry one adjustment per day. */
const entryKey = (entry: StockAdjustmentEntry) => writeOffEntryKey(entry);

/**
 * Every bar stock adjustment of a period on one screen: what was written off
 * (shortage, expired), what was found and added back (corrections), the days
 * it happened on and the products it keeps happening to. Tapping a card
 * filters the list by reason, a product filters by product, a row opens the
 * adjustment with a link to that day's count.
 *
 * Money (value at cost) is the owner's to see; everyone else reads units.
 * `refreshKey` reloads the period after the caller saves an adjustment.
 */
export function StockAdjustmentsLedger({ clubId, from, to, showCost, refreshKey = 0 }: {
  clubId: string | null;
  from: string;
  to: string;
  showCost: boolean;
  refreshKey?: number;
}) {
  const t = useTranslations('writeOffs');
  const tcs = useTranslations('closingStock');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const [group, setGroup] = useState<GroupFilter>('all');
  const [productId, setProductId] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockAdjustmentEntry | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return EMPTY;
    // refreshKey only re-runs the load; the query itself does not use it.
    void refreshKey;
    const { data, error } = await fetchAllRows<StockWriteOffCountRow>(() => createClient()
      .from('daily_stock_counts')
      .select('date,product_id,adjustment_quantity,adjustment_reason,cost_price,products(name)')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .neq('adjustment_quantity', 0)
      .order('date', { ascending: false })
      .order('product_id', { ascending: true }));
    if (error) throw error;
    return data ?? EMPTY;
  }, [clubId, from, to, refreshKey]);
  const query = useClubQuery(clubId ? load : null, EMPTY);
  const summary = useMemo(() => summarizeStockAdjustments(query.data), [query.data]);

  const groupLabel = (value: StockAdjustmentGroup) => tcs(`writeOffKinds.${value}`);
  const units = (count: number) => t('units', { count: formatNumber(count) });
  const productName = (name: string) => name || tcs('unknownProduct');
  const filteredProduct = productId ? summary.byProduct.find((product) => product.productId === productId) ?? null : null;
  const entries = summary.entries.filter((entry) => (
    (group === 'all' || entry.group === group) && (!filteredProduct || entry.productId === filteredProduct.productId)
  ));
  const toggleGroup = (value: StockAdjustmentGroup) => setGroup((current) => (current === value ? 'all' : value));

  // The owner reads money, everyone else units; both charts and cards follow.
  const figure = (totals: { quantity: number; cost: number }) => (showCost ? totals.cost : totals.quantity);
  const cardValue = (totals: { quantity: number; cost: number }, sign: '' | '+' = '') => (showCost
    ? <Money amount={totals.cost} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
    : `${totals.quantity > 0 ? sign : ''}${units(totals.quantity)}`);
  const cardHelper = (totals: { quantity: number }, sign: '' | '+' = '') => (
    showCost ? `${totals.quantity > 0 ? sign : ''}${units(totals.quantity)}` : undefined
  );

  const chartRows = summary.byDay.map((day) => ({
    date: day.date,
    label: formatDateShort(day.date, locale),
    income: showCost ? day.addedCost : day.addedQuantity,
    expenses: showCost ? day.lossCost : day.lossQuantity,
  }));
  const topProducts = summary.byProduct.slice(0, TOP_PRODUCTS);
  const topScale = Math.max(1, ...topProducts.map((product) => (
    showCost ? product.lossCost + product.addedCost : product.lossQuantity + product.addedQuantity
  )));

  const columns: DataTableColumn<StockAdjustmentEntry>[] = [
    {
      key: 'product',
      header: t('product'),
      className: 'min-w-[180px]',
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={productName(row.productName)} size="sm" tone="neutral" />
          <span className="font-semibold text-gray-900">{productName(row.productName)}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: t('date'),
      className: 'w-36 whitespace-nowrap',
      render: (row) => <span className="font-medium text-gray-900">{formatDateOnly(row.date, locale)}</span>,
    },
    {
      key: 'kind',
      header: t('reason'),
      className: 'w-36',
      render: (row) => <Badge variant={writeOffKindVariant(row.kind === 'other' && row.sign === 1 ? 'correction' : row.kind)} size="sm">{groupLabel(row.group)}</Badge>,
    },
    {
      key: 'quantity',
      header: t('quantity'),
      align: 'right',
      className: 'w-28 whitespace-nowrap',
      render: (row) => <AdjustmentQuantity sign={row.sign}>{units(row.quantity)}</AdjustmentQuantity>,
    },
    ...(showCost ? [{
      key: 'cost',
      header: t('valueAtCost'),
      align: 'right' as const,
      className: 'w-40 whitespace-nowrap',
      render: (row: StockAdjustmentEntry) => <AdjustmentCost sign={row.sign} amount={row.cost} />,
    }] : []),
    {
      key: 'note',
      header: t('note'),
      className: 'min-w-[160px]',
      mobile: 'full',
      render: (row) => <span className="text-gray-500">{row.note || '—'}</span>,
    },
  ];

  if (query.error) {
    return (
      <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>
        {t('ledgerLoadError')}
      </LoadErrorAlert>
    );
  }

  const filterOptions = [
    { value: 'all' as const, label: `${t('filterAll')} · ${formatNumber(summary.entries.length)}` },
    ...STOCK_ADJUSTMENT_GROUPS
      .filter((value) => summary.byGroup[value].quantity > 0)
      .map((value) => ({ value, label: groupLabel(value) })),
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className={cn(metricGridClassName, 'stagger lg:grid-cols-4')} aria-label={t('ledgerTitle')}>
        <MetricCard
          loading={query.loading}
          label={t('lossesTotal')}
          value={cardValue(summary.losses)}
          helper={cardHelper(summary.losses)}
          tone={summary.losses.quantity > 0 ? 'danger' : 'default'}
          accent="danger"
          icon={PackageMinus}
          onClick={() => { setGroup('all'); setProductId(null); }}
        />
        <MetricCard
          loading={query.loading}
          label={groupLabel('shortage')}
          value={cardValue(summary.byGroup.shortage)}
          helper={cardHelper(summary.byGroup.shortage)}
          accent="danger"
          icon={PackageX}
          selected={group === 'shortage'}
          onClick={() => toggleGroup('shortage')}
        />
        <MetricCard
          loading={query.loading}
          label={groupLabel('expired')}
          value={cardValue(summary.byGroup.expired)}
          helper={cardHelper(summary.byGroup.expired)}
          accent="warning"
          icon={CalendarX}
          selected={group === 'expired'}
          onClick={() => toggleGroup('expired')}
        />
        <MetricCard
          loading={query.loading}
          label={t('correctionsTotal')}
          value={cardValue(summary.additions, '+')}
          helper={cardHelper(summary.additions, '+') ?? t('correctionsHint')}
          tone={summary.additions.quantity > 0 ? 'success' : 'default'}
          accent="success"
          icon={PackagePlus}
          selected={group === 'correction'}
          onClick={() => toggleGroup('correction')}
        />
      </section>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ChartCard title={t('chartTitle')} description={showCost ? t('chartDescription') : t('chartDescriptionUnits')}>
          {query.loading ? (
            <InOutChartSkeleton height={280} className="mt-3" />
          ) : chartRows.length === 0 ? (
            <ChartEmpty title={t('ledgerEmpty')} className="mt-3" />
          ) : (
            <div className="mt-3">
              <DailyInOutChart
                data={chartRows}
                incomeLabel={t('chartCorrections')}
                expensesLabel={t('chartLosses')}
                legendLabel={t('chartTitle')}
                currency={showCost ? tc('currency') : tcs('pcs')}
                locale={locale}
                incomeColor={chartColors.success}
                expensesColor={chartColors.danger}
                height={280}
              />
            </div>
          )}
        </ChartCard>

        <ChartCard title={t('topProductsTitle')} description={t('topProductsDescription')}>
          {query.loading ? (
            <div className="mt-3 space-y-3" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full rounded-lg bg-gray-100" />)}
            </div>
          ) : topProducts.length === 0 ? (
            <ChartEmpty title={t('ledgerEmpty')} className="mt-3" />
          ) : (
            <ul className="stagger mt-3 space-y-1">
              {topProducts.map((product) => {
                const lost = figure({ quantity: product.lossQuantity, cost: product.lossCost });
                const added = figure({ quantity: product.addedQuantity, cost: product.addedCost });
                const active = productId === product.productId;
                return (
                  <li key={product.productId}>
                    <button
                      type="button"
                      onClick={() => setProductId(active ? null : product.productId)}
                      aria-pressed={active}
                      className={cn(
                        'tappable w-full rounded-xl border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        active ? 'border-primary-300 bg-primary-50/60' : 'border-transparent hover:bg-gray-50',
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{productName(product.productName)}</span>
                        <span className="shrink-0 text-xs tabular-nums">
                          {product.lossQuantity > 0 && (
                            <span className="font-semibold text-danger-600">−{showCost ? formatCurrency(product.lossCost) : units(product.lossQuantity)}</span>
                          )}
                          {product.lossQuantity > 0 && product.addedQuantity > 0 && <span className="text-gray-300"> · </span>}
                          {product.addedQuantity > 0 && (
                            <span className="font-semibold text-success-600">+{showCost ? formatCurrency(product.addedCost) : units(product.addedQuantity)}</span>
                          )}
                        </span>
                      </span>
                      <span className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                        {lost > 0 && <span className="grow-x h-full rounded-full bg-danger-500" style={{ width: `${(lost / topScale) * 100}%` }} />}
                        {added > 0 && <span className="grow-x h-full rounded-full bg-success-500" style={{ width: `${(added / topScale) * 100}%` }} />}
                      </span>
                      <span className="mt-1 block text-xs text-gray-500">{t('productDays', { count: product.days })}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader className="space-y-3">
          <SectionHeading title={t('ledgerTitle')} description={showCost ? t('ledgerDescription') : t('ledgerDescriptionUnits')} />
          {!query.loading && summary.entries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl variant="chips" size="sm" label={t('reason')} options={filterOptions} value={group} onChange={setGroup} />
              {filteredProduct && (
                <Button variant="secondary" size="sm" onClick={() => setProductId(null)} iconRight={<X size={14} aria-hidden="true" />}>
                  {productName(filteredProduct.productName)}
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        {query.loading ? (
          <TableSkeleton bare rows={5} columns={columns.length} />
        ) : (
          <DataTable
            mobileCards
            bare
            label={t('ledgerTitle')}
            minWidth={760}
            columns={columns}
            data={entries}
            keyExtractor={entryKey}
            onRowClick={setSelected}
            emptyState={<EmptyState compact icon={PackageMinus} title={summary.entries.length === 0 ? t('ledgerEmpty') : t('ledgerEmptyFiltered')} />}
          />
        )}
      </Card>
      <WriteOffDetailsModal entry={selected} showCost={showCost} onClose={() => setSelected(null)} />
    </div>
  );
}
