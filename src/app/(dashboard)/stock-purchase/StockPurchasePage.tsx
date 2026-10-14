'use client';

// Route: /stock-purchase

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { runWithJwtTimingRetry } from '@/lib/supabase/authRetry';
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
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
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
import { fetchActiveProductsOrdered, fetchProductIdsByName } from '@/lib/supabase/products';
import {
  isPrefilledAmountEdited,
  prefillAmount,
  resolvePrefilledAmount,
  type PrefilledAmount,
} from '@/lib/productWrites';
import {
  formatCurrency,
  formatDateOnly,
  formatNumber,
  formatUnitCurrency,
  parseCurrencyInput,
} from '@/lib/formatters';
import {
  calculateWeightedAverageCost,
  isWholePositiveStockQuantity,
  resolveLowStockThreshold,
  stockLevel,
} from '@/lib/calculations/stock';
import { classifyStockWriteError, type StockWriteErrorLike } from '@/lib/stockWriteErrors';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Package,
  RefreshCcw,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import type { EntryPaymentMethod, Product, StockPurchase } from '@/types';
import { useLatestRef } from '@/components/i18n/useLatestRef';

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

export default function StockPurchasePage() {
  const t = useTranslations('stockPurchase');
  const tRef = useLatestRef(t);
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods, role } = useClub();
  const canWrite = role === 'owner' || role === 'admin';
  const { locale } = useAppLocale();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const businessToday = useBusinessToday(businessDayStartHour);
  // An untouched form date follows the business day across midnight; a date
  // the user picked is never replaced.
  const dateTouched = useRef(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [purchases, setPurchases] = useState<PurchaseWithProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [productsError, setProductsError] = useState('');
  const [purchasesError, setPurchasesError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const purchaseRequest = useRef(0);
  const productRequest = useRef(0);

  const [form, setForm] = useState<PurchaseForm>(() => ({
    date: businessToday,
    ...emptyItemFields,
    payment_method: defaultPaymentMethod(enabledPaymentMethods),
  }));

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

  const loadProducts = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++productRequest.current;
    const isCurrent = () => requestId === productRequest.current;
    if (!selectedClubId) {
      setProducts([]);
      setProductsLoading(false);
      return;
    }

    if (!silent) {
      setProductsLoading(true);
      setProducts([]);
    }
    const supabase = createClient();
    try {
      const productsRes = await runWithJwtTimingRetry(
        supabase,
        async () => fetchActiveProductsOrdered(supabase, selectedClubId, { tracksInventoryOnly: true }),
      );
      // A slower response for a previously selected club must never replace
      // (or be selected in) the current club's product list.
      if (!isCurrent()) return;
      setProductsLoading(false);

      if (productsRes.error) {
        setProductsError(tRef.current('productsLoadFailed'));
        return;
      }

      setProductsError('');
      setProducts(productsRes.data ?? []);
    } catch {
      if (!isCurrent()) return;
      setProductsLoading(false);
      setProductsError(tRef.current('productsLoadFailed'));
    }
  }, [selectedClubId, tRef]);

  const loadPurchases = useCallback(async (page: number) => {
    const requestId = ++purchaseRequest.current;
    if (!selectedClubId) {
      setPurchases([]);
      setPurchaseCount(0);
      setPurchasesLoading(false);
      return;
    }

    setPurchasesLoading(true);
    const from = (page - 1) * PURCHASES_PAGE_SIZE;
    const to = from + PURCHASES_PAGE_SIZE - 1;
    const supabase = createClient();
    const paymentSearch = sanitizePurchaseSearch(debouncedQuery);
    // Match the purchase's product by name across the whole club catalog,
    // including inactive and archived products that still have receipts.
    let productIds: string[] = [];
    if (debouncedQuery) {
      const matches = await runWithJwtTimingRetry(
        supabase,
        async () => fetchProductIdsByName(supabase, selectedClubId, debouncedQuery),
      );
      if (requestId !== purchaseRequest.current) return;
      if (matches.error) {
        setPurchasesLoading(false);
        setPurchasesError(tRef.current('purchasesLoadFailed'));
        return;
      }
      productIds = matches.data;
    }
    const filters: string[] = [];
    if (paymentSearch) filters.push(`payment_method.ilike.%${paymentSearch}%`);
    if (productIds.length) filters.push(`product_id.in.(${productIds.join(',')})`);

    const { data, error: purchasesError, count } = await runWithJwtTimingRetry(
      supabase,
      async () => {
        let request = supabase
          .from('stock_purchases')
          .select('*, products(name, sale_price)', { count: 'exact' })
          .eq('club_id', selectedClubId);

        if (filters.length > 0) request = request.or(filters.join(','));

        return request
          .order('created_at', { ascending: false })
          .range(from, to);
      },
    );

    if (requestId !== purchaseRequest.current) return;
    setPurchasesLoading(false);

    if (purchasesError) {
      setPurchasesError(tRef.current('purchasesLoadFailed'));
      return;
    }

    setPurchasesError('');
    setPurchases((data as PurchaseWithProduct[]) ?? []);
    setPurchaseCount(count ?? 0);
  }, [debouncedQuery, selectedClubId, tRef]);

  // A different club has different products: never carry a product, prices or
  // comment from the previous club into this form.
  useEffect(() => {
    setPurchasePage(1);
    setFormError('');
    dateTouched.current = false;
    setForm((prev) => ({ ...prev, ...emptyItemFields }));
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

  useEffect(() => {
    void loadProducts();
    return () => { productRequest.current += 1; };
  }, [loadProducts]);

  useEffect(() => {
    loadPurchases(purchasePage).catch(() => {
      setPurchasesLoading(false);
      setPurchasesError(tRef.current('purchasesLoadFailed'));
    });
    return () => { purchaseRequest.current += 1; };
  }, [loadPurchases, purchasePage, tRef]);

  const selectedProduct = products.find((product) => product.id === form.product_id) ?? null;
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

  async function reloadAfterMutation(nextPage: number) {
    await loadProducts({ silent: true });
    if (nextPage === purchasePage) {
      await loadPurchases(nextPage);
    } else {
      setPurchasePage(nextPage);
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

    setSaving(true);
    setFormError('');

    const supabase = createClient();
    let err: StockWriteErrorLike | null = null;
    try {
      const result = await supabase.rpc('record_stock_purchase', {
        p_club_id: selectedClubId,
        p_date: form.date,
        p_product_id: form.product_id,
        p_quantity: quantity,
        p_cost_price: costPrice,
        p_sale_price: requestedSalePrice,
        p_payment_method: form.payment_method,
        p_comment: form.comment.trim() || null,
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

    showToast(t('deleteSuccess'));
    const nextPage = purchases.length === 1 && purchasePage > 1 ? purchasePage - 1 : purchasePage;
    await reloadAfterMutation(nextPage);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
      />

      {!canWrite && (
        <InlineAlert variant="info" title={t('viewerReadOnlyTitle')}>{t('viewerReadOnlyBody')}</InlineAlert>
      )}

      {productsError && (
        <InlineAlert
          variant="danger"
          action={(
            <Button variant="outline" size="sm" onClick={() => { void loadProducts(); }} icon={<RefreshCcw size={14} aria-hidden="true" />}>
              {tc('retry')}
            </Button>
          )}
        >
          {productsError}
        </InlineAlert>
      )}

      {!productsLoading && !productsError && products.length === 0 && (
        <Card>
          <EmptyState
            icon={Package}
            title={t('noTrackedProductsTitle')}
            description={t('noTrackedProductsBody')}
            action={<ButtonLink href="/products" variant="primary">{t('goToProducts')}</ButtonLink>}
          />
        </Card>
      )}

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
                onChange={(event) => set('quantity', event.target.value.replace(/\D/g, ''))}
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

          <details className="group mt-4 text-sm">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-gray-500 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
              <HelpCircle size={15} aria-hidden="true" />
              {t('howItWorks')}
            </summary>
            <ul className="mt-2 space-y-1 pl-5 text-gray-600">
              {[t('hintStock'), t('hintClosing'), t('hintProfit')].map((hint) => (
                <li key={hint} className="list-disc">{hint}</li>
              ))}
            </ul>
          </details>
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
                <h3 className="break-words text-xl font-bold tracking-tight text-gray-950">{selectedProduct.name}</h3>
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
              </div>
            </Card>
          </Card>
        )}
      </div>

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

        {purchasesError && (
          <InlineAlert
            variant="danger"
            className="mx-4 mt-4 sm:mx-5"
            action={(
              <Button variant="outline" size="sm" onClick={() => { void loadPurchases(purchasePage); }} icon={<RefreshCcw size={14} aria-hidden="true" />}>
                {tc('retry')}
              </Button>
            )}
          >
            {purchasesError}
          </InlineAlert>
        )}

        {purchasesLoading && purchases.length === 0 ? (
          <TableSkeleton rows={6} columns={8} className="rounded-none border-0 shadow-none" />
        ) : (
          <DataTable
            bare
            label={t('recentPurchases')}
            keyExtractor={(row) => row.id}
            data={purchases}
            minWidth={980}
            className={purchasesLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            emptyState={purchasesError
              ? <EmptyState compact icon={AlertTriangle} title={t('purchasesLoadFailed')} />
              : <EmptyState compact icon={ShoppingCart} title={tc('noData')} />}
            columns={[
              { key: 'index', header: '#', className: 'w-12', render: (_row, index) => <span className="text-gray-500 tabular-nums">{(purchasePage - 1) * PURCHASES_PAGE_SIZE + index + 1}</span> },
              { key: 'date', header: t('date'), render: (row) => <span className="font-medium text-gray-900">{formatDateOnly(row.date, locale)}</span> },
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
      {confirmDialog}
    </div>
  );
}
