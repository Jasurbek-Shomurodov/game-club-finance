'use client';

// Route: /promotions

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CurrencyInput,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  PageHeader,
  SectionHeading,
  Select,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency, formatCurrencyInput, formatDateOnly, formatNumber, formatUnitCurrency } from '@/lib/formatters';
import { fetchActiveProductsOrdered } from '@/lib/supabase/products';
import { fetchPromotions } from '@/lib/supabase/promotions';
import {
  buildPromotionPayload,
  promotionStatus,
  validatePromotionForm,
  type PromotionForm,
  type PromotionStatus,
} from '@/lib/promotions';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Product, Promotion } from '@/types';

const emptyForm = (today: string): PromotionForm => ({
  name: '',
  product_id: '',
  free_quantity: '1',
  min_spend: '',
  starts_on: today,
  ends_on: '',
  is_active: true,
});

const STATUS_BADGE: Record<PromotionStatus, 'success' | 'primary' | 'neutral' | 'warning'> = {
  active: 'success',
  scheduled: 'primary',
  ended: 'neutral',
  inactive: 'warning',
};

interface PromotionsData {
  promotions: Promotion[];
  products: Product[];
}

const EMPTY_PROMOTIONS: PromotionsData = { promotions: [], products: [] };

export default function PromotionsPage() {
  const t = useTranslations('promotions');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, role: currentRole, businessDayStartHour } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const today = useBusinessToday(businessDayStartHour);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromotionForm>(() => emptyForm(today));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isOwner = currentRole === 'owner';

  const loadPromotions = useCallback(async (): Promise<PromotionsData> => {
    if (!selectedClubId) return EMPTY_PROMOTIONS;
    const supabase = createClient();
    const [promotionsRes, productsRes] = await Promise.all([
      fetchPromotions(supabase, selectedClubId),
      fetchActiveProductsOrdered(supabase, selectedClubId),
    ]);
    if (promotionsRes.error || productsRes.error) throw new Error('Promotions load failed');
    return { promotions: promotionsRes.data ?? [], products: productsRes.data ?? [] };
  }, [selectedClubId]);
  const query = useClubQuery(loadPromotions, EMPTY_PROMOTIONS);
  const { promotions, products } = query.data;
  const { loading, error: loadError, reload } = query;

  // An open editor belongs to the previous club; never save it against the new one.
  useEffect(() => {
    setModalOpen(false);
    setEditingId(null);
  }, [selectedClubId]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  function openAdd() {
    if (!isOwner) return;
    setEditingId(null);
    setForm(emptyForm(today));
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(promotion: Promotion) {
    if (!isOwner) return;
    setEditingId(promotion.id);
    setForm({
      name: promotion.name,
      product_id: promotion.product_id,
      free_quantity: String(promotion.free_quantity),
      min_spend: formatCurrencyInput(promotion.min_spend),
      starts_on: promotion.starts_on,
      ends_on: promotion.ends_on ?? '',
      is_active: promotion.is_active,
    });
    setFormError('');
    setModalOpen(true);
  }

  function set<K extends keyof PromotionForm>(field: K, value: PromotionForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault();
    if (!isOwner || !selectedClubId) return;
    const validation = validatePromotionForm(form);
    if (validation) {
      setFormError(t(`error_${validation}`));
      return;
    }
    setSaving(true);
    setFormError('');
    const supabase = createClient();
    const payload = buildPromotionPayload(form);
    let err: string | null = null;
    if (editingId) {
      const { data, error } = await supabase
        .from('promotions')
        .update(payload)
        .eq('club_id', selectedClubId)
        .eq('id', editingId)
        .select('id');
      // RLS silently filters rows the user may not update; zero rows is a failure.
      err = error ? t('saveFailed') : (data?.length ?? 0) === 0 ? t('saveNoRows') : null;
    } else {
      const { error } = await supabase.from('promotions').insert({ ...payload, club_id: selectedClubId });
      err = error ? t('saveFailed') : null;
    }
    setSaving(false);
    if (err) {
      setFormError(err);
      return;
    }
    setModalOpen(false);
    showToast(t('saved'));
    await reload({ silent: true });
  }

  async function handleDelete() {
    if (!editingId || !isOwner || !selectedClubId) return;
    const confirmed = await confirm({
      title: t('deletePromotion'),
      description: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    const { data, error } = await createClient()
      .from('promotions')
      .delete()
      .eq('club_id', selectedClubId)
      .eq('id', editingId)
      .select('id');
    setDeleting(false);
    if (error || (data?.length ?? 0) === 0) {
      setFormError(error ? t('saveFailed') : t('saveNoRows'));
      return;
    }
    setModalOpen(false);
    showToast(t('deleted'));
    await reload({ silent: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        action={isOwner ? (
          <Button onClick={openAdd} icon={<Plus size={16} aria-hidden="true" />}>{t('addPromotion')}</Button>
        ) : undefined}
      />

      {loading ? (
        <TableSkeleton rows={4} columns={6} />
      ) : loadError ? (
        <LoadErrorAlert retrying={loading} onRetry={() => void reload()}>
          {t('loadFailed')}
        </LoadErrorAlert>
      ) : promotions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Gift}
            title={t('emptyTitle')}
            description={t('emptyBody')}
            action={isOwner ? (
              <Button onClick={openAdd} icon={<Plus size={16} aria-hidden="true" />}>{t('addPromotion')}</Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <CardHeader>
            <SectionHeading title={t('list')} description={t('description')} />
          </CardHeader>
          <DataTable<Promotion>
            data={promotions}
            keyExtractor={(row) => row.id}
            label={t('list')}
            columns={[
              {
                key: 'name',
                header: t('name'),
                cellClassName: 'font-semibold text-gray-900',
                render: (row) => row.name,
              },
              {
                key: 'rule',
                header: t('rule'),
                render: (row) => {
                  const product = productById.get(row.product_id);
                  return t('ruleSummary', {
                    quantity: formatNumber(row.free_quantity),
                    product: product?.name ?? t('unknownProduct'),
                    price: formatCurrency(product?.sale_price ?? 0),
                    cost: formatUnitCurrency(product?.cost_price ?? 0),
                    spend: formatCurrency(row.min_spend),
                    currency: tc('currency'),
                  });
                },
              },
              {
                key: 'period',
                header: t('period'),
                className: 'hidden whitespace-nowrap md:table-cell',
                render: (row) => (row.ends_on
                  ? `${formatDateOnly(row.starts_on, locale)} – ${formatDateOnly(row.ends_on, locale)}`
                  : t('fromDate', { date: formatDateOnly(row.starts_on, locale) })),
              },
              {
                key: 'status',
                header: t('status'),
                render: (row) => {
                  const status = promotionStatus(row, today);
                  return <Badge variant={STATUS_BADGE[status]}>{t(`status_${status}`)}</Badge>;
                },
              },
              ...(isOwner ? [{
                key: 'actions',
                header: <span className="sr-only">{tc('actions')}</span>,
                align: 'right' as const,
                className: 'w-14',
                render: (row: Promotion) => (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`${tc('edit')}: ${row.name}`}
                    icon={<Pencil size={15} aria-hidden="true" />}
                    onClick={() => openEdit(row)}
                  />
                ),
              }] : []),
            ]}
          />
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? t('editPromotion') : t('addPromotion')}
        locked={saving || deleting}
        footer={(
          <>
            {editingId && (
              <Button variant="dangerOutline" onClick={handleDelete} loading={deleting} loadingLabel={tc('loading')} disabled={saving} className="sm:mr-auto" icon={<Trash2 size={16} aria-hidden="true" />}>
                {t('deletePromotion')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving || deleting}>{tc('cancel')}</Button>
            <Button type="submit" form="promotion-form" loading={saving} loadingLabel={tc('saving')} disabled={deleting}>{tc('save')}</Button>
          </>
        )}
      >
        <form id="promotion-form" onSubmit={handleSave} className="space-y-4">
          <Field label={t('name')} htmlFor="promotion-name" required hint={t('nameHint')}>
            <Input id="promotion-name" type="text" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('product')} htmlFor="promotion-product" required>
              <Select id="promotion-product" value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
                <option value="">{t('selectProduct')}</option>
                {/* A promotion may point at a product that was deactivated since. */}
                {form.product_id && !productById.has(form.product_id) ? (
                  <option value={form.product_id}>{t('unknownProduct')}</option>
                ) : null}
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {t('productOption', {
                      name: product.name,
                      price: formatCurrency(product.sale_price),
                      cost: formatUnitCurrency(product.cost_price),
                      currency: tc('currency'),
                    })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('freeQuantity')} htmlFor="promotion-free-quantity" required>
              <Input
                id="promotion-free-quantity"
                type="text"
                inputMode="numeric"
                value={form.free_quantity}
                onChange={(e) => set('free_quantity', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label={t('minSpend')} htmlFor="promotion-min-spend" hint={t('minSpendHint')}>
              <CurrencyInput id="promotion-min-spend" value={form.min_spend} onValueChange={(value) => set('min_spend', value)} trailingAddon={tc('currency')} />
            </Field>
            <Field label={t('startsOn')} htmlFor="promotion-starts-on" required>
              <DatePicker ariaLabel={t('startsOn')} value={form.starts_on} onChange={(value) => set('starts_on', value)} />
            </Field>
          </div>
          <Card tone="muted" padding="sm" className="space-y-3">
            <Checkbox
              id="promotion-no-end"
              checked={form.ends_on === ''}
              onChange={(e) => set('ends_on', e.target.checked ? '' : form.starts_on)}
              label={t('noEndDate')}
            />
            {form.ends_on !== '' && (
              <Field label={t('endsOn')} htmlFor="promotion-ends-on">
                <DatePicker ariaLabel={t('endsOn')} value={form.ends_on} min={form.starts_on} onChange={(value) => set('ends_on', value)} />
              </Field>
            )}
          </Card>
          <Checkbox id="promotion-active" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} label={tc('active')} />
          {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}
        </form>
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
