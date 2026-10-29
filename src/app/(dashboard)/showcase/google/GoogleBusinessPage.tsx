'use client';

// Route: /showcase/google

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, LogIn, MapPin, Unplug } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  LoadErrorAlert,
  PageHeader,
  PageSkeleton,
  SectionHeading,
  Select,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { formatDateTime } from '@/lib/formatters';
import type { GooglePostSummary } from '@/lib/googleBusiness/posts';
import { canAccessFeature } from '@/lib/permissions';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { ShowcaseTabs } from '../ShowcaseTabs';
import { GoogleListingCard } from './GoogleListingCard';
import { GooglePhotoCard } from './GooglePhotoCard';
import { GooglePostComposer } from './GooglePostComposer';
import { errorMessageKey, googleBusinessApi, type GoogleConnectionStatus } from './googleBusinessApi';

const EMPTY: GoogleConnectionStatus = { configured: true, connection: null };
const OUTCOMES = ['connected', 'denied', 'failed', 'forbidden', 'not_configured', 'no_refresh_token'] as const;

/** Error codes the status route reports for the listing lookup. */
function locationsErrorKey(code: string) {
  return ['QUOTA', 'RECONNECT', 'FORBIDDEN'].includes(code) ? `error_GOOGLE_${code}` : 'error_generic';
}

