'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CurrencyInput,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  PageHeader,
  SearchInput,
  SectionHeading,
  SegmentedControl,
  StatTile,
  TableSkeleton,
  useConfirm,
  useToast,
  type SegmentedOption,
} from '@/components/PresentationFoundation';
import { cleanQuantityInput, formatCurrency, formatNumber, formatUnitCurrency } from '@/lib/formatters';
import { fetchProductsOrdered, isMissingSortOrder, updateProductSortOrders } from '@/lib/supabase/products';
import {
  buildProductInsertPayload,
  buildProductUpdatePayload,
  planProductReorder,
  prefillAmount,
  validateProductForm,
  type PrefilledAmount,
  type ProductWriteForm,
} from '@/lib/productWrites';
import { LOW_STOCK_DEFAULT, resolveLowStockThreshold, stockLevel } from '@/lib/calculations/stock';
import { groupByCategory } from '@/lib/productSections';
import { buildProductSalesSummary, salesPeriodStart, type ProductSalesRow } from '@/lib/calculations/productSales';
import { fetchBarProductSales } from '@/lib/supabase/barProductSales';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { cn } from '@/lib/utils';
import { useClubQuery } from '@/lib/useClubQuery';
import { ArrowDown, ArrowUp, Check, Download, ListOrdered, Lock, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageSearch } from '@/lib/quickActions';
import { csvFileName, csvSeparatorForLocale, downloadCsv, toCsv } from '@/lib/csv';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { Product } from '@/types';

type ProductForm = ProductWriteForm;
type StockFilter = 'all' | 'low' | 'out' | 'inactive';
type ProductSort = 'catalog' | 'bestSellers' | 'runsOut';

/** Sales pace and stock runway look at this many days ending today. */
const SALES_PERIOD_DAYS = 30;
const NO_SALES: ProductSalesRow[] = [];

const NO_PRODUCTS: Product[] = [];

const emptyForm = (): ProductForm => ({
  name: '',
  category: '',
  sale_price: '',
  cost_price: '',
  current_stock: '',
  low_stock_threshold: String(LOW_STOCK_DEFAULT),
  tracks_inventory: true,
  is_active: true,
});

