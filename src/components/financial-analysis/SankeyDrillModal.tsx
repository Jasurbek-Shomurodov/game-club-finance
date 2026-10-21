'use client';

import { useMemo } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink, Modal } from '@/components/PresentationFoundation';
import { ChartEmpty } from '@/components/dashboard/ChartCard';
import type { AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import {
  buildDrillSankey,
  drillDetailsHref,
  drillExpenseRows,
  type DrillNode,
  type DrillTarget,
} from '@/lib/calculations/sankeyDrill';
import { SankeyFlowChart } from './SankeyFlowChart';
import { PaymentList } from './PaymentList';

export interface SankeyDrillModalProps {
  open: boolean;
  onClose: () => void;
  /** Drill-downs opened so far, the shown one last; Back drops the last. */
  trail: DrillTarget[];
  onTrailChange: (trail: DrillTarget[]) => void;
  ledgers: AnalysisLedgers;
  /** The period shown; the details link opens its page filtered to it. */
  range: { from: string; to: string };
  titleFor: (target: DrillTarget) => string;
  labelFor: (key: string) => string;
  colorFor: (key: string, index: number) => string;
  periodLabel: string;
  locale: string;
  currency: string;
}

/**
 * The Sankey behind a tapped node of the money flow, in a dialog over the page.
 * A node or flow in it that leads further opens its own Sankey in the same
 * dialog; Back returns to the one before. A category lists its payments below.
 */
export function SankeyDrillModal({
  open,
  onClose,
  trail,
  onTrailChange,
  ledgers,
  range,
  titleFor,
  labelFor,
  colorFor,
  periodLabel,
  locale,
  currency,
}: SankeyDrillModalProps) {
  const t = useTranslations('financialAnalysis');
  const tc = useTranslations('common');
  const td = useTranslations('dashboard');
  const current = trail.at(-1);
  const sankey = useMemo(() => (current ? buildDrillSankey(current, ledgers) : null), [current, ledgers]);
  const payments = useMemo(
    () => (current?.kind === 'category' ? drillExpenseRows(current, ledgers.expenseRows) : null),
    [current, ledgers.expenseRows],
  );

  const nodes = (list: DrillNode[] | undefined) => new Map((list ?? []).map((node, index) => [node.key, { node, index }]));
  const sources = nodes(sankey?.sources);
  const targets = nodes(sankey?.targets);
  const go = (node: DrillNode | undefined) => {
    if (node?.open) onTrailChange([...trail, node.open]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      className="sm:max-w-4xl"
      title={current ? titleFor(current) : null}
      description={periodLabel}
    >
      {current && sankey && (
        <div className="space-y-5">
          <div className="-mx-2 flex items-center justify-between gap-2">
            {trail.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<ArrowLeft size={16} aria-hidden="true" />}
                onClick={() => onTrailChange(trail.slice(0, -1))}
              >
                {tc('back')}
              </Button>
            ) : <span />}
            {/* Opens the page behind this flow with its period and category filters applied. */}
            <ButtonLink
              href={drillDetailsHref(current, range)}
              variant="secondary"
              size="sm"
              iconRight={<ArrowRight size={15} aria-hidden="true" />}
            >
              {td('details')}
            </ButtonLink>
          </div>
          {sankey.total > 0 ? (
            <SankeyFlowChart
              // A new drill-down draws afresh rather than keeping the last one's hover.
              key={trail.length}
              sankey={sankey}
              hubLabel={titleFor(current)}
              sourceLabel={labelFor}
              targetLabel={labelFor}
              sourceColor={(key) => colorFor(key, sources.get(key)?.index ?? 0)}
              targetColor={(key) => colorFor(key, targets.get(key)?.index ?? 0)}
              locale={locale}
              currency={currency}
              onSourceClick={(key) => go(sources.get(key)?.node)}
              isSourceClickable={(key) => Boolean(sources.get(key)?.node.open)}
              onTargetClick={(key) => go(targets.get(key)?.node)}
              isTargetClickable={(key) => Boolean(targets.get(key)?.node.open)}
              openLabel={(name) => t('openFlow', { name })}
            />
          ) : (
            <ChartEmpty title={t('empty')} />
          )}
          {payments && (
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-950">{t('drawerPayments')}</h3>
              <PaymentList
                rows={payments}
                showCategory={current.kind === 'category' && Boolean(current.named)}
                labelFor={labelFor}
                locale={locale}
                currency={currency}
              />
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

