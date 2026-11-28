'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleDollarSign, HandCoins, Landmark, PiggyBank } from 'lucide-react';
import { Button, Card, Money, SectionHeading, SkeletonStatus, StatTile, toneForAmount } from '@/components/PresentationFoundation';
import type { MoneyReportPaymentBreakdown } from '@/lib/calculations/moneyReport';
import { formatDollars } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { PaymentMethodFigure } from './MethodDaysModal';
import { MoneyTilesSkeleton, moneyTilesGridClassName } from './ReportsSkeleton';

/**
 * Where the Game Club's money is right now (169): with the admin, with the
 * collector, and in the owner reserve. Three places, not parts of one total.
 * The figures are always today's, whatever period the page shows.
 * An owner can put money into the reserve from here; the form is the reserve's own.
 */
export function MoneyWhereabouts({ loading, title, description, kassa, collected, reserve, kassaLabel, kassaHelper, collectedLabel, collectedHelper, reserveLabel, reserveHelper, onKassaClick, onCollectedClick, kassaSelected, reserveDepositLabel, onReserveDeposit }: {
  loading: boolean;
  title: string;
  /** Says the figures are today's, when the page shows another period. */
  description?: string;
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
  /** Owner: opens the reserve deposit form (ReserveDepositModal); shown beside the reserve, with its label. */
  reserveDepositLabel?: string;
  onReserveDeposit?: () => void;
}) {
  const count = reserve === null ? 2 : 3;
  const depositAction = reserve !== null && onReserveDeposit && reserveDepositLabel ? (
    <Button variant="outline" size="sm" onClick={onReserveDeposit} icon={<PiggyBank size={16} aria-hidden="true" />}>
      {reserveDepositLabel}
    </Button>
  ) : undefined;
  /** The place's name over one muted line saying what money that is. */
  const place = (label: string, helper: string) => <>{label}<span className="block font-normal">{helper}</span></>;
  return (
    <Card as="section">
      <SectionHeading size="sm" title={title} description={description} action={depositAction} />
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
 * the dollars tile, dollars held at the period's end over the period's own
 * movement, opens the exchanges behind it.
 */
export function PaymentMethodTiles({ loading, skeletonCount, title, description, methods, data, usd, usdChange, usdLabel, usdChangeLabel, usdNote, onSelectMethod, onSelectUsd }: {
  loading: boolean;
  /** Tiles to draw while loading. */
  skeletonCount: number;
  title: string;
  description: string;
  methods: readonly PaymentMethodTile[];
  data: Record<PaymentMethodFigure, MoneyReportPaymentBreakdown>;
  /** Dollars held at the period's end; the tile is drawn when it or `usdChange` is not zero. */
  usd: number;
  /** Dollars bought minus sold and spent in the period. */
  usdChange: number;
  usdLabel: string;
  /** Names `usdChange` on the tile's second line. */
  usdChangeLabel: string;
  usdNote: string;
  onSelectMethod: (method: PaymentMethodFigure) => void;
  onSelectUsd: () => void;
}) {
  const showUsd = usd !== 0 || usdChange !== 0;
  const count = methods.length + (showUsd ? 1 : 0);
  const usdChangeText = `${usdChange > 0 ? '+' : ''}${formatDollars(usdChange)}`;
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
            {showUsd && (
              <StatTile
                variant="soft"
                icon={CircleDollarSign}
                label={<>{usdLabel}<span className="block font-normal">{usdChangeLabel}: {usdChangeText}</span></>}
                value={formatDollars(usd)}
                tone={usd < 0 ? 'danger' : 'success'}
                onClick={onSelectUsd}
              />
            )}
          </div>
          {showUsd && <p className="mt-2 text-xs text-gray-500">{usdLabel}: {usdNote}</p>}
        </>
      )}
    </Card>
  );
}
