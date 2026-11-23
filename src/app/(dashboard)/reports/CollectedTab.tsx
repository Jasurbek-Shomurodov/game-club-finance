'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, CircleCheck, HandCoins, PiggyBank, ReceiptText, Trash2, UserRound, WalletCards } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Badge,
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
  SearchInput,
  SectionHeading,
  SegmentedControl,
  Select,
  TableSkeleton,
  TappableSurface,
  type BadgeVariant,
  type DataTableColumn,
  metricGridClassName,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { ShareBar } from '@/components/charts/ShareBar';
import { chartColors } from '@/components/dashboard/ChartCard';
import {
  COLLECTED_METHODS,
  buildCollectedLedger,
  sumCollectedRows,
  summarizeByCollector,
  type ByCollectedMethod,
  type CollectedLedgerEntry,
  type CollectedMethod,
  type CollectedMoneySummary,
  type CollectedMoneyMove,
  type CollectionGroup,
} from '@/lib/calculations/collectedMoney';
import { ExportButton, type ExportFile, type ExportSheet } from '@/components/ExportButton';
import { sheetFileName } from '@/lib/sheetExport';
import { formatCurrency, formatCurrencyInput, formatDateOnly, formatDateTime, parseCurrencyInput } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CollectedGlance, CollectedGlanceSkeleton, CollectedSplitSkeleton } from './CollectedGlance';
import { scrollBehavior } from '@/lib/scroll';

type CollectedView = 'collections' | 'ledger';
type LedgerKindFilter = 'all' | CollectedMoneyMove['kind'];

const KIND_BADGE: Record<CollectedMoneyMove['kind'], BadgeVariant> = { collect: 'success', expense: 'danger', reserve: 'purple' };

/**
 * Reports' Collected tab (migration 169): money collectors took out of the
 * admin's kassa, what it paid for, what went into the reserve, and what the
 * collector still holds. Two views: the collections themselves (filterable by
 * collector) and a ledger of every move with the running balance.
 */
