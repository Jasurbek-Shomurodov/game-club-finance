'use client';

// Route: /closing-stock

import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { loadClosingStockDay } from '@/lib/supabase/closingStockQueries';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DatePicker,
  EmptyState,
  InlineAlert,
  Input,
  MetricGridSkeleton,
  PageHeader,
  SearchInput,
  SectionHeading,
  SegmentedControl,
  StatTile,
  Stepper,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { BulkStockUpdateModal } from './BulkStockUpdateModal';
import { calendarTodayIso, todayIso } from '@/lib/utils';
import { formatCurrency, formatDateOnly, formatNumber, formatUnitCurrency } from '@/lib/formatters';
import {
  calculateClosingStockFromSold,
  calculateStockCountSummary,
  summarizeStockRow,
  summarizeStockRows,
} from '@/lib/calculations/stock';
import { classifyStockWriteError, type StockWriteErrorLike } from '@/lib/stockWriteErrors';
import {
  applyBulkStockOrder,
  applyClosingStockDraft,
  BulkStockAvailabilityError,
  buildEditableClosingStockRows,
  buildClosingStockUpserts,
  calculatePurchaseCostsByProduct,
  clearClosingStockDraft,
  closingStockRowTotalsInput,
  isReadOnlyClosingStockProduct,
  isSignedWholeNumberInput,
  isWholeNumberInput,
  normalizeStockCount,
  normalizeStockAdjustment,
  readClosingStockDraft,
  saveClosingStockDraft,
  usesSoldQuantityEntry,
  validateClosingStockRows,
  type ClosingStockExistingCount,
  type ClosingStockPurchaseQuantity,
  type ClosingStockRowData,
  type BulkStockOrderItem,
  type BulkStockOrderSummary,
  type StorageLike,
} from '@/lib/closingStock';
import {
  AlertTriangle,
  CalendarX,
  Info,
  Package,
  RefreshCcw,
  Save,
  Search,
  ShoppingCart,
} from 'lucide-react';
import type { Product } from '@/types';
import { useLatestRef } from '@/components/i18n/useLatestRef';

type RowData = ClosingStockRowData;

function parseNum(value: string): number {
  return normalizeStockCount(value);
}

function parseAdjustment(value: string | undefined): number {
  return normalizeStockAdjustment(value);
}

function preventNonSignedIntegerNumberInput(event: KeyboardEvent<HTMLInputElement>) {
  if (['.', ',', 'e', 'E', '+'].includes(event.key)) {
    event.preventDefault();
  }
}

function getBrowserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function applyBrowserDraft(
  date: string,
  clubId: string,
  rows: RowData[],
  businessDayStartHour: number,
  entryMode: 'closingStock' | 'soldQuantity',
): RowData[] {
  const draft = readClosingStockDraft(getBrowserStorage(), date, clubId);
  if (draft?.savedAt) {
    const savedAt = new Date(draft.savedAt);
    const savedCalendarDate = calendarTodayIso(savedAt);
    const savedBusinessDate = todayIso(savedAt, businessDayStartHour);

    if (savedCalendarDate === date && savedBusinessDate !== date) {
      return rows;
    }
  }

  return applyClosingStockDraft(rows, draft, entryMode);
}


function sortRowsByProductOrder(rows: RowData[]): RowData[] {
  return [...rows].sort((a, b) => {
    const trackingOrderA = a.product.tracks_inventory === false ? 0 : 1;
    const trackingOrderB = b.product.tracks_inventory === false ? 0 : 1;
    if (trackingOrderA !== trackingOrderB) return trackingOrderA - trackingOrderB;

    const orderA = a.product.sort_order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.product.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.product.name.localeCompare(b.product.name);
  });
}

