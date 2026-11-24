'use client';

// Route: /stock-purchase

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { announceActivity } from '@/lib/activityNotices';
import { runWithJwtTimingRetry } from '@/lib/supabase/authRetry';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardFooter,
  CardHeader,
  CurrencyInput,
  DataTable,
  DatePicker,
  DetailHero,
  DetailList,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  Money,
  PageHeader,
  SearchInput,
  SectionHeading,
  Select,
  StatTile,
  TableSkeleton,
  toneForAmount,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { canReadStockCounts } from '@/lib/permissions';
import { fetchBarProductSales } from '@/lib/supabase/barProductSales';
import {
  buildProductSalesSummary,
  buildPurchaseSuggestions,
  salesPeriodStart,
  type ProductSalesRow,
  type PurchaseSuggestion,
} from '@/lib/calculations/productSales';
import { fetchActiveProductsOrdered, fetchProductIdsByName } from '@/lib/supabase/products';
import { recordStockPurchase } from '@/lib/supabase/stockPurchases';
import {
  isInvalidPurchaseSalePrice,
  isPrefilledAmountEdited,
  prefillAmount,
  resolvePrefilledAmount,
  type PrefilledAmount,
} from '@/lib/productWrites';
import {
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  formatNumber,
  formatUnitCurrency,
  parseCurrencyInput,
  cleanQuantityInput,
} from '@/lib/formatters';
import {
  calculateWeightedAverageCost,
  isWholePositiveStockQuantity,
  resolveLowStockThreshold,
  stockLevel,
} from '@/lib/calculations/stock';
import { classifyStockWriteError, type StockWriteErrorLike } from '@/lib/stockWriteErrors';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Package,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import { closingStockHref } from '@/lib/detailLinks';
import {
  defaultPurchaseFilters,
  productNamesInCategory,
  purchaseCategories,
  purchaseDateBounds,
  purchaseFiltersFromParams,
  purchaseFiltersToParams,
  purchasePaymentMethods,
  purchaseProductIds,
  summarizePurchaseSpending,
  type PurchaseFilterProduct,
  type PurchaseHistoryFilters,
  type PurchaseSpendingRow,
} from '@/lib/calculations/purchaseHistory';
import { PurchaseHistoryFilterBar } from '@/components/stock-purchase/PurchaseHistoryFilters';
import { PurchaseSpendingSummary } from '@/components/stock-purchase/PurchaseSpendingSummary';
import { PAYMENT_METHODS, type EntryPaymentMethod, type Product, type StockPurchase } from '@/types';
import { scrollBehavior } from '@/lib/scroll';

const PURCHASES_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

interface PurchaseWithProduct extends StockPurchase {
  products: { name: string; sale_price?: number | null } | null;
}

function parseQuantity(value: string) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizePurchaseSearch(value: string) {
  return value.replace(/[,%()*.\\]/g, ' ').trim();
}

function paymentBadgeVariant(method: string): 'success' | 'primary' | 'purple' | 'neutral' {
  if (method === 'cash') return 'success';
  if (method === 'terminal') return 'primary';
  if (method === 'card') return 'purple';
  return 'neutral';
}

interface PurchasePage {
  /** The club these rows belong to; another club's rows are never shown. */
  clubId: string | null;
  rows: PurchaseWithProduct[];
  count: number;
}

const NO_PRODUCTS: Product[] = [];
const EMPTY_PURCHASE_PAGE: PurchasePage = { clubId: null, rows: [], count: 0 };
const NO_FILTER_PRODUCTS: PurchaseFilterProduct[] = [];

interface SpendingRows {
  clubId: string | null;
  rows: PurchaseSpendingRow[];
}
const EMPTY_SPENDING: SpendingRows = { clubId: null, rows: [] };

/** The filter calls both purchase queries apply; each returns the same builder. */
interface FilterablePurchaseRequest<Self> {
  gte(column: string, value: string): Self;
  lte(column: string, value: string): Self;
  in(column: string, values: readonly string[]): Self;
  or(filters: string): Self;
}

interface PurchaseScope {
  bounds: { from: string; to: string } | null;
  productIds: string[] | null;
  paymentMethods: string[] | null;
  /** The text search's `or` filter, or null when there is no search. */
  search: string | null;
}

function narrowPurchases<R extends FilterablePurchaseRequest<R>>(request: R, scope: PurchaseScope): R {
  let next = request;
  if (scope.bounds) next = next.gte('date', scope.bounds.from).lte('date', scope.bounds.to);
  if (scope.productIds) next = next.in('product_id', scope.productIds);
  if (scope.paymentMethods) next = next.in('payment_method', scope.paymentMethods);
  if (scope.search) next = next.or(scope.search);
  return next;
}

interface PurchaseForm {
  date: string;
  product_id: string;
  quantity: string;
  cost_price: string;
  sale_price: string;
  payment_method: EntryPaymentMethod;
  comment: string;
  /** Catalog prices copied in on product selection; untouched means "keep". */
  cost_prefill: PrefilledAmount | null;
  sale_prefill: PrefilledAmount | null;
}

const emptyItemFields = {
  product_id: '',
  quantity: '',
  cost_price: '',
  sale_price: '',
  comment: '',
  cost_prefill: null,
  sale_prefill: null,
} satisfies Partial<PurchaseForm>;

/** Suggestions are sized from the sales of this many days ending today, to cover the next week. */
const SUGGESTION_SALES_DAYS = 30;
const NO_SALES: ProductSalesRow[] = [];

