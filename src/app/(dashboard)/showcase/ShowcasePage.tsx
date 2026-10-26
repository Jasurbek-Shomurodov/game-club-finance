'use client';

// Route: /showcase

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Gamepad2, Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  CurrencyInput,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  PageHeader,
  PageSkeleton,
  SectionHeading,
  Textarea,
  buttonClassName,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { fetchShowcaseAdminData, type ShowcaseAdminData } from '@/lib/supabase/showcase';
import { formatCurrency } from '@/lib/formatters';
import {
  buildShowcaseGamePayload,
  buildShowcasePcZonePayload,
  buildShowcaseSettingsPayload,
  nextSortOrder,
  normalizeSlugInput,
  showcaseGameForm,
  showcasePcZoneForm,
  showcaseSettingsForm,
  validateShowcaseGame,
  validateShowcasePcZone,
  validateShowcaseSettings,
  type ShowcaseGameForm,
  type ShowcasePcZoneForm,
  type ShowcaseSettingsForm,
} from '@/lib/showcase';
import { useClubQuery } from '@/lib/useClubQuery';
import type { ShowcaseGame, ShowcasePcZone } from '@/types';
import { ShowcaseImageField } from './ShowcaseImageField';

const EMPTY: ShowcaseAdminData & { missing: boolean } = { showcase: null, games: [], zones: [], missing: false };

type Editor =
  | { kind: 'game'; id: string | null; form: ShowcaseGameForm }
  | { kind: 'zone'; id: string | null; form: ShowcasePcZoneForm };

