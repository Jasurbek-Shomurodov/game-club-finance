'use client';

// Route: /showcase

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BadgePercent, Cpu, ExternalLink, Gamepad2, Monitor, Mouse, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { useClubQuery } from '@/lib/useClubQuery';
import type { ShowcaseGame, ShowcaseOffer, ShowcasePcZone } from '@/types';
import { BrandSettingsCard } from './BrandSettingsCard';
import { LocalizedTextField } from './LocalizedTextField';
import { ShowcaseImageField } from './ShowcaseImageField';

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
  const { selectedClubId, selectedClub, role, account } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const isOwner = role === 'owner';

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
  useEffect(() => {
    setSettings(showcaseSettingsForm(showcase, selectedClub?.name ?? ''));
    setSettingsError('');
  }, [showcase, selectedClub?.name]);
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

  function openOffer(offer: ShowcaseOffer | null) {
    setEditorError('');
    setEditor({ kind: 'offer', id: offer?.id ?? null, form: showcaseOfferForm(offer, nextSortOrder(offers)) });
  }

  function setEditorField(field: string, value: unknown) {
    setEditor((prev) => (prev ? { ...prev, form: { ...prev.form, [field]: value } } as Editor : prev));
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !isOwner || !selectedClubId) return;
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
    showToast(t('saved'));
    await query.reload({ silent: true });
  }

  async function deleteItem() {
    if (!editor?.id || !isOwner || !selectedClubId) return;
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
    <div className="w-full max-w-5xl space-y-5">
      <PageHeader title={t('title')} action={openPublicLink} />

      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadFailed')}</LoadErrorAlert>
      ) : missing ? (
        <InlineAlert variant="warning">{t('migrationMissing')}</InlineAlert>
      ) : (
        <>
          <BrandSettingsCard userId={account.userId} clubId={selectedClubId} onSaved={showToast} />

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
                  <LocalizedTextField
                    id="showcase-headline"
                    label={t('headline')}
                    hint={t('headlineHint')}
                    maxLength={80}
                    placeholder={selectedClub?.name}
                    value={settings.headline}
                    onChange={(value) => setField('headline', value)}
                  />
                </div>
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
                              {[zone.gpu, zone.cpu, zone.ram, monitorSummary(zone)].filter(Boolean).join(' · ') || t('noSpecs')}
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
                        <li key={offer.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <span className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 px-2 text-sm font-bold text-primary-700">
                            {offer.badge || <BadgePercent size={18} aria-hidden="true" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                              {offer.title}
                              {!offer.is_active && <Badge variant="neutral">{t('offerHidden')}</Badge>}
                              {offer.price !== null && (
                                <span className="text-xs font-medium text-gray-500">{formatCurrency(offer.price)} {tc('currency')}</span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-gray-500">
                              {[offer.time_window, offer.description].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <IconButton
                            variant="ghost"
                            size="sm"
                            label={`${tc('edit')}: ${offer.title}`}
                            icon={<Pencil size={15} aria-hidden="true" />}
                            onClick={() => openOffer(offer)}
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
            ) : editor.kind === 'zone' ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={t('zoneName')} htmlFor="zone-name" required className="sm:col-span-2">
                    <Input id="zone-name" value={editor.form.name} maxLength={60} placeholder={t('zoneNamePlaceholder')} onChange={(e) => setEditorField('name', e.target.value)} />
                  </Field>
                  <Field label={t('pcCount')} htmlFor="zone-count" required>
                    <Input id="zone-count" inputMode="numeric" value={editor.form.pc_count} onChange={(e) => setEditorField('pc_count', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label={t('pricePerHour')} htmlFor="zone-price" className="sm:col-span-2">
                    <CurrencyInput id="zone-price" value={editor.form.price_per_hour} onValueChange={(value) => setEditorField('price_per_hour', value)} trailingAddon={tc('currency')} />
                  </Field>
                  <Field label={t('sortOrder')} htmlFor="zone-sort">
                    <Input id="zone-sort" inputMode="numeric" value={editor.form.sort_order} onChange={(e) => setEditorField('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
                  </Field>
                </div>
                <Card tone="muted" padding="sm" className="space-y-3">
                  <SectionHeading as="h3" size="sm" title={t('specsComputer')} icon={<Cpu size={16} aria-hidden="true" />} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('cpu')} htmlFor="zone-cpu">
                      <Input id="zone-cpu" value={editor.form.cpu} maxLength={80} placeholder="Intel Core i7-14700K" onChange={(e) => setEditorField('cpu', e.target.value)} />
                    </Field>
                    <Field label={t('gpu')} htmlFor="zone-gpu">
                      <Input id="zone-gpu" value={editor.form.gpu} maxLength={80} placeholder="RTX 4070 Super" onChange={(e) => setEditorField('gpu', e.target.value)} />
                    </Field>
                    <Field label={t('ram')} htmlFor="zone-ram">
                      <Input id="zone-ram" value={editor.form.ram} maxLength={80} placeholder="32 GB DDR5" onChange={(e) => setEditorField('ram', e.target.value)} />
                    </Field>
                    <Field label={t('storage')} htmlFor="zone-storage">
                      <Input id="zone-storage" value={editor.form.storage} maxLength={80} placeholder="1 TB NVMe SSD" onChange={(e) => setEditorField('storage', e.target.value)} />
                    </Field>
                  </div>
                </Card>
                <Card tone="muted" padding="sm" className="space-y-3">
                  <SectionHeading as="h3" size="sm" title={t('specsMonitor')} icon={<Monitor size={16} aria-hidden="true" />} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
                    <Field label={t('monitorModel')} htmlFor="zone-monitor">
                      <Input id="zone-monitor" value={editor.form.monitor} maxLength={80} placeholder="ASUS ROG Swift" onChange={(e) => setEditorField('monitor', e.target.value)} />
                    </Field>
                    <Field label={t('monitorSize')} htmlFor="zone-monitor-size">
                      <Input id="zone-monitor-size" inputMode="decimal" value={editor.form.monitor_size_inches} placeholder="27" trailingAddon={t('inchUnit')} onChange={(e) => setEditorField('monitor_size_inches', e.target.value.replace(/[^\d.,]/g, ''))} />
                    </Field>
                    <Field label={t('monitorRefresh')} htmlFor="zone-monitor-hz">
                      <Input id="zone-monitor-hz" inputMode="numeric" value={editor.form.monitor_refresh_hz} placeholder="240" trailingAddon={t('hzUnit')} onChange={(e) => setEditorField('monitor_refresh_hz', e.target.value.replace(/\D/g, ''))} />
                    </Field>
                  </div>
                </Card>
                <Card tone="muted" padding="sm" className="space-y-3">
                  <SectionHeading as="h3" size="sm" title={t('specsPeripherals')} icon={<Mouse size={16} aria-hidden="true" />} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('mouse')} htmlFor="zone-mouse">
                      <Input id="zone-mouse" value={editor.form.mouse} maxLength={80} placeholder="Logitech G Pro X Superlight" onChange={(e) => setEditorField('mouse', e.target.value)} />
                    </Field>
                    <Field label={t('keyboard')} htmlFor="zone-keyboard">
                      <Input id="zone-keyboard" value={editor.form.keyboard} maxLength={80} placeholder="SteelSeries Apex Pro" onChange={(e) => setEditorField('keyboard', e.target.value)} />
                    </Field>
                    <Field label={t('headset')} htmlFor="zone-headset">
                      <Input id="zone-headset" value={editor.form.headset} maxLength={80} placeholder="HyperX Cloud II" onChange={(e) => setEditorField('headset', e.target.value)} />
                    </Field>
                    <Field label={t('chair')} htmlFor="zone-chair">
                      <Input id="zone-chair" value={editor.form.chair} maxLength={80} placeholder="DXRacer" onChange={(e) => setEditorField('chair', e.target.value)} />
                    </Field>
                  </div>
                  <Field label={t('peripherals')} htmlFor="zone-peripherals">
                    <Textarea id="zone-peripherals" rows={2} maxLength={240} value={editor.form.peripherals} placeholder={t('peripheralsPlaceholder')} onChange={(e) => setEditorField('peripherals', e.target.value)} />
                  </Field>
                </Card>
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
            ) : (
              <>
                <LocalizedTextField
                  id="offer-title"
                  label={t('offerTitle')}
                  maxLength={80}
                  placeholder={t('offerTitlePlaceholder')}
                  value={editor.form.title}
                  onChange={(value) => setEditorField('title', value)}
                />
                <LocalizedTextField
                  id="offer-description"
                  label={t('offerDescription')}
                  multiline
                  maxLength={240}
                  placeholder={t('offerDescriptionPlaceholder')}
                  value={editor.form.description}
                  onChange={(value) => setEditorField('description', value)}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('offerBadge')} htmlFor="offer-badge" hint={t('offerBadgeHint')}>
                    <Input id="offer-badge" value={editor.form.badge} maxLength={12} placeholder="2+1" onChange={(e) => setEditorField('badge', e.target.value)} />
                  </Field>
                  <Field label={t('offerTimeWindow')} htmlFor="offer-time" hint={t('offerTimeWindowHint')}>
                    <Input id="offer-time" value={editor.form.time_window} maxLength={40} placeholder="22:00 – 08:00" onChange={(e) => setEditorField('time_window', e.target.value)} />
                  </Field>
                  <Field label={t('offerPrice')} htmlFor="offer-price">
                    <CurrencyInput id="offer-price" value={editor.form.price} onValueChange={(value) => setEditorField('price', value)} trailingAddon={tc('currency')} />
                  </Field>
                  <Field label={t('sortOrder')} htmlFor="offer-sort">
                    <Input id="offer-sort" inputMode="numeric" value={editor.form.sort_order} onChange={(e) => setEditorField('sort_order', e.target.value.replace(/[^\d-]/g, ''))} />
                  </Field>
                </div>
                <Checkbox id="offer-active" checked={editor.form.is_active} onChange={(e) => setEditorField('is_active', e.target.checked)} label={t('offerActive')} />
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
