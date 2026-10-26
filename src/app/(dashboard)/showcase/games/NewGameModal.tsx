'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, InlineAlert, Input, Modal } from '@/components/PresentationFoundation';
import { buildShowcaseGamePayload, showcaseGameForm, validateShowcaseGame, type ShowcaseGameForm } from '@/lib/showcase';
import { ShowcaseImageField } from '../ShowcaseImageField';

interface NewGameModalProps {
  open: boolean;
  clubId: string;
  nextSortOrder: number;
  onClose: () => void;
  /** Saves the validated game for the club; resolves to an error message or null. */
  onCreate: (game: ReturnType<typeof buildShowcaseGamePayload>) => Promise<string | null>;
}

/** A game that is not in any club's list yet: title, genre and cover. */
export function NewGameModal({ open, clubId, nextSortOrder, onClose, onCreate }: NewGameModalProps) {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const [form, setForm] = useState<ShowcaseGameForm>(() => showcaseGameForm(null, nextSortOrder));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function close() {
    if (saving || uploading) return;
    setForm(showcaseGameForm(null, nextSortOrder));
    setError('');
    onClose();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateShowcaseGame({ ...form, sort_order: String(nextSortOrder) });
    if (validation) {
      setError(t(`error_${validation}`));
      return;
    }
    setSaving(true);
    setError('');
    const failure = await onCreate(buildShowcaseGamePayload({ ...form, sort_order: String(nextSortOrder) }));
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setForm(showcaseGameForm(null, nextSortOrder));
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('libraryNewGame')}
      description={t('libraryNewGameDescription')}
      size="lg"
      locked={saving || uploading}
      footer={(
        <>
          <Button variant="outline" onClick={close} disabled={saving || uploading}>{tc('cancel')}</Button>
          <Button type="submit" form="library-new-game" loading={saving} loadingLabel={tc('saving')} disabled={uploading}>{tc('save')}</Button>
        </>
      )}
    >
      <form id="library-new-game" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('gameTitle')} htmlFor="library-game-title" required>
            <Input id="library-game-title" value={form.title} maxLength={80} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          </Field>
          <Field label={t('genre')} htmlFor="library-game-genre">
            <Input id="library-game-genre" value={form.genre} maxLength={60} placeholder={t('genrePlaceholder')} onChange={(e) => setForm((prev) => ({ ...prev, genre: e.target.value }))} />
          </Field>
        </div>
        <ShowcaseImageField
          label={t('coverImage')}
          clubId={clubId}
          kind="game"
          value={form.image_url}
          onChange={(url) => setForm((prev) => ({ ...prev, image_url: url }))}
          onUploadingChange={setUploading}
        />
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      </form>
    </Modal>
  );
}
