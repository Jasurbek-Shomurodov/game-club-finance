'use client';

import { ArrowRight, PackageOpen, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, ButtonLink, Card, SectionHeading, Skeleton } from '@/components/PresentationFoundation';
import { formatCurrency, formatDateShort, formatNumber } from '@/lib/formatters';
import type { DashboardDebtor } from '@/lib/calculations/dashboardAttention';
import type { LowStockProduct } from '@/lib/calculations/stock';

/** Rows shown before the rest collapse into "+N more". */
const MAX_ROWS = 5;

function AttentionCard({ title, icon, count, loading, empty, action, more, children }: {
  title: string;
  icon: ReactNode;
  count: number;
  loading: boolean;
  empty: string;
  action?: ReactNode;
  more: string | null;
  children: ReactNode;
}) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col">
      <SectionHeading
        title={title}
        icon={icon}
        size="sm"
        badge={!loading && count > 0 ? <Badge variant="warning" size="sm">{count}</Badge> : undefined}
        action={action}
      />
      {loading ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : count === 0 ? (
        <p className="mt-3 text-sm leading-6 text-gray-500">{empty}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-gray-100">{children}</ul>
          {more && <p className="mt-2 text-xs font-medium text-gray-500">{more}</p>}
        </>
      )}
    </Card>
  );
}

/**
 * What needs the owner's attention besides the totals: products about to run
 * out and the people who owe the club. Both come from the dashboard snapshot,
 * so the cards add no request.
 */
export function DashboardAttention({ lowStock, debtors, loading, locale, currency, stockLink, debtsHref }: {
  lowStock: LowStockProduct[];
  debtors: DashboardDebtor[];
  loading: boolean;
  locale: string;
  currency: string;
  /** Where to act on low stock; omitted when the member can open neither page. */
  stockLink?: { href: string; label: string };
  /** Omitted when the member cannot open Debts. */
  debtsHref?: string;
}) {
  const t = useTranslations('dashboard');
  const link = (href: string | undefined, label: string) => href && (
    <ButtonLink href={href} variant="ghost" size="sm" iconRight={<ArrowRight size={15} aria-hidden="true" />}>
      {label}
    </ButtonLink>
  );
  const more = (total: number) => (total > MAX_ROWS ? t('attentionMore', { count: total - MAX_ROWS }) : null);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <AttentionCard
        title={t('runningLowTitle')}
        icon={<PackageOpen size={16} aria-hidden="true" />}
        count={lowStock.length}
        loading={loading}
        empty={t('runningLowEmpty')}
        action={link(stockLink?.href, stockLink?.label ?? '')}
        more={more(lowStock.length)}
      >
        {lowStock.slice(0, MAX_ROWS).map((product) => (
          <li key={product.name} className="flex items-center justify-between gap-3 py-2">
            <p className="min-w-0 break-words text-sm font-medium text-gray-900">{product.name}</p>
            <Badge variant={product.level === 'out' ? 'danger' : 'warning'} size="sm">
              {product.level === 'out' ? t('runningLowOut') : t('runningLowLeft', { count: formatNumber(product.currentStock) })}
            </Badge>
          </li>
        ))}
      </AttentionCard>

      <AttentionCard
        title={t('debtorsTitle')}
        icon={<Users size={16} aria-hidden="true" />}
        count={debtors.length}
        loading={loading}
        empty={t('debtorsEmpty')}
        action={link(debtsHref, t('debtorsAction'))}
        more={more(debtors.length)}
      >
        {debtors.slice(0, MAX_ROWS).map((debtor) => (
          <li key={debtor.name} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-gray-900">{debtor.name || t('debtorNoName')}</p>
              <p className="text-xs text-gray-500">
                {t('debtorSince', { date: formatDateShort(debtor.oldestDate, locale) })}
                {debtor.count > 1 ? ` · ${t('debtorCount', { count: debtor.count })}` : ''}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-danger-600">
              {formatCurrency(debtor.remaining)} <span className="font-medium text-gray-500">{currency}</span>
            </p>
          </li>
        ))}
      </AttentionCard>
    </div>
  );
}