export default function GoogleBusinessPage() {
  const t = useTranslations('googleBusiness');
  const ts = useTranslations('showcase');
  const { selectedClubId, role, featureAccess, businessDayStartHour } = useClub();
  const { locale } = useAppLocale();
  const today = useBusinessToday(businessDayStartHour);
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const isOwner = role === 'owner';
  const canEdit = canAccessFeature(role, featureAccess, 'showcase');

  const load = useCallback(async () => {
    if (!selectedClubId || !canEdit) return EMPTY;
    return googleBusinessApi.status(selectedClubId);
  }, [selectedClubId, canEdit]);
  const query = useClubQuery(load, EMPTY);
  const { configured, connection, locations = [], locationsError } = query.data;
  const ready = Boolean(connection?.locationName);

  const loadPosts = useCallback(async (): Promise<{ posts: GooglePostSummary[]; failed: string | null }> => {
    if (!selectedClubId || !ready) return { posts: [], failed: null };
    try {
      return { ...(await googleBusinessApi.posts(selectedClubId)), failed: null };
    } catch (error) {
      return { posts: [], failed: errorMessageKey(error) };
    }
  }, [selectedClubId, ready]);
  const postsQuery = useClubQuery(loadPosts, { posts: [], failed: null });

  const [locationChoice, setLocationChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number] | null>(null);

  // The Google sign-in returns with ?google=<outcome>; show it once and clean the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const value = url.searchParams.get('google') as (typeof OUTCOMES)[number] | null;
    if (!value || !OUTCOMES.includes(value)) return;
    setOutcome(value);
    url.searchParams.delete('google');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, []);

  useEffect(() => {
    setLocationChoice(locations[0]?.locationName ?? '');
  }, [locations]);
  useEffect(() => setActionError(''), [selectedClubId]);

  async function chooseLocation() {
    if (!selectedClubId || !locationChoice) return;
    setBusy(true);
    setActionError('');
    try {
      await googleBusinessApi.chooseLocation(selectedClubId, locationChoice);
      showToast(t('locationSaved'));
      await query.reload({ silent: true });
    } catch (error) {
      setActionError(t(errorMessageKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!selectedClubId) return;
    const accepted = await confirm({
      title: t('disconnectTitle'),
      description: t('disconnectDescription'),
      confirmLabel: t('disconnect'),
      tone: 'danger',
    });
    if (!accepted) return;
    setBusy(true);
    setActionError('');
    try {
      await googleBusinessApi.disconnect(selectedClubId);
      showToast(t('disconnected'));
      await query.reload({ silent: true });
    } catch (error) {
      setActionError(t(errorMessageKey(error)));
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    if (selectedClubId) window.location.assign(googleBusinessApi.connectUrl(selectedClubId));
  }

  const connectButton = (
    <Button type="button" onClick={connect} icon={<LogIn size={15} aria-hidden="true" />}>
      {connection ? t('reconnect') : t('connect')}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={ts('title')} tabs={<ShowcaseTabs current="/showcase/google" />} />

      {outcome && (
        <InlineAlert variant={outcome === 'connected' ? 'success' : 'warning'}>{t(`outcome_${outcome}`)}</InlineAlert>
      )}

      {!canEdit ? (
        <InlineAlert variant="info">{ts('ownerOnly')}</InlineAlert>
      ) : query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadFailed')}</LoadErrorAlert>
      ) : !configured ? (
        <InlineAlert variant="info" title={t('notConfiguredTitle')}>{t('notConfiguredDescription')}</InlineAlert>
      ) : !connection ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={MapPin}
              title={t('connectTitle')}
              description={isOwner ? t('connectDescription') : t('connectOwnerOnly')}
              action={isOwner ? connectButton : undefined}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <SectionHeading
                title={t('connectionTitle')}
                badge={<Badge variant={ready ? 'success' : 'warning'}>{ready ? t('statusReady') : t('statusNoLocation')}</Badge>}
                action={isOwner ? (
                  <Button type="button" variant="ghost" size="sm" loading={busy} onClick={() => void disconnect()} icon={<Unplug size={15} aria-hidden="true" />}>
                    {t('disconnect')}
                  </Button>
                ) : undefined}
              />
            </CardHeader>
            <CardBody className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-gray-500">{t('googleAccount')}</dt>
                  <dd className="font-medium text-gray-900">{connection.googleEmail ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('listing')}</dt>
                  <dd className="font-medium text-gray-900">{connection.locationTitle ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('connectedAt')}</dt>
                  <dd className="font-medium text-gray-900">{formatDateTime(connection.connectedAt, locale)}</dd>
                </div>
              </dl>

              {!ready && (
                locationsError ? (
                  <InlineAlert variant="warning" action={isOwner && locationsError === 'RECONNECT' ? connectButton : undefined}>
                    {t(locationsErrorKey(locationsError))}
                  </InlineAlert>
                ) : locations.length === 0 ? (
                  <InlineAlert variant="warning">{t('noLocations')}</InlineAlert>
                ) : isOwner ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field label={t('chooseLocation')} htmlFor="google-location" className="min-w-0 flex-1">
                      <Select id="google-location" value={locationChoice} onChange={(event) => setLocationChoice(event.target.value)}>
                        {locations.map((location) => (
                          <option key={location.locationName} value={location.locationName}>
                            {location.address ? `${location.title} — ${location.address}` : location.title}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="button" loading={busy} onClick={() => void chooseLocation()}>{t('saveLocation')}</Button>
                  </div>
                ) : (
                  <InlineAlert variant="info">{t('chooseLocationOwnerOnly')}</InlineAlert>
                )
              )}
              {actionError && <InlineAlert variant="danger">{actionError}</InlineAlert>}
            </CardBody>
          </Card>

          {ready && selectedClubId && (
            <>
              <GoogleListingCard clubId={selectedClubId} isOwner={isOwner} onSaved={() => showToast(t('listingSaved'))} />
              <GooglePostComposer
                clubId={selectedClubId}
                defaultLanguage={locale}
                today={today}
                onPublished={() => {
                  showToast(t('published'));
                  void postsQuery.reload({ silent: true });
                }}
              />
              <GooglePhotoCard clubId={selectedClubId} onAdded={() => showToast(t('photoAdded'))} />
              <Card>
                <CardHeader>
                  <SectionHeading title={t('recentTitle')} description={t('recentDescription')} />
                </CardHeader>
                <CardBody>
                  {postsQuery.loading ? (
                    <PageSkeleton />
                  ) : postsQuery.data.failed ? (
                    <InlineAlert variant="warning">{t(postsQuery.data.failed)}</InlineAlert>
                  ) : postsQuery.data.posts.length === 0 ? (
                    <EmptyState compact title={t('recentEmpty')} />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {postsQuery.data.posts.map((post) => (
                        <li key={post.name} className="flex gap-3 py-3">
                          {post.photoUrl && (
                            // Google-hosted image; next/image's allow-list does not include it.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.photoUrl} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="neutral">{t(`kind_${post.kind}`)}</Badge>
                              {post.state !== 'LIVE' && <Badge variant="warning">{t('statePending')}</Badge>}
                              {post.createTime && <span className="text-xs text-gray-500">{formatDateTime(post.createTime, locale)}</span>}
                            </div>
                            {post.title && <p className="font-medium text-gray-900">{post.title}</p>}
                            {post.summary && <p className="line-clamp-3 whitespace-pre-line text-sm text-gray-700">{post.summary}</p>}
                          </div>
                          {post.searchUrl && (
                            <a
                              href={post.searchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 self-start text-gray-500 hover:text-gray-900"
                              aria-label={t('viewOnGoogle')}
                              title={t('viewOnGoogle')}
                            >
                              <ExternalLink size={16} aria-hidden="true" />
                            </a>
                          )}
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
      {toastElement}
      {confirmDialog}
    </div>
  );
}
