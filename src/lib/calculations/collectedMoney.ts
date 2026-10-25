import type { MoneyReportDay } from './moneyReport';

/** The collection facts a Reports date carries once it is ticked (096). */
export interface CollectionMark {
  date: string;
  collected_at: string;
  collector_name: string | null;
}

/** One collected date: who took the money, when, and how much of each method. */
export interface CollectedDay {
  date: string;
  collectedAt: string;
  collectorName: string | null;
  cash: number;
  terminal: number;
  card: number;
  playstation: number;
  /** Game-club money left on the day, the same figure as the closeout day row. */
  total: number;
}

export interface CollectedMoneySummary {
  /** Newest date first, like the closeout table. */
  days: CollectedDay[];
  taken: Omit<CollectedDay, 'date' | 'collectedAt' | 'collectorName'>;
  /** Dates in the period that carry money but are not ticked yet. */
  pendingDays: number;
  pendingTotal: number;
}

/**
 * What collectors have taken in a period: each ticked date with its money left
 * by method, their totals, and the money still waiting on unticked dates.
 * A ticked date with no entries still shows, with zeros.
 */
export function summarizeCollectedMoney(days: MoneyReportDay[], collections: CollectionMark[]): CollectedMoneySummary {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const collectedDates = new Set(collections.map((collection) => collection.date));
  const collected = collections
    .map((collection): CollectedDay => {
      const day = byDate.get(collection.date);
      return {
        date: collection.date,
        collectedAt: collection.collected_at,
        collectorName: collection.collector_name,
        cash: day?.cash ?? 0,
        terminal: day?.terminal ?? 0,
        card: day?.card ?? 0,
        playstation: day?.playstation ?? 0,
        total: day?.total ?? 0,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const taken = collected.reduce(
    (sum, day) => ({
      cash: sum.cash + day.cash,
      terminal: sum.terminal + day.terminal,
      card: sum.card + day.card,
      playstation: sum.playstation + day.playstation,
      total: sum.total + day.total,
    }),
    { cash: 0, terminal: 0, card: 0, playstation: 0, total: 0 },
  );
  const pending = days.filter((day) => !collectedDates.has(day.date) && day.total !== 0);
  return {
    days: collected,
    taken,
    pendingDays: pending.length,
    pendingTotal: pending.reduce((sum, day) => sum + day.total, 0),
  };
}
