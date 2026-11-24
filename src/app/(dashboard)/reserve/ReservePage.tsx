'use client';

// Route: /reserve (owners only): the owner reserve (jamg'arma), its charts and its history.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Banknote, CalendarRange, DollarSign, ShoppingCart, Undo2, X } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useClub } from '@/components/layout/DashboardShell';
import { ChartCard, ChartEmpty, categoricalColors, chartColors } from '@/components/dashboard/ChartCard';
import { DonutSkeleton } from '@/components/charts/ChartSkeletons';
import { rankShares } from '@/lib/calculations/insights';
import { formatPercentShare } from '@/components/charts/chartFormat';
import {
  AmountCard,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  LoadErrorAlert,
  MetricCard,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  SkeletonStatus,
  StatTile,
  toneClasses,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { dollarsForMonth } from '@/lib/calculations/moneyExchanges';
import {
  reserveActivity,
  reserveBalances,
  reserveBuyLimits,
  reserveDollarRates,
  reserveFlowSplit,
  reserveFlowTotals,
  reserveSpendingByCategory,
  reserveSumsHeld,
  type ReserveActivity,
} from '@/lib/calculations/ownerReserve';
import {
  RESERVE_PERIODS,
  filterReserveHistory,
  reserveActivityInPeriod,
  reserveExplorerSeries,
  reservePeriodStart,
  type ReserveExplorerSeries,
  type ReserveHistoryFilter,
  type ReservePeriod,
} from '@/lib/calculations/reserveExplorer';
import { formatCurrency, formatDateRange, formatDateShort, formatUnitCurrency, formatDollars } from '@/lib/formatters';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_OWNER_RESERVE, fetchOwnerReserve } from '@/lib/supabase/ownerMoney';
import { requestReserveDelete, requestReserveExchangeDelete, requestReservePurchaseDelete } from '@/lib/ownerReserveRequests';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import type { OwnerReserveMethod } from '@/types';
import { ReserveExchangeModal } from './ReserveExchangeModal';
import { ReserveHistoryList, type DeletableReserveActivity } from './ReserveHistoryList';
import { ReserveExplorerSkeleton, ReserveHistorySkeleton, ReserveOverviewSkeleton } from './ReserveSkeleton';
import { ReserveReturnModal } from './ReserveReturnModal';
import { ExpenseModal } from '@/components/expenses/ExpenseModal';
import { scrollBehavior } from '@/lib/scroll';

const ReserveExplorer = dynamic(() => import('./ReserveExplorer').then((module) => module.ReserveExplorer), {
  ssr: false,
  // The wrapper it renders into already carries the card's top margin.
  loading: () => <ReserveExplorerSkeleton />,
});
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <DonutSkeleton stacked />,
});

