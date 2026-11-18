'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  DataTable,
  LoadErrorAlert,
  SegmentedControl,
  Skeleton,
  StatTile,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency, formatDateOnly, formatNumber, formatYearMonth } from '@/lib/formatters';
import type { PurchaseSpendingGroup, PurchaseSpendingSummary as Summary } from '@/lib/calculations/purchaseHistory';

type Grouping = 'day' | 'month';

/** Rows of the breakdown shown before "Show all". */
const COLLAPSED_GROUPS = 7;

interface PurchaseSpendingSummaryProps {
  summary: Summary;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Which breakdown opens first; a single day or month reads best by day. */
  defaultGrouping: Grouping;
}

/** What the filtered purchases cost in all, per day and per month. */
export function PurchaseSpendingSummary({ summary, loading, error, onRetry, defaultGrouping }: PurchaseSpendingSummaryProps) {
  const t = useTranslations('stockPurchase.history');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const [chosenGrouping, setGrouping] = useState<Grouping | null>(null);
  const [expanded, setExpanded] = useState(false);
  const grouping = chosenGrouping ?? defaultGrouping;
  const currency = tc('currency');
  const groups = grouping === 'day' ? summary.byDay : summary.byMonth;
  const visible = expanded ? groups : groups.slice(0, COLLAPSED_GROUPS);

  if (error) {
    return (
      <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
        <LoadErrorAlert retrying={loading} onRetry={onRetry}>{t('summaryFailed')}</LoadErrorAlert>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-b border-gray-100 px-4 py-4 sm:px-5" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {loading ? (
          [0, 1, 2].map((key) => <Skeleton key={key} className="h-16 rounded-xl" />)
        ) : (
          <>
            <StatTile size="sm" label={t('spentTotal')} value={formatCurrency(summary.total)} unit={currency} />
            <StatTile size="sm" label={t('purchasesCount')} value={formatNumber(summary.count)} />
            <StatTile size="sm" label={t('unitsBought')} value={formatNumber(summary.quantity)} />
          </>
        )}
      </div>

      {!loading && summary.count > 0 && (
        <div className="space-y-2">
          <SegmentedControl
            variant="soft"
            size="sm"
            className="w-full sm:w-72"
            label={t('breakdownLabel')}
            options={[{ value: 'day', label: t('byDay') }, { value: 'month', label: t('byMonth') }]}
            value={grouping}
            onChange={(next) => { setGrouping(next); setExpanded(false); }}
          />
          <DataTable<PurchaseSpendingGroup>
            dense
            mobileCards
            label={t('breakdownLabel')}
            keyExtractor={(row) => row.key}
            data={visible}
            columns={[
              {
                key: 'period',
                header: grouping === 'day' ? t('groupDay') : t('groupMonth'),
                render: (row) => (
                  <span className="font-medium capitalize text-gray-900">
                    {grouping === 'day' ? formatDateOnly(row.key, locale) : formatYearMonth(row.key, locale)}
                  </span>
                ),
              },
              { key: 'count', header: t('groupCount'), align: 'right', render: (row) => <span className="tabular-nums">{formatNumber(row.count)}</span> },
              { key: 'quantity', header: t('groupQuantity'), align: 'right', render: (row) => <span className="tabular-nums">{formatNumber(row.quantity)}</span> },
              { key: 'total', header: t('groupTotal', { currency }), align: 'right', render: (row) => <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(row.total)}</span> },
            ]}
          />
          {groups.length > COLLAPSED_GROUPS && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? t('showLess') : t('showAll', { count: groups.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
