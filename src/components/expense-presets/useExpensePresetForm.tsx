'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  CurrencyInput,
  Field,
  InlineAlert,
  Input,
  Modal,
  SegmentedControl,
  Select,
} from '@/components/PresentationFoundation';
import type { ExpensePreset, ExpensePresetSource } from '@/lib/calculations/expensePlans';
import { isExpenseCategoryAllowedForSource, manualExpenseCategoriesFor } from '@/lib/expenseCategories';
import { formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import { PAYMENT_METHODS, type EntryPaymentMethod } from '@/types';
import { createClient } from '@/lib/supabase/client';

const SOURCES: ExpensePresetSource[] = ['game_club', 'bar'];

export function paymentMethodIcon(method: EntryPaymentMethod, size = 16) {
  const Icon = PAYMENT_METHOD_ICONS[method];
  return <Icon size={size} aria-hidden="true" />;
}

interface PresetForm {
  id: string | null;
  /** Category and money source are fixed once a payment links to the preset (093); null while checking. */
  termsLocked: boolean | null;
  name: string;
  category: string;
  payment_source: ExpensePresetSource;
  /** '' when the plan has no usual payment method. */
  payment_method: EntryPaymentMethod | '';
  /** The method saved before this edit, so clearing it is written too. */
  saved_payment_method: EntryPaymentMethod | null;
  monthly_amount: string;
}

/** What a new plan starts with, for a plan suggested from past spending. */
export interface ExpensePresetPrefill {
  name?: string;
  category?: string;
  payment_source?: ExpensePresetSource;
  monthly_amount?: number;
}

const emptyForm: PresetForm = { id: null, termsLocked: false, name: '', category: '', payment_source: 'game_club', payment_method: '', saved_payment_method: null, monthly_amount: '' };

/**
 * The one form that adds or edits a planned expense, as a dialog. Settings
 * opens it from the plan list; Financial Analysis opens it prefilled from a
 * suggestion. Only an owner may manage plans, so the dialog never opens for
 * anyone else (`enabled`).
 */
export function useExpensePresetForm({ clubId, presets, enabled, onSaved }: {
  clubId: string;
  /** The club's live presets: the new plan's position and the duplicate-name check. */
  presets: readonly ExpensePreset[];
  enabled: boolean;
  onSaved: () => void | Promise<void>;
}): { openPresetForm: (preset: ExpensePreset | null, prefill?: ExpensePresetPrefill) => void; presetFormDialog: ReactNode } {
  const t = useTranslations('settings.expensePresets');
  const tExpenses = useTranslations('expenses');
  const tc = useTranslations('common');
  const { enabledPaymentMethods } = useClub();
  const [form, setForm] = useState<PresetForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function openPresetForm(preset: ExpensePreset | null, prefill?: ExpensePresetPrefill) {
    setFormError('');
    if (preset) void checkTermsLocked(preset.id);
    setForm(preset
      ? {
        id: preset.id,
        termsLocked: null,
        name: preset.name,
        category: preset.category,
        payment_source: preset.payment_source,
        payment_method: preset.payment_method ?? '',
        saved_payment_method: preset.payment_method ?? null,
        monthly_amount: formatCurrencyInput(preset.monthly_amount),
      }
      : {
        ...emptyForm,
        name: prefill?.name ?? '',
        category: prefill?.category ?? '',
        payment_source: prefill?.payment_source ?? emptyForm.payment_source,
        monthly_amount: prefill?.monthly_amount ? formatCurrencyInput(prefill.monthly_amount) : '',
      });
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
    const duplicate = presets.some((preset) => preset.id !== form.id && preset.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setFormError(t('duplicateName'));
      return;
    }
    const values = {
      name,
      monthly_amount: parseCurrencyInput(form.monthly_amount),
      // Locked terms are left out, so the 093 guard never sees a change to them.
      ...(form.termsLocked ? {} : { category: form.category, payment_source: form.payment_source }),
      // Sent only when set or cleared, so a database without 094 still saves plans.
      ...(form.payment_method || form.saved_payment_method ? { payment_method: form.payment_method || null } : {}),
    };
    setSaving(true);
    setFormError('');
    const supabase = createClient();
    const { error } = form.id
      ? await supabase.from('expense_presets').update(values).eq('club_id', clubId).eq('id', form.id).select('id').single()
      : await supabase.from('expense_presets').insert({ club_id: clubId, sort_order: presets.length, ...values }).select('id').single();
    setSaving(false);
    if (error) {
      setFormError(error.code === '23505'
        ? t('duplicateName')
        : /cannot change/i.test(error.message) ? t('termsLocked') : t('saveError'));
      return;
    }
    setForm(null);
    await onSaved();
  }

  const presetFormDialog = (
    <Modal
      open={form !== null && enabled}
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
              {manualExpenseCategoriesFor(form.payment_source).map((category) => (
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
              onChange={(source) => setForm({
                ...form,
                payment_source: source,
                // Bar money pays only for cleaning and food/drinks.
                category: isExpenseCategoryAllowedForSource(form.category, source) ? form.category : '',
              })}
              options={SOURCES.map((source) => ({ value: source, label: tExpenses(`paymentSources.${source}`) }))}
            />
          </Field>
          <Field label={tExpenses('paymentMethod')} hint={t('paymentMethodHelp')}>
            <SegmentedControl
              variant="chips"
              label={tExpenses('paymentMethod')}
              value={form.payment_method}
              onChange={(method) => setForm({ ...form, payment_method: method })}
              options={[
                { value: '' as const, label: t('paymentMethodAny') },
                // A method the club has since switched off stays visible while the plan still uses it.
                ...PAYMENT_METHODS
                  .filter((method) => enabledPaymentMethods.includes(method) || method === form.saved_payment_method)
                  .map((method) => ({ value: method, label: tc(`paymentMethods.${method}`), icon: paymentMethodIcon(method) })),
              ]}
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
  );

  return { openPresetForm, presetFormDialog };
}