function productCategory(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export default function ProductsPage() {
  const sectionTabs = useSectionTabs('bar');
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const { selectedClubId, role: currentRole, businessDayStartHour } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const { locale } = useAppLocale();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm());
  const [loadedCostPrice, setLoadedCostPrice] = useState<PrefilledAmount | null>(null);
  const [loadedSalePrice, setLoadedSalePrice] = useState<PrefilledAmount | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState('');
  const [salePriceError, setSalePriceError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [search, setSearch] = useState('');
  // A product picked in the command palette opens the catalog narrowed to it.
  usePageSearch('products', setSearch);
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [reordering, setReordering] = useState(false);
  const [sort, setSort] = useState<ProductSort>('catalog');
  const [movingId, setMovingId] = useState<string | null>(null);

  const isOwner = currentRole === 'owner';
  const canManageInventory = currentRole === 'owner' || currentRole === 'admin';

  const fetchProducts = useCallback(async (): Promise<Product[]> => {
    if (!selectedClubId) return NO_PRODUCTS;
    const result = await fetchProductsOrdered(createClient(), selectedClubId);
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  }, [selectedClubId]);
  const productsQuery = useClubQuery(fetchProducts, NO_PRODUCTS);
  const { data: products, setData: setProducts, loading, error: loadError, reload: loadProducts } = productsQuery;
  // Sales only decorate the catalog: a failed read leaves the columns empty.
  const fetchSales = useCallback(async (): Promise<ProductSalesRow[]> => {
    if (!selectedClubId) return NO_SALES;
    return fetchBarProductSales(createClient(), selectedClubId, salesPeriodStart(businessToday, SALES_PERIOD_DAYS), businessToday);
  }, [selectedClubId, businessToday]);
  const salesQuery = useClubQuery(fetchSales, NO_SALES);
  const sales = useMemo(() => buildProductSalesSummary(products, salesQuery.data), [products, salesQuery.data]);
  const hasSales = sales.countedDays > 0;
  const bestSeller = useMemo(() => {
    let best: Product | null = null;
    let bestIncome = 0;
    for (const product of products) {
      const income = sales.byProduct.get(product.id)?.income ?? 0;
      if (income > bestIncome) { best = product; bestIncome = income; }
    }
    return best;
  }, [products, sales]);
  const productIndexById = useMemo(() => new Map(products.map((product, index) => [product.id, index])), [products]);

  // An open editor belongs to the previous club's product; never save it
  // against the newly selected club.
  useEffect(() => {
    setModalOpen(false);
    setEditingId(null);
    setReordering(false);
  }, [selectedClubId]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(products.map((product) => productCategory(product.category)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (reordering) return products;
    const query = search.trim().toLocaleLowerCase();
    const matching = products.filter((product) => {
      if (selectedCategory && productCategory(product.category) !== selectedCategory) return false;
      if (query && !`${product.name} ${product.category ?? ''}`.toLocaleLowerCase().includes(query)) return false;
      if (stockFilter === 'inactive') return !product.is_active;
      if (stockFilter === 'all') return true;
      if (!product.is_active || product.tracks_inventory === false) return false;
      const level = stockLevel(product.current_stock, product.low_stock_threshold);
      return stockFilter === 'out' ? level === 'out' : level === 'low';
    });
    if (sort === 'bestSellers') {
      const income = (product: Product) => sales.byProduct.get(product.id)?.income ?? 0;
      return [...matching].sort((a, b) => income(b) - income(a));
    }
    if (sort === 'runsOut') {
      // Products with no runway (unsold or made to order) go last.
      const days = (product: Product) => sales.byProduct.get(product.id)?.daysLeft ?? Number.POSITIVE_INFINITY;
      return [...matching].sort((a, b) => days(a) - days(b));
    }
    return matching;
  }, [products, selectedCategory, search, stockFilter, reordering, sort, sales]);
  // With every category in view, the catalog reads as one section per category.
  /** The catalog as filtered and sorted on screen, with the 30-day sales beside each product. */
  function exportProducts() {
    const rows = filteredProducts.map((product) => {
      const insight = sales.byProduct.get(product.id);
      return [
        product.name,
        product.category ?? '',
        product.sale_price,
        product.cost_price,
        product.tracks_inventory === false ? '' : product.current_stock,
        insight?.sold ?? 0,
        insight?.income ?? 0,
        product.is_active ? t('active') : t('inactive'),
      ];
    });
    const headers = [t('name'), t('category'), t('salePrice'), t('costPrice'), t('currentStock'), t('soldColumn'), t('salesIncome'), t('active')];
    downloadCsv(csvFileName('products', businessToday), toCsv(headers, rows, csvSeparatorForLocale(locale)));
  }

  const showSections = !reordering && sort === 'catalog' && !selectedCategory && categoryOptions.length > 0;
  const productSections = useMemo(
    () => (showSections ? groupByCategory(filteredProducts, (product) => product.category) : undefined),
    [showSections, filteredProducts],
  );

  useEffect(() => {
    if (!selectedCategory) return;
    const categoryExists = products.some((product) => productCategory(product.category) === selectedCategory);
    if (!categoryExists) setSelectedCategory('');
  }, [products, selectedCategory]);

  function openAdd() {
    if (!canManageInventory) return;
    setEditingId(null);
    setForm(emptyForm());
    setLoadedCostPrice(null);
    setLoadedSalePrice(null);
    setFormError('');
    setSalePriceError('');
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    if (!canManageInventory || p.is_deleted) return;
    const costPrefill = prefillAmount(p.cost_price);
    const salePrefill = prefillAmount(p.sale_price);
    setEditingId(p.id);
    setLoadedCostPrice(costPrefill);
    setLoadedSalePrice(salePrefill);
    setForm({
      name: p.name,
      category: p.category ?? '',
      sale_price: salePrefill?.input ?? '',
      cost_price: costPrefill?.input ?? '',
      current_stock: String(p.current_stock),
      low_stock_threshold: String(resolveLowStockThreshold(p.low_stock_threshold)),
      tracks_inventory: p.tracks_inventory !== false,
      is_active: p.is_active,
    });
    setFormError('');
    setSalePriceError('');
    setModalOpen(true);
  }

  function set(field: keyof ProductForm, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'sale_price' || field === 'is_active') setSalePriceError('');
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault();
    if (!canManageInventory) return;
    const existingProduct = editingId ? products.find((product) => product.id === editingId) : null;
    // Only archived (deleted) products are read-only in the database; an
    // inactive product can be edited and reactivated.
    if (existingProduct?.is_deleted) {
      setFormError(t('inactiveEditBlocked'));
      return;
    }

    const validation = validateProductForm(form);
    if (!selectedClubId || validation === 'name_required') {
      setFormError(tc('required'));
      return;
    }
    if (validation === 'sale_price_required') {
      setSalePriceError(t('salePriceRequired'));
      return;
    }
    setSaving(true);
    setFormError('');

    const supabase = createClient();
    let err: string | null = null;
    if (editingId) {
      const payload = buildProductUpdatePayload(form, { isOwner, loadedCostPrice, loadedSalePrice });
      const { data: updated, error: e } = await supabase
        .from('products')
        .update(payload)
        .eq('club_id', selectedClubId)
        .eq('id', editingId)
        .select('id');
      // RLS silently filters rows the user may not update; zero rows is a failure.
      err = e ? t('saveFailed') : (updated?.length ?? 0) === 0 ? t('saveNoRows') : null;
    } else {
      const payload = buildProductInsertPayload(form, { isOwner });
      const maxSortOrder = products.reduce(
        (max, product, index) => Math.max(max, product.sort_order ?? index + 1),
        0,
      );
      const insertWithOrder = await supabase.from('products').insert({
        ...payload,
        club_id: selectedClubId,
        sort_order: maxSortOrder + 1,
      });
      if (isMissingSortOrder(insertWithOrder.error)) {
        const { error: e } = await supabase.from('products').insert({ ...payload, club_id: selectedClubId });
        err = e ? t('saveFailed') : null;
      } else {
        err = insertWithOrder.error ? t('saveFailed') : null;
      }
    }

    setSaving(false);
    if (err) {
      setFormError(err);
    } else {
      setModalOpen(false);
      showToast(t('success'));
      await loadProducts({ silent: true });
    }
  }

  async function handleDelete() {
    if (!editingId || !isOwner || !selectedClubId) return;
    const product = products.find((item) => item.id === editingId);
    const remainingStock = product && product.tracks_inventory !== false ? product.current_stock : 0;
    const confirmed = await confirm({
      title: t('deleteProduct'),
      description: remainingStock > 0
        ? t('deleteConfirmWithStock', { count: formatNumber(remainingStock) })
        : t('deleteConfirm'),
      confirmLabel: tc('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;

    setDeleting(true);
    setFormError('');

    const supabase = createClient();
    const { data, error: deleteError } = await supabase
      .from('products')
      .update({
        is_deleted: true,
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('club_id', selectedClubId)
      .eq('id', editingId)
      .select('id')
      .single();

    setDeleting(false);
    if (deleteError || !data) {
      // Raw database text is untranslated and may name internals.
      setFormError(tc('error'));
      return;
    }

    setModalOpen(false);
    showToast(t('deleted'));
    await loadProducts({ silent: true });
  }

  async function moveProduct(productId: string, direction: -1 | 1) {
    if (!canManageInventory || !selectedClubId || movingId) return;
    const currentIndex = products.findIndex((product) => product.id === productId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= products.length) return;

    const plan = planProductReorder(products, currentIndex, targetIndex);
    if (!plan) return;
    const sortOrderById = new Map(plan.writes.map((write) => [write.id, write.sort_order]));
    const byId = new Map(products.map((product) => [product.id, product]));

    setMovingId(productId);
    setProducts(plan.order.flatMap((id) => {
      const product = byId.get(id);
      if (!product) return [];
      const sortOrder = sortOrderById.get(id);
      return sortOrder === undefined ? [product] : [{ ...product, sort_order: sortOrder }];
    }));

    try {
      const { error: moveError } = await updateProductSortOrders(createClient(), selectedClubId, plan.writes);
      if (moveError) {
        showToast(isMissingSortOrder(moveError) ? t('sortOrderMigrationRequired') : tc('error'), 'error');
        await loadProducts({ silent: true });
      }
    } catch {
      showToast(tc('error'), 'error');
      await loadProducts({ silent: true });
    } finally {
      setMovingId(null);
    }
  }

  const stockFilterOptions: Array<{ value: StockFilter; label: string }> = [
    { value: 'all', label: tc('all') },
    { value: 'low', label: t('lowStock') },
    { value: 'out', label: t('outOfStock') },
    { value: 'inactive', label: tc('inactive') },
  ];
  const sortOptions: Array<{ value: ProductSort; label: string }> = [
    { value: 'catalog', label: t('sortCatalog') },
    { value: 'bestSellers', label: t('sortBestSellers') },
    { value: 'runsOut', label: t('sortRunsOut') },
  ];
  const categoryChipOptions: SegmentedOption<string>[] = [
    { value: '', label: t('allCategories') },
    ...categoryOptions.map((category) => ({ value: category, label: category })),
  ];
  const editingProduct = editingId ? products.find((product) => product.id === editingId) : undefined;
  const editingInactive = Boolean(editingProduct && !editingProduct.is_active && !editingProduct.is_deleted);
  const editingArchived = Boolean(editingProduct?.is_deleted);

  return (
    <div>
      <PageHeader
        title={t('title')}
        tabs={sectionTabs}
        action={canManageInventory ? (
          <Button onClick={openAdd} icon={<Plus size={16} aria-hidden="true" />}>{t('addProduct')}</Button>
        ) : undefined}
      />

      {loading ? (
        <TableSkeleton rows={8} columns={canManageInventory ? 7 : 5} />
      ) : loadError && products.length === 0 ? (
        <LoadErrorAlert onRetry={() => void loadProducts()}>
          {t('loadFailed')}
        </LoadErrorAlert>
      ) : products.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title={tc('noData')}
            action={canManageInventory ? (
              <Button onClick={openAdd} icon={<Plus size={16} aria-hidden="true" />}>{t('addProduct')}</Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {/* A failed silent reload keeps the catalog on screen; retry quietly. */}
          {loadError && (
            <LoadErrorAlert onRetry={() => void loadProducts({ silent: true })}>
              {t('loadFailed')}
            </LoadErrorAlert>
          )}
          {hasSales && (
            <Card as="section" aria-label={t('salesTitle', { days: SALES_PERIOD_DAYS })}>
              <SectionHeading
                size="sm"
                title={t('salesTitle', { days: SALES_PERIOD_DAYS })}
                description={t('salesDaysCounted', { count: sales.countedDays })}
              />
              <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <StatTile variant="soft" size="sm" label={t('salesUnits')} value={formatNumber(sales.sold)} />
                <StatTile variant="soft" size="sm" label={t('salesIncome')} value={formatCurrency(sales.income)} unit={tc('currency')} />
                <StatTile
                  variant="soft"
                  size="sm"
                  label={sales.marginPercent === null ? t('salesProfit') : `${t('salesProfit')} · ${t('salesMargin', { percent: formatNumber(sales.marginPercent) })}`}
                  tone={sales.profit < 0 ? 'danger' : 'success'}
                  value={formatCurrency(sales.profit)}
                  unit={tc('currency')}
                />
                <StatTile variant="soft" size="sm" label={t('salesTop')} value={bestSeller?.name ?? '—'} />
              </div>
            </Card>
          )}
          <Card padding="none" className="overflow-hidden">
            <CardHeader className="space-y-4">
              <SectionHeading
                title={t('catalog')}
                description={<span role="status">{t('resultCount', { count: filteredProducts.length, total: products.length })}</span>}
                action={(
                  <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={exportProducts} disabled={filteredProducts.length === 0} icon={<Download size={16} aria-hidden="true" />}>
                    {tc('export')}
                  </Button>
                  {canManageInventory && (
                  <Button
                    variant={reordering ? 'primary' : 'outline'}
                    size="sm"
                    aria-pressed={reordering}
                    disabled={Boolean(movingId)}
                    onClick={() => setReordering(!reordering)}
                    icon={reordering ? <Check size={16} aria-hidden="true" /> : <ListOrdered size={16} aria-hidden="true" />}
                  >
                    {t(reordering ? 'finishReordering' : 'reorder')}
                  </Button>
                  )}
                  </div>
                )}
              />
              {reordering ? (
                <InlineAlert variant="info">{t('reorderHelp')}</InlineAlert>
              ) : (
                <>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <SearchInput
                      className="lg:max-w-sm lg:flex-1"
                      controlSize="sm"
                      value={search}
                      onChange={setSearch}
                      placeholder={t('search')}
                      clearLabel={t('clearFilters')}
                    />
                    <SegmentedControl variant="chips" label={t('currentStock')} options={stockFilterOptions} value={stockFilter} onChange={setStockFilter} />
                  </div>
                  {categoryOptions.length > 0 && (
                    <SegmentedControl variant="chips" label={t('category')} options={categoryChipOptions} value={selectedCategory} onChange={setSelectedCategory} />
                  )}
                  {hasSales && (
                    <SegmentedControl variant="chips" label={t('sortLabel')} options={sortOptions} value={sort} onChange={setSort} />
                  )}
                </>
              )}
            </CardHeader>

            <DataTable
              mobileCards
              bare
              label={t('catalog')}
              keyExtractor={(r) => r.id}
              data={filteredProducts}
              groups={productSections?.map((section) => ({
                key: section.category || '__uncategorized',
                rows: section.items,
                header: (
                  <span className="flex items-center gap-2">
                    {section.category || tc('uncategorized')}
                    <span className="font-normal text-gray-500">{tc('productCount', { count: section.items.length })}</span>
                  </span>
                ),
              }))}
              stickyHeader
              onRowClick={canManageInventory && !reordering ? openEdit : undefined}
              rowClassName={(r) => (r.is_deleted ? 'cursor-default' : undefined)}
              minWidth={reordering ? 760 : hasSales ? 760 : 640}
              emptyState={(
                <EmptyState
                  compact
                  icon={Package}
                  title={t('noResults')}
                  action={(
                    <Button variant="outline" size="sm" onClick={() => { setSearch(''); setSelectedCategory(''); setStockFilter('all'); }}>
                      {t('clearFilters')}
                    </Button>
                  )}
                />
              )}
              columns={[
                {
                  key: 'name',
                  header: t('name'),
                  className: 'min-w-[200px]',
                  render: (r) => (
                    <span className="flex items-center gap-3">
                      <Avatar name={r.name} size="sm" tone="neutral" />
                      <span className={cn('min-w-0 break-words font-medium', r.is_active ? 'text-gray-900' : 'text-gray-500')}>{r.name}</span>
                    </span>
                  ),
                },
                ...(canManageInventory && reordering ? [{
                  key: 'sort_order',
                  header: t('order'),
                  render: (r: Product) => {
                    const index = productIndexById.get(r.id) ?? -1;
                    return (
                      <div className="flex items-center gap-1">
                        <IconButton
                          size="sm"
                          label={t('moveUp')}
                          icon={<ArrowUp size={15} />}
                          disabled={Boolean(movingId) || index <= 0}
                          loading={movingId === r.id}
                          onClick={() => moveProduct(r.id, -1)}
                        />
                        <IconButton
                          size="sm"
                          label={t('moveDown')}
                          icon={<ArrowDown size={15} />}
                          disabled={Boolean(movingId) || index === -1 || index >= products.length - 1}
                          onClick={() => moveProduct(r.id, 1)}
                        />
                      </div>
                    );
                  },
                }] : []),
                ...(reordering || (!selectedCategory && !showSections) ? [{
                  key: 'category',
                  header: t('category'),
                  className: 'hidden lg:table-cell',
                  render: (r: Product) => (r.category ? <Badge variant="neutral">{r.category}</Badge> : <span className="text-gray-300">—</span>),
                }] : []),
                {
                  key: 'sale_price',
                  header: `${t('salePrice')} (${tc('currency')})`,
                  align: 'right',
                  className: 'whitespace-nowrap',
                  cellClassName: 'font-medium text-gray-900',
                  render: (r) => formatCurrency(r.sale_price),
                },
                {
                  key: 'cost_price',
                  header: `${t('costPrice')} (${tc('currency')})`,
                  align: 'right',
                  className: 'hidden whitespace-nowrap lg:table-cell',
                  cellClassName: 'text-gray-600',
                  render: (r) => formatUnitCurrency(r.cost_price),
                },
                ...(hasSales && !reordering ? [{
                  key: 'sold',
                  header: t('soldColumn', { days: SALES_PERIOD_DAYS }),
                  align: 'right' as const,
                  className: 'whitespace-nowrap',
                  render: (r: Product) => {
                    const insight = sales.byProduct.get(r.id);
                    if (!insight || insight.sold === 0) return <span className="text-gray-400">—</span>;
                    return (
                      <span className="inline-flex flex-col sm:items-end">
                        <span className="font-medium text-gray-900">{t('stockUnits', { count: formatNumber(insight.sold) })}</span>
                        <span className="text-xs text-gray-500">{formatCurrency(insight.income)} {tc('currency')}</span>
                      </span>
                    );
                  },
                }] : []),
                {
                  key: 'current_stock',
                  header: t('currentStock'),
                  align: 'right',
                  className: 'whitespace-nowrap',
                  render: (r) => {
                    if (r.tracks_inventory === false) return <Badge variant="outline">{t('madeToOrder')}</Badge>;
                    const quantity = t('stockUnits', { count: formatNumber(r.current_stock) });
                    const level = stockLevel(r.current_stock, r.low_stock_threshold);
                    const badge = level === 'out'
                      ? <Badge variant="danger">{t('outOfStock')} · {quantity}</Badge>
                      : level === 'low'
                        ? <Badge variant="warning">{t('lowStock')} · {quantity}</Badge>
                        : <Badge variant="neutral">{quantity}</Badge>;
                    // How long the stock on hand lasts at the recent sales pace.
                    const daysLeft = r.is_active && level !== 'out' ? sales.byProduct.get(r.id)?.daysLeft ?? null : null;
                    if (daysLeft === null || reordering) return badge;
                    return (
                      <span className="inline-flex flex-col gap-1 sm:items-end">
                        {badge}
                        <span className={cn('text-xs', daysLeft <= 3 ? 'font-medium text-warning-700' : 'text-gray-500')}>
                          {t('daysLeft', { count: formatNumber(daysLeft) })}
                        </span>
                      </span>
                    );
                  },
                },
                {
                  key: 'is_active',
                  header: tc('active'),
                  className: 'hidden sm:table-cell',
                  render: (r) => (
                    <Badge variant={r.is_active ? 'success' : 'neutral'}>{r.is_active ? tc('active') : tc('inactive')}</Badge>
                  ),
                },
                ...(canManageInventory ? [{
                  key: 'actions',
                  header: <span className="sr-only">{tc('actions')}</span>,
                  align: 'right' as const,
                  className: 'w-14',
                  render: (r: Product) => (
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`${tc('edit')}: ${r.name}`}
                      icon={<Pencil size={15} aria-hidden="true" />}
                      disabled={Boolean(r.is_deleted)}
                      title={r.is_deleted ? t('inactiveEditBlocked') : `${tc('edit')}: ${r.name}`}
                      onClick={(event) => { event.stopPropagation(); openEdit(r); }}
                    />
                  ),
                }] : []),
              ]}
            />
          </Card>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? t('editProduct') : t('addProduct')}
        locked={saving || deleting}
        footer={(
          <>
            {editingId && isOwner && (
              <Button variant="dangerOutline" onClick={handleDelete} loading={deleting} loadingLabel={tc('loading')} disabled={saving} className="sm:mr-auto" icon={<Trash2 size={16} aria-hidden="true" />}>
                {t('deleteProduct')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving || deleting}>{tc('cancel')}</Button>
            <Button type="submit" form="product-form" loading={saving} loadingLabel={tc('saving')} disabled={deleting || editingArchived}>{tc('save')}</Button>
          </>
        )}
      >
        <form id="product-form" onSubmit={handleSave} className="space-y-4">
          {editingArchived && <InlineAlert variant="warning">{t('inactiveEditBlocked')}</InlineAlert>}
          {editingInactive && <InlineAlert variant="info">{t('inactiveEditHint')}</InlineAlert>}
          <Field label={t('name')} htmlFor="product-name" required>
            <Input id="product-name" type="text" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('category')} htmlFor="product-category">
            <Input id="product-category" type="text" maxLength={80} list="product-category-options" value={form.category} onChange={(e) => set('category', e.target.value)} />
            <datalist id="product-category-options">
              {categoryOptions.map((category) => <option key={category} value={category} />)}
            </datalist>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('salePrice')} htmlFor="product-sale-price" required={form.is_active} error={salePriceError || undefined}>
              <CurrencyInput id="product-sale-price" value={form.sale_price} onValueChange={(value) => set('sale_price', value)} trailingAddon={tc('currency')} />
            </Field>
            <Field
              label={t('costPrice')}
              htmlFor="product-cost-price"
              labelAddon={!isOwner ? <Lock size={12} className="text-gray-400" aria-hidden="true" /> : undefined}
              hint={!isOwner ? t('ownerOnlyCostPrice') : undefined}
            >
              <CurrencyInput id="product-cost-price" value={form.cost_price} disabled={!isOwner} onValueChange={(value) => set('cost_price', value)} trailingAddon={tc('currency')} />
            </Field>
            <Field
              label={t('currentStock')}
              htmlFor="product-current-stock"
              labelAddon={(!isOwner || editingId) ? <Lock size={12} className="text-gray-400" aria-hidden="true" /> : undefined}
              hint={editingId ? t('stockManagedByLedger') : !form.tracks_inventory ? t('madeToOrderStockHelp') : !isOwner ? t('ownerOnlyStock') : undefined}
            >
              <Input
                id="product-current-stock"
                type="text"
                inputMode="numeric"
                value={form.current_stock}
                disabled={!isOwner || Boolean(editingId) || !form.tracks_inventory}
                onChange={(e) => set('current_stock', cleanQuantityInput(e.target.value))}
              />
            </Field>
            <Field label={t('lowStockThreshold')} htmlFor="product-low-stock">
              <Input
                id="product-low-stock"
                type="text"
                inputMode="numeric"
                value={form.low_stock_threshold}
                disabled={!form.tracks_inventory}
                onChange={(e) => set('low_stock_threshold', cleanQuantityInput(e.target.value))}
              />
            </Field>
          </div>
          <Card tone="muted" padding="sm">
            <Checkbox
              id="made_to_order"
              checked={!form.tracks_inventory}
              disabled={!isOwner || Boolean(editingId)}
              onChange={(e) => set('tracks_inventory', !e.target.checked)}
              label={t('madeToOrder')}
              description={(
                <>
                  <span>{t('madeToOrderHelp')}</span>
                  {editingId
                    ? <span className="mt-1 block">{t('trackingModeLockedAfterCreation')}</span>
                    : !isOwner && <span className="mt-1 block">{t('ownerOnlyTrackingMode')}</span>}
                </>
              )}
            />
          </Card>
          <Checkbox id="is_active" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} label={tc('active')} />

          {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}
        </form>
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
