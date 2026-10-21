'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import {
  BAR_COST_TARGET,
  foldCategories,
  groupExpensesByCategory,
  type AnalysisLedgers,
  type IncomeSourceKey,
} from '@/lib/calculations/financialAnalysis';
import {
  BAR_LEFT,
  GAME_CLUB_LEFT,
  MORE_PAYMENTS,
  NOTE_PREFIX,
  NO_COMMENT,
  PAID_FROM_BAR,
  PAID_FROM_GAME_CLUB,
  buildDrillSankey,
  type DrillNode,
  type DrillSankey,
  type DrillTarget,
} from '@/lib/calculations/sankeyDrill';
import { categoryColors, drillNodeColor } from './analysisFormat';
import { SankeyDrillModal } from './SankeyDrillModal';
import { SankeyFlowChart } from './SankeyFlowChart';

export interface MoneyFlowCard {
  title: string;
  description?: string;
  /** Header content beside the title, e.g. a badge or a details link. */
  action?: ReactNode;
  /** Content under the chart, e.g. a few figures for that side. */
  footer?: ReactNode;
}

export interface MoneyFlowSankeysProps {
  /** The period's ledgers; the game club and the bar each get their own Sankey. */
  ledgers: AnalysisLedgers;
  range: { from: string; to: string };
  periodLabel: string;
  locale: string;
  currency: string;
  gameClub: MoneyFlowCard;
  bar: MoneyFlowCard;
  /** Category colours shared with other charts on the page; derived from the ledgers when omitted. */
  colors?: Record<string, string>;
  className?: string;
}

/**
 * The game club and bar money flows as two separate Sankeys. Tapping a node
 * that leads further opens its own Sankey in a dialog, which can keep going.
 */
export function MoneyFlowSankeys({
  ledgers,
  range,
  periodLabel,
  locale,
  currency,
  gameClub,
  bar,
  colors: sharedColors,
  className,
}: MoneyFlowSankeysProps) {
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const tCategories = useTranslations('expenses.categories');
  // The trail stays set while its dialog closes, so the content does not vanish mid-animation.
  const [drillTrail, setDrillTrail] = useState<DrillTarget[]>([]);
  const [drillOpen, setDrillOpen] = useState(false);

  const derivedColors = useMemo(
    () => (sharedColors ? null : categoryColors(foldCategories(groupExpensesByCategory(ledgers.expenseRows)))),
    [ledgers.expenseRows, sharedColors],
  );
  const colors = sharedColors ?? derivedColors ?? {};

  const categoryName = useCallback((category: string) => {
    if (category === BAR_COST_TARGET) return t('barCost');
    return tCategories.has(category)
      ? tCategories(category as Parameters<typeof tCategories>[0])
      : category.replace(/_/g, ' ');
  }, [t, tCategories]);
  const drillNames: Record<string, string> = {
    [GAME_CLUB_LEFT]: t('drill.gameClubLeft'),
    [BAR_LEFT]: t('drill.barLeft'),
    [PAID_FROM_GAME_CLUB]: t('paidFromGameClub'),
    [PAID_FROM_BAR]: t('paidFromBar'),
    [NO_COMMENT]: t('drawerNoComment'),
    [MORE_PAYMENTS]: t('drill.morePayments'),
  };
  const nodeName = (key: string) => {
    if (key in drillNames) return drillNames[key];
    if (key.startsWith(NOTE_PREFIX)) return key.slice(NOTE_PREFIX.length);
    if (t.has(`sources.${key}`)) return t(`sources.${key as IncomeSourceKey}`);
    return categoryName(key);
  };
  const drillTitle = (target: DrillTarget) => {
    if (target.kind === 'gameClub') return td('gameClub');
    if (target.kind === 'bar') return td('bar');
    return categoryName(target.category);
  };
  const openDrill = (node: DrillNode | undefined) => {
    if (!node?.open) return;
    setDrillTrail([node.open]);
    setDrillOpen(true);
  };

  const gameClubSankey = useMemo(() => buildDrillSankey({ kind: 'gameClub' }, ledgers), [ledgers]);
  const barSankey = useMemo(() => buildDrillSankey({ kind: 'bar' }, ledgers), [ledgers]);

  const flowCard = (card: MoneyFlowCard, sankey: DrillSankey, hubLabel: string) => {
    const sources = new Map(sankey.sources.map((node, index) => [node.key, { node, index }]));
    const targets = new Map(sankey.targets.map((node, index) => [node.key, { node, index }]));
    return (
      <ChartCard title={card.title} description={card.description} action={card.action}>
        <div className="mt-4">
          {sankey.total > 0 ? (
            <SankeyFlowChart
              sankey={sankey}
              hubLabel={hubLabel}
              sourceLabel={nodeName}
              targetLabel={nodeName}
              sourceColor={(key) => drillNodeColor(key, sources.get(key)?.index ?? 0, colors)}
              targetColor={(key) => drillNodeColor(key, targets.get(key)?.index ?? 0, colors)}
              locale={locale}
              currency={currency}
              onSourceClick={(key) => openDrill(sources.get(key)?.node)}
              isSourceClickable={(key) => Boolean(sources.get(key)?.node.open)}
              onTargetClick={(key) => openDrill(targets.get(key)?.node)}
              isTargetClickable={(key) => Boolean(targets.get(key)?.node.open)}
              openLabel={(name) => t('openFlow', { name })}
            />
          ) : (
            <ChartEmpty title={t('empty')} />
          )}
        </div>
        {card.footer}
      </ChartCard>
    );
  };

  return (
    <>
      <div className={className}>
        {flowCard(gameClub, gameClubSankey, td('gameClub'))}
        {flowCard(bar, barSankey, td('bar'))}
      </div>

      <SankeyDrillModal
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
        trail={drillTrail}
        onTrailChange={setDrillTrail}
        ledgers={ledgers}
        range={range}
        titleFor={drillTitle}
        labelFor={nodeName}
        colorFor={(key, index) => drillNodeColor(key, index, colors)}
        periodLabel={periodLabel}
        locale={locale}
        currency={currency}
      />
    </>
  );
}
