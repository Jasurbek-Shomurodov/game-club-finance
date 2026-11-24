'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, CalendarClock, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  EmptyState,
  IconButton,
  LoadErrorAlert,
  Skeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import type { ExpensePreset } from '@/lib/calculations/expensePlans';
import { formatCurrency } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import { paymentMethodIcon, useExpensePresetForm } from '@/components/expense-presets/useExpensePresetForm';
import { createClient } from '@/lib/supabase/client';
import { announceActivity } from '@/lib/activityNotices';
import { fetchExpensePresets, type ExpensePresetsResult } from '@/lib/supabase/expensePresets';
import { useClubQuery } from '@/lib/useClubQuery';
import { SettingsSection } from './SettingsSection';

/** The features whose members may read planned expenses (the 091 read policy). */
const READ_FEATURES = ['dashboard', 'expenses', 'reports', 'owner_profit'] as const;

/** Owner-managed list of the club's recurring expenses and their monthly plan. */
export function ExpensePresetsSection({ clubId, isOwner }: { clubId: string; isOwner: boolean }) {
  const { featureAccess } = useClub();
  const canRead = READ_FEATURES.some((feature) => featureAccess.includes(feature));
  return canRead ? <PresetList clubId={clubId} isOwner={isOwner} /> : null;
}

function PresetList({ clubId, isOwner }: { clubId: string; isOwner: boolean }) {
  const t = useTranslations('settings.expensePresets');
  const tExpenses = useTranslations('expenses');
  const tc = useTranslations('common');
  const { confirm, confirmDialog } = useConfirm();
  const { showToast, toastElement } = useToast();

  const load = useCallback(() => fetchExpensePresets(createClient(), clubId), [clubId]);
  const query = useClubQuery<ExpensePresetsResult | null>(load, null);
  const live = (query.data?.presets ?? []).filter((preset) => !preset.archived_at);
  const { openPresetForm: edit, presetFormDialog } = useExpensePresetForm({
    clubId,
    presets: live,
    enabled: isOwner,
    onSaved: async () => {
      showToast(t('saved'));
      await query.reload({ silent: true });
    },
  });

  if (query.data && !query.data.available) return null;

  async function archive(preset: ExpensePreset) {
    const confirmed = await confirm({
      title: t('archiveTitle', { name: preset.name }),
      description: t('archiveDescription'),
      confirmLabel: t('archive'),
      tone: 'danger',
    });
    if (!confirmed) return;
    const { error } = await createClient()
      .from('expense_presets')
      .update({ archived_at: new Date().toISOString() })
      .eq('club_id', clubId)
      .eq('id', preset.id)
      .select('id')
      .single();
    if (error) {
      showToast(t('saveError'), 'error');
      return;
    }
    announceActivity(clubId);
    showToast(t('archived'));
    await query.reload({ silent: true });
  }

  return (
    <SettingsSection
      title={t('title')}
      aside={isOwner ? (
        <Button size="sm" variant="outline" icon={<Plus size={15} aria-hidden="true" />} onClick={() => edit(null)}>
          {t('add')}
        </Button>
      ) : undefined}
    >
      <Card padding="none" className="divide-y divide-gray-100 overflow-hidden">
        <p className="px-5 py-3 text-xs leading-5 text-gray-500">{t('help')}</p>
        {query.error ? (
          <div className="px-5 py-4">
            <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadError')}</LoadErrorAlert>
          </div>
        ) : !query.data ? (
          <div className="space-y-3 px-5 py-4">{[0, 1].map((row) => <div key={row} className="flex items-center gap-3"><Skeleton className="h-9 w-9 shrink-0 rounded-xl" /><Skeleton className="h-10 flex-1" /></div>)}</div>
        ) : live.length === 0 ? (
          <EmptyState compact icon={CalendarClock} title={t('empty')} />
        ) : (
          <ul aria-label={t('title')} className="divide-y divide-gray-100">
            {live.map((preset) => (
              <li key={preset.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <CategoryIcon category={preset.category} tone={preset.payment_source === 'bar' ? 'bar' : 'expense'} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-semibold text-gray-950">{preset.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span>{tExpenses(`categories.${preset.category}` as Parameters<typeof tExpenses>[0])}</span>
                    <Badge size="sm" variant="outline">{tExpenses(`paymentSources.${preset.payment_source}`)}</Badge>
                    {preset.payment_method && (
                      <Badge size="sm" variant="outline" icon={paymentMethodIcon(preset.payment_method, 12)}>
                        {tc(`paymentMethods.${preset.payment_method}`)}
                      </Badge>
                    )}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-950">
                  {formatCurrency(preset.monthly_amount)}
                  <span className="ml-1 text-xs font-normal text-gray-500">{tc('currency')} / {t('perMonth')}</span>
                </p>
                {isOwner && (
                  <div className="flex shrink-0 gap-1">
                    <IconButton size="sm" variant="ghost" label={t('edit', { name: preset.name })} icon={<Pencil size={15} aria-hidden="true" />} onClick={() => edit(preset)} />
                    <IconButton size="sm" variant="danger" label={t('archiveTitle', { name: preset.name })} icon={<Archive size={15} aria-hidden="true" />} onClick={() => void archive(preset)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {presetFormDialog}
      {confirmDialog}
      {toastElement}
    </SettingsSection>
  );
}
