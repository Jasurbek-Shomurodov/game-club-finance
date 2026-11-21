'use client';

// Route: /showcase

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BadgePercent, ExternalLink, Gamepad2, Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import { canAccessFeature } from '@/lib/permissions';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  PageHeader,
  SectionHeading,
  SkeletonStatus,
  TappableSurface,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { fetchShowcaseAdminData, type ShowcaseAdminData } from '@/lib/supabase/showcase';
import { formatCurrency, formatPhone } from '@/lib/formatters';
import {
  buildShowcaseGamePayload,
  buildShowcaseOfferPayload,
  buildShowcasePcZonePayload,
  buildShowcaseSettingsPayload,
  nextSortOrder,
  normalizeSlugInput,
  showcaseGameForm,
  showcaseOfferForm,
  showcasePcZoneForm,
  showcaseSettingsForm,
  validateShowcaseGame,
  validateShowcaseOffer,
  validateShowcasePcZone,
  validateShowcaseSettings,
  type ShowcaseGameForm,
  type ShowcaseOfferForm,
  type ShowcasePcZoneForm,
  type ShowcaseSettingsForm,
} from '@/lib/showcase';
import { refreshPublicShowcase } from '@/lib/showcaseRefresh';
import { useClubQuery } from '@/lib/useClubQuery';
import type { ShowcaseGame, ShowcaseOffer, ShowcasePcZone, ShowcaseZoneKind } from '@/types';
import { GameEditor } from './GameEditor';
import { LocalizedTextField } from './LocalizedTextField';
import { OfferEditor } from './OfferEditor';
import { ShowcaseImageField } from './ShowcaseImageField';
import { ShowcaseSkeleton } from './ShowcaseSkeletons';
import { ShowcaseTabs } from './ShowcaseTabs';
import { ZoneEditor } from './ZoneEditor';

const EMPTY: ShowcaseAdminData & { missing: boolean } = { showcase: null, games: [], zones: [], offers: [], offersMissing: false, missing: false };

type Editor =
  | { kind: 'game'; id: string | null; form: ShowcaseGameForm }
  | { kind: 'zone'; id: string | null; form: ShowcasePcZoneForm }
  | { kind: 'offer'; id: string | null; form: ShowcaseOfferForm };

const EDITOR_TABLE = { game: 'showcase_games', zone: 'showcase_pc_zones', offer: 'showcase_offers' } as const;
const DELETE_LABEL = { game: 'deleteGame', zone: 'deleteZone', offer: 'deleteOffer' } as const;
const EDIT_TITLE = { game: ['addGame', 'editGame'], zone: ['addZone', 'editZone'], offer: ['addOffer', 'editOffer'] } as const;

