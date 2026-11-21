'use client';

import { ArrowRight, PackageMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { ButtonLink, EmptyState, IconChip, SectionHeading } from '@/components/PresentationFoundation';
import { reportsHref } from '@/lib/detailLinks';
import { capitalizeFirst, formatCurrency, formatNumber, formatYearMonth } from '@/lib/formatters';
import type { StockWriteOffSummary } from '@/lib/stockWriteOffs';
import { monthRange } from '@/lib/utils';

interface BarWriteOffsSectionProps {
  /** YYYY-MM shown on the page. */
  month: string;
  summary: StockWriteOffSummary;
}

/**
 * The month's bar write-offs at cost: already taken off bar profit, shown here
 * as the month's loss only. The entries themselves live in the write-offs
 * ledger (Reports), which the link opens for this month.
 */
export function BarWriteOffsSection({ month, summary }: BarWriteOffsSectionProps) {
  const t = useTranslations('moneyTaken');
  const tcs = useTranslations('closingStock');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const kinds = (['shortage', 'expired'] as const).filter((kind) => summary.byKind[kind].quantity > 0);

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <IconChip icon={PackageMinus} tone="danger" />
          <SectionHeading
            title={t('writeOffsTitle', { month: capitalizeFirst(formatYearMonth(month, locale), locale) })}
            description={t('writeOffsDescription')}
          />
        </div>
        <ButtonLink
          href={reportsHref(monthRange(month), { view: 'writeOffs' })}
          variant="ghost"
          size="sm"
          className="shrink-0 self-start"
          iconRight={<ArrowRight size={15} aria-hidden="true" />}
        >
          {t('writeOffsAll')}
        </ButtonLink>
      </div>

      {summary.entries.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState compact title={t('writeOffsEmpty')} />
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 sm:px-5">
          <div>
            <dt className="text-xs text-gray-500">{t('writeOffsLoss')}</dt>
            <dd className="mt-0.5 whitespace-nowrap font-bold tabular-nums text-danger-600">
              {formatCurrency(summary.total.cost)}
              <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
            </dd>
          </div>
          {kinds.map((kind) => (
            <div key={kind}>
              <dt className="text-xs text-gray-500">{tcs(`writeOffKinds.${kind}`)}</dt>
              <dd className="mt-0.5 whitespace-nowrap font-semibold tabular-nums text-gray-900">
                {formatCurrency(summary.byKind[kind].cost)}
                <span className="ml-1 text-xs font-normal text-gray-500">· {formatNumber(summary.byKind[kind].quantity)} {tcs('pcs')}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
