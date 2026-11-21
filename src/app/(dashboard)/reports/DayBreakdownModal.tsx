'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button, CategoryIcon, Checkbox, Modal, Money, SegmentedControl } from '@/components/PresentationFoundation';
import {
  activityKey,
  contributionsTo,
  dayFigure,
  dayWithout,
  rowsOfDay,
  type DayFigure,
  type DayRows,
} from '@/lib/calculations/dayExclusion';
import type { MoneyReportActivity, MoneyReportDay } from '@/lib/calculations/moneyReport';
import { formatDateOnly, formatTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type View = 'all' | DayFigure;

interface DayBreakdownModalProps {
  /** The closeout day the header showed; null closes the dialog. */
  day: MoneyReportDay | null;
  /** The figure the owner tapped. */
  figure: DayFigure;
  /** Rows the closeout was built from; only the day's own are used. */
  rows: DayRows;
  /** Label of each figure, as the day header names it. */
  figureLabels: Record<DayFigure, string>;
  activityTypeLabel: (activity: MoneyReportActivity) => string;
  categoryLabel: (activity: MoneyReportActivity) => string;
  onClose: () => void;
}

function toneClassName(amount: number): string {
  return amount < 0 ? 'text-danger-600' : 'text-gray-900';
}

/**
 * Lists the entries behind a closeout day's figures and lets the owner leave
 * some out to see the day without them. A preview only: nothing is saved.
 */
export function DayBreakdownModal(props: DayBreakdownModalProps) {
  // Remount per day and tapped figure so exclusions start empty each time.
  return props.day ? <DayBreakdown key={`${props.day.date}:${props.figure}`} {...props} day={props.day} /> : null;
}

function DayBreakdown({
  day,
  figure,
  rows,
  figureLabels,
  activityTypeLabel,
  categoryLabel,
  onClose,
}: DayBreakdownModalProps & { day: MoneyReportDay }) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [view, setView] = useState<View>(figure);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());

  const dayRows = useMemo(() => rowsOfDay(rows, day), [rows, day]);
  const adjusted = useMemo(() => dayWithout(dayRows, day.date, excluded), [dayRows, day.date, excluded]);
  const contributions = useMemo(
    () => (view === 'all' ? null : contributionsTo(dayRows, day, view)),
    [dayRows, day, view],
  );

  // Methods appear when the day touched them; the rest would only be zeros.
  const figures = (['income', 'expenses', 'barExpenses', 'cash', 'terminal', 'card', 'playstation'] as const)
    .filter((key) => key === 'income' || key === 'expenses' || key === figure || dayFigure(day, key) !== 0);

  const entries = day.activities.filter((activity) => {
    if (!contributions) return true;
    const key = activityKey(activity);
    return key !== null && contributions.get(key) !== 0;
  });

  function toggle(key: string, include: boolean) {
    setExcluded((current) => {
      const next = new Set(current);
      if (include) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function figureRow(label: ReactNode, before: number, after: number, key: string, strong = false) {
    const changed = before !== after;
    return (
      <div key={key} className={cn('flex items-baseline justify-between gap-3 py-1.5', strong && 'border-t border-gray-100 pt-2.5')}>
        <dt className={cn('text-gray-600', strong && 'font-semibold text-gray-900')}>{label}</dt>
        <dd className="flex shrink-0 items-baseline gap-2 tabular-nums">
          {changed && (
            <>
              <Money amount={before} currency={null} className="text-xs text-gray-500 line-through" />
              <ArrowRight size={12} className="self-center text-gray-400" aria-hidden="true" />
            </>
          )}
          <Money
            amount={after}
            currency={null}
            className={cn('font-semibold', toneClassName(after), changed && 'text-primary-700')}
          />
        </dd>
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t('dayBreakdownTitle', { date: formatDateOnly(day.date, locale) })}
      description={t('dayBreakdownDescription')}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-500">{excluded.size > 0 && t('excludedCount', { count: excluded.size })}</span>
          <div className="flex gap-2">
            {excluded.size > 0 && (
              <Button variant="outline" onClick={() => setExcluded(new Set())}>{t('includeAll')}</Button>
            )}
            <Button variant="primary" onClick={onClose}>{tc('close')}</Button>
          </div>
        </div>
      )}
    >
      <dl className="rounded-xl bg-gray-50 px-4 py-2 text-sm" data-testid="day-breakdown-figures">
        {figures.map((key) => figureRow(figureLabels[key], dayFigure(day, key), dayFigure(adjusted, key), key))}
        {figureRow(t('dayTotal'), day.total, adjusted.total, 'total', true)}
      </dl>

      <SegmentedControl
        className="mt-4"
        variant="chips"
        size="sm"
        label={t('dayBreakdownTitle', { date: formatDateOnly(day.date, locale) })}
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: t('allEntries') },
          ...figures.map((key) => ({ value: key, label: figureLabels[key] })),
        ]}
      />

      <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {entries.map((activity, index) => {
          const key = activityKey(activity);
          // Expense figures add up spending; the entry itself still reads as money out.
          const contribution = key && contributions ? contributions.get(key) ?? 0 : null;
          const amount = contribution === null
            ? activity.amount
            : (view === 'expenses' || view === 'barExpenses' ? -contribution : contribution);
          const included = key === null || !excluded.has(key);
          return (
            <li key={key ?? `row-${index}`} className={cn('flex items-start justify-between gap-3 px-3 py-2.5', !included && 'opacity-50')}>
              <Checkbox
                checked={included}
                disabled={key === null}
                onChange={(event) => key && toggle(key, event.target.checked)}
                label={(
                  <span className="flex items-center gap-2">
                    <CategoryIcon
                      size="sm"
                      category={activity.category}
                      kind={activity.kind === 'debt_payment' ? 'debtPayment' : activity.kind}
                      tone={activity.kind === 'expense' && activity.paymentSource === 'bar' ? 'bar' : undefined}
                    />
                    <span className={cn(!included && 'line-through')}>
                      {activityTypeLabel(activity)} · {categoryLabel(activity)}
                    </span>
                  </span>
                )}
                description={[
                  formatTime(activity.createdAt, locale),
                  activity.createdByName,
                  activity.comment,
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Money
                amount={amount}
                showPlus
                currency={null}
                className={cn('shrink-0 text-sm font-semibold tabular-nums', amount < 0 ? 'text-danger-600' : 'text-success-600')}
              />
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
