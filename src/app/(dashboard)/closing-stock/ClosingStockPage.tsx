'use client';

// Route: /closing-stock

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { loadClosingStockDay } from '@/lib/supabase/closingStockQueries';
import { fetchPromotions } from '@/lib/supabase/promotions';
import { promotionsForProduct } from '@/lib/promotions';
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
  LoadErrorAlert,
  MetricGridSkeleton,
  PageHeader,
  SearchInput,
  SectionHeading,
  SegmentedControl,
  Select,
  StatTile,
  Stepper,
  TableSkeleton,
  stickyOffsetBelow,
  useElementHeight,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { BulkStockUpdateModal } from './BulkStockUpdateModal';
import { groupByCategory } from '@/lib/productSections';
import { calendarTodayIso, todayIso } from '@/lib/utils';
import { useClubQuery } from '@/lib/useClubQuery';
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
  CalendarX,
  Gift,
  Info,
  Package,
  Save,
  Search,
  ShoppingCart,
} from 'lucide-react';
import type { Product, Promotion } from '@/types';
import { useLatestRef } from '@/components/i18n/useLatestRef';

type RowData = ClosingStockRowData;

function parseNum(value: string | undefined): number {
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
const TABLE_COLUMN_COUNT = 12;
const addedTodayHeaderCellClass = stickyHeaderCellClass;

/** Sold quantity derived from the row's stock movement, including promo giveaways. */
function derivedSoldQuantity(row: RowData): string {
  return String(calculateStockCountSummary({
    previousStock: parseNum(row.previousStock),
    addedToday: parseNum(row.addedToday),
    adjustmentQuantity: parseAdjustment(row.adjustmentQuantity),
    giveawayQuantity: parseNum(row.giveawayQuantity),
    closingStock: parseNum(row.closingStock),
    salePrice: row.product.sale_price,
    costPrice: row.product.cost_price,
  }).soldQuantity);
}

function withClosingStock(row: RowData, value: string): RowData {
  const nextRow = { ...row, closingStock: value };
  return { ...nextRow, soldQuantity: derivedSoldQuantity(nextRow) };
}

function withAdjustment(row: RowData, value: string): RowData {
  const nextRow = { ...row, adjustmentQuantity: value };
  return { ...nextRow, soldQuantity: derivedSoldQuantity(nextRow) };
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
      parseNum(row.giveawayQuantity),
    )),
  };
}

/**
 * Free units leave stock unsold. When staff count closing stock, the sold
 * quantity shrinks; when they enter sold quantities, closing stock shrinks.
 */
function withGiveaway(row: RowData, value: string, soldEntry: boolean): RowData {
  const nextRow = { ...row, giveawayQuantity: value };
  if (row.product.tracks_inventory === false) return nextRow;
  if (soldEntry) return withSoldQuantity(nextRow, nextRow.soldQuantity);
  return { ...nextRow, soldQuantity: derivedSoldQuantity(nextRow) };
}

function rowSummary(row: RowData) {
  return summarizeStockRow(closingStockRowTotalsInput(row));
}

/** One loaded day: the editable rows plus what the page shows around them. */
interface ClosingStockDayData {
  rows: RowData[];
  hasSavedCounts: boolean;
  promotions: Promotion[];
  purchaseCostsByProduct: Record<string, number>;
}