export default function StockPurchasePage() {
  const sectionTabs = useSectionTabs('bar');
  const t = useTranslations('stockPurchase');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods, role, featureAccess } = useClub();
  const canWrite = role === 'owner' || role === 'admin';
  const { locale } = useAppLocale();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const businessToday = useBusinessToday(businessDayStartHour);
  // An untouched form date follows the business day across midnight; a date
  // the user picked is never replaced.
  const dateTouched = useRef(false);
  // `?product=<id>&quantity=<n>` (from the dashboard's running-low list) opens the form on that product.
  const searchParams = useSearchParams();
  const linkedProduct = useRef<{ id: string; quantity: string } | null>(
    searchParams.get('product') ? { id: searchParams.get('product') ?? '', quantity: searchParams.get('quantity') ?? '' } : null,
  );
  // Client id reused across retries of one submit, so a save whose response was
  // lost is recorded once. Cleared on edit and on success.
  const purchaseRequestId = useRef<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseWithProduct | null>(null);
  const [formError, setFormError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [purchasePage, setPurchasePage] = useState(1);
  const pathname = usePathname();
  // History filters live in the URL so a reload or a shared link keeps them.
  const [historyFilters, setHistoryFilters] = useState<PurchaseHistoryFilters>(
    () => purchaseFiltersFromParams(searchParams, businessToday, enabledPaymentMethods),
  );

  const [form, setForm] = useState<PurchaseForm>(() => ({
    date: businessToday,
    ...emptyItemFields,
    payment_method: defaultPaymentMethod(enabledPaymentMethods),
  }));

  // Edited values are a different purchase, not a retry of the last attempt.
  useEffect(() => { purchaseRequestId.current = null; }, [form]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = query.trim();
      if (next === debouncedQuery) return;
      // Change the query and page together so a search from page 2+ fetches once.
      setDebouncedQuery(next);
      setPurchasePage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [debouncedQuery, query]);

  const fetchProducts = useCallback(async (): Promise<Product[]> => {
    if (!selectedClubId) return NO_PRODUCTS;
    const supabase = createClient();
    const productsRes = await runWithJwtTimingRetry(
      supabase,
      async () => fetchActiveProductsOrdered(supabase, selectedClubId, { tracksInventoryOnly: true }),
    );
    if (productsRes.error) throw new Error(productsRes.error.message);
    return productsRes.data ?? [];
  }, [selectedClubId]);
  // A slower response for a previously selected club must never replace (or
  // be selected in) the current club's product list.
  const productsQuery = useClubQuery(fetchProducts, NO_PRODUCTS);
  const { loading: productsLoading, error: productsError, reload: loadProducts } = productsQuery;
  // A full load starts from an empty list; a silent reload keeps the current one.
  const products = productsLoading ? NO_PRODUCTS : productsQuery.data;

  // Every product the club ever had, archived ones included: old purchases
  // still point at them, and the category filter needs their categories.
  const fetchFilterProducts = useCallback(async (): Promise<PurchaseFilterProduct[]> => {
    if (!selectedClubId) return NO_FILTER_PRODUCTS;
    const supabase = createClient();
    const result = await runWithJwtTimingRetry(supabase, async () => fetchAllRows<PurchaseFilterProduct>(() => supabase
      .from('products')
      .select('id, name, category')
      .eq('club_id', selectedClubId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })));
    if (result.error) throw new Error(result.error.message);
    return result.data ?? NO_FILTER_PRODUCTS;
  }, [selectedClubId]);
  const filterProductsQuery = useClubQuery(fetchFilterProducts, NO_FILTER_PRODUCTS);
  const filterProducts = filterProductsQuery.loading ? NO_FILTER_PRODUCTS : filterProductsQuery.data;
  const filterCategories = useMemo(() => purchaseCategories(filterProducts), [filterProducts]);
  const filterProductNames = useMemo(
    () => productNamesInCategory(filterProducts, historyFilters.category),
    [filterProducts, historyFilters.category],
  );
  // Category and product filters resolve to ids once the catalog is in.
  const needsFilterProducts = Boolean(historyFilters.category || historyFilters.product);
  const waitingForFilterProducts = needsFilterProducts && filterProductsQuery.loading;
  const filterProductsFailed = needsFilterProducts && filterProductsQuery.error;
  const { period, day, month, from: rangeFrom, to: rangeTo, category, product, paymentMethod } = historyFilters;
  const purchaseScope = useMemo(() => {
    const filters = { period, day, month, from: rangeFrom, to: rangeTo, category, product, paymentMethod };
    return {
      bounds: purchaseDateBounds(filters),
      productIds: purchaseProductIds(filterProducts, filters),
      paymentMethods: purchasePaymentMethods(filters),
    };
  }, [category, day, filterProducts, month, paymentMethod, period, product, rangeFrom, rangeTo]);

  /** The text search as an `or` filter; `none` when it can match nothing. */
  const resolveSearch = useCallback(async (
    supabase: ReturnType<typeof createClient>,
    clubId: string,
    isCurrent: () => boolean,
  ): Promise<{ search: string | null; none: boolean }> => {
    if (!debouncedQuery) return { search: null, none: false };
    const paymentSearch = sanitizePurchaseSearch(debouncedQuery);
    // Match the purchase's product by name across the whole club catalog,
    // including inactive and archived products that still have receipts.
    const matches = await runWithJwtTimingRetry(
      supabase,
      async () => fetchProductIdsByName(supabase, clubId, debouncedQuery),
    );
    if (matches.error) throw new Error(matches.error.message);
    if (!isCurrent()) return { search: null, none: true };
    const filters: string[] = [];
    // payment_method holds one of three known values: match them in memory
    // instead of an ilike the database cannot index.
    const paymentMethods = paymentSearch
      ? PAYMENT_METHODS.filter((method) => method.includes(paymentSearch.toLowerCase()))
      : [];
    if (paymentMethods.length) filters.push(`payment_method.in.(${paymentMethods.join(',')})`);
    if (matches.data.length) filters.push(`product_id.in.(${matches.data.join(',')})`);
    // A query that matches no product and sanitises to no payment text (for
    // example "%") lists nothing rather than the whole club.
    return filters.length ? { search: filters.join(','), none: false } : { search: null, none: true };
  }, [debouncedQuery]);

  const fetchSpending = useCallback(async (isCurrent: () => boolean): Promise<SpendingRows> => {
    if (!selectedClubId) return EMPTY_SPENDING;
    if (purchaseScope.productIds?.length === 0) return { clubId: selectedClubId, rows: [] };
    const supabase = createClient();
    const { search, none } = await resolveSearch(supabase, selectedClubId, isCurrent);
    if (none) return { clubId: selectedClubId, rows: [] };
    // Every matching row, past Supabase's 1,000-row cap, so the totals are whole.
    const result = await runWithJwtTimingRetry(supabase, async () => fetchAllRows<PurchaseSpendingRow>(() => narrowPurchases(
      supabase.from('stock_purchases').select('date, quantity, cost_price').eq('club_id', selectedClubId),
      { ...purchaseScope, search },
    ).order('date', { ascending: false }).order('id', { ascending: false })));
    if (result.error) throw new Error(result.error.message);
    return { clubId: selectedClubId, rows: result.data ?? [] };
  }, [purchaseScope, resolveSearch, selectedClubId]);
  const spendingQuery = useClubQuery(waitingForFilterProducts ? null : fetchSpending, EMPTY_SPENDING);
  const spendingRows = spendingQuery.data.clubId === selectedClubId ? spendingQuery.data.rows : EMPTY_SPENDING.rows;
  const spending = useMemo(() => summarizePurchaseSpending(spendingRows), [spendingRows]);

  const fetchPurchases = useCallback(async (isCurrent: () => boolean): Promise<PurchasePage> => {
    if (!selectedClubId) return EMPTY_PURCHASE_PAGE;
    const from = (purchasePage - 1) * PURCHASES_PAGE_SIZE;
    const to = from + PURCHASES_PAGE_SIZE - 1;
    if (purchaseScope.productIds?.length === 0) return { clubId: selectedClubId, rows: [], count: 0 };
    const supabase = createClient();
    const { search, none } = await resolveSearch(supabase, selectedClubId, isCurrent);
    if (none) return { clubId: selectedClubId, rows: [], count: 0 };

    const { data, error, count } = await runWithJwtTimingRetry(
      supabase,
      async () => narrowPurchases(
        supabase
          .from('stock_purchases')
          .select('*, products(name, sale_price)', { count: 'exact' })
          .eq('club_id', selectedClubId),
        { ...purchaseScope, search },
      )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    if (error) throw new Error(error.message);
    return { clubId: selectedClubId, rows: (data as PurchaseWithProduct[]) ?? [], count: count ?? 0 };
  }, [purchasePage, purchaseScope, resolveSearch, selectedClubId]);
  const purchasesQuery = useClubQuery(waitingForFilterProducts ? null : fetchPurchases, EMPTY_PURCHASE_PAGE);
  // A club switch clears the list at once; paging keeps the old rows dimmed.
  const { rows: purchases, count: purchaseCount } = purchasesQuery.data.clubId === selectedClubId ? purchasesQuery.data : EMPTY_PURCHASE_PAGE;
  const purchasesLoading = purchasesQuery.loading || waitingForFilterProducts;
  const purchasesError = purchasesQuery.error || filterProductsFailed;
  const { reload: reloadPurchaseRows } = purchasesQuery;
  const { reload: reloadFilterProducts } = filterProductsQuery;
  const loadPurchases = useCallback(async () => {
    if (filterProductsFailed) await reloadFilterProducts();
    else await reloadPurchaseRows();
  }, [filterProductsFailed, reloadFilterProducts, reloadPurchaseRows]);

  function changeHistoryFilters(next: PurchaseHistoryFilters) {
    // Change the filters and page together so a filter from page 2+ fetches once.
    setHistoryFilters(next);
    setPurchasePage(1);
  }

  // Mirror the filters into the URL without a navigation; other parameters stay.
  useEffect(() => {
    const current = window.location.search.replace(/^\?/, '');
    const next = purchaseFiltersToParams(historyFilters, current).toString();
    if (next !== current) window.history.replaceState(null, '', next ? `${pathname}?${next}` : pathname);
  }, [historyFilters, pathname]);

  // A different club has different products: never carry a product, prices or
  // comment from the previous club into this form.
  // Category and product filters name the previous club's catalog too; the
  // first run keeps the ones a link or reload brought in.
  const filtersClubId = useRef(selectedClubId);
  useEffect(() => {
    setPurchasePage(1);
    setFormError('');
    dateTouched.current = false;
    setForm((prev) => ({ ...prev, ...emptyItemFields }));
    if (filtersClubId.current !== selectedClubId) {
      if (filtersClubId.current) setHistoryFilters((prev) => ({ ...prev, category: '', product: '' }));
      filtersClubId.current = selectedClubId;
    }
  }, [selectedClubId]);

  useEffect(() => {
    if (dateTouched.current) return;
    setForm((prev) => (prev.date === businessToday ? prev : { ...prev, date: businessToday }));
  }, [businessToday, selectedClubId]);

  useEffect(() => {
    setForm((prev) => (enabledPaymentMethods.some((method) => method === prev.payment_method)
      ? prev
      : { ...prev, payment_method: defaultPaymentMethod(enabledPaymentMethods) }));
  }, [enabledPaymentMethods]);

  // What to buy: only for someone who records purchases and may read the counts
  // the pace comes from. A failed sales read just leaves the suggestions out.
  const canSuggest = canWrite && canReadStockCounts(role, featureAccess);
  const loadSales = useCallback(async (): Promise<ProductSalesRow[]> => (
    fetchBarProductSales(createClient(), selectedClubId, salesPeriodStart(businessToday, SUGGESTION_SALES_DAYS), businessToday)
  ), [selectedClubId, businessToday]);
  const salesQuery = useClubQuery(selectedClubId && canSuggest ? loadSales : null, NO_SALES);
  const salesSummary = useMemo(
    () => (salesQuery.error || salesQuery.loading ? null : buildProductSalesSummary(products, salesQuery.data)),
    [products, salesQuery.data, salesQuery.error, salesQuery.loading],
  );
  const suggestions = useMemo(() => buildPurchaseSuggestions(products, salesSummary), [products, salesSummary]);

  const selectedProduct = products.find((product) => product.id === form.product_id) ?? null;
  const selectedInsight = selectedProduct ? salesSummary?.byProduct.get(selectedProduct.id) : undefined;
  const quantity = parseQuantity(form.quantity);
  const costPrice = resolvePrefilledAmount(form.cost_price, form.cost_prefill);
  const salePrice = form.sale_price
    ? resolvePrefilledAmount(form.sale_price, form.sale_prefill)
    : selectedProduct?.sale_price ?? 0;
  // Send a sale price only when the user changed it: the purchase trigger
  // copies a non-null price onto the catalog and would otherwise overwrite a
  // newer catalog price with this page's stale copy.
  const requestedSalePrice = form.sale_price && isPrefilledAmountEdited(form.sale_price, form.sale_prefill)
    ? parseCurrencyInput(form.sale_price)
    : null;
  const totalCost = quantity * costPrice;
  const totalSaleValue = quantity * salePrice;
  const estimatedProfit = quantity * (salePrice - costPrice);
  const savedSalePrice = selectedProduct?.sale_price ?? 0;
  const salePriceChanged = !!selectedProduct && salePrice !== savedSalePrice;
  const projectedAverageCost = selectedProduct
    ? calculateWeightedAverageCost({
        currentStock: selectedProduct.current_stock,
        currentCostPrice: selectedProduct.cost_price,
        purchasedQuantity: quantity,
        purchaseCostPrice: costPrice,
      })
    : 0;

  const selectedProductLevel = selectedProduct
    ? stockLevel(selectedProduct.current_stock, selectedProduct.low_stock_threshold)
    : null;
  const formDisabled = !canWrite;
  const noTrackedProducts = !productsLoading && !productsError && products.length === 0;

  const purchasePageCount = Math.max(1, Math.ceil(purchaseCount / PURCHASES_PAGE_SIZE));
  const purchaseRangeFrom = purchaseCount === 0 ? 0 : (purchasePage - 1) * PURCHASES_PAGE_SIZE + 1;
  const purchaseRangeTo = Math.min(purchasePage * PURCHASES_PAGE_SIZE, purchaseCount);
  const currency = tc('currency');

  function set<K extends keyof PurchaseForm>(field: K, value: PurchaseForm[K]) {
    if (field === 'date') dateTouched.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError('');
  }

  function writeErrorMessage(writeError: StockWriteErrorLike, fallback: string) {
    switch (classifyStockWriteError(writeError)) {
      case 'permission':
      case 'adminPastDate':
      case 'adjustmentOwnerOnly':
        return t('errorPermission');
      case 'futureDate': return t('errorFutureDate');
      case 'productUnavailable': return t('errorProductUnavailable');
      case 'notFound': return t('errorNotFound');
      case 'insufficientStock': return t('errorInsufficientStock');
      case 'invalid':
      case 'laterCountInvalid':
        return t('errorInvalid');
      default: return fallback;
    }
  }

  /** Clears the item fields after a save but keeps the date and payment method. */
  function clearItemFields() {
    setForm((prev) => ({ ...prev, ...emptyItemFields }));
    setFormError('');
  }

  function resetForm() {
    dateTouched.current = false;
    setForm({
      date: businessToday,
      ...emptyItemFields,
      payment_method: defaultPaymentMethod(enabledPaymentMethods),
    });
    setFormError('');
  }

  function selectProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    setFormError('');
    setForm((prev) => {
      if (!product) return { ...prev, product_id: productId };
      // Fractional weighted-average costs are shown exactly and, while left
      // untouched, submitted exactly instead of as rounded whole sums.
      const costPrefill = prefillAmount(product.cost_price);
      const salePrefill = prefillAmount(product.sale_price);
      return {
        ...prev,
        product_id: productId,
        cost_price: costPrefill?.input ?? '',
        sale_price: salePrefill?.input ?? '',
        cost_prefill: costPrefill,
        sale_prefill: salePrefill,
      };
    });
  }

  /** Puts a suggested product and its quantity into the form; prices come from the product as usual. */
  function applySuggestion(item: PurchaseSuggestion) {
    selectProduct(item.id);
    setForm((prev) => ({ ...prev, quantity: String(item.shortfall) }));
    document.getElementById('stock-purchase-form')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  useEffect(() => {
    const linked = linkedProduct.current;
    if (!linked || !canWrite || !products.some((product) => product.id === linked.id)) return;
    linkedProduct.current = null;
    selectProduct(linked.id);
    if (/^\d+$/.test(linked.quantity) && Number(linked.quantity) > 0) {
      setForm((prev) => ({ ...prev, quantity: linked.quantity }));
    }
    document.getElementById('stock-purchase-form')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    // selectProduct reads the current products; it runs once, when they first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, canWrite]);

  async function reloadAfterMutation(nextPage: number) {
    // Independent reads: run them together instead of one after the other.
    const spendingReload = spendingQuery.reload({ silent: true });
    if (nextPage === purchasePage) {
      await Promise.all([loadProducts({ silent: true }), loadPurchases(), spendingReload]);
    } else {
      setPurchasePage(nextPage);
      await Promise.all([loadProducts({ silent: true }), spendingReload]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    if (!selectedClubId || !form.product_id || !form.quantity || !form.cost_price) {
      setFormError(tc('required'));
      return;
    }

    if (!isWholePositiveStockQuantity(quantity)) {
      setFormError(t('quantityWholePositive'));
      return;
    }

    if (isInvalidPurchaseSalePrice(requestedSalePrice)) {
      setFormError(t('salePricePositive'));
      return;
    }

    setSaving(true);
    setFormError('');

    const supabase = createClient();
    let err: StockWriteErrorLike | null = null;
    try {
      const result = await recordStockPurchase(supabase, {
        requestId: (purchaseRequestId.current ??= crypto.randomUUID()),
        clubId: selectedClubId,
        date: form.date,
        productId: form.product_id,
        quantity,
        costPrice,
        salePrice: requestedSalePrice,
        paymentMethod: form.payment_method,
        comment: form.comment.trim() || null,
      });
      err = result.error;
    } catch {
      err = { message: 'network' };
    }

    setSaving(false);

    if (err) {
      setFormError(err.code === '55000' ? t('purchaseBlockedByClosing') : writeErrorMessage(err, t('saveFailed')));
      if (classifyStockWriteError(err) === 'productUnavailable') void loadProducts({ silent: true });
      return;
    }

    announceActivity(selectedClubId);
    purchaseRequestId.current = null;
    clearItemFields();
    showToast(t('success'));
    await reloadAfterMutation(1);
  }

  async function handleDeletePurchase(purchase: PurchaseWithProduct) {
    if (!selectedClubId || !canWrite) return;
    const confirmed = await confirm({
      title: tc('delete'),
      description: t('deleteConfirmDetailed', {
        product: purchase.products?.name ?? '—',
        quantity: formatNumber(purchase.quantity),
        date: formatDateOnly(purchase.date, locale),
      }),
      confirmLabel: tc('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;

    setDeletingId(purchase.id);

    const supabase = createClient();
    let deleteError: StockWriteErrorLike | null = null;
    try {
      const result = await supabase.rpc('delete_stock_purchase', {
        p_club_id: selectedClubId,
        p_purchase_id: purchase.id,
      });
      deleteError = result.error;
    } catch {
      deleteError = { message: 'network' };
    }

    setDeletingId(null);

    if (deleteError) {
      showToast(deleteError.code === '55000' ? t('deleteBlockedByClosing') : writeErrorMessage(deleteError, t('deleteFailed')), 'error');
      if (classifyStockWriteError(deleteError) === 'notFound') await reloadAfterMutation(purchasePage);
      return;
    }

    announceActivity(selectedClubId);
    showToast(t('deleteSuccess'));
    const nextPage = purchases.length === 1 && purchasePage > 1 ? purchasePage - 1 : purchasePage;
    await reloadAfterMutation(nextPage);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        tabs={sectionTabs}
      />

      {!canWrite && (
        <InlineAlert variant="info" title={t('viewerReadOnlyTitle')}>{t('viewerReadOnlyBody')}</InlineAlert>
      )}

      {productsError && (
        <LoadErrorAlert retrying={productsLoading} onRetry={() => void loadProducts()}>
          {t('productsLoadFailed')}
        </LoadErrorAlert>
      )}

      {noTrackedProducts && (
        <Card>
          <EmptyState
            icon={Package}
            title={t('noTrackedProductsTitle')}
            description={t('noTrackedProductsBody')}
            action={<ButtonLink href="/products" variant="primary">{t('goToProducts')}</ButtonLink>}
          />
        </Card>
      )}

      {/* With no tracked product there is nothing to buy: the empty state above stands in for the form. */}
      {!noTrackedProducts && (
      <div className={selectedProduct ? 'grid gap-5 2xl:grid-cols-[minmax(0,1fr)_480px]' : 'grid gap-5'}>
        <Card as="form" id="stock-purchase-form" onSubmit={handleSubmit}>
          <SectionHeading title={t('addStockPurchase')} className="mb-5" />

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('date')} required>
              <DatePicker ariaLabel={t('date')} value={form.date} max={businessToday} disabled={formDisabled} onChange={(value) => set('date', value)} />
            </Field>

            <Field label={t('product')} htmlFor="purchase-product" required>
              <Select
                id="purchase-product"
                className="font-semibold"
                value={form.product_id}
                onChange={(event) => selectProduct(event.target.value)}
                disabled={formDisabled || productsLoading}
                required
              >
                <option value="">{productsLoading ? tc('loading') : t('selectProduct')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </Select>
            </Field>

            <Field label={t('quantity')} htmlFor="purchase-quantity" required>
              <Input
                id="purchase-quantity"
                type="text"
                inputMode="numeric"
                className="font-semibold"
                trailingAddon={t('pcs')}
                value={form.quantity}
                disabled={formDisabled}
                onChange={(event) => set('quantity', cleanQuantityInput(event.target.value))}
                required
              />
            </Field>

            <Field label={`${t('costPrice')} (${t('perPcs')})`} htmlFor="purchase-cost" required>
              <CurrencyInput
                id="purchase-cost"
                className="font-semibold"
                trailingAddon={currency}
                value={form.cost_price}
                disabled={formDisabled}
                onValueChange={(value) => set('cost_price', value)}
                required
              />
            </Field>

            <Field label={`${t('salePrice')} (${t('perPcs')})`} htmlFor="purchase-sale" hint={salePriceChanged ? `${t('currentSavedPrice')} ${formatCurrency(savedSalePrice)} ${currency}` : undefined}>
              <CurrencyInput
                id="purchase-sale"
                className="font-semibold"
                trailingAddon={currency}
                value={form.sale_price}
                disabled={formDisabled}
                onValueChange={(value) => set('sale_price', value)}
              />
            </Field>

            <Field label={t('paymentMethod')} htmlFor="purchase-payment" required>
              <Select
                id="purchase-payment"
                className="font-semibold"
                value={form.payment_method}
                disabled={formDisabled}
                onChange={(event) => set('payment_method', event.target.value as EntryPaymentMethod)}
              >
                {enabledPaymentMethods.map((method) => (
                  <option key={method} value={method}>{tc(`paymentMethods.${method}`)}</option>
                ))}
              </Select>
            </Field>

            <Field label={t('comment')} htmlFor="purchase-comment" className="md:col-span-2">
              <Input
                id="purchase-comment"
                type="text"
                maxLength={250}
                placeholder={t('commentPlaceholder')}
                value={form.comment}
                disabled={formDisabled}
                onChange={(event) => set('comment', event.target.value)}
              />
            </Field>
          </div>

          <Card tone="muted" padding="sm" className="mt-5">
            <p className="text-xs font-medium text-gray-500">{t('purchaseSummary')}</p>
            <div className="mt-2 grid grid-cols-1 divide-y divide-gray-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <StatTile variant="flat" size="sm" className="py-2 sm:pr-4 sm:py-0" label={t('totalCost')} value={formatCurrency(totalCost)} unit={currency} />
              <StatTile variant="flat" size="sm" className="py-2 sm:px-4 sm:py-0" label={t('totalSaleValue')} value={formatCurrency(totalSaleValue)} unit={currency} />
              <StatTile variant="flat" size="sm" className="py-2 sm:px-4 sm:py-0" label={t('estimatedProfit')} value={formatCurrency(estimatedProfit)} unit={currency} tone={toneForAmount(estimatedProfit)} />
            </div>
            {selectedProduct && quantity > 0 && costPrice > 0 && (
              <p className="mt-3 text-sm text-gray-600">
                {t('newAverageBuyPrice')} <span className="font-semibold tabular-nums text-gray-900">{formatUnitCurrency(projectedAverageCost)} {currency}</span>
              </p>
            )}
          </Card>

          {formError && <InlineAlert variant="danger" className="mt-3">{formError}</InlineAlert>}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={resetForm} disabled={saving || formDisabled}>
              {t('reset')}
            </Button>
            <Button type="submit" loading={saving} loadingLabel={tc('saving')} disabled={formDisabled} icon={<Check size={17} aria-hidden="true" />}>
              {t('submit')}
            </Button>
          </div>

          <Disclosure summary={t('howItWorks')} className="-ml-3 mt-4 text-sm">
            <ul className="mt-2 space-y-1 pl-8 text-gray-600">
              {[t('hintStock'), t('hintClosing'), t('hintProfit')].map((hint) => (
                <li key={hint} className="list-disc">{hint}</li>
              ))}
            </ul>
          </Disclosure>
        </Card>

        {selectedProduct && (
          <Card as="aside">
            <SectionHeading
              title={t('productInfo')}
              badge={selectedProductLevel === 'out'
                ? <Badge variant="danger">{t('outOfStock')}</Badge>
                : selectedProductLevel === 'low'
                  ? <Badge variant="warning">{t('lowStock')}</Badge>
                  : selectedProductLevel === 'ok'
                    ? <Badge variant="success">{t('inStock')}</Badge>
                    : undefined}
              className="mb-5"
            />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar name={selectedProduct.name} size="lg" tone="neutral" />
              <div className="min-w-0">
                <p className="break-words text-xl font-bold tracking-tight text-gray-950">{selectedProduct.name}</p>
                <p className="mt-2 text-sm text-gray-600">
                  {t('salePriceLabel')} <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(salePrice)} {currency}</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {t('costPriceLabel')} <span className="font-semibold tabular-nums text-gray-900">{formatUnitCurrency(selectedProduct.cost_price)} {currency}</span>
                </p>
                {quantity > 0 && costPrice > 0 && (
                  <p className="mt-1 text-sm text-gray-600">
                    {t('newAvgCost')} <span className="font-semibold tabular-nums text-gray-900">{formatUnitCurrency(projectedAverageCost)} {currency}</span>
                  </p>
                )}
              </div>
            </div>

            <Card tone="muted" padding="sm" className="mt-5">
              <div className="grid grid-cols-2 gap-3">
                <StatTile variant="flat" size="sm" label={t('currentStock')} value={formatNumber(selectedProduct.current_stock)} unit={t('pcs')} tone={selectedProductLevel === 'out' ? 'danger' : selectedProductLevel === 'low' ? 'warning' : 'default'} />
                <StatTile variant="flat" size="sm" label={t('lowStockAlert')} value={formatNumber(resolveLowStockThreshold(selectedProduct.low_stock_threshold))} unit={t('pcs')} />
                <StatTile variant="flat" size="sm" label={t('stockValue')} value={formatCurrency(selectedProduct.current_stock * selectedProduct.cost_price)} unit={currency} className="col-span-2 border-t border-gray-200 pt-3" />
                {selectedInsight && (
                  <>
                    <StatTile variant="flat" size="sm" label={t('soldRecently', { days: SUGGESTION_SALES_DAYS })} value={formatNumber(selectedInsight.sold)} unit={t('pcs')} className="border-t border-gray-200 pt-3" />
                    <StatTile variant="flat" size="sm" label={t('stockLasts')} value={selectedInsight.daysLeft === null || selectedProduct.current_stock <= 0 ? '—' : t('daysCount', { count: selectedInsight.daysLeft })} className="border-t border-gray-200 pt-3" />
                  </>
                )}
              </div>
            </Card>
          </Card>
        )}
      </div>
      )}

      {/* Below the form: it arrives after the sales load and must not push the form down. */}
      {suggestions.items.length > 0 && (
        <Card as="section" padding="none" className="overflow-hidden" aria-label={t('suggestTitle')}>
          <CardHeader>
            <SectionHeading
              size="sm"
              title={t('suggestTitle')}
              badge={<Badge variant="neutral" size="sm">{suggestions.items.length + suggestions.more}</Badge>}
              description={t('suggestDesc', { days: SUGGESTION_SALES_DAYS })}
            />
          </CardHeader>
          <ul className="divide-y divide-gray-100">
            {suggestions.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold text-gray-900">{item.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {item.currentStock > 0 ? t('suggestLeft', { count: formatNumber(item.currentStock) }) : t('outOfStock')}
                    {' · '}
                    {t('suggestSold', { count: formatNumber(item.sold ?? 0), days: SUGGESTION_SALES_DAYS })}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <p className="text-sm tabular-nums text-gray-600">≈ {formatCurrency(item.cost)} {currency}</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => applySuggestion(item)} disabled={saving}>
                    {t('suggestBuy', { count: formatNumber(item.shortfall) })}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <CardFooter className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
            <span>{suggestions.more > 0 ? t('suggestMore', { count: suggestions.more }) : ''}</span>
            <span>{t('suggestTotal')}: <span className="font-semibold tabular-nums text-gray-900">≈ {formatCurrency(suggestions.totalCost)} {currency}</span></span>
          </CardFooter>
        </Card>
      )}

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader>
          <SectionHeading
            title={t('recentPurchases')}
            action={(
              <SearchInput
                className="w-full sm:w-72"
                controlSize="sm"
                value={query}
                onChange={setQuery}
                placeholder={t('searchPlaceholder')}
              />
            )}
          />
        </CardHeader>

        <PurchaseHistoryFilterBar
          filters={historyFilters}
          onChange={changeHistoryFilters}
          onClear={() => changeHistoryFilters(defaultPurchaseFilters(businessToday))}
          categories={filterCategories}
          productNames={filterProductNames}
          productsLoading={filterProductsQuery.loading}
          paymentMethods={enabledPaymentMethods}
          businessToday={businessToday}
        />

        <PurchaseSpendingSummary
          summary={spending}
          loading={spendingQuery.loading || waitingForFilterProducts}
          error={spendingQuery.error && !filterProductsFailed}
          onRetry={() => void spendingQuery.reload()}
          defaultGrouping={historyFilters.period === 'all' ? 'month' : 'day'}
        />

        {purchasesError && (
          <LoadErrorAlert className="mx-4 mt-4 sm:mx-5" retrying={purchasesLoading} onRetry={() => void loadPurchases()}>
            {t('purchasesLoadFailed')}
          </LoadErrorAlert>
        )}

        {purchasesLoading && purchases.length === 0 ? (
          <TableSkeleton bare rows={6} columns={8} />
        ) : purchasesError && purchases.length === 0 ? null : (
          <DataTable
            mobileCards
            bare
            label={t('recentPurchases')}
            keyExtractor={(row) => row.id}
            onRowClick={setSelectedPurchase}
            data={purchases}
            minWidth={980}
            busy={purchasesLoading}
            emptyState={<EmptyState compact icon={ShoppingCart} title={t('historyEmptyTitle')} description={t('historyEmptyBody')} />}
            columns={[
              { key: 'index', header: '#', className: 'w-12', mobile: 'hidden', render: (_row, index) => <span className="text-gray-500 tabular-nums">{(purchasePage - 1) * PURCHASES_PAGE_SIZE + index + 1}</span> },
              { key: 'date', header: t('date'), mobile: 'title', render: (row) => <span className="font-medium text-gray-900">{formatDateOnly(row.date, locale)}</span> },
              {
                key: 'product',
                header: t('product'),
                render: (row) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={row.products?.name ?? '-'} size="sm" tone="neutral" />
                    <span className="font-semibold text-gray-900">{row.products?.name ?? '—'}</span>
                  </div>
                ),
              },
              { key: 'quantity', header: t('quantity'), align: 'right', render: (row) => <span className="tabular-nums">{formatNumber(row.quantity)} <span className="text-xs text-gray-500">{t('pcs')}</span></span> },
              { key: 'cost', header: `${t('costPrice')} (${t('perPcs')})`, align: 'right', render: (row) => <span className="tabular-nums">{formatUnitCurrency(row.cost_price)}</span> },
              { key: 'sale', header: `${t('salePrice')} (${t('perPcs')})`, align: 'right', render: (row) => <span className="tabular-nums">{formatCurrency(row.sale_price ?? row.products?.sale_price ?? 0)}</span> },
              { key: 'total', header: `${t('totalCostHeader')} (${currency})`, align: 'right', render: (row) => <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(row.quantity * row.cost_price)}</span> },
              {
                key: 'payment',
                header: t('payment'),
                align: 'center',
                render: (row) => (
                  <Badge variant={paymentBadgeVariant(row.payment_method)} icon={<CreditCard size={13} aria-hidden="true" />}>
                    {tc.has(`paymentMethods.${row.payment_method}`) ? tc(`paymentMethods.${row.payment_method}` as Parameters<typeof tc>[0]) : row.payment_method}
                  </Badge>
                ),
              },
              ...(canWrite ? [{
                key: 'actions',
                header: <span className="sr-only">{tc('actions')}</span>,
                align: 'right' as const,
                render: (row: PurchaseWithProduct) => (
                  <IconButton
                    size="sm"
                    variant="danger"
                    label={`${tc('delete')} · ${row.products?.name ?? ''}`}
                    icon={<Trash2 size={16} />}
                    loading={deletingId === row.id}
                    disabled={Boolean(deletingId)}
                    onClick={() => handleDeletePurchase(row)}
                  />
                ),
              }] : []),
            ]}
          />
        )}

        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500" role="status">
            {purchasesLoading ? tc('loading') : t('paginationShowing', { from: purchaseRangeFrom, to: purchaseRangeTo, total: purchaseCount })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={purchasePage <= 1 || purchasesLoading}
              onClick={() => setPurchasePage((page) => Math.max(1, page - 1))}
              icon={<ChevronLeft size={16} aria-hidden="true" />}
            >
              {t('previousPage')}
            </Button>
            <span className="min-w-20 text-center text-sm font-medium text-gray-700 tabular-nums">
              {t('paginationPage', { page: purchasePage, total: purchasePageCount })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={purchasePage >= purchasePageCount || purchasesLoading}
              onClick={() => setPurchasePage((page) => Math.min(purchasePageCount, page + 1))}
              iconRight={<ChevronRight size={16} aria-hidden="true" />}
            >
              {t('nextPage')}
            </Button>
          </div>
        </CardFooter>
      </Card>

      {toastElement}
      <Modal open={Boolean(selectedPurchase)} onClose={() => setSelectedPurchase(null)} title={t('purchaseDetails')}
        footer={selectedPurchase ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {canWrite ? (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                loading={deletingId === selectedPurchase.id}
                disabled={Boolean(deletingId)}
                onClick={() => {
                  const row = selectedPurchase;
                  setSelectedPurchase(null);
                  void handleDeletePurchase(row);
                }}
              >
                {tc('delete')}
              </Button>
            ) : <span />}
            <Button variant="secondary" onClick={() => setSelectedPurchase(null)}>{tc('close')}</Button>
          </div>
        ) : undefined}
      >
        {selectedPurchase && (() => {
          const sale = selectedPurchase.sale_price ?? selectedPurchase.products?.sale_price ?? null;
          const total = selectedPurchase.quantity * selectedPurchase.cost_price;
          const facts: Array<{ label: string; value: string }> = [
            { label: t('date'), value: formatDateOnly(selectedPurchase.date, locale) },
            { label: t('quantity'), value: `${formatNumber(selectedPurchase.quantity)} ${t('pcs')}` },
            { label: `${t('costPrice')} (${t('perPcs')})`, value: `${formatUnitCurrency(selectedPurchase.cost_price)} ${currency}` },
            ...(sale !== null ? [
              { label: `${t('salePrice')} (${t('perPcs')})`, value: `${formatCurrency(sale)} ${currency}` },
              { label: t('purchaseMarginPerUnit'), value: `${formatUnitCurrency(sale - selectedPurchase.cost_price)} ${currency}` },
            ] : []),
            {
              label: t('payment'),
              value: tc.has(`paymentMethods.${selectedPurchase.payment_method}`)
                ? tc(`paymentMethods.${selectedPurchase.payment_method}` as Parameters<typeof tc>[0])
                : selectedPurchase.payment_method,
            },
            { label: t('purchaseRecordedAt'), value: formatDateTime(selectedPurchase.created_at, locale) },
            ...(selectedPurchase.comment ? [{ label: t('comment'), value: selectedPurchase.comment }] : []),
          ];
          return (
            <div className="space-y-5">
              <DetailHero
                title={selectedPurchase.products?.name ?? '—'}
                amount={<Money amount={total} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
                amountLabel={t('totalCostHeader')}
              />
              <DetailList items={facts} />
              <ButtonLink href={closingStockHref(selectedPurchase.date)} variant="secondary" className="w-full" iconRight={<ChevronRight size={15} aria-hidden="true" />}>
                {t('purchaseOpenDay')}
              </ButtonLink>
            </div>
          );
        })()}
      </Modal>
      {confirmDialog}
    </div>
  );
}