export default function CollectedTab({
  summary,
  moves,
  collectorNames,
  enabledPaymentMethods,
  loading,
  isOwner,
  businessToday,
  onUndo,
  onMoveToReserve,
}: {
  summary: CollectedMoneySummary;
  /** The moves `summary` was built from, for the ledger view. */
  moves: readonly CollectedMoneyMove[];
  /** Names of everyone who saved a move (collectors, and who paid or moved collected money). */
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
  const tm = useTranslations('reports.collectMoney');
  const tv = useTranslations('reports.collectedView');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const [moveOpen, setMoveOpen] = useState(false);
  const [view, setView] = useState<CollectedView>('collections');
  const [kindFilter, setKindFilter] = useState<LedgerKindFilter>('all');
  /** A collector's user id, '' for an unknown one, or null for everyone. */
  const [collectorFilter, setCollectorFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // A method the club turned off still shows while it carries collected money.
  const methods = COLLECTED_METHODS.filter((method) => (method !== 'playstation' && enabledPaymentMethods.includes(method))
    || summary.collected[method] !== 0 || summary.held[method] !== 0);

  const ledger = useMemo(() => buildCollectedLedger(moves), [moves]);
  const collectors = useMemo(() => summarizeByCollector(summary.collections), [summary.collections]);

  const methodLabel = useCallback(
    (method: CollectedMethod): string => (method === 'playstation' ? t('playstation') : tc(`paymentMethods.${method}`)),
    [t, tc],
  );

  function personName(id: string | null): string {
    return (id && collectorNames.get(id)) || t('unknownCreator');
  }

  function kindLabel(kind: CollectedMoneyMove['kind']): string {
    return tv(`kind.${kind}`);
  }

  const query = search.trim().toLocaleLowerCase(locale);
  function matchesSearch(row: { createdBy: string | null; comment: string | null }, extra = ''): boolean {
    if (!query) return true;
    return `${personName(row.createdBy)} ${row.comment ?? ''} ${extra}`.toLocaleLowerCase(locale).includes(query);
  }

  const shownCollections = summary.collections.filter((row) => (
    (collectorFilter === null || (row.createdBy ?? '') === collectorFilter) && matchesSearch(row)
  ));
  const shownLedger = ledger.filter((row) => (
    (kindFilter === 'all' || row.kind === kindFilter)
    && (collectorFilter === null || (row.createdBy ?? '') === collectorFilter)
    && matchesSearch(row, kindLabel(row.kind))
  ));
  const filtered = collectorFilter !== null || query !== '' || (view === 'ledger' && kindFilter !== 'all');
  const kindCounts = ledger.reduce<Record<LedgerKindFilter, number>>((counts, row) => ({
    ...counts, [row.kind]: counts[row.kind] + 1, all: counts.all + 1,
  }), { all: 0, collect: 0, expense: 0, reserve: 0 });

  const average = summary.collections.length > 0 ? Math.round(summary.collected.total / summary.collections.length) : 0;
  const lastCollection = summary.collections[0];

  function amountCell(amount: number, strong = false, signed = false) {
    return (
      <span className={cn(
        'tabular-nums',
        strong ? 'font-semibold' : 'text-gray-700',
        amount < 0 && 'text-danger-600',
        signed && amount > 0 && 'text-success-700',
        amount === 0 && !strong && 'text-gray-500',
      )}>
        {signed && amount > 0 ? '+' : ''}
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

  function personCell(row: { createdBy: string | null; createdAt: string; comment: string | null }) {
    return (
      <span className="block">
        <span className="block text-gray-900">{personName(row.createdBy)}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{row.createdAt ? formatDateTime(row.createdAt, locale) : ''}</span>
        {row.comment && <span className="mt-0.5 block text-xs text-gray-600">{row.comment}</span>}
      </span>
    );
  }

  function undoButton(group: CollectionGroup) {
    return (
      <IconButton
        size="sm"
        variant="ghost"
        label={`${tm('undo')}: ${formatDateOnly(group.date, locale)}`}
        icon={<Trash2 size={16} aria-hidden="true" />}
        onClick={(event) => {
          event.stopPropagation();
          onUndo(group);
        }}
      />
    );
  }

  const methodColumns = <R extends ByCollectedMethod>(signed: boolean) => methods.map((method): DataTableColumn<R> => ({
    key: method,
    header: methodLabel(method),
    align: 'right',
    className: 'w-32 whitespace-nowrap',
    render: (row) => amountCell(row[method], false, signed),
  }));

  const collectionColumns: DataTableColumn<CollectionGroup>[] = [
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
    { key: 'collector', header: t('collectedByColumn'), className: 'min-w-52', render: personCell },
    ...methodColumns<CollectionGroup>(false),
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
      render: (row: CollectionGroup) => undoButton(row),
    }] : []),
  ];

  const collectionsById = useMemo(() => new Map(summary.collections.map((group) => [group.id, group])), [summary.collections]);
  const ledgerColumns: DataTableColumn<CollectedLedgerEntry>[] = [
    {
      key: 'date',
      header: t('date'),
      className: 'w-40 whitespace-nowrap',
      render: (row) => (
        <span className="flex items-center gap-2 font-semibold text-gray-900">
          {row.kind === 'collect'
            ? <ArrowDownLeft size={16} className="shrink-0 text-success-600" aria-hidden="true" />
            : <ArrowUpRight size={16} className="shrink-0 text-danger-600" aria-hidden="true" />}
          {formatDateOnly(row.date, locale)}
        </span>
      ),
    },
    {
      key: 'kind',
      header: tv('typeColumn'),
      className: 'w-36 whitespace-nowrap',
      render: (row) => <Badge size="sm" variant={KIND_BADGE[row.kind]}>{kindLabel(row.kind)}</Badge>,
    },
    { key: 'person', header: tv('byColumn'), className: 'min-w-52', render: personCell },
    ...methodColumns<CollectedLedgerEntry>(true),
    {
      key: 'total',
      header: tv('changeColumn'),
      align: 'right',
      className: 'w-36 whitespace-nowrap',
      render: (row) => amountCell(row.total, true, true),
    },
    {
      key: 'heldAfter',
      header: tv('heldAfterColumn'),
      align: 'right',
      className: 'w-36 whitespace-nowrap',
      render: (row) => amountCell(row.heldAfter),
    },
    ...(isOwner ? [{
      key: 'actions',
      header: <span className="sr-only">{tc('actions')}</span>,
      align: 'right' as const,
      className: 'w-14',
      render: (row: CollectedLedgerEntry) => {
        const group = row.kind === 'collect' ? collectionsById.get(row.id) : undefined;
        return group ? undoButton(group) : null;
      },
    }] : []),
  ];

  const collectionTotals = sumCollectedRows(shownCollections);
  const collectionFooter: Partial<Record<string, ReactNode>> = {
    date: <span className="font-semibold text-gray-900">{filtered ? tv('shownTotal', { count: shownCollections.length }) : t('collectedFooterTotal')}</span>,
    total: amountCell(collectionTotals.total, true),
  };
  for (const method of methods) collectionFooter[method] = amountCell(collectionTotals[method], true);

  const ledgerTotals = sumCollectedRows(shownLedger);
  const ledgerFooter: Partial<Record<string, ReactNode>> = {
    date: <span className="font-semibold text-gray-900">{filtered ? tv('shownTotal', { count: shownLedger.length }) : tv('netChange')}</span>,
    total: amountCell(ledgerTotals.total, true, true),
    heldAfter: filtered ? undefined : amountCell(summary.held.total, true),
  };
  for (const method of methods) ledgerFooter[method] = amountCell(ledgerTotals[method], true, true);

  /** Both lists as filtered on screen, one sheet each, the open view first. */
  function exportLists(): ExportFile {
    const currency = tc('currency');
    const period = (rows: Array<{ date: string }>) => {
      const from = rows.at(-1)?.date;
      const to = rows[0]?.date;
      if (!from || !to) return currency;
      return `${from === to ? formatDateOnly(from, locale) : `${formatDateOnly(from, locale)} – ${formatDateOnly(to, locale)}`} · ${currency}`;
    };
    const collections: ExportSheet = {
      name: t('collectedTitle'),
      period: period(shownCollections),
      columns: [
        { header: t('date'), type: 'date' },
        { header: t('collectedByColumn') },
        { header: tv('savedAtColumn') },
        ...methods.map((method) => ({ header: methodLabel(method), type: 'money', total: true } as const)),
        { header: t('collectedTotal'), type: 'money', total: true },
        { header: tm('comment'), type: 'longText' },
      ],
      rows: shownCollections.map((row) => [
        row.date, personName(row.createdBy), row.createdAt ? formatDateTime(row.createdAt, locale) : '',
        ...methods.map((method) => row[method]), row.total, row.comment ?? '',
      ]),
    };
    const kindTone = { collect: 'success', expense: 'danger', reserve: 'warning' } as const;
    const ledger: ExportSheet = {
      name: tv('ledgerTitle'),
      period: period(shownLedger),
      totalLabel: tv('netChange'),
      columns: [
        { header: t('date'), type: 'date' },
        { header: tv('typeColumn') },
        { header: tv('byColumn') },
        { header: tv('savedAtColumn') },
        ...methods.map((method) => ({ header: methodLabel(method), type: 'money', total: true, signed: true } as const)),
        { header: tv('changeColumn'), type: 'money', total: true, signed: true },
        { header: tv('heldAfterColumn'), type: 'money' },
        { header: tm('comment'), type: 'longText' },
      ],
      rows: shownLedger.map((row) => [
        row.date, { value: kindLabel(row.kind), tone: kindTone[row.kind] }, personName(row.createdBy), row.createdAt ? formatDateTime(row.createdAt, locale) : '',
        ...methods.map((method) => row[method]), row.total, row.heldAfter, row.comment ?? '',
      ]),
    };
    const sheets = (view === 'collections' ? [collections, ledger] : [ledger, collections]).filter((sheet) => sheet.rows.length > 0);
    const dates = [...shownCollections, ...shownLedger].map((row) => row.date).sort();
    return { fileName: sheetFileName('collected', dates[0] ?? businessToday, dates.at(-1)), sheets };
  }

  const shownCount = view === 'collections' ? shownCollections.length : shownLedger.length;
  const kindSelected = (kind: LedgerKindFilter) => view === 'ledger' && kindFilter === kind && kind !== 'all';
  /** A summary card opens the list behind its figure: the collections, or the running ledger narrowed to one kind (a second tap shows every kind). */
  const showList = (next: CollectedView, kind: LedgerKindFilter) => {
    setView(next);
    setKindFilter(kindSelected(kind) ? 'all' : kind);
    document.getElementById('collected-list')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  };
  const valueClass = 'text-sm font-medium tracking-normal text-gray-500';

  return (
    <>
      <section className={cn(metricGridClassName, 'sm:grid-cols-2 xl:grid-cols-4')}>
        <MetricCard
          loading={loading}
          label={t('collectedTakenTotal')}
          value={<Money amount={summary.collected.total} currencyClassName={valueClass} />}
          helper={byMethodHelper(summary.collected)}
          tone="success"
          icon={WalletCards}
          onClick={summary.collected.total !== 0 ? () => showList('collections', 'all') : undefined}
        />
        <MetricCard
          loading={loading}
          label={tm('paidFromCollected')}
          value={<Money amount={summary.spent.total} currencyClassName={valueClass} />}
          helper={byMethodHelper(summary.spent)}
          icon={ReceiptText}
          onClick={kindCounts.expense > 0 ? () => showList('ledger', 'expense') : undefined}
          selected={kindSelected('expense')}
        />
        <MetricCard
          loading={loading}
          label={tm('movedToReserve')}
          value={<Money amount={summary.toReserve.total} currencyClassName={valueClass} />}
          helper={byMethodHelper(summary.toReserve)}
          icon={PiggyBank}
          accent="reserve"
          onClick={kindCounts.reserve > 0 ? () => showList('ledger', 'reserve') : undefined}
          selected={kindSelected('reserve')}
        />
        <MetricCard
          loading={loading}
          label={tv('stillHeld')}
          value={<Money amount={summary.held.total} currencyClassName={valueClass} />}
          helper={byMethodHelper(summary.held) ?? tv('stillHeldHelper')}
          tone={summary.held.total > 0 ? 'warning' : 'default'}
          icon={HandCoins}
          onClick={ledger.length > 0 ? () => showList('ledger', 'all') : undefined}
        />
      </section>

      {/* Everything taken, as paid out, moved to the reserve and still with the collector. */}
      {!loading && summary.collected.total > 0 && (
        <Card padding="sm">
          <ShareBar
            label={t('collectedTakenTotal')}
            locale={locale}
            parts={[
              { key: 'spent', label: tm('paidFromCollected'), value: summary.spent.total, color: chartColors.danger },
              { key: 'reserve', label: tm('movedToReserve'), value: summary.toReserve.total, color: chartColors.purple },
              { key: 'held', label: tv('stillHeld'), value: summary.held.total, color: chartColors.warning },
            ]}
          />
        </Card>
      )}

      {loading && (
        <>
          <CollectedSplitSkeleton />
          <CollectedGlanceSkeleton />
        </>
      )}
      {!loading && <CollectedGlance moves={moves} summary={summary} methods={methods} methodLabel={methodLabel} />}

      {!loading && summary.collections.length > 0 && (
        <Card as="section" padding="none" className="overflow-hidden">
          <CardHeader>
            <SectionHeading
              title={tv('collectorsTitle')}
              description={tv('collectorsDescription', {
                count: summary.collections.length,
                average: `${formatCurrency(average)} ${tc('currency')}`,
                last: lastCollection ? formatDateOnly(lastCollection.date, locale) : '—',
              })}
            />
          </CardHeader>
          <ul className="grid border-t border-gray-100 sm:grid-cols-2 xl:grid-cols-3">
            {collectors.map((row) => {
              const key = row.collectorId ?? '';
              const selected = collectorFilter === key;
              const share = summary.collected.total > 0 ? Math.round((row.total / summary.collected.total) * 100) : 0;
              return (
                <li key={key || 'unknown'} className="border-b border-gray-100 sm:border-r">
                  <TappableSurface
                    chevron={false}
                    selected={selected}
                    onClick={() => setCollectorFilter(selected ? null : key)}
                    className={cn('h-full px-4 py-3', selected && 'bg-primary-50')}
                  >
                    <span className="flex items-start gap-3">
                    <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500', selected && 'bg-primary-100 text-primary-700')}>
                      <UserRound size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-gray-900">{personName(row.collectorId)}</span>
                        <Money amount={row.total} currency={null} className="shrink-0 font-semibold tabular-nums text-gray-900" />
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {tv('collectorStats', { count: row.count, share, last: formatDateOnly(row.lastDate, locale) })}
                      </span>
                      <ShareBar
                        className="mt-1.5"
                        size="sm"
                        legend={false}
                        label={personName(row.collectorId)}
                        locale={locale}
                        parts={[
                          { key: 'own', label: personName(row.collectorId), value: row.total, color: chartColors.success },
                          { key: 'others', label: t('collectedTakenTotal'), value: summary.collected.total - row.total, color: chartColors.grid },
                        ]}
                      />
                    </span>
                    </span>
                  </TappableSurface>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card as="section" padding="none" id="collected-list" className="scroll-mt-20 overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              title={view === 'collections' ? t('collectedTitle') : tv('ledgerTitle')}
              description={view === 'collections' ? t('collectedDescription') : tv('ledgerDescription')}
            />
            <div className="flex flex-wrap gap-2">
              <ExportButton build={exportLists} disabled={loading || shownCount === 0} />
              {isOwner && (
                <Button
                  variant="secondary"
                  icon={<PiggyBank size={16} aria-hidden="true" />}
                  disabled={summary.held.total <= 0}
                  onClick={() => setMoveOpen(true)}
                >
                  {tm('toReserveButton')}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SegmentedControl
              variant="soft"
              size="sm"
              label={tv('viewLabel')}
              value={view}
              onChange={setView}
              className="w-full sm:w-auto"
              options={[
                { value: 'collections', label: tv('collections', { count: summary.collections.length }) },
                { value: 'ledger', label: tv('ledger', { count: ledger.length }) },
              ]}
            />
            <SearchInput
              controlSize="sm"
              className="w-full sm:max-w-xs"
              value={search}
              onChange={setSearch}
              placeholder={tv('searchPlaceholder')}
            />
            {collectorFilter !== null && (
              <Button size="sm" variant="ghost" onClick={() => setCollectorFilter(null)}>
                {tv('clearCollector', { name: personName(collectorFilter || null) })}
              </Button>
            )}
          </div>
          {view === 'ledger' && (
            <SegmentedControl
              variant="chips"
              size="sm"
              className="mt-3"
              label={tv('kindFilter')}
              value={kindFilter}
              onChange={setKindFilter}
              options={(['all', 'collect', 'expense', 'reserve'] as const).map((kind) => ({
                value: kind,
                label: `${kind === 'all' ? tc('all') : kindLabel(kind)} (${kindCounts[kind]})`,
              }))}
            />
          )}
        </CardHeader>
        {loading ? (
          <TableSkeleton bare rows={6} columns={methods.length + 3} />
        ) : view === 'collections' ? (
          <DataTable
            key="collections"
            mobileCards
            bare
            label={t('collectedTitle')}
            minWidth={720}
            columns={collectionColumns}
            data={shownCollections}
            keyExtractor={(row) => row.id}
            footer={shownCollections.length > 0 ? collectionFooter : undefined}
            emptyState={<EmptyState compact title={filtered ? tv('noMatches') : t('collectedEmpty')} />}
          />
        ) : (
          <DataTable
            key="ledger"
            mobileCards
            bare
            label={tv('ledgerTitle')}
            minWidth={880}
            columns={ledgerColumns}
            data={shownLedger}
            keyExtractor={(row) => `${row.kind}:${row.id}`}
            footer={shownLedger.length > 0 ? ledgerFooter : undefined}
            emptyState={<EmptyState compact title={filtered ? tv('noMatches') : t('collectedEmpty')} />}
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
    <Modal
      open
      onClose={onClose}
      locked={saving}
      title={tm('toReserveTitle')}
      description={tm('toReserveDescription')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{tc('cancel')}</Button>
          <Button type="submit" form="to-reserve-form" loading={saving} loadingLabel={tc('saving')} disabled={limit <= 0} icon={<PiggyBank size={18} aria-hidden="true" />}>
            {tm('toReserveSubmit')}
          </Button>
        </>
      )}
    >
      <form id="to-reserve-form" onSubmit={submit} className="space-y-5">
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
      </form>
    </Modal>
  );
}
