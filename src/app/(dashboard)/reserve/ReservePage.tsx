'use client';

// Route: /reserve (owners only): the owner reserve (jamg'arma), its charts and its history.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, ShoppingCart } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useClub } from '@/components/layout/DashboardShell';
import { ChartCard, ChartEmpty, categoricalColors, chartColors } from '@/components/dashboard/ChartCard';
import { rankShares } from '@/lib/calculations/insights';
import { formatPercentShare } from '@/components/charts/chartFormat';
import {
  Button,
  ButtonLink,
  Card,
  ChartSkeleton,
  EmptyState,
  LoadErrorAlert,
  PageHeader,
  SegmentedControl,
  SkeletonStatus,
  StatTile,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { dollarsForMonth } from '@/lib/calculations/moneyExchanges';
import {
  reserveActivity,
  reserveBalances,
  reserveBuyLimits,
  reserveDailySeries,
  reserveDollarRates,
  reserveFlowTotals,
  reserveMonthlySeries,
  type ReserveActivity,
} from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatDateShort, formatUnitCurrency } from '@/lib/formatters';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_OWNER_RESERVE, fetchOwnerReserve } from '@/lib/supabase/ownerMoney';
import { requestReserveDelete, requestReserveExchangeDelete, requestReservePurchaseDelete } from '@/lib/ownerReserveRequests';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import type { OwnerReserveMethod } from '@/types';
import { ReserveExchangeModal } from './ReserveExchangeModal';
import { ReserveHistoryList, type DeletableReserveActivity } from './ReserveHistoryList';
import { ReserveOverviewSkeleton } from './ReserveSkeleton';

function ChartLoading() {
  return <ChartSkeleton />;
}
const loadCharts = () => import('./ReserveCharts');
const ReserveBalanceChart = dynamic(() => loadCharts().then((module) => module.ReserveBalanceChart), { ssr: false, loading: ChartLoading });
const ReserveFlowChart = dynamic(() => loadCharts().then((module) => module.ReserveFlowChart), { ssr: false, loading: ChartLoading });
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), { ssr: false, loading: ChartLoading });

type ReserveView = 'overview' | 'history';
type HistoryFilter = 'all' | ReserveActivity['kind'];
const FILTER_KINDS: readonly ReserveActivity['kind'][] = ['deposit', 'return', 'purchase', 'exchange'];

