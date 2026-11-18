'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import {
  Button,
  DatePicker,
  DateRangePicker,
  Field,
  MonthPicker,
  SegmentedControl,
  Select,
} from '@/components/PresentationFoundation';
import {
  NO_CATEGORY,
  hasActivePurchaseFilters,
  type PurchaseHistoryFilters,
  type PurchasePeriod,
} from '@/lib/calculations/purchaseHistory';
import type { EntryPaymentMethod } from '@/types';

interface PurchaseHistoryFiltersProps {
  filters: PurchaseHistoryFilters;
  onChange: (next: PurchaseHistoryFilters) => void;
  onClear: () => void;
  categories: string[];
  /** Product names of the chosen category, for the product picker. */
  productNames: string[];
  productsLoading: boolean;
  paymentMethods: readonly EntryPaymentMethod[];
  businessToday: string;
}

/** Period, category, product and payment filters for the purchase history. */
export function PurchaseHistoryFilterBar({
  filters,
  onChange,
  onClear,
  categories,
  productNames,
  productsLoading,
  paymentMethods,
  businessToday,
}: PurchaseHistoryFiltersProps) {
  const t = useTranslations('stockPurchase.history');
  const tc = useTranslations('common');
  const set = <K extends keyof PurchaseHistoryFilters>(key: K, value: PurchaseHistoryFilters[K]) => onChange({ ...filters, [key]: value });
  const periods: Array<{ value: PurchasePeriod; label: string }> = [
    { value: 'all', label: t('periodAll') },
    { value: 'day', label: t('periodDay') },
    { value: 'month', label: t('periodMonth') },
    { value: 'range', label: t('periodRange') },
  ];

  return (
    <div className="space-y-3 border-b border-gray-100 px-4 py-4 sm:px-5" role="group" aria-label={t('filtersLabel')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SegmentedControl
          variant="chips"
          size="sm"
          label={t('period')}
          options={periods}
          value={filters.period}
          onChange={(period) => set('period', period)}
        />
        {filters.period === 'day' && (
          <DatePicker className="w-full lg:w-60" ariaLabel={t('periodDay')} value={filters.day} max={businessToday} onChange={(day) => set('day', day)} />
        )}
        {filters.period === 'month' && (
          <MonthPicker className="w-full lg:w-60" value={filters.month} max={businessToday.slice(0, 7)} onChange={(month) => set('month', month)} />
        )}
        {filters.period === 'range' && (
          <DateRangePicker
            className="w-full lg:w-96"
            from={filters.from}
            to={filters.to}
            max={businessToday}
            onChange={(range) => onChange({ ...filters, from: range.from, to: range.to })}
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={t('category')} htmlFor="purchase-filter-category">
          <Select
            id="purchase-filter-category"
            controlSize="sm"
            value={filters.category}
            disabled={productsLoading}
            // A product outside the new category would match nothing: drop it.
            onChange={(event) => onChange({ ...filters, category: event.target.value, product: '' })}
          >
            <option value="">{t('allCategories')}</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category === NO_CATEGORY ? t('noCategory') : category}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('product')} htmlFor="purchase-filter-product">
          <Select
            id="purchase-filter-product"
            controlSize="sm"
            value={filters.product}
            disabled={productsLoading}
            onChange={(event) => set('product', event.target.value)}
          >
            <option value="">{productsLoading ? tc('loading') : t('allProducts')}</option>
            {productNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('payment')} htmlFor="purchase-filter-payment">
          <Select
            id="purchase-filter-payment"
            controlSize="sm"
            value={filters.paymentMethod}
            onChange={(event) => set('paymentMethod', event.target.value as EntryPaymentMethod | '')}
          >
            <option value="">{t('allPayments')}</option>
            {paymentMethods.map((method) => (
              <option key={method} value={method}>{tc(`paymentMethods.${method}`)}</option>
            ))}
          </Select>
        </Field>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="sm:col-span-2 lg:col-span-1"
          disabled={!hasActivePurchaseFilters(filters)}
          onClick={onClear}
          icon={<X size={15} aria-hidden="true" />}
        >
          {t('clearFilters')}
        </Button>
      </div>
    </div>
  );
}
