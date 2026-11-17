'use client';

import { ArrowRight, CheckCircle2, CircleAlert, Archive, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, ButtonLink, Card, MetricMoney, SectionHeading, Skeleton } from '@/components/PresentationFoundation';
import { formatDateOnly, formatDateShort } from '@/lib/formatters';
import type { DashboardTodayStatus } from '@/lib/calculations/dashboardAttention';

/** Skipped days are listed up to this many; the rest become "and N more". */
const MAX_LISTED_DATES = 4;

function TodayTask({ icon: Icon, title, done, doneLabel, missingLabel, amountLabel, amount, currency, missedDates, href, actionLabel, loading, locale }: {
  icon: LucideIcon;
  title: string;
  done: boolean;
  doneLabel: string;
  missingLabel: string;
  amountLabel: string;
  amount: number;
  currency: string;
  missedDates: string[];
  /** Omitted when the member cannot open the page. */
  href?: string;
  actionLabel: string;
  loading: boolean;
  locale: string;
}) {
  const t = useTranslations('dashboard');
  const listed = missedDates.slice(-MAX_LISTED_DATES).map((date) => formatDateShort(date, locale)).join(', ');
  const hidden = missedDates.length - Math.min(missedDates.length, MAX_LISTED_DATES);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-gray-50 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          <p className="min-w-0 break-words text-sm font-semibold text-gray-950">{title}</p>
        </div>
        {loading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <Badge
            variant={done ? 'success' : 'warning'}
            icon={done ? <CheckCircle2 size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
          >
            {done ? doneLabel : missingLabel}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{amountLabel}</p>
          <p className="mt-0.5 text-lg font-bold leading-tight tracking-tight tabular-nums text-gray-950">
            {loading ? '—' : <MetricMoney amount={amount} currency={currency} />}
          </p>
        </div>
        {href && (
          <ButtonLink
            href={href}
            variant={done || loading ? 'secondary' : 'primary'}
            size="sm"
            iconRight={<ArrowRight size={15} aria-hidden="true" />}
          >
            {actionLabel}
          </ButtonLink>
        )}
      </div>
      {!loading && missedDates.length > 0 && (
        <p className="text-xs leading-5 text-warning-700">
          {t('todayMissedDays', { dates: listed })}
          {hidden > 0 ? ` ${t('todayMissedMore', { count: hidden })}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * The two things done every shift, with what was entered for the current
 * business date and which earlier days of the month were skipped.
 */
export function DashboardToday({ status, businessToday, locale, currency, loading, cashHref, stockHref }: {
  status: DashboardTodayStatus;
  businessToday: string;
  locale: string;
  currency: string;
  loading: boolean;
  cashHref?: string;
  stockHref?: string;
}) {
  const t = useTranslations('dashboard');
  return (
    <Card as="section" aria-label={t('todayTitle')}>
      <SectionHeading title={t('todayTitle')} description={formatDateOnly(businessToday, locale)} size="sm" />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <TodayTask
          icon={Wallet}
          title={t('todayCash')}
          done={status.cashEntered}
          doneLabel={t('todayCashDone')}
          missingLabel={t('todayCashMissing')}
          amountLabel={t('todayGameClub')}
          amount={status.gameClubIncome}
          currency={currency}
          missedDates={status.missingCashDates}
          href={cashHref}
          actionLabel={status.cashEntered ? t('todayOpen') : t('todayEnterCash')}
          loading={loading}
          locale={locale}
        />
        <TodayTask
          icon={Archive}
          title={t('todayStock')}
          done={status.stockSaved}
          doneLabel={t('todayStockDone')}
          missingLabel={t('todayStockMissing')}
          amountLabel={t('todayBar')}
          amount={status.barSales}
          currency={currency}
          missedDates={status.missingStockDates}
          href={stockHref}
          actionLabel={status.stockSaved ? t('todayOpen') : t('todayCountStock')}
          loading={loading}
          locale={locale}
        />
      </div>
    </Card>
  );
}