const EMPTY_DAY: ClosingStockDayData = { rows: [], hasSavedCounts: false, promotions: [], purchaseCostsByProduct: {} };

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
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [error, setError] = useState('');
  const [invalidProductId, setInvalidProductId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
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

  const loadDay = useCallback(async (): Promise<ClosingStockDayData> => {
    if (!selectedClubId) return EMPTY_DAY;

    const supabase = createClient();
    const readOnlyDate = date < today;
    const canUseDraft = currentRole === 'owner' || (currentRole === 'admin' && !readOnlyDate);
    const draftMode = usesSoldEntry ? 'soldQuantity' : 'closingStock';

    const [{ data: day }, promotionsRes] = await Promise.all([
      loadClosingStockDay(supabase, {
        clubId: selectedClubId,
        date,
        today,
        isOwner: currentRole === 'owner',
        unknownProductName: tRef.current('unknownProduct'),
      }),
      fetchPromotions(supabase, selectedClubId),
    ]);
    if (!day) throw new Error('Closing stock day failed to load');

    const editableRows = buildEditableRows(
      day.products,
      day.counts,
      day.purchases,
      day.previousClosings,
      day.isCurrentDate,
    );
    return {
      rows: canUseDraft && day.draftEligible ? applyBrowserDraft(
        date,
        selectedClubId,
        editableRows,
        businessDayStartHour,
        draftMode,
      ) : editableRows,
      hasSavedCounts: day.hasSavedCounts,
      // Promotions only label giveaways; a failed read must not block counting.
      promotions: promotionsRes.data ?? [],
      purchaseCostsByProduct: calculatePurchaseCostsByProduct(day.purchases),
    };
  }, [buildEditableRows, businessDayStartHour, currentRole, date, selectedClubId, today, usesSoldEntry, tRef]);
  const dayQuery = useClubQuery(loadDay, EMPTY_DAY);
  const { loading, error: loadError } = dayQuery;
  const { hasSavedCounts, promotions, purchaseCostsByProduct } = dayQuery.data;

  // Each landed load replaces the editable rows. Inputs are hidden while a
  // full load runs and disabled while a silent one runs, so no unsaved edit
  // can be overwritten; a failed silent reload keeps the rows as they are.
  useEffect(() => {
    setRows(dayQuery.data.rows);
    setDirty(false);
    setInvalidProductId(null);
  }, [dayQuery.data]);

  // A full load (new date, club or role) starts from a clean slate.
  useEffect(() => {
    if (!loading) return;
    setDirty(false);
    setError('');
  }, [loading]);

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
    if (!selectedCategory) return;
    const categoryExists = rows.some((row) => productCategory(row.product.category) === selectedCategory);
    if (!categoryExists) setSelectedCategory('');
  }, [rows, selectedCategory]);

  async function reload({ silent = false } = {}) {
    if (silent) setRefreshing(true);
    try {
      await dayQuery.reload({ silent });
    } finally {
      if (silent) setRefreshing(false);
    }
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

  function updateGiveaway(productId: string, value: string) {
    if (!isWholeNumberInput(value)) return;
    editRow(productId, (row) => {
      const next = withGiveaway(row, value, usesSoldEntry);
      // One active promotion for this product: label the giveaway with it.
      const candidates = promotionsForProduct(promotions, productId, date);
      if (!next.promotionId && candidates.length === 1 && parseNum(value) > 0) {
        return { ...next, promotionId: candidates[0].id };
      }
      return next;
    });
  }

  function updatePromotion(productId: string, value: string) {
    editRow(productId, (row) => ({ ...row, promotionId: value || null }));
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

  const hasCategories = categoryOptions.length > 0;
  const [tableHeadRef, tableHeadHeight] = useElementHeight<HTMLTableSectionElement>();
  // Rows are numbered in the sectioned (category) order so numbers stay stable
  // while filtering.
  const rowNumberById = useMemo(() => {
    const ordered = hasCategories
      ? groupByCategory(rows, (row) => row.product.category).flatMap((section) => section.items)
      : rows;
    return new Map(ordered.map((row, index) => [row.product.id, index + 1]));
  }, [rows, hasCategories]);

  // With every category in view, the table reads as one section per category.
  const showSections = hasCategories && !selectedCategory;
  const rowSections = useMemo(
    () => (showSections
      ? groupByCategory(filteredRows, (row) => row.product.category)
      : [{ category: '', items: filteredRows }]),
    [showSections, filteredRows],
  );

  const bulkRows = useMemo(() => rows.filter((row) => !isReadOnlyClosingStockProduct(row.product)), [rows]);

  // Promotions active on the selected date, so staff see what to give away.
  const activePromotions = useMemo(
    () => promotions.filter((promotion) => promotionsForProduct([promotion], promotion.product_id, date).length > 0),
    [promotions, date],
  );
  const productNameById = useMemo(() => new Map(rows.map((row) => [row.product.id, row.product.name])), [rows]);

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
      void reload({ silent: true });
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
    { label: t('promoCost'), value: formatCurrency(totals.giveawayCost), unit: tc('currency'), tone: totals.giveawayCost > 0 ? 'danger' : 'default' },
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

      {activePromotions.length > 0 && !loading && !loadError && (
        <InlineAlert variant="info" title={t('activePromotionsTitle', { count: activePromotions.length })}>
          <ul className="mt-1 space-y-0.5">
            {activePromotions.map((promotion) => (
              <li key={promotion.id}>
                <span className="font-medium">{promotion.name}</span>
                {' · '}
                {t('activePromotionRule', {
                  quantity: formatNumber(promotion.free_quantity),
                  product: productNameById.get(promotion.product_id) ?? t('unknownProduct'),
                  spend: formatCurrency(promotion.min_spend),
                  currency: tc('currency'),
                })}
              </li>
            ))}
          </ul>
          <p className="mt-2">{t('activePromotionsHint')}</p>
        </InlineAlert>
      )}

      {loadError && !loading ? (
        <LoadErrorAlert onRetry={() => void reload()}>
          {t('loadFailed')}
        </LoadErrorAlert>
      ) : (
        <>
          {loading ? (
            <MetricGridSkeleton count={7} className="grid-cols-2 lg:grid-cols-7" />
          ) : (
            <Card as="section" padding="none" aria-busy={refreshing || undefined}>
              <div className="grid grid-cols-2 lg:grid-cols-7">
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
              <TableSkeleton rows={8} columns={10} className="rounded-none border-0 shadow-none" />
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
                  <thead ref={tableHeadRef}>
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
                      <th className={`${stickyHeaderCellClass} min-w-[150px] text-center`} title={t('giveawayHint')}>
                        {t('giveaway')}
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
                    {rowSections.map((section) => (
                      <Fragment key={section.category || '__uncategorized'}>
                      {showSections && (
                        <tr className="bg-gray-50">
                          <th
                            scope="colgroup"
                            colSpan={TABLE_COLUMN_COUNT}
                            style={{ top: stickyOffsetBelow(tableHeadHeight) }}
                            className="sticky z-[15] bg-gray-50 p-0 text-left shadow-[inset_0_1px_0_rgb(var(--c-gray-200)),inset_0_-1px_0_rgb(var(--c-gray-200))]"
                          >
                            <span className="sticky left-0 flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-900">
                              {section.category || tc('uncategorized')}
                              <span className="font-normal text-gray-500">{tc('productCount', { count: section.items.length })}</span>
                            </span>
                          </th>
                        </tr>
                      )}
                      {section.items.map((row) => {
                      const productId = row.product.id;
                      const rowReadOnly = !canSave || isReadOnlyClosingStockProduct(row.product);
                      const inputsDisabled = saving || refreshing;
                      const summary = rowSummary(row);
                      const tracksInventory = row.product.tracks_inventory !== false;
                      const rowFlagged = invalidProductId === productId;
                      const rowPromotions = promotionsForProduct(promotions, productId, date);
                      const giveawayQuantity = parseNum(row.giveawayQuantity);
                      const selectedPromotion = row.promotionId
                        ? promotions.find((promotion) => promotion.id === row.promotionId) ?? null
                        : null;
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
                                {rowPromotions.length > 0 && (
                                  <Badge variant="primary" size="sm" className="mt-1" icon={<Gift size={12} aria-hidden="true" />}>
                                    {rowPromotions.map((promotion) => promotion.name).join(', ')}
                                  </Badge>
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
                            {rowPromotions.length === 0 && giveawayQuantity === 0 ? (
                              <p className="text-center font-semibold text-gray-400">—</p>
                            ) : !rowReadOnly ? (
                              <div className="mx-auto w-32 space-y-2">
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  controlSize="sm"
                                  className="text-center text-base font-semibold sm:text-sm"
                                  value={row.giveawayQuantity ?? '0'}
                                  aria-label={`${t('giveaway')} · ${row.product.name}`}
                                  disabled={inputsDisabled}
                                  invalid={rowFlagged && giveawayQuantity > 0}
                                  onKeyDown={preventNonSignedIntegerNumberInput}
                                  onWheel={(event) => event.currentTarget.blur()}
                                  onChange={(event) => updateGiveaway(productId, event.target.value)}
                                />
                                {giveawayQuantity > 0 && rowPromotions.length > 0 && (
                                  <Select
                                    controlSize="sm"
                                    className="text-base sm:text-xs"
                                    value={row.promotionId ?? ''}
                                    aria-label={`${t('promotion')} · ${row.product.name}`}
                                    disabled={inputsDisabled}
                                    onChange={(event) => updatePromotion(productId, event.target.value)}
                                  >
                                    <option value="">{t('promotionUnspecified')}</option>
                                    {rowPromotions.map((promotion) => (
                                      <option key={promotion.id} value={promotion.id}>{promotion.name}</option>
                                    ))}
                                  </Select>
                                )}
                              </div>
                            ) : (
                              <div className="text-center">
                                <p className={`font-semibold ${giveawayQuantity > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                                  {giveawayQuantity > 0 ? formatNumber(giveawayQuantity) : '—'}
                                </p>
                                {selectedPromotion && giveawayQuantity > 0 && (
                                  <p className="mt-1 text-xs text-gray-500">{selectedPromotion.name}</p>
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
                      </Fragment>
                    ))}
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
                      <td className="px-4 py-4 text-center">{formatNumber(filteredTotals.giveaways)}</td>
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