export default function ReservePage() {
  const sectionTabs = useSectionTabs('ownerMoney');
  const t = useTranslations('reservePage');
  const tr = useTranslations('ownerReserve');
  const tm = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedClubId, role, businessDayStartHour } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const currentMonth = businessToday.slice(0, 7);
  const isOwner = role === 'owner';
  const { showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ReserveView>(() => (searchParams.get('view') === 'history' ? 'history' : 'overview'));
  const showHistory = () => {
    setView('history');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exchangeDirection, setExchangeDirection] = useState<'buy' | 'sell' | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  // Keep the tab shareable.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'history') params.set('view', 'history');
    else params.delete('view');
    const nextQuery = params.toString();
    if (nextQuery !== searchParams.toString()) {
      window.history.replaceState(null, '', nextQuery ? `${pathname}?${nextQuery}` : pathname);
    }
  }, [pathname, searchParams, view]);

  const load = useCallback(async (isCurrent: () => boolean) => (
    selectedClubId && isOwner ? fetchOwnerReserve(createClient(), selectedClubId, businessToday, isCurrent) : EMPTY_OWNER_RESERVE
  ), [businessToday, isOwner, selectedClubId]);
  const query = useClubQuery(load, EMPTY_OWNER_RESERVE);
  const { reserveEntries, reserveExpenses, exchangeRows, dollarExpenses, reserveSupported } = query.data;
  // A club switch or business-day rollover replaces the loader; a delete confirmed under the old one is stale.
  const currentLoad = useRef(load);
  useEffect(() => { currentLoad.current = load; }, [load]);

  const balances = useMemo(() => reserveBalances(reserveEntries, reserveExpenses), [reserveEntries, reserveExpenses]);
  const activity = useMemo(() => reserveActivity(reserveEntries, reserveExpenses), [reserveEntries, reserveExpenses]);
  const series = useMemo(() => reserveMonthlySeries(reserveEntries, reserveExpenses, currentMonth), [reserveEntries, reserveExpenses, currentMonth]);
  const dailySeries = useMemo(() => reserveDailySeries(reserveEntries, reserveExpenses, businessToday), [reserveEntries, reserveExpenses, businessToday]);
  const dollarsHeld = useMemo(() => dollarsForMonth(exchangeRows, currentMonth, dollarExpenses).heldUsd, [exchangeRows, currentMonth, dollarExpenses]);

  const currency = tc('currency');
  // Two pots (155): the sums, whatever side or method they were saved from, and the dollars.
  const sumsHeld = balances.game_club.held + balances.bar.held - balances.game_club.byMethod.usd;
  // As the history shows it: exchanges inside the reserve (170) move nothing in or out.
  const totals = useMemo(() => reserveFlowTotals(activity), [activity]);
  const dollarsSumsValue = balances.game_club.byMethod.usd;
  const buyLimits = useMemo(() => reserveBuyLimits(reserveEntries, sumsHeld), [reserveEntries, sumsHeld]);
  const rates = useMemo(() => reserveDollarRates(exchangeRows, dollarsHeld, dollarsSumsValue), [exchangeRows, dollarsHeld, dollarsSumsValue]);
  const canBuy = buyLimits.cash > 0 || buyLimits.terminal > 0 || buyLimits.card > 0;
  const te = useTranslations('expenses');
  // What the reserve paid for, largest category first; the tail folds into "other".
  const spendingSlices = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const row of activity) {
      if (row.kind === 'purchase') byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
    }
    const label = (category: string) => {
      const key = `categories.${category}`;
      return te.has(key) ? te(key as Parameters<typeof te>[0]) : category.replace(/_/g, ' ');
    };
    let colorIndex = 0;
    return rankShares(
      [...byCategory.entries()].map(([category, value]) => ({ key: category, label: label(category), value })),
      categoricalColors.length,
      { key: 'other', label: te('categories.other') },
    ).map((slice) => ({
      ...slice,
      color: slice.other ? chartColors.gray : categoricalColors[colorIndex++],
      onSelect: () => { setHistoryFilter('purchase'); showHistory(); },
    }));
  }, [activity, te]);
  // Everything put in, as what was spent, sent back to profit and is still held.
  const flowParts = [
    { key: 'spent', label: t('spent'), value: totals.spent, className: 'bg-danger-500' },
    { key: 'returned', label: t('returned'), value: totals.returned, className: 'bg-gray-400' },
    { key: 'held', label: t('stillHeld'), value: Math.max(0, totals.deposited - totals.spent - totals.returned), className: 'bg-primary-600' },
  ].filter((part) => part.value > 0);
  const flowWhole = flowParts.reduce((sum, part) => sum + part.value, 0);
  const filterOptions = useMemo(() => {
    const present = new Set(activity.map((row) => row.kind));
    return FILTER_KINDS.filter((kind) => present.has(kind));
  }, [activity]);
  const shownFilter: HistoryFilter = historyFilter === 'all' || filterOptions.includes(historyFilter) ? historyFilter : 'all';
  const shownActivity = useMemo(
    () => (shownFilter === 'all' ? activity : activity.filter((row) => row.kind === shownFilter)),
    [activity, shownFilter],
  );
  const methodLabel = (method: OwnerReserveMethod) => (
    method === 'playstation' ? tm('playstation') : method === 'usd' ? tm('dollars') : tc(`paymentMethods.${method}`)
  );
  const dollars = `${dollarsHeld < 0 ? '−' : ''}$${formatUnitCurrency(Math.abs(dollarsHeld))}`;

  async function handleDelete(row: DeletableReserveActivity) {
    if (!selectedClubId || busyId) return;
    const loadBeforeConfirm = currentLoad.current;
    const amount = `${formatCurrency(row.amount)} ${currency}`;
    const confirmed = await confirm({
      title: tc('delete'),
      description: row.kind === 'exchange'
        ? t('exchange.deleteConfirm', { sums: amount, dollars: `$${formatUnitCurrency(row.usd)}` })
        : row.kind === 'purchase'
          ? tr('deletePurchaseConfirm', { amount: row.method === 'usd' ? `$${formatUnitCurrency(row.amount)}` : amount })
          : tr(row.kind === 'deposit' ? 'deleteDepositConfirm' : 'deleteReturnConfirm', { amount }),
      confirmLabel: tc('delete'),
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current) return;
    setBusyId(row.id);
    try {
      const failure = row.kind === 'exchange'
        ? await requestReserveExchangeDelete(selectedClubId, row.id)
        : row.kind === 'purchase'
          ? await requestReservePurchaseDelete(selectedClubId, row.id)
          : await requestReserveDelete(selectedClubId, row.id);
      if (loadBeforeConfirm !== currentLoad.current) return;
      const done = row.kind === 'exchange' ? t('exchange.deletedToast') : tr('deletedToast');
      showToast(failure ? tr(`errors.${failure}`) : done, failure ? 'error' : 'success');
      await query.reload({ silent: true });
    } catch {
      showToast(tr('errors.failed'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <PageHeader
      title={t('title')}
      className="mb-0"
      tabs={sectionTabs}
      action={<ButtonLink href="/money-taken" variant="outline" size="sm">{t('manage')}</ButtonLink>}
    />
  );
  // The header tabs switch between Owner Profit and the reserve; this switches the reserve's own two views.
  const viewSwitch = (
    <SegmentedControl
      variant="soft"
      size="sm"
      className="max-w-xs"
      label={t('viewSwitcher')}
      options={[
        { value: 'overview', label: t('overview') },
        { value: 'history', label: t('history', { count: activity.length }) },
      ]}
      value={view}
      onChange={setView}
    />
  );

  if (query.error) {
    return (
      <div className="space-y-6">
        {header}
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadError')}</LoadErrorAlert>
      </div>
    );
  }

  if (!query.loading && !reserveSupported) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title={tr('errors.migration_required')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {viewSwitch}
      {view === 'overview' ? (
        query.loading ? (
          <SkeletonStatus><ReserveOverviewSkeleton /></SkeletonStatus>
        ) : (
          <>
            {/* The reserve is the owner's own money: one pot of sums and one of dollars, whatever side or method it came from. */}
            <Card as="section" aria-labelledby="reserve-total">
              <p id="reserve-total" className="text-xs font-medium text-gray-500">{t('totalHeld')}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-gray-600">{t('sumsPot')}</p>
                  <p className="mt-1 break-words text-3xl font-bold leading-none tracking-tight tabular-nums text-gray-950 sm:text-4xl">
                    {formatCurrency(sumsHeld)}
                    <span className="ml-1.5 text-base font-medium tracking-normal text-gray-500">{currency}</span>
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">{t('dollarsPot')}</p>
                  <p className="mt-1 break-words text-3xl font-bold leading-none tracking-tight tabular-nums text-gray-950 sm:text-4xl">
                    {dollars}
                  </p>
                  {dollarsHeld !== 0 ? (
                    <p className="mt-2 text-sm text-gray-500">
                      {t('dollarsBoughtFor', { amount: `${formatCurrency(dollarsSumsValue)} ${currency}` })}
                      {rates.averageRate !== null ? <span className="whitespace-nowrap"> · {t('averageRate', { rate: formatUnitCurrency(rates.averageRate) })}</span> : null}
                    </p>
                  ) : null}
                  {rates.lastRate !== null && rates.lastDate ? (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('lastRate', { rate: formatUnitCurrency(rates.lastRate), date: formatDateShort(rates.lastDate, locale) })}
                      {dollarsHeld > 0 ? (
                        <span className="whitespace-nowrap">
                          {' · '}{t('worthAtLastRate', { amount: `${formatCurrency(Math.round(dollarsHeld * rates.lastRate))} ${currency}` })}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>
              {/* Inside the reserve: sums become dollars or back, nothing leaves it (170). */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canBuy}
                  onClick={() => setExchangeDirection('buy')}
                  icon={<ArrowRightLeft size={15} aria-hidden="true" />}
                >
                  {t('buyDollars')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={dollarsHeld <= 0}
                  onClick={() => setExchangeDirection('sell')}
                  icon={<ArrowRightLeft size={15} aria-hidden="true" />}
                >
                  {t('sellDollars')}
                </Button>
                {totals.exchanged > 0 ? (
                  <button
                    type="button"
                    onClick={() => { setHistoryFilter('exchange'); showHistory(); }}
                    className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                  >
                    {t('exchangesCount', { count: totals.exchanged })}
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatTile variant="soft" onClick={showHistory} icon={ArrowDownToLine} label={t('putIn')} value={formatCurrency(totals.deposited)} unit={currency} tone="success" />
                <StatTile variant="soft" onClick={showHistory} icon={ArrowUpFromLine} label={t('returned')} value={formatCurrency(totals.returned)} unit={currency} />
                <StatTile variant="soft" onClick={showHistory} icon={ShoppingCart} label={t('spent')} value={formatCurrency(totals.spent)} unit={currency} />
              </div>
              {flowWhole > 0 ? (
                <div className="mt-4">
                  <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    {flowParts.map((part) => (
                      <span key={part.key} className={`h-full transition-[width] duration-700 first:rounded-l-full last:rounded-r-full ${part.className}`} style={{ width: `${(part.value / flowWhole) * 100}%` }} />
                    ))}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500" aria-label={t('flowSplitLabel')}>
                    {flowParts.map((part) => (
                      <li key={part.key} className="flex items-center gap-1.5">
                        <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${part.className}`} />
                        {part.label}
                        <span className="font-medium tabular-nums text-gray-700">{formatPercentShare(part.value / flowWhole, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard title={t('balanceTitle')} description={t('balanceDescription')}>
                {dailySeries.length === 0 ? <ChartEmpty title={tr('empty')} /> : <ReserveBalanceChart rows={dailySeries} locale={locale} currency={currency} />}
              </ChartCard>
              <ChartCard title={t('spendingTitle')} description={t('spendingDescription')}>
                {spendingSlices.length === 0 ? <ChartEmpty title={t('spendingEmpty')} /> : (
                  <div className="mt-4">
                    <DonutBreakdown slices={spendingSlices} total={totals.spent} totalLabel={t('spent')} currency={currency} locale={locale} />
                  </div>
                )}
              </ChartCard>
            </div>
            <ChartCard title={t('flowTitle')} description={t('flowDescription')}>
              {series.length === 0 ? <ChartEmpty title={tr('empty')} /> : <ReserveFlowChart rows={series} locale={locale} currency={currency} />}
            </ChartCard>
          </>
        )
      ) : query.loading ? (
        <TableSkeleton rows={6} columns={3} />
      ) : (
        <div className="max-w-4xl space-y-3">
          {filterOptions.length > 1 ? (
            <SegmentedControl
              variant="soft"
              size="sm"
              label={t('filter.label')}
              options={[
                { value: 'all' as HistoryFilter, label: t('filter.all') },
                ...filterOptions.map((kind) => ({ value: kind as HistoryFilter, label: t(`filter.${kind}`) })),
              ]}
              value={shownFilter}
              onChange={setHistoryFilter}
            />
          ) : null}
          <Card as="section" padding="none" className="overflow-hidden" aria-label={tr('activityLabel')}>
          {activity.length === 0 ? (
            <div className="p-4 sm:p-5"><EmptyState compact title={tr('empty')} description={tr('emptyHint')} /></div>
          ) : shownActivity.length === 0 ? (
            <div className="p-4 sm:p-5"><EmptyState compact title={t('filterEmpty')} /></div>
          ) : (
            <ReserveHistoryList
              activity={shownActivity}
              methodLabel={methodLabel}
              busyId={busyId}
              disabled={busyId !== null || query.loading}
              onDelete={(row) => void handleDelete(row)}
            />
          )}
          </Card>
        </div>
      )}
      {exchangeDirection ? (
        <ReserveExchangeModal
          initialDirection={exchangeDirection}
          buyLimits={buyLimits}
          dollarsHeld={dollarsHeld}
          lastRate={rates.lastRate}
          onClose={() => setExchangeDirection(null)}
          onSaved={async () => {
            setExchangeDirection(null);
            showToast(t('exchange.savedToast'), 'success');
            await query.reload({ silent: true });
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
