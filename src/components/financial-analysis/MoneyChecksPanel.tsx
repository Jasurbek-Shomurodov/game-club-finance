'use client';

import { useId } from 'react';
import { CheckCircle2, Copy, TrendingDown, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Card, IconChip, SectionHeading, Skeleton, TappableSurface } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { moneyCheckHref } from '@/lib/detailLinks';
import { moneyCheckKey, type MoneyCheck, type MoneyCheckKind } from '@/lib/calculations/moneyChecks';

const KIND_ICONS: Record<MoneyCheckKind, LucideIcon> = {
  duplicate_expense: Copy,
  category_spike: TrendingUp,
  low_income_day: TrendingDown,
  repeated_shortage: TriangleAlert,
};

/** What the member may open, for where each row links. */
export type MoneyCheckAccess = Parameters<typeof moneyCheckHref>[1];

function CheckRow({ check, labelFor, access, currency, locale }: {
  check: MoneyCheck;
  labelFor: (category: string) => string;
  access: MoneyCheckAccess;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const usual = formatCurrency(check.usual ?? 0);
  const category = check.category ? labelFor(check.category) : '';
  const sentence = (() => {
    switch (check.kind) {
      case 'duplicate_expense':
        return t('checkDuplicate', { category, count: check.count ?? 0 });
      case 'category_spike':
        return t('checkSpike', { category, usual, currency });
      case 'low_income_day':
        return t(check.side === 'bar' ? 'checkLowBarSales' : 'checkLowIncome', { usual, currency });
      case 'repeated_shortage':
        return t('checkShortages', { count: check.count ?? 0 });
    }
  })();
  const when = check.date
    ? formatDateShort(check.date, locale)
    : `${formatDateShort(check.range.from, locale)} – ${formatDateShort(check.range.to, locale)}`;
  const side = check.side === 'bar' ? td('bar') : check.side === 'game_club' ? td('gameClub') : null;

  return (
    <li>
      <TappableSurface href={moneyCheckHref(check, access)} chevron={false} className="-mx-2 rounded-xl px-2 py-2.5 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <IconChip icon={KIND_ICONS[check.kind]} tone={check.severity} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-950">{sentence}</p>
            <p className="text-xs text-gray-500">{side ? `${side} · ${when}` : when}</p>
          </div>
          <p className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-gray-950">
            {formatCurrency(check.amount)} <span className="text-xs font-medium text-gray-500">{currency}</span>
          </p>
        </div>
      </TappableSurface>
    </li>
  );
}

/**
 * "Worth a look": what in the month looks off (a repeated payment, a category
 * far above its usual level, a weak day, repeated cash shortages), each row
 * opening the records behind it. A month with nothing unusual gets one quiet line.
 */
export function MoneyChecksPanel({ checks, labelFor, access, currency, locale }: {
  checks: MoneyCheck[];
  labelFor: (category: string) => string;
  /** What the member may open; a row whose records sit on a closed page stays plain. */
  access: MoneyCheckAccess;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('financialAnalysis');
  const headingId = useId();

  if (!checks.length) {
    return (
      <section aria-label={t('checksTitle')}>
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-success-600" />
          {t('checksNone')}
        </p>
      </section>
    );
  }

  return (
    <Card as="section" aria-labelledby={headingId}>
      <SectionHeading
        title={<span id={headingId}>{t('checksTitle')}</span>}
        description={t('checksDesc')}
        badge={<Badge variant={checks.some((check) => check.severity === 'danger') ? 'danger' : 'warning'}>{checks.length}</Badge>}
      />
      <ul className="mt-2 divide-y divide-gray-100">
        {checks.map((check) => (
          <CheckRow
            key={moneyCheckKey(check)}
            check={check}
            labelFor={labelFor}
            access={access}
            currency={currency}
            locale={locale}
          />
        ))}
      </ul>
    </Card>
  );
}

/** The panel while it loads: heading and three check rows. */
export function MoneyChecksPanelSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton />
      <div className="mt-4 space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-56 max-w-full" />
              <Skeleton className="h-3 w-28 bg-gray-100" />
            </div>
            <Skeleton className="h-3 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}