function productCategory(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

const stickyHeaderCellClass = 'sticky top-0 z-20 border-b border-gray-100 bg-gray-50 px-4 py-3 align-bottom';
// The row number stays visible next to the product while the wide table scrolls horizontally.
const stickyIndexHeaderCellClass = 'sticky left-0 top-0 z-30 w-12 border-b border-gray-100 bg-gray-50 px-3 py-3 align-bottom';
const stickyIndexCellClass = 'sticky left-0 z-10 w-12 bg-surface px-3 py-4 group-hover:bg-gray-50';
// The product column stays visible while the wide table scrolls horizontally.
const stickyProductHeaderCellClass = 'sticky left-12 top-0 z-30 border-b border-gray-100 bg-gray-50 px-4 py-3 align-bottom shadow-[1px_0_0_0_rgb(var(--c-gray-200))]';
const stickyProductCellClass = 'sticky left-12 z-10 bg-surface px-4 py-4 shadow-[1px_0_0_0_rgb(var(--c-gray-200))] group-hover:bg-gray-50';
const CLOCK_REFRESH_MS = 60_000;
const addedTodayHeaderCellClass = stickyHeaderCellClass;

function withClosingStock(row: RowData, value: string): RowData {
  return {
    ...row,
    closingStock: value,
    soldQuantity: String(calculateStockCountSummary({
      previousStock: parseNum(row.previousStock),
      addedToday: parseNum(row.addedToday),
      adjustmentQuantity: parseAdjustment(row.adjustmentQuantity),
      closingStock: parseNum(value),
      salePrice: row.product.sale_price,
      costPrice: row.product.cost_price,
    }).soldQuantity),
  };
}

function withAdjustment(row: RowData, value: string): RowData {
  const nextRow = { ...row, adjustmentQuantity: value };
  nextRow.soldQuantity = String(calculateStockCountSummary({
    previousStock: parseNum(nextRow.previousStock),
    addedToday: parseNum(nextRow.addedToday),
    adjustmentQuantity: parseAdjustment(value),
    closingStock: parseNum(nextRow.closingStock),
    salePrice: nextRow.product.sale_price,
    costPrice: nextRow.product.cost_price,
  }).soldQuantity);
  return nextRow;
}

function withSoldQuantity(row: RowData, value: string): RowData {
  if (row.product.tracks_inventory === false) {
    return {
      ...row,
      soldQuantity: value,
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
    };
  }
  return {
    ...row,
    soldQuantity: value,
    closingStock: String(calculateClosingStockFromSold(
      parseNum(row.previousStock),
      parseNum(row.addedToday),
      parseNum(value),
      parseAdjustment(row.adjustmentQuantity),
    )),
  };
}

function rowSummary(row: RowData) {
  return summarizeStockRow(closingStockRowTotalsInput(row));
}

/** `null` date means "follow the club's current business day". */
interface DateSelection {
  clubId: string | null;
  date: string | null;
}

export default function ClosingStockPage() {
  const t = useTranslations('closingStock');
  const tRef = useLatestRef(t);
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, selectedClub, role: currentRole, businessDayStartHour } = useClub();
  const [clock, setClock] = useState(() => Date.now());
  const today = useMemo(() => todayIso(new Date(clock), businessDayStartHour), [clock, businessDayStartHour]);
  const [dateSelection, setDateSelection] = useState<DateSelection>({ clubId: selectedClubId, date: null });
  // Switching clubs resets to that club's business day in the same render, so
  // the page loads once for the new club instead of once per stale date.
  const date = dateSelection.clubId === selectedClubId && dateSelection.date && dateSelection.date <= today
    ? dateSelection.date
    : today;
  const [rows, setRows] = useState<RowData[]>([]);
  const [purchaseCostsByProduct, setPurchaseCostsByProduct] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [invalidProductId, setInvalidProductId] = useState<string | null>(null);
  const [hasSavedCounts, setHasSavedCounts] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const requestSequence = useRef(0);
  const silentReload = useRef(false);
  const dirtyRef = useRef(false);
  const isHistoricalDate = date < today;
  const isOwner = currentRole === 'owner';
  const isAdmin = currentRole === 'admin';
  const canEditStockCounts = isOwner || (isAdmin && !isHistoricalDate);
  const usesSoldEntry = canEditStockCounts && usesSoldQuantityEntry(selectedClub);
  const usesClosingEntry = canEditStockCounts && !usesSoldEntry;
  const canSave = usesClosingEntry || usesSoldEntry;
  const isReadOnly = !canSave;
  const showsSavedSnapshotOnly = isHistoricalDate && !isOwner;

  const buildEditableRows = useCallback(
    (
      products: Product[],
      counts: ClosingStockExistingCount[],
      purchases: ClosingStockPurchaseQuantity[],
      previousClosings: Record<string, number>,
      isCurrentDate: boolean,
    ) => {
      return sortRowsByProductOrder(buildEditableClosingStockRows({
        products,
        counts,
        purchases,
        previousClosings,
        isCurrentDate,
      }));
    },
    [],
  );

  const loadData = useCallback(async (selectedDate: string, silent: boolean) => {
    const requestId = ++requestSequence.current;
    const isCurrent = () => requestId === requestSequence.current;
    const fail = () => {
      setLoadError(tRef.current('loadFailed'));
      if (!silent) setRows([]);
      setLoading(false);
      setRefreshing(false);
    };
    const finish = (nextRows: RowData[], savedCountsExist: boolean) => {
      setRows(nextRows);
      setHasSavedCounts(savedCountsExist);
      setDirty(false);
      setInvalidProductId(null);
      setLoading(false);
      setRefreshing(false);
    };

    if (!selectedClubId) {
      setRows([]);
      setPurchaseCostsByProduct({});
      setHasSavedCounts(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setDirty(false);
      setError('');
    }
    setLoadError('');
    const supabase = createClient();
    const readOnlyDate = selectedDate < today;
    const canUseDraft = currentRole === 'owner' || (currentRole === 'admin' && !readOnlyDate);
    const draftMode = usesSoldEntry ? 'soldQuantity' : 'closingStock';

    const { data: day } = await loadClosingStockDay(supabase, {
      clubId: selectedClubId,
      date: selectedDate,
      today,
      isOwner: currentRole === 'owner',
      unknownProductName: tRef.current('unknownProduct'),
    });
    if (!isCurrent()) return;
    if (!day) {
      fail();
      return;
    }

    setPurchaseCostsByProduct(calculatePurchaseCostsByProduct(day.purchases));
    const editableRows = buildEditableRows(
      day.products,
      day.counts,
      day.purchases,
      day.previousClosings,
      day.isCurrentDate,
    );
    finish(canUseDraft && day.draftEligible ? applyBrowserDraft(
      selectedDate,
      selectedClubId,
      editableRows,
      businessDayStartHour,
      draftMode,
    ) : editableRows, day.hasSavedCounts);
  }, [buildEditableRows, businessDayStartHour, currentRole, selectedClubId, today, usesSoldEntry, tRef]);

  // Keep "today" current while the page stays open (overnight tabs, sleep).
  // Unsaved edits are never discarded by a day rollover; the clock catches up
  // once they are saved or discarded.
  useEffect(() => {
    const refreshClock = () => {
      if (document.visibilityState === 'hidden' || dirtyRef.current) return;
      setClock(Date.now());
    };
    const timer = window.setInterval(refreshClock, CLOCK_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshClock);
    window.addEventListener('focus', refreshClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshClock);
      window.removeEventListener('focus', refreshClock);
    };
  }, []);

  useEffect(() => {
    dirtyRef.current = dirty;
    if (!dirty) setClock(Date.now());
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    setBulkUpdateOpen(false);
  }, [date, selectedClubId]);

  useEffect(() => {
    const silent = silentReload.current;
    silentReload.current = false;
    loadData(date, silent).catch(() => {
      setLoadError(tRef.current('loadFailed'));
      setLoading(false);
      setRefreshing(false);
    });
    return () => { requestSequence.current += 1; };
  }, [date, loadData, reloadKey, tRef]);

  useEffect(() => {
    if (!selectedCategory) return;
    const categoryExists = rows.some((row) => productCategory(row.product.category) === selectedCategory);
    if (!categoryExists) setSelectedCategory('');
  }, [rows, selectedCategory]);

  function reload({ silent = false } = {}) {
    silentReload.current = silent;
    setReloadKey((key) => key + 1);
  }

  async function handleDateChange(value: string) {
    if (value === date) return;
    if (dirty) {
      const discard = await confirm({
        title: t('unsavedChangesTitle'),
        description: t('unsavedChangesBody'),
        confirmLabel: t('discardChanges'),
        tone: 'danger',
      });
      if (!discard) return;
    }
    setDateSelection({ clubId: selectedClubId, date: value === today ? null : value });
    setError('');
    setInvalidProductId(null);
  }

  function editRow(productId: string, transform: (row: RowData) => RowData) {
    setRows((prev) => prev.map((row) => (row.product.id === productId ? transform(row) : row)));
    setDirty(true);
    if (invalidProductId === productId) setInvalidProductId(null);
  }

  function updateClosingStock(productId: string, value: string) {
    if (!isWholeNumberInput(value)) return;
    editRow(productId, (row) => withClosingStock(row, value));
  }

  function stepClosingStock(productId: string, amount: number) {
    editRow(productId, (row) => withClosingStock(row, String(Math.max(0, parseNum(row.closingStock) + amount))));
  }

  function updateAdjustment(productId: string, value: string) {
    if (!isSignedWholeNumberInput(value)) return;
    editRow(productId, (row) => withAdjustment(row, value));
  }

  function updateAdjustmentReason(productId: string, value: string) {
    editRow(productId, (row) => ({ ...row, adjustmentReason: value }));
  }

  function updateSoldQuantity(productId: string, value: string) {
    if (!isWholeNumberInput(value)) return;
    editRow(productId, (row) => withSoldQuantity(row, value));
  }

  function stepSoldQuantity(productId: string, amount: number) {
    editRow(productId, (row) => withSoldQuantity(row, String(Math.max(0, parseNum(row.soldQuantity) + amount))));
  }

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => productCategory(row.product.category)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesCategory = !selectedCategory || productCategory(row.product.category) === selectedCategory;
      const matchesQuery = !needle || row.product.name.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [query, rows, selectedCategory]);

  const rowNumberById = useMemo(
    () => new Map(rows.map((row, index) => [row.product.id, index + 1])),
    [rows],
  );

  const bulkRows = useMemo(() => rows.filter((row) => !isReadOnlyClosingStockProduct(row.product)), [rows]);

  // KPIs describe the whole day; filters only narrow the table and its footer.
  const totals = useMemo(() => summarizeStockRows(rows.map((row) => (
    closingStockRowTotalsInput(row, purchaseCostsByProduct[row.product.id] ?? 0)
  ))), [rows, purchaseCostsByProduct]);

  const filteredTotals = useMemo(() => summarizeStockRows(filteredRows.map((row) => (
    closingStockRowTotalsInput(row, purchaseCostsByProduct[row.product.id] ?? 0)
  ))), [filteredRows, purchaseCostsByProduct]);

  function handleSaveDraft() {
    if (isReadOnly) {
      setError(t('readOnlyBody'));
      return;
    }

    if (rows.length === 0) {
      setError(tc('noData'));
      return;
    }

    setError('');

    if (!selectedClubId || !saveClosingStockDraft(getBrowserStorage(), date, rows, undefined, selectedClubId)) {
      setError(t('draftSaveFailed'));
      return;
    }

    setDirty(false);
    showToast(t('draftSaved'));
  }

  function validationMessage(validationError: NonNullable<ReturnType<typeof validateClosingStockRows>>) {
    const validationMessages = {
      closing_required: t('closingRequired', { product: validationError.productName }),
      sold_required: t('soldRequired', { product: validationError.productName }),
      adjustment_reason_required: t('adjustmentReasonRequired', { product: validationError.productName }),
      closing_exceeds_available: t('closingExceedsAvailable', {
        product: validationError.productName,
        available: formatNumber(validationError.availableStock),
      }),
      negative_available_stock: t('negativeAvailableStock', { product: validationError.productName }),
      sold_quantity_mismatch: t('soldQuantityMismatch', { product: validationError.productName }),
    };
    return validationMessages[validationError.code];
  }

  function saveErrorMessage(saveError: StockWriteErrorLike) {
    switch (classifyStockWriteError(saveError)) {
      case 'permission': return t('errorPermission');
      case 'adminPastDate': return t('errorAdminPastDate');
      case 'adjustmentOwnerOnly': return t('errorAdjustmentOwnerOnly');
      case 'futureDate': return t('errorFutureDate');
      case 'productUnavailable': return t('errorProductUnavailable');
      case 'laterCountInvalid': return t('errorLaterCountInvalid');
      case 'invalid': return t('errorInvalid');
      default: return t('saveFailed');
    }
  }

  async function persistStockCounts(
    nextRows: RowData[],
    successMessage: string,
  ): Promise<{ ok: boolean; message: string | null }> {
    if (isReadOnly) return { ok: false, message: t('readOnlyBody') };

    // Inactive and archived rows stay on screen but the save RPC rejects
    // them; it leaves their saved rows untouched when they are omitted.
    nextRows = nextRows.filter((row) => !isReadOnlyClosingStockProduct(row.product));
    if (nextRows.length === 0) return { ok: false, message: tc('noData') };
    if (!selectedClubId) return { ok: false, message: tc('error') };

    const validationError = validateClosingStockRows(nextRows);
    if (validationError) {
      setInvalidProductId(validationError.productId);
      return { ok: false, message: validationMessage(validationError) };
    }

    setSaving(true);
    setError('');
    try {
      const supabase = createClient();
      // save_closing_stock_counts records auth.uid() itself and ignores
      // created_by in the payload, so no session lookup is needed here.
      const { upserts } = buildClosingStockUpserts({
        date,
        rows: nextRows,
        createdBy: null,
      });

      const { error: err } = await supabase.rpc('save_closing_stock_counts', {
        p_club_id: selectedClubId,
        p_date: date,
        p_counts: upserts,
      });

      if (err) return { ok: false, message: saveErrorMessage(err) };

      clearClosingStockDraft(getBrowserStorage(), date, selectedClubId);
      setDirty(false);
      showToast(successMessage);
      reload({ silent: true });
      return { ok: true, message: null };
    } catch {
      return { ok: false, message: t('saveFailed') };
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitStockCounts() {
    const result = await persistStockCounts(rows, t('success'));
    if (!result.ok) setError(result.message ?? tc('error'));
  }

  async function handleBulkStockSave(
    items: BulkStockOrderItem[],
    summary: BulkStockOrderSummary,
  ): Promise<string | null> {
    let nextRows: RowData[];
    try {
      nextRows = applyBulkStockOrder(rows, items);
    } catch (bulkError) {
      if (bulkError instanceof BulkStockAvailabilityError) {
        return t('bulkInsufficientStock', {
          product: bulkError.productName,
          available: formatNumber(bulkError.availableQuantity),
        });
      }
      return tc('error');
    }

    const result = await persistStockCounts(nextRows, t('bulkSuccess', {
      items: formatNumber(summary.totalQuantity),
      total: formatCurrency(summary.totalPrice),
      currency: tc('currency'),
    }));
    return result.ok ? null : result.message ?? tc('error');
  }

  const kpis: Array<{ label: string; value: string; unit?: string; tone?: 'default' | 'success' | 'danger' }> = [
    { label: t('totalProducts'), value: formatNumber(rows.length) },
    { label: t('stockPurchased'), value: formatNumber(totals.added), unit: t('pcs') },
    { label: t('totalSold'), value: formatNumber(totals.sold), unit: t('pcs') },
    { label: t('barIncomeEst'), value: formatCurrency(totals.income), unit: tc('currency'), tone: 'success' },
    { label: t('barProfitEst'), value: formatCurrency(totals.profit), unit: tc('currency'), tone: totals.profit < 0 ? 'danger' : 'success' },
    { label: t('stockValue'), value: formatCurrency(totals.stockValue), unit: tc('currency') },
  ];
  const categoryChipOptions = [{ value: '', label: tc('all') }, ...categoryOptions.map((category) => ({ value: category, label: category }))];
  const hasFilters = Boolean(query.trim() || selectedCategory);
  const saveDisabled = loading || refreshing || isReadOnly || Boolean(loadError) || rows.length === 0;
  const draftDisabled = saving || loading || refreshing || isReadOnly || Boolean(loadError) || hasSavedCounts;
  const bannerTitle = isReadOnly
    ? (isHistoricalDate ? t('readOnlyTitle') : t('viewerReadOnlyTitle'))
    : t('ownerHistoricalEditTitle');
  const bannerBody = isReadOnly
    ? (isHistoricalDate ? t('readOnlyBody') : t('viewerReadOnlyBody'))
    : t('ownerHistoricalEditBody');

  return (
    <div className="space-y-5">
      <BulkStockUpdateModal
        open={bulkUpdateOpen}
        rows={bulkRows}
        saving={saving}
        onClose={() => setBulkUpdateOpen(false)}
        onSave={handleBulkStockSave}
      />

      <PageHeader
        title={t('title')}
        meta={dirty ? <Badge variant="warning" size="sm">{t('unsavedChanges')}</Badge> : undefined}
        action={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                ariaLabel={t('date')}
                value={date}
                max={today}
                disabled={saving}
                className="w-full sm:w-[220px]"
                onChange={(value) => { void handleDateChange(value); }}
              />
              {!isReadOnly && (
                <Button
                  className="hidden sm:inline-flex"
                  onClick={handleSubmitStockCounts}
                  disabled={saveDisabled}
                  loading={saving || loading}
                  loadingLabel={saving ? tc('saving') : tc('loading')}
                  icon={<Package size={16} aria-hidden="true" />}
                >
                  {t('submit')}
                </Button>
              )}
            </div>
            {!isReadOnly && !loading && !loadError && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError('');
                    setBulkUpdateOpen(true);
                  }}
                  disabled={saving || saveDisabled || bulkRows.length === 0}
                  icon={<ShoppingCart size={15} aria-hidden="true" />}
                >
                  {t('bulkUpdate')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDraft}
                  disabled={draftDisabled}
                  title={hasSavedCounts && !isReadOnly ? t('draftDisabledSaved') : undefined}
                  icon={<Save size={15} aria-hidden="true" />}
                >
                  {t('saveDraft')}
                </Button>
              </div>
            )}
          </div>
        )}
      />

      {(isHistoricalDate || isReadOnly) && (
        <InlineAlert variant={isReadOnly && isHistoricalDate ? 'warning' : 'info'} title={bannerTitle}>
          {bannerBody}
        </InlineAlert>
      )}

      {hasSavedCounts && !isReadOnly && !loading && !loadError && (
        <p className="text-sm text-gray-500">{t('draftDisabledSaved')}</p>
      )}

      {loadError && !loading ? (
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title={loadError}
            action={(
              <Button variant="outline" onClick={() => reload()} icon={<RefreshCcw size={16} aria-hidden="true" />}>
                {tc('retry')}
              </Button>
            )}
          />
        </Card>
      ) : (
        <>
          {loading ? (
            <MetricGridSkeleton count={6} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
          ) : (
            <Card as="section" padding="none" aria-busy={refreshing || undefined}>
              <div className="grid grid-cols-2 lg:grid-cols-6">
                {kpis.map((kpi) => (
                  <StatTile
                    key={kpi.label}
                    variant="flat"
                    size="sm"
                    label={kpi.label}
                    value={kpi.value}
                    unit={kpi.unit}
                    tone={kpi.tone}
                    className="border-gray-100 p-3 even:border-l sm:p-4 [&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0 lg:[&:not(:first-child)]:border-l"
                  />
                ))}
              </div>
            </Card>
          )}

          {error && <InlineAlert variant="danger">{error}</InlineAlert>}

          <Card as="section" padding="none" className="overflow-hidden">
            <CardHeader>
              <SectionHeading
                size="lg"
                title={t('products')}
                action={(
                  <SearchInput
                    className="w-full md:w-72"
                    controlSize="sm"
                    value={query}
                    onChange={setQuery}
                    placeholder={t('searchPlaceholder')}
                  />
                )}
              />
            </CardHeader>

            {categoryOptions.length > 0 && (
              <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
                <SegmentedControl
                  variant="chips"
                  label={t('category')}
                  className="flex-nowrap overflow-x-auto pb-1"
                  options={categoryChipOptions}
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                />
              </div>
            )}

            {loading ? (
              <TableSkeleton rows={8} columns={9} className="rounded-none border-0 shadow-none" />
            ) : rows.length === 0 ? (
              showsSavedSnapshotOnly ? (
                <EmptyState
                  compact
                  icon={CalendarX}
                  title={t('noSnapshotTitle')}
                  description={t('noSnapshotBody', { date: formatDateOnly(date, locale) })}
                />
              ) : (
                <EmptyState
                  compact
                  icon={Package}
                  title={t('noProductsTitle')}
                  description={t('noProductsBody')}
                  action={isOwner || isAdmin ? (
                    <ButtonLink href="/products" variant="primary" size="sm">{t('viewProducts')}</ButtonLink>
                  ) : undefined}
                />
              )
            ) : filteredRows.length === 0 ? (
              <EmptyState
                compact
                icon={Search}
                title={tc('noData')}
                action={hasFilters ? (
                  <Button variant="outline" size="sm" onClick={() => { setQuery(''); setSelectedCategory(''); }}>{t('clearFilters')}</Button>
                ) : undefined}
              />
            ) : (
              <div className="relative">
                <div
                  className={`max-h-[calc(100vh-14rem)] overflow-auto scrollbar-thin transition-opacity ${refreshing ? 'opacity-70' : ''}`}
                  aria-busy={refreshing || undefined}
                  aria-label={t('products')}
                  tabIndex={0}
                >
                <table className="w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-medium text-gray-500">
                      <th className={`${stickyIndexHeaderCellClass} text-left`}>#</th>
                      <th className={`${stickyProductHeaderCellClass} min-w-[180px] text-left sm:min-w-[240px]`}>{t('product')}</th>
                      <th className={`${stickyHeaderCellClass} text-right`}>{t('salePrice')}<br /><span className="text-gray-400">({tc('currency')})</span></th>
                      <th className={`${stickyHeaderCellClass} text-right`}>{t('costBasis')}<br /><span className="text-gray-400">({tc('currency')})</span></th>
                      <th className={`${stickyHeaderCellClass} text-center`} title={t('openingStockHint')}>{t('previousStock')}<br /><span className="text-gray-400">({t('pcs')})</span></th>
                      <th className={`${addedTodayHeaderCellClass} text-center`}>{t('addedToday')}<br /><span className="text-gray-400">({t('pcs')})</span></th>
                      <th className={`${stickyHeaderCellClass} min-w-[150px] text-center`}>
                        {t('adjustment')}
                        <br />
                        <span className="text-gray-400">({t('pcs')})</span>
                      </th>
                      <th className={`${stickyHeaderCellClass} text-center`}>
                        {t('closingStock')}
                        <br />
                        <Badge variant="primary" size="sm">
                          {isReadOnly ? t('snapshot') : usesSoldEntry ? t('calculated') : t('youEnter')}
                        </Badge>
                      </th>
                      <th className={`${stickyHeaderCellClass} text-center`}>
                        {t('soldQty')}
                        <br />
                        <span className="text-gray-400">({t('pcs')})</span>
                        {canSave && (usesSoldEntry || filteredRows.some((row) => row.product.tracks_inventory === false)) && (
                          <>
                            <br />
                            <Badge variant="primary" size="sm">{t('youEnter')}</Badge>
                          </>
                        )}
                      </th>
                      <th className={`${stickyHeaderCellClass} text-right`}>{t('barIncome')}<br /><span className="text-gray-400">({tc('currency')})</span></th>
                      <th className={`${stickyHeaderCellClass} px-5 text-right`}>{t('barProfit')}<br /><span className="text-gray-400">({tc('currency')})</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredRows.map((row) => {
                      const productId = row.product.id;
                      const rowReadOnly = !canSave || isReadOnlyClosingStockProduct(row.product);
                      const inputsDisabled = saving || refreshing;
                      const summary = rowSummary(row);
                      const tracksInventory = row.product.tracks_inventory !== false;
                      const rowFlagged = invalidProductId === productId;
                      return (
                        <tr key={productId} className="group hover:bg-gray-50">
                          <td className={`${stickyIndexCellClass} text-gray-500 tabular-nums`}>{rowNumberById.get(productId)}</td>
                          <td className={stickyProductCellClass}>
                            <div className="flex items-center gap-3 sm:gap-4">
                              <Avatar name={row.product.name} tone="neutral" className="hidden sm:inline-flex" />
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900">{row.product.name}</p>
                                {!tracksInventory && (
                                  <Badge variant="purple" size="sm" className="mt-1">{t('madeToOrder')}</Badge>
                                )}
                                <p className="mt-1 text-xs text-gray-500">{t('costLabel')} {formatUnitCurrency(row.product.cost_price)} {tc('currency')}</p>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-gray-900">{formatCurrency(row.product.sale_price)}</td>
                          <td className="px-4 py-4 text-right">
                            <p className="whitespace-nowrap font-medium tabular-nums text-gray-900">{formatUnitCurrency(row.product.cost_price)}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {!tracksInventory
                                ? t('notIncludedInStockValue')
                                : `${t('valueLabel')} ${formatCurrency(parseNum(row.closingStock) * row.product.cost_price)}`}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-center font-medium tabular-nums text-gray-900">
                            {!tracksInventory ? '—' : formatNumber(parseNum(row.previousStock))}
                          </td>
                          <td className="px-4 py-4 text-center font-medium tabular-nums text-success-600">
                            {!tracksInventory ? '—' : (
                              <div className="flex flex-col items-center gap-1">
                                <span>{formatNumber(parseNum(row.addedToday))}</span>
                                {row.hasPurchaseMismatch && (
                                  <Badge
                                    variant="warning"
                                    size="sm"
                                    icon={<Info size={12} aria-hidden="true" />}
                                    title={t('purchaseMismatch', {
                                      purchased: formatNumber(row.purchaseQuantity ?? 0),
                                      saved: formatNumber(parseNum(row.addedToday)),
                                    })}
                                  >
                                    {t('purchasesBadge', { purchased: formatNumber(row.purchaseQuantity ?? 0) })}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {!tracksInventory ? (
                              <p className="text-center font-semibold text-gray-400">—</p>
                            ) : isOwner && !rowReadOnly ? (
                              <div className="mx-auto w-32 space-y-2">
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  controlSize="sm"
                                  className="text-center text-base font-semibold sm:text-sm"
                                  value={row.adjustmentQuantity ?? '0'}
                                  aria-label={`${t('adjustment')} · ${row.product.name}`}
                                  disabled={inputsDisabled}
                                  onKeyDown={preventNonSignedIntegerNumberInput}
                                  onWheel={(event) => event.currentTarget.blur()}
                                  onChange={(event) => updateAdjustment(productId, event.target.value)}
                                />
                                {parseAdjustment(row.adjustmentQuantity) !== 0 && (
                                  <Input
                                    type="text"
                                    controlSize="sm"
                                    className="text-base sm:text-xs"
                                    value={row.adjustmentReason ?? ''}
                                    placeholder={t('adjustmentReason')}
                                    aria-label={`${t('adjustmentReason')} · ${row.product.name}`}
                                    aria-invalid={(rowFlagged && !String(row.adjustmentReason ?? '').trim()) || undefined}
                                    disabled={inputsDisabled}
                                    onChange={(event) => updateAdjustmentReason(productId, event.target.value)}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="text-center">
                                <p className="font-semibold text-gray-900">{formatNumber(parseAdjustment(row.adjustmentQuantity))}</p>
                                {row.adjustmentReason && (
                                  <p className="mt-1 text-xs text-gray-500">{row.adjustmentReason}</p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {!tracksInventory ? (
                              <p className="text-center font-semibold text-gray-400">—</p>
                            ) : rowReadOnly || usesSoldEntry ? (
                              <p className="text-center font-semibold text-gray-900">{formatNumber(parseNum(row.closingStock))}</p>
                            ) : (
                              <Stepper
                                className="mx-auto flex w-fit"
                                label={`${t('closingStock')} · ${row.product.name}`}
                                decreaseLabel={t('decreaseClosingStock')}
                                increaseLabel={t('increaseClosingStock')}
                                value={row.closingStock}
                                disabled={inputsDisabled}
                                invalid={row.closingStock.trim() === '' || rowFlagged}
                                onChange={(value) => updateClosingStock(productId, value)}
                                onStep={(delta) => stepClosingStock(productId, delta)}
                              />
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {!rowReadOnly && (usesSoldEntry || !tracksInventory) ? (
                              <Stepper
                                className="mx-auto flex w-fit"
                                label={`${t('soldQty')} · ${row.product.name}`}
                                decreaseLabel={t('decreaseSoldQty')}
                                increaseLabel={t('increaseSoldQty')}
                                value={row.soldQuantity}
                                disabled={inputsDisabled}
                                invalid={(tracksInventory && row.soldQuantity.trim() === '') || rowFlagged}
                                onChange={(value) => updateSoldQuantity(productId, value)}
                                onStep={(delta) => stepSoldQuantity(productId, delta)}
                              />
                            ) : (
                              <p className="text-center font-semibold text-gray-900">{formatNumber(summary.soldQuantity)}</p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-success-600">{formatCurrency(summary.barIncome)}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-right font-medium tabular-nums text-success-600">{formatCurrency(summary.barProfit)}</td>
                        </tr>
                      );
                    })}
                    <tr className="group border-t border-gray-200 bg-surface font-semibold tabular-nums text-gray-900">
                      <td className={stickyIndexCellClass} />
                      <td className={stickyProductCellClass}>{t('totalRow', { count: filteredRows.length })}</td>
                      <td className="px-4 py-4" />
                      <td className="whitespace-nowrap px-4 py-4 text-right">
                        <span className="block text-xs font-medium text-gray-500">{t('stockValue')}</span>
                        {formatCurrency(filteredTotals.stockValue)}
                      </td>
                      <td className="px-4 py-4 text-center">{formatNumber(filteredTotals.previous)}</td>
                      <td className="px-4 py-4 text-center text-success-600">{formatNumber(filteredTotals.added)}</td>
                      <td className="px-4 py-4 text-center">—</td>
                      <td className="px-4 py-4 text-center">—</td>
                      <td className="px-4 py-4 text-center">{formatNumber(filteredTotals.sold)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-right text-success-600">{formatCurrency(filteredTotals.income)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-right text-success-600">{formatCurrency(filteredTotals.profit)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface" aria-hidden="true" />
              </div>
            )}
          </Card>

          {canSave && rows.length > 0 && (
            <div className="sticky bottom-0 z-30 -mx-4 border-t border-gray-200 bg-surface/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden">
              <Button
                fullWidth
                onClick={handleSubmitStockCounts}
                disabled={saveDisabled}
                loading={saving}
                loadingLabel={tc('saving')}
                icon={<Package size={16} aria-hidden="true" />}
              >
                {t('submit')}
              </Button>
            </div>
          )}
        </>
      )}

      {toastElement}
      {confirmDialog}
    </div>
  );
}
