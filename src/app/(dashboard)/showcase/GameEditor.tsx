'use client';

import { useTranslations } from 'next-intl';
import { Field, Input } from '@/components/PresentationFoundation';
import type { ShowcaseGameForm } from '@/lib/showcase';
import { ShowcaseImageField } from './ShowcaseImageField';

interface GameEditorProps {
  form: ShowcaseGameForm;
  /** Takes an updater, so a change that arrives late (an upload finishing) never overwrites newer typing. */
  onChange: (update: (form: ShowcaseGameForm) => ShowcaseGameForm) => void;
  /** Club folder for the uploaded image. */
  clubId: string;
  onUploadingChange: (uploading: boolean) => void;
}

/** The fields of one game on the public page: title, genre, order and cover. */
export function GameEditor({ form, onChange, clubId, onUploadingChange }: GameEditorProps) {
  const t = useTranslations('showcase');
  const set = <K extends keyof ShowcaseGameForm>(field: K, value: ShowcaseGameForm[K]) => onChange((prev) => ({ ...prev, [field]: value }));

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_7rem]">
        <Field label={t('gameTitle')} htmlFor="game-title" required>
          <Input id="game-title" value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={t('genre')} htmlFor="game-genre">
          <Input id="game-genre" value={form.genre} maxLength={60} placeholder={t('genrePlaceholder')} onChange={(e) => set('genre', e.target.value)} />
        </Field>
        <Field label={t('sortOrder')} htmlFor="game-sort">
          <Input id="game-sort" inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
        </Field>
      </div>
      <ShowcaseImageField
        label={t('coverImage')}
        clubId={clubId}
        kind="game"
        value={form.image_url}
        onChange={(url) => set('image_url', url)}
        onUploadingChange={onUploadingChange}
      />
    </>
  );
}