export default function ShowcasePage() {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const { selectedClubId, selectedClub, role } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const isOwner = role === 'owner';

  const load = useCallback(async () => {
    if (!selectedClubId) return EMPTY;
    return fetchShowcaseAdminData(createClient(), selectedClubId);
  }, [selectedClubId]);
  const query = useClubQuery(load, EMPTY);
  const { showcase, games, zones, missing } = query.data;

  const [settings, setSettings] = useState<ShowcaseSettingsForm>(() => showcaseSettingsForm(null, ''));
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [savingItem, setSavingItem] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Reset the forms to the loaded club; an open editor never carries over to another club.
  useEffect(() => {
    setSettings(showcaseSettingsForm(showcase, selectedClub?.name ?? ''));
    setSettingsError('');
  }, [showcase, selectedClub?.name]);
  useEffect(() => setEditor(null), [selectedClubId]);

  const publicPath = showcase ? `/club/${showcase.slug}` : null;

  function setField<K extends keyof ShowcaseSettingsForm>(field: K, value: ShowcaseSettingsForm[K]) {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwner || !selectedClubId) return;
    const validation = validateShowcaseSettings(settings);
    if (validation) {
      setSettingsError(t(`error_${validation}`));
      return;
    }
    setSavingSettings(true);
    setSettingsError('');
    const { error } = await createClient()
      .from('club_showcases')
      .upsert({ ...buildShowcaseSettingsPayload(settings), club_id: selectedClubId }, { onConflict: 'club_id' });
    setSavingSettings(false);
    if (error) {
      setSettingsError(error.code === '23505' ? t('error_slug_taken') : t('saveFailed'));
      return;
    }
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

  function openGame(game: ShowcaseGame | null) {
    setEditorError('');
    setEditor({ kind: 'game', id: game?.id ?? null, form: showcaseGameForm(game, nextSortOrder(games)) });
  }

  function openZone(zone: ShowcasePcZone | null) {
    setEditorError('');
    setEditor({ kind: 'zone', id: zone?.id ?? null, form: showcasePcZoneForm(zone, nextSortOrder(zones)) });
  }

  function setEditorField(field: string, value: string) {
    setEditor((prev) => (prev ? { ...prev, form: { ...prev.form, [field]: value } } as Editor : prev));
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !isOwner || !selectedClubId) return;
    const validation = editor.kind === 'game' ? validateShowcaseGame(editor.form) : validateShowcasePcZone(editor.form);
    if (validation) {
      setEditorError(t(`error_${validation}`));
      return;
    }
    const table = editor.kind === 'game' ? 'showcase_games' : 'showcase_pc_zones';
    const payload = editor.kind === 'game' ? buildShowcaseGamePayload(editor.form) : buildShowcasePcZonePayload(editor.form);
    setSavingItem(true);
    setEditorError('');
    const supabase = createClient();
    const { data, error } = editor.id
      ? await supabase.from(table).update(payload).eq('club_id', selectedClubId).eq('id', editor.id).select('id')
      : await supabase.from(table).insert({ ...payload, club_id: selectedClubId }).select('id');
    setSavingItem(false);
    // RLS silently filters rows the user may not change; zero rows is a failure.
    if (error || (data?.length ?? 0) === 0) {
      setEditorError(t('saveFailed'));
      return;
    }
    setEditor(null);
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

  async function deleteItem() {
    if (!editor?.id || !isOwner || !selectedClubId) return;
    const confirmed = await confirm({
      title: editor.kind === 'game' ? t('deleteGame') : t('deleteZone'),
      description: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setSavingItem(true);
    const { data, error } = await createClient()
      .from(editor.kind === 'game' ? 'showcase_games' : 'showcase_pc_zones')
      .delete()
      .eq('club_id', selectedClubId)
      .eq('id', editor.id)
      .select('id');
    setSavingItem(false);
    if (error || (data?.length ?? 0) === 0) {
      setEditorError(t('saveFailed'));
      return;
    }
    setEditor(null);
    showToast(t('deleted'));
    await query.reload({ silent: true });
  }

  if (!isOwner) {
    return (
      <Card>
        <EmptyState icon={Gamepad2} title={t('ownerOnly')} />
      </Card>
    );
  }

  const openPublicLink = publicPath && showcase?.is_published ? (
    <a href={publicPath} target="_blank" rel="noopener noreferrer" className={buttonClassName({ variant: 'outline' })}>
      <ExternalLink size={16} aria-hidden="true" />
      {t('openPublicPage')}
    </a>
  ) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} action={openPublicLink} />

      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadFailed')}</LoadErrorAlert>
      ) : missing ? (
        <InlineAlert variant="warning">{t('migrationMissing')}</InlineAlert>
      ) : (
        <>
          <Card padding="none">
            <CardHeader>
              <SectionHeading
                title={t('pageSettings')}
                description={t('pageSettingsDescription')}
                badge={showcase?.is_published
                  ? <Badge variant="success">{t('published')}</Badge>
                  : <Badge variant="neutral">{t('draft')}</Badge>}
              />
            </CardHeader>
            <CardBody>
              <form onSubmit={saveSettings} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('slug')} htmlFor="showcase-slug" required hint={t('slugHint', { path: `/club/${settings.slug || '…'}` })}>
                    <Input id="showcase-slug" value={settings.slug} maxLength={40} onChange={(e) => setField('slug', normalizeSlugInput(e.target.value))} />
                  </Field>
                  <Field label={t('headline')} htmlFor="showcase-headline" hint={t('headlineHint')}>
                    <Input id="showcase-headline" value={settings.headline} maxLength={80} placeholder={selectedClub?.name} onChange={(e) => setField('headline', e.target.value)} />
                  </Field>
                </div>
                <Field label={t('tagline')} htmlFor="showcase-tagline">
                  <Textarea id="showcase-tagline" rows={2} maxLength={240} value={settings.tagline} onChange={(e) => setField('tagline', e.target.value)} />
                </Field>
                <ShowcaseImageField
                  label={t('heroImage')}
                  clubId={selectedClubId}
                  kind="hero"
                  aspect="wide"
                  value={settings.hero_image_url}
                  onChange={(url) => setField('hero_image_url', url)}
                  onUploadingChange={setUploading}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('address')} htmlFor="showcase-address">
                    <Input id="showcase-address" value={settings.address} maxLength={160} placeholder={selectedClub?.address ?? undefined} onChange={(e) => setField('address', e.target.value)} />
                  </Field>
                  <Field label={t('openingHours')} htmlFor="showcase-hours">
                    <Input id="showcase-hours" value={settings.opening_hours} maxLength={80} placeholder={t('openingHoursPlaceholder')} onChange={(e) => setField('opening_hours', e.target.value)} />
                  </Field>
                  <Field label={t('phone')} htmlFor="showcase-phone">
                    <Input id="showcase-phone" type="tel" inputMode="tel" value={settings.phone} maxLength={40} placeholder="+998 90 123 45 67" onChange={(e) => setField('phone', e.target.value)} />
                  </Field>
                  <Field label={t('telegram')} htmlFor="showcase-telegram">
                    <Input id="showcase-telegram" value={settings.telegram_url} maxLength={200} placeholder="@gameclub" onChange={(e) => setField('telegram_url', e.target.value)} />
                  </Field>
                  <Field label={t('instagram')} htmlFor="showcase-instagram">
                    <Input id="showcase-instagram" value={settings.instagram_url} maxLength={200} placeholder="@gameclub" onChange={(e) => setField('instagram_url', e.target.value)} />
                  </Field>
                </div>
                <Checkbox
                  id="showcase-published"
                  variant="card"
                  checked={settings.is_published}
                  onChange={(e) => setField('is_published', e.target.checked)}
                  label={t('publish')}
                  description={t('publishDescription')}
                />
                {settingsError && <InlineAlert variant="danger">{settingsError}</InlineAlert>}
                <div className="flex justify-end">
                  <Button type="submit" loading={savingSettings} loadingLabel={tc('saving')} disabled={uploading}>{tc('save')}</Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {!showcase ? (
            <InlineAlert variant="info">{t('saveSettingsFirst')}</InlineAlert>
          ) : (
            <>
              <Card padding="none">
                <CardHeader>
                  <SectionHeading
                    title={t('games')}
                    description={t('gamesDescription')}
                    icon={<Gamepad2 size={18} aria-hidden="true" />}
                    action={<Button size="sm" onClick={() => openGame(null)} icon={<Plus size={15} aria-hidden="true" />}>{t('addGame')}</Button>}
                  />
                </CardHeader>
                <CardBody>
                  {games.length === 0 ? (
                    <EmptyState compact icon={Gamepad2} title={t('noGames')} />
                  ) : (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                      {games.map((game) => (
                        <li key={game.id}>
                          <button
                            type="button"
                            onClick={() => openGame(game)}
                            className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-xl"
                          >
                            <span className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-gray-100">
                              {game.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={game.image_url} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                              ) : (
                                <span className="flex h-full items-center justify-center text-gray-400"><Gamepad2 size={26} aria-hidden="true" /></span>
                              )}
                              <span className="absolute right-2 top-2 rounded-lg bg-surface/90 p-1.5 text-gray-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                <Pencil size={13} aria-hidden="true" />
                              </span>
                            </span>
                            <span className="mt-1.5 block truncate text-sm font-semibold text-gray-900">{game.title}</span>
                            {game.genre && <span className="block truncate text-xs text-gray-500">{game.genre}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card padding="none">
                <CardHeader>
                  <SectionHeading
                    title={t('zones')}
                    description={t('zonesDescription')}
                    icon={<Monitor size={18} aria-hidden="true" />}
                    action={<Button size="sm" onClick={() => openZone(null)} icon={<Plus size={15} aria-hidden="true" />}>{t('addZone')}</Button>}
                  />
                </CardHeader>
                <CardBody>
                  {zones.length === 0 ? (
                    <EmptyState compact icon={Monitor} title={t('noZones')} />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {zones.map((zone) => (
                        <li key={zone.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                            {zone.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={zone.image_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full items-center justify-center text-gray-400"><Monitor size={20} aria-hidden="true" /></span>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                              {zone.name}
                              <Badge variant="neutral">{t('pcCountValue', { count: zone.pc_count })}</Badge>
                              {zone.price_per_hour !== null && (
                                <span className="text-xs font-medium text-gray-500">
                                  {t('pricePerHourValue', { price: formatCurrency(zone.price_per_hour), currency: tc('currency') })}
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-gray-500">
                              {[zone.cpu, zone.gpu, zone.ram, zone.monitor].filter(Boolean).join(' · ') || t('noSpecs')}
                            </p>
                          </div>
                          <IconButton
                            variant="ghost"
                            size="sm"
                            label={`${tc('edit')}: ${zone.name}`}
                            icon={<Pencil size={15} aria-hidden="true" />}
                            onClick={() => openZone(zone)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        size="lg"
        locked={savingItem || uploading}
        title={editor?.kind === 'game'
          ? (editor.id ? t('editGame') : t('addGame'))
          : (editor?.id ? t('editZone') : t('addZone'))}
        footer={(
          <>
            {editor?.id && (
              <Button variant="dangerOutline" onClick={deleteItem} disabled={savingItem || uploading} className="sm:mr-auto" icon={<Trash2 size={16} aria-hidden="true" />}>
                {editor.kind === 'game' ? t('deleteGame') : t('deleteZone')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditor(null)} disabled={savingItem || uploading}>{tc('cancel')}</Button>
            <Button type="submit" form="showcase-item-form" loading={savingItem} loadingLabel={tc('saving')} disabled={uploading}>{tc('save')}</Button>
          </>
        )}
      >
        {editor && (
          <form id="showcase-item-form" onSubmit={saveItem} className="space-y-4">
            {editor.kind === 'game' ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_7rem]">
                  <Field label={t('gameTitle')} htmlFor="game-title" required>
                    <Input id="game-title" value={editor.form.title} maxLength={80} onChange={(e) => setEditorField('title', e.target.value)} />
                  </Field>
                  <Field label={t('genre')} htmlFor="game-genre">
                    <Input id="game-genre" value={editor.form.genre} maxLength={60} placeholder={t('genrePlaceholder')} onChange={(e) => setEditorField('genre', e.target.value)} />
                  </Field>
                  <Field label={t('sortOrder')} htmlFor="game-sort">
                    <Input id="game-sort" inputMode="numeric" value={editor.form.sort_order} onChange={(e) => setEditorField('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
                  </Field>
                </div>
                <ShowcaseImageField
                  label={t('coverImage')}
                  clubId={selectedClubId}
                  kind="game"
                  value={editor.form.image_url}
                  onChange={(url) => setEditorField('image_url', url)}
                  onUploadingChange={setUploading}
                />
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={t('zoneName')} htmlFor="zone-name" required className="sm:col-span-2">
                    <Input id="zone-name" value={editor.form.name} maxLength={60} placeholder={t('zoneNamePlaceholder')} onChange={(e) => setEditorField('name', e.target.value)} />
                  </Field>
                  <Field label={t('pcCount')} htmlFor="zone-count" required>
                    <Input id="zone-count" inputMode="numeric" value={editor.form.pc_count} onChange={(e) => setEditorField('pc_count', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label={t('cpu')} htmlFor="zone-cpu">
                    <Input id="zone-cpu" value={editor.form.cpu} maxLength={80} placeholder="Intel Core i7-14700K" onChange={(e) => setEditorField('cpu', e.target.value)} />
                  </Field>
                  <Field label={t('gpu')} htmlFor="zone-gpu">
                    <Input id="zone-gpu" value={editor.form.gpu} maxLength={80} placeholder="RTX 4070 Super" onChange={(e) => setEditorField('gpu', e.target.value)} />
                  </Field>
                  <Field label={t('ram')} htmlFor="zone-ram">
                    <Input id="zone-ram" value={editor.form.ram} maxLength={80} placeholder="32 GB DDR5" onChange={(e) => setEditorField('ram', e.target.value)} />
                  </Field>
                  <Field label={t('monitor')} htmlFor="zone-monitor">
                    <Input id="zone-monitor" value={editor.form.monitor} maxLength={80} placeholder={t('monitorPlaceholder')} onChange={(e) => setEditorField('monitor', e.target.value)} />
                  </Field>
                  <Field label={t('pricePerHour')} htmlFor="zone-price">
                    <CurrencyInput id="zone-price" value={editor.form.price_per_hour} onValueChange={(value) => setEditorField('price_per_hour', value)} trailingAddon={tc('currency')} />
                  </Field>
                  <Field label={t('sortOrder')} htmlFor="zone-sort">
                    <Input id="zone-sort" inputMode="numeric" value={editor.form.sort_order} onChange={(e) => setEditorField('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
                  </Field>
                </div>
                <Field label={t('peripherals')} htmlFor="zone-peripherals">
                  <Textarea id="zone-peripherals" rows={2} maxLength={240} value={editor.form.peripherals} placeholder={t('peripheralsPlaceholder')} onChange={(e) => setEditorField('peripherals', e.target.value)} />
                </Field>
                <ShowcaseImageField
                  label={t('zoneImage')}
                  clubId={selectedClubId}
                  kind="zone"
                  aspect="wide"
                  value={editor.form.image_url}
                  onChange={(url) => setEditorField('image_url', url)}
                  onUploadingChange={setUploading}
                />
              </>
            )}
            {editorError && <InlineAlert variant="danger">{editorError}</InlineAlert>}
          </form>
        )}
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
