'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Field, InlineAlert, SectionHeading, Select } from '@/components/PresentationFoundation';
import { PHOTO_CATEGORIES, type GooglePhotoCategory } from '@/lib/googleBusiness/posts';
import { ShowcaseImageField } from '../ShowcaseImageField';
import { errorMessageKey, googleBusinessApi } from './googleBusinessApi';

/** Adds one photo to the listing's gallery; Google reviews it before showing it. */
export function GooglePhotoCard({ clubId, onAdded }: { clubId: string; onAdded: () => void }) {
  const t = useTranslations('googleBusiness');
  const [photoUrl, setPhotoUrl] = useState('');
  const [category, setCategory] = useState<GooglePhotoCategory>('INTERIOR');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function addPhoto() {
    if (!photoUrl) return;
    setSending(true);
    setError('');
    try {
      await googleBusinessApi.addPhoto(clubId, photoUrl, category);
      setPhotoUrl('');
      onAdded();
    } catch (failure) {
      setError(t(errorMessageKey(failure)));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeading title={t('photoTitle')} description={t('photoDescription')} />
      </CardHeader>
      <CardBody className="space-y-4">
        <ShowcaseImageField
          label={t('photo')}
          clubId={clubId}
          kind="google"
          aspect="wide"
          value={photoUrl}
          onChange={setPhotoUrl}
          onUploadingChange={setUploading}
        />
        <Field label={t('photoCategory')} htmlFor="google-photo-category" className="sm:max-w-xs">
          <Select id="google-photo-category" value={category} onChange={(event) => setCategory(event.target.value as GooglePhotoCategory)}>
            {PHOTO_CATEGORIES.map((value) => <option key={value} value={value}>{t(`photoCategory_${value}`)}</option>)}
          </Select>
        </Field>
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        <div className="flex justify-end">
          <Button
            type="button"
            loading={sending}
            loadingLabel={t('publishing')}
            disabled={!photoUrl || uploading}
            onClick={() => void addPhoto()}
            icon={<ImagePlus size={15} aria-hidden="true" />}
          >
            {t('addPhoto')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
