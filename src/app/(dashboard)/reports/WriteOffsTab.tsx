'use client';

import { StockAdjustmentsLedger } from '@/components/stock-adjustments/StockAdjustmentsLedger';

/** Reports' Write-offs tab: the period's bar write-offs and corrections, valued at cost (owner only). */
export default function WriteOffsTab({ clubId, from, to }: { clubId: string | null; from: string; to: string }) {
  return <StockAdjustmentsLedger clubId={clubId} from={from} to={to} showCost />;
}