export default function ShowcasePage() {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const { selectedClubId, selectedClub, role, featureAccess } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  // Owners, and members an owner granted the Public page on Team.
  const canEdit = canAccessFeature(role, featureAccess, 'showcase');

  const load = useCallback(async () => {
    if (!selectedClubId) return EMPTY;
    return fetchShowcaseAdminData(createClient(), selectedClubId);
  }, [selectedClubId]);
  const query = useClubQuery(load, EMPTY);
  const { showcase, games, zones, offers, offersMissing, missing } = query.data;

  const [settings, setSettings] = useState<ShowcaseSettingsForm>(() => showcaseSettingsForm(null, ''));
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [savingItem, setSavingItem] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Reset the forms to the loaded club; an open editor never carries over to another club.
  // Keyed on the saved row, not the object: saving a zone, game or offer reloads
  // an unchanged showcase, and that must not wipe an unsaved draft here.
  useEffect(() => {
    setSettings(showcaseSettingsForm(showcase, selectedClub?.name ?? ''));
    setSettingsError('');
  }, [showcase?.club_id, showcase?.updated_at, selectedClub?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setEditor(null), [selectedClubId]);

  const publicPath = showcase ? `/club/${showcase.slug}` : null;

  function monitorSummary(zone: ShowcasePcZone) {
    const parts = [
      zone.monitor_size_inches ? `${zone.monitor_size_inches}${t('inchUnit')}` : null,
      zone.monitor_refresh_hz ? `${zone.monitor_refresh_hz} ${t('hzUnit')}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' ') : zone.monitor;
  }

  function setField<K extends keyof ShowcaseSettingsForm>(field: K, value: ShowcaseSettingsForm[K]) {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || !selectedClubId) return;
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
    refreshPublicShowcase();
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

  function openGame(game: ShowcaseGame | null) {
    setEditorError('');
    setEditor({ kind: 'game', id: game?.id ?? null, form: showcaseGameForm(game, nextSortOrder(games)) });
  }

  function openZone(zone: ShowcasePcZone | null, kind: ShowcaseZoneKind = 'pc') {
    setEditorError('');
    setEditor({ kind: 'zone', id: zone?.id ?? null, form: showcasePcZoneForm(zone, nextSortOrder(zones), kind) });
  }

  function openOffer(offer: ShowcaseOffer | null) {
    setEditorError('');
    setEditor({ kind: 'offer', id: offer?.id ?? null, form: showcaseOfferForm(offer, nextSortOrder(offers)) });
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !canEdit || !selectedClubId) return;
    const validation = editor.kind === 'game'
      ? validateShowcaseGame(editor.form)
      : editor.kind === 'zone' ? validateShowcasePcZone(editor.form) : validateShowcaseOffer(editor.form);
    if (validation) {
      setEditorError(t(`error_${validation}`));
      return;
    }
    const table = EDITOR_TABLE[editor.kind];
    const payload = editor.kind === 'game'
      ? buildShowcaseGamePayload(editor.form)
      : editor.kind === 'zone' ? buildShowcasePcZonePayload(editor.form) : buildShowcaseOfferPayload(editor.form);
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
    refreshPublicShowcase();
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

  async function deleteItem() {
    if (!editor?.id || !canEdit || !selectedClubId) return;
    const confirmed = await confirm({
      title: t(DELETE_LABEL[editor.kind]),
      description: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setSavingItem(true);
    const { data, error } = await createClient()
      .from(EDITOR_TABLE[editor.kind])
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
    refreshPublicShowcase();
    showToast(t('deleted'));
    await query.reload({ silent: true });
  }

  if (!canEdit) {
    return (
      <div className="w-full space-y-5">
        <PageHeader title={t('title')} tabs={<ShowcaseTabs current="/showcase" />} />
        <Card>
          <EmptyState icon={Gamepad2} title={t('ownerOnly')} />
        </Card>
      </div>
    );
  }

  const openPublicLink = publicPath && showcase?.is_published ? (
    <ButtonLink href={publicPath} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={16} aria-hidden="true" />}>
      {t('openPublicPage')}
    </ButtonLink>
  ) : undefined;

  return (
    <div className="w-full space-y-5">
      <PageHeader title={t('title')} tabs={<ShowcaseTabs current="/showcase" />} action={openPublicLink} />

      {query.loading ? (
        <SkeletonStatus><ShowcaseSkeleton /></SkeletonStatus>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
                  <Field label={t('slug')} htmlFor="showcase-slug" required hint={t('slugHint', { path: `/club/${settings.slug || '…'}` })}>
                    <Input id="showcase-slug" value={settings.slug} maxLength={40} onChange={(e) => setField('slug', normalizeSlugInput(e.target.value))} />
                  </Field>
                  <Field label={t('brandOrder')} htmlFor="showcase-order" hint={t('brandOrderHint')}>
                    <Input id="showcase-order" inputMode="numeric" value={settings.sort_order} onChange={(e) => setField('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
                  </Field>
                </div>
                <LocalizedTextField
                  id="showcase-headline"
                  label={t('headline')}
                  hint={t('headlineHint')}
                  maxLength={80}
                  placeholder={selectedClub?.name}
                  value={settings.headline}
                  onChange={(value) => setField('headline', value)}
                />
                <LocalizedTextField
                  id="showcase-tagline"
                  label={t('tagline')}
                  hint={t('taglineHint')}
                  multiline
                  maxLength={240}
                  value={settings.tagline}
                  onChange={(value) => setField('tagline', value)}
                />
                <ShowcaseImageField
                  label={t('heroImage')}
                  clubId={selectedClubId}
                  kind="hero"
                  aspect="wide"
                  value={settings.hero_image_url}
                  onChange={(url) => setField('hero_image_url', url)}
                  onUploadingChange={setUploading}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Field label={t('address')} htmlFor="showcase-address">
                    <Input id="showcase-address" value={settings.address} maxLength={160} placeholder={selectedClub?.address ?? undefined} onChange={(e) => setField('address', e.target.value)} />
                  </Field>
                  <Field label={t('yandexMaps')} htmlFor="showcase-yandex-maps" hint={t('yandexMapsHint')}>
                    <Input id="showcase-yandex-maps" type="url" inputMode="url" value={settings.yandex_maps_url} maxLength={300} placeholder="yandex.uz/maps/org/…" onChange={(e) => setField('yandex_maps_url', e.target.value)} />
                  </Field>
                  <Field label={t('openingHours')} htmlFor="showcase-hours">
                    <Input id="showcase-hours" value={settings.opening_hours} maxLength={80} placeholder={t('openingHoursPlaceholder')} onChange={(e) => setField('opening_hours', e.target.value)} />
                  </Field>
                  <Field label={t('phone')} htmlFor="showcase-phone">
                    <Input id="showcase-phone" type="tel" inputMode="tel" value={settings.phone} maxLength={40} placeholder="+998 90 123 45 67" onChange={(e) => setField('phone', formatPhone(e.target.value))} />
                  </Field>
                  <Field label={t('telegram')} htmlFor="showcase-telegram">
                    <Input id="showcase-telegram" value={settings.telegram_url} maxLength={200} placeholder="@gameclub" onChange={(e) => setField('telegram_url', e.target.value)} />
                  </Field>
                  <Field label={t('instagram')} htmlFor="showcase-instagram">
                    <Input id="showcase-instagram" value={settings.instagram_url} maxLength={200} placeholder="@gameclub" onChange={(e) => setField('instagram_url', e.target.value)} />
                  </Field>
                  <Field label={t('youtube')} htmlFor="showcase-youtube">
                    <Input id="showcase-youtube" value={settings.youtube_url} maxLength={200} placeholder="@gameclub" onChange={(e) => setField('youtube_url', e.target.value)} />
                  </Field>
                  <Field label={t('email')} htmlFor="showcase-email">
                    <Input id="showcase-email" type="email" inputMode="email" value={settings.email} maxLength={120} placeholder="info@gameclub.uz" onChange={(e) => setField('email', e.target.value)} />
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
                    title={t('zones')}
                    description={t('zonesDescription')}
                    icon={<Monitor size={18} aria-hidden="true" />}
                    action={(
                      <>
                        <Button size="sm" variant="outline" onClick={() => openZone(null, 'playstation')} icon={<Gamepad2 size={15} aria-hidden="true" />}>{t('addPlaystationZone')}</Button>
                        <Button size="sm" onClick={() => openZone(null)} icon={<Plus size={15} aria-hidden="true" />}>{t('addZone')}</Button>
                      </>
                    )}
                  />
                </CardHeader>
                <CardBody>
                  {zones.length === 0 ? (
                    <EmptyState compact icon={Monitor} title={t('noZones')} />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {zones.map((zone) => (
                        <li key={zone.id} className="py-1.5 first:pt-0 last:pb-0">
                          <TappableSurface onClick={() => openZone(zone)} chevron={false} label={`${tc('edit')}: ${zone.name}`} className="rounded-xl border border-transparent p-1.5">
                            <span className="flex items-start gap-3">
                          <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                            {zone.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={zone.image_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full items-center justify-center text-gray-500">
                                {zone.kind === 'playstation' ? <Gamepad2 size={20} aria-hidden="true" /> : <Monitor size={20} aria-hidden="true" />}
                              </span>
                            )}
                          </span>
                          <span className="block min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                              {zone.name}
                              <Badge variant="neutral">
                                {zone.kind === 'playstation' ? t('consoleCountValue', { count: zone.pc_count }) : t('pcCountValue', { count: zone.pc_count })}
                              </Badge>
                              {zone.price_per_hour !== null && (
                                <span className="text-xs font-medium text-gray-500">
                                  {t('pricePerHourValue', { price: formatCurrency(zone.price_per_hour), currency: tc('currency') })}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                              {(zone.kind === 'playstation'
                                ? [zone.console, zone.controllers ? t('controllersValue', { count: zone.controllers }) : null, monitorSummary(zone)]
                                : [zone.gpu, zone.cpu, zone.ram, monitorSummary(zone)]).filter(Boolean).join(' · ') || t('noSpecs')}
                            </span>
                          </span>
                            <Pencil size={15} className="mt-1 shrink-0 text-gray-500 transition-colors group-hover:text-primary-600" aria-hidden="true" />
                            </span>
                          </TappableSurface>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card padding="none">
                <CardHeader>
                  <SectionHeading
                    title={t('offers')}
                    description={t('offersDescription')}
                    icon={<BadgePercent size={18} aria-hidden="true" />}
                    action={offersMissing ? undefined : <Button size="sm" onClick={() => openOffer(null)} icon={<Plus size={15} aria-hidden="true" />}>{t('addOffer')}</Button>}
                  />
                </CardHeader>
                <CardBody>
                  {offersMissing ? (
                    <InlineAlert variant="warning">{t('offersMigrationMissing')}</InlineAlert>
                  ) : offers.length === 0 ? (
                    <EmptyState compact icon={BadgePercent} title={t('noOffers')} />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {offers.map((offer) => (
                        <li key={offer.id} className="py-1.5 first:pt-0 last:pb-0">
                          <TappableSurface onClick={() => openOffer(offer)} chevron={false} label={`${tc('edit')}: ${offer.title}`} className="rounded-xl border border-transparent p-1.5">
                            <span className="flex items-start gap-3">
                          <span className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 px-2 text-sm font-bold text-primary-700">
                            {offer.badge || <BadgePercent size={18} aria-hidden="true" />}
                          </span>
                          <span className="block min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                              {offer.title}
                              {!offer.is_active && <Badge variant="neutral">{t('offerHidden')}</Badge>}
                              {offer.price !== null && (
                                <span className="text-xs font-medium text-gray-500">{formatCurrency(offer.price)} {tc('currency')}</span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                              {[offer.time_window, offer.description].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                            <Pencil size={15} className="mt-1 shrink-0 text-gray-500 transition-colors group-hover:text-primary-600" aria-hidden="true" />
                            </span>
                          </TappableSurface>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card padding="none">
                <CardHeader>
                  <SectionHeading
                    title={t('games')}
                    description={t('gamesDescription')}
                    icon={<Gamepad2 size={18} aria-hidden="true" />}
                    action={<ButtonLink href="/showcase/games" variant="primary" size="sm" icon={<Plus size={15} aria-hidden="true" />}>{t('addGame')}</ButtonLink>}
                  />
                </CardHeader>
                <CardBody>
                  {games.length === 0 ? (
                    <EmptyState compact icon={Gamepad2} title={t('noGames')} />
                  ) : (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
                      {games.map((game) => (
                        <li key={game.id}>
                          <TappableSurface onClick={() => openGame(game)} chevron={false} label={`${tc('edit')}: ${game.title}`} className="rounded-xl border border-transparent">
                            <span className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-gray-100">
                              {game.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={game.image_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex h-full items-center justify-center text-gray-400"><Gamepad2 size={26} aria-hidden="true" /></span>
                              )}
                              <span className="absolute right-2 top-2 rounded-lg bg-surface/90 p-1.5 text-gray-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                <Pencil size={13} aria-hidden="true" />
                              </span>
                            </span>
                            <span className="mt-1.5 block truncate text-sm font-semibold text-gray-900">{game.title}</span>
                            {game.genre && <span className="block truncate text-xs text-gray-500">{game.genre}</span>}
                          </TappableSurface>
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
        title={editor ? t(EDIT_TITLE[editor.kind][editor.id ? 1 : 0]) : undefined}
        footer={(
          <>
            {editor?.id && (
              <Button variant="dangerOutline" onClick={deleteItem} disabled={savingItem || uploading} className="sm:mr-auto" icon={<Trash2 size={16} aria-hidden="true" />}>
                {t(DELETE_LABEL[editor.kind])}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditor(null)} disabled={savingItem || uploading}>{tc('cancel')}</Button>
            <Button type="submit" form="showcase-item-form" loading={savingItem} loadingLabel={tc('saving')} disabled={uploading}>{tc('save')}</Button>
          </>
        )}
      >
        {editor && (
          <form id="showcase-item-form" noValidate onSubmit={saveItem} className="space-y-4">
            {editor.kind === 'game' ? (
              <GameEditor form={editor.form} onChange={(update) => setEditor((prev) => (prev?.kind === 'game' ? { ...prev, form: update(prev.form) } : prev))} clubId={selectedClubId} onUploadingChange={setUploading} />
            ) : editor.kind === 'zone' ? (
              <ZoneEditor form={editor.form} onChange={(update) => setEditor((prev) => (prev?.kind === 'zone' ? { ...prev, form: update(prev.form) } : prev))} clubId={selectedClubId} onUploadingChange={setUploading} />
            ) : (
              <OfferEditor form={editor.form} onChange={(update) => setEditor((prev) => (prev?.kind === 'offer' ? { ...prev, form: update(prev.form) } : prev))} />
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
