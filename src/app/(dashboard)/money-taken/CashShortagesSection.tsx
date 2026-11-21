'use client';

import { ChevronRight, Clock, MessageSquareText, Plus, TriangleAlert, Trash2, Undo2, UserRound } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, Button, ButtonLink, EmptyState, IconButton, IconChip, Modal, SectionHeading, TappableSurface } from '@/components/PresentationFoundation';
import { dayRange, employeeSalaryHref, reportsHref } from '@/lib/detailLinks';
import { SHORTAGE_METHOD_ICONS } from '@/components/cash-shortages/CashShortageForm';
import { cashShortageTotalsForMonth, recoverableAmount, type CashShortageSummary } from '@/lib/calculations/cashShortages';
import { capitalizeFirst, formatCurrency, formatDateOnly, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { OWNER_WITHDRAWAL_SOURCES } from '@/types';
import { SOURCE_ICONS, SOURCE_TONES } from '@/components/owner-money/profitIcons';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = summaries.find((row) => row.shortage.id === selectedId) ?? null;
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
          <IconChip icon={TriangleAlert} tone="danger" />
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
            const side = totals[source];
            return (
              <div key={source} className="rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <IconChip icon={SOURCE_ICONS[source]} tone={SOURCE_TONES[source]} size="sm" />
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
                    <dd className={cn('mt-0.5 whitespace-nowrap font-bold tabular-nums', side.lost > 0 ? 'text-danger-600' : 'text-gray-500')}>{formatCurrency(side.lost)}</dd>
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
              <li key={shortage.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <IconChip icon={TriangleAlert} tone="danger" />
                <div className="min-w-0 flex-1">
                  <TappableSurface onClick={() => setSelectedId(shortage.id)} chevron={false} className="-mx-1 rounded-md px-1 py-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-gray-900">{t(`reasons.${shortage.reason}`)}</span>
                    <Badge size="sm" variant="outline">{t(`sources.${shortage.payment_source}`)}</Badge>
                    <Badge size="sm" variant="outline" icon={<MethodIcon size={12} aria-hidden="true" />}>
                      {tc(`paymentMethods.${shortage.payment_method}`)}
                    </Badge>
                    <ChevronRight size={14} aria-hidden="true" className="text-gray-400" />
                    </span>
                  </TappableSurface>
                  {employee ? (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700">
                      <UserRound size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
                      {shortage.employee_id ? (
                        <Link href={employeeSalaryHref(shortage.employee_id)} className="hover:underline">{employee}</Link>
                      ) : employee}
                    </p>
                  ) : null}
                  <p className="mt-1 flex gap-1.5 text-sm leading-5 text-gray-600">
                    <MessageSquareText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                    <span className="min-w-0 break-words">{shortage.comment}</span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
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
                        {t('lostShort')} <span className={cn('font-semibold tabular-nums', lost > 0 ? 'text-danger-600' : 'text-gray-500')}>{formatCurrency(lost)}</span>
                      </p>
                    ) : null}
                  </div>
                  <IconButton
                    variant="danger"
                    size="sm"
                    label={`${tc('delete')}: ${t(`reasons.${shortage.reason}`)} · ${formatCurrency(Number(shortage.amount))} ${tc('currency')}`}
                    icon={<Trash2 size={16} aria-hidden="true" />}
                    loading={busyId === shortage.id}
                    disabled={disabled}
                    onClick={() => onDelete(summary)}
                    className="mt-0.5"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <Modal
          open
          onClose={() => setSelectedId(null)}
          size="md"
          title={t(`reasons.${selected.shortage.reason}`)}
          footer={(
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  loading={busyId === selected.shortage.id}
                  disabled={disabled}
                  onClick={() => {
                    onDelete(selected);
                    setSelectedId(null);
                  }}
                >
                  {tc('delete')}
                </Button>
                {recoverableAmount(selected) > 0 ? (
                  <Button
                    variant="outline"
                    icon={<Undo2 size={15} aria-hidden="true" />}
                    disabled={disabled}
                    onClick={() => {
                      onRecover(selected);
                      setSelectedId(null);
                    }}
                  >
                    {t('recoverButton')}
                  </Button>
                ) : null}
              </div>
              <Button variant="secondary" onClick={() => setSelectedId(null)}>{tc('close')}</Button>
            </div>
          )}
        >
          <p className="text-2xl font-bold tabular-nums text-danger-600">−{money(Number(selected.shortage.amount))}</p>
          <dl className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm">
            {[
              { label: t('detailsDate'), value: formatDateOnly(selected.shortage.date, locale) },
              {
                label: t('detailsTakenFrom'),
                value: `${t(`sources.${selected.shortage.payment_source}`)} · ${tc(`paymentMethods.${selected.shortage.payment_method}`)}`,
              },
              ...(selected.shortage.employee_id
                ? [{ label: t('detailsEmployee'), value: employeeNames[selected.shortage.employee_id] ?? t('removedEmployee') }]
                : []),
              { label: t('recoveredShort'), value: `${formatCurrency(selected.recovered)} ${tc('currency')}` },
              { label: t('lostShort'), value: `${formatCurrency(selected.lost)} ${tc('currency')}` },
              { label: t('detailsRecordedAt'), value: formatDateTime(selected.shortage.created_at, locale) },
              ...(selected.shortage.comment ? [{ label: t('detailsComment'), value: selected.shortage.comment }] : []),
            ].map((fact) => (
              <div key={fact.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-gray-500">{fact.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-gray-900">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <ButtonLink
              href={reportsHref(dayRange(selected.shortage.date))}
              variant="secondary"
              className="flex-1"
            >
              {t('detailsOpenDay')}
            </ButtonLink>
            {selected.shortage.employee_id ? (
              <ButtonLink href={employeeSalaryHref(selected.shortage.employee_id)} variant="secondary" className="flex-1">
                {t('detailsOpenEmployee')}
              </ButtonLink>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
