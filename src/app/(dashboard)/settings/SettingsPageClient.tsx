'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Plus } from 'lucide-react';
import { MigrationHealthPanel } from './MigrationHealthPanel';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Checkbox,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import { normalizePaymentMethods } from '@/lib/paymentMethods';
import { normalizeBusinessDayStartHour } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { PAYMENT_METHODS, type EntryPaymentMethod, type UserRole } from '@/types';
import { useLatestRef } from '@/components/i18n/useLatestRef';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type SettingsTab = 'club' | 'clubs' | 'profile' | 'developer';

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** One setting: label + help on the left, the control on the right. Stacks on phones. */
function SettingRow({ id, title, help, children }: { id: string; title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-gray-100 px-5 py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <h3 id={id} className="text-sm font-semibold text-gray-950">{title}</h3>
        {help && <p className="mt-1 text-sm leading-5 text-gray-500">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsPageClient() {
  const t = useTranslations('settings');
  const tRef = useLatestRef(t);
  const tc = useTranslations('common');
  const tRoles = useTranslations('team.roles');
  const { memberships, role: clubRole, selectedClub, setSelectedClubId, refreshClubs } = useClub();
  const { showToast, toastElement } = useToast();
  const [tab, setTab] = useState<SettingsTab>('club');
  const [account, setAccount] = useState<{ email?: string | null; fullName?: string | null; role?: string | null }>({});
  const [accountLoading, setAccountLoading] = useState(true);
  const [clubForm, setClubForm] = useState({ name: '', address: '' });
  const [clubSaving, setClubSaving] = useState(false);
  const [clubError, setClubError] = useState('');
  const [createClubOpen, setCreateClubOpen] = useState(false);
  const [businessDayStartHour, setBusinessDayStartHour] = useState(0);
  const [businessDaySaving, setBusinessDaySaving] = useState(false);
  const [businessDayError, setBusinessDayError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<EntryPaymentMethod[]>([...PAYMENT_METHODS]);
  const [paymentMethodsSaving, setPaymentMethodsSaving] = useState(false);
  const [paymentMethodsError, setPaymentMethodsError] = useState('');
  const [accountLoadError, setAccountLoadError] = useState('');
  const isOwner = clubRole === 'owner';
  const savedPaymentMethodsKey = normalizePaymentMethods(selectedClub?.enabled_payment_methods).join(',');
  const activeTab: SettingsTab = tab === 'developer' && !isOwner ? 'club' : tab;

  function roleLabel(role: string | null | undefined): string {
    return role === 'owner' || role === 'admin' || role === 'viewer' ? tRoles(role as UserRole) : (role ?? '');
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) return;

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!cancelled) {
        setAccount({
          email: session.user.email,
          fullName: data?.full_name,
          role: data?.role,
        });
      }
    }

    loadAccount()
      .catch((loadError) => {
        if (!cancelled) {
          console.error('Failed to load account', loadError);
          setAccountLoadError(tRef.current('accountLoadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tRef]);

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

  async function saveBusinessDay() {
    if (!selectedClub || !isOwner) {
      setBusinessDayError(t('businessDayInvalid'));
      return;
    }

    setBusinessDaySaving(true);
    setBusinessDayError('');

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('clubs')
        .update({
          business_day_start_hour: businessDayStartHour,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedClub.id);

      if (error) {
        console.error('Failed to save business day', error);
        setBusinessDayError(t('saveError'));
        return;
      }

      showToast(t('businessDaySaved'));
      await refreshClubs();
    } catch (saveError) {
      console.error('Failed to save business day', saveError);
      setBusinessDayError(t('saveError'));
    } finally {
      setBusinessDaySaving(false);
    }
  }

  function togglePaymentMethod(method: EntryPaymentMethod) {
    setPaymentMethodsError('');
    if (!paymentMethods.includes(method)) {
      setPaymentMethods(PAYMENT_METHODS.filter((candidate) => paymentMethods.includes(candidate) || candidate === method));
      return;
    }
    if (paymentMethods.length === 1) {
      setPaymentMethodsError(t('paymentMethodsRequired'));
      return;
    }
    setPaymentMethods(paymentMethods.filter((candidate) => candidate !== method));
  }

  async function savePaymentMethods() {
    if (!selectedClub || !isOwner || paymentMethods.length === 0) {
      setPaymentMethodsError(t('paymentMethodsRequired'));
      return;
    }

    setPaymentMethodsSaving(true);
    setPaymentMethodsError('');

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('clubs')
        .update({
          enabled_payment_methods: paymentMethods,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedClub.id);

      if (error) {
        console.error('Failed to save payment methods', error);
        setPaymentMethodsError(t('saveError'));
        return;
      }

      showToast(t('paymentMethodsSaved'));
      await refreshClubs();
    } catch (saveError) {
      console.error('Failed to save payment methods', saveError);
      setPaymentMethodsError(t('saveError'));
    } finally {
      setPaymentMethodsSaving(false);
    }
  }

  const paymentMethodsChanged = paymentMethods.join(',') !== savedPaymentMethodsKey;
  const businessDayChanged = businessDayStartHour !== normalizeBusinessDayStartHour(selectedClub?.business_day_start_hour);
  const clubTabSaving = businessDaySaving || paymentMethodsSaving;
  const changeCount = Number(businessDayChanged) + Number(paymentMethodsChanged);

  // One save bar for the club tab: each handler keeps its own error handling.
  async function handleSaveClub(event: React.FormEvent) {
    event.preventDefault();
    if (businessDayChanged) await saveBusinessDay();
    if (paymentMethodsChanged) await savePaymentMethods();
  }

  function discardClubChanges() {
    setBusinessDayStartHour(normalizeBusinessDayStartHour(selectedClub?.business_day_start_hour));
    setBusinessDayError('');
    setPaymentMethods(normalizePaymentMethods(savedPaymentMethodsKey ? savedPaymentMethodsKey.split(',') : []));
    setPaymentMethodsError('');
  }

  const tabs: Array<{ value: SettingsTab; label: string }> = [
    { value: 'club', label: t('tabClub') },
    { value: 'clubs', label: t('tabClubs') },
    { value: 'profile', label: t('tabProfile') },
    ...(isOwner ? [{ value: 'developer' as const, label: t('tabDeveloper') }] : []),
  ];

  return (
    <div className="w-full">
      <PageHeader title={t('title')} />

      {accountLoadError && <InlineAlert variant="danger" className="mb-4">{accountLoadError}</InlineAlert>}

      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SegmentedControl
          className={cn('lg:hidden', tabs.length > 3 ? 'grid-cols-2' : 'grid-cols-3')}
          variant="soft"
          size="sm"
          columns="auto"
          label={t('title')}
          options={tabs}
          value={activeTab}
          onChange={setTab}
        />

        <nav aria-label={t('title')} className="hidden lg:block">
          <ul className="space-y-0.5">
            {tabs.map((item) => {
              const current = item.value === activeTab;
              return (
                <li key={item.value}>
                  <button
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setTab(item.value)}
                    className={cn(
                      'flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      current ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950',
                    )}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <Card as="section" padding="none" className="overflow-hidden">
          {activeTab === 'club' && (
            <form onSubmit={handleSaveClub}>
              <SettingRow id="setting-business-day" title={t('businessDay')} help={t('businessDayHelp')}>
                {selectedClub ? (
                  <Field label={t('businessDayStartTime')} htmlFor="business-day-hour" error={businessDayError || undefined} hint={!isOwner ? t('businessDayOwnerOnly') : undefined}>
                    <Select
                      id="business-day-hour"
                      value={businessDayStartHour}
                      disabled={!isOwner || clubTabSaving}
                      onChange={(event) => {
                        setBusinessDayStartHour(Number(event.target.value));
                        setBusinessDayError('');
                      }}
                    >
                      {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                    </Select>
                  </Field>
                ) : (
                  <div role="status" aria-label={tc('loading')} className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                )}
              </SettingRow>

              <SettingRow id="setting-payment-methods" title={t('paymentMethods')} help={t('paymentMethodsHelp')}>
                <div className="grid gap-2" role="group" aria-labelledby="setting-payment-methods">
                  {PAYMENT_METHODS.map((method) => {
                    const enabled = paymentMethods.includes(method);
                    return (
                      <Checkbox
                        key={method}
                        variant="card"
                        checked={enabled}
                        disabled={!selectedClub || !isOwner || clubTabSaving}
                        onChange={() => togglePaymentMethod(method)}
                        label={tc(`paymentMethods.${method}`)}
                        description={enabled ? t('enabled') : t('disabled')}
                      />
                    );
                  })}
                </div>
                {paymentMethodsError && <InlineAlert variant="danger" hideIcon className="mt-3 py-2">{paymentMethodsError}</InlineAlert>}
                {!isOwner && <p className="mt-2 text-xs text-gray-500">{t('paymentMethodsOwnerOnly')}</p>}
              </SettingRow>

              {isOwner && (businessDayChanged || paymentMethodsChanged) && (
                <CardFooter className="flex flex-col gap-3 bg-gray-50/60 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-gray-700">{t('unsavedChanges', { count: changeCount })}</p>
                  <div className="flex gap-2 sm:justify-end">
                    <Button type="button" variant="ghost" className="flex-1 sm:flex-none" disabled={clubTabSaving} onClick={discardClubChanges}>
                      {t('discard')}
                    </Button>
                    <Button type="submit" className="flex-1 sm:flex-none" disabled={!selectedClub} loading={clubTabSaving} loadingLabel={t('savingBusinessDay')}>
                      {tc('save')}
                    </Button>
                  </div>
                </CardFooter>
              )}
            </form>
          )}

          {activeTab === 'clubs' && (
            <>
              <CardHeader>
                <SectionHeading
                  title={t('clubs')}
                  description={t('selectClubHelp')}
                  badge={<Badge variant="neutral">{memberships.length}</Badge>}
                  action={isOwner ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={createClubOpen}
                      aria-controls="create-club-form"
                      icon={<Plus size={16} aria-hidden="true" />}
                      onClick={() => {
                        setCreateClubOpen((current) => !current);
                        setClubError('');
                      }}
                    >
                      {t('addClub')}
                    </Button>
                  ) : undefined}
                />
              </CardHeader>

              {createClubOpen && isOwner && (
                <form id="create-club-form" onSubmit={handleCreateClub} className="grid gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-4 sm:grid-cols-2">
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
                  {clubError && <InlineAlert variant="danger" className="sm:col-span-2">{clubError}</InlineAlert>}
                  <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" disabled={clubSaving} onClick={() => { setCreateClubOpen(false); setClubError(''); }}>
                      {tc('cancel')}
                    </Button>
                    <Button type="submit" loading={clubSaving} loadingLabel={t('savingClub')}>{t('createClub')}</Button>
                  </div>
                </form>
              )}

              <ul className="divide-y divide-gray-100" aria-label={t('clubs')}>
                {memberships.map((membership) => {
                  const selected = selectedClub?.id === membership.club.id;
                  return (
                    <li key={membership.club.id}>
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => setSelectedClubId(membership.club.id)}
                        className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-950">{membership.club.name}</span>
                          {membership.club.address && <span className="block truncate text-xs text-gray-500">{membership.club.address}</span>}
                        </span>
                        <Badge size="sm" variant={membership.role === 'owner' ? 'primary' : membership.role === 'admin' ? 'neutral' : 'outline'}>
                          {roleLabel(membership.role)}
                        </Badge>
                        <span className={cn('flex w-5 shrink-0 justify-center text-primary-600', !selected && 'invisible')} aria-hidden="true">
                          <Check size={18} />
                        </span>
                        {selected && <span className="sr-only">{t('selectedClub')}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {activeTab === 'profile' && (
            <SettingRow id="setting-account" title={t('account')}>
              <div className="flex items-center gap-3">
                {accountLoading ? (
                  <div className="flex items-center gap-3" role="status" aria-label={tc('loading')}>
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                  </div>
                ) : (
                  <>
                    <Avatar name={account.fullName || account.email || '?'} tone="neutral" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-950">{account.fullName || t('account')}</p>
                      <p className="truncate text-xs text-gray-500">{account.email ?? '—'}</p>
                    </div>
                    {account.role && <Badge variant="outline" className="ml-auto shrink-0">{roleLabel(account.role)}</Badge>}
                  </>
                )}
              </div>
            </SettingRow>
          )}

          {activeTab === 'developer' && isOwner && selectedClub && (
            <MigrationHealthPanel key={selectedClub.id} clubId={selectedClub.id} />
          )}
        </Card>
      </div>

      {toastElement}
    </div>
  );
}
