'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleDollarSign, HandCoins, Landmark, PiggyBank } from 'lucide-react';
import { Card, Money, SectionHeading, SkeletonStatus, StatTile, toneForAmount } from '@/components/PresentationFoundation';
import type { MoneyReportPaymentBreakdown } from '@/lib/calculations/moneyReport';
import { formatDollars } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { PaymentMethodFigure } from './MethodDaysModal';
import { MoneyTilesSkeleton, moneyTilesGridClassName } from './ReportsSkeleton';

/**
 * Where the Game Club's money is right now (169): with the admin, with the
 * collector, and in the owner reserve. Three places, not parts of one total.
 */
export function MoneyWhereabouts({ loading, title, kassa, collected, reserve, kassaLabel, kassaHelper, collectedLabel, collectedHelper, reserveLabel, reserveHelper, onKassaClick, onCollectedClick, kassaSelected }: {
  loading: boolean;
  title: string;
  kassa: number;
  collected: number;
  /** Null when the viewer cannot read the reserve. */
  reserve: number | null;
  kassaLabel: string;
  kassaHelper: string;
  collectedLabel: string;
  collectedHelper: string;
  reserveLabel: string;
  reserveHelper: string;
  /** Narrows the closeout to the days whose money is still with the admin; a second tap clears it. */
  onKassaClick: () => void;
  onCollectedClick: () => void;
  kassaSelected: boolean;
}) {
  const count = reserve === null ? 2 : 3;
  /** The place's name over one muted line saying what money that is. */
  const place = (label: string, helper: string) => <>{label}<span className="block font-normal">{helper}</span></>;
  return (
    <Card as="section">
      <SectionHeading size="sm" title={title} />
      {loading ? (
        <SkeletonStatus><MoneyTilesSkeleton count={count} tall className="mt-3" /></SkeletonStatus>
      ) : (
        <div className={cn(moneyTilesGridClassName(count), 'mt-3')}>
          <StatTile variant="soft" icon={Landmark} label={place(kassaLabel, kassaHelper)} value={<Money amount={kassa} currencyClassName="text-xs tracking-normal text-gray-500" />} tone={toneForAmount(kassa, 'primary')} onClick={onKassaClick} selected={kassaSelected} />
          <StatTile variant="soft" icon={HandCoins} label={place(collectedLabel, collectedHelper)} value={<Money amount={collected} currencyClassName="text-xs tracking-normal text-gray-500" />} tone="success" onClick={onCollectedClick} />
          {reserve !== null && (
            <StatTile variant="soft" icon={PiggyBank} label={place(reserveLabel, reserveHelper)} value={<Money amount={reserve} currencyClassName="text-xs tracking-normal text-gray-500" />} href="/reserve" />
          )}
        </div>
      )}
    </Card>
  );
}

export interface PaymentMethodTile {
  method: PaymentMethodFigure;
  label: string;
  icon: LucideIcon;
}

/**
 * What each payment method has left for the period, one tile per method. A
 * tile opens the method's full breakdown and its days (`MethodDaysModal`);
 * the dollars tile opens the exchanges behind it.
 */
export function PaymentMethodTiles({ loading, skeletonCount, title, description, methods, data, usd, usdLabel, usdNote, onSelectMethod, onSelectUsd }: {
  loading: boolean;
  /** Tiles to draw while loading. */
  skeletonCount: number;
  title: string;
  description: string;
  methods: readonly PaymentMethodTile[];
  data: Record<PaymentMethodFigure, MoneyReportPaymentBreakdown>;
  /** Dollars held; the tile is drawn only when it is not zero. */
  usd: number;
  usdLabel: string;
  usdNote: string;
  onSelectMethod: (method: PaymentMethodFigure) => void;
  onSelectUsd: () => void;
}) {
  const count = methods.length + (usd !== 0 ? 1 : 0);
  return (
    <Card as="section">
      <SectionHeading size="sm" title={title} description={description} />
      {loading ? (
        <SkeletonStatus><MoneyTilesSkeleton count={skeletonCount} className="mt-3" /></SkeletonStatus>
      ) : (
        <>
          <div className={cn(moneyTilesGridClassName(count), 'mt-3')}>
            {methods.map(({ method, label, icon }) => (
              <StatTile
                key={method}
                variant="soft"
                icon={icon}
                label={label}
                value={<Money amount={data[method].left} currencyClassName="text-xs tracking-normal text-gray-500" />}
                tone={data[method].left < 0 ? 'danger' : 'success'}
                onClick={() => onSelectMethod(method)}
              />
            ))}
            {usd !== 0 && (
              <StatTile variant="soft" icon={CircleDollarSign} label={usdLabel} value={formatDollars(usd)} tone={usd < 0 ? 'danger' : 'success'} onClick={onSelectUsd} />
            )}
          </div>
          {usd !== 0 && <p className="mt-2 text-xs text-gray-500">{usdLabel}: {usdNote}</p>}
        </>
      )}
    </Card>
  );
}
