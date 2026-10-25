'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import type { ExpensePreset, ExpensePresetSource } from '@/lib/calculations/expensePlans';
import { MANUAL_EXPENSE_CATEGORIES } from '@/lib/expenseCategories';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import { createClient } from '@/lib/supabase/client';
import { fetchExpensePresets, type ExpensePresetsResult } from '@/lib/supabase/expensePresets';
import { useClubQuery } from '@/lib/useClubQuery';
import { SettingsSection } from './SettingsSection';

const SOURCES: ExpensePresetSource[] = ['game_club', 'bar'];
/** The features whose members may read planned expenses (the 091 read policy). */
const READ_FEATURES = ['dashboard', 'expenses', 'reports', 'owner_profit'] as const;

interface PresetForm {
  id: string | null;
  /** Category and money source are fixed once a payment links to the preset (093); null while checking. */
  termsLocked: boolean | null;
  name: string;
  category: string;
  payment_source: ExpensePresetSource;
  monthly_amount: string;
}

const emptyForm: PresetForm = { id: null, termsLocked: false, name: '', category: '', payment_source: 'game_club', monthly_amount: '' };

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
  const [form, setForm] = useState<PresetForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => fetchExpensePresets(createClient(), clubId), [clubId]);
  const query = useClubQuery<ExpensePresetsResult | null>(load, null);
  const live = (query.data?.presets ?? []).filter((preset) => !preset.archived_at);

  if (query.data && !query.data.available) return null;

  function edit(preset: ExpensePreset | null) {
    setFormError('');
    if (preset) void checkTermsLocked(preset.id);
    setForm(preset
      ? {
        id: preset.id,
        termsLocked: null,
        name: preset.name,
        category: preset.category,
        payment_source: preset.payment_source,
        monthly_amount: formatCurrencyInput(preset.monthly_amount),
      }
      : emptyForm);
  }

  /** Whether any expense already counts against the preset; on a failed read the fields stay locked. */
  async function checkTermsLocked(presetId: string) {
    const { data, error } = await createClient()
      .from('expenses')
      .select('id')
      .eq('club_id', clubId)
      .eq('preset_id', presetId)
      .limit(1);
    const termsLocked = Boolean(error) || (data?.length ?? 0) > 0;
    setForm((current) => (current?.id === presetId ? { ...current, termsLocked } : current));
  }

  function close() {
    if (saving) return;
    setForm(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name || !form.category) {
      setFormError(tc('required'));
      return;
    }
    const duplicate = live.some((preset) => preset.id !== form.id && preset.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setFormError(t('duplicateName'));
      return;
    }
    const values = {
      name,
      monthly_amount: parseCurrencyInput(form.monthly_amount),
      // Locked terms are left out, so the 093 guard never sees a change to them.
      ...(form.termsLocked ? {} : { category: form.category, payment_source: form.payment_source }),
    };
    setSaving(true);
    setFormError('');
    const supabase = createClient();
    const { error } = form.id
      ? await supabase.from('expense_presets').update(values).eq('club_id', clubId).eq('id', form.id).select('id').single()
      : await supabase.from('expense_presets').insert({ club_id: clubId, sort_order: live.length, ...values }).select('id').single();
    setSaving(false);
    if (error) {
      setFormError(error.code === '23505'
        ? t('duplicateName')
        : /cannot change/i.test(error.message) ? t('termsLocked') : t('saveError'));
      return;
    }
    setForm(null);
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

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
        <p className="px-5 py-3 text-[13px] leading-5 text-gray-500">{t('help')}</p>
        {query.error ? (
          <div className="px-5 py-4">
            <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadError')}</LoadErrorAlert>
          </div>
        ) : !query.data ? (
          <div className="space-y-2 px-5 py-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : live.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">{t('empty')}</p>
        ) : (
          <ul aria-label={t('title')} className="divide-y divide-gray-100">
            {live.map((preset) => (
              <li key={preset.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-950">{preset.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span>{tExpenses(`categories.${preset.category}` as Parameters<typeof tExpenses>[0])}</span>
                    <Badge size="sm" variant="outline">{tExpenses(`paymentSources.${preset.payment_source}`)}</Badge>
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

      <Modal
        open={form !== null && isOwner}
        onClose={close}
        locked={saving}
        title={form?.id ? t('editTitle') : t('add')}
        size="sm"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={close}>{tc('cancel')}</Button>
            <Button type="submit" form="expense-preset-form" loading={saving} loadingLabel={tc('saving')}>{tc('save')}</Button>
          </>
        )}
      >
        {form && (
          <form id="expense-preset-form" onSubmit={save} className="space-y-4">
            <Field label={t('name')} htmlFor="expense-preset-name" required>
              <Input
                id="expense-preset-name"
                autoFocus
                maxLength={60}
                placeholder={t('namePlaceholder')}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={tExpenses('category')} htmlFor="expense-preset-category" required>
              <Select
                id="expense-preset-category"
                disabled={form.termsLocked !== false}
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                <option value="" disabled>{tExpenses('selectCategory')}</option>
                {MANUAL_EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{tExpenses(`categories.${category}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tExpenses('paymentSource')} hint={form.termsLocked ? t('termsLocked') : undefined}>
              <SegmentedControl
                variant="soft"
                label={tExpenses('paymentSource')}
                value={form.payment_source}
                disabled={form.termsLocked !== false}
                onChange={(source) => setForm({ ...form, payment_source: source })}
                options={SOURCES.map((source) => ({ value: source, label: tExpenses(`paymentSources.${source}`) }))}
              />
            </Field>
            <Field label={t('monthlyAmount')} htmlFor="expense-preset-amount" hint={t('monthlyAmountHelp')}>
              <CurrencyInput
                id="expense-preset-amount"
                value={form.monthly_amount}
                onValueChange={(value) => setForm({ ...form, monthly_amount: value })}
                trailingAddon={tc('currency')}
              />
            </Field>
            {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}
          </form>
        )}
      </Modal>
      {confirmDialog}
      {toastElement}
    </SettingsSection>
  );
}
