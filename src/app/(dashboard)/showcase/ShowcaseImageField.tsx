'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input } from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import type { ShowcaseImageKind } from '@/lib/showcase';
import { uploadShowcaseImage } from '@/lib/supabase/showcase';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ShowcaseImageFieldProps {
  label: string;
  clubId: string;
  kind: ShowcaseImageKind;
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  aspect?: 'cover' | 'wide' | 'square';
}

/** Image preview with an upload button (to the club's storage folder) or a pasted link. */
export function ShowcaseImageField({ label, clubId, kind, value, onChange, onUploadingChange, aspect = 'cover' }: ShowcaseImageFieldProps) {
  const t = useTranslations('showcase');
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('imageTypeInvalid'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('imageTooLarge'));
      return;
    }
    setError('');
    setUploading(true);
    onUploadingChange?.(true);
    try {
      onChange(await uploadShowcaseImage(createClient(), clubId, kind, file));
    } catch {
      setError(t('imageUploadFailed'));
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Field label={label} htmlFor={inputId} hint={t('imageHint')} error={error || undefined}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className={`relative shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 ${aspect === 'cover' ? 'aspect-[3/4] w-28' : aspect === 'square' ? 'aspect-square w-20' : 'aspect-video w-44'}`}
        >
          {value ? (
            // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-gray-400">
              <ImagePlus size={22} aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={uploading}
              loadingLabel={t('uploading')}
              onClick={() => fileRef.current?.click()}
              icon={<ImagePlus size={15} aria-hidden="true" />}
            >
              {t('uploadImage')}
            </Button>
            {value && (
              <IconButton
                variant="ghost"
                size="sm"
                label={t('removeImage')}
                icon={<Trash2 size={15} aria-hidden="true" />}
                onClick={() => onChange('')}
              />
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Input
            id={inputId}
            type="url"
            inputMode="url"
            controlSize="sm"
            placeholder={t('imageUrlPlaceholder')}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </div>
    </Field>
  );
}
