'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clapperboard, Trash2, Video } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Field, IconButton, InlineAlert, SectionHeading } from '@/components/PresentationFoundation';
import { VIDEO_MIME_TYPES, videoFileError } from '@/lib/googleBusiness/posts';
import { createClient } from '@/lib/supabase/client';
import { uploadShowcaseImage } from '@/lib/supabase/showcase';
import { errorMessageKey, googleBusinessApi } from './googleBusinessApi';

type VideoMeta = { duration: number; width: number; height: number };

/** Length and size as the browser reads them; null when it cannot decode the file. */
function readVideoMeta(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (meta: VideoMeta | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = window.setTimeout(() => done(null), 5000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** Uploads one short video to the showcase bucket and adds it to the listing; Google reviews it first. */
export function GoogleVideoCard({ clubId, onAdded }: { clubId: string; onAdded: () => void }) {
  const t = useTranslations('googleBusiness');
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError('');
    setError('');
    const invalid = videoFileError(file, await readVideoMeta(file));
    if (invalid) {
      setFileError(t(`videoError_${invalid}`));
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      setVideoUrl(await uploadShowcaseImage(createClient(), clubId, 'google', file));
    } catch {
      setFileError(t('videoUploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function addVideo() {
    if (!videoUrl) return;
    setSending(true);
    setError('');
    try {
      await googleBusinessApi.addVideo(clubId, videoUrl);
      setVideoUrl('');
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
        <SectionHeading title={t('videoTitle')} description={t('videoDescription')} />
      </CardHeader>
      <CardBody className="space-y-4">
        <Field label={t('video')} htmlFor={inputId} hint={t('videoHint')} error={fileError || undefined}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
              {videoUrl ? (
                <video src={videoUrl} className="h-full w-full object-cover" muted playsInline controls preload="metadata" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-gray-400">
                  <Video size={22} aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                id={inputId}
                type="button"
                variant="outline"
                size="sm"
                loading={uploading}
                loadingLabel={t('videoUploading')}
                onClick={() => fileRef.current?.click()}
                icon={<Video size={15} aria-hidden="true" />}
              >
                {t('uploadVideo')}
              </Button>
              {videoUrl && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  label={t('removeVideo')}
                  icon={<Trash2 size={15} aria-hidden="true" />}
                  onClick={() => setVideoUrl('')}
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept={VIDEO_MIME_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
            </div>
          </div>
        </Field>
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        <div className="flex justify-end">
          <Button
            type="button"
            loading={sending}
            loadingLabel={t('publishing')}
            disabled={!videoUrl || uploading}
            onClick={() => void addVideo()}
            icon={<Clapperboard size={15} aria-hidden="true" />}
          >
            {t('addVideo')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
