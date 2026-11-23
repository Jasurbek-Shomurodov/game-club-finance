'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, IconButton, InlineAlert, labelClassName } from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { SHOWCASE_GALLERY_LIMIT } from '@/lib/showcase';
import { uploadShowcaseImage } from '@/lib/supabase/showcase';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface GalleryFieldProps {
  clubId: string;
  value: string[];
  onChange: (photos: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}

/** The club's photos for the public page: upload several at once, remove any; the first is shown largest. */
export function GalleryField({ clubId, value, onChange, onUploadingChange }: GalleryFieldProps) {
  const t = useTranslations('showcase');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const room = SHOWCASE_GALLERY_LIMIT - value.length;

  async function handleFiles(files: FileList | null) {
    const chosen = [...(files ?? [])].slice(0, room);
    if (chosen.length === 0) return;
    if (chosen.some((file) => !file.type.startsWith('image/'))) {
      setError(t('imageTypeInvalid'));
      return;
    }
    if (chosen.some((file) => file.size > MAX_IMAGE_BYTES)) {
      setError(t('imageTooLarge'));
      return;
    }
    setError('');
    setUploading(true);
    onUploadingChange?.(true);
    const supabase = createClient();
    const uploaded: string[] = [];
    try {
      for (const file of chosen) uploaded.push(await uploadShowcaseImage(supabase, clubId, 'gallery', file));
    } catch {
      setError(t('imageUploadFailed'));
    } finally {
      // Photos that did upload are kept even when a later one fails.
      if (uploaded.length > 0) onChange([...value, ...uploaded]);
      setUploading(false);
      onUploadingChange?.(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <span className={`${labelClassName} mb-0`}>{t('gallery')}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={uploading}
          loadingLabel={t('uploading')}
          disabled={room <= 0}
          onClick={() => fileRef.current?.click()}
          icon={<ImagePlus size={15} aria-hidden="true" />}
        >
          {t('galleryAdd')}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      {value.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">{t('galleryEmpty')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {value.map((photo, index) => (
            <li key={photo} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
              {/* Owner-supplied links may point at any host, so next/image's allow-list does not fit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" className="h-full w-full object-cover" />
              <IconButton
                variant="ghost"
                size="sm"
                label={t('galleryRemove', { number: index + 1 })}
                icon={<Trash2 size={15} aria-hidden="true" />}
                className="absolute right-1 top-1 bg-surface/90 shadow-sm"
                onClick={() => onChange(value.filter((entry) => entry !== photo))}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-gray-500">{t('galleryHint', { count: value.length, limit: SHOWCASE_GALLERY_LIMIT })}</p>
      {error && <InlineAlert variant="danger" className="mt-2">{error}</InlineAlert>}
    </div>
  );
}
