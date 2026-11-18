'use client';

// Route: /write-offs

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PackageMinus } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  InlineAlert,
  LoadErrorAlert,
  Money,
  PageHeader,
  SectionHeading,
  TableSkeleton,
  useToast,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { loadClosingStockDay } from '@/lib/supabase/closingStockQueries';
import {
  buildClosingStockUpserts,
  buildEditableClosingStockRows,
  isReadOnlyClosingStockProduct,
  type ClosingStockRowData,
} from '@/lib/closingStock';
import {
  applyStockWriteOff,
  notifyStockWriteOff,
  rowWriteOff,
  StockWriteOffError,
  writeOffKindVariant,
  type RowWriteOff,
} from '@/lib/stockWriteOffs';
import { classifyStockWriteError, type StockWriteErrorLike } from '@/lib/stockWriteErrors';
import { formatDateOnly, formatNumber } from '@/lib/formatters';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { useLatestRef } from '@/components/i18n/useLatestRef';
import { StockWriteOffModal, type StockWriteOffInput } from '../closing-stock/StockWriteOffModal';

interface RecordedWriteOff {
  row: ClosingStockRowData;
  writeOff: RowWriteOff;
}

const EMPTY_ROWS: ClosingStockRowData[] = [];

/**
 * Bar write-offs of the current business day, on a page of their own so the
 * staff who find a shortage or an expired item can record it without opening
 * the whole stock count. Owners and admins record; only owners reduce or
 * remove one (migration 164). Past days are corrected on Closing Stock.
 */
