'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DatePicker,
  Field,
  InlineAlert,
  Input,
  SectionHeading,
  SegmentedControl,
  Select,
  Textarea,
} from '@/components/PresentationFoundation';
import {
  COUPON_MAX,
  CTA_TYPES,
  POST_LANGUAGES,
  SUMMARY_MAX,
  TITLE_MAX,
  emptyGooglePostForm,
  validateGooglePost,
  type GooglePostForm,
  type GooglePostKind,
  type GooglePostLanguage,
} from '@/lib/googleBusiness/posts';
import { ShowcaseImageField } from '../ShowcaseImageField';
import { errorMessageKey, googleBusinessApi } from './googleBusinessApi';

interface GooglePostComposerProps {
  clubId: string;
  defaultLanguage: GooglePostLanguage;
  today: string;
  onPublished: () => void;
}

/** Writes an update, event or offer and publishes it to the club's Google listing. */
export function GooglePostComposer({ clubId, defaultLanguage, today, onPublished }: GooglePostComposerProps) {
  const t = useTranslations('googleBusiness');
  const ts = useTranslations('showcase');
  const [form, setForm] = useState<GooglePostForm>(() => emptyGooglePostForm(defaultLanguage));
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);

  function setField<K extends keyof GooglePostForm>(field: K, value: GooglePostForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateGooglePost(form);
    if (validation) {
      setError(t(`error_${validation}`));
      return;
    }
    setPublishing(true);
    setError('');
    try {
      await googleBusinessApi.createPost(clubId, form);
      setForm(emptyGooglePostForm(form.language));
      onPublished();
    } catch (failure) {
      setError(t(errorMessageKey(failure)));
    } finally {
      setPublishing(false);
    }
  }

  const needsUrl = form.ctaType !== 'NONE' && form.ctaType !== 'CALL';

  return (
    <Card>
      <CardHeader>
        <SectionHeading title={t('composerTitle')} description={t('composerDescription')} />
      </CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={publish} noValidate>
          <SegmentedControl<GooglePostKind>
            label={t('postKind')}
            options={[
              { value: 'update', label: t('kind_update') },
              { value: 'event', label: t('kind_event') },
              { value: 'offer', label: t('kind_offer') },
            ]}
            value={form.kind}
            onChange={(kind) => setField('kind', kind)}
          />

          {form.kind !== 'update' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={form.kind === 'event' ? t('eventTitle') : t('offerTitle')} htmlFor="google-post-title" required className="sm:col-span-3">
                <Input id="google-post-title" value={form.title} maxLength={TITLE_MAX} onChange={(event) => setField('title', event.target.value)} />
              </Field>
              <Field label={t('startDate')} required>
                <DatePicker value={form.startDate} min={today} onChange={(value) => setField('startDate', value)} ariaLabel={t('startDate')} />
              </Field>
              <Field label={t('endDate')} required>
                <DatePicker value={form.endDate} min={form.startDate || today} onChange={(value) => setField('endDate', value)} ariaLabel={t('endDate')} />
              </Field>
            </div>
          )}

          <Field label={t('summary')} htmlFor="google-post-summary" required={form.kind === 'update'} hint={t('summaryHint')}>
            <Textarea
              id="google-post-summary"
              rows={5}
              showCount
              maxLength={SUMMARY_MAX}
              value={form.summary}
              onChange={(event) => setField('summary', event.target.value)}
            />
          </Field>

          <ShowcaseImageField
            label={t('postPhoto')}
            clubId={clubId}
            kind="google"
            aspect="wide"
            value={form.photoUrl}
            onChange={(url) => setField('photoUrl', url)}
            onUploadingChange={setUploading}
          />

          {form.kind === 'offer' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('couponCode')} htmlFor="google-post-coupon" hint={t('optional')}>
                <Input id="google-post-coupon" value={form.couponCode} maxLength={COUPON_MAX} onChange={(event) => setField('couponCode', event.target.value)} />
              </Field>
              <Field label={t('terms')} htmlFor="google-post-terms" hint={t('optional')}>
                <Input id="google-post-terms" value={form.terms} onChange={(event) => setField('terms', event.target.value)} />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={form.kind === 'offer' ? t('offerLink') : t('button')} htmlFor="google-post-cta">
              <Select id="google-post-cta" value={form.ctaType} onChange={(event) => setField('ctaType', event.target.value as GooglePostForm['ctaType'])}>
                {CTA_TYPES.filter((type) => form.kind !== 'offer' || type === 'NONE' || type === 'LEARN_MORE').map((type) => (
                  <option key={type} value={type}>{t(`cta_${type}`)}</option>
                ))}
              </Select>
            </Field>
            {needsUrl && (
              <Field label={t('buttonUrl')} htmlFor="google-post-url" required className="sm:col-span-2">
                <Input
                  id="google-post-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={form.ctaUrl}
                  onChange={(event) => setField('ctaUrl', event.target.value)}
                />
              </Field>
            )}
          </div>

          <Field label={t('language')} htmlFor="google-post-language" hint={t('languageHint')} className="sm:max-w-xs">
            <Select id="google-post-language" value={form.language} onChange={(event) => setField('language', event.target.value as GooglePostLanguage)}>
              {POST_LANGUAGES.map((language) => <option key={language} value={language}>{t(`language_${language}`)}</option>)}
            </Select>
          </Field>

          {error && <InlineAlert variant="danger">{error}</InlineAlert>}

          <div className="flex justify-end">
            <Button
              type="submit"
              loading={publishing}
              loadingLabel={t('publishing')}
              disabled={uploading}
              icon={<Send size={15} aria-hidden="true" />}
            >
              {uploading ? ts('uploading') : t('publish')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
