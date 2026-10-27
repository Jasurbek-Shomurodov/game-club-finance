'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Drawer, StatTile } from '@/components/PresentationFoundation';
import { chartColors } from '@/components/dashboard/ChartCard';
import { formatCurrency } from '@/lib/formatters';
import { OTHER_CATEGORY, type CategoryDetail } from '@/lib/calculations/financialAnalysis';
import { formatShare } from './analysisFormat';
import { PaymentDetails } from './PaymentDetails';
import { PaymentList } from './PaymentList';

export interface CategoryDrawerProps {
  open: boolean;
  onClose: () => void;
  detail: CategoryDetail | null;
  color: string;
  labelFor: (category: string) => string;
  periodLabel: string;
  locale: string;
  currency: string;
  /** Hide the previous-period comparison where there is no earlier period (the overall view). */
  showPrevious?: boolean;
}

/** Slide-in panel with every payment behind one expense category of the period; a payment opens its details in the panel. */
export function CategoryDrawer({ open, onClose, detail, color, labelFor, periodLabel, locale, currency, showPrevious = true }: CategoryDrawerProps) {
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  // The opened payment, kept per category so another category opens on its list.
  const [opened, setOpened] = useState<{ category: string; id: string } | null>(null);
  const payment = detail && opened?.category === detail.category ? detail.rows.find((row) => row.id === opened.id) : undefined;
  const money = (amount: number) => `${formatCurrency(amount)} ${currency}`;
  const up = (detail?.changePct ?? 0) > 0;

  return (
    <Drawer
      open={open}
      onClose={() => { setOpened(null); onClose(); }}
      title={detail ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
          {labelFor(detail.category)}
        </span>
      ) : null}
      description={(
        <>
          {periodLabel}
          {detail?.category === OTHER_CATEGORY && <span className="mt-1 block">{t('drawerOtherHint')}</span>}
        </>
      )}
    >
      {detail && payment && (
        <div className="space-y-4">
          <Button type="button" variant="ghost" size="sm" className="-ml-2" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => setOpened(null)}>
            {tc('back')}
          </Button>
          <PaymentDetails row={payment} labelFor={labelFor} locale={locale} currency={currency} />
        </div>
      )}
      {detail && !payment && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <StatTile variant="soft" size="sm" label={t('drawerTotal')} value={formatCurrency(detail.total)} unit={currency} />
            <StatTile variant="soft" size="sm" label={t('drawerShare')} value={formatShare(detail.share, locale)} />
            <StatTile variant="soft" size="sm" label={t('drawerCount')} value={detail.count} />
            <StatTile variant="soft" size="sm" label={t('drawerAverage')} value={formatCurrency(detail.average)} unit={currency} />
          </div>

          {showPrevious && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <span className="text-gray-500">{t('previous')}: <span className="font-semibold tabular-nums text-gray-900">{money(detail.previousTotal)}</span></span>
              {detail.changePct === null ? (
                <Badge variant="neutral">{detail.total > 0 ? t('newItem') : '—'}</Badge>
              ) : (
                <Badge variant={detail.changePct === 0 ? 'neutral' : up ? 'danger' : 'success'} className="tabular-nums">
                  {up ? '+' : detail.changePct < 0 ? '−' : ''}{formatShare(Math.abs(detail.changePct), locale)}
                </Badge>
              )}
            </div>
          )}

          {detail.total > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500">{t('drawerPaidFrom')}</p>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                <div style={{ width: `${(detail.gameClubTotal / detail.total) * 100}%`, backgroundColor: chartColors.primary }} />
                <div style={{ width: `${(detail.barTotal / detail.total) * 100}%`, backgroundColor: chartColors.orange }} />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: chartColors.primary }} aria-hidden="true" />
                  {td('gameClub')} · <span className="tabular-nums">{money(detail.gameClubTotal)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: chartColors.orange }} aria-hidden="true" />
                  {td('bar')} · <span className="tabular-nums">{money(detail.barTotal)}</span>
                </span>
              </div>
            </div>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-gray-950">{t('drawerPayments')}</h3>
            <PaymentList rows={detail.rows} showCategory={detail.category === OTHER_CATEGORY} labelFor={labelFor} locale={locale} currency={currency}
              onOpen={(row) => setOpened({ category: detail.category, id: row.id })}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}