export default function WriteOffsPage() {
  const t = useTranslations('writeOffs');
  const tcs = useTranslations('closingStock');
  const tcsRef = useLatestRef(tcs);
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const sectionTabs = useSectionTabs('bar');
  const { selectedClubId, role, businessDayStartHour } = useClub();
  const today = useBusinessToday(businessDayStartHour);
  const isOwner = role === 'owner';
  const canRecord = role === 'owner' || role === 'admin';
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast, toastElement } = useToast();

  const load = useCallback(async () => {
    if (!selectedClubId) return EMPTY_ROWS;
    const { data: day } = await loadClosingStockDay(createClient(), {
      clubId: selectedClubId,
      date: today,
      today,
      isOwner,
      unknownProductName: tcsRef.current('unknownProduct'),
    });
    if (!day) throw new Error('Write-off day failed to load');
    return buildEditableClosingStockRows(day)
      .filter((row) => row.product.tracks_inventory !== false && !isReadOnlyClosingStockProduct(row.product));
  }, [isOwner, selectedClubId, tcsRef, today]);
  const query = useClubQuery(selectedClubId ? load : null, EMPTY_ROWS);
  const rows = query.data;

  const recorded = useMemo<RecordedWriteOff[]>(() => rows
    .flatMap((row) => {
      const writeOff = rowWriteOff(row);
      return writeOff ? [{ row, writeOff }] : [];
    })
    .sort((a, b) => a.row.product.name.localeCompare(b.row.product.name)), [rows]);

  function saveErrorMessage(error: StockWriteErrorLike) {
    switch (classifyStockWriteError(error)) {
      case 'permission': return tcs('errorPermission');
      case 'adminPastDate': return tcs('errorAdminPastDate');
      case 'adjustmentOwnerOnly': return tcs('errorAdjustmentOwnerOnly');
      case 'futureDate': return tcs('errorFutureDate');
      case 'productUnavailable': return tcs('errorProductUnavailable');
      case 'laterCountInvalid': return tcs('errorLaterCountInvalid');
      case 'invalid': return tcs('errorInvalid');
      default: return tcs('saveFailed');
    }
  }

  // Saves only this product's count for the day through the same atomic RPC
  // as Closing Stock; the other products' counts are left as they are.
  async function handleSave(input: StockWriteOffInput): Promise<string | null> {
    const row = rows.find((candidate) => candidate.product.id === input.productId);
    if (!row || !selectedClubId) return tc('error');
    let nextRow: ClosingStockRowData;
    try {
      nextRow = applyStockWriteOff(row, input);
    } catch (error) {
      if (error instanceof StockWriteOffError) {
        if (error.code === 'exceeds_stock') {
          return tcs('writeOffExceedsStock', { product: error.productName, available: formatNumber(error.availableQuantity) });
        }
        if (error.code === 'positive_adjustment') return tcs('writeOffHasAdjustment', { product: error.productName });
      }
      return tcs('saveFailed');
    }

    setSaving(true);
    try {
      const { upserts } = buildClosingStockUpserts({ date: today, rows: [nextRow], createdBy: null });
      const { error } = await createClient().rpc('save_closing_stock_counts', {
        p_club_id: selectedClubId,
        p_date: today,
        p_counts: upserts,
      });
      if (error) return saveErrorMessage(error);
      showToast(input.quantity > 0 ? tcs('writeOffSaved') : tcs('writeOffRemoved'));
      void notifyStockWriteOff(selectedClubId, today, input.productId);
      void query.reload({ silent: true });
      return null;
    } catch {
      return tcs('saveFailed');
    } finally {
      setSaving(false);
    }
  }

  const kindLabel = (kind: RowWriteOff['kind']) => tcs(`writeOffKinds.${kind}`);
  const columns: DataTableColumn<RecordedWriteOff>[] = [
    {
      key: 'product',
      header: t('product'),
      className: 'min-w-[160px]',
      render: ({ row }) => <span className="font-semibold text-gray-900">{row.product.name}</span>,
    },
    {
      key: 'kind',
      header: t('reason'),
      className: 'w-36',
      render: ({ writeOff }) => <Badge variant={writeOffKindVariant(writeOff.kind)} size="sm">{kindLabel(writeOff.kind)}</Badge>,
    },
    {
      key: 'quantity',
      header: t('quantity'),
      align: 'right',
      className: 'w-28 whitespace-nowrap',
      render: ({ writeOff }) => <span className="tabular-nums">{formatNumber(writeOff.quantity)} {tcs('pcs')}</span>,
    },
    ...(isOwner ? [{
      key: 'cost',
      header: t('cost'),
      align: 'right' as const,
      className: 'w-40 whitespace-nowrap',
      render: ({ row, writeOff }: RecordedWriteOff) => (
        <span className="font-semibold tabular-nums text-danger-600">
          <Money amount={writeOff.quantity * Number(row.product.cost_price ?? 0)} currency={null} />
        </span>
      ),
    }] : []),
    {
      key: 'note',
      header: t('note'),
      className: 'min-w-[160px]',
      render: ({ writeOff }) => <span className="text-gray-500">{writeOff.note || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      {toastElement}
      <PageHeader
        title={t('title')}
        tabs={sectionTabs}
        action={canRecord ? (
          <Button
            onClick={() => setOpen(true)}
            disabled={query.loading || query.error || rows.length === 0}
            icon={<PackageMinus size={16} aria-hidden="true" />}
          >
            {t('record')}
          </Button>
        ) : undefined}
      />

      {!canRecord && <InlineAlert variant="info">{t('readOnly')}</InlineAlert>}

      {query.error ? (
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      ) : (
        <Card as="section" padding="none" className="overflow-hidden">
          <CardHeader>
            <SectionHeading
              title={t('todayTitle', { date: formatDateOnly(today, locale) })}
              description={isOwner ? t('todayOwnerHint') : t('todayHint')}
            />
          </CardHeader>
          {query.loading ? (
            <TableSkeleton rows={4} columns={columns.length} className="rounded-none border-0 shadow-none" />
          ) : (
            <DataTable
              mobileCards
              bare
              label={t('todayTitle', { date: formatDateOnly(today, locale) })}
              minWidth={600}
              columns={columns}
              data={recorded}
              keyExtractor={({ row }) => row.product.id}
              emptyState={<EmptyState compact icon={PackageMinus} title={t('empty')} />}
            />
          )}
        </Card>
      )}

      {canRecord && (
        <StockWriteOffModal
          open={open}
          rows={rows}
          saving={saving}
          canChangeRecorded={isOwner}
          showCost={isOwner}
          onClose={() => setOpen(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
