'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Search, ShoppingCart, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  InlineAlert,
  Modal,
  Money,
  SearchInput,
  StatTile,
  Stepper,
} from '@/components/PresentationFoundation';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import {
  calculateBulkStockOrderSummary,
  getBulkStockAvailableQuantity,
  isWholeNumberInput,
  type BulkStockOrderItem,
  type BulkStockOrderSummary,
  type ClosingStockRowData,
} from '@/lib/closingStock';

interface BulkStockUpdateModalProps {
  open: boolean;
  rows: ClosingStockRowData[];
  saving: boolean;
  onClose: () => void;
  /** Resolves to an error message to show in the dialog, or `null` on success. */
  onSave: (items: BulkStockOrderItem[], summary: BulkStockOrderSummary) => Promise<string | null>;
}

export function BulkStockUpdateModal({ open, rows, saving, onClose, onSave }: BulkStockUpdateModalProps) {
  const t = useTranslations('closingStock');
  const tc = useTranslations('common');
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // Product order is fixed when the dialog opens so rows never jump while a
  // quantity is being typed.
  const [frozenOrder, setFrozenOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setQuantities({});
    setError('');
    setFrozenOrder([...rows]
      .sort((a, b) => (a.product.sort_order ?? Number.MAX_SAFE_INTEGER)
        - (b.product.sort_order ?? Number.MAX_SAFE_INTEGER)
        || a.product.name.localeCompare(b.product.name))
      .map((row) => row.product.id));
    // Only snapshot the order when the dialog opens, not on each row refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = useMemo<BulkStockOrderItem[]>(() => rows.flatMap((row) => {
    const quantity = Number(quantities[row.product.id] ?? 0);
    return Number.isInteger(quantity) && quantity > 0
      ? [{ productId: row.product.id, quantity }]
      : [];
  }), [quantities, rows]);

  const summary = useMemo(() => calculateBulkStockOrderSummary(rows, items), [items, rows]);

  const rowsById = useMemo(() => new Map(rows.map((row) => [row.product.id, row])), [rows]);

  const invalidItem = useMemo(() => items.find((item) => {
    const row = rowsById.get(item.productId);
    if (!row) return false;
    const available = getBulkStockAvailableQuantity(row);
    return available !== null && item.quantity > available;
  }), [items, rowsById]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const position = new Map(frozenOrder.map((id, index) => [id, index]));
    return rows
      .filter((row) => {
        if (!needle) return true;
        return row.product.name.toLowerCase().includes(needle)
          || String(row.product.category ?? '').toLowerCase().includes(needle);
      })
      .sort((a, b) => (position.get(a.product.id) ?? Number.MAX_SAFE_INTEGER)
        - (position.get(b.product.id) ?? Number.MAX_SAFE_INTEGER)
        || a.product.name.localeCompare(b.product.name));
  }, [frozenOrder, query, rows]);

  function updateQuantity(row: ClosingStockRowData, value: string) {
    if (!isWholeNumberInput(value)) return;
    const available = getBulkStockAvailableQuantity(row);
    const boundedValue = value === '' || available === null
      ? value
      : String(Math.min(Number(value), available));
    setError('');
    setQuantities((current) => ({ ...current, [row.product.id]: boundedValue }));
  }

  function adjustQuantity(row: ClosingStockRowData, amount: number) {
    const currentQuantity = Number(quantities[row.product.id] ?? 0);
    const nextQuantity = Math.max(0, currentQuantity + amount);
    updateQuantity(row, nextQuantity === 0 ? '' : String(nextQuantity));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (summary.totalQuantity === 0) {
      setError(t('bulkEmpty'));
      return;
    }

    if (invalidItem) {
      const row = rowsById.get(invalidItem.productId);
      if (row) {
        setError(t('bulkInsufficientStock', {
          product: row.product.name,
          available: formatNumber(getBulkStockAvailableQuantity(row) ?? 0),
        }));
      }
      return;
    }

    setError('');
    const saveError = await onSave(items, summary);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title={t('bulkTitle')}
      size="xl"
      bodyClassName="pb-2"
      footer={(
        <div className="flex w-full flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <StatTile variant="flat" size="sm" label={t('bulkTotalItems')} value={formatNumber(summary.totalQuantity)} unit={t('pcs')} />
            <StatTile variant="flat" size="sm" align="center" className="text-right" label={t('bulkOrderTotal')} value={formatCurrency(summary.totalPrice)} unit={tc('currency')} tone="primary" />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={saving || summary.totalQuantity === 0}
              onClick={() => { setQuantities({}); setError(''); }}
              icon={<Trash2 size={16} aria-hidden="true" />}
            >
              {t('bulkClear')}
            </Button>
            <Button
              type="submit"
              form="bulk-stock-form"
              className="sm:min-w-56"
              loading={saving}
              loadingLabel={tc('saving')}
              disabled={summary.totalQuantity === 0 || Boolean(invalidItem)}
              icon={<ShoppingCart size={17} aria-hidden="true" />}
            >
              {t('bulkSave')}
            </Button>
          </div>
        </div>
      )}
    >
      <form id="bulk-stock-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-500">{t('bulkDescription')}</p>

        <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 py-2">
          <SearchInput value={query} onChange={setQuery} placeholder={t('bulkSearchPlaceholder')} />
        </div>

        <div className="space-y-2">
          {visibleRows.length === 0 ? (
            <EmptyState
              compact
              bordered
              icon={Search}
              title={query.trim() ? t('bulkNoResults', { query: query.trim() }) : tc('noData')}
              action={query.trim() ? (
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>{tc('clearSearch')}</Button>
              ) : undefined}
            />
          ) : visibleRows.map((row) => {
            const quantity = Number(quantities[row.product.id] ?? 0);
            const available = getBulkStockAvailableQuantity(row);
            const hasStockError = available !== null && quantity > available;
            const isOutOfStock = available === 0;

            return (
              <div
                key={row.product.id}
                className={`rounded-xl border p-3 transition ${quantity > 0 ? 'border-primary-200 bg-primary-50/30' : 'border-gray-100 bg-surface'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{row.product.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700"><Money amount={row.product.sale_price} /></span>
                      {available === null ? (
                        <Badge variant="purple" size="sm">{t('bulkMadeToOrder')}</Badge>
                      ) : (
                        <span className={isOutOfStock ? 'font-semibold text-danger-600' : ''}>
                          {t('bulkAvailable', { count: formatNumber(available) })}
                        </span>
                      )}
                    </div>
                  </div>

                  <Stepper
                    size="sm"
                    label={t('bulkQuantityFor', { product: row.product.name })}
                    decreaseLabel={t('bulkDecrease', { product: row.product.name })}
                    increaseLabel={t('bulkIncrease', { product: row.product.name })}
                    value={quantities[row.product.id] ?? ''}
                    max={available}
                    disabled={saving || isOutOfStock}
                    invalid={hasStockError}
                    onChange={(value) => updateQuantity(row, value)}
                    onStep={(delta) => adjustQuantity(row, delta)}
                  />
                </div>

                {quantity > 0 && (
                  <div className="mt-2 flex items-center justify-between border-t border-primary-100 pt-2 text-xs">
                    <span className={hasStockError ? 'font-semibold text-danger-600' : 'text-gray-500'}>
                      {hasStockError
                        ? t('bulkInsufficientStock', { product: row.product.name, available: formatNumber(available ?? 0) })
                        : t('bulkLine', { quantity: formatNumber(quantity) })}
                    </span>
                    <span className="font-bold text-primary-700"><Money amount={quantity * row.product.sale_price} /></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      </form>
    </Modal>
  );
}
