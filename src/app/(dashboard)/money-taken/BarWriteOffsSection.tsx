'use client';

import { useState } from 'react';
import { ArrowRight, ChevronRight, Clock, MessageSquareText, PackageMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, ButtonLink, EmptyState, SectionHeading } from '@/components/PresentationFoundation';
import { capitalizeFirst, formatCurrency, formatDateOnly, formatNumber, formatYearMonth } from '@/lib/formatters';
import { WriteOffDetailsModal } from '@/components/WriteOffDetailsModal';
import { writeOffEntryKey, writeOffKindVariant, type StockWriteOffEntry, type StockWriteOffSummary } from '@/lib/stockWriteOffs';
import { monthRange } from '@/lib/utils';

interface BarWriteOffsSectionProps {
  /** YYYY-MM shown on the page. */
  month: string;
  summary: StockWriteOffSummary;
}

/** The month's bar write-offs at cost: already taken off bar profit, listed so the loss is visible here. */
export function BarWriteOffsSection({ month, summary }: BarWriteOffsSectionProps) {
  const t = useTranslations('moneyTaken');
  const tcs = useTranslations('closingStock');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const [selected, setSelected] = useState<StockWriteOffEntry | null>(null);
  const { from, to } = monthRange(month);
  const kinds = (['shortage', 'expired'] as const).filter((kind) => summary.byKind[kind].quantity > 0);

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
            <PackageMinus size={20} aria-hidden="true" />
          </span>
          <SectionHeading
            title={t('writeOffsTitle', { month: capitalizeFirst(formatYearMonth(month, locale), locale) })}
            description={t('writeOffsDescription')}
          />
        </div>
        <ButtonLink
          href={`/reports?view=writeOffs&from=${from}&to=${to}`}
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
        <>
          <dl className="grid grid-cols-2 gap-3 border-b border-gray-100 px-4 py-4 sm:grid-cols-4 sm:px-5">
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
          <ul className="divide-y divide-gray-100">
            {summary.entries.map((entry) => (
              <li key={writeOffEntryKey(entry)}>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/80 focus-visible:bg-primary-50 focus-visible:outline-none sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-gray-900">{entry.productName || tcs('unknownProduct')}</span>
                      <Badge size="sm" variant={writeOffKindVariant(entry.kind)}>{tcs(`writeOffKinds.${entry.kind}`)}</Badge>
                    </div>
                    {entry.note ? (
                      <p className="mt-1 flex gap-1.5 text-sm leading-5 text-gray-600">
                        <MessageSquareText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                        <span className="min-w-0 break-words">{entry.note}</span>
                      </p>
                    ) : null}
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                      <Clock size={12} aria-hidden="true" />
                      {formatDateOnly(entry.date, locale)} · {formatNumber(entry.quantity)} {tcs('pcs')}
                    </p>
                  </div>
                  <p className="whitespace-nowrap pt-1 text-right text-base font-bold tabular-nums text-danger-600">
                    −{formatCurrency(entry.cost)}
                    <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                  </p>
                  <ChevronRight size={16} aria-hidden="true" className="mt-1.5 shrink-0 text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <WriteOffDetailsModal entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}