type ReserveView = 'overview' | 'history';
type HistoryFilter = ReserveHistoryFilter['kind'];
const FILTER_KINDS: readonly ReserveActivity['kind'][] = ['deposit', 'return', 'purchase', 'exchange'];
const ALL_HISTORY: ReserveHistoryFilter = { kind: 'all' };

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
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ReserveView>(() => (searchParams.get('view') === 'history' ? 'history' : 'overview'));
  const showHistory = () => {
    setView('history');
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exchangeDirection, setExchangeDirection] = useState<'buy' | 'sell' | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reservePayOpen, setReservePayOpen] = useState(false);
  // A filter belongs to the club it was set on: another club's history starts unfiltered.
  const [filterState, setFilterState] = useState<{ clubId: string; filter: ReserveHistoryFilter }>({ clubId: selectedClubId, filter: ALL_HISTORY });
  const historyFilter = filterState.clubId === selectedClubId ? filterState.filter : ALL_HISTORY;
  const setHistoryFilter = (update: ReserveHistoryFilter | ((current: ReserveHistoryFilter) => ReserveHistoryFilter)) => (
    setFilterState((state) => {
      const current = state.clubId === selectedClubId ? state.filter : ALL_HISTORY;
      return { clubId: selectedClubId, filter: typeof update === 'function' ? update(current) : update };
    })
  );
  const openHistory = (filter: ReserveHistoryFilter) => {
    setHistoryFilter(filter);
    showHistory();
  };
  const [period, setPeriod] = useState<ReservePeriod>('90d');

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
  // The over-time charts follow the period; the totals above them stay all-time.
  const explorerSeries = useMemo(() => reserveExplorerSeries(activity, businessToday, period), [activity, businessToday, period]);
  const periodActivity = useMemo(() => reserveActivityInPeriod(activity, period, businessToday), [activity, period, businessToday]);
  const periodStart = reservePeriodStart(period, businessToday);
  // A selection belongs to the series it was made on: another period, club or reload clears it.
  const [selection, setSelection] = useState<{ key: string; series: ReserveExplorerSeries } | null>(null);
  const selectedKey = selection && selection.series === explorerSeries ? selection.key : null;
  const selectBucket = useCallback(
    (key: string | null) => setSelection(key === null ? null : { key, series: explorerSeries }),
    [explorerSeries],
  );
  const dollarsHeld = useMemo(() => dollarsForMonth(exchangeRows, currentMonth, dollarExpenses).heldUsd, [exchangeRows, currentMonth, dollarExpenses]);

  const currency = tc('currency');
  // Two pots (155): the sums, whatever side or method they were saved from, and the dollars.
  const sumsHeld = reserveSumsHeld(balances);
  // As the history shows it: exchanges inside the reserve (170) move nothing in or out.
  const totals = useMemo(() => reserveFlowTotals(activity), [activity]);
  const dollarsSumsValue = balances.game_club.byMethod.usd;
  const buyLimits = useMemo(() => reserveBuyLimits(reserveEntries, sumsHeld), [reserveEntries, sumsHeld]);
  const rates = useMemo(() => reserveDollarRates(exchangeRows, dollarsHeld, dollarsSumsValue), [exchangeRows, dollarsHeld, dollarsSumsValue]);
  const canBuy = buyLimits.cash > 0 || buyLimits.terminal > 0 || buyLimits.card > 0;
  const te = useTranslations('expenses');
  const categoryLabel = useCallback((category: string) => {
    const key = `categories.${category}`;
    return te.has(key) ? te(key as Parameters<typeof te>[0]) : category.replace(/_/g, ' ');
  }, [te]);
  const periodSpent = useMemo(() => reserveFlowTotals(periodActivity).spent, [periodActivity]);
  // What the reserve paid for in the period, largest category first; the tail folds into "other".
  // A category opens its purchases in the period; the folded tail opens all of them.
  const spendingSlices = useMemo(() => {
    let colorIndex = 0;
    return rankShares(
      reserveSpendingByCategory(periodActivity).map(({ category, amount }) => ({ key: category, label: categoryLabel(category), value: amount })),
      categoricalColors.length,
      { key: 'other', label: te('categories.other') },
    ).map((slice) => ({
      ...slice,
      color: slice.other ? chartColors.gray : categoricalColors[colorIndex++],
      category: slice.other ? undefined : slice.key,
    }));
  }, [periodActivity, categoryLabel, te]);
  // Everything put in, as what was spent, sent back to profit and is still held.
  const flowSplit = reserveFlowSplit(totals);
  const flowParts = [
    { key: 'spent', label: t('spent'), value: flowSplit.spent, className: toneClasses.danger.solid },
    { key: 'returned', label: t('returned'), value: flowSplit.returned, className: toneClasses.neutral.solid },
    { key: 'held', label: t('stillHeld'), value: flowSplit.held, className: toneClasses.reserve.solid },
  ].filter((part) => part.value > 0);
  const flowWhole = flowParts.reduce((sum, part) => sum + part.value, 0);
  const filterOptions = useMemo(() => {
    const present = new Set(activity.map((row) => row.kind));
    return FILTER_KINDS.filter((kind) => present.has(kind));
  }, [activity]);
  const shownFilter: HistoryFilter = historyFilter.kind === 'all' || filterOptions.includes(historyFilter.kind) ? historyFilter.kind : 'all';
  const shownActivity = useMemo(
    () => filterReserveHistory(activity, { ...historyFilter, kind: shownFilter }, businessToday),
    [activity, historyFilter, shownFilter, businessToday],
  );
  const hasDates = Boolean(historyFilter.from && historyFilter.to);
  const narrowed = hasDates || historyFilter.category !== undefined;
  // The chip over the history: "3 – 9 November · Rent"; the year only when it is not this one.
  const narrowedLabel = [
    historyFilter.from && historyFilter.to
      ? formatDateRange(historyFilter.from, historyFilter.to, locale, { year: historyFilter.to.slice(0, 4) !== businessToday.slice(0, 4) })
      : null,
    historyFilter.category !== undefined ? categoryLabel(historyFilter.category) : null,
  ].filter(Boolean).join(' · ');
  // A category is a kind of purchase: another kind drops it.
  const changeKind = (kind: HistoryFilter) => setHistoryFilter((current) => ({
    ...current,
    kind,
    category: kind === 'all' || kind === 'purchase' ? current.category : undefined,
  }));
  const methodLabel = (method: OwnerReserveMethod) => (
    method === 'playstation' ? tm('playstation') : method === 'usd' ? tm('dollars') : tc(`paymentMethods.${method}`)
  );
  const dollars = formatDollars(dollarsHeld);

  async function handleDelete(row: DeletableReserveActivity) {
    if (!selectedClubId || busyId) return;
    const loadBeforeConfirm = currentLoad.current;
    const amount = `${formatCurrency(row.amount)} ${currency}`;
    const confirmed = await confirm({
      title: tc('delete'),
      description: row.kind === 'exchange'
        ? t('exchange.deleteConfirm', { sums: amount, dollars: formatDollars(row.usd) })
        : row.kind === 'purchase'
          ? tr('deletePurchaseConfirm', { amount: row.method === 'usd' ? formatDollars(row.amount) : amount })
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

  const actionsDisabled = query.loading || !!query.error || !reserveSupported || busyId !== null;
  const header = (
    <PageHeader
      title={t('title')}
      className="mb-0"
      tabs={sectionTabs}
      action={(
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={actionsDisabled || (balances.game_club.held - balances.game_club.byMethod.usd <= 0 && balances.bar.held <= 0)}
            onClick={() => setReservePayOpen(true)}
            icon={<ShoppingCart size={16} aria-hidden="true" />}
          >
            {tr('payButton')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={actionsDisabled || (balances.game_club.held <= 0 && balances.bar.held <= 0)}
            onClick={() => setReturnOpen(true)}
            icon={<Undo2 size={16} aria-hidden="true" />}
          >
            {tr('returnButton')}
          </Button>
        </>
      )}
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
            <section aria-labelledby="reserve-total" className="space-y-3">
              <p id="reserve-total" className="text-xs font-medium text-gray-500">{t('totalHeld')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <AmountCard
                  onClick={() => openHistory({ kind: 'all' })}
                  label={t('sumsPot')}
                  amount={sumsHeld}
                  icon={Banknote}
                  accent="reserve"
                />
                <MetricCard
                  onClick={() => openHistory({ kind: totals.exchanged > 0 ? 'exchange' : 'all' })}
                  label={t('dollarsPot')}
                  value={dollars}
                  icon={DollarSign}
                  accent="reserve"
                  helper={dollarsHeld !== 0 || (rates.lastRate !== null && rates.lastDate) ? (
                    <>
                      {dollarsHeld !== 0 ? (
                        <span className="block">
                          {t('dollarsBoughtFor', { amount: `${formatCurrency(dollarsSumsValue)} ${currency}` })}
                          {rates.averageRate !== null ? <span className="whitespace-nowrap"> · {t('averageRate', { rate: formatUnitCurrency(rates.averageRate) })}</span> : null}
                        </span>
                      ) : null}
                      {rates.lastRate !== null && rates.lastDate ? (
                        <span className="block">
                          {t('lastRate', { rate: formatUnitCurrency(rates.lastRate), date: formatDateShort(rates.lastDate, locale) })}
                          {dollarsHeld > 0 ? (
                            <span className="whitespace-nowrap">
                              {' · '}{t('worthAtLastRate', { amount: `${formatCurrency(Math.round(dollarsHeld * rates.lastRate))} ${currency}` })}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </>
                  ) : undefined}
                />
              </div>
            <Card>
              {/* Inside the reserve: sums become dollars or back, nothing leaves it (170). */}
              <div className="flex flex-wrap items-center gap-2">
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
                  <Button variant="ghost" size="sm" onClick={() => openHistory({ kind: 'exchange' })}>
                    {t('exchangesCount', { count: totals.exchanged })}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatTile variant="soft" onClick={() => openHistory({ kind: 'deposit' })} icon={ArrowDownToLine} label={t('putIn')} value={formatCurrency(totals.deposited)} unit={currency} tone="success" />
                <StatTile variant="soft" onClick={() => openHistory({ kind: 'return' })} icon={ArrowUpFromLine} label={t('returned')} value={formatCurrency(totals.returned)} unit={currency} />
                <StatTile variant="soft" onClick={() => openHistory({ kind: 'purchase' })} icon={ShoppingCart} label={t('spent')} value={formatCurrency(totals.spent)} unit={currency} />
              </div>
              {flowWhole > 0 ? (
                <div className="mt-4">
                  <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    {flowParts.map((part) => (
                      <span key={part.key} className={`grow-x h-full transition-[width] duration-300 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none ${part.className}`} style={{ width: `${(part.value / flowWhole) * 100}%` }} />
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
            </section>

            {/* One period for every chart below; the figures above stay all-time. */}
            <section aria-labelledby="reserve-over-time" className="space-y-3">
              <SectionHeading
                as="h2"
                size="sm"
                title={<span id="reserve-over-time">{t('overTime')}</span>}
                className="sm:items-center"
                action={(
                  <SegmentedControl
                    variant="soft"
                    size="sm"
                    label={t('period.label')}
                    options={RESERVE_PERIODS.map((value) => ({ value, label: t(`period.${value}`) }))}
                    value={period}
                    onChange={setPeriod}
                  />
                )}
              />
              <div className="grid gap-4 xl:grid-cols-3">
                <ChartCard className="xl:col-span-2" title={t('balanceTitle')} description={t('balanceDescription')}>
                  {explorerSeries.buckets.length === 0 ? <ChartEmpty className="mt-4" title={tr('empty')} /> : (
                    <div className="mt-4">
                      <ReserveExplorer
                        series={explorerSeries}
                        period={period}
                        selectedKey={selectedKey}
                        onSelect={selectBucket}
                        onOpenEntries={(range) => openHistory({ kind: 'all', ...range })}
                        currency={currency}
                        locale={locale}
                      />
                    </div>
                  )}
                </ChartCard>
                <ChartCard title={t('spendingTitle')} description={t('spendingDescription')}>
                  {spendingSlices.length === 0 ? <ChartEmpty className="mt-4" title={totals.spent > 0 ? t('spendingEmptyPeriod') : t('spendingEmpty')} /> : (
                    <div className="mt-4">
                      <DonutBreakdown
                        rowFrom="never"
                        slices={spendingSlices.map(({ category, ...slice }) => ({
                          ...slice,
                          onSelect: () => openHistory({
                            kind: 'purchase',
                            ...(periodStart ? { from: periodStart, to: businessToday } : {}),
                            ...(category === undefined ? {} : { category }),
                          }),
                        }))}
                        total={periodSpent}
                        totalLabel={t('spent')}
                        currency={currency}
                        locale={locale}
                      />
                    </div>
                  )}
                </ChartCard>
              </div>
            </section>
          </>
        )
      ) : query.loading ? (
        <SkeletonStatus><ReserveHistorySkeleton /></SkeletonStatus>
      ) : (
        <div className="max-w-4xl space-y-3">
          {filterOptions.length > 1 || narrowed ? (
            <div className="flex flex-wrap items-center gap-2">
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
                  onChange={changeKind}
                />
              ) : null}
              {narrowed ? (
                <span className="inline-flex min-w-0 max-w-full items-center">
                  {/* Wraps on a phone rather than pushing the clear button off the screen. */}
                  <Badge variant="primary" size="lg" className="min-w-0 whitespace-normal" icon={<CalendarRange size={14} aria-hidden="true" className="shrink-0" />}>{narrowedLabel}</Badge>
                  <IconButton
                    variant="ghost"
                    size="lg"
                    label={t('historyRange.clear')}
                    icon={<X size={16} aria-hidden="true" />}
                    onClick={() => setHistoryFilter((current) => ({ kind: current.kind }))}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
          <Card as="section" padding="none" className="overflow-hidden" aria-label={tr('activityLabel')}>
          {activity.length === 0 ? (
            <div className="p-4 sm:p-5"><EmptyState compact title={tr('empty')} description={tr('emptyHint')} /></div>
          ) : shownActivity.length === 0 ? (
            <div className="p-4 sm:p-5"><EmptyState compact title={hasDates ? t('filterEmptyRange') : t('filterEmpty')} /></div>
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
      {returnOpen ? (
        <ReserveReturnModal
          balances={balances}
          currentMonth={currentMonth}
          methodLabel={methodLabel}
          currentLoad={currentLoad}
          onClose={() => setReturnOpen(false)}
          onSaved={async () => {
            setReturnOpen(false);
            showToast(tr('returnedToast'), 'success');
            await query.reload({ silent: true });
          }}
        />
      ) : null}
      <ExpenseModal
        open={reservePayOpen}
        onClose={() => setReservePayOpen(false)}
        title={tr('payTitle')}
        description={tr('payDescription')}
        defaultFromReserve
        onSaved={async () => {
          setReservePayOpen(false);
          showToast(tr('paidToast'), 'success');
          await query.reload({ silent: true });
        }}
      />
      {confirmDialog}
      {toastElement}
    </div>
  );
}
