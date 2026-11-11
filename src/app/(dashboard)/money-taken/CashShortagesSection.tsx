'use client';

import { Clock, MessageSquareText, Plus, TriangleAlert, Trash2, Undo2, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, Button, EmptyState, IconButton, SectionHeading } from '@/components/PresentationFoundation';
import { SHORTAGE_METHOD_ICONS } from '@/components/cash-shortages/CashShortageForm';
import { cashShortageTotalsForMonth, recoverableAmount, type CashShortageSummary } from '@/lib/calculations/cashShortages';
import { capitalizeFirst, formatCurrency, formatDateOnly, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { OWNER_WITHDRAWAL_SOURCES } from '@/types';
import { SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';

interface CashShortagesSectionProps {
  /** YYYY-MM shown on the page. */
  month: string;
  summaries: readonly CashShortageSummary[];
  employeeNames: Readonly<Record<string, string>>;
  busyId: string | null;
  disabled: boolean;
  onRecord: () => void;
  onRecover: (summary: CashShortageSummary) => void;
  onDelete: (summary: CashShortageSummary) => void;
}

/** The month's cash shortages: what went missing, what was taken back from salary, and what is actually lost. */
export function CashShortagesSection({ month, summaries, employeeNames, busyId, disabled, onRecord, onRecover, onDelete }: CashShortagesSectionProps) {
  const t = useTranslations('cashShortages');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const monthRows = summaries.filter((row) => row.shortage.date.slice(0, 7) === month);
  const totals = cashShortageTotalsForMonth(summaries, month);
  const sides = OWNER_WITHDRAWAL_SOURCES.filter((source) => totals[source].amount > 0);
  const money = (amount: number) => (
    <>
      {formatCurrency(amount)}
      <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
    </>
  );

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
            <TriangleAlert size={20} aria-hidden="true" />
          </span>
          <SectionHeading
            title={t('sectionTitle', { month: capitalizeFirst(formatYearMonth(month, locale), locale) })}
            description={t('sectionDescription')}
          />
        </div>
        <Button variant="outline" size="sm" className="shrink-0 self-start" disabled={disabled} onClick={onRecord} icon={<Plus size={16} aria-hidden="true" />}>
          {t('addButton')}
        </Button>
      </div>

      {sides.length > 0 ? (
        <div className="grid gap-3 border-b border-gray-100 px-4 py-4 sm:grid-cols-2 sm:px-5">
          {sides.map((source) => {
            const SourceIcon = SOURCE_ICONS[source];
            const side = totals[source];
            return (
              <div key={source} className="rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', SOURCE_TINTS[source].bubble)}>
                    <SourceIcon size={15} aria-hidden="true" />
                  </span>
                  {t(`sources.${source}`)}
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">{t('missing')}</dt>
                    <dd className="mt-0.5 whitespace-nowrap font-semibold tabular-nums text-gray-900">{formatCurrency(side.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('recoveredShort')}</dt>
                    <dd className="mt-0.5 whitespace-nowrap font-semibold tabular-nums text-success-600">{formatCurrency(side.recovered)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('lost')}</dt>
                    <dd className={cn('mt-0.5 whitespace-nowrap font-bold tabular-nums', side.lost > 0 ? 'text-danger-600' : 'text-gray-400')}>{formatCurrency(side.lost)}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      ) : null}

      {monthRows.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState compact title={t('empty')} />
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {monthRows.map((summary) => {
            const { shortage, recovered, lost } = summary;
            const MethodIcon = SHORTAGE_METHOD_ICONS[shortage.payment_method];
            const employee = shortage.employee_id ? employeeNames[shortage.employee_id] ?? t('removedEmployee') : null;
            const canRecover = recoverableAmount(summary) > 0;
            return (
              <li key={shortage.id} className="group flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
                  <TriangleAlert size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-gray-900">{t(`reasons.${shortage.reason}`)}</span>
                    <Badge size="sm" variant="outline">{t(`sources.${shortage.payment_source}`)}</Badge>
                    <Badge size="sm" variant="outline" icon={<MethodIcon size={12} aria-hidden="true" />}>
                      {tc(`paymentMethods.${shortage.payment_method}`)}
                    </Badge>
                  </div>
                  {employee ? (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700">
                      <UserRound size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
                      {employee}
                    </p>
                  ) : null}
                  <p className="mt-1 flex gap-1.5 text-sm leading-5 text-gray-600">
                    <MessageSquareText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                    <span className="min-w-0 break-words">{shortage.comment}</span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                    <Clock size={12} aria-hidden="true" />
                    {formatDateOnly(shortage.date, locale)}
                  </p>
                  {canRecover ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 mt-1"
                      disabled={disabled}
                      onClick={() => onRecover(summary)}
                      icon={<Undo2 size={15} aria-hidden="true" />}
                    >
                      {t('recoverButton')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-start gap-3">
                  <div className="text-right">
                    <p className="whitespace-nowrap pt-1 text-base font-bold tabular-nums text-danger-600 sm:text-lg">−{money(Number(shortage.amount))}</p>
                    {recovered > 0 ? (
                      <p className="mt-0.5 whitespace-nowrap text-xs text-gray-500">
                        {t('recoveredShort')} <span className="font-semibold tabular-nums text-success-600">{formatCurrency(recovered)}</span>
                      </p>
                    ) : null}
                    {recovered > 0 ? (
                      <p className="whitespace-nowrap text-xs text-gray-500">
                        {t('lostShort')} <span className={cn('font-semibold tabular-nums', lost > 0 ? 'text-danger-600' : 'text-gray-400')}>{formatCurrency(lost)}</span>
                      </p>
                    ) : null}
                  </div>
                  <IconButton
                    variant="danger"
                    size="sm"
                    label={`${tc('delete')}: ${t(`reasons.${shortage.reason}`)} · ${formatCurrency(Number(shortage.amount))} ${tc('currency')}`}
                    icon={<Trash2 size={16} />}
                    loading={busyId === shortage.id}
                    disabled={disabled}
                    onClick={() => onDelete(summary)}
                    className={cn('mt-0.5 transition-opacity', busyId !== shortage.id && 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
