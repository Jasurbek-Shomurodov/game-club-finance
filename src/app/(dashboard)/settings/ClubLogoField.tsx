'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, X } from 'lucide-react';
import { ClubLogo, Spinner } from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { uploadShowcaseImage } from '@/lib/supabase/showcase';
import { cn } from '@/lib/utils';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

interface ClubLogoFieldProps {
  clubId: string;
  value: string;
  disabled?: boolean;
  onChange: (url: string) => void;
  onError: (message: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}

/** The club logo as a square button: click to upload a new image, × to go back to the default badge. */
export function ClubLogoField({ clubId, value, disabled, onChange, onError, onUploadingChange }: ClubLogoFieldProps) {
  const t = useTranslations('settings');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError(t('clubLogoTypeInvalid'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onError(t('clubLogoTooLarge'));
      return;
    }
    setUploading(true);
    onUploadingChange(true);
    try {
      onChange(await uploadShowcaseImage(createClient(), clubId, 'logo', file));
    } catch {
      onError(t('clubLogoUploadFailed'));
    } finally {
      setUploading(false);
      onUploadingChange(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="relative h-11 w-11 shrink-0">
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => fileRef.current?.click()}
        aria-label={value ? t('clubLogoChange') : t('clubLogoUpload')}
        title={value ? t('clubLogoChange') : t('clubLogoUpload')}
        className={cn(
          'group relative block h-11 w-11 overflow-hidden rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          !disabled && 'cursor-pointer hover:border-gray-300',
        )}
      >
        <ClubLogo src={value || null} size={44} className="h-full w-full rounded-none" />
        {!disabled && (
          <span className="absolute inset-0 flex items-center justify-center bg-gray-950/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {uploading ? <Spinner size={16} /> : <ImagePlus size={16} aria-hidden="true" />}
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-gray-950/45 text-white">
            <Spinner size={16} />
          </span>
        )}
      </button>
      {value && !disabled && !uploading && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('clubLogoRemove')}
          title={t('clubLogoRemove')}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-surface text-gray-500 shadow-sm hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
