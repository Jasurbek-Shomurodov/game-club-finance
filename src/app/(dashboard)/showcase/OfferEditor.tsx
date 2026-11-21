'use client';

import { useTranslations } from 'next-intl';
import { Checkbox, CurrencyInput, Field, Input } from '@/components/PresentationFoundation';
import type { ShowcaseOfferForm } from '@/lib/showcase';
import { LocalizedTextField } from './LocalizedTextField';

interface OfferEditorProps {
  form: ShowcaseOfferForm;
  /** Takes an updater, so a change that arrives late (an upload finishing) never overwrites newer typing. */
  onChange: (update: (form: ShowcaseOfferForm) => ShowcaseOfferForm) => void;
}

/** The fields of one offer or package: texts in every language, badge, hours, price and visibility. */
export function OfferEditor({ form, onChange }: OfferEditorProps) {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const set = <K extends keyof ShowcaseOfferForm>(field: K, value: ShowcaseOfferForm[K]) => onChange((prev) => ({ ...prev, [field]: value }));

  return (
    <>
      <LocalizedTextField
        id="offer-title"
        label={t('offerTitle')}
        maxLength={80}
        placeholder={t('offerTitlePlaceholder')}
        value={form.title}
        onChange={(value) => set('title', value)}
      />
      <LocalizedTextField
        id="offer-description"
        label={t('offerDescription')}
        multiline
        maxLength={240}
        placeholder={t('offerDescriptionPlaceholder')}
        value={form.description}
        onChange={(value) => set('description', value)}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('offerBadge')} htmlFor="offer-badge" hint={t('offerBadgeHint')}>
          <Input id="offer-badge" value={form.badge} maxLength={12} placeholder="2+1" onChange={(e) => set('badge', e.target.value)} />
        </Field>
        <Field label={t('offerTimeWindow')} htmlFor="offer-time" hint={t('offerTimeWindowHint')}>
          <Input id="offer-time" value={form.time_window} maxLength={40} placeholder="22:00 – 08:00" onChange={(e) => set('time_window', e.target.value)} />
        </Field>
        <Field label={t('offerPrice')} htmlFor="offer-price">
          <CurrencyInput id="offer-price" value={form.price} onValueChange={(value) => set('price', value)} trailingAddon={tc('currency')} />
        </Field>
        <Field label={t('sortOrder')} htmlFor="offer-sort">
          <Input id="offer-sort" inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
        </Field>
      </div>
      <Checkbox id="offer-active" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} label={t('offerActive')} />
    </>
  );
}
