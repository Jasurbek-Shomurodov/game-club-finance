'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, LogOut, Plus } from 'lucide-react';
import { ExpensePresetsSection } from './ExpensePresetsSection';
import { MigrationHealthPanel } from './MigrationHealthPanel';
import { SettingsSection } from './SettingsSection';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ClubLogo,
  Field,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { isMissingDatabaseColumn } from '@/lib/supabase/errors';
import { useClub } from '@/components/layout/DashboardShell';
import { useSignOut } from '@/components/layout/useSignOut';
import { normalizePaymentMethods } from '@/lib/paymentMethods';
import { normalizeBusinessDayStartHour } from '@/lib/utils';
import {
  CLUB_ADDRESS_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  buildClubDetailsUpdate,
  clubDetailsUnchanged,
  validateClubDetails,
} from '@/lib/clubDetails';
import { cn } from '@/lib/utils';
import { PAYMENT_METHODS, type EntryPaymentMethod, type UserRole } from '@/types';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** One setting inside a section card: label and help on the left, a compact control on the right. Stacks on phones. */
function SettingRow({ id, title, help, stacked = false, children }: {
  id: string;
  title: string;
  help?: string;
  /** Put a wide control under the label instead of beside it. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-3 px-5 py-4', !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-8')}>
      <div className="min-w-0">
        <h3 id={id} className="text-sm font-semibold text-gray-950">{title}</h3>
        {help && <p className="mt-0.5 max-w-md text-[13px] leading-5 text-gray-500">{help}</p>}
      </div>
      <div className={stacked ? 'min-w-0' : 'shrink-0'}>{children}</div>
    </div>
  );
}

export function SettingsPageClient() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const tRoles = useTranslations('team.roles');
  const tNav = useTranslations('nav');
  const { signOut, signingOut } = useSignOut();
  const { account, memberships, role: clubRole, selectedClub, setSelectedClubId, refreshClubs } = useClub();
  const { showToast, toastElement } = useToast();
  const [clubForm, setClubForm] = useState({ name: '', address: '' });
  const [clubSaving, setClubSaving] = useState(false);
  const [clubError, setClubError] = useState('');
  const [createClubOpen, setCreateClubOpen] = useState(false);
  const [details, setDetails] = useState({ name: '', address: '' });
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [businessDayStartHour, setBusinessDayStartHour] = useState(0);
  const [businessDaySaving, setBusinessDaySaving] = useState(false);
  const [businessDayError, setBusinessDayError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<EntryPaymentMethod[]>([...PAYMENT_METHODS]);
  const [paymentMethodsSaving, setPaymentMethodsSaving] = useState(false);
  const [paymentMethodsError, setPaymentMethodsError] = useState('');
  // Read here rather than in the dashboard bootstrap: only Settings and the Telegram report use it.
  const [internetPaymentDay, setInternetPaymentDay] = useState<number | null>(null);
  const [savedInternetPaymentDay, setSavedInternetPaymentDay] = useState<number | null>(null);
  const [internetPaymentDayState, setInternetPaymentDayState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [internetPaymentDaySaving, setInternetPaymentDaySaving] = useState(false);
  const [internetPaymentDayError, setInternetPaymentDayError] = useState('');
  const isOwner = clubRole === 'owner';
  const savedPaymentMethodsKey = normalizePaymentMethods(selectedClub?.enabled_payment_methods).join(',');

  function roleLabel(role: string | null | undefined): string {
    return role === 'owner' || role === 'admin' || role === 'viewer' ? tRoles(role as UserRole) : (role ?? '');
  }

  useEffect(() => {
    setDetails({ name: selectedClub?.name ?? '', address: selectedClub?.address ?? '' });
    setDetailsError('');
  }, [selectedClub?.id, selectedClub?.name, selectedClub?.address]);

  useEffect(() => {
    setBusinessDayStartHour(normalizeBusinessDayStartHour(selectedClub?.business_day_start_hour));
    setBusinessDayError('');
  }, [selectedClub?.business_day_start_hour, selectedClub?.id]);

  // Depend on the joined value, not the array reference: a silent club refresh
  // returns a new array and must not wipe an unsaved draft.
  useEffect(() => {
    setPaymentMethods(normalizePaymentMethods(savedPaymentMethodsKey ? savedPaymentMethodsKey.split(',') : []));
    setPaymentMethodsError('');
  }, [savedPaymentMethodsKey, selectedClub?.id]);

  useEffect(() => {
    const clubId = selectedClub?.id;
    setInternetPaymentDayError('');
    setInternetPaymentDayState('loading');
    if (!clubId) return;
    let cancelled = false;

    void (async () => {
      const { data, error } = await createClient()
        .from('clubs')
        .select('internet_payment_day')
        .eq('id', clubId)
        .single();
      if (cancelled) return;
      if (error) {
        if (!isMissingDatabaseColumn(error, 'internet_payment_day')) {
          console.error('Failed to load internet payment day', error);
          setInternetPaymentDayError(t('saveError'));
        }
        setInternetPaymentDayState('unavailable');
        return;
      }
      const day = (data as { internet_payment_day?: number | null }).internet_payment_day ?? null;
      setInternetPaymentDay(day);
      setSavedInternetPaymentDay(day);
      setInternetPaymentDayState('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClub?.id, t]);

  async function handleCreateClub(event: React.FormEvent) {
    event.preventDefault();
    if (!clubForm.name.trim()) {
      setClubError(t('clubNameRequired'));
      return;
    }

    setClubSaving(true);
    setClubError('');

    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_club_with_owner', {
        p_name: clubForm.name.trim(),
        p_address: clubForm.address.trim() || null,
      });

      if (error) {
        console.error('Failed to create club', error);
        setClubError(t('saveError'));
        return;
      }

      setClubForm({ name: '', address: '' });
      setCreateClubOpen(false);
      showToast(t('clubCreated'));

      const createdClub = Array.isArray(data) ? data[0] : data;
      try {
        // Load the new membership first so the selection points at a known club.
        await refreshClubs();
      } catch (refreshError) {
        console.error('Failed to refresh clubs', refreshError);
      }
      if (createdClub?.id) {
        setSelectedClubId(createdClub.id);
      }
    } catch (saveError) {
      console.error('Failed to create club', saveError);
      setClubError(t('saveError'));
    } finally {
      setClubSaving(false);
    }
  }

  async function saveClubDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedClub || !isOwner) return;
    const validation = validateClubDetails(details);
    if (validation) {
      setDetailsError(t(`clubDetailsError_${validation}`));
      return;
    }

    setDetailsSaving(true);
    setDetailsError('');

    try {
      const { data, error } = await createClient()
        .from('clubs')
        .update({ ...buildClubDetailsUpdate(details), updated_at: new Date().toISOString() })
        .eq('id', selectedClub.id)
        .select('id');

      if (error) throw error;
      // RLS silently matches no row when the owner role was revoked meanwhile.
      if (!data?.length) throw new Error('club update matched no row');

      showToast(t('clubDetailsSaved'));
      await refreshClubs();
    } catch (saveError) {
      console.error('Failed to save club details', saveError);
      setDetailsError(t('saveError'));
    } finally {
      setDetailsSaving(false);
    }
  }

  async function saveBusinessDay(hour: number) {
    if (!selectedClub || !isOwner) {
      setBusinessDayError(t('businessDayInvalid'));
      return;
    }

    setBusinessDaySaving(true);
    setBusinessDayError('');

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('clubs')
        .update({
          business_day_start_hour: hour,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedClub.id)
        .select('id');

      if (error) throw error;
      // RLS silently matches no row when the owner role was revoked meanwhile.
      if (!data?.length) throw new Error('club update matched no row');

      showToast(t('businessDaySaved'));
      await refreshClubs();
    } catch (saveError) {
      console.error('Failed to save business day', saveError);
      setBusinessDayError(t('saveError'));
      setBusinessDayStartHour(normalizeBusinessDayStartHour(selectedClub.business_day_start_hour));
    } finally {
      setBusinessDaySaving(false);
    }
  }

  async function savePaymentMethods(next: EntryPaymentMethod[]) {
    if (!selectedClub || !isOwner || next.length === 0) {
      setPaymentMethodsError(t('paymentMethodsRequired'));
      return;
    }

    setPaymentMethodsSaving(true);
    setPaymentMethodsError('');

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('clubs')
        .update({
          enabled_payment_methods: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedClub.id)
        .select('id');

      if (error) throw error;
      // RLS silently matches no row when the owner role was revoked meanwhile.
      if (!data?.length) throw new Error('club update matched no row');

      showToast(t('paymentMethodsSaved'));
      await refreshClubs();
    } catch (saveError) {
      console.error('Failed to save payment methods', saveError);
      setPaymentMethodsError(t('saveError'));
      setPaymentMethods(normalizePaymentMethods(savedPaymentMethodsKey ? savedPaymentMethodsKey.split(',') : []));
    } finally {
      setPaymentMethodsSaving(false);
    }
  }

  async function saveInternetPaymentDay(day: number | null) {
    if (!selectedClub || !isOwner) return;

    setInternetPaymentDaySaving(true);
    setInternetPaymentDayError('');

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('clubs')
        .update({
          internet_payment_day: day,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedClub.id)
        .select('id');

      if (error) throw error;
      // RLS silently matches no row when the owner role was revoked meanwhile.
      if (!data?.length) throw new Error('club update matched no row');

      setSavedInternetPaymentDay(day);
      showToast(t('internetPaymentDaySaved'));
    } catch (saveError) {
      console.error('Failed to save internet payment day', saveError);
      setInternetPaymentDayError(t('saveError'));
      setInternetPaymentDay(savedInternetPaymentDay);
    } finally {
      setInternetPaymentDaySaving(false);
    }
  }

  // Club settings apply as soon as they change; a failed save puts the saved value back.
  function changeBusinessDay(hour: number) {
    setBusinessDayStartHour(hour);
    void saveBusinessDay(hour);
  }

  function changeInternetPaymentDay(value: string) {
    const day = value ? Number(value) : null;
    setInternetPaymentDay(day);
    void saveInternetPaymentDay(day);
  }

  function togglePaymentMethod(method: EntryPaymentMethod) {
    setPaymentMethodsError('');
    const enabled = paymentMethods.includes(method);
    if (enabled && paymentMethods.length === 1) {
      setPaymentMethodsError(t('paymentMethodsRequired'));
      return;
    }
    const next = PAYMENT_METHODS.filter((candidate) => (
      candidate === method ? !enabled : paymentMethods.includes(candidate)
    ));
    setPaymentMethods(next);
    void savePaymentMethods(next);
  }

  function closeCreateClub() {
    if (clubSaving) return;
    setCreateClubOpen(false);
    setClubError('');
  }

  const clubSettingsSaving = detailsSaving || businessDaySaving || paymentMethodsSaving || internetPaymentDaySaving;
  const clubSettingsDisabled = !selectedClub || !isOwner || clubSettingsSaving;

  return (
    <div className="w-full max-w-4xl space-y-8">
      <PageHeader title={t('title')} />

      {/* Who is signed in, and the way out. */}
      <Card as="section" aria-label={t('tabProfile')} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* The shell already loaded the account; no second profile read. */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar name={account.fullName || account.email || '?'} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-semibold tracking-tight text-gray-950">{account.fullName || t('account')}</p>
              <Badge size="sm" variant="outline">{roleLabel(account.profileRole)}</Badge>
            </div>
            <p className="truncate text-sm text-gray-500">{account.email || '—'}</p>
          </div>
        </div>
        <Button
          variant="outline"
          icon={<LogOut size={16} aria-hidden="true" />}
          loading={signingOut}
          onClick={() => void signOut()}
          className="sm:shrink-0"
        >
          {tNav('signOut')}
        </Button>
      </Card>

      <SettingsSection title={selectedClub?.name ?? t('tabClub')}>
        <Card padding="none" className="divide-y divide-gray-100 overflow-hidden">
          <SettingRow id="setting-club-details" title={t('clubDetails')} help={t('clubDetailsHelp')} stacked>
            {selectedClub ? (
              <form onSubmit={saveClubDetails} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center" aria-labelledby="setting-club-details">
                <Input
                  id="club-details-name"
                  aria-label={t('clubName')}
                  placeholder={t('clubName')}
                  maxLength={CLUB_NAME_MAX_LENGTH}
                  value={details.name}
                  disabled={!isOwner || detailsSaving}
                  onChange={(event) => { setDetailsError(''); setDetails((prev) => ({ ...prev, name: event.target.value })); }}
                />
                <Input
                  id="club-details-address"
                  aria-label={t('clubAddress')}
                  placeholder={t('clubAddress')}
                  maxLength={CLUB_ADDRESS_MAX_LENGTH}
                  value={details.address}
                  disabled={!isOwner || detailsSaving}
                  onChange={(event) => { setDetailsError(''); setDetails((prev) => ({ ...prev, address: event.target.value })); }}
                />
                {isOwner && (
                  <Button
                    type="submit"
                    size="sm"
                    loading={detailsSaving}
                    loadingLabel={tc('saving')}
                    disabled={clubDetailsUnchanged(details, selectedClub)}
                    className="justify-self-end sm:min-h-11"
                  >
                    {tc('save')}
                  </Button>
                )}
              </form>
            ) : (
              <Skeleton className="h-11 w-full" />
            )}
          </SettingRow>

          <SettingRow id="setting-business-day" title={t('businessDay')} help={t('businessDayHelp')}>
            {selectedClub ? (
              <Select
                id="business-day-hour"
                aria-labelledby="setting-business-day"
                value={businessDayStartHour}
                disabled={clubSettingsDisabled}
                onChange={(event) => changeBusinessDay(Number(event.target.value))}
                className="sm:w-36"
              >
                {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
              </Select>
            ) : (
              <Skeleton className="h-11 w-36" />
            )}
          </SettingRow>

          <SettingRow id="setting-payment-methods" title={t('paymentMethods')} help={t('paymentMethodsHelp')}>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="setting-payment-methods">
              {PAYMENT_METHODS.map((method) => {
                const enabled = paymentMethods.includes(method);
                return (
                  <Button
                    key={method}
                    variant="outline"
                    aria-pressed={enabled}
                    disabled={clubSettingsDisabled}
                    onClick={() => togglePaymentMethod(method)}
                    icon={enabled ? <Check size={15} aria-hidden="true" /> : undefined}
                    className={cn(
                      'min-h-10 gap-1.5 rounded-full px-3.5 font-medium shadow-none disabled:opacity-60',
                      enabled
                        ? 'border-primary-600 bg-primary-50 text-primary-700 hover:border-primary-600 hover:bg-primary-50 disabled:border-primary-600 disabled:bg-primary-50 disabled:text-primary-700'
                        : 'text-gray-500 hover:text-gray-900 disabled:bg-surface disabled:text-gray-500',
                    )}
                  >
                    {tc(`paymentMethods.${method}`)}
                  </Button>
                );
              })}
            </div>
          </SettingRow>

          <SettingRow
            id="setting-internet-payment-day"
            title={t('internetPaymentDay')}
            help={internetPaymentDayState === 'unavailable' && !internetPaymentDayError
              ? t('internetPaymentDayUnavailable')
              : t('internetPaymentDayHelp')}
          >
            {internetPaymentDayState === 'loading' ? (
              <Skeleton className="h-11 w-36" />
            ) : (
              <Select
                id="internet-payment-day"
                aria-labelledby="setting-internet-payment-day"
                value={internetPaymentDay ?? ''}
                disabled={clubSettingsDisabled || internetPaymentDayState !== 'ready'}
                onChange={(event) => changeInternetPaymentDay(event.target.value)}
                className="sm:w-36"
              >
                <option value="">{t('internetPaymentDayNone')}</option>
                {MONTH_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
              </Select>
            )}
          </SettingRow>

          {(detailsError || businessDayError || paymentMethodsError || internetPaymentDayError || !isOwner) && (
            <div className="space-y-2 bg-gray-50/60 px-5 py-3">
              {detailsError && <InlineAlert variant="danger" hideIcon className="py-2">{detailsError}</InlineAlert>}
              {businessDayError && <InlineAlert variant="danger" hideIcon className="py-2">{businessDayError}</InlineAlert>}
              {paymentMethodsError && <InlineAlert variant="danger" hideIcon className="py-2">{paymentMethodsError}</InlineAlert>}
              {internetPaymentDayError && <InlineAlert variant="danger" hideIcon className="py-2">{internetPaymentDayError}</InlineAlert>}
              {!isOwner && <p className="text-xs text-gray-500">{t('businessDayOwnerOnly')} {t('paymentMethodsOwnerOnly')}</p>}
            </div>
          )}
        </Card>
      </SettingsSection>

      <SettingsSection title={<>{t('clubs')} <span className="font-normal text-gray-400">{memberships.length}</span></>}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('clubs')}>
          {memberships.map((membership) => {
            const selected = selectedClub?.id === membership.club.id;
            return (
              <li key={membership.club.id}>
                <Card
                  as="button"
                  padding="none"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => setSelectedClubId(membership.club.id)}
                  className={cn(
                    'flex h-full min-h-24 w-full items-start gap-3 p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    selected ? 'border-primary-600 ring-1 ring-primary-600' : 'hover:border-gray-300',
                  )}
                >
                  <ClubLogo size={36} className="shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-950">{membership.club.name}</span>
                    <span className="block truncate text-xs text-gray-500">{membership.club.address || '\u00a0'}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" variant={membership.role === 'owner' ? 'primary' : membership.role === 'admin' ? 'neutral' : 'outline'}>
                        {roleLabel(membership.role)}
                      </Badge>
                      {selected && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-600">
                          <Check size={13} aria-hidden="true" />
                          {t('selectedClub')}
                        </span>
                      )}
                    </span>
                  </span>
                </Card>
              </li>
            );
          })}
          {isOwner && (
            <li>
              <Card
                as="button"
                padding="none"
                dashed
                onClick={() => setCreateClubOpen(true)}
                className="flex h-full min-h-24 w-full items-center justify-center gap-2 border-gray-300 bg-transparent p-4 text-sm font-medium text-gray-500 transition hover:border-primary-500 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <Plus size={16} aria-hidden="true" />
                {t('addClub')}
              </Card>
            </li>
          )}
        </ul>
      </SettingsSection>

      {selectedClub && <ExpensePresetsSection key={selectedClub.id} clubId={selectedClub.id} isOwner={isOwner} />}

      {isOwner && selectedClub && (
        <Card as="section" padding="none" className="overflow-hidden">
          <MigrationHealthPanel key={selectedClub.id} clubId={selectedClub.id} />
        </Card>
      )}

      <Modal
        open={createClubOpen && isOwner}
        onClose={closeCreateClub}
        locked={clubSaving}
        title={t('addClub')}
        size="sm"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={clubSaving} onClick={closeCreateClub}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="create-club-form" loading={clubSaving} loadingLabel={t('savingClub')}>{t('createClub')}</Button>
          </>
        )}
      >
        <form id="create-club-form" onSubmit={handleCreateClub} className="space-y-4">
          <Field label={t('clubName')} htmlFor="new-club-name" required>
            <Input
              id="new-club-name"
              autoFocus
              maxLength={120}
              value={clubForm.name}
              onChange={(event) => setClubForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label={t('clubAddress')} htmlFor="new-club-address">
            <Input
              id="new-club-address"
              maxLength={200}
              value={clubForm.address}
              onChange={(event) => setClubForm((current) => ({ ...current, address: event.target.value }))}
            />
          </Field>
          {clubError && <InlineAlert variant="danger">{clubError}</InlineAlert>}
        </form>
      </Modal>

      {toastElement}
    </div>
  );
}
