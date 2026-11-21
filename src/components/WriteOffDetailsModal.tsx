'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, ButtonLink, Modal, Money } from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatDateOnly, formatNumber, formatUnitCurrency } from '@/lib/formatters';
import { closingStockHref } from '@/lib/detailLinks';
import { writeOffKindVariant, writeOffUnitCost, type StockAdjustmentReportKind, type StockWriteOffEntry } from '@/lib/stockWriteOffs';

/** A write-off, or a correction (`sign` +1) that added units back. */
type AdjustmentDetails = Omit<StockWriteOffEntry, 'kind'> & { kind: StockAdjustmentReportKind; sign?: 1 | -1 };

/**
 * One bar write-off's or correction's details, with a link to the closing
 * stock count it was recorded on. `showCost` false hides the money (non-owners).
 */
export function WriteOffDetailsModal({ entry, onClose, showCost = true }: { entry: AdjustmentDetails | null; onClose: () => void; showCost?: boolean }) {
  const t = useTranslations('reports');
  const tcs = useTranslations('closingStock');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const unitCost = entry ? writeOffUnitCost(entry) : null;
  const added = entry?.sign === 1;
  const quantityText = entry ? `${added ? '+' : ''}${t('writeOffsUnits', { count: formatNumber(entry.quantity) })}` : '';

  return (
    <Modal open={Boolean(entry)} onClose={onClose} title={added ? t('correctionDetails') : t('writeOffDetails')}>
      {entry && (
        <div className="space-y-5">
          <div>
            <Badge variant={writeOffKindVariant(added ? 'correction' : entry.kind)}>{tcs(`writeOffKinds.${added ? 'correction' : entry.kind}`)}</Badge>
            <p className="mt-3 text-lg font-semibold text-gray-900">{entry.productName || tcs('unknownProduct')}</p>
            <p className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${added ? 'text-success-600' : 'text-danger-600'}`}>
              {showCost
                ? <Money amount={entry.cost} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
                : quantityText}
            </p>
          </div>
          <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
            {[
              { label: t('date'), value: formatDateOnly(entry.date, locale) },
              { label: t('writeOffsQuantity'), value: quantityText },
              ...(showCost ? [{
                label: t('writeOffsUnitCost'),
                value: unitCost === null ? '—' : `${formatUnitCurrency(unitCost)} ${tc('currency')}`,
              }] : []),
              { label: t('writeOffsNote'), value: entry.note || '—' },
            ].map((item) => (
              <div key={item.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{item.label}</dt>
                <dd className="break-words text-right font-semibold tabular-nums text-gray-900">{item.value}</dd>
              </div>
            ))}
          </dl>
          <ButtonLink
            href={closingStockHref(entry.date)}
            variant="secondary"
            className="w-full"
            iconRight={<ArrowRight size={15} aria-hidden="true" />}
          >
            {t('writeOffsOpenDay')}
          </ButtonLink>
        </div>
      )}
    </Modal>
  );
}
