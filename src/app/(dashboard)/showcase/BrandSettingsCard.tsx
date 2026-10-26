'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Store } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  InlineAlert,
  Input,
  SectionHeading,
  Skeleton,
  buttonClassName,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { fetchOwnShowcaseBrand } from '@/lib/supabase/showcase';
import {
  buildShowcaseBrandPayload,
  normalizeSlugInput,
  showcaseBrandForm,
  validateShowcaseBrand,
  type ShowcaseBrandForm,
} from '@/lib/showcase';
import type { ShowcaseBrand } from '@/types';
import { LocalizedTextField } from './LocalizedTextField';
import { ShowcaseImageField } from './ShowcaseImageField';

interface BrandSettingsCardProps {
  userId: string;
  /** Club folder for uploaded images; the brand has no club of its own. */
  clubId: string;
  onSaved: (message: string) => void;
}

/**
 * The owner's brand page: one public page that shows every club they own
 * whose page is published, with a tab per club. It belongs to the account,
 * not to the selected club.
 */
export function BrandSettingsCard({ userId, clubId, onSaved }: BrandSettingsCardProps) {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const [brand, setBrand] = useState<ShowcaseBrand | null>(null);
  const [form, setForm] = useState<ShowcaseBrandForm>(() => showcaseBrandForm(null));
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await fetchOwnShowcaseBrand(createClient(), userId);
      setBrand(result.brand);
      setForm(showcaseBrandForm(result.brand));
      setStatus(result.missing ? 'missing' : 'ready');
    } catch {
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof ShowcaseBrandForm>(field: K, value: ShowcaseBrandForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateShowcaseBrand(form);
    if (validation) {
      setError(t(`error_${validation}`));
      return;
    }
    setSaving(true);
    setError('');
    const { error: saveError } = await createClient()
      .from('showcase_brands')
      .upsert({ ...buildShowcaseBrandPayload(form), owner_id: userId }, { onConflict: 'owner_id' });
    setSaving(false);
    if (saveError) {
      setError(saveError.code === '23505' ? t('error_slug_taken') : t('saveFailed'));
      return;
    }
    onSaved(t('saved'));
    await load();
  }

  if (status === 'missing') return null;

  return (
    <Card padding="none">
      <CardHeader>
        <SectionHeading
          title={t('brandTitle')}
          description={t('brandDescription')}
          icon={<Store size={18} aria-hidden="true" />}
          badge={brand?.is_published
            ? <Badge variant="success">{t('published')}</Badge>
            : <Badge variant="neutral">{t('draft')}</Badge>}
          action={brand?.is_published ? (
            <a href={`/brand/${brand.slug}`} target="_blank" rel="noopener noreferrer" className={buttonClassName({ variant: 'outline', size: 'sm' })}>
              <ExternalLink size={15} aria-hidden="true" />
              {t('openBrandPage')}
            </a>
          ) : undefined}
        />
      </CardHeader>
      <CardBody>
        {status === 'loading' ? (
          <Skeleton className="h-40 w-full" />
        ) : status === 'error' ? (
          <InlineAlert variant="danger">{t('loadFailed')}</InlineAlert>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('brandName')} htmlFor="brand-name" required>
                <Input id="brand-name" value={form.name} maxLength={60} placeholder="Pixel Gaming" onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label={t('slug')} htmlFor="brand-slug" required hint={t('slugHint', { path: `/brand/${form.slug || '…'}` })}>
                <Input id="brand-slug" value={form.slug} maxLength={40} placeholder="pixel-gaming" onChange={(e) => set('slug', normalizeSlugInput(e.target.value))} />
              </Field>
            </div>
            <LocalizedTextField
              id="brand-tagline"
              label={t('tagline')}
              hint={t('taglineHint')}
              multiline
              maxLength={240}
              value={form.tagline}
              onChange={(value) => set('tagline', value)}
            />
            <ShowcaseImageField
              label={t('heroImage')}
              clubId={clubId}
              kind="hero"
              aspect="wide"
              value={form.hero_image_url}
              onChange={(url) => set('hero_image_url', url)}
              onUploadingChange={setUploading}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label={t('telegram')} htmlFor="brand-telegram">
                <Input id="brand-telegram" value={form.telegram_url} maxLength={200} placeholder="@pixelgaming" onChange={(e) => set('telegram_url', e.target.value)} />
              </Field>
              <Field label={t('instagram')} htmlFor="brand-instagram">
                <Input id="brand-instagram" value={form.instagram_url} maxLength={200} placeholder="@pixelgaming" onChange={(e) => set('instagram_url', e.target.value)} />
              </Field>
              <Field label={t('youtube')} htmlFor="brand-youtube">
                <Input id="brand-youtube" value={form.youtube_url} maxLength={200} placeholder="@pixelgaming" onChange={(e) => set('youtube_url', e.target.value)} />
              </Field>
              <Field label={t('email')} htmlFor="brand-email">
                <Input id="brand-email" type="email" inputMode="email" value={form.email} maxLength={120} placeholder="info@pixelgaming.uz" onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label={t('phone')} htmlFor="brand-phone" hint={t('brandPhoneHint')}>
                <Input id="brand-phone" type="tel" inputMode="tel" value={form.phone} maxLength={40} placeholder="+998 71 234 56 78" onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label={t('openingHours')} htmlFor="brand-hours">
                <Input id="brand-hours" value={form.opening_hours} maxLength={80} placeholder={t('openingHoursPlaceholder')} onChange={(e) => set('opening_hours', e.target.value)} />
              </Field>
            </div>
            <Checkbox
              id="brand-published"
              variant="card"
              checked={form.is_published}
              onChange={(e) => set('is_published', e.target.checked)}
              label={t('publishBrand')}
              description={t('publishBrandDescription')}
            />
            {error && <InlineAlert variant="danger">{error}</InlineAlert>}
            <div className="flex justify-end">
              <Button type="submit" loading={saving} loadingLabel={tc('saving')} disabled={uploading}>{tc('save')}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
