'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { PackageX } from 'lucide-react';
import { Disclosure, Skeleton } from '@/components/PresentationFoundation';
import { DonutSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { ChartCard, colorWithAlpha, chartColors } from '@/components/dashboard/ChartCard';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { stockGlance, type StockGlanceRow } from '@/lib/calculations/pageGlance';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <DonutSkeleton />,
});

const LIST_SHOWN = 6;

/**
 * The bar's stock for the selected day in three reads: where the stock value
 * sits, what sold best, and what has run out or is about to. Tapping a product
 * finds it in the table; tapping a category filters to it.
 */
export function StockGlance({ rows, stockValue, onFindProduct, onSelectCategory }: {
  rows: readonly StockGlanceRow[];
  stockValue: number;
  onFindProduct: (name: string) => void;
  onSelectCategory: (category: string) => void;
}) {
  const t = useTranslations('glance.stock');
  const tg = useTranslations('glance');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const glance = useMemo(() => stockGlance(rows), [rows]);
  const slices = useMemo(() => toDonutSlices(
    glance.valueByCategory.map(({ category, value }) => ({ key: category, label: category || tc('uncategorized'), value })),
    { key: '__other', label: tg('other') },
    onSelectCategory,
  ), [glance.valueByCategory, onSelectCategory, tc, tg]);
  const bestIncome = glance.topSellers[0]?.income ?? 0;
  const attention = [...glance.outOfStock.map((product) => ({ ...product, out: true })), ...glance.lowStock.map((product) => ({ ...product, out: false }))];

  if (!rows.length) return null;

  return (
    <Disclosure
      defaultOpen
      summary={(
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {t('title')}
          {glance.outOfStock.length > 0 && <span className="font-medium text-danger-600">{t('outCount', { count: glance.outOfStock.length })}</span>}
          {glance.lowStock.length > 0 && <span className="font-medium text-warning-600">{t('lowCount', { count: glance.lowStock.length })}</span>}
        </span>
      )}
    >
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <ChartCard title={t('valueTitle')}>
          <div className="mt-3">
            {slices.length ? (
              <DonutBreakdown size="sm" slices={slices} total={stockValue} totalLabel={t('stockValue')} currency={currency} locale={locale} />
            ) : <p className="text-sm text-gray-500">{t('noStock')}</p>}
          </div>
        </ChartCard>

        <ChartCard title={t('topTitle')}>
          {glance.topSellers.length ? (
            <ol className="mt-3 space-y-2">
              {glance.topSellers.map((product, index) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onFindProduct(product.name)}
                    className="tappable w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-4 shrink-0 tabular-nums text-gray-500">{index + 1}</span>
                        <span className="truncate font-medium text-gray-800">{product.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-gray-950">
                        {formatCurrency(product.income)}
                        <span className="ml-1 font-normal text-gray-500">· {t('sold', { count: formatNumber(product.quantity) })}</span>
                      </span>
                    </span>
                    <span className="ml-6 mt-1 block h-1 overflow-hidden rounded-full bg-gray-100">
                      <span
                        className="grow-x block h-full rounded-full"
                        style={{
                          width: `${bestIncome > 0 ? Math.max(4, (product.income / bestIncome) * 100) : 4}%`,
                          backgroundColor: index === 0 ? chartColors.orange : colorWithAlpha(chartColors.orange, 0.45),
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 text-sm text-gray-500">{t('noSales')}</p>}
        </ChartCard>

        <ChartCard title={t('attentionTitle')}>
          {attention.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {attention.slice(0, LIST_SHOWN * 2).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onFindProduct(product.name)}
                    className={cn(
                      'tappable inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 max-sm:min-h-9',
                      product.out
                        ? 'border-danger-100 bg-danger-50 text-danger-700 hover:bg-danger-100'
                        : 'border-warning-100 bg-warning-50 text-warning-700 hover:bg-warning-100',
                    )}
                  >
                    {product.out && <PackageX size={12} aria-hidden="true" />}
                    <span className="truncate">{product.name}</span>
                    <span className="tabular-nums opacity-80">{product.out ? t('out') : t('left', { count: formatNumber(product.quantity) })}</span>
                  </button>
                </li>
              ))}
              {attention.length > LIST_SHOWN * 2 && (
                <li className="self-center text-xs text-gray-500">{tg('more', { count: attention.length - LIST_SHOWN * 2 })}</li>
              )}
            </ul>
          ) : <p className="mt-3 rounded-xl bg-success-50 px-3 py-2 text-sm font-medium text-success-700">{t('allStocked')}</p>}
        </ChartCard>
      </div>
    </Disclosure>
  );
}

/** The open glance while the day loads: its summary line over the value donut, top sellers and attention chips. */
export function StockGlanceSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-5 w-56 max-w-full" />
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <SkeletonCard>
          <Skeleton className="h-4 w-32" />
          <DonutSkeleton className="mt-3" />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-28" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="space-y-1.5 px-2 py-1.5">
                <div className="flex justify-between gap-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="ml-6 h-1 rounded-full bg-gray-100" />
              </div>
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-36" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[24, 32, 20, 28, 36, 24, 28, 20].map((width, index) => (
              <Skeleton key={index} className="h-6 rounded-full bg-gray-100" style={{ width: `${width * 4}px` }} />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
